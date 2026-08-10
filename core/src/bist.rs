use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration as StdDuration, Instant};

use chrono::{Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

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

/// Bir BIST endeksinin güncel değeri ve dönemsel getirileri.
///
/// Paylarda bu alanlar üç ayrı sağlayıcıdan derleniyor (İş Yatırım ekranı,
/// Yahoo serisi, TradingView); endekslerde tek bir kaynak — Borsa İstanbul'un
/// kendi serisi — hepsini karşılıyor, o yüzden tümü aynı seriden hesaplanır ve
/// birbiriyle tutarlı olur.
#[derive(Clone, Debug, Serialize)]
pub struct IndexStats {
    pub code: String,
    pub value: f64,
    /// Son iki kapanış arasındaki değişim (%).
    pub change_pct: Option<f64>,
    pub change_1w: Option<f64>,
    pub change_1m: Option<f64>,
    pub change_6m: Option<f64>,
    pub change_1y: Option<f64>,
    pub change_5y: Option<f64>,
    /// Endeksin başlangıcından bugüne getiri.
    pub change_all: Option<f64>,
    /// Son kapanışın tarihi (unix sn).
    pub as_of_ts: u64,
    /// Serinin ilk barı (unix sn); "TÜM" getirisinin başlangıcı.
    pub first_ts: u64,
    pub bar_count: usize,
}

/// Endeksin dönemsel getirilerini Borsa İstanbul serisinden hesaplar.
///
/// Seri zaten `fetch_index_history` önbelleğinde (1 saat) tutulduğu için
/// endeks sekmesi açıkken ek istek doğurmaz.
pub async fn index_stats(client: &reqwest::Client, index_code: &str) -> Result<IndexStats, String> {
    let rows = fetch_index_history(client, index_code, "max").await?;
    let code = index_code.trim_end_matches(".IS").to_uppercase();
    stats_from_series(&code, &rows).ok_or_else(|| format!("{code} için kapanış serisi boş"))
}

/// Dönem başlangıcı olarak `days` gün öncesine ait **son** kapanışı verir.
///
/// Çapa bugün değil serinin son barıdır; hafta sonu ya da tatilde çalıştırınca
/// pencere kaymasın diye. Seri o tarihe kadar uzanmıyorsa `None` döner: yeni
/// kurulmuş bir endekste 5 yıllık getiriyi listelenme gününden hesaplamak,
/// 5 yıllık diye 3 aylık bir getiri göstermek olurdu.
fn close_days_before(rows: &[HistoricalQuote], anchor_ts: u64, days: u64) -> Option<f64> {
    let cutoff = anchor_ts.checked_sub(days.checked_mul(86_400)?)?;
    if rows.first()?.time > cutoff {
        return None;
    }
    rows.iter()
        .rev()
        .find(|row| row.time <= cutoff)
        .map(|row| row.close)
        .filter(|close| *close > 0.0)
}

fn stats_from_series(code: &str, rows: &[HistoricalQuote]) -> Option<IndexStats> {
    let last = rows.last()?;
    let first = rows.first()?;
    let value = last.close;
    if !(value > 0.0) {
        return None;
    }
    let change_from = |old: Option<f64>| -> Option<f64> {
        let old = old.filter(|value| *value > 0.0)?;
        Some((((value - old) / old * 100.0) * 100.0).round() / 100.0)
    };
    Some(IndexStats {
        code: code.to_string(),
        value,
        change_pct: change_from(rows.iter().rev().nth(1).map(|row| row.close)),
        change_1w: change_from(close_days_before(rows, last.time, 7)),
        change_1m: change_from(close_days_before(rows, last.time, 30)),
        change_6m: change_from(close_days_before(rows, last.time, 182)),
        change_1y: change_from(close_days_before(rows, last.time, 365)),
        change_5y: change_from(close_days_before(rows, last.time, 1_826)),
        change_all: change_from(Some(first.close)).filter(|_| rows.len() > 1),
        as_of_ts: last.time,
        first_ts: first.time,
        bar_count: rows.len(),
    })
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

    /// `time` alanı gün başlangıcı (unix sn); testlerde gün gün geriye sayarız.
    fn series(closes: &[(u64, f64)]) -> Vec<HistoricalQuote> {
        closes
            .iter()
            .map(|&(day, close)| HistoricalQuote {
                time: day * 86_400,
                open: close,
                high: close,
                low: close,
                close,
                volume: 0,
            })
            .collect()
    }

    #[test]
    fn periods_are_measured_from_the_last_bar() {
        // 20.000 günlük seri: her dönem başlangıcı tam olarak o kadar gün önce.
        let rows = series(&[
            (20_000 - 1_826, 100.0),
            (20_000 - 365, 200.0),
            (20_000 - 182, 250.0),
            (20_000 - 30, 400.0),
            (20_000 - 7, 480.0),
            (20_000 - 1, 500.0),
            (20_000, 600.0),
        ]);
        let stats = stats_from_series("XTEST", &rows).unwrap();
        assert_eq!(stats.value, 600.0);
        assert_eq!(stats.change_pct, Some(20.0)); // 500 -> 600
        assert_eq!(stats.change_1w, Some(25.0)); // 480 -> 600
        assert_eq!(stats.change_1m, Some(50.0)); // 400 -> 600
        assert_eq!(stats.change_6m, Some(140.0)); // 250 -> 600
        assert_eq!(stats.change_1y, Some(200.0)); // 200 -> 600
        assert_eq!(stats.change_5y, Some(500.0)); // 100 -> 600
        assert_eq!(stats.change_all, Some(500.0));
        assert_eq!(stats.bar_count, 7);
    }

    /// Yeni kurulmuş endekste uzun dönemler boş kalmalı. Aksi halde 3 aylık
    /// bir getiri "5 yıllık" etiketiyle gösterilir.
    #[test]
    fn young_index_reports_no_long_term_return() {
        let rows = series(&[(20_000 - 60, 1_000.0), (20_000 - 7, 1_100.0), (20_000, 1_200.0)]);
        let stats = stats_from_series("XYENI", &rows).unwrap();
        assert_eq!(stats.change_1w, Some(9.09));
        assert_eq!(stats.change_1m, Some(20.0)); // 60 gün geriye uzanıyor
        assert_eq!(stats.change_6m, None);
        assert_eq!(stats.change_1y, None);
        assert_eq!(stats.change_5y, None);
        // Başlangıçtan bugüne her zaman hesaplanabilir.
        assert_eq!(stats.change_all, Some(20.0));
    }

    /// Dönem başlangıcı, kesim tarihine denk gelen bar yoksa ondan **önceki**
    /// son kapanış olmalı; tatile denk gelen pencere boş dönmemeli.
    #[test]
    fn period_start_falls_back_to_the_previous_close() {
        let rows = series(&[(20_000 - 40, 50.0), (20_000 - 3, 90.0), (20_000, 100.0)]);
        let stats = stats_from_series("XTATIL", &rows).unwrap();
        assert_eq!(stats.change_1w, Some(100.0)); // 7 gün önce bar yok, 40 gün öncesine düşer
    }

    #[test]
    fn single_bar_series_has_no_returns() {
        let rows = series(&[(20_000, 100.0)]);
        let stats = stats_from_series("XTEK", &rows).unwrap();
        assert_eq!(stats.value, 100.0);
        assert_eq!(stats.change_pct, None);
        assert_eq!(stats.change_all, None);
    }

    #[test]
    fn empty_series_has_no_stats() {
        assert!(stats_from_series("XBOS", &[]).is_none());
    }

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

    /// Panoda/katalogda açılabilen her BIST endeksi uzun aralıklarda da dolu
    /// seri vermeli. `api::get_price_history` bir dönem 1y/5y/max aralıklarını
    /// Yahoo'ya yönlendiriyordu; Yahoo bu sembollerin çoğunda 'max' aralığında
    /// bile tek bar döndürdüğü için grafik boş kalıyordu. Bu test yönlendirmenin
    /// geri gelmesini değil, Borsa İstanbul'un uzun aralık kapsamasını korur.
    #[tokio::test]
    #[ignore = "requires live Borsa İstanbul access"]
    async fn live_every_exposed_index_has_long_history() {
        let client = reqwest::Client::new();
        for code in ["XU100", "XU050", "XU030", "XBANK", "XUSIN", "XUTEK", "XHARZ"] {
            let year = fetch_index_history(&client, code, "1y").await.unwrap();
            let all = fetch_index_history(&client, code, "max").await.unwrap();
            assert!(year.len() > 200, "{code} 1y yalnız {} bar", year.len());
            assert!(all.len() > 2_000, "{code} max yalnız {} bar", all.len());
        }
    }

    /// Dönemsel getiriler CSV'deki **her** endeks için hesaplanabilmeli.
    /// Genç endekslerde uzun dönemlerin boş kalması beklenen davranış; asıl
    /// aranan, hiçbir endeksin değersiz (0 ya da negatif) dönmemesi.
    #[tokio::test]
    #[ignore = "requires live Borsa İstanbul access"]
    async fn live_index_stats_cover_every_index() {
        let client = reqwest::Client::new();
        let csv = client
            .get("https://borsaistanbul.com/datum/hisse_endeks_ds.csv")
            .header("User-Agent", "Mozilla/5.0")
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        let mut codes: Vec<String> = csv
            .lines()
            .skip(2)
            .filter_map(|line| line.split(';').nth(2).map(|code| code.trim().to_string()))
            .filter(|code| !code.is_empty())
            .collect();
        codes.sort();
        codes.dedup();
        assert!(codes.len() > 50, "CSV'den yalnız {} kod çıktı", codes.len());

        let mut with_five_year = 0;
        for code in &codes {
            let stats = index_stats(&client, code).await.unwrap_or_else(|error| panic!("{code}: {error}"));
            assert!(stats.value > 0.0, "{code} değeri {}", stats.value);
            assert!(stats.bar_count > 1, "{code} yalnız {} bar", stats.bar_count);
            assert!(stats.change_all.is_some(), "{code} tüm zamanlık getirisi yok");
            if stats.change_5y.is_some() {
                with_five_year += 1;
            }
        }
        // Endekslerin çoğu 5 yıldan eski; hiçbirinde 5 yıllık çıkmıyorsa
        // dönem hesabı değil, seri kısalmış demektir.
        assert!(with_five_year > codes.len() / 2, "5 yıllık getirisi olan yalnız {with_five_year}");
    }

    /// Sembol ".IS" ekiyle de gelebilir (katalog `XU100.IS` saklar); ekin
    /// soyulmaması tüm endeks isteklerini sessizce Yahoo'ya düşürürdü.
    #[tokio::test]
    #[ignore = "requires live Borsa İstanbul access"]
    async fn live_suffixed_symbol_resolves() {
        let client = reqwest::Client::new();
        let rows = fetch_index_history(&client, "XU050.IS", "1y").await.unwrap();
        assert!(rows.len() > 200);
    }
}
