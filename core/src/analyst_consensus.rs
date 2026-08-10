//! Analist konsensüsü: bir payı izleyen kurumların tavsiye dağılımı ve hedef
//! fiyatları.
//!
//! **Neden bu kaynak.** Küresel bankaların (JPMorgan, Goldman, Morgan Stanley,
//! HSBC…) BIST raporları kurumsal aboneliğe kapalıdır; kamuya açık akışları
//! yoktur. Bu yüzden `research_reports` arşivi yalnız yurt içi kurumların
//! yayımladığı raporları toplayabiliyor. Yurt dışı kurumların kapsamına
//! ulaşılabilen tek kamuya açık yüzey **konsensüs toplamlarıdır**: rapor
//! metnine değil, kaç kurumun AL/TUT/SAT dediğine ve ortalama hedef fiyata
//! erişilir. Bu modül o boşluğu doldurur.
//!
//! Tek POST bütün BIST evrenini döndürür (2026-08-09 ölçümü: 619 pay, 76'sında
//! analist kapsamı). Sembol başına istek yoktur.
//!
//! **Sınır.** Kapsam yalnız büyük kaplarda vardır; küçük paylarda boş dönmesi
//! hata değil, kurumların o payı izlemediğinin göstergesidir.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

const SCAN_URL: &str = "https://scanner.tradingview.com/turkey/scan";

/// Önbellek ömrü. Kurumlar tavsiyelerini gün içinde değiştirmez; sık sormanın
/// karşılığı yok.
const CACHE_TTL: Duration = Duration::from_secs(60 * 60);

/// Tek istekte istenen en fazla satır. Evren 619; tavan yeni halka arzlarla
/// liste büyüdüğünde sessizce kırpılmasın diye geniş bırakıldı.
const MAX_ROWS: usize = 1500;

/// İstenen kolonlar. Sıra yanıttaki dizi sırasını belirler; değiştirilirse
/// `parse_rows` içindeki indisler de değişmelidir.
const COLUMNS: &[&str] = &[
    "name",
    "recommendation_mark",
    "price_target_average",
    "price_target_high",
    "price_target_low",
    "recommendation_total",
    "recommendation_buy",
    "recommendation_hold",
    "recommendation_sell",
    "close",
];

/// Bir payı izleyen kurumların toplu görüşü.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct AnalystConsensus {
    pub ticker: String,
    /// Tavsiye ortalaması: 1 = hepsi AL, 2 = hepsi TUT, 3 = hepsi SAT.
    /// (Kaynak bunu AL=1/TUT=2/SAT=3 ağırlıklı ortalamasıyla üretir.)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mark: Option<f64>,
    /// `mark`ten türetilen Türkçe etiket ("Güçlü Al", "Tut"…).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rating: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_average: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_high: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_low: Option<f64>,
    /// Ortalama hedefin son fiyata göre yüzde getiri potansiyeli.
    /// Fiyat da hedefler de **aynı çekimden** gelir; uygulamanın başka yerinde
    /// gösterilen resmi fiyattan (İş Yatırım) küçük bir sapma olabilir.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upside: Option<f64>,
    /// Yukarıdaki oranın hesaplandığı fiyat.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_close: Option<f64>,
    /// Payı izleyen kurum sayısı ve tavsiye dağılımı.
    pub total: i64,
    pub buy: i64,
    pub hold: i64,
    pub sell: i64,
}

impl AnalystConsensus {
    /// Kayıt gösterilmeye değer mi. Kapsamı olmayan paylar listeyi şişirmesin.
    fn is_meaningful(&self) -> bool {
        self.total > 0 || self.target_average.is_some()
    }
}

/// `mark` değerini etikete çevirir. Eşikler 2.0 (tam TUT) çevresinde
/// simetriktir.
pub fn rating_label(mark: f64) -> &'static str {
    match mark {
        m if m < 1.5 => "Güçlü Al",
        m if m < 1.85 => "Al",
        m if m <= 2.15 => "Tut",
        m if m <= 2.5 => "Sat",
        _ => "Güçlü Sat",
    }
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

pub type ConsensusMap = HashMap<String, AnalystConsensus>;

static CACHE: OnceLock<Mutex<Option<(Instant, ConsensusMap)>>> = OnceLock::new();
/// Tazeleme sırasını serileştirir; süre dolduğunda birden çok çağıran aynı anda
/// isteği tekrarlamasın.
static REFRESH_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

