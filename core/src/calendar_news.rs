//! Takvim maddesine bağlı haber araması.
//!
//! Ekonomik takvim satırı bir rakam gösterir ("Enflasyon Oranı %33,5"), ama o
//! rakamın piyasada nasıl karşılandığını göstermez. Bu modül, takvim satırının
//! KATEGORİSİNDEN bir arama sorgusu üretip o konudaki haberleri toplar; kullanıcı
//! satıra tıklayınca haberler uygulama içindeki okuyucuda açılır.
//!
//! Sorgu neden kategoriden üretiliyor: satırın görünen adı kaynağın İngilizce
//! etiketidir ("Inflation Rate YoY") ve Türkçe basında bu ada birebir rastlanmaz.
//! Kategori ise sabit bir sözlük anahtarıdır — "inflation rate" görülünce "TÜFE
//! enflasyon" aranır. Sözlükte olmayan kategori için olay adına düşülür; sonuç
//! zayıf olur ama akış kırılmaz.

use crate::domain::NewsItem;
use std::collections::HashSet;
use std::sync::Mutex;
use std::sync::OnceLock;

/// Bir takvim kategorisinin iki dildeki arama terimleri.
struct Topic {
    /// Türkçe basında kullanılan adlandırma(lar).
    tr: &'static str,
    /// İngilizce/uluslararası basın için.
    en: &'static str,
    /// Başlıkta GERÇEKTEN geçmesi gereken terimler (küçük harf, noktasız i).
    ///
    /// Google News tırnaklı öbekleri gevşek eşleştirir: "dış ticaret dengesi"
    /// sorgusu cari açık haberi döndürebiliyor. Sonuç bu listeyle yeniden
    /// süzülür — sorgu neyi getirirse getirsin, başlıkta konunun adı yoksa
    /// kayıt elenir.
    must: &'static [&'static str],
    /// Küresel karşılığı olan gösterge mi (enflasyon, faiz, büyüme…).
    ///
    /// Böyle konularda Türk basını ABD/Euro Bölgesi verilerini de aynı
    /// sözcüklerle yazar; yurt dışı haberler ayrıca elenir.
    global_twin: bool,
}

