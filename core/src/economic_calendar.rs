//! Türkiye ekonomik takvimi — TradingEconomics HTML tablosundan keysiz çekim.
//! Haftalık takvim sayfasından yaklaşan makroekonomik olayları (TCMB faiz
//! kararı, TÜFE, işsizlik, GSYİH vb.) ayrıştırır.
//!
//! DAYANIKLILIK — takvim tek bir sayfanın erişilebilirliğine bağlı kalmasın:
//!
//! 1. **Birden çok kaynak.** Ülke sayfası birincildir (ölçüldü: 35 Türkiye
//!    satırı); erişilemezse genel takvim sayfası denenir (12 satır). İkisi de
//!    `data-country="turkey"` işaretlemesini taşıdığı için AYNI ayrıştırıcı
//!    çalışır — ikinci bir parser bakımı gerekmez.
//! 2. **Yeniden deneme.** Geçici hatalarda (ağ kesintisi, 429, 5xx) kısa bir
//!    beklemeyle bir kez daha denenir; kalıcı hatalarda (404 gibi) beklemeden
//!    sıradaki kaynağa geçilir.
//! 3. **Diskte kalıcı önbellek.** Son başarılı çekim diske yazılır; uygulama
//!    yeniden açıldığında takvim ağ beklemeden dolu gelir.
//! 4. **Hata anında bayat veri.** Tüm kaynaklar düşerse boş liste DEĞİL, son
//!    bilinen takvim döner. Eski davranışta ekran tamamen boşalıyordu; bayat
//!    ama doğru bir takvim, hiç takvim olmamasından iyidir.

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use regex::Regex;
use scraper::{ElementRef, Html, Selector};
use serde::{Deserialize, Serialize};

/// Kaynaklar öncelik sırasıyla. İlki daha zengindir; ikincisi aynı
/// işaretlemeyi taşıyan genel takvimdir (ölçüm: 2026-08-13).
const CALENDAR_SOURCES: [&str; 2] = [
    "https://tradingeconomics.com/turkey/calendar",
    "https://tradingeconomics.com/calendar",
];
/// Satır bağlantıları göreli (`/turkey/current-account`) geldiği için kök gerekir.
const SITE_ROOT: &str = "https://tradingeconomics.com";
/// Gösterge sayfası bulunamayan satırların düştüğü genel takvim.
const FALLBACK_SOURCE_URL: &str = CALENDAR_SOURCES[0];
const CACHE_TTL_SECS: i64 = 6 * 60 * 60; // 6 saat
const CACHE_FILE: &str = "economic_calendar.json";
/// Geçici hatada tek bir yeniden deneme; kaynak başına toplam iki istek.
const RETRY_DELAY: Duration = Duration::from_millis(800);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// Etki seviyesi — frontend bunu renk/ikon için kullanır.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Impact {
    High,
    Medium,
    Low,
}

/// Tek bir ekonomik takvim etkinliği.
#[derive(Clone, Serialize, Deserialize)]
pub struct EconomicEvent {
    /// ISO 8601 tarih (YYYY-MM-DD).
    pub date: String,
    /// Yerel saat (ör. "11:00 AM") veya boş.
    pub time: String,
    /// Etkinlik adı (ör. "TCMB Interest Rate Decision").
    pub event: String,
    /// Kategori (ör. "interest rate", "inflation rate").
    pub category: String,
    /// Gerçekleşen değer (henüz açıklanmamışsa boş).
    pub actual: String,
    /// Önceki değer.
    pub previous: String,
    /// Piyasa beklentisi.
    pub consensus: String,
    /// Model tahmini.
    pub forecast: String,
    /// Etki seviyesi.
    pub impact: Impact,
    /// Göstergenin kaynak sayfası (TradingEconomics). Satır bir gösterge
    /// sayfasına bağlanmıyorsa takvimin kendisine düşülür.
    ///
    /// `default`: alan eklenmeden önce yazılmış disk önbelleği hâlâ okunabilsin
    /// diye — aksi hâlde eski dosya çözümlenemez ve takvim boş açılırdı.
    #[serde(default)]
    pub source_url: String,
}