fn cached() -> Option<ConsensusMap> {
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

fn count(value: Option<&serde_json::Value>) -> i64 {
    value.and_then(serde_json::Value::as_f64).filter(|v| v.is_finite()).unwrap_or(0.0) as i64
}

/// Yanıt gövdesini konsensüs haritasına çevirir.
fn parse_rows(body: &str) -> Result<ConsensusMap, String> {
    let response: ScanResponse = serde_json::from_str(body)
        .map_err(|error| format!("Konsensüs yanıtı çözümlenemedi: {error}"))?;

    let mut map = ConsensusMap::new();
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

        let mark = number(row.d.get(1));
        let target_average = number(row.d.get(2));
        let last_close = number(row.d.get(9)).filter(|price| *price > 0.0);
        let upside = match (target_average, last_close) {
            (Some(target), Some(price)) => Some((target - price) / price * 100.0),
            _ => None,
        };

        let record = AnalystConsensus {
            ticker: ticker.clone(),
            mark,
            rating: mark.map(|m| rating_label(m).to_string()),
            target_average,
            target_high: number(row.d.get(3)),
            target_low: number(row.d.get(4)),
            upside,
            last_close,
            total: count(row.d.get(5)),
            buy: count(row.d.get(6)),
            hold: count(row.d.get(7)),
            sell: count(row.d.get(8)),
        };

        if record.is_meaningful() {
            map.insert(ticker, record);
        }
    }
    Ok(map)
}

async fn fetch(client: &reqwest::Client) -> Result<ConsensusMap, String> {
    let payload = serde_json::json!({
        "filter": [{ "left": "type", "operation": "equal", "right": "stock" }],
        "markets": ["turkey"],
        "symbols": { "query": { "types": [] } },
        "columns": COLUMNS,
        "range": [0, MAX_ROWS],
    });

    let response = client
        .post(SCAN_URL)
        .timeout(Duration::from_secs(25))
        .header(reqwest::header::USER_AGENT, crate::yahoo::YAHOO_USER_AGENT)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("Konsensüs isteği: {error}"))?;

    let body = crate::retry::check_status(response, "Analist konsensüsü")?
        .text()
        .await
        .map_err(|error| format!("Konsensüs gövdesi: {error}"))?;
    parse_rows(&body)
}

/// Bütün evrenin konsensüsünü döndürür; önbellekte tazesi varsa ağa gitmez.
///
/// Hata sessizce boş haritaya düşer: bu kaynak tamamlayıcıdır, düşmesi rapor
/// ekranını başarısız saymaz.
pub async fn load(client: &reqwest::Client) -> ConsensusMap {
    if let Some(rows) = cached() {
        return rows;
    }
    let _guard = REFRESH_LOCK.get_or_init(|| tokio::sync::Mutex::new(())).lock().await;
    if let Some(rows) = cached() {
        return rows;
    }

    match fetch(client).await {
        Ok(rows) if !rows.is_empty() => {
            *CACHE
                .get_or_init(|| Mutex::new(None))
                .lock()
                .unwrap_or_else(|error| error.into_inner()) = Some((Instant::now(), rows.clone()));
            rows
        }
        Ok(_) => ConsensusMap::new(),
        Err(error) => {
            eprintln!("Analist konsensüsü alınamadı: {error}");
            ConsensusMap::new()
        }
    }
}

/// Önbelleği düşürür; sıradaki `load` ağa gider.
///
/// Ekrandaki "Yenile" düğmesi için: kullanıcı elle tazeleme istediğinde rapor
/// arşivi yenilenip konsensüsün bir saat daha eski veride kalması tutarsız
/// olurdu.
pub fn invalidate() {
    *CACHE.get_or_init(|| Mutex::new(None)).lock().unwrap_or_else(|error| error.into_inner()) = None;
}