/// TradingEconomics `data-category` değeri → arama terimleri.
///
/// Anahtarlar kaynağın kendi kategori sözlüğünden alındı (ölçüm: 2026-08-14,
/// Türkiye takvimi). Terimler tırnak içinde öbeklenir ki Google News sözcükleri
/// dağıtıp alakasız sonuç getirmesin.
const TOPICS: &[(&str, Topic)] = &[
    ("interest rate", Topic { tr: "\"TCMB faiz kararı\" OR \"politika faizi\"", en: "\"Turkey interest rate decision\" OR \"CBRT policy rate\"", must: &["faiz", "interest rate", "policy rate"], global_twin: true }),
    ("lending rate", Topic { tr: "\"TCMB borç verme faizi\"", en: "\"Turkey lending rate\"", must: &["borç verme faizi", "lending rate"], global_twin: true }),
    ("deposit interest rate", Topic { tr: "\"mevduat faizi\"", en: "\"Turkey deposit rate\"", must: &["mevduat faizi", "deposit rate"], global_twin: true }),
    ("inflation rate", Topic { tr: "\"TÜFE\" OR \"yıllık enflasyon\"", en: "\"Turkey inflation rate\" OR \"Turkish CPI\"", must: &["tüfe", "enflasyon", "inflation", "cpi"], global_twin: true }),
    ("inflation rate mom", Topic { tr: "\"aylık enflasyon\" OR \"aylık TÜFE\"", en: "\"Turkey monthly inflation\"", must: &["tüfe", "enflasyon", "inflation", "cpi"], global_twin: true }),
    ("core inflation rate", Topic { tr: "\"çekirdek enflasyon\"", en: "\"Turkey core inflation\"", must: &["çekirdek enflasyon", "core inflation"], global_twin: true }),
    ("core inflation rate mom", Topic { tr: "\"çekirdek enflasyon\" aylık", en: "\"Turkey core inflation\" monthly", must: &["çekirdek enflasyon", "core inflation"], global_twin: true }),
    ("producer prices change", Topic { tr: "\"ÜFE\" OR \"üretici fiyat\"", en: "\"Turkey producer prices\"", must: &["üfe", "üretici fiyat", "producer price", "ppi"], global_twin: true }),
    ("producer price inflation mom", Topic { tr: "\"aylık ÜFE\"", en: "\"Turkey monthly PPI\"", must: &["üfe", "üretici fiyat", "producer price", "ppi"], global_twin: true }),
    ("gdp growth rate", Topic { tr: "\"büyüme oranı\" OR \"çeyreklik büyüme\"", en: "\"Turkey GDP growth\"", must: &["büyüme", "gsyh", "gdp"], global_twin: true }),
    ("gdp annual growth rate", Topic { tr: "\"yıllık büyüme\" OR \"GSYH\"", en: "\"Turkey annual GDP growth\"", must: &["büyüme", "gsyh", "gdp"], global_twin: true }),
    ("unemployment rate", Topic { tr: "\"işsizlik oranı\"", en: "\"Turkey unemployment rate\"", must: &["işsizlik", "unemployment"], global_twin: true }),
    ("labor force participation rate", Topic { tr: "\"işgücüne katılma oranı\"", en: "\"Turkey labor force participation\"", must: &["işgücü", "labor force"], global_twin: false }),
    ("current account", Topic { tr: "\"cari işlemler dengesi\" OR \"cari açık\"", en: "\"Turkey current account\"", must: &["cari işlemler", "cari açık", "cari denge", "current account"], global_twin: false }),
    ("balance of trade", Topic { tr: "\"dış ticaret dengesi\" OR \"dış ticaret açığı\"", en: "\"Turkey trade balance\"", must: &["dış ticaret", "ticaret dengesi", "trade balance", "trade deficit"], global_twin: false }),
    ("exports", Topic { tr: "\"ihracat\" rakamları", en: "\"Turkey exports\"", must: &["ihracat", "export"], global_twin: false }),
    ("imports", Topic { tr: "\"ithalat\" rakamları", en: "\"Turkey imports\"", must: &["ithalat", "import"], global_twin: false }),
    ("industrial production", Topic { tr: "\"sanayi üretimi\"", en: "\"Turkey industrial production\"", must: &["sanayi üretim", "industrial production"], global_twin: true }),
    ("industrial production mom", Topic { tr: "\"sanayi üretimi\" aylık", en: "\"Turkey industrial production\" monthly", must: &["sanayi üretim", "industrial production"], global_twin: true }),
    ("manufacturing pmi", Topic { tr: "\"imalat PMI\"", en: "\"Turkey manufacturing PMI\"", must: &["pmi", "imalat"], global_twin: true }),
    ("capacity utilization", Topic { tr: "\"kapasite kullanım oranı\"", en: "\"Turkey capacity utilization\"", must: &["kapasite kullanım", "capacity utilization"], global_twin: false }),
    ("business confidence", Topic { tr: "\"reel kesim güven endeksi\" OR \"iş dünyası güveni\"", en: "\"Turkey business confidence\"", must: &["reel kesim", "güven endeksi", "business confidence"], global_twin: false }),
    ("consumer confidence", Topic { tr: "\"tüketici güven endeksi\"", en: "\"Turkey consumer confidence\"", must: &["tüketici güven", "consumer confidence"], global_twin: true }),
    ("economic optimism index", Topic { tr: "\"ekonomik güven endeksi\"", en: "\"Turkey economic confidence index\"", must: &["ekonomik güven", "economic confidence"], global_twin: false }),
    ("retail sales yoy", Topic { tr: "\"perakende satış\"", en: "\"Turkey retail sales\"", must: &["perakende", "retail sales"], global_twin: true }),
    ("retail sales mom", Topic { tr: "\"perakende satış\" aylık", en: "\"Turkey retail sales\" monthly", must: &["perakende", "retail sales"], global_twin: true }),
    ("foreign exchange reserves", Topic { tr: "\"rezerv\" OR \"döviz rezervi\" merkez bankası", en: "\"Turkey foreign exchange reserves\"", must: &["rezerv", "reserves"], global_twin: true }),
    ("government budget value", Topic { tr: "\"bütçe dengesi\" OR \"bütçe açığı\"", en: "\"Turkey budget balance\"", must: &["bütçe", "budget"], global_twin: true }),
    ("government debt", Topic { tr: "\"kamu borcu\"", en: "\"Turkey government debt\"", must: &["kamu borcu", "government debt"], global_twin: true }),
    ("treasury cash balance", Topic { tr: "\"hazine nakit dengesi\"", en: "\"Turkey treasury cash balance\"", must: &["hazine", "nakit denge", "treasury"], global_twin: false }),
    ("car production", Topic { tr: "\"otomobil üretimi\"", en: "\"Turkey car production\"", must: &["otomobil üretim", "araç üretim", "car production"], global_twin: false }),
    ("total vehicle sales", Topic { tr: "\"otomotiv satışları\" OR \"araç satışları\"", en: "\"Turkey vehicle sales\"", must: &["otomotiv sat", "araç sat", "vehicle sales"], global_twin: false }),
    ("tourist arrivals", Topic { tr: "\"turist sayısı\" OR \"turizm geliri\"", en: "\"Turkey tourist arrivals\"", must: &["turist", "turizm", "tourist", "tourism"], global_twin: false }),
];