/// Etki seviyesini `data-category` değerinden çıkarır. Buradaki adlar
/// TradingEconomics'in kategori sözlüğünden gelir ve `data-event` adlarından
/// farklıdır (ör. kategori "producer prices change", olay "ppi yoy").
fn category_impact(category: &str) -> Impact {
    match category {
        "interest rate" | "lending rate" | "deposit interest rate"
        | "inflation rate" | "inflation rate mom"
        | "core inflation rate" | "core inflation rate mom"
        | "gdp growth rate" | "gdp annual growth rate"
        | "unemployment rate" | "current account"
        | "balance of trade" => Impact::High,

        "business confidence" | "consumer confidence"
        | "capacity utilization" | "retail sales yoy" | "retail sales mom"
        | "industrial production" | "industrial production mom"
        | "manufacturing pmi" | "economic optimism index"
        | "government budget value" | "foreign exchange reserves"
        | "labor force participation rate"
        | "producer prices change" | "producer price inflation mom"
        | "exports" | "imports" => Impact::Medium,

        _ => Impact::Low,
    }
}

/// Göreli takvim bağlantısını mutlak adrese çevirir; zaten mutlak olanı
/// olduğu gibi bırakır (kaynak sayfa biçimi değişirse diye).
fn absolute_url(href: &str) -> String {
    let href = href.trim();
    if href.starts_with("http://") || href.starts_with("https://") {
        return href.to_string();
    }
    format!("{SITE_ROOT}/{}", href.trim_start_matches('/'))
}

/// Bir elemanın metnini boşlukları sadeleştirerek döndürür.
fn text_of(element: ElementRef<'_>) -> String {
    element.text().collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ")
}

