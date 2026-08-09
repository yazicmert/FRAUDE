//! TradingView tarayıcı ekranı: uzun dönem getiriler ve OHLC kesiti.
//!
//! Bu modül **tamamlayıcıdır, tek başına otorite değildir.** Katman sırası:
//!
//! 1. İş Yatırım resmi ekranı — fiyat ve günlük/haftalık/aylık/yıllık getiri.
//!    Düzeltilmiş seriden gelir ve BIST için nihai referanstır.
//! 2. Yahoo — mum grafiği ve göstergeler.
//! 3. Buradan gelen veri — yalnız **5 yıllık ve tüm zamanlık** getiri. Bu iki
//!    dönemin başka hiçbir ücretsiz kaynakta toplu karşılığı yok; İş Yatırım
//!    ekranında da kriteri bulunmuyor (16-20 arası yalnız günlük…YTD).
//!
//! Kısa dönem alanları bilerek **kullanılmaz**: aynı dönemi iki kaynaktan
//! okumak, hangisinin doğru olduğu belirsiz iki farklı sayı üretir. Otorite
//! İş Yatırım'da kalır.
//!
//! Tek POST 619 BIST payının tamamını döndürür; sembol başına istek yoktur.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Deserialize;

const SCAN_URL: &str = "https://scanner.tradingview.com/turkey/scan";

/// Önbellek ömrü. Veri gecikmeli ve uzun dönem getiriler gün içinde anlamlı
/// ölçüde değişmez; sık sormanın karşılığı yok.
const CACHE_TTL: Duration = Duration::from_secs(30 * 60);

/// Tek istekte istenen en fazla satır. BIST evreni 619; tavan bilinçli olarak
/// geniş bırakıldı ki yeni halka arzlarla liste büyüdüğünde sessizce kırpılmasın.
const MAX_ROWS: usize = 1500;

/// Bir payın uzun dönem getirileri.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct LongTermPerformance {
    /// 5 yıllık yüzde getiri.
    pub change_5y: Option<f64>,
    /// Listelenmeden bugüne yüzde getiri.
    pub change_all: Option<f64>,
}

#[derive(Deserialize)]
struct ScanResponse {
    #[serde(default)]
    data: Vec<ScanRow>,
}

#[derive(Deserialize)]
struct ScanRow {
    /// "BIST:THYAO" biçiminde sembol.
    #[serde(default)]
    s: String,
    /// İstenen kolonların değerleri, `COLUMNS` ile aynı sırada.
    #[serde(default)]
    d: Vec<serde_json::Value>,
}

/// İstenen kolonlar. Sıra yanıttaki dizi sırasını belirler; değiştirilirse
/// `parse_rows` içindeki indisler de değişmelidir.
const COLUMNS: &[&str] = &["name", "Perf.5Y", "Perf.All"];

type PerformanceMap = HashMap<String, LongTermPerformance>;

static CACHE: OnceLock<Mutex<Option<(Instant, PerformanceMap)>>> = OnceLock::new();
/// Tazeleme sırasını serileştirir; süre dolduğunda birden çok çağıran aynı anda
/// isteği tekrarlamasın.
static REFRESH_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

fn cached() -> Option<PerformanceMap> {
    let cache = CACHE.get_or_init(|| Mutex::new(None));
    let mut guard = cache.lock().unwrap_or_else(|error| error.into_inner());
    if guard.as_ref().is_some_and(|(at, _)| at.elapsed() < CACHE_TTL) {
        guard.as_ref().map(|(_, rows)| rows.clone())
    } else {
        *guard = None;
        None
    }
}

/// "BIST:THYAO" → "THYAO". Sembol öneki yoksa olduğu gibi döner.
fn strip_exchange(symbol: &str) -> &str {
    symbol.rsplit(':').next().unwrap_or(symbol)
}

fn number(value: Option<&serde_json::Value>) -> Option<f64> {
    value?.as_f64().filter(|v| v.is_finite())
}