fn topic_for(category: &str) -> Option<&'static Topic> {
    let key = category.trim().to_lowercase();
    TOPICS.iter().find(|(name, _)| *name == key).map(|(_, topic)| topic)
}

/// Sorgunun konu kısmı. Kategori sözlükte yoksa olay adına düşülür — zayıf ama
/// boş dönmekten iyi.
fn topic_query(category: &str, event: &str, lang: &str) -> String {
    match topic_for(category) {
        Some(topic) => if lang == "en" { topic.en.to_string() } else { topic.tr.to_string() },
        None => {
            let fallback = if event.trim().is_empty() { category } else { event };
            if lang == "en" {
                format!("Turkey \"{}\"", fallback.trim())
            } else {
                format!("Türkiye \"{}\"", fallback.trim())
            }
        }
    }
}

/// Aramanın tarih penceresi.
///
/// Açıklanmış bir veri için haber, açıklama gününde ve ertesinde çıkar; bu
/// yüzden pencere olayın etrafına kurulur. Henüz açıklanmamış (gelecek tarihli)
/// bir veride `after:` filtresi geleceği işaret edeceğinden hiç sonuç dönmez —
/// orada beklenti haberleri için son günlere bakılır.
fn window_clause(date: &str, today: chrono::NaiveDate) -> String {
    match chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d") {
        Ok(day) if day <= today => {
            let from = day - chrono::Duration::days(1);
            let to = (day + chrono::Duration::days(4)).min(today + chrono::Duration::days(1));
            format!(" after:{from} before:{to}")
        }
        // Gelecek tarih ya da okunamayan tarih: son iki haftanın beklenti akışı.
        _ => " when:14d".to_string(),
    }
}

// ─── Önbellek ──────────────────────────────────────────────────────────────────

const CACHE_TTL_SECS: i64 = 30 * 60;
const CACHE_CAPACITY: usize = 64;

struct Entry {
    key: String,
    fetched_at: i64,
    items: Vec<NewsItem>,
}

static CACHE: OnceLock<Mutex<Vec<Entry>>> = OnceLock::new();

fn cache() -> &'static Mutex<Vec<Entry>> {
    CACHE.get_or_init(|| Mutex::new(Vec::new()))
}

fn cached(key: &str, now: i64) -> Option<Vec<NewsItem>> {
    let guard = cache().lock().unwrap_or_else(|error| error.into_inner());
    guard
        .iter()
        .find(|entry| entry.key == key && (0..CACHE_TTL_SECS).contains(&(now - entry.fetched_at)))
        .map(|entry| entry.items.clone())
}

fn remember(key: String, items: &[NewsItem], now: i64) {
    let mut guard = cache().lock().unwrap_or_else(|error| error.into_inner());
    guard.retain(|entry| entry.key != key);
    guard.push(Entry { key, fetched_at: now, items: items.to_vec() });
    // Takvimde onlarca satır var; sınırsız büyümesin.
    if guard.len() > CACHE_CAPACITY {
        let excess = guard.len() - CACHE_CAPACITY;
        guard.drain(0..excess);
    }
}

// ─── Çekim ─────────────────────────────────────────────────────────────────────

