//! KAP bildirimlerinden halka arz sürecine özgü olanları süzer.
//!
//! Mevcut `kap.rs` bildirimleri genel amaçlıdır (ticker bazlı). Bu modül
//! izahname, fiyat tespit, satış duyurusu ve sonuç bildirimlerini ayıklar.
//!
//! **Başlık tek başına halka arz kanıtı değildir.** "Tasarruf Sahiplerine
//! Satış Duyurusu" ve "Halka Arz Sonuçları" başlıkları, borsada zaten işlem
//! gören şirketlerin rüçhan haklı (bedelli) sermaye artırımlarında da
//! kullanılıyor: son iki yılda bu iki başlık altında geçen kodların tamamı —
//! FENER, HEKTS, BJKAS, TSKB … — mevcut şirketlere ait. Aynı şekilde
//! "İzahname (SPK Tarafından Onaylanan)" tahvil ve finansman bonosu ihraçları
//! için de yayımlanıyor. Bu yüzden bildirimler burada yalnız *aday* olarak
//! toplanır; halka arz olup olmadığına, SPK'nın onayladığı listeyle isim
//! eşleşmesi yapan `ipo_pipeline` karar verir.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::error::Error;

/// Halka arz bildirim türü.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum KapIpoDisclosureType {
    /// İzahname (SPK tarafından onaylanan)
    Prospectus,
    /// İzahname (SPK onayına sunulan) — henüz onaylanmamış taslak
    ProspectusDraft,
    /// Fiyat tespit raporu ve analist değerlendirmeleri
    PriceReport,
    /// Tasarruf sahiplerine satış duyurusu
    SaleNotice,
    /// Halka arz sonuçları
    Result,
    /// Borsa İstanbul'un birincil piyasa duyurusu (pazar, kod, işlem tarihi)
    ExchangeNotice,
    /// Halka arzla ilgili diğer bildirimler
    Other,
}

/// İzahname/sonuç bildiriminden çıkarılan yapısal veri.
///
/// Şu an doldurulmuyor: alanlar bildirim **detay sayfasının** HTML gövdesinde
/// bulunuyor ve listeleme ucu yalnız başlık/özet döndürüyor. Bildirim başına
/// bir sayfa isteği gerektirdiği için ayrı bir aşama olarak ele alınacak;
/// alan burada, tüketiciler hazır olsun diye duruyor.
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

/// Halka arz adayı bir KAP bildirimi.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct KapIpoDisclosure {
    /// Bildirimi yapan şirketin KAP unvanı.
    pub company_name: String,
    pub ticker: Option<String>,
    pub disclosure_type: KapIpoDisclosureType,
    pub publish_date: String,
    pub disclosure_index: String,
    /// Bildirimin KAP'taki kalıcı adresi — kullanıcıya resmi kaynak olarak
    /// gösterilir.
    pub url: String,
    pub extracted_data: Option<KapIpoExtractedData>,
}

/// Bildirim konusundan halka arz türünü belirler; ilgisizse `None`.
///
/// Türkçe küçültme sırası önemli: `to_lowercase` önce çalışırsa 'İ' iki koda
/// ayrışır ("i" + birleşen nokta) ve düz metin araması tutmaz.
fn classify_disclosure(subject: &str) -> Option<KapIpoDisclosureType> {
    let text = crate::spk::normalize_turkish(subject).to_lowercase();

    if text.contains("izahname") {
        // "SPK Onayına Sunulan" henüz onaylanmamış taslaktır; onaylanmış
        // izahnameden ayrı tutulur çünkü süreç aşamasını belirler.
        return Some(if text.contains("onayina sunulan") {
            KapIpoDisclosureType::ProspectusDraft
        } else {
            KapIpoDisclosureType::Prospectus
        });
    }
    if text.contains("fiyat tespit") || text.contains("halka arz fiyatinin belirlenmesinde") {
        return Some(KapIpoDisclosureType::PriceReport);
    }
    if text.contains("tasarruf sahiplerine satis duyurusu") {
        return Some(KapIpoDisclosureType::SaleNotice);
    }
    if text.contains("halka arz sonuclari") {
        return Some(KapIpoDisclosureType::Result);
    }
    if text.contains("borsa birincil piyasada halka arz") || text.contains("birincil piyasa duyurusu")
    {
        return Some(KapIpoDisclosureType::ExchangeNotice);
    }
    if text.contains("halka arz") {
        return Some(KapIpoDisclosureType::Other);
    }
    None
}

/// Tek istekte sorulan gün sayısı.
///
/// Uç yanıt başına 2.000 kayıt döndürür ve **sayfalama tanımıyor**: sınıra
/// dayanan pencerede en eski günler sessizce düşer. Ölçüm: 30 günlük pencere
/// her ay sınıra dayanıyor, 7 günlük pencere genelde dayanmıyor. Yine de
/// dayanırsa `kap::disclosures_in_range` pencereyi özyinelemeli böler.
const WINDOW_DAYS: i64 = 7;