/// TradingEconomics HTML'inden etkinlikleri çıkarır.
///
/// Satırlar HTML olarak ayrıştırılır; her takvim satırının içinde bayrak için
/// iç içe bir `<table>` bulunduğundan metin üzerinde `</tr>`'ye kadar eşleşen
/// bir regex satırı erken keser ve değer hücrelerini ıskalar.
fn parse_calendar_html(html: &str) -> Vec<EconomicEvent> {
    let document = Html::parse_document(html);

    // İç içe bayrak tablosunun <tr>'si data-category taşımadığı için eşleşmez.
    let row_sel = Selector::parse(r#"tr[data-country="turkey"][data-category]"#).unwrap();
    let td_sel = Selector::parse("td").unwrap();
    let time_sel = Selector::parse(r#"span[class*="calendar-date-"]"#).unwrap();
    let actual_sel = Selector::parse("#actual").unwrap();
    let previous_sel = Selector::parse("#previous").unwrap();
    let consensus_sel = Selector::parse("#consensus").unwrap();
    let forecast_sel = Selector::parse("#forecast").unwrap();
    // Satırın `data-url`'i yoksa olay adındaki bağlantıya düşülür.
    let event_link_sel = Selector::parse("a.calendar-event").unwrap();

    // Tarih ilk hücrenin class'ında taşınır: class=' 2026-07-23'
    let date_re = Regex::new(r"\b(\d{4}-\d{2}-\d{2})\b").unwrap();

    let mut events = Vec::new();

    for row in document.select(&row_sel) {
        let category = row.value().attr("data-category").unwrap_or_default().to_string();
        let event_name = row.value().attr("data-event").unwrap_or_default();

        let first_td = row.select(&td_sel).next();
        let date = first_td
            .and_then(|td| td.value().attr("class"))
            .and_then(|class| date_re.captures(class))
            .map(|caps| caps[1].to_string())
            .unwrap_or_default();

        if date.is_empty() {
            continue;
        }

        let time = first_td
            .and_then(|td| td.select(&time_sel).next())
            .map(text_of)
            .unwrap_or_default();

        let cell = |selector: &Selector| row.select(selector).next().map(text_of).unwrap_or_default();

        let impact = category_impact(&category);

        // Göstergenin kendi sayfası: önce satırın `data-url`'i, yoksa olay
        // adındaki bağlantı. İkisi de yoksa takvim sayfasına düşülür ki
        // tıklama her satırda bir yere gitsin.
        let source_url = row
            .value()
            .attr("data-url")
            .filter(|href| !href.trim().is_empty())
            .or_else(|| {
                row.select(&event_link_sel)
                    .next()
                    .and_then(|a| a.value().attr("href"))
                    .filter(|href| !href.trim().is_empty())
            })
            .map(absolute_url)
            .unwrap_or_else(|| FALLBACK_SOURCE_URL.to_string());

        events.push(EconomicEvent {
            date,
            time,
            event: titlecase_event(event_name),
            category,
            actual: cell(&actual_sel),
            previous: cell(&previous_sel),
            consensus: cell(&consensus_sel),
            forecast: cell(&forecast_sel),
            impact,
            source_url,
        });
    }

    events
}

/// "tcmb interest rate decision" → "TCMB Faiz Kararı" vb. bilinen çevirileri uygular,
/// bilinmeyenler için basit title-case döner.
fn titlecase_event(raw: &str) -> String {
    // Bilinen çeviriler
    let tr = match raw.trim().to_lowercase().as_str() {
        "tcmb interest rate decision" => return "TCMB Faiz Kararı".into(),
        "overnight borrowing rate" => return "Gecelik Borçlanma Faizi".into(),
        "overnight lending rate" => return "Gecelik Borç Verme Faizi".into(),
        "inflation rate" | "inflation rate yoy" => return "Enflasyon (TÜFE) Yıllık".into(),
        "inflation rate mom" => return "Enflasyon (TÜFE) Aylık".into(),
        "core inflation rate" => return "Çekirdek Enflasyon Yıllık".into(),
        "core inflation rate mom" => return "Çekirdek Enflasyon Aylık".into(),
        "ppi" | "ppi yoy" => return "Üretici Fiyatları (ÜFE) Yıllık".into(),
        "ppi mom" => return "Üretici Fiyatları (ÜFE) Aylık".into(),
        "unemployment rate" => return "İşsizlik Oranı".into(),
        "participation rate" => return "İşgücüne Katılım Oranı".into(),
        "gdp growth rate" => return "GSYİH Büyümesi (Çeyreklik)".into(),
        "gdp annual growth rate" => return "GSYİH Büyümesi (Yıllık)".into(),
        "current account" => return "Cari İşlemler Dengesi".into(),
        "balance of trade" | "balance of trade final" => return "Dış Ticaret Dengesi".into(),
        "balance of trade prel" => return "Dış Ticaret Dengesi (Öncü)".into(),
        "exports final" => return "İhracat".into(),
        "exports prel" => return "İhracat (Öncü)".into(),
        "imports final" => return "İthalat".into(),
        "imports prel" => return "İthalat (Öncü)".into(),
        "consumer confidence" => return "Tüketici Güven Endeksi".into(),
        "business confidence" => return "İş Güven Endeksi".into(),
        "capacity utilization" => return "Kapasite Kullanım Oranı".into(),
        "retail sales yoy" => return "Perakende Satışlar (Yıllık)".into(),
        "retail sales mom" => return "Perakende Satışlar (Aylık)".into(),
        "industrial production" | "industrial production yoy" => return "Sanayi Üretimi (Yıllık)".into(),
        "industrial production mom" => return "Sanayi Üretimi (Aylık)".into(),
        "economic confidence index" => return "Ekonomik Güven Endeksi".into(),
        "budget balance" => return "Bütçe Dengesi".into(),
        "foreign exchange reserves" => return "Döviz Rezervleri".into(),
        "auto sales yoy" => return "Otomobil Satışları (Yıllık)".into(),
        "auto production yoy" => return "Otomobil Üretimi (Yıllık)".into(),
        "central government debt" => return "Merkezi Yönetim Borç Stoku".into(),
        "treasury cash balance" => return "Hazine Nakit Dengesi".into(),
        "mpc meeting summary" => return "PPK Toplantı Özeti".into(),
        "istanbul chamber of industry manufacturing pmi" => return "İSO İmalat PMI".into(),
        "tourism revenues" => return "Turizm Gelirleri".into(),
        "tourist arrivals yoy" => return "Turist Girişleri (Yıllık)".into(),
        _ => raw,
    };
    // Fallback: title-case
    tr.split_whitespace()
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().to_string() + &c.as_str().to_lowercase(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

// ─── Önbellek ──────────────────────────────────────────────────────────────────

/// Diskte tutulan önbellek. Zaman damgası `Instant` DEĞİL unix saniyesidir:
/// `Instant` süreç ömrüne bağlıdır, diske yazılamaz — uygulama kapanınca
/// takvim sıfırdan çekilmek zorunda kalıyordu.
#[derive(Clone, Serialize, Deserialize)]
struct CalendarCache {
    fetched_at: i64,
    events: Vec<EconomicEvent>,
}

static CACHE: OnceLock<Mutex<Option<CalendarCache>>> = OnceLock::new();

fn cache_path() -> PathBuf {
    let mut path = dirs::data_dir().unwrap_or_else(std::env::temp_dir);
    path.push("fraude");
    std::fs::create_dir_all(&path).ok();
    path.push(CACHE_FILE);
    path
}

fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}

/// Önbellek tazelik ölçütü. Ayrı fonksiyon: sınanabilir olsun.
fn is_fresh(fetched_at: i64, now: i64) -> bool {
    let age = now - fetched_at;
    // Saat geriye alındıysa (negatif yaş) bayat say: yanlış tarafa düşmek,
    // takvimi gereksiz yere saatlerce dondurmaktan iyidir.
    (0..CACHE_TTL_SECS).contains(&age)
}

/// Belleği diskten doldurur (ilk çağrıda), sonra bellekten döner.
fn load_cache() -> Option<CalendarCache> {
    let cache = CACHE.get_or_init(|| Mutex::new(None));
    let mut guard = cache.lock().unwrap_or_else(|error| error.into_inner());
    if guard.is_none() {
        if let Ok(data) = std::fs::read_to_string(cache_path()) {
            *guard = serde_json::from_str(&data).ok();
        }
    }
    guard.clone()
}

fn save_cache(events: &[EconomicEvent]) {
    let entry = CalendarCache {
        fetched_at: now_secs(),
        events: events.to_vec(),
    };
    let cache = CACHE.get_or_init(|| Mutex::new(None));
    *cache.lock().unwrap_or_else(|error| error.into_inner()) = Some(entry.clone());
    let _ = crate::persist::write_json_atomic(&cache_path(), &entry);
}

// ─── Çekim ─────────────────────────────────────────────────────────────────────

/// Tek denemenin sonucu: gövde geldi mi, gelmediyse tekrar denemeye değer mi?
enum Attempt {
    Body(String),
    /// Geçici hata (ağ, 429, 5xx) — kısa beklemeyle tekrar denenebilir.
    Retryable,
    /// Kalıcı hata (404, 403 gibi) — bu kaynakta ısrar etmenin anlamı yok.
    Fatal,
}

async fn fetch_once(client: &reqwest::Client, url: &str) -> Attempt {
    let response = client
        .get(url)
        .timeout(REQUEST_TIMEOUT)
        .header("User-Agent", crate::yahoo::YAHOO_USER_AGENT)
        .header("Accept", "text/html")
        .send()
        .await;

    match response {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() {
                match resp.text().await {
                    Ok(body) => Attempt::Body(body),
                    // Gövde yarıda koptu: bağlantı sorunudur, tekrar denenir.
                    Err(_) => Attempt::Retryable,
                }
            } else if status.as_u16() == 429 || status.is_server_error() {
                Attempt::Retryable
            } else {
                Attempt::Fatal
            }
        }
        // Zaman aşımı/DNS/TLS — geçici kabul edilir.
        Err(_) => Attempt::Retryable,
    }
}

/// Bir kaynaktan olayları çeker; geçici hatada bir kez daha dener.
/// Sayfa geldiyse ama hiç satır çıkmadıysa None döner — çağıran sıradaki
/// kaynağa geçer (işaretleme değişmiş ya da sayfa boş gelmiş olabilir).
async fn fetch_source(client: &reqwest::Client, url: &str) -> Option<Vec<EconomicEvent>> {
    for attempt in 0..2 {
        match fetch_once(client, url).await {
            Attempt::Body(body) => {
                let events = parse_calendar_html(&body);
                return (!events.is_empty()).then_some(events);
            }
            Attempt::Fatal => return None,
            Attempt::Retryable => {
                if attempt == 0 {
                    tokio::time::sleep(RETRY_DELAY).await;
                }
            }
        }
    }
    None
}

/// Türkiye ekonomik takvimini döndürür.
///
/// Sıra: taze önbellek → kaynaklar (öncelik sırasıyla, geçici hatada tekrar) →
/// bayat önbellek. Her şey başarısız olursa ve elde hiç veri yoksa boş döner.
pub async fn get_economic_calendar(client: &reqwest::Client) -> Vec<EconomicEvent> {
    let cached = load_cache();
    if let Some(entry) = &cached {
        if is_fresh(entry.fetched_at, now_secs()) {
            return entry.events.clone();
        }
    }

    for url in CALENDAR_SOURCES {
        if let Some(events) = fetch_source(client, url).await {
            save_cache(&events);
            return events;
        }
    }

    // Kaynakların hepsi düştü: son bilinen takvimi ver. Eskiden burada boş
    // liste dönüyor ve ekran tamamen boşalıyordu.
    cached.map(|entry| entry.events).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Canlı TradingEconomics çıktısından kırpılmış örnek sayfa.
    const FIXTURE: &str = include_str!("../fixtures/tradingeconomics_turkey_calendar.html");

    /// Taze önbellek ağa çıkmadan kullanılmalı; bayat olan kullanılmamalı.
    #[test]
    fn freshness_window_is_six_hours() {
        let now = 1_760_000_000;
        assert!(is_fresh(now - 60, now), "1 dakikalık kayıt taze sayılmalı");
        assert!(is_fresh(now - (CACHE_TTL_SECS - 1), now), "sınırın içi taze");
        assert!(!is_fresh(now - CACHE_TTL_SECS, now), "sınırda bayat");
        assert!(!is_fresh(now - 86_400, now), "1 günlük kayıt bayat");
    }

    /// Saat ileri alınırsa kayıt "gelecekten" görünür. Bu durumda tazelik
    /// varsayılmamalı, yoksa takvim saatlerce yenilenmeden donar.
    #[test]
    fn future_timestamp_is_not_treated_as_fresh() {
        let now = 1_760_000_000;
        assert!(!is_fresh(now + 3_600, now));
    }

    /// Önbellek diske yazılıp aynı biçimde geri okunabilmeli — sürüm
    /// yükseltmelerinde sessizce bozulursa takvim her açılışta sıfırdan çekilir.
    #[test]
    fn cache_survives_json_round_trip() {
        let events = parse_calendar_html(FIXTURE);
        assert!(!events.is_empty());
        let entry = CalendarCache {
            fetched_at: 1_760_000_000,
            events: events.clone(),
        };
        let json = serde_json::to_string(&entry).expect("serileştirilemedi");
        let back: CalendarCache = serde_json::from_str(&json).expect("geri okunamadı");
        assert_eq!(back.fetched_at, entry.fetched_at);
        assert_eq!(back.events.len(), events.len());
        assert_eq!(back.events[0].event, events[0].event);
        assert_eq!(back.events[0].impact, events[0].impact);
    }

    /// Yedek kaynak GERÇEKTEN yedek mi? Ağ gerektirir, bu yüzden varsayılan
    /// koşuda atlanır; işaretleme değiştiğinde elle çalıştırılır:
    ///   cargo test -p fraude-core economic_calendar -- --ignored --nocapture
    #[tokio::test]
    #[ignore = "ağ gerektirir"]
    async fn every_source_yields_events() {
        let client = reqwest::Client::new();
        for url in CALENDAR_SOURCES {
            let events = fetch_source(&client, url).await;
            let count = events.as_ref().map(Vec::len).unwrap_or(0);
            println!("{url} → {count} olay");
            assert!(count > 0, "kaynak boş döndü: {url}");
        }
    }

    /// Genel takvim sayfası yedek kaynaktır: aynı ayrıştırıcı yalnız Türkiye
    /// satırlarını almalı, başka ülkeler sızmamalı.
    #[test]
    fn parser_keeps_only_turkey_rows() {
        let mixed = format!(
            r#"<table><tbody>
                 <tr data-country="united states" data-category="inflation rate" data-event="us cpi">
                   <td class=" 2026-08-14"></td></tr>
                 {}
               </tbody></table>"#,
            FIXTURE
        );
        let events = parse_calendar_html(&mixed);
        assert!(!events.is_empty(), "Türkiye satırları da düştü");
        assert!(
            !events.iter().any(|event| event.event.to_lowercase().contains("us cpi")),
            "başka ülkenin satırı sızdı"
        );
    }

    #[test]
    fn parses_rows_with_values_past_the_nested_flag_table() {
        let events = parse_calendar_html(FIXTURE);
        assert!(!events.is_empty(), "hiç etkinlik ayrıştırılamadı");

        // Değer hücreleri iç içe <table>'dan sonra geldiği için asıl regresyon burası.
        let with_values = events
            .iter()
            .filter(|e| !e.actual.is_empty() || !e.previous.is_empty() || !e.consensus.is_empty())
            .count();
        assert!(with_values > 0, "hiçbir etkinlikte değer yok — satır erken kesiliyor");

        let cari = events
            .iter()
            .find(|e| e.category == "current account")
            .expect("cari işlemler satırı yok");
        assert_eq!(cari.date, "2026-07-13");
        assert_eq!(cari.time, "07:00 AM");
        assert_eq!(cari.event, "Cari İşlemler Dengesi");
        assert_eq!(cari.actual, "$-1.459B");
        assert_eq!(cari.previous, "$-5.616B");
        assert_eq!(cari.consensus, "$-0.96B");
        assert_eq!(cari.forecast, "$-1.3B");
        assert_eq!(cari.impact, Impact::High);
        assert_eq!(cari.source_url, "https://tradingeconomics.com/turkey/current-account");
    }

    /// Her satır tıklanabilir olmalı: `data-url` yoksa olay adındaki bağlantı,
    /// o da yoksa takvim sayfası. Boş `source_url` ölü bir tıklama demektir.
    #[test]
    fn every_row_carries_a_source_url() {
        let events = parse_calendar_html(FIXTURE);
        assert!(!events.is_empty());
        for event in &events {
            assert!(
                event.source_url.starts_with("https://tradingeconomics.com/"),
                "{} satırında kaynak bağlantısı yok: {:?}",
                event.event,
                event.source_url
            );
        }
    }

    /// `data-url` taşımayan satır olay adındaki bağlantıya, o da yoksa takvime düşer.
    #[test]
    fn source_url_falls_back_when_row_has_no_data_url() {
        let html = r#"<table><tbody>
            <tr data-country="turkey" data-category="inflation rate" data-event="inflation rate">
              <td class=" 2026-08-14"></td>
              <td><a class='calendar-event' href='/turkey/inflation-cpi'>Inflation Rate</a></td>
            </tr>
            <tr data-country="turkey" data-category="tourism revenues" data-event="tourism revenues">
              <td class=" 2026-08-15"></td>
              <td>Tourism Revenues</td>
            </tr>
          </tbody></table>"#;
        let events = parse_calendar_html(html);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].source_url, "https://tradingeconomics.com/turkey/inflation-cpi");
        assert_eq!(events[1].source_url, FALLBACK_SOURCE_URL);
    }

    #[test]
    fn maps_impact_from_real_category_names() {
        // Bunlar TradingEconomics'in gerçek kategori adları; olay adları farklıdır.
        assert_eq!(category_impact("producer prices change"), Impact::Medium);
        assert_eq!(category_impact("government budget value"), Impact::Medium);
        assert_eq!(category_impact("economic optimism index"), Impact::Medium);
        assert_eq!(category_impact("interest rate"), Impact::High);
        assert_eq!(category_impact("tourist arrivals"), Impact::Low);
    }
}
