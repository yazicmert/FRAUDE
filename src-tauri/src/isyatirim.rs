use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use reqwest::header::{ACCEPT, CONTENT_TYPE, COOKIE, ORIGIN, REFERER, SET_COOKIE, USER_AGENT};
use serde::Deserialize;

use crate::domain::EquityRow;

const PAGE_URL: &str = "https://www.isyatirim.com.tr/tr-tr/analiz/hisse/Sayfalar/gelismis-hisse-arama.aspx";
const SCREENER_URL: &str = "https://www.isyatirim.com.tr/tr-tr/analiz/_Layouts/15/IsYatirim.Website/StockInfo/CompanyInfoAjax.aspx/getScreenerDataNEW";
const CACHE_TTL: Duration = Duration::from_secs(15 * 60);

#[derive(Clone, Debug, Default)]
struct CurrentRatios {
    pe: Option<f64>,
    pb: Option<f64>,
    roe: Option<f64>,
    roa: Option<f64>,
    dividend_yield: Option<f64>,
    free_float_ratio: Option<f64>,
    foreign_ratio: Option<f64>,
    market_cap: Option<f64>,
}

#[derive(Deserialize)]
struct ScreenerEnvelope {
    d: String,
}

type RatioMap = HashMap<String, CurrentRatios>;
static CACHE: OnceLock<Mutex<Option<(Instant, RatioMap)>>> = OnceLock::new();

/// Overlays İş Yatırım's business-facing "Cari" ratios on top of the raw
/// statement fallback. This keeps the values shown by FRAUDE aligned with the
/// Turkish market convention users compare against.
pub async fn enrich_all(client: &reqwest::Client, equities: &mut [EquityRow]) -> usize {
    let ratios = match cached_ratios() {
        Some(rows) => rows,
        None => match fetch_ratios(client).await {
            Ok(rows) => {
                *CACHE.get_or_init(|| Mutex::new(None))
                    .lock().unwrap_or_else(|error| error.into_inner()) =
                    Some((Instant::now(), rows.clone()));
                rows
            }
            Err(_) => return 0,
        },
    };

    let mut updated = 0;
    for equity in equities {
        let Some(current) = ratios.get(&equity.ticker) else { continue };

        // A negative P/E is not meaningful. İş Yatırım exposes it as a raw
        // screener value, while FRAUDE deliberately renders it as missing.
        // Ek istekte bulunmayan hisselerde mevcut (Yahoo) değerler korunur.
        equity.pe = current.pe.filter(|value| *value > 0.0).or(equity.pe);
        equity.pb = current.pb.filter(|value| *value > 0.0).or(equity.pb);
        equity.roe = current.roe.or(equity.roe);
        equity.roa = current.roa.or(equity.roa);
        equity.dividend_yield = current.dividend_yield.or(equity.dividend_yield);
        equity.free_float_ratio = current.free_float_ratio.or(equity.free_float_ratio);
        equity.foreign_ratio = current.foreign_ratio.or(equity.foreign_ratio);
        equity.market_cap = current.market_cap.or(equity.market_cap);
        equity.fundamentals_available = [
            equity.pe, equity.pb, equity.roe, equity.roa, equity.gross_margin,
            equity.net_margin, equity.net_debt_ebitda, equity.dividend_yield,
            equity.free_float_ratio,
        ].into_iter().any(|value| value.is_some());
        equity.fundamentals_source = Some(
            "İş Yatırım Cari Oranlar (F/K, PD/DD, ROE, ROA, Temettü) · Yahoo ham finansallar (marj ve borçluluk)".into()
        );
        updated += 1;
    }
    updated
}

fn cached_ratios() -> Option<RatioMap> {
    let cache = CACHE.get_or_init(|| Mutex::new(None));
    let mut cache = cache.lock().unwrap_or_else(|error| error.into_inner());
    if cache.as_ref().is_some_and(|(fetched_at, _)| fetched_at.elapsed() < CACHE_TTL) {
        cache.as_ref().map(|(_, rows)| rows.clone())
    } else {
        *cache = None;
        None
    }
}