/// Yanıt gövdesini getiri haritasına çevirir.
fn parse_rows(body: &str) -> Result<PerformanceMap, String> {
    let response: ScanResponse = serde_json::from_str(body)
        .map_err(|error| format!("TradingView yanıtı çözümlenemedi: {error}"))?;

    let mut map = PerformanceMap::new();
    for row in response.data {
        // Kod önce `name` kolonundan, o boşsa sembolden okunur.
        let ticker = row
            .d
            .first()
            .and_then(|value| value.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| strip_exchange(&row.s).to_string())
            .trim()
            .to_uppercase();
        if ticker.is_empty() {
            continue;
        }
        let performance = LongTermPerformance {
            change_5y: number(row.d.get(1)),
            change_all: number(row.d.get(2)),
        };
        // Her iki alan da boşsa kayıt taşımaya değmez.
        if performance.change_5y.is_some() || performance.change_all.is_some() {
            map.insert(ticker, performance);
        }
    }
    Ok(map)
}

async fn fetch(client: &reqwest::Client) -> Result<PerformanceMap, String> {
    let payload = serde_json::json!({
        "filter": [],
        "symbols": { "query": { "types": ["stock"] } },
        "columns": COLUMNS,
        "range": [0, MAX_ROWS],
    });

    let response = client
        .post(SCAN_URL)
        .timeout(Duration::from_secs(20))
        .header(reqwest::header::USER_AGENT, crate::yahoo::YAHOO_USER_AGENT)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("TradingView isteği: {error}"))?;

    let body = crate::retry::check_status(response, "TradingView")?
        .text()
        .await
        .map_err(|error| format!("TradingView gövdesi: {error}"))?;
    parse_rows(&body)
}

/// Uzun dönem getirileri döndürür; önbellekte tazesi varsa ağa gitmez.
///
/// Hata sessizce boş haritaya düşer: bu kaynak tamamlayıcıdır, düşmesi
/// senkronu başarısız saymaz.
pub async fn long_term_performance(client: &reqwest::Client) -> PerformanceMap {
    if let Some(rows) = cached() {
        return rows;
    }
    let _guard = REFRESH_LOCK.get_or_init(|| tokio::sync::Mutex::new(())).lock().await;
    if let Some(rows) = cached() {
        return rows;
    }

    match fetch(client).await {
        Ok(rows) if !rows.is_empty() => {
            *CACHE.get_or_init(|| Mutex::new(None))
                .lock()
                .unwrap_or_else(|error| error.into_inner()) = Some((Instant::now(), rows.clone()));
            rows
        }
        Ok(_) => PerformanceMap::new(),
        Err(error) => {
            eprintln!("TradingView uzun dönem getirileri alınamadı: {error}");
            PerformanceMap::new()
        }
    }
}