/// Başlığın karşılaştırma anahtarı.
///
/// Düz `to_lowercase()` YETMEZ: Rust'ın Unicode kuralında 'I' → 'i' ve
/// 'İ' → "i̇" (i + birleşen nokta) olur, yani "AÇIKLANDI" → "açiklandi" ile
/// "açıklandı" birbirini tutmaz ve aynı haber listede iki kez görünür.
/// Noktasız/noktalı i farkı burada silinir.
///
/// `pub(crate)`: `calendar_impact` rapor başlıklarını aynı kuralla eşliyor —
/// iki ayrı katlama kuralı, aynı başlığın bir yerde tutup başka yerde
/// tutmaması demek olurdu.
pub(crate) fn fingerprint(title: &str) -> String {
    let lowered = title.to_lowercase();
    let flattened: String = lowered
        .chars()
        // 'İ'.to_lowercase() sonrası kalan birleşen nokta.
        .filter(|c| *c != '\u{0307}')
        .map(|c| if c == 'ı' { 'i' } else { c })
        .collect();
    flattened.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Yurt dışı verisini işaret eden sözcükler. Türk basını ABD enflasyonunu da
/// "enflasyon" diye yazar; takvim satırı Türkiye verisi olduğu için bunlar
/// konuyu kaçırır.
const FOREIGN_MARKERS: &[&str] = &[
    "abd", "amerika", "fed", "euro bölgesi", "avrupa merkez", "ecb",
    "almanya", "fransa", "ingiltere", "japonya", "çin", "rusya",
    "us ", "u.s.", "eurozone", "germany", "china",
];

/// Yurt içi verisini işaret eden sözcükler; yabancı işaretini geçersiz kılar
/// ("ABD verisi sonrası Türkiye'de faiz beklentisi" gibi başlıklar kalsın).
const DOMESTIC_MARKERS: &[&str] = &[
    "türkiye", "türk", "tcmb", "tüik", "merkez bankası", "turkey", "turkish",
];

/// Başlıkta açıkça anılan yıllar (1900-2099).
///
/// Neden gerekli: bazı siteler eski yazıyı yeni yayın tarihiyle sunuyor.
/// Ölçülen örnek — "2021'de otomobil üretimi yüzde 8 azaldı" haberinin Google
/// News'teki yayın tarihi 8 Ağustos 2026'ydı. Tarih süzgeci böyle bir kaydı
/// yakalayamaz; hangi döneme ait olduğu yalnız başlıkta yazıyor.
fn years_in_title(title: &str) -> Vec<i32> {
    let bytes: Vec<char> = title.chars().collect();
    let mut years = Vec::new();
    let mut index = 0;
    while index + 4 <= bytes.len() {
        if bytes[index].is_ascii_digit() {
            let slice: String = bytes[index..index + 4].iter().collect();
            if slice.chars().all(|c| c.is_ascii_digit()) {
                // Dört haneli sayının solu ve sağı rakam olmamalı: "12026" yıl değil.
                let left_ok = index == 0 || !bytes[index - 1].is_ascii_digit();
                let right_ok = index + 4 == bytes.len() || !bytes[index + 4].is_ascii_digit();
                if left_ok && right_ok {
                    if let Ok(year) = slice.parse::<i32>() {
                        if (1900..2100).contains(&year) {
                            years.push(year);
                        }
                    }
                }
            }
        }
        index += 1;
    }
    years
}

/// Eski yılın KONU değil KIYAS NOKTASI olduğunu gösteren kalıplar.
/// "2021'den bu yana en hızlı artış" güncel veriyi anlatır, 2021 verisini değil.
const REFERENCE_MARKERS: &[&str] = &[
    "den bu yana", "dan bu yana", "den beri", "dan beri",
    "yılından", "yilindan", "sonrasında", "sonrasinda", "since ",
];

/// Başlık, takvim maddesinden DAHA ESKİ bir dönemi mi anlatıyor?
///
/// Başlıkta yıl geçmiyorsa karar verilemez, haber kalır. Yıl geçiyorsa ve
/// hepsi olayın yılından eskiyse, haber başka bir dönemin verisidir — ancak
/// eski yıl bir kıyas noktası olarak anılıyorsa haber güncel olabilir.
fn is_about_older_period(title: &str, event_year: i32) -> bool {
    let years = years_in_title(title);
    if years.is_empty() || years.iter().any(|year| *year >= event_year) {
        return false;
    }
    let key = fingerprint(title);
    !REFERENCE_MARKERS.iter().any(|marker| key.contains(&fingerprint(marker)))
}

/// Yayın tarihi olayın makul çevresinde mi?
///
/// Sorgudaki tarih filtresine güvenilmez (konu süzgecinde olduğu gibi). Bu
/// yalnız kaba bir emniyet kemeri: aylar öncesine ait bir kayıt listeye
/// girmesin. Tarih okunamıyorsa haber elenmez — biçim değişikliği yüzünden
/// liste boşalmasın.
fn published_near_event(pub_date: &str, event: Option<chrono::NaiveDate>) -> bool {
    let Some(event_day) = event else { return true };
    let Ok(published) = chrono::DateTime::parse_from_rfc2822(pub_date.trim()) else {
        return true;
    };
    (published.date_naive() - event_day).num_days().abs() <= 45
}

/// Başlık takvim satırının konusuyla gerçekten ilgili mi?
///
/// İki kapı: (1) konunun terimi başlıkta geçmeli — Google News tırnaklı öbeği
/// gevşek eşleştirdiği için sorguya güvenilmez; (2) küresel karşılığı olan
/// göstergelerde, yurt dışını işaret eden başlık yurt içi işareti taşımıyorsa
/// elenir.
fn is_relevant(topic: &Topic, title: &str, summary: Option<&str>) -> bool {
    let haystack = fingerprint(&format!("{} {}", title, summary.unwrap_or_default()));

    let on_topic = topic.must.iter().any(|term| haystack.contains(&fingerprint(term)));
    if !on_topic {
        return false;
    }

    if topic.global_twin {
        let foreign = FOREIGN_MARKERS.iter().any(|m| haystack.contains(&fingerprint(m)));
        let domestic = DOMESTIC_MARKERS.iter().any(|m| haystack.contains(&fingerprint(m)));
        if foreign && !domestic {
            return false;
        }
    }

    true
}

/// Aynı haber birden çok kaynaktan gelir; başlığa göre tekilleştirilir.
fn dedupe(items: Vec<NewsItem>) -> Vec<NewsItem> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for item in items {
        let key = fingerprint(&item.title);
        if key.is_empty() || seen.insert(key) {
            out.push(item);
        }
    }
    out
}

