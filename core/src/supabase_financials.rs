//! Supabase merkezi BIST KAP XBRL finansal tablolar istemcisi.
//!
//! Tüm kullanıcılar için ortak olan 10 yıllık (2016-2026) BIST bilançolarını
//! Supabase PostgREST uç noktası üzerinden tek bir hızlı HTTPS sorgusunda (~50ms)
//! çeker. Her kullanıcının 22.000 KAP dosyasını ayrı ayrı indirmesini önler.
//!
//! Okuma `bist_financial_quarters` görünümünden yapılıyor (boru hattı v2,
//! 20260818000005 göçü). Görünüm hem türetilmiş çeyreklik değerleri hem de
//! kümülatif `*_ytd` kolonlarını taşıdığı için yıllık ve çeyreklik seri tek
//! sorgudan kuruluyor.
//!
//! Bu modülde **yazma yolu yok**. v1'de istemci, depoda ve dağıtılan ikilide açık
//! duran anon anahtarla doğrudan tabloya yazıyordu; aynı anahtar arşivin tamamını
//! silmeye de yetiyordu. Artık anon yalnızca okuyabiliyor, arşivi `scripts/kap`
//! doldurucusu service_role anahtarıyla yazıyor.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

use crate::domain::{FinancialPeriod, FinancialStatement};

const SUPABASE_URL: &str = "https://emrusyelfekcfyisfzzl.supabase.co";
const SUPABASE_ANON_KEY: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVtcnVzeWVsZmVrY2Z5aXNmenpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NzQwMzcsImV4cCI6MjEwMjA1MDAzN30.384frz30oK69aZO6rwLE8Cw50vHmnlxjxbtsOg0wI9M";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// Konsolide tablo şirketin bağlı ortaklıklarını da kapsadığı için varsayılan
/// okuma tarafı. Yalnızca solo yayımlayan şirketler de var, o yüzden dönem
/// bazında geri düşülüyor.
const CONSOLIDATED: &str = "consolidated";

/// `bist_financial_quarters` görünümünün tek satırı.
///
/// Alan adları görünümün kolon adlarıyla birebir; PostgREST `select=*` yerine
/// açık kolon listesiyle sorgulanıyor ki görünüme kolon eklenmesi istemciyi
/// bozmasın.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct SupabaseFinancialRow {
    pub ticker: String,
    pub period: String,
    pub consolidation: String,
    pub currency: String,
    pub year: i32,
    pub quarter: u8,
    pub is_annual: bool,

    // Çeyreklik: raporlanan 3 aylık kolon, yoksa kümülatif farkı.
    pub revenue: Option<f64>,
    pub gross_profit: Option<f64>,
    pub operating_income: Option<f64>,
    pub net_income: Option<f64>,
    pub operating_cash_flow: Option<f64>,
    pub free_cash_flow: Option<f64>,

    // Kümülatif: Ç4 satırında tam yıl demek.
    pub revenue_ytd: Option<f64>,
    pub gross_profit_ytd: Option<f64>,
    pub operating_income_ytd: Option<f64>,
    pub net_income_ytd: Option<f64>,
    pub operating_cash_flow_ytd: Option<f64>,
    pub free_cash_flow_ytd: Option<f64>,

    // Bilanço kalemleri anlık; çeyreklik/yıllık ayrımı yok.
    pub total_assets: Option<f64>,
    pub total_equity: Option<f64>,
    pub total_debt: Option<f64>,
}

/// Görünümden çekilen kolonlar. Sıra önemsiz, isimler görünümle aynı olmalı.
const SELECT_COLUMNS: &str = "ticker,period,consolidation,currency,year,quarter,is_annual,\
revenue,gross_profit,operating_income,net_income,operating_cash_flow,free_cash_flow,\
revenue_ytd,gross_profit_ytd,operating_income_ytd,net_income_ytd,operating_cash_flow_ytd,\
free_cash_flow_ytd,total_assets,total_equity,total_debt";

impl SupabaseFinancialRow {
    /// Çeyreklik seriye giren kayıt: yalnızca ilgili üç ay.
    fn to_quarterly(&self) -> FinancialPeriod {
        FinancialPeriod {
            period: self.period.clone(),
            revenue: self.revenue,
            gross_profit: self.gross_profit,
            operating_income: self.operating_income,
            net_income: self.net_income,
            total_assets: self.total_assets,
            total_equity: self.total_equity,
            total_debt: self.total_debt,
            operating_cash_flow: self.operating_cash_flow,
            free_cash_flow: self.free_cash_flow,
        }
    }

