//! Enstrüman türüne göre yönlendirilen canlı fiyat katmanı.
//!
//! Amaç, ağır senkrondan bağımsız, sık çağrılabilen ve **yalnızca fiyat**
//! döndüren bir uç sağlamaktır. Böylece açık hissenin fiyatı saniyeler
//! mertebesinde tazelenirken pano anlık görüntüsü (haberler, KAP, temel veriler,
//! göstergeler) yeniden çekilmez.
//!
//! BIST paylarının kaynağı İş Yatırım `IndexHistoricalAll` günlük serisidir. Sağlayıcı seans içinde
//! serinin **son barını** canlı günceller; bir önceki bar da o günün önceki
//! kapanışıdır. Yani tek istek hem güncel fiyatı hem değişim yüzdesini verir.
//! Veri BIST kuralı gereği ~15 dakika gecikmelidir.
//!
//! Global hisse, endeks, döviz, emtia ve kripto ise Yahoo'nun kanonik sembol
//! yolundan gelir. Böylece BIST kodu olmayan bir enstrüman yanlışlıkla İş
//! Yatırım'a gönderilip ilk açılıştaki fiyatında donmaz.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use chrono::Utc;
use serde::Serialize;

const HISTORY_URL: &str =
    "https://www.isyatirim.com.tr/_Layouts/15/IsYatirim.Website/Common/ChartData.aspx/IndexHistoricalAll";

/// Fiyat önbelleğinin ömrü. Veri zaten ~15 dk gecikmeli olduğundan daha sık
/// sormanın karşılığı yok; birden çok bileşen aynı sembolü isterse tek istek
/// yeterli olur.
const CACHE_TTL: Duration = Duration::from_secs(20);

/// Başarısız bir sembolün yeniden denenmeden önce bekletildiği en kısa süre.
///
/// Sağlayıcıda karşılığı olmayan bir sembol (yanlış kod, kotasyondan kalkmış
/// hisse) negatif önbellek olmadan **her yoklamada** yeniden isteniyordu — üstelik
/// bağlantı hatası yeniden denemesiyle iki istek olarak. Ekran açık kaldığı
/// sürece sonuç değişmeyecek bir istek dakikada dörder kez tekrarlanıyordu.
///
/// Süre kısa tutulur: geçici bir ağ kesintisinden sonra fiyatın uzun süre donuk
/// kalması kullanıcıya kalıcı hatadan daha çok zarar verir.
const FAILURE_BACKOFF: Duration = Duration::from_secs(60);

/// Üst üste hata biriktikçe bekleme bu tavana kadar iki katına çıkar. Gerçekten
/// çözülmeyen sembol birkaç turda seyrek yoklamaya iner; geçici hata ise ilk
/// denemede zaten toparlanır.
const FAILURE_BACKOFF_MAX: Duration = Duration::from_secs(10 * 60);

/// Aynı anda gönderilen en fazla istek.
const CONCURRENCY: usize = 6;

/// Tek çağrıda sorulabilecek en fazla sembol; ekranda görünmeyen sembolleri
/// yoklamak sağlayıcıya gereksiz yük bindirir.
const MAX_SYMBOLS: usize = 32;

/// Gecikmeli canlı fiyat.
#[derive(Clone, Serialize)]
pub struct LiveQuote {
    pub ticker: String,
    /// Fiyatın geldiği gerçek sağlayıcı. İstemci bunu gözlenebilirlik için
    /// gösterir; tüm varlıkları tek sağlayıcıdan geliyormuş gibi varsaymaz.
    pub source: String,
    /// Sağlayıcının ilan edilen yaklaşık gecikmesi. `None`, gecikmesiz olduğu
    /// iddiası değil; sabit bir gecikme taahhüdü bulunmadığı anlamına gelir.
    pub delay_seconds: Option<u64>,
    /// Sağlayıcının verdiği en güncel fiyat.
    pub price: f64,
    /// Bir önceki seansın kapanışı.
    pub previous_close: f64,
    /// Önceki kapanışa göre yüzde değişim.
    pub change_pct: f64,
    /// Son barın zaman damgası (saniye, unix).
    pub as_of_ts: i64,
}