/// Takvim maddesiyle ilgili haberleri döndürür.
///
/// `lang` arayüzün dilidir; iki dilde de arama yapılır ama kullanıcının dili
/// önce sıralanır. Kaynaklardan biri düşerse diğerinin sonucu yine döner.
pub async fn get_calendar_event_news(
    client: &reqwest::Client,
    category: &str,
    event: &str,
    date: &str,
    lang: &str,
) -> Vec<NewsItem> {
    let key = format!("{category}|{event}|{date}|{lang}");
    let now = chrono::Utc::now().timestamp();
    if let Some(hit) = cached(&key, now) {
        return hit;
    }

    let window = window_clause(date, chrono::Utc::now().date_naive());
    let primary_lang = if lang == "en" { "en" } else { "tr" };
    let secondary_lang = if primary_lang == "en" { "tr" } else { "en" };

    let primary_query = format!("{}{}", topic_query(category, event, primary_lang), window);
    let secondary_query = format!("{}{}", topic_query(category, event, secondary_lang), window);

    let (primary, secondary) = tokio::join!(
        crate::services::fetch_google_news(client, &primary_query, None, false, primary_lang),
        crate::services::fetch_google_news(client, &secondary_query, None, false, secondary_lang),
    );

    let mut items = Vec::new();
    items.extend(primary.unwrap_or_default());
    items.extend(secondary.unwrap_or_default());

    // Sorgu neyi getirirse getirsin, konuyla ilgisi olmayan kayıt elenir.
    // Sözlükte olmayan kategoride süzecek terim yok; liste olduğu gibi kalır.
    if let Some(topic) = topic_for(category) {
        items.retain(|item| is_relevant(topic, &item.title, item.summary.as_deref()));
    }

    // Dönem denetimi: takvim satırı belli bir ayın verisidir, başka bir yılın
    // haberini göstermek bağlamı bozar.
    let event_day = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok();
    if let Some(day) = event_day {
        use chrono::Datelike;
        let event_year = day.year();
        items.retain(|item| !is_about_older_period(&item.title, event_year));
    }
    items.retain(|item| published_near_event(&item.pub_date, event_day));

    let items = dedupe(items);
    remember(key, &items, now);
    items
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Sözlük anahtarları kaynağın kategori adlarıyla birebir eşleşmeli:
    /// yanlış yazılmış tek anahtar, o satırı sessizce zayıf yedeğe düşürür.
    #[test]
    fn topic_lookup_is_case_insensitive_and_covers_high_impact_rows() {
        for category in [
            "interest rate", "inflation rate", "current account",
            "balance of trade", "unemployment rate", "gdp growth rate",
        ] {
            assert!(topic_for(category).is_some(), "yüksek etkili kategori sözlükte yok: {category}");
        }
        assert!(topic_for("Interest Rate").is_some(), "eşleme büyük/küçük harften etkilenmemeli");
        assert!(topic_for(" inflation rate ").is_some(), "boşluk kırpılmalı");
    }

    /// Sözlükte olmayan kategori akışı kırmamalı: olay adıyla aranır.
    #[test]
    fn unknown_category_falls_back_to_event_name() {
        let query = topic_query("bilinmeyen kategori", "Konut Satışları", "tr");
        assert!(query.contains("Konut Satışları"), "olay adı sorguya girmeli: {query}");
        assert!(query.contains("Türkiye"), "ülke bağlamı korunmalı: {query}");

        // Olay adı da boşsa kategoriye düşülür; sorgu yine boş kalmamalı.
        let bare = topic_query("konut satışları", "", "tr");
        assert!(bare.contains("konut satışları"), "kategori yedeği kullanılmalı: {bare}");
    }

    /// Açıklanmış veri: pencere olayın etrafına kurulur.
    #[test]
    fn past_events_search_around_the_release_date() {
        let today = chrono::NaiveDate::from_ymd_opt(2026, 8, 14).unwrap();
        let clause = window_clause("2026-08-10", today);
        assert!(clause.contains("after:2026-08-09"), "önceki günden başlamalı: {clause}");
        assert!(clause.contains("before:2026-08-14"), "olay sonrasını kapsamalı: {clause}");
    }

    /// Pencerenin üst sınırı bugünü aşmamalı; aşarsa Google boş döndürür.
    #[test]
    fn window_never_reaches_past_tomorrow() {
        let today = chrono::NaiveDate::from_ymd_opt(2026, 8, 14).unwrap();
        let clause = window_clause("2026-08-13", today);
        assert!(clause.contains("before:2026-08-15"), "yarından ileri gitmemeli: {clause}");
    }

    /// Gelecek tarihli (henüz açıklanmamış) veri: tarih filtresi sonuç
    /// döndürmez, beklenti haberlerine bakılır.
    #[test]
    fn future_events_use_a_recent_window() {
        let today = chrono::NaiveDate::from_ymd_opt(2026, 8, 14).unwrap();
        assert_eq!(window_clause("2026-09-01", today), " when:14d");
        assert_eq!(window_clause("bozuk-tarih", today), " when:14d");
    }

    /// Aynı haberi iki dil sorgusu birden getirir; liste tekilleşmeli.
    #[test]
    fn duplicate_titles_collapse() {
        let make = |title: &str| NewsItem {
            title: title.to_string(),
            link: format!("https://ornek/{title}"),
            pub_date: String::new(),
            source: "test".into(),
            summary: None,
            ticker: None,
            is_kap: false,
            tags: Vec::new(),
            sector_tags: Vec::new(),
        };
        let items = vec![make("Enflasyon açıklandı"), make("ENFLASYON AÇIKLANDI"), make("Başka haber")];
        assert_eq!(dedupe(items).len(), 2, "başlık eşleşmesi büyük/küçük harfe bakmamalı");
    }

    /// Ekranda görülen hatanın BİREBİR senaryosu: gelecek tarihli "Otomobil
    /// Üretimi (Yıllık)" satırı, altında 2021 haberi gösteriyordu. O haberin
    /// yayın tarihi güncel göründüğü için yalnız başlık süzgeci yakalar.
    #[tokio::test]
    #[ignore = "ağ gerektirir"]
    async fn future_dated_car_production_row_has_no_stale_period_news() {
        let client = reqwest::Client::new();
        let future = (chrono::Utc::now().date_naive() + chrono::Duration::days(20)).to_string();
        let items = get_calendar_event_news(&client, "car production", "Otomobil Üretimi (Yıllık)", &future, "tr").await;
        println!("gelecek tarihli otomobil üretimi → {} haber", items.len());
        for item in items.iter().take(6) {
            println!("   [{}] {}", item.pub_date, item.title);
        }
        let stale: Vec<_> = items
            .iter()
            .filter(|i| is_about_older_period(&i.title, 2026))
            .map(|i| i.title.clone())
            .collect();
        assert!(stale.is_empty(), "başka döneme ait haberler listede: {stale:?}");
    }

    /// Haber uygulama içi okuyucuda açılabiliyor mu? Google News bağlantısı
    /// yönlendirmedir; çözülemezse okuyucu boş kalır. Ağ gerektirir.
    #[tokio::test]
    #[ignore = "ağ gerektirir"]
    async fn articles_can_be_opened_in_the_in_app_reader() {
        let client = reqwest::Client::new();
        let today = chrono::Utc::now().date_naive();
        let recent = (today - chrono::Duration::days(2)).to_string();
        let items = get_calendar_event_news(&client, "current account", "", &recent, "tr").await;
        let sample: Vec<_> = items.iter().take(3).collect();
        assert!(!sample.is_empty(), "ölçüm için haber gerekli");
        for item in sample {
            match crate::services::get_news_html(&client, &item.link).await {
                Ok(html) => println!("OK {:>7} bayt ← {}", html.len(), item.title),
                Err(error) => println!("HATA {error} ← {}", item.title),
            }
        }
    }

    /// Canlı ölçümde yakalanan iki gerçek hata: "TÜFE" sorgusu ABD enflasyon
    /// haberini, "dış ticaret dengesi" sorgusu cari açık haberini getiriyordu.
    /// Süzgeç ikisini de elemeli.
    #[test]
    fn filters_out_foreign_and_off_topic_headlines() {
        let inflation = topic_for("inflation rate").unwrap();
        assert!(
            !is_relevant(inflation, "ABD ENFLASYON VERİSİ AĞUSTOS 2026: ABD Enflasyon Verisi Açıklandı!", None),
            "ABD enflasyonu Türkiye takvimine ait değil"
        );
        assert!(
            is_relevant(inflation, "Türkiye'de yıllık enflasyon yüzde 33,5'e geriledi", None),
            "yurt içi enflasyon haberi kalmalı"
        );
        assert!(
            is_relevant(inflation, "TÜİK açıkladı: TÜFE aylık bazda arttı", None),
            "kurum adı yurt içi işareti sayılmalı"
        );
        // Yurt dışı verisi ama yurt içi bağlamı olan başlık elenmemeli.
        assert!(
            is_relevant(inflation, "ABD enflasyonu sonrası Türkiye'de faiz beklentisi değişti", None),
            "yurt içi işareti yabancı işaretini geçersiz kılmalı"
        );

        let trade = topic_for("balance of trade").unwrap();
        assert!(
            !is_relevant(trade, "Cari açıkta enerji riski sürüyor", None),
            "cari açık haberi dış ticaret satırına ait değil"
        );
        assert!(
            is_relevant(trade, "Dış ticaret açığı temmuzda 8 milyar dolar oldu", None),
            "konusundaki haber kalmalı"
        );
    }

    /// Ekranda görülen gerçek hata: 2026 takvim satırının altında "2021'de
    /// otomobil üretimi yüzde 8 azaldı" haberi çıktı. O haberin Google News'teki
    /// yayın tarihi 8 Ağustos 2026'ydı — yani TARİH SÜZGECİ YAKALAYAMAZ, hangi
    /// döneme ait olduğu yalnız başlıkta yazıyor.
    #[test]
    fn headlines_about_an_older_period_are_dropped() {
        assert!(
            is_about_older_period("2021’de otomobil üretimi yüzde 8 azaldı", 2026),
            "başka bir yılın verisi elenmeli"
        );
        assert!(
            !is_about_older_period("Otomobil üretimi temmuzda arttı", 2026),
            "yıl geçmiyorsa karar verilemez, haber kalmalı"
        );
        assert!(
            !is_about_older_period("2026 otomobil üretimi hedefi güncellendi", 2026),
            "olayın yılı geçiyorsa kalmalı"
        );
        assert!(
            !is_about_older_period("2025 verilerine göre 2026 beklentisi yükseldi", 2026),
            "yıllardan biri olayın yılıysa kalmalı"
        );
        // Dört haneli her sayı yıl değildir.
        assert!(
            !is_about_older_period("Üretim 12026 adede ulaştı", 2026),
            "daha uzun sayının parçası yıl sayılmamalı"
        );
        assert!(years_in_title("Cari açık 4,19 milyar dolar").is_empty(), "tutarlar yıl değil");
    }

    /// Eski yıl kıyas noktası olarak anılıyorsa haber güncel veriyi anlatır;
    /// elenirse gerçek haberler kaybolur.
    #[test]
    fn older_year_as_a_reference_point_is_kept() {
        for title in [
            "Sanayi üretimi 2021’den bu yana en hızlı arttı",
            "Enflasyon 2019 yılından bu yana en düşük seviyede",
            "İşsizlik 2020 sonrasında ilk kez geriledi",
            "Inflation lowest since 2019",
        ] {
            assert!(!is_about_older_period(title, 2026), "kıyas noktası elenmemeli: {title}");
        }
        // Kıyas kalıbı yoksa kural aynen işler.
        assert!(is_about_older_period("2021’de otomobil üretimi yüzde 8 azaldı", 2026));
    }

    /// Yayın tarihi emniyet kemeri: aylar öncesine ait kayıt elenmeli, ama
    /// okunamayan tarih listeyi boşaltmamalı.
    #[test]
    fn publication_date_guard_drops_far_away_articles() {
        let event = chrono::NaiveDate::from_ymd_opt(2026, 8, 10);
        assert!(published_near_event("Thu, 13 Aug 2026 07:00:00 GMT", event), "olaya yakın kayıt kalmalı");
        assert!(!published_near_event("Fri, 08 Jan 2021 07:00:00 GMT", event), "yıllar öncesi elenmeli");
        assert!(published_near_event("okunamayan tarih", event), "biçim bozuksa eleme yapılmamalı");
        assert!(published_near_event("Fri, 08 Jan 2021 07:00:00 GMT", None), "olay tarihi yoksa eleme yok");
    }

    /// Küresel ikizi OLMAYAN göstergede yabancı eleme çalışmamalı: "cari açık"
    /// zaten Türkiye'ye özgü bir gündem, gereksiz eleme haberi yok eder.
    #[test]
    fn domestic_only_topics_skip_the_foreign_filter() {
        let current = topic_for("current account").unwrap();
        assert!(
            is_relevant(current, "ABD ile ticarette cari işlemler dengesi konuşuldu", None),
            "küresel ikizi olmayan konuda yabancı işareti elemamalı"
        );
    }

    /// Sorgular GERÇEKTEN haber getiriyor mu? Ağ gerektirir, varsayılan koşuda
    /// atlanır; sözlük değiştiğinde elle çalıştırılır:
    ///   cargo test -p fraude-core calendar_news -- --ignored --nocapture
    #[tokio::test]
    #[ignore = "ağ gerektirir"]
    async fn high_impact_topics_return_articles() {
        let client = reqwest::Client::new();
        let today = chrono::Utc::now().date_naive();
        let recent = (today - chrono::Duration::days(3)).to_string();
        for category in ["inflation rate", "interest rate", "current account", "balance of trade", "car production"] {
            let items = get_calendar_event_news(&client, category, "", &recent, "tr").await;
            println!("{category} → {} haber", items.len());
            for item in items.iter().take(3) {
                println!("   [{}] {}", item.pub_date, item.title);
            }
            // Ekranda görülen hata bir daha geçmemeli.
            assert!(
                !items.iter().any(|i| i.title.contains("2021")),
                "{category}: başka döneme ait haber listede: {:?}",
                items.iter().find(|i| i.title.contains("2021")).map(|i| &i.title)
            );
        }
    }

    /// Türkçe'nin noktalı/noktasız i'si: Rust'ın Unicode kuralı 'I'yı 'i',
    /// 'İ'yi "i + birleşen nokta" yapar. Parmak izi bu farkı silmezse aynı
    /// haber listede iki kez görünür.
    #[test]
    fn fingerprint_flattens_turkish_dotted_and_dotless_i() {
        assert_eq!(fingerprint("AÇIKLANDI"), fingerprint("açıklandı"));
        assert_eq!(fingerprint("İSTANBUL"), fingerprint("istanbul"));
        assert_eq!(fingerprint("TÜFE  yıllık"), fingerprint("tüfe yillik"), "boşluk da sadeleşmeli");
        assert_ne!(fingerprint("enflasyon"), fingerprint("büyüme"), "farklı başlıklar ayrışmalı");
    }
}