    /// Yıllık seriye giren kayıt: Ç4 satırının kümülatifi tam yılı verir.
    ///
    /// v1'de yıllık seri de çeyreklik kolonlardan okunuyordu; KAP akış kalemlerini
    /// kümülatif yayımladığı için oradaki `revenue` zaten tam yıldı ve ayrım
    /// görünmüyordu. v2'de çeyreklik değer gerçekten çeyreklik, bu yüzden yıllık
    /// seri açıkça kümülatiften kurulmak zorunda.
    fn to_annual(&self) -> FinancialPeriod {
        FinancialPeriod {
            period: self.period.clone(),
            revenue: self.revenue_ytd,
            gross_profit: self.gross_profit_ytd,
            operating_income: self.operating_income_ytd,
            net_income: self.net_income_ytd,
            total_assets: self.total_assets,
            total_equity: self.total_equity,
            total_debt: self.total_debt,
            operating_cash_flow: self.operating_cash_flow_ytd,
            free_cash_flow: self.free_cash_flow_ytd,
        }
    }
}

/// Aynı dönemde hem konsolide hem solo tablo varsa konsolideyi seçer.
///
/// Şirketler iki tabloyu da yayımlıyor (AKBNK 2024/Ç4: konsolide 2,65 trn TL,
/// solo 2,52 trn TL). Seçim dönem bazında yapılıyor: yalnızca konsolide olanları
/// alıp geri kalanı atmak, sonradan bağlı ortaklık edinen şirketlerin erken
/// yıllarını tamamen düşürürdü.
fn prefer_consolidated(rows: Vec<SupabaseFinancialRow>) -> Vec<SupabaseFinancialRow> {
    let mut by_period: HashMap<String, SupabaseFinancialRow> = HashMap::new();
    for row in rows {
        match by_period.get(&row.period) {
            Some(existing) if existing.consolidation == CONSOLIDATED => continue,
            _ => {
                by_period.insert(row.period.clone(), row);
            }
        }
    }

    let mut kept: Vec<SupabaseFinancialRow> = by_period.into_values().collect();
    // PostgREST sırası dönem bazında tekilleştirmeden sonra korunmuyor.
    kept.sort_by(|a, b| a.period.cmp(&b.period));
    kept
}

/// Supabase veritabanından tek bir hissenin tüm tarihsel finansal dönemlerini çeker.
///
/// PostgREST API üzerinden `bist_financial_quarters` görünümünü sorgular.
/// Veri bulunursa `FinancialStatement` yapısına dönüştürüp döndürür.
pub async fn fetch_ticker_statement(
    client: &Client,
    ticker: &str,
    currency: &str,
) -> Result<Option<FinancialStatement>, String> {
    let company = ticker.trim().trim_end_matches(".IS").to_uppercase();
    let url = format!(
        "{SUPABASE_URL}/rest/v1/bist_financial_quarters\
?select={SELECT_COLUMNS}&ticker=eq.{company}&currency=eq.{currency}&order=period.asc"
    );

    let response = client
        .get(&url)
        .header("apikey", SUPABASE_ANON_KEY)
        .header("Authorization", format!("Bearer {SUPABASE_ANON_KEY}"))
        .header("Accept", "application/json")
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await
        .map_err(|e| format!("Supabase bağlantı hatası: {e}"))?;

    if !response.status().is_success() {
        return Ok(None);
    }

    let rows: Vec<SupabaseFinancialRow> = response
        .json()
        .await
        .map_err(|e| format!("Supabase yanıtı çözülemedi: {e}"))?;

    if rows.is_empty() {
        return Ok(None);
    }

    Ok(Some(build_statement(&company, currency, rows)))
}