#[derive(serde::Deserialize)]
struct HistoryEnvelope {
    /// [zaman damgası (ms), kapanış]; tatil/eksik günlerde kapanış null olabilir.
    data: Vec<(i64, Option<f64>)>,
}

static CACHE: OnceLock<Mutex<HashMap<String, (Instant, LiveQuote)>>> = OnceLock::new();

fn cache() -> &'static Mutex<HashMap<String, (Instant, LiveQuote)>> {
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Fiyatı alınamayan sembol: son deneme anı ve üst üste hata sayısı.
static FAILURES: OnceLock<Mutex<HashMap<String, (Instant, u32)>>> = OnceLock::new();

fn failures() -> &'static Mutex<HashMap<String, (Instant, u32)>> {
    FAILURES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// `strikes` ardışık hatadan sonra beklenecek süre (üstel, tavanlı).
fn backoff(strikes: u32) -> Duration {
    FAILURE_BACKOFF
        .saturating_mul(2u32.saturating_pow(strikes.saturating_sub(1).min(8)))
        .min(FAILURE_BACKOFF_MAX)
}

/// Sembolün bekleme süresi dolmadıysa `true`; bu turda hiç istenmez.
fn recently_failed(code: &str) -> bool {
    let guard = failures().lock().unwrap_or_else(|error| error.into_inner());
    guard
        .get(code)
        .is_some_and(|(at, strikes)| at.elapsed() < backoff(*strikes))
}

fn mark_failed(code: &str) {
    let mut guard = failures().lock().unwrap_or_else(|error| error.into_inner());
    let strikes = guard.get(code).map_or(1, |(_, strikes)| strikes.saturating_add(1));
    guard.insert(code.to_string(), (Instant::now(), strikes));
}

fn mark_succeeded(code: &str) {
    failures()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .remove(code);
}

/// "THYAO.IS" → "THYAO"; İş Yatırım kodu `.IS` eki taşımaz.
fn endeks_code(ticker: &str) -> String {
    ticker.trim().trim_end_matches(".IS").to_uppercase()
}

fn cached(code: &str) -> Option<LiveQuote> {
    let guard = cache().lock().unwrap_or_else(|error| error.into_inner());
    guard
        .get(code)
        .filter(|(fetched_at, _)| fetched_at.elapsed() < CACHE_TTL)
        .map(|(_, quote)| quote.clone())
}

