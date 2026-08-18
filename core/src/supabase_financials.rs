//! Supabase merkezi BIST KAP XBRL finansal tablolar istemcisi.
//!
//! Tüm kullanıcılar için ortak olan 10 yıllık (2016-2026) BIST bilançolarını
//! Supabase PostgREST uç noktası üzerinden tek bir hızlı HTTPS sorgusunda (~50ms)
//! çeker. Her kullanıcının 22.000 KAP dosyasını ayrı ayrı indirmesini önler.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::domain::{FinancialPeriod, FinancialStatement};

const SUPABASE_URL: &str = "https://emrusyelfekcfyisfzzl.supabase.co";
const SUPABASE_ANON_KEY: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVtcnVzeWVsZmVrY2Z5aXNmenpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NzQwMzcsImV4cCI6MjEwMjA1MDAzN30.384frz30oK69aZO6rwLE8Cw50vHmnlxjxbtsOg0wI9M";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct SupabaseFinancialRow {
    pub ticker: String,
    pub period: String,
    pub year: i32,
    pub quarter: u8,
    pub is_annual: bool,
    pub currency: String,
    pub revenue: Option<f64>,
    pub gross_profit: Option<f64>,
    pub operating_income: Option<f64>,
    pub net_income: Option<f64>,
    pub total_assets: Option<f64>,
    pub total_equity: Option<f64>,
    pub total_debt: Option<f64>,
    pub operating_cash_flow: Option<f64>,
    pub free_cash_flow: Option<f64>,
    pub disclosure_index: Option<u64>,
    pub source: Option<String>,
}

impl From<SupabaseFinancialRow> for FinancialPeriod {
    fn from(row: SupabaseFinancialRow) -> Self {
        FinancialPeriod {
            period: row.period,
            revenue: row.revenue,
            gross_profit: row.gross_profit,
            operating_income: row.operating_income,
            net_income: row.net_income,
            total_assets: row.total_assets,
            total_equity: row.total_equity,
            total_debt: row.total_debt,
            operating_cash_flow: row.operating_cash_flow,
            free_cash_flow: row.free_cash_flow,
        }
    }
}

/// Supabase veritabanından tek bir hissenin tüm tarihsel finansal dönemlerini çeker.
///
/// PostgREST API üzerinden `bist_financial_periods` tablosunu sorgular.
/// Veri bulunursa `FinancialStatement` yapısına dönüştürüp döndürür.
pub async fn fetch_ticker_statement(
    client: &Client,
    ticker: &str,
    currency: &str,
) -> Result<Option<FinancialStatement>, String> {
    let company = ticker.trim().trim_end_matches(".IS").to_uppercase();
    let url = format!(
        "{SUPABASE_URL}/rest/v1/bist_financial_periods?ticker=eq.{company}&currency=eq.{currency}&order=period.asc"
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

    let mut annuals = Vec::new();
    let mut quarterlies = Vec::new();

    for row in rows {
        if row.is_annual || row.quarter == 4 {
            annuals.push(row.clone().into());
        }
        quarterlies.push(row.into());
    }

    Ok(Some(FinancialStatement {
        ticker: company,
        currency: currency.to_string(),
        annuals,
        quarterlies,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_row_to_financial_period_conversion() {
        let row = SupabaseFinancialRow {
            ticker: "THYAO".to_string(),
            period: "2024-06-30".to_string(),
            year: 2024,
            quarter: 2,
            is_annual: false,
            currency: "TRY".to_string(),
            revenue: Some(330113000000.0),
            gross_profit: Some(51386000000.0),
            operating_income: Some(20307000000.0),
            net_income: Some(37309000000.0),
            total_assets: Some(1233843000000.0),
            total_equity: Some(557648000000.0),
            total_debt: Some(425588000000.0),
            operating_cash_flow: Some(83856000000.0),
            free_cash_flow: Some(75321000000.0),
            disclosure_index: Some(1321134),
            source: Some("KAP_XBRL".to_string()),
        };

        let period: FinancialPeriod = row.into();
        assert_eq!(period.period, "2024-06-30");
        assert_eq!(period.revenue, Some(330113000000.0));
        assert_eq!(period.total_assets, Some(1233843000000.0));
    }
}