/// Satırları yıllık ve çeyreklik seriye ayırır.
fn build_statement(
    company: &str,
    currency: &str,
    rows: Vec<SupabaseFinancialRow>,
) -> FinancialStatement {
    let rows = prefer_consolidated(rows);

    let mut annuals = Vec::new();
    let mut quarterlies = Vec::new();

    for row in &rows {
        if row.is_annual || row.quarter == 4 {
            annuals.push(row.to_annual());
        }
        quarterlies.push(row.to_quarterly());
    }

    FinancialStatement {
        ticker: company.to_string(),
        currency: currency.to_string(),
        annuals,
        quarterlies,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(period: &str, quarter: u8, consolidation: &str, revenue: f64, revenue_ytd: f64) -> SupabaseFinancialRow {
        SupabaseFinancialRow {
            ticker: "THYAO".to_string(),
            period: period.to_string(),
            consolidation: consolidation.to_string(),
            currency: "TRY".to_string(),
            year: period[..4].parse().unwrap(),
            quarter,
            is_annual: quarter == 4,
            revenue: Some(revenue),
            gross_profit: None,
            operating_income: None,
            net_income: None,
            operating_cash_flow: None,
            free_cash_flow: None,
            revenue_ytd: Some(revenue_ytd),
            gross_profit_ytd: None,
            operating_income_ytd: None,
            net_income_ytd: None,
            operating_cash_flow_ytd: None,
            free_cash_flow_ytd: None,
            total_assets: Some(1_233_843_000_000.0),
            total_equity: None,
            total_debt: None,
        }
    }

    #[test]
    fn quarterly_series_uses_derived_quarter_values() {
        let statement = build_statement(
            "THYAO",
            "TRY",
            vec![
                row("2024-03-31", 1, CONSOLIDATED, 100.0, 100.0),
                row("2024-06-30", 2, CONSOLIDATED, 150.0, 250.0),
            ],
        );

        let revenues: Vec<Option<f64>> = statement.quarterlies.iter().map(|p| p.revenue).collect();
        assert_eq!(revenues, vec![Some(100.0), Some(150.0)]);
    }

    #[test]
    fn annual_series_uses_cumulative_not_fourth_quarter() {
        // Ç4 çeyrekliği 200, tam yıl 600. Yıllık seri kümülatifi almalı; v1'de
        // ikisi aynı kolondan geldiği için yıllık grafik çeyreklik değer
        // gösteriyordu.
        let statement = build_statement(
            "THYAO",
            "TRY",
            vec![
                row("2024-09-30", 3, CONSOLIDATED, 150.0, 400.0),
                row("2024-12-31", 4, CONSOLIDATED, 200.0, 600.0),
            ],
        );

        assert_eq!(statement.annuals.len(), 1);
        assert_eq!(statement.annuals[0].revenue, Some(600.0));
        assert_eq!(statement.annuals[0].period, "2024-12-31");

        // Aynı dönem çeyreklik seride hâlâ çeyreklik değeriyle duruyor.
        let q4 = statement.quarterlies.last().expect("ceyreklik seri bos");
        assert_eq!(q4.revenue, Some(200.0));
    }

    #[test]
    fn consolidated_wins_over_solo_for_the_same_period() {
        let statement = build_statement(
            "THYAO",
            "TRY",
            vec![
                row("2024-12-31", 4, "solo", 180.0, 520.0),
                row("2024-12-31", 4, CONSOLIDATED, 200.0, 600.0),
            ],
        );

        assert_eq!(statement.quarterlies.len(), 1, "donem tekillesmedi");
        assert_eq!(statement.annuals[0].revenue, Some(600.0));
    }

    #[test]
    fn solo_only_periods_are_kept() {
        // Yalnızca solo yayımlayan şirket tamamen düşmemeli.
        let statement = build_statement(
            "THYAO",
            "TRY",
            vec![
                row("2023-12-31", 4, "solo", 90.0, 300.0),
                row("2024-12-31", 4, CONSOLIDATED, 200.0, 600.0),
            ],
        );

        assert_eq!(statement.annuals.len(), 2);
        assert_eq!(statement.annuals[0].revenue, Some(300.0));
        assert_eq!(statement.annuals[1].revenue, Some(600.0));
    }

    #[test]
    fn periods_stay_in_chronological_order() {
        let statement = build_statement(
            "THYAO",
            "TRY",
            vec![
                row("2024-06-30", 2, CONSOLIDATED, 150.0, 250.0),
                row("2024-03-31", 1, CONSOLIDATED, 100.0, 100.0),
                row("2024-12-31", 4, CONSOLIDATED, 200.0, 600.0),
            ],
        );

        let periods: Vec<&str> = statement.quarterlies.iter().map(|p| p.period.as_str()).collect();
        assert_eq!(periods, vec!["2024-03-31", "2024-06-30", "2024-12-31"]);
    }
}
