//! İş Yatırım hisse fiyat geçmişi. Grafik seçicisinde "İş Yatırım" kaynağı
//! seçildiğinde kullanılır. İş Yatırım'ın public grafik ucu (`IndexHistoricalAll`)
//! yalnızca **düzeltilmiş kapanış** serisi döndürür; açılış/yüksek/düşük ve hacim
//! yoktur. Bu yüzden her satırda `open = high = low = close` verilir ve hacim
//! sıfırlanır; frontend bu durumu algılayıp mum yerine çizgi grafik çizer
//! (bkz. PriceChart.tsx `closeOnly`). Avantajı, BIST temettü/bölünme
//! düzeltmesinin Yahoo'dan daha doğru olması ve serinin 2010'a kadar gitmesidir.
//!
//! Uç çerezsiz düz GET ile çalışır (screener'daki oturum akışı gerekmez):
//!   ChartData.aspx/IndexHistoricalAll?period=1440&from=YYYYMMDDhhmmss&to=...&endeks=THYAO

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration as StdDuration, Instant};

use chrono::{Duration, Utc};

use crate::domain::HistoricalQuote;

const HISTORY_URL: &str =
    "https://www.isyatirim.com.tr/_Layouts/15/IsYatirim.Website/Common/ChartData.aspx/IndexHistoricalAll";
/// period=1440 dakika = günlük bar.
const DAILY_PERIOD: u32 = 1440;
const CACHE_TTL: StdDuration = StdDuration::from_secs(60 * 60);

#[derive(serde::Deserialize)]
struct HistoryEnvelope {
    /// Her eleman [zaman damgası (ms), kapanış]. Tatil/eksik günlerde kapanış
    /// null gelebildiğinden ikinci alan Option'dır.
    data: Vec<(i64, Option<f64>)>,
}

#[derive(Clone)]
struct CachedHistory {
    fetched_at: Instant,
    rows: Vec<HistoricalQuote>,
}

static CACHE: OnceLock<Mutex<HashMap<String, CachedHistory>>> = OnceLock::new();

/// BIST hisse kodunu İş Yatırım'ın beklediği biçime indirger (`.IS` eki atılır,
/// büyük harfe çevrilir). "THYAO.IS" → "THYAO".
fn endeks_code(ticker: &str) -> String {
    ticker.trim().trim_end_matches(".IS").to_uppercase()
}

pub async fn fetch_price_history(
    client: &reqwest::Client,
    ticker: &str,
    range: &str,
) -> Result<Vec<HistoricalQuote>, String> {
    let code = endeks_code(ticker);
    let all_rows = if let Some(rows) = cached(&code) {
        rows
    } else {
        // `from` bilerek geniş tutulur; İş Yatırım'ın verdiği en eski tarihten
        // (hisse başına ~2010) itibaren tüm seri gelir, aralık filtrelemesi
        // aşağıda yapılır.
        let now = Utc::now();
        let url = format!(
            "{HISTORY_URL}?period={DAILY_PERIOD}&from=20000101000000&to={}&endeks={code}",
            now.format("%Y%m%d%H%M%S")
        );
        let envelope = client
            .get(url)
            .timeout(StdDuration::from_secs(12))
            .header("User-Agent", crate::yahoo::YAHOO_USER_AGENT)
            .header(
                "Referer",
                "https://www.isyatirim.com.tr/tr-tr/analiz/hisse/Sayfalar/sirket-karti.aspx",
            )
            .send()
            .await
            .map_err(|error| format!("İş Yatırım fiyat isteği başarısız ({code}): {error}"))?
            .error_for_status()
            .map_err(|error| format!("İş Yatırım fiyat yanıtı ({code}): {error}"))?
            .json::<HistoryEnvelope>()
            .await
            .map_err(|error| format!("İş Yatırım fiyat çözümlenemedi ({code}): {error}"))?;

        let mut rows: Vec<HistoricalQuote> = envelope
            .data
            .into_iter()
            .filter_map(|(millis, close)| {
                let close = close?;
                let time = u64::try_from(millis / 1000).ok()?;
                (close.is_finite() && close > 0.0).then_some(HistoricalQuote {
                    time,
                    open: close,
                    high: close,
                    low: close,
                    close,
                    volume: 0,
                })
            })
            .collect();
        rows.sort_by_key(|row| row.time);
        rows.dedup_by_key(|row| row.time);
        if rows.is_empty() {
            return Err(format!("{code} için İş Yatırım'da fiyat verisi bulunamadı."));
        }
        CACHE
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(code.clone(), CachedHistory { fetched_at: Instant::now(), rows: rows.clone() });
        rows
    };
    Ok(filter_range(all_rows, range))
}

fn cached(code: &str) -> Option<Vec<HistoricalQuote>> {
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut cache = cache.lock().unwrap_or_else(|error| error.into_inner());
    if cache.get(code).is_some_and(|entry| entry.fetched_at.elapsed() < CACHE_TTL) {
        cache.get(code).map(|entry| entry.rows.clone())
    } else {
        cache.remove(code);
        None
    }
}

fn filter_range(rows: Vec<HistoricalQuote>, range: &str) -> Vec<HistoricalQuote> {
    let days = match range {
        "1mo" => Some(31),
        "3mo" => Some(93),
        "6mo" => Some(186),
        "1y" => Some(366),
        "5y" => Some(1_826),
        "max" => None,
        _ => Some(186),
    };
    let Some(days) = days else { return rows };
    let cutoff = (Utc::now() - Duration::days(days)).timestamp().max(0) as u64;
    rows.into_iter().filter(|row| row.time >= cutoff).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endeks_code_strips_suffix_and_uppercases() {
        assert_eq!(endeks_code("thyao.IS"), "THYAO");
        assert_eq!(endeks_code(" garan "), "GARAN");
    }

    #[test]
    fn max_range_keeps_all_rows() {
        let rows = vec![HistoricalQuote { time: 1, open: 1.0, high: 1.0, low: 1.0, close: 1.0, volume: 0 }];
        assert_eq!(filter_range(rows, "max").len(), 1);
    }

    #[tokio::test]
    #[ignore = "requires live İş Yatırım access"]
    async fn live_thyao_close_only_history_is_deep_and_adjusted() {
        let client = reqwest::Client::new();
        let all = fetch_price_history(&client, "THYAO", "max").await.unwrap();
        assert!(all.len() > 3_000, "günlük seri 2010'a kadar gitmeli: {}", all.len());
        // Kapanış-only: her satırda OHLC eşit, hacim sıfır.
        assert!(all.iter().all(|r| r.open == r.close && r.high == r.close && r.low == r.close && r.volume == 0));
        // Aralık filtresi max'ten daha az bar döndürmeli.
        let six_months = fetch_price_history(&client, "THYAO", "6mo").await.unwrap();
        assert!(six_months.len() < all.len() && !six_months.is_empty());
    }
}
