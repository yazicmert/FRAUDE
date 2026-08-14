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
fn fingerprint(title: &str) -> String {
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
        for category in ["inflation rate", "interest rate", "current account", "balance of trade"] {
            let items = get_calendar_event_news(&client, category, "", &recent, "tr").await;
            println!("{category} → {} haber", items.len());
            if let Some(first) = items.first() {
                println!("   ör: {} [{}]", first.title, first.source);
            }
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
