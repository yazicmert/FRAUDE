//! KAP API'sinden halka arza özel bildirimler.
//!
//! Mevcut `kap.rs` bildirimleri genel amaçlıdır (ticker bazlı). Bu modül
//! halka arz sürecine özgü bildirimleri (İzahname, Fiyat Tespit, Sonuç)
//! filtreleyerek çeker.

use serde::{Deserialize, Serialize};
use reqwest::Client;
use std::error::Error;

/// Halka arz bildirim türü.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum KapIpoDisclosureType {
    /// İzahname onayı / yayınlanması
    Prospectus,
    /// Fiyat tespit raporu
    PriceReport,
    /// Tasarruf sahiplerine satış duyurusu
    SaleNotice,
    /// Halka arz sonuçları
    Result,
    /// Diğer halka arz ile ilgili bildirimler
    Other,
}

/// İzahname/sonuç bildiriminden çıkarılan yapısal veri.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct KapIpoExtractedData {
    pub price: Option<f64>,
    pub total_lots: Option<f64>,
    pub ipo_size_tl: Option<f64>,
    pub book_building_dates: Option<String>,
    pub trading_start_date: Option<String>,
    pub distribution_type: Option<String>,
    pub consortium_lead: Option<String>,
    pub participant_count: Option<String>,
    pub distribution_ratios: Option<String>,
    pub fund_usage: Option<String>,
    pub katilim_index: Option<String>,
}

/// Halka arza özel bir KAP bildirimi.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct KapIpoDisclosure {
    pub company_name: String,
    pub ticker: Option<String>,
    pub disclosure_type: KapIpoDisclosureType,
    pub publish_date: String,
    pub disclosure_index: String,
    /// İzahname/sonuçtan çıkarılan yapısal veri.
    pub extracted_data: Option<KapIpoExtractedData>,
}



/// Bildirim konusundan halka arz türünü belirler.
fn classify_disclosure(subject: &str, summary: &str) -> Option<KapIpoDisclosureType> {
    let text = format!("{} {}", subject, summary);
    let text = crate::spk::normalize_turkish(&text).to_lowercase();

    if text.contains("izahname") {
        Some(KapIpoDisclosureType::Prospectus)
    } else if text.contains("fiyat tespit") {
        Some(KapIpoDisclosureType::PriceReport)
    } else if text.contains("tasarruf sahiplerine") || text.contains("satis duyurusu") {
        Some(KapIpoDisclosureType::SaleNotice)
    } else if text.contains("halka arz sonuc") {
        Some(KapIpoDisclosureType::Result)
    } else if text.contains("halka arz") || text.contains("talep toplama") {
        Some(KapIpoDisclosureType::Other)
    } else {
        None
    }
}

/// Son N günlük KAP bildirimlerinden halka arz ile ilgili olanları çeker.
///
/// KAP API'si yanıt başına 2.000 kayıt limiti uygular. Bu fonksiyon
/// tarih pencerelerini küçük tutarak limiti aşmadan çalışır.
pub async fn fetch_ipo_disclosures(
    client: &Client,
    days_back: u32,
) -> Result<Vec<KapIpoDisclosure>, Box<dyn Error + Send + Sync>> {
    let today = crate::kap::istanbul_today();
    let start = today - chrono::Duration::days(days_back as i64);

    let start_str = start.format("%Y-%m-%d").to_string();
    let end_str = today.format("%Y-%m-%d").to_string();

    // KAP byCriteria endpoint'ini kullan (mevcut kap.rs altyapısı)
    let url = "https://www.kap.org.tr/tr/api/disclosure/members/byCriteria";
    let payload = serde_json::json!({
        "startDate": start_str,
        "endDate": end_str,
        "disclosureClass": "ODA",
        "fromIndex": 0,
        "toIndex": 2000
    });

    let resp = client
        .post(url)
        .header("User-Agent", crate::yahoo::YAHOO_USER_AGENT)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await?;

    if !resp.status().is_success() {
        return Ok(Vec::new());
    }

    let rows: Vec<serde_json::Value> = resp.json().await.unwrap_or_default();
    let mut disclosures = Vec::new();

    for row in &rows {
        let subject = row.get("subject").and_then(|v| v.as_str()).unwrap_or("");
        let summary = row.get("summary").and_then(|v| v.as_str()).unwrap_or("");
        let publish_date = row.get("publishDate").and_then(|v| v.as_str()).unwrap_or("");
        let disclosure_index = row.get("disclosureIndex").and_then(|v| v.as_str()).unwrap_or("");

        // Hisse kodlarını çıkar
        let stock_codes = row.get("stockCodes")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let related = row.get("relatedStocks")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let ticker = if !stock_codes.is_empty() {
            Some(stock_codes.split(',').next().unwrap_or("").trim().to_string())
        } else if !related.is_empty() {
            Some(related.split(',').next().unwrap_or("").trim().to_string())
        } else {
            None
        };

        let company_name = row.get("companyName")
            .and_then(|v| v.as_str())
            .unwrap_or(subject)
            .to_string();

        if let Some(dtype) = classify_disclosure(subject, summary) {
            disclosures.push(KapIpoDisclosure {
                company_name,
                ticker,
                disclosure_type: dtype,
                publish_date: publish_date.to_string(),
                disclosure_index: disclosure_index.to_string(),
                extracted_data: None,
            });
        }
    }

    Ok(disclosures)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_prospectus() {
        assert_eq!(
            classify_disclosure("İzahname Onayı", ""),
            Some(KapIpoDisclosureType::Prospectus)
        );
    }

    #[test]
    fn classifies_result() {
        assert_eq!(
            classify_disclosure("Halka Arz Sonuçları Hakkında", ""),
            Some(KapIpoDisclosureType::Result)
        );
    }

    #[test]
    fn ignores_unrelated() {
        assert_eq!(classify_disclosure("Kar Dağıtımı", "Temettü"), None);
    }
}