/// Tek bir payın konsensüsü.
pub async fn for_ticker(client: &reqwest::Client, ticker: &str) -> Option<AnalystConsensus> {
    // Sağlayıcı eki büyük/küçük harfli gelebilir; önce büyütülür sonra atılır.
    let upper = ticker.trim().to_uppercase();
    let code = upper.trim_end_matches(".IS");
    if code.is_empty() {
        return None;
    }
    load(client).await.get(code).cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Yanıtın gerçek biçimi (2026-08-09 çekimi).
    const SAMPLE: &str = r#"{"totalCount":3,"data":[
        {"s":"BIST:THYAO","d":["THYAO",1.2,443.35,580,330,10,8,2,0,306.25]},
        {"s":"BIST:ASELS","d":["ASELS",1.571429,443.428571,495,387,7,3,4,0,353.75]},
        {"s":"BIST:XXXXX","d":["XXXXX",null,null,null,null,0,0,0,0,12.5]}
    ]}"#;

    #[test]
    fn parses_consensus_rows() {
        let map = parse_rows(SAMPLE).expect("çözümlenmeli");
        // Kapsamı olmayan pay listeye girmez.
        assert_eq!(map.len(), 2);

        let thyao = map.get("THYAO").expect("THYAO olmalı");
        assert_eq!(thyao.total, 10);
        assert_eq!((thyao.buy, thyao.hold, thyao.sell), (8, 2, 0));
        assert_eq!(thyao.target_high, Some(580.0));
        assert_eq!(thyao.rating.as_deref(), Some("Güçlü Al"));
        // (443.35 - 306.25) / 306.25 = %44.77
        let upside = thyao.upside.expect("getiri potansiyeli hesaplanmalı");
        assert!((upside - 44.767).abs() < 0.01, "beklenmeyen oran: {upside}");
    }

    #[test]
    fn mark_is_the_buy_hold_sell_weighted_mean() {
        // ASELS: (3*1 + 4*2 + 0*3) / 7 = 1.571…  → kaynağın ölçeği doğrulanır.
        let map = parse_rows(SAMPLE).expect("çözümlenmeli");
        let asels = map.get("ASELS").expect("ASELS olmalı");
        let expected = (3.0 * 1.0 + 4.0 * 2.0) / 7.0;
        assert!((asels.mark.unwrap() - expected).abs() < 0.001);
        assert_eq!(asels.rating.as_deref(), Some("Al"));
    }

    #[test]
    fn rating_thresholds_are_symmetric_around_hold() {
        assert_eq!(rating_label(1.0), "Güçlü Al");
        assert_eq!(rating_label(1.6), "Al");
        assert_eq!(rating_label(2.0), "Tut");
        assert_eq!(rating_label(2.4), "Sat");
        assert_eq!(rating_label(2.9), "Güçlü Sat");
    }

    #[test]
    fn malformed_body_is_an_error() {
        assert!(parse_rows("bu json değil").is_err());
    }

    /// Ön yüz sözleşmesi: `src/types.ts` içindeki `AnalystConsensus` bu alan
    /// adlarını okur. Yeniden adlandırma ekranı sessizce boşaltır.
    #[test]
    fn serializes_with_the_field_names_the_ui_reads() {
        let map = parse_rows(SAMPLE).expect("çözümlenmeli");
        let json = serde_json::to_value(map.get("THYAO").unwrap()).expect("serileşmeli");
        for field in [
            "ticker",
            "mark",
            "rating",
            "target_average",
            "target_high",
            "target_low",
            "upside",
            "last_close",
            "total",
            "buy",
            "hold",
            "sell",
        ] {
            assert!(json.get(field).is_some(), "{field} alanı JSON'da yok");
        }
    }

    /// Kapsamı olmayan pay için isteğe bağlı alanlar hiç yazılmaz; ekran
    /// `null` ile `yok` arasında ayrım yapmak zorunda kalmaz.
    #[test]
    fn empty_optionals_are_omitted() {
        let row = AnalystConsensus { ticker: "AAA".into(), total: 2, ..Default::default() };
        let json = serde_json::to_value(&row).expect("serileşmeli");
        assert!(json.get("target_average").is_none());
        assert!(json.get("rating").is_none());
        assert_eq!(json.get("total").and_then(serde_json::Value::as_i64), Some(2));
    }

    #[test]
    fn missing_close_leaves_upside_empty() {
        let body = r#"{"data":[{"s":"BIST:AAA","d":["AAA",1.0,100.0,110,90,2,2,0,0,null]}]}"#;
        let map = parse_rows(body).expect("çözümlenmeli");
        let row = map.get("AAA").expect("AAA olmalı");
        assert_eq!(row.upside, None);
        assert_eq!(row.target_average, Some(100.0));
    }

    /// Uç canlı mı ve evreni kapsıyor mu.
    #[tokio::test]
    #[ignore = "ağ gerektirir"]
    async fn live_scanner_returns_coverage() {
        let client = reqwest::Client::new();
        let map = fetch(&client).await.expect("uç yanıt vermeli");
        assert!(map.len() > 30, "beklenenden az kapsam: {}", map.len());
        let covered = map.values().filter(|row| row.total > 0).count();
        assert!(covered > 20, "analist kapsamı olan pay az: {covered}");
    }
}