/// Uzun dönem getirileri evrenin üzerine işler; dolan satır sayısını döndürür.
///
/// Yalnız 5 yıllık ve tüm zamanlık alanlara dokunur — kısa dönemler İş
/// Yatırım'ın resmi değerlerinde kalır.
pub fn apply(equities: &mut [crate::domain::EquityRow], performance: &PerformanceMap) -> usize {
    let mut updated = 0;
    for equity in equities.iter_mut() {
        let Some(row) = performance.get(&equity.ticker) else { continue };
        if row.change_5y.is_none() && row.change_all.is_none() {
            continue;
        }
        equity.change_5y = row.change_5y.or(equity.change_5y);
        equity.change_all = row.change_all.or(equity.change_all);
        updated += 1;
    }
    updated
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::EquityRow;

    /// Yanıtın gerçek biçimi (2026-08-09 çekimi).
    #[test]
    fn parses_scanner_rows() {
        let body = r#"{"totalCount":2,"data":[
            {"s":"BIST:BTCIM","d":["BTCIM",1116.5508964587668,519125.9571273668]},
            {"s":"BIST:THYAO","d":["THYAO",null,4321.5]}
        ]}"#;
        let map = parse_rows(body).unwrap();
        assert_eq!(map.len(), 2);
        let btcim = map.get("BTCIM").unwrap();
        assert!((btcim.change_5y.unwrap() - 1116.5508964587668).abs() < 1e-9);
        assert!((btcim.change_all.unwrap() - 519125.9571273668).abs() < 1e-9);
        // Tek alanı boş olan kayıt düşmez; diğer alanı taşınır.
        let thyao = map.get("THYAO").unwrap();
        assert_eq!(thyao.change_5y, None);
        assert_eq!(thyao.change_all, Some(4321.5));
    }

    /// İki alanı da boş olan kayıt haritaya girmez.
    #[test]
    fn drops_rows_without_any_performance() {
        let body = r#"{"totalCount":1,"data":[{"s":"BIST:XXXXX","d":["XXXXX",null,null]}]}"#;
        assert!(parse_rows(body).unwrap().is_empty());
    }

    #[test]
    fn strips_exchange_prefix() {
        assert_eq!(strip_exchange("BIST:THYAO"), "THYAO");
        assert_eq!(strip_exchange("THYAO"), "THYAO");
    }

    /// Bozuk gövde hata döndürür; panik yok.
    #[test]
    fn malformed_body_is_an_error() {
        assert!(parse_rows("{bozuk").is_err());
    }

    /// Yalnız uzun dönem alanları yazılır; kısa dönem değerlerine dokunulmaz.
    #[test]
    fn apply_only_touches_long_term_fields() {
        let mut equities = vec![EquityRow {
            ticker: "THYAO".into(),
            change_pct: -1.61,
            change_1w: Some(-2.47),
            change_1y: Some(0.29),
            ..Default::default()
        }];
        let map = PerformanceMap::from([(
            "THYAO".to_string(),
            LongTermPerformance { change_5y: Some(250.0), change_all: Some(9000.0) },
        )]);

        assert_eq!(apply(&mut equities, &map), 1);
        assert_eq!(equities[0].change_5y, Some(250.0));
        assert_eq!(equities[0].change_all, Some(9000.0));
        // Otorite İş Yatırım'da: kısa dönemler değişmemeli.
        assert_eq!(equities[0].change_pct, -1.61);
        assert_eq!(equities[0].change_1w, Some(-2.47));
        assert_eq!(equities[0].change_1y, Some(0.29));
    }

    /// Haritada olmayan pay atlanır, eldeki değeri korunur.
    #[test]
    fn apply_skips_unknown_tickers() {
        let mut equities = vec![EquityRow {
            ticker: "YOKBU".into(),
            change_5y: Some(11.0),
            ..Default::default()
        }];
        assert_eq!(apply(&mut equities, &PerformanceMap::new()), 0);
        assert_eq!(equities[0].change_5y, Some(11.0));
    }

    /// Canlı: tüm BIST evreni tek istekte gelmeli ve getiriler makul olmalı.
    #[tokio::test]
    #[ignore = "requires live TradingView access"]
    async fn live_scanner_covers_the_universe() {
        let map = long_term_performance(&reqwest::Client::new()).await;
        assert!(map.len() > 400, "kapsam düşük: {}", map.len());

        let with_5y = map.values().filter(|p| p.change_5y.is_some()).count();
        let with_all = map.values().filter(|p| p.change_all.is_some()).count();
        println!("{} pay, {} tanesinde 5Y, {} tanesinde tüm zaman", map.len(), with_5y, with_all);
        assert!(with_all > map.len() / 2, "tüm zaman kapsamı düşük: {with_all}");

        // Hiçbir pay -%100'den fazla kaybedemez.
        for (ticker, performance) in &map {
            for (label, value) in [("5Y", performance.change_5y), ("tüm", performance.change_all)] {
                if let Some(value) = value {
                    assert!(value > -100.0, "{ticker} {label} imkânsız: {value}");
                }
            }
        }
        assert!(map.contains_key("THYAO"), "THYAO evrende olmalı");
    }
}