async fn fetch_ratios(client: &reqwest::Client) -> Result<RatioMap, String> {
    let page_response = client.get(PAGE_URL)
        .header(USER_AGENT, crate::yahoo::YAHOO_USER_AGENT)
        .header(ACCEPT, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .send().await.map_err(|error| format!("İş Yatırım session error: {error}"))?
        .error_for_status().map_err(|error| format!("İş Yatırım session status: {error}"))?;

    let cookies = page_response.headers().get_all(SET_COOKIE).iter()
        .filter_map(|value| value.to_str().ok())
        .filter_map(|value| value.split(';').next())
        .collect::<Vec<_>>()
        .join("; ");

    // Kriterler VE filtresi gibi çalışır: bir hissede kriter alanı boşsa hisse
    // sonuçtan tamamen düşer. Kapanış (7) bile bazı hisseleri (ör. DSTKF) eler.
    // Bu yüzden üç katman kullanılır ve her katman bir öncekinin üzerine bindirilir:
    //   1) yalnızca piyasa değeri  → en geniş kapsam (~615 hisse, ısı haritası)
    //   2) F/K, PD/DD, halka açıklık → ~590 hisse
    //   3) ROE, ROA, temettü        → ~190 hisse
    let market_cap_only = serde_json::json!([
        ["8", "0", "1000000000", "False"]
    ]);
    let base = serde_json::json!([
        ["7", "1", "50000", "False"],
        ["28", "-100000", "100000", "False"],
        ["30", "-100000", "100000", "False"],
        ["11", "0", "100", "False"]
    ]);
    let extended = serde_json::json!([
        ["7", "1", "50000", "False"],
        ["422", "-100000", "100000", "False"],
        ["423", "-100000", "100000", "False"],
        ["36", "-100000", "100000", "False"]
    ]);
    // Yabancı takas oranı (kriter 40) ayrı bir katmanda çekilir; kod 40'ı
    // mevcut katmanlara eklemek onları yalnız yabancı oranı olan hisselerle
    // sınırlar ve F/K, PD/DD kapsamını daraltırdı. Piyasa değeriyle (8) birlikte
    // istenerek geniş kapsam (~585 hisse) korunur.
    let foreign = serde_json::json!([
        ["8", "0", "1000000000", "False"],
        ["40", "0", "100", "False"]
    ]);

    let (widest, base_body, extended_body, foreign_body) = tokio::join!(
        screener_request(client, &cookies, &market_cap_only),
        screener_request(client, &cookies, &base),
        screener_request(client, &cookies, &extended),
        screener_request(client, &cookies, &foreign),
    );

    let mut map = parse_rows(&widest?)?;
    for body in [base_body, extended_body, foreign_body].into_iter().flatten() {
        if let Ok(rows) = parse_rows(&body) {
            for (ticker, ext) in rows {
                let entry = map.entry(ticker).or_default();
                entry.pe = ext.pe.or(entry.pe);
                entry.pb = ext.pb.or(entry.pb);
                entry.roe = ext.roe.or(entry.roe);
                entry.roa = ext.roa.or(entry.roa);
                entry.dividend_yield = ext.dividend_yield.or(entry.dividend_yield);
                entry.free_float_ratio = ext.free_float_ratio.or(entry.free_float_ratio);
                entry.foreign_ratio = ext.foreign_ratio.or(entry.foreign_ratio);
                entry.market_cap = ext.market_cap.or(entry.market_cap);
            }
        }
    }
    Ok(map)
}

async fn screener_request(
    client: &reqwest::Client,
    cookies: &str,
    criterias: &serde_json::Value,
) -> Result<String, String> {
    let payload = serde_json::json!({
        "sektor": "",
        "endeks": "",
        "takip": "",
        "oneri": "",
        "criterias": criterias,
        "lang": "1055"
    });

    let mut request = client.post(SCREENER_URL)
        .header(USER_AGENT, crate::yahoo::YAHOO_USER_AGENT)
        .header(CONTENT_TYPE, "application/json; charset=UTF-8")
        .header("X-Requested-With", "XMLHttpRequest")
        .header(ACCEPT, "application/json, text/javascript, */*; q=0.01")
        .header(ORIGIN, "https://www.isyatirim.com.tr")
        .header(REFERER, PAGE_URL)
        .json(&payload);
    if !cookies.is_empty() { request = request.header(COOKIE, cookies.to_string()); }

    let envelope = request.send().await
        .map_err(|error| format!("İş Yatırım screener error: {error}"))?
        .error_for_status().map_err(|error| format!("İş Yatırım screener status: {error}"))?
        .json::<ScreenerEnvelope>().await
        .map_err(|error| format!("İş Yatırım envelope parse error: {error}"))?;
    Ok(envelope.d)
}

fn parse_rows(value: &str) -> Result<RatioMap, String> {
    let rows = serde_json::from_str::<Vec<HashMap<String, String>>>(value)
        .map_err(|error| format!("İş Yatırım ratios parse error: {error}"))?;
    let mut parsed = RatioMap::new();
    for row in rows {
        let Some(ticker) = row.get("Hisse")
            .and_then(|value| value.split(" - ").next())
            .map(str::trim)
            .filter(|value| !value.is_empty()) else { continue };
        parsed.insert(ticker.to_uppercase(), CurrentRatios {
            pe: number(&row, "28"),
            pb: number(&row, "30"),
            roe: number(&row, "422"),
            roa: number(&row, "423"),
            dividend_yield: number(&row, "36"),
            free_float_ratio: number(&row, "11"),
            foreign_ratio: number(&row, "40"),
            // Ekran 8 no'lu kriteri milyon TL olarak döndürür; ısı haritası TL bekler.
            market_cap: number(&row, "8").map(|value| value * 1_000_000.0),
        });
    }
    Ok(parsed)
}

fn number(row: &HashMap<String, String>, key: &str) -> Option<f64> {
    row.get(key).and_then(|value| value.replace(',', ".").parse::<f64>().ok())
        .filter(|value| value.is_finite())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_current_ratios_by_ticker() {
        let input = r#"[{"Hisse":"ASELS - Aselsan ","28":"47.5","30":"6","422":"16.23","423":"9.41"}]"#;
        let rows = parse_rows(input).unwrap();
        let asels = rows.get("ASELS").unwrap();
        assert_eq!(asels.pe, Some(47.5));
        assert_eq!(asels.pb, Some(6.0));
        assert_eq!(asels.roe, Some(16.23));
        assert_eq!(asels.roa, Some(9.41));
    }

    #[tokio::test]
    #[ignore = "requires live İş Yatırım access"]
    async fn live_screener_has_broad_bist_coverage() {
        let rows = fetch_ratios(&reqwest::Client::new()).await.unwrap();
        assert!(rows.len() > 300, "unexpected screener coverage: {}", rows.len());
        let with_market_cap = rows.values().filter(|row| row.market_cap.is_some()).count();
        assert!(
            with_market_cap * 100 / rows.len() >= 80,
            "ısı haritası için piyasa değeri kapsamı düşük: {with_market_cap}/{}",
            rows.len()
        );
        assert!(
            rows.get("ASELS").and_then(|row| row.market_cap).is_some_and(|value| value > 1e10),
            "ASELS piyasa değeri TL cinsinden makul olmalı"
        );
        // İş Yatırım DSTKF'nin kapanış alanını boş bıraktığından yalnızca
        // piyasa değeri katmanında görünür; ısı haritası için bu yeterli.
        assert!(
            rows.get("DSTKF").and_then(|row| row.market_cap).is_some(),
            "DSTKF piyasa değeriyle kapsanmalı (ısı haritası regresyonu)"
        );
        // F/K piyasa fiyatıyla her gün değiştiğinden dar bir banda kilitlenmez;
        // yalnız kriter 28'in ayrıştırıldığı (pozitif, makul aralıkta) doğrulanır.
        assert!(rows.get("ASELS").and_then(|row| row.pe).is_some_and(|value| (1.0..500.0).contains(&value)));
        assert!(rows.get("THYAO").and_then(|row| row.pe).is_some_and(|value| (1.0..500.0).contains(&value)));

        // Yabancı takas oranı (kriter 40) ayrı katmandan gelmeli ve 0-100 aralığında olmalı.
        let with_foreign = rows.values().filter(|row| row.foreign_ratio.is_some()).count();
        assert!(with_foreign > 300, "yabancı takas oranı geniş kapsanmalı: {with_foreign}");
        assert!(
            rows.get("ASELS").and_then(|row| row.foreign_ratio).is_some_and(|value| (0.0..=100.0).contains(&value)),
            "ASELS yabancı takas oranı 0-100 aralığında gelmeli"
        );

        let covered = crate::yahoo::BIST_TICKERS.iter()
            .filter(|(ticker, _)| rows.contains_key(*ticker))
            .count();
        assert!(covered * 100 / crate::yahoo::BIST_TICKERS.len() >= 90);
    }
}