/// Tek sembolün gecikmeli fiyatını çeker.
///
/// İstek bir kez yeniden denenir. Asıl neden — reqwest'in 90 sn'lik havuz zaman
/// aşımının İş Yatırım'ın erken kapattığı keep-alive bağlantılarını ölü olarak
/// havuzda tutması — `AppState`'teki `pool_idle_timeout` ayarıyla kaynağında
/// giderildi; yeniden deneme gerçek ağ dalgalanmalarına karşı korunuyor. GET
/// idempotent olduğundan güvenlidir.
async fn fetch_one_bist(client: &reqwest::Client, code: &str) -> Result<LiveQuote, String> {
    // Son barın yanında bir önceki kapanışın da gelmesi gerekir; tatil ve hafta
    // sonu boşluklarını aşmak için iki haftalık pencere alınır.
    let now = Utc::now();
    let from = now - chrono::Duration::days(14);
    let url = format!(
        "{HISTORY_URL}?period=1440&from={}&to={}&endeks={code}",
        from.format("%Y%m%d000000"),
        now.format("%Y%m%d%H%M%S"),
    );

    let send = || async {
        client
            .get(&url)
            .timeout(Duration::from_secs(10))
            .header("User-Agent", crate::yahoo::YAHOO_USER_AGENT)
            .header(
                "Referer",
                "https://www.isyatirim.com.tr/tr-tr/analiz/hisse/Sayfalar/sirket-karti.aspx",
            )
            .send()
            .await
    };

    let response = match send().await {
        Ok(response) => response,
        // Bağlantı düştü: havuz bayat bağlantıyı atar, ikinci deneme yenisini açar.
        Err(_) => send()
            .await
            .map_err(|error| format!("İş Yatırım canlı fiyat isteği ({code}): {error}"))?,
    };

    let envelope = response
        .error_for_status()
        .map_err(|error| format!("İş Yatırım canlı fiyat yanıtı ({code}): {error}"))?
        .json::<HistoryEnvelope>()
        .await
        .map_err(|error| format!("İş Yatırım canlı fiyat çözümlenemedi ({code}): {error}"))?;

    let mut bars: Vec<(i64, f64)> = envelope
        .data
        .into_iter()
        .filter_map(|(millis, close)| {
            let close = close?;
            (close.is_finite() && close > 0.0).then_some((millis / 1000, close))
        })
        .collect();
    bars.sort_by_key(|(time, _)| *time);
    bars.dedup_by_key(|(time, _)| *time);

    // Son bar güncel (canlı) fiyat, bir önceki bar önceki kapanış.
    let (as_of_ts, price) = *bars.last().ok_or(format!("{code}: fiyat verisi yok"))?;
    let previous_close = bars.get(bars.len().wrapping_sub(2)).map(|(_, c)| *c).unwrap_or(price);
    let change_pct = if previous_close > 0.0 {
        (price - previous_close) / previous_close * 100.0
    } else {
        0.0
    };

    Ok(LiveQuote {
        ticker: code.to_string(),
        source: "İş Yatırım".into(),
        delay_seconds: Some(15 * 60),
        price,
        previous_close,
        change_pct,
        as_of_ts,
    })
}

