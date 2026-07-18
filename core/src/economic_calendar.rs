//! Türkiye ekonomik takvimi — TradingEconomics HTML tablosundan keysiz çekim.
//! Haftalık takvim sayfasından yaklaşan makroekonomik olayları (TCMB faiz
//! kararı, TÜFE, işsizlik, GSYİH vb.) ayrıştırır.
//!
//! Ağ hatasında boş liste döner; frontend bu listeyi yerel önbelleğine yazıp
//! `CACHE_TTL` aralığıyla tazeler, böylece çevrimdışı açılışta da takvim dolu
//! gelir.

use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use regex::Regex;
use scraper::{ElementRef, Html, Selector};
use serde::Serialize;

const CALENDAR_URL: &str = "https://tradingeconomics.com/turkey/calendar";
const CACHE_TTL: Duration = Duration::from_secs(6 * 60 * 60); // 6 saat

/// Etki seviyesi — frontend bunu renk/ikon için kullanır.
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Impact {
    High,
    Medium,
    Low,
}

/// Tek bir ekonomik takvim etkinliği.
#[derive(Clone, Serialize)]
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

// ─── Cache ─────────────────────────────────────────────────────────────────────

static CACHE: OnceLock<Mutex<Option<(Instant, Vec<EconomicEvent>)>>> = OnceLock::new();

fn cached() -> Option<Vec<EconomicEvent>> {
    let cache = CACHE.get_or_init(|| Mutex::new(None));
    let guard = cache.lock().unwrap_or_else(|e| e.into_inner());
    guard
        .as_ref()
        .filter(|(t, _)| t.elapsed() < CACHE_TTL)
        .map(|(_, v)| v.clone())
}

fn set_cache(events: Vec<EconomicEvent>) {
    let cache = CACHE.get_or_init(|| Mutex::new(None));
    *cache.lock().unwrap_or_else(|e| e.into_inner()) = Some((Instant::now(), events));
}

/// TradingEconomics'ten Türkiye ekonomik takvimini çeker. Ağ hatasında boş döner.
pub async fn get_economic_calendar(client: &reqwest::Client) -> Vec<EconomicEvent> {
    if let Some(events) = cached() {
        return events;
    }

    let html = match client
        .get(CALENDAR_URL)
        .timeout(Duration::from_secs(15))
        .header("User-Agent", crate::yahoo::YAHOO_USER_AGENT)
        .header("Accept", "text/html")
        .send()
        .await
    {
        Ok(resp) => match resp.text().await {
            Ok(t) => t,
            Err(_) => return Vec::new(),
        },
        Err(_) => return Vec::new(),
    };

    let events = parse_calendar_html(&html);

    if !events.is_empty() {
        set_cache(events.clone());
    }
    events
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Canlı TradingEconomics çıktısından kırpılmış örnek sayfa.
    const FIXTURE: &str = include_str!("../fixtures/tradingeconomics_turkey_calendar.html");

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
