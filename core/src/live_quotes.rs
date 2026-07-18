//! Gecikmeli canlı fiyat katmanı (BIST).
//!
//! Amaç, ağır senkrondan bağımsız, sık çağrılabilen ve **yalnızca fiyat**
//! döndüren bir uç sağlamaktır. Böylece açık hissenin fiyatı saniyeler
//! mertebesinde tazelenirken pano anlık görüntüsü (haberler, KAP, temel veriler,
//! göstergeler) yeniden çekilmez.
//!
//! Kaynak: İş Yatırım `IndexHistoricalAll` günlük serisi. Sağlayıcı seans içinde
//! serinin **son barını** canlı günceller; bir önceki bar da o günün önceki
//! kapanışıdır. Yani tek istek hem güncel fiyatı hem değişim yüzdesini verir.
//! Veri BIST kuralı gereği ~15 dakika gecikmelidir.
//!
//! Yahoo bilerek kullanılmaz: tüm evreni sık aralıklarla sorgulamak sağlayıcının
//! hız sınırına takılır ve semboller sessizce düşer.

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

/// Aynı anda gönderilen en fazla istek.
const CONCURRENCY: usize = 6;

/// Tek çağrıda sorulabilecek en fazla sembol; ekranda görünmeyen sembolleri
/// yoklamak sağlayıcıya gereksiz yük bindirir.
const MAX_SYMBOLS: usize = 32;

/// Gecikmeli canlı fiyat.
#[derive(Clone, Serialize)]
pub struct LiveQuote {
    pub ticker: String,
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
/// İstek bir kez yeniden denenir: İş Yatırım boştaki keep-alive bağlantılarını
/// reqwest'in havuz zaman aşımından (90 sn) çok daha erken kapatıyor. Yoklama
/// aralığı bu pencereye denk geldiğinden, havuzdaki ölü bağlantıyı seçen ilk
/// istek "error sending request" ile düşüyordu. GET idempotent olduğu için
/// yeniden denemek güvenlidir ve gerçek ağ dalgalanmalarını da örter.
async fn fetch_one(client: &reqwest::Client, code: &str) -> Result<LiveQuote, String> {
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
    let mut codes: Vec<String> = tickers.iter().map(|t| endeks_code(t)).collect();
    codes.sort();
    codes.dedup();
    codes.truncate(MAX_SYMBOLS);

    let mut quotes = Vec::new();
    let mut missing = Vec::new();
    for code in codes {
        match cached(&code) {
            Some(quote) => quotes.push(quote),
            None => missing.push(code),
        }
    }

    let gate = std::sync::Arc::new(tokio::sync::Semaphore::new(CONCURRENCY));
    let mut tasks = Vec::with_capacity(missing.len());
    for code in missing {
        let client = client.clone();
        let gate = gate.clone();
        tasks.push(tokio::spawn(async move {
            let _permit = gate.acquire().await.ok()?;
            fetch_one(&client, &code).await.ok()
        }));
    }

    for task in tasks {
        if let Ok(Some(quote)) = task.await {
            cache()
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .insert(quote.ticker.clone(), (Instant::now(), quote.clone()));
            quotes.push(quote);
        }
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


    /// Canlı uç: sağlayıcının son barı güncel fiyat, önceki bar önceki kapanış.
    #[tokio::test]
    #[ignore = "canlı ağ erişimi gerektirir"]
    async fn live_quote_has_price_and_change() {
        let client = reqwest::Client::new();
        let quotes = get_live_quotes(&client, &["THYAO".to_string(), "ASELS".to_string()]).await;
        assert_eq!(quotes.len(), 2, "iki sembol de dönmeli");
        for quote in quotes {
            assert!(quote.price > 0.0, "{} fiyatı pozitif olmalı", quote.ticker);
            assert!(quote.previous_close > 0.0, "{} önceki kapanış olmalı", quote.ticker);
            assert!(quote.change_pct.is_finite(), "{} değişimi sonlu olmalı", quote.ticker);
            println!("{}: {} ({:+.2}%)", quote.ticker, quote.price, quote.change_pct);
        }
    }
}
