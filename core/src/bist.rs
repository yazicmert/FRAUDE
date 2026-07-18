use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration as StdDuration, Instant};

use chrono::{Duration, NaiveDate, Utc};
use serde::Deserialize;

use crate::domain::HistoricalQuote;

const CACHE_TTL: StdDuration = StdDuration::from_secs(60 * 60);

#[derive(Deserialize)]
struct GraphicEnvelope {
    status: String,
    data: Vec<IndexPoint>,
}

#[derive(Deserialize)]
struct IndexPoint {
    clval: f64,
    #[serde(rename = "hisTs")]
    date: String,
}

#[derive(Clone)]
struct CachedHistory {
    fetched_at: Instant,
    rows: Vec<HistoricalQuote>,
}

static CACHE: OnceLock<Mutex<HashMap<String, CachedHistory>>> = OnceLock::new();

pub async fn fetch_index_history(
    client: &reqwest::Client,
    index_code: &str,
    range: &str,
) -> Result<Vec<HistoricalQuote>, String> {
    let normalized = index_code.trim_end_matches(".IS").to_uppercase();
    let all_rows = if let Some(rows) = cached(&normalized) {
        rows
    } else {
        let url = format!(
            "https://www.borsaistanbul.com/graphic.php?veriTuru=endeks-graphic&indexCode={normalized}"
        );
        let envelope = client.get(url)
            .header("User-Agent", crate::yahoo::YAHOO_USER_AGENT)
            .send().await.map_err(|error| format!("Borsa İstanbul graphic error: {error}"))?
            .error_for_status().map_err(|error| format!("Borsa İstanbul graphic status: {error}"))?
            .json::<GraphicEnvelope>().await
            .map_err(|error| format!("Borsa İstanbul graphic parse error: {error}"))?;
        if envelope.status != "success" {
            return Err(format!("Borsa İstanbul returned status {}", envelope.status));
        }
        let mut rows: Vec<HistoricalQuote> = envelope.data.into_iter().filter_map(|point| {
            let timestamp = NaiveDate::parse_from_str(&point.date, "%Y-%m-%d").ok()?
                .and_hms_opt(0, 0, 0)?.and_utc().timestamp();
            (timestamp >= 0 && point.clval.is_finite() && point.clval > 0.0).then_some(HistoricalQuote {
                time: timestamp as u64,
                open: point.clval,
                high: point.clval,
                low: point.clval,
                close: point.clval,
                volume: 0,
            })
        }).collect();
        rows.sort_by_key(|row| row.time);
        rows.dedup_by_key(|row| row.time);
        CACHE.get_or_init(|| Mutex::new(HashMap::new()))
            .lock().unwrap_or_else(|error| error.into_inner())
            .insert(normalized.clone(), CachedHistory { fetched_at: Instant::now(), rows: rows.clone() });
        rows
    };
    Ok(filter_range(all_rows, range))
}

fn cached(index_code: &str) -> Option<Vec<HistoricalQuote>> {
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut cache = cache.lock().unwrap_or_else(|error| error.into_inner());
    if cache.get(index_code).is_some_and(|entry| entry.fetched_at.elapsed() < CACHE_TTL) {
        cache.get(index_code).map(|entry| entry.rows.clone())
    } else {
        cache.remove(index_code);
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
    fn max_range_keeps_all_rows() {
        let rows = vec![HistoricalQuote { time: 1, open: 1.0, high: 1.0, low: 1.0, close: 1.0, volume: 0 }];
        assert_eq!(filter_range(rows, "max").len(), 1);
    }

    #[tokio::test]
    #[ignore = "requires live Borsa İstanbul access"]
    async fn live_xharz_has_real_long_history() {
        let client = reqwest::Client::new();
        let three_months = fetch_index_history(&client, "XHARZ", "3mo").await.unwrap();
        let all = fetch_index_history(&client, "XHARZ", "max").await.unwrap();
        assert!(three_months.len() > 40);
        assert!(all.len() > 3_000);
        assert!(all.len() > three_months.len());
    }
}