/// Son N günlük KAP bildirimlerinden halka arz adaylarını çeker.
///
/// Bir pencere hata verirse o pencere atlanır ve tarama sürer: eksik veri,
/// hiç veri olmamasından iyidir.
pub async fn fetch_ipo_disclosures(
    client: &Client,
    days_back: u32,
) -> Result<Vec<KapIpoDisclosure>, Box<dyn Error + Send + Sync>> {
    let today = crate::kap::istanbul_today();
    let start = today - chrono::Duration::days(days_back as i64);

    let mut disclosures = Vec::new();
    let mut cursor = start;
    while cursor <= today {
        let window_end = (cursor + chrono::Duration::days(WINDOW_DAYS - 1)).min(today);
        match crate::kap::disclosures_in_range(client, cursor, window_end).await {
            Ok(rows) => disclosures.extend(rows.iter().filter_map(to_ipo_disclosure)),
            Err(error) => eprintln!("[kap_ipo] {cursor}..{window_end} atlandı: {error}"),
        }
        cursor = window_end + chrono::Duration::days(1);
    }

    Ok(disclosures)
}

fn to_ipo_disclosure(row: &crate::kap::RawDisclosure) -> Option<KapIpoDisclosure> {
    let disclosure_type = classify_disclosure(&row.subject)?;

    Some(KapIpoDisclosure {
        // Unvan `kapTitle` alanındadır; yanıtta `companyName` diye bir alan
        // yok ve konuya düşülen eski geri dönüş, unvan yerine bildirim
        // başlığını yazıyordu.
        company_name: row.kap_title.clone(),
        ticker: row.stock_codes.first().cloned(),
        disclosure_type,
        publish_date: row.publish_date.clone(),
        disclosure_index: row.disclosure_index.to_string(),
        url: format!("https://www.kap.org.tr/tr/Bildirim/{}", row.disclosure_index),
        extracted_data: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_approved_and_draft_prospectus() {
        assert_eq!(
            classify_disclosure("İzahname (SPK Tarafından Onaylanan)"),
            Some(KapIpoDisclosureType::Prospectus)
        );
        assert_eq!(
            classify_disclosure("İzahname (SPK Onayına Sunulan)"),
            Some(KapIpoDisclosureType::ProspectusDraft)
        );
    }

    /// Gerçek KAP başlıkları — fiyat raporu iki ayrı adla yayımlanıyor.
    #[test]
    fn classifies_price_reports() {
        assert_eq!(
            classify_disclosure("Fiyat Tespit Raporu"),
            Some(KapIpoDisclosureType::PriceReport)
        );
        assert_eq!(
            classify_disclosure(
                "Halka Arz Fiyatının Belirlenmesinde Esas Alınan Varsayımlara İlişkin Değerlendirme Raporu"
            ),
            Some(KapIpoDisclosureType::PriceReport)
        );
    }

    #[test]
    fn classifies_exchange_notice() {
        assert_eq!(
            classify_disclosure("Payların Borsa Birincil Piyasada Halka Arzı"),
            Some(KapIpoDisclosureType::ExchangeNotice)
        );
    }

    #[test]
    fn classifies_sale_notice_and_result() {
        assert_eq!(
            classify_disclosure("Tasarruf Sahiplerine Satış Duyurusu"),
            Some(KapIpoDisclosureType::SaleNotice)
        );
        assert_eq!(
            classify_disclosure("Halka Arz Sonuçları"),
            Some(KapIpoDisclosureType::Result)
        );
    }

    #[test]
    fn ignores_unrelated() {
        assert_eq!(classify_disclosure("Kar Dağıtımına İlişkin Bildirim"), None);
        assert_eq!(classify_disclosure("Finansal Rapor"), None);
    }

    /// Canlı uçla sözleşme sınaması: gövde biçimi ya da alan adları değişirse
    /// modül sessizce boş dönmesin. Eski gövde (`startDate`/`endDate` +
    /// `disclosureClass`) HTTP 500 alıyor ve hata yutulduğu için KAP kolu
    /// aylarca hiç veri getirmemişti.
    #[tokio::test]
    #[ignore = "canlı KAP erişimi gerektirir"]
    async fn live_ipo_disclosures_are_returned() {
        let client = crate::http_client();
        let rows = fetch_ipo_disclosures(&client, 30).await.unwrap();
        assert!(!rows.is_empty(), "30 günde hiç halka arz bildirimi çıkmadı");
        for row in rows.iter().take(5) {
            assert!(!row.company_name.is_empty(), "unvan boş: {row:?}");
            assert!(
                row.disclosure_index.parse::<u64>().is_ok(),
                "bildirim numarası sayısal olmalı: {row:?}"
            );
        }
        println!("{} bildirim; ilk: {:?}", rows.len(), rows.first());
    }
}