/// Verilen sembollerin gecikmeli fiyatlarını döndürür.
///
/// Önbellekte tazesi olanlar ağa gitmeden döner. Alınamayan semboller sonuçtan
/// düşer; çağıran eldeki değeri korur, böylece tek bir hata şeridi boşaltmaz.
pub async fn get_live_quotes(client: &reqwest::Client, tickers: &[String]) -> Vec<LiveQuote> {
    let mut codes: Vec<String> = tickers.iter().map(|ticker| crate::yahoo::canonical_ticker(ticker)).collect();
    codes.sort();
    codes.dedup();
    codes.truncate(MAX_SYMBOLS);

    let mut quotes = Vec::new();
    let mut missing = Vec::new();
    for code in codes {
        match cached(&code) {
            Some(quote) => quotes.push(quote),
            // Yakın zamanda alınamamış sembol bu turda hiç istenmez.
            None if recently_failed(&code) => {}
            None => missing.push(code),
        }
    }

    let (bist_missing, market_missing): (Vec<String>, Vec<String>) = missing
        .into_iter()
        .partition(|code| crate::yahoo::is_bist_equity_symbol(code));

    let gate = std::sync::Arc::new(tokio::sync::Semaphore::new(CONCURRENCY));
    let mut tasks = Vec::with_capacity(bist_missing.len());
    for code in bist_missing {
        let client = client.clone();
        let gate = gate.clone();
        tasks.push(tokio::spawn(async move {
            let _permit = gate.acquire().await.ok()?;
            let quote = fetch_one_bist(&client, &endeks_code(&code)).await.ok();
            Some((code, quote))
        }));
    }

    for task in tasks {
        let Ok(Some((code, quote))) = task.await else { continue };
        let Some(quote) = quote else {
            mark_failed(&code);
            continue;
        };
        mark_succeeded(&code);
        cache()
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(quote.ticker.clone(), (Instant::now(), quote.clone()));
        quotes.push(quote);
    }

    let market_quotes = crate::yahoo::fetch_market_quotes(client, &market_missing).await;
    for code in &market_missing {
        if market_quotes.iter().any(|quote| quote.symbol == *code) {
            mark_succeeded(code);
        } else {
            mark_failed(code);
        }
    }

    for quote in market_quotes {
        if quote.price <= 0.0 || quote.previous_close <= 0.0 {
            continue;
        }
        let live = LiveQuote {
            ticker: quote.symbol,
            source: "Yahoo Finance".into(),
            delay_seconds: None,
            price: quote.price,
            previous_close: quote.previous_close,
            change_pct: (quote.price - quote.previous_close) / quote.previous_close * 100.0,
            as_of_ts: quote.as_of_ts.unwrap_or_else(|| Utc::now().timestamp()),
        };
        cache()
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(live.ticker.clone(), (Instant::now(), live.clone()));
        quotes.push(live);
    }

    quotes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_exchange_suffix() {
        assert_eq!(endeks_code("THYAO.IS"), "THYAO");
        assert_eq!(endeks_code(" thyao "), "THYAO");
        assert_eq!(endeks_code("ASELS"), "ASELS");
    }

    /// Tek bir hata sembolü uzun süre karartmamalı; ısrar eden hata ise tavana
    /// kadar seyrelmeli.
    #[test]
    fn failure_backoff_starts_short_and_saturates() {
        assert_eq!(backoff(1), FAILURE_BACKOFF);
        assert_eq!(backoff(2), FAILURE_BACKOFF * 2);
        assert_eq!(backoff(3), FAILURE_BACKOFF * 4);
        assert_eq!(backoff(9), FAILURE_BACKOFF_MAX, "tavan aşılmamalı");
        assert_eq!(backoff(u32::MAX), FAILURE_BACKOFF_MAX, "taşma olmamalı");
        // İlk hata hiç beklemesiz sayılmamalı (aksi halde negatif önbellek işe yaramaz).
        assert!(backoff(0) >= FAILURE_BACKOFF);
    }

    /// Başarı sayacı sıfırlamalı: geçici kesinti sonrası sembol tam hızda döner.
    #[test]
    fn success_clears_failure_state() {
        let code = "TEST_CLEARS";
        mark_failed(code);
        assert!(recently_failed(code), "yeni hata beklemede olmalı");
        mark_succeeded(code);
        assert!(!recently_failed(code), "başarı beklemeyi kaldırmalı");
    }


    /// Canlı uç: sağlayıcının son barı güncel fiyat, önceki bar önceki kapanış.
    #[tokio::test]
    #[ignore = "canlı ağ erişimi gerektirir"]
    async fn live_quote_has_price_and_change() {
        let client = reqwest::Client::new();
        let quotes = get_live_quotes(&client, &["THYAO".to_string(), "ASELS".to_string()]).await;
        assert_eq!(quotes.len(), 2, "iki sembol de dönmeli");
        for quote in quotes {
            assert_eq!(quote.source, "İş Yatırım");
            assert_eq!(quote.delay_seconds, Some(15 * 60));
            assert!(quote.price > 0.0, "{} fiyatı pozitif olmalı", quote.ticker);
            assert!(quote.previous_close > 0.0, "{} önceki kapanış olmalı", quote.ticker);
            assert!(quote.change_pct.is_finite(), "{} değişimi sonlu olmalı", quote.ticker);
            println!("{}: {} ({:+.2}%)", quote.ticker, quote.price, quote.change_pct);
        }
    }

    #[tokio::test]
    #[ignore = "canlı ağ erişimi gerektirir"]
    async fn live_quote_routes_crypto_and_commodity_to_yahoo() {
        let client = reqwest::Client::new();
        let quotes = get_live_quotes(
            &client,
            &[
                "BTC-USD".into(),
                "CL=F".into(),
                "GRAM ALTIN".into(),
                "XU100.IS".into(),
            ],
        ).await;
        assert_eq!(quotes.len(), 4);
        assert!(quotes.iter().any(|quote| quote.ticker == "XU100"));
        assert!(quotes.iter().all(|quote| {
            quote.source == "Yahoo Finance" && quote.delay_seconds.is_none()
        }));
        assert!(quotes.iter().all(|quote| quote.price > 0.0 && quote.previous_close > 0.0));
    }
}
