//! Aracı kurum ve banka analiz raporları arşivi.
//!
//! BIST hisseleri için rapor yayımlayan kurumların hepsi aynı biçimde
//! yayımlamaz: İş Yatırım araştırma sitesi WordPress'tir ve RSS verir, Vakıf
//! Yatırım PDF listeleyen bir HTML sayfası tutar, Halk Yatırım rapor gövdesini
//! HTML öznitelik içine kaçırılmış olarak taşır. Bu modül üçünü de tek bir
//! `AnalystReport` kaydına indirger; ekran ve arşiv kaynağın biçimini bilmez.
//!
//! **Küresel bankalar hakkında dürüst not.** JPMorgan, Goldman Sachs, Morgan
//! Stanley gibi kurumların BIST raporları kurumsal aboneliğe kapalıdır; kamuya
//! açık bir uç yoktur. Bu yüzden `scope` alanı kaydın yurt içi mi yurt dışı mı
//! bir kurumdan geldiğini taşır ve küresel kurumların çağrıları ileride haber
//! akışından (`news_tagger`) çıkarılıp aynı kayda dönüştürülebilsin diye
//! `AnalystReport` kaynak-bağımsız tutulmuştur. Uydurma kayıt üretilmez:
//! erişilemeyen kurum arşivde hiç görünmez.
//!
//! Kaynak eklemek `SOURCES` dizisine bir satır ve ona karşılık gelen bir
//! ayrıştırıcıdan ibarettir; çekme, tekilleştirme, hisse eşleme, arşivleme ve
//! kırpma ortaktır.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

/// Arşivde tutulan en fazla rapor (en yeni önde). Eski kayıtlar kırpılır.
const MAX_REPORTS: usize = 4_000;

/// Bir kaynaktan tek turda taranacak en fazla sayfa. WordPress akışları
/// `?paged=N` ile geriye gider; ilk kurulumda arşiv derinliği buradan gelir.
const MAX_PAGES: usize = 12;

const BROWSER_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

/// Raporu yayımlayan kurumun yerleşimi. Ekran "yurt içi/küresel" ayrımını
/// bundan yapar; küresel kurumların kamuya açık akışı olmadığı için bugün
/// arşivde yalnız yurt içi kurumlar bulunur.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BrokerScope {
    #[default]
    Domestic,
    Global,
}

/// Raporun türü. Günlük bültenler hisse bazlı ekranı boğduğu için ayrı
/// sınıflanır; kullanıcı yalnız şirket raporlarını görmek isteyebilir.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReportKind {
    /// Tek şirket hakkında: bilanço analizi, şirket güncelleme, bilgi notu.
    Company,
    /// Sektör raporu.
    Sector,
    /// Strateji / model portföy / piyasa görünümü.
    Strategy,
    /// Günlük veya haftalık bülten.
    Bulletin,
    #[default]
    Other,
}

/// Tek bir analiz raporu.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct AnalystReport {
    /// Rapor adresinin sha256'sı; tekillik anahtarı ve React `key`'i.
    pub id: String,
    /// Kurumun görünen adı ("İş Yatırım").
    pub broker: String,
    pub scope: BrokerScope,
    pub kind: ReportKind,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// Raporun web sayfası.
    pub url: String,
    /// Varsa doğrudan PDF adresi.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pdf_url: Option<String>,
    /// ISO tarih (YYYY-AA-GG).
    pub published: String,
    /// Sıralama için unix saniye.
    pub published_ts: i64,
    /// Rapora bağlanan BIST kodları; boş olabilir (strateji/bülten).
    #[serde(default)]
    pub tickers: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub analyst: Option<String>,
    /// Metinden çıkarılabildiyse tavsiye ("AL", "Endeks Üstü Getiri"…).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rating: Option<String>,
    /// Metinden çıkarılabildiyse hedef fiyat (TL).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_price: Option<f64>,
    /// `SOURCES` içindeki kaynak kimliği.
    pub source_id: String,
}

/// Diskteki arşiv.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ReportArchive {
    pub reports: Vec<AnalystReport>,
    #[serde(default)]
    pub last_updated: Option<String>,
}

// ---------------------------------------------------------------------------
// Kaynak kaydı
// ---------------------------------------------------------------------------

/// Bir kaynağın hangi biçimde yayımladığı.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Feed {
    /// WordPress araştırma blogu: `/feed/` RSS, `?paged=N` sayfalama ve
    /// `/tag/{kod}/feed/` ile hisse bazlı akış. Kod, hisse etiketini RSS
    /// `category` alanlarından okur — başlıktan çıkarmaya göre çok daha sağlam.
    WordPress { base: &'static str },
    /// `listeici` bloklu PDF listesi (Vakıf Yatırım / vkyanaliz.com).
    VakifListing { url: &'static str, base: &'static str },
    /// Rapor gövdesini `data-baslik` / `data-detay` özniteliklerine kaçıran
    /// liste (Halk Yatırım / analizim.halkyatirim.com.tr).
    HalkListing { url: &'static str },
}

#[derive(Clone, Copy, Debug)]
pub struct SourceSpec {
    pub id: &'static str,
    pub broker: &'static str,
    pub scope: BrokerScope,
    pub feed: Feed,
}

/// Taranan kaynaklar. Yeni kurum eklemek buraya bir satır eklemektir; biçimi
/// mevcut üç ayrıştırıcıdan birine uymuyorsa `Feed`'e yeni bir varyant girer.
pub const SOURCES: &[SourceSpec] = &[
    SourceSpec {
        id: "isyatirim",
        broker: "İş Yatırım",
        scope: BrokerScope::Domestic,
        feed: Feed::WordPress { base: "https://arastirma.isyatirim.com.tr" },
    },
    SourceSpec {
        id: "vakif",
        broker: "Vakıf Yatırım",
        scope: BrokerScope::Domestic,
        feed: Feed::VakifListing {
            url: "https://www.vkyanaliz.com/arastirma-raporlari/sirket-raporlari",
            base: "https://www.vkyanaliz.com",
        },
    },
    SourceSpec {
        id: "halk",
        broker: "Halk Yatırım",
        scope: BrokerScope::Domestic,
        feed: Feed::HalkListing {
            url: "https://analizim.halkyatirim.com.tr/Analysis/AnalystRecommendations",
        },
    },
];

// ---------------------------------------------------------------------------
// Metin çıkarımı
// ---------------------------------------------------------------------------

/// HTML etiketlerini ve varlıklarını atıp tek satırlık düz metin bırakır.
fn strip_html(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_tag = false;
    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    let out = decode_entities(&out);
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Kaynaklarda geçen HTML varlıklarını çözer. Halk Yatırım gövdeyi öznitelik
/// içine kaçırdığı için sayısal varlıklar (`&#x131;`) da desteklenir.
fn decode_entities(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(index) = rest.find('&') {
        out.push_str(&rest[..index]);
        rest = &rest[index..];
        // Varlık adı en çok ~10 bayttır; pencere karakter sınırına çekilir,
        // aksi halde çok baytlı bir harfin (ör. 'ş') ortasından dilim alınır.
        let window = (0..=rest.len().min(12)).rev().find(|&n| rest.is_char_boundary(n)).unwrap_or(0);
        let Some(end) = rest[..window].find(';') else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let entity = &rest[1..end];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" | "#39" => Some('\''),
            "nbsp" | "#160" => Some(' '),
            _ => entity
                .strip_prefix('#')
                .and_then(|code| match code.strip_prefix(['x', 'X']) {
                    Some(hex) => u32::from_str_radix(hex, 16).ok(),
                    None => code.parse().ok(),
                })
                .and_then(char::from_u32),
        };
        match decoded {
            Some(ch) => {
                out.push(ch);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// "1.234,56" ya da "455,00" gibi Türkçe biçimli sayıyı çözer.
fn parse_turkish_number(raw: &str) -> Option<f64> {
    let cleaned: String = raw.chars().filter(|c| c.is_ascii_digit() || *c == ',' || *c == '.').collect();
    if cleaned.is_empty() {
        return None;
    }
    // Binlik ayracı nokta, ondalık ayraç virgüldür. Yalnız nokta varsa ve
    // ondalık gibi duruyorsa (tek grup, en çok 2 hane) ondalık kabul edilir.
    let normalized = if cleaned.contains(',') {
        cleaned.replace('.', "").replace(',', ".")
    } else {
        match cleaned.rsplit_once('.') {
            Some((_, tail)) if tail.len() == 3 => cleaned.replace('.', ""),
            _ => cleaned,
        }
    };
    normalized.parse().ok().filter(|value: &f64| value.is_finite() && *value > 0.0)
}

/// Tavsiye sözlüğü: kaynakta geçen kalıp → normalleştirilmiş etiket.
///
/// Sıra önemlidir; uzun kalıp önce denenir, aksi halde "Endeks Üstü Getiri"
/// içindeki "AL" gibi kısa eşleşmeler kazanır.
const RATINGS: &[(&str, &str)] = &[
    ("endeks ustu getiri", "Endeks Üstü Getiri"),
    ("endeks uzeri getiri", "Endeks Üstü Getiri"),
    ("endeksin uzerinde", "Endeks Üstü Getiri"),
    ("endeks alti getiri", "Endeks Altı Getiri"),
    ("endeksin altinda", "Endeks Altı Getiri"),
    ("endekse paralel", "Endekse Paralel"),
    ("outperform", "Endeks Üstü Getiri"),
    ("underperform", "Endeks Altı Getiri"),
    ("overweight", "Endeks Üstü Getiri"),
    ("underweight", "Endeks Altı Getiri"),
    ("market perform", "Endekse Paralel"),
    ("neutral", "Nötr"),
    ("notr", "Nötr"),
];

/// Tek başına geçtiğinde tavsiye sayılan kısa kodlar. Kelime sınırı aranır:
/// "ALARKO" içindeki "AL" tavsiye değildir.
const SHORT_RATINGS: &[(&str, &str)] = &[
    ("al", "AL"),
    ("tut", "TUT"),
    ("sat", "SAT"),
    ("buy", "AL"),
    ("hold", "TUT"),
    ("sell", "SAT"),
];

/// Türkçe harfleri ASCII'ye indirip küçük harfe çevirir (arama anahtarı).
fn fold(input: &str) -> String {
    input
        .chars()
        .map(|c| match c {
            'ç' | 'Ç' => 'c',
            'ğ' | 'Ğ' => 'g',
            'ı' | 'İ' | 'î' | 'Î' => 'i',
            'ö' | 'Ö' => 'o',
            'ş' | 'Ş' => 's',
            'ü' | 'Ü' | 'û' | 'Û' => 'u',
            'â' | 'Â' => 'a',
            other => other,
        })
        .flat_map(char::to_lowercase)
        .collect()
}

/// Metinden tavsiyeyi çıkarır. Bulunamazsa `None` — tavsiye uydurulmaz.
pub fn extract_rating(text: &str) -> Option<String> {
    let folded = fold(text);
    if let Some((_, label)) = RATINGS.iter().find(|(needle, _)| folded.contains(needle)) {
        return Some((*label).to_string());
    }
    // Kısa kodlar yalnız "tavsiye/öneri" bağlamında aranır; serbest metinde
    // geçen "al" fiili tavsiye değildir.
    let context = ["tavsiye", "oneri", "onerimiz", "rating", "recommendation"]
        .iter()
        .filter_map(|marker| folded.find(marker))
        .min()?;
    let window = &folded[context..folded.len().min(context + 80)];
    SHORT_RATINGS
        .iter()
        .find(|(needle, _)| {
            window.split(|c: char| !c.is_alphanumeric()).any(|word| word == *needle)
        })
        .map(|(_, label)| (*label).to_string())
}

/// Metinden hedef fiyatı çıkarır.
///
/// "hedef fiyat" ifadesinden sonraki ilk sayı alınır; araya "12 aylık" gibi
/// nitelemeler girebildiği için yalnız TL/hisse ile biten ya da makul
/// büyüklükteki sayılar kabul edilir.
pub fn extract_target_price(text: &str) -> Option<f64> {
    let folded = fold(text);
    let anchor = ["hedef fiyat", "hedef deger", "target price"]
        .iter()
        .filter_map(|marker| folded.find(marker))
        .min()?;
    let window = &folded[anchor..folded.len().min(anchor + 160)];
    // "12 aylık", "2026 yıl sonu" gibi nitelemeler sayı gibi görünür; TL ile
    // biten ya da ondalıklı olan ilk sayı hedef fiyattır.
    let mut fallback = None;
    for capture in number_spans(window) {
        let Some(value) = parse_turkish_number(capture.text) else { continue };
        let tail = window[capture.end..].trim_start();
        let is_price = tail.starts_with("tl") || capture.text.contains(',');
        // Ay/yıl nitelemeleri elenir.
        if tail.starts_with("ayl") || tail.starts_with("yil") || tail.starts_with("ay ") {
            continue;
        }
        if is_price {
            return Some(value);
        }
        fallback.get_or_insert(value);
    }
    fallback
}

struct NumberSpan<'a> {
    text: &'a str,
    end: usize,
}

/// Metindeki sayı benzeri parçaları sırayla verir (rakam, nokta, virgül).
fn number_spans(text: &str) -> Vec<NumberSpan<'_>> {
    let bytes = text.as_bytes();
    let mut spans = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        if !bytes[index].is_ascii_digit() {
            index += 1;
            continue;
        }
        let start = index;
        while index < bytes.len()
            && (bytes[index].is_ascii_digit()
                // Ayraç yalnız iki rakam arasındaysa sayının parçasıdır.
                || ((bytes[index] == b',' || bytes[index] == b'.')
                    && index + 1 < bytes.len()
                    && bytes[index + 1].is_ascii_digit()))
        {
            index += 1;
        }
        spans.push(NumberSpan { text: &text[start..index], end: index });
    }
    spans
}

/// Rapora konu BIST kodlarını çıkarır.
///
/// Üç yol denenir ve hepsi `universe` ile doğrulanır — evrende olmayan bir kod
/// asla üretilmez: RSS etiketleri (kurumun kendi verdiği kod), başlıktaki
/// `-KOD.IS:` / `-KOD:` kalıbı ve unvandan `company_match` eşlemesi.
pub fn extract_tickers(title: &str, tags: &[String], universe: &HashSet<String>) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    let push = |code: String, found: &mut Vec<String>| {
        if universe.contains(&code) && !found.contains(&code) {
            found.push(code);
        }
    };

    for tag in tags {
        let candidate = tag.trim().to_uppercase();
        if candidate.len() >= 3 && candidate.len() <= 6 && candidate.chars().all(|c| c.is_ascii_uppercase()) {
            push(candidate, &mut found);
        }
    }

    // "Şirket Raporu: Türk Havayolları-THYAO.IS: Şirket Güncelleme"
    for chunk in title.split(['-', ':', ' ', '(', ')', ',', '/']) {
        let candidate = chunk.trim().trim_end_matches(".IS").trim().to_uppercase();
        if candidate.len() >= 3 && candidate.len() <= 6 && candidate.chars().all(|c| c.is_ascii_uppercase()) {
            push(candidate, &mut found);
        }
    }

    if found.is_empty() {
        // Kod yoksa unvandan eşle: "Şirket Bilgi Notu | Akfen Yenilenebilir Enerji"
        let name = title
            .rsplit(['|', ':'])
            .next()
            .unwrap_or(title)
            .split('-')
            .next()
            .unwrap_or(title)
            .trim();
        if let Some(code) = crate::company_match::bist_ticker_for(name) {
            push(code.to_string(), &mut found);
        }
    }

    found
}

/// Başlık ve etiketlerden rapor türünü belirler.
pub fn classify(title: &str, tags: &[String]) -> ReportKind {
    let hay = fold(&format!("{title} {}", tags.join(" ")));
    if hay.contains("bulten") || hay.contains("gunluk rapor") || hay.contains("haftalik rapor") {
        return ReportKind::Bulletin;
    }
    if hay.contains("sektor") {
        return ReportKind::Sector;
    }
    if hay.contains("strateji") || hay.contains("model portfoy") || hay.contains("piyasa gorunum") {
        return ReportKind::Strategy;
    }
    if hay.contains("sirket raporu")
        || hay.contains("sirket guncelleme")
        || hay.contains("sirket bilgi notu")
        || hay.contains("kar analizi")
        || hay.contains("sonuclari")
        || hay.contains("bilanco")
    {
        return ReportKind::Company;
    }
    ReportKind::Other
}

/// Adresin sha256'sı; arşivde tekillik anahtarı.
fn report_id(url: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(url.as_bytes());
    digest.iter().take(12).map(|byte| format!("{byte:02x}")).collect()
}

/// Türkçe ay adlı tarihi ("04 Kasım 2025") ISO'ya çevirir.
fn parse_turkish_date(raw: &str) -> Option<(String, i64)> {
    const MONTHS: &[&str] = &[
        "ocak", "subat", "mart", "nisan", "mayis", "haziran",
        "temmuz", "agustos", "eylul", "ekim", "kasim", "aralik",
    ];
    let folded = fold(raw);
    let parts: Vec<&str> = folded.split_whitespace().collect();
    if parts.len() < 3 {
        return None;
    }
    let day: u32 = parts[0].parse().ok()?;
    let month = MONTHS.iter().position(|name| parts[1].starts_with(name))? as u32 + 1;
    let year: i32 = parts[2].parse().ok()?;
    iso_from_ymd(year, month, day)
}

fn iso_from_ymd(year: i32, month: u32, day: u32) -> Option<(String, i64)> {
    use chrono::TimeZone;
    let date = chrono::Utc.with_ymd_and_hms(year, month, day, 0, 0, 0).single()?;
    Some((date.format("%Y-%m-%d").to_string(), date.timestamp()))
}

// ---------------------------------------------------------------------------
// Ayrıştırıcılar
// ---------------------------------------------------------------------------

/// WordPress araştırma akışını (RSS) raporlara çevirir.
pub fn parse_wordpress_feed(
    xml: &[u8],
    spec: &SourceSpec,
    universe: &HashSet<String>,
) -> Result<Vec<AnalystReport>, String> {
    let channel = rss::Channel::read_from(xml)
        .map_err(|error| format!("{} RSS çözümlenemedi: {error}", spec.broker))?;

    let mut reports = Vec::new();
    for item in channel.items() {
        let (Some(title), Some(link)) = (item.title(), item.link()) else { continue };
        let tags: Vec<String> = item.categories().iter().map(|c| c.name().to_string()).collect();
        let body = item.content().or_else(|| item.description()).unwrap_or_default();
        let summary = strip_html(body);
        let (published, published_ts) = item
            .pub_date()
            .and_then(|raw| chrono::DateTime::parse_from_rfc2822(raw).ok())
            .map(|date| (date.format("%Y-%m-%d").to_string(), date.timestamp()))
            .unwrap_or_else(|| (String::new(), 0));

        // Rapor gövdesindeki ilk PDF eki, raporun kendisidir.
        let pdf_url = find_first_pdf(body);
        let haystack = format!("{title} {summary}");

        reports.push(AnalystReport {
            id: report_id(link),
            broker: spec.broker.to_string(),
            scope: spec.scope,
            kind: classify(title, &tags),
            title: strip_html(title),
            summary: (!summary.is_empty()).then(|| truncate(&summary, 400)),
            url: link.to_string(),
            pdf_url,
            published,
            published_ts,
            tickers: extract_tickers(title, &tags, universe),
            analyst: item
                .dublin_core_ext()
                .and_then(|ext| ext.creators().first().cloned()),
            rating: extract_rating(&haystack),
            target_price: extract_target_price(&haystack),
            source_id: spec.id.to_string(),
        });
    }
    Ok(reports)
}

fn find_first_pdf(body: &str) -> Option<String> {
    let decoded = decode_entities(body);
    let lower = decoded.to_lowercase();
    let position = lower.find(".pdf")?;
    let start = decoded[..position].rfind("http")?;
    Some(decoded[start..position + 4].to_string())
}

fn truncate(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let mut out: String = text.chars().take(limit).collect();
    out.push('…');
    out
}

/// Vakıf Yatırım'ın `listeici` bloklu PDF listesini ayrıştırır.
pub fn parse_vakif_listing(
    html: &str,
    base: &str,
    spec: &SourceSpec,
    universe: &HashSet<String>,
) -> Vec<AnalystReport> {
    let mut reports = Vec::new();
    for block in html.split(r#"class="listeici""#).skip(1) {
        // Blok sınırı: bir sonraki listeici zaten split ile ayrıldı.
        let Some(pdf_rel) = attribute_after(block, "indirikonu", "href=\"") else { continue };
        let title = attribute_after(block, "yazigrubu", "title=\"")
            .or_else(|| tag_text(block, "yazigrubu"))
            .unwrap_or_default();
        if title.is_empty() {
            continue;
        }
        let date_raw = tag_text(block, "yayintarih").unwrap_or_default();
        let Some((published, published_ts)) = parse_turkish_date(&date_raw) else { continue };

        let pdf_url = if pdf_rel.starts_with("http") {
            pdf_rel.clone()
        } else {
            format!("{}/{}", base.trim_end_matches('/'), pdf_rel.trim_start_matches('/'))
        };
        let title = decode_entities(&title);

        reports.push(AnalystReport {
            id: report_id(&pdf_url),
            broker: spec.broker.to_string(),
            scope: spec.scope,
            kind: classify(&title, &[]),
            tickers: extract_tickers(&title, &[], universe),
            rating: extract_rating(&title),
            target_price: extract_target_price(&title),
            title,
            summary: None,
            url: pdf_url.clone(),
            pdf_url: Some(pdf_url),
            published,
            published_ts,
            analyst: None,
            source_id: spec.id.to_string(),
        });
    }
    reports
}

/// `<span class="X" ...>METİN</span>` içindeki metni verir.
fn tag_text<'a>(block: &'a str, class: &str) -> Option<String> {
    let start = block.find(class)?;
    let rest = &block[start..];
    // Sınıftan sonraki ilk '>' açılış etiketini kapatır; metin ondan sonra
    // başlar ama araya iç etiketler (ör. <a>) girebilir.
    let open = rest.find('>')? + 1;
    let close = rest.find("</span>")?;
    (close > open).then(|| strip_html(&rest[open..close]))
}

/// Bloğun `marker` sınıfından sonraki ilk `attr` değerini verir.
fn attribute_after(block: &str, marker: &str, attr: &str) -> Option<String> {
    let start = block.find(marker)?;
    let rest = &block[start..];
    let at = rest.find(attr)? + attr.len();
    let end = rest[at..].find('"')?;
    Some(rest[at..at + end].to_string())
}

/// Halk Yatırım listesini ayrıştırır: başlık `data-baslik`, PDF adresi
/// `data-detay` içine HTML olarak kaçırılmış bağlantıdadır.
pub fn parse_halk_listing(
    html: &str,
    spec: &SourceSpec,
    universe: &HashSet<String>,
) -> Vec<AnalystReport> {
    let mut reports = Vec::new();
    for block in html.split("data-baslik=").skip(1) {
        let Some(title) = quoted_value(block) else { continue };
        let Some(detail_start) = block.find("data-detay=") else { continue };
        let Some(detail) = quoted_value(&block[detail_start + "data-detay=".len()..]) else {
            continue;
        };
        let detail = decode_entities(&decode_entities(&detail));
        let Some(pdf_url) = find_first_pdf(&detail) else { continue };
        let title = decode_entities(&title);

        // Tarih rapor adresinin dosya adında taşınır: "… 07.08.2026.pdf".
        let Some((published, published_ts)) = date_from_filename(&pdf_url) else { continue };

        reports.push(AnalystReport {
            id: report_id(&pdf_url),
            broker: spec.broker.to_string(),
            scope: spec.scope,
            kind: classify(&title, &[]),
            tickers: extract_tickers(&title, &[], universe),
            rating: extract_rating(&title),
            target_price: extract_target_price(&title),
            title,
            summary: None,
            url: pdf_url.clone(),
            pdf_url: Some(pdf_url),
            published,
            published_ts,
            analyst: None,
            source_id: spec.id.to_string(),
        });
    }
    reports
}

/// `'…'` ya da `"…"` ile sarılı ilk değeri verir.
fn quoted_value(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let quote = *bytes.first()?;
    if quote != b'\'' && quote != b'"' {
        return None;
    }
    let rest = &input[1..];
    let end = rest.find(quote as char)?;
    Some(rest[..end].to_string())
}

/// Dosya adındaki "GG.AA.YYYY" ya da "%20GG.AA.YYYY" tarihini çözer.
fn date_from_filename(url: &str) -> Option<(String, i64)> {
    let decoded = url.replace("%20", " ");
    let bytes = decoded.as_bytes();
    // Sondan başa doğru ilk "d.m.yyyy" kalıbı aranır. Dosya adı Türkçe harf
    // taşıyabildiği için dilim yalnız karakter sınırından alınır.
    for start in (0..bytes.len()).rev() {
        if !bytes[start].is_ascii_digit() || !decoded.is_char_boundary(start) {
            continue;
        }
        let candidate: String = decoded[start..]
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '.')
            .collect();
        let parts: Vec<&str> = candidate.split('.').collect();
        if parts.len() < 3 {
            continue;
        }
        let (Ok(day), Ok(month), Ok(year)) = (
            parts[0].parse::<u32>(),
            parts[1].parse::<u32>(),
            parts[2].parse::<i32>(),
        ) else {
            continue;
        };
        if (1..=31).contains(&day) && (1..=12).contains(&month) && (2000..=2100).contains(&year) {
            return iso_from_ymd(year, month, day);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Arşiv
// ---------------------------------------------------------------------------

fn archive_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|home| home.join(".fraude_research_reports.json"))
}

pub fn load() -> ReportArchive {
    archive_path()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|data| serde_json::from_str(&data).ok())
        .unwrap_or_default()
}

pub fn save(archive: &ReportArchive) {
    let Some(path) = archive_path() else { return };
    let _ = crate::persist::write_json_atomic(&path, archive);
}

/// Yeni raporları arşive işler; eklenen kayıt sayısını döndürür.
///
/// Tekillik anahtarı `id` (rapor adresi). Aynı rapor ikinci turda yeniden
/// gelirse **güncellenir**, çoğalmaz: kurum başlığı düzeltebilir ya da PDF'i
/// sonradan ekleyebilir.
pub fn merge(archive: &mut ReportArchive, incoming: Vec<AnalystReport>) -> usize {
    let mut added = 0;
    for report in incoming {
        match archive.reports.iter_mut().find(|existing| existing.id == report.id) {
            Some(existing) => *existing = report,
            None => {
                archive.reports.push(report);
                added += 1;
            }
        }
    }
    archive.reports.sort_by(|a, b| b.published_ts.cmp(&a.published_ts));
    archive.reports.truncate(MAX_REPORTS);
    archive.last_updated = Some(chrono::Utc::now().to_rfc3339());
    added
}

// ---------------------------------------------------------------------------
// Çekme
// ---------------------------------------------------------------------------

async fn get_text(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let response = client
        .get(url)
        .timeout(std::time::Duration::from_secs(20))
        .header("User-Agent", BROWSER_UA)
        .header("Accept-Language", "tr-TR,tr;q=0.9")
        .send()
        .await
        .map_err(|error| format!("{url}: {error}"))?;
    crate::retry::check_status(response, url)?
        .text()
        .await
        .map_err(|error| format!("{url}: {error}"))
}

/// Tek bir kaynağı tarar.
pub async fn fetch_source(
    client: &reqwest::Client,
    spec: &SourceSpec,
    universe: &HashSet<String>,
    pages: usize,
) -> Result<Vec<AnalystReport>, String> {
    match spec.feed {
        Feed::WordPress { base } => {
            let mut all = Vec::new();
            for page in 1..=pages.max(1).min(MAX_PAGES) {
                let url = if page == 1 {
                    format!("{base}/feed/")
                } else {
                    format!("{base}/feed/?paged={page}")
                };
                // Sayfa tükendiğinde WordPress 404 verir; bu hata değil, sondur.
                let Ok(body) = get_text(client, &url).await else { break };
                let reports = parse_wordpress_feed(body.as_bytes(), spec, universe)?;
                if reports.is_empty() {
                    break;
                }
                all.extend(reports);
            }
            Ok(all)
        }
        Feed::VakifListing { url, base } => {
            let html = get_text(client, url).await?;
            Ok(parse_vakif_listing(&html, base, spec, universe))
        }
        Feed::HalkListing { url } => {
            let html = get_text(client, url).await?;
            Ok(parse_halk_listing(&html, spec, universe))
        }
    }
}

/// Tek bir hissenin raporlarını kurumun etiket akışından çeker.
///
/// Arşiv taraması geriye doğru sınırlıdır; kullanıcı bir hisseyi açtığında o
/// hissenin geçmişi tam istenir. WordPress `/tag/{kod}/feed/` bunu tek istekte
/// verir, arşivin tamamını taramaya gerek kalmaz.
pub async fn fetch_ticker_feed(
    client: &reqwest::Client,
    ticker: &str,
    universe: &HashSet<String>,
) -> Vec<AnalystReport> {
    let code = ticker.trim().trim_end_matches(".IS").to_lowercase();
    if code.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    for spec in SOURCES {
        let Feed::WordPress { base } = spec.feed else { continue };
        let url = format!("{base}/tag/{code}/feed/");
        let Ok(body) = get_text(client, &url).await else { continue };
        if let Ok(reports) = parse_wordpress_feed(body.as_bytes(), spec, universe) {
            out.extend(reports);
        }
    }
    out.sort_by(|a, b| b.published_ts.cmp(&a.published_ts));
    out
}

/// Bütün kaynakları tarar, arşive işler ve arşivi diske yazar.
///
/// Bir kaynağın düşmesi diğerlerini düşürmez: hatalar toplanıp döndürülür,
/// başarılı kaynakların kayıtları yine de arşive girer.
pub async fn refresh(client: &reqwest::Client, deep: bool) -> (usize, Vec<String>) {
    let universe: HashSet<String> = crate::bist_universe::load(client)
        .await
        .into_iter()
        .map(|(code, _)| code)
        .collect();

    let pages = if deep { MAX_PAGES } else { 2 };
    let mut archive = load();
    let mut added = 0;
    let mut errors = Vec::new();

    for spec in SOURCES {
        match fetch_source(client, spec, &universe, pages).await {
            Ok(reports) => added += merge(&mut archive, reports),
            Err(error) => errors.push(format!("{}: {error}", spec.broker)),
        }
    }

    save(&archive);
    (added, errors)
}

/// Arşivden bir hissenin raporlarını süzer.
pub fn for_ticker(archive: &ReportArchive, ticker: &str) -> Vec<AnalystReport> {
    // Sağlayıcı eki büyük/küçük harfli gelebilir; önce büyütülür sonra atılır.
    let upper = ticker.trim().to_uppercase();
    let code = upper.trim_end_matches(".IS");
    archive
        .reports
        .iter()
        .filter(|report| report.tickers.iter().any(|t| t == code))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn universe() -> HashSet<String> {
        ["THYAO", "HEPS", "OYAKC", "EREGL", "AKFYE", "ASELS", "GARAN"]
            .into_iter()
            .map(String::from)
            .collect()
    }

    fn spec() -> SourceSpec {
        SOURCES[0]
    }

    #[test]
    fn turkish_numbers_and_dates_parse() {
        assert_eq!(parse_turkish_number("455,00"), Some(455.0));
        assert_eq!(parse_turkish_number("1.234,56"), Some(1234.56));
        assert_eq!(parse_turkish_number("1.234"), Some(1234.0));
        assert_eq!(parse_turkish_number("58.30"), Some(58.30));
        assert_eq!(parse_turkish_number("abc"), None);

        let (iso, ts) = parse_turkish_date("04 Kasım 2025").unwrap();
        assert_eq!(iso, "2025-11-04");
        assert!(ts > 0);
        assert!(parse_turkish_date("bugün").is_none());
    }

    /// Hisse kodu yalnız evrende varsa üretilir; başlıktaki rastgele büyük
    /// harfli kelime kod sanılmaz.
    #[test]
    fn tickers_come_from_tags_title_and_company_name() {
        let tags = vec!["Şirket Raporları".into(), "THYAO".into(), "şirket güncelleme".into()];
        assert_eq!(
            extract_tickers("Şirket Raporu: Türk Havayolları-THYAO.IS: Şirket Güncelleme", &tags, &universe()),
            vec!["THYAO".to_string()]
        );
        // Etiket yoksa başlıktaki koddan.
        assert_eq!(
            extract_tickers("Şirket Raporu: Oyak Çimento-OYAKC.IS: 2Ç26 Sonuçları", &[], &universe()),
            vec!["OYAKC".to_string()]
        );
        // Evrende olmayan kod üretilmez.
        assert!(extract_tickers("Şirket Raporu: Filanca-ZZZZZ.IS", &[], &universe()).is_empty());
        // Kodsuz başlık: strateji raporu hisseye bağlanmaz.
        assert!(extract_tickers("Haftalık Strateji Bülteni", &[], &universe()).is_empty());
    }

    #[test]
    fn ratings_need_context_and_beat_substrings() {
        assert_eq!(extract_rating("Tavsiyemizi Endeks Üstü Getiri olarak koruyoruz"), Some("Endeks Üstü Getiri".into()));
        assert_eq!(extract_rating("Öneri: AL"), Some("AL".into()));
        assert_eq!(extract_rating("tavsiye TUT"), Some("TUT".into()));
        // "ALARKO" içindeki AL tavsiye değildir.
        assert_eq!(extract_rating("ALARKO Holding bilanço analizi"), None);
        // Bağlamsız serbest metinde tavsiye aranmaz.
        assert_eq!(extract_rating("Şirket yeni sipariş aldı"), None);
    }

    #[test]
    fn target_price_skips_qualifiers() {
        assert_eq!(extract_target_price("12 aylık hedef fiyatımızı 455,00 TL'ye yükseltiyoruz"), Some(455.0));
        assert_eq!(extract_target_price("Hedef fiyat: 58,30 TL"), Some(58.30));
        assert_eq!(extract_target_price("hedef fiyat 1.234,56 TL"), Some(1234.56));
        assert_eq!(extract_target_price("Şirketin cirosu 22,8 milyar TL oldu"), None);
    }

    #[test]
    fn kinds_are_classified() {
        assert_eq!(classify("Şirket Raporu: THYAO: 2Ç26 Sonuçları", &[]), ReportKind::Company);
        assert_eq!(classify("ELUS Günlük Bülten 07.08.2026", &[]), ReportKind::Bulletin);
        assert_eq!(classify("Bankacılık Sektör Raporu Haziran", &[]), ReportKind::Sector);
        assert_eq!(classify("Model Portföy Güncellemesi", &[]), ReportKind::Strategy);
    }

    /// İş Yatırım akışının gerçek biçimi (2026-08-07 çekimi sadeleştirildi).
    #[test]
    fn wordpress_feed_maps_to_reports() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>İş Yatırım</title><link>https://arastirma.isyatirim.com.tr</link><description>x</description>
<item>
<title>Şirket Raporu: Türk Havayolları-THYAO.IS: Şirket Güncelleme</title>
<link>https://arastirma.isyatirim.com.tr/2026/08/07/sirket-raporu-turk-havayollari/</link>
<pubDate>Fri, 07 Aug 2026 12:37:12 +0000</pubDate>
<dc:creator>Alihan Gurleyen</dc:creator>
<category>Şirket Raporları</category><category>THYAO</category>
<content:encoded>&lt;p&gt;Tavsiyemizi AL olarak koruyor, 12 aylık hedef fiyatımızı 455,00 TL seviyesine yükseltiyoruz.&lt;/p&gt;&lt;a href="https://arastirma.isyatirim.com.tr/wp-content/uploads/2026/08/THYAO.pdf"&gt;Rapor&lt;/a&gt;</content:encoded>
</item>
</channel></rss>"#;
        let reports = parse_wordpress_feed(xml.as_bytes(), &spec(), &universe()).unwrap();
        assert_eq!(reports.len(), 1);
        let report = &reports[0];
        assert_eq!(report.broker, "İş Yatırım");
        assert_eq!(report.tickers, vec!["THYAO".to_string()]);
        assert_eq!(report.published, "2026-08-07");
        assert_eq!(report.analyst.as_deref(), Some("Alihan Gurleyen"));
        assert_eq!(report.kind, ReportKind::Company);
        assert_eq!(report.rating.as_deref(), Some("AL"));
        assert_eq!(report.target_price, Some(455.0));
        assert_eq!(
            report.pdf_url.as_deref(),
            Some("https://arastirma.isyatirim.com.tr/wp-content/uploads/2026/08/THYAO.pdf")
        );
        assert!(report.summary.as_deref().unwrap().contains("hedef fiyat"));
    }

    /// Vakıf Yatırım listesinin gerçek biçimi (vkyanaliz.com çekimi sadeleştirildi).
    #[test]
    fn vakif_listing_maps_to_reports() {
        let html = r#"
<div class="col-xs-6"><div class="listeici">
<span class="yazigrubu">Şirket Bilgi Notu | Akfen Yenileneb ...</span>
<span class="pdfikonu"><a href="arastirma-raporu/x" title="Şirket Bilgi Notu | Akfen Yenilenebilir Enerji"><img src="a.png"></a></span>
<span class="yayintarih"><a href="arastirma-raporu/x">04 Kasım 2025</a></span>
<span class="indirikonu"><a target="_blank" href="/Files/docs/sirket-bilgi-notu-akfen-yenilenebilir-enerji-1762262479.pdf" class="btn"><i class="fa"></i></a></span>
</div></div>"#;
        let spec = SOURCES[1];
        let Feed::VakifListing { base, .. } = spec.feed else { panic!("beklenen kaynak biçimi") };
        let reports = parse_vakif_listing(html, base, &spec, &universe());
        assert_eq!(reports.len(), 1);
        let report = &reports[0];
        assert_eq!(report.broker, "Vakıf Yatırım");
        assert_eq!(report.published, "2025-11-04");
        assert_eq!(
            report.pdf_url.as_deref(),
            Some("https://www.vkyanaliz.com/Files/docs/sirket-bilgi-notu-akfen-yenilenebilir-enerji-1762262479.pdf")
        );
        assert_eq!(report.kind, ReportKind::Company);
    }

    /// Halk Yatırım gövdeyi öznitelik içine kaçırır; tarih PDF adındadır.
    #[test]
    fn halk_listing_maps_to_reports() {
        let html = r##"<a data-toggle="modal" data-baslik='Finansal Radar' data-detay='&lt;a href=&#x27;https://www.halkyatirim.com.tr//pdf/2026/8/4503_Finansal%20Radar%2007.08.2026.pdf&#x27; class=&#x27;mylink&#x27;&gt;Linke T&#x131;klay&#x131;n&#x131;z&lt;/a&gt;' href="#modal-one">Finansal Radar</a>"##;
        let spec = SOURCES[2];
        let reports = parse_halk_listing(html, &spec, &universe());
        assert_eq!(reports.len(), 1, "tek rapor beklenir: {reports:?}");
        assert_eq!(reports[0].broker, "Halk Yatırım");
        assert_eq!(reports[0].title, "Finansal Radar");
        assert_eq!(reports[0].published, "2026-08-07");
        assert!(reports[0].pdf_url.as_deref().unwrap().ends_with(".pdf"));
    }

    /// Aynı rapor ikinci turda çoğalmaz, güncellenir.
    #[test]
    fn merge_is_idempotent_and_sorts_newest_first() {
        let mut archive = ReportArchive::default();
        let older = AnalystReport { id: "a".into(), published_ts: 100, title: "eski".into(), ..Default::default() };
        let newer = AnalystReport { id: "b".into(), published_ts: 200, title: "yeni".into(), ..Default::default() };
        assert_eq!(merge(&mut archive, vec![older.clone(), newer.clone()]), 2);
        assert_eq!(merge(&mut archive, vec![older.clone(), newer.clone()]), 0);
        assert_eq!(archive.reports.len(), 2);
        assert_eq!(archive.reports[0].id, "b", "en yeni önde olmalı");

        let corrected = AnalystReport { title: "düzeltildi".into(), ..older };
        assert_eq!(merge(&mut archive, vec![corrected]), 0);
        assert_eq!(archive.reports.iter().find(|r| r.id == "a").unwrap().title, "düzeltildi");
    }

    #[test]
    fn for_ticker_filters_by_code() {
        let archive = ReportArchive {
            reports: vec![
                AnalystReport { id: "1".into(), tickers: vec!["THYAO".into()], ..Default::default() },
                AnalystReport { id: "2".into(), tickers: vec!["EREGL".into()], ..Default::default() },
            ],
            last_updated: None,
        };
        assert_eq!(for_ticker(&archive, "THYAO").len(), 1);
        assert_eq!(for_ticker(&archive, "thyao.is").len(), 1);
        assert_eq!(for_ticker(&archive, "ASELS").len(), 0);
    }

    /// Her kaynak canlıda gerçekten rapor döndürmeli. Sabit fikstür, sitenin
    /// düzeni değiştiğinde sessizce boş dönmeyi yakalayamaz; bu test yakalar.
    #[tokio::test]
    #[ignore = "requires live broker site access"]
    async fn live_sources_return_reports() {
        let client = reqwest::Client::new();
        let universe: HashSet<String> = crate::bist_universe::load(&client)
            .await
            .into_iter()
            .map(|(code, _)| code)
            .collect();
        assert!(!universe.is_empty(), "BIST evreni boş");

        for spec in SOURCES {
            let reports = fetch_source(&client, spec, &universe, 2)
                .await
                .unwrap_or_else(|error| panic!("{} çekilemedi: {error}", spec.broker));
            assert!(!reports.is_empty(), "{} hiç rapor döndürmedi", spec.broker);
            let dated = reports.iter().filter(|r| !r.published.is_empty()).count();
            assert!(dated > 0, "{}: hiçbir raporda tarih yok", spec.broker);
            println!(
                "{}: {} rapor, {} tanesi hisseye bağlı, örnek: {}",
                spec.broker,
                reports.len(),
                reports.iter().filter(|r| !r.tickers.is_empty()).count(),
                reports[0].title
            );
        }
    }

    /// Hisse bazlı etiket akışı gerçekten o hissenin raporlarını vermeli.
    #[tokio::test]
    #[ignore = "requires live broker site access"]
    async fn live_ticker_feed_is_scoped_to_the_ticker() {
        let client = reqwest::Client::new();
        let universe: HashSet<String> = crate::bist_universe::load(&client)
            .await
            .into_iter()
            .map(|(code, _)| code)
            .collect();
        let reports = fetch_ticker_feed(&client, "THYAO", &universe).await;
        assert!(!reports.is_empty(), "THYAO etiket akışı boş");
        assert!(
            reports.iter().any(|r| r.tickers.iter().any(|t| t == "THYAO")),
            "akıştaki hiçbir rapor THYAO'ya bağlanmadı"
        );
        for report in reports.iter().take(5) {
            println!("{} | {} | {}", report.published, report.broker, report.title);
        }
    }

    /// Kaynak kimlikleri benzersiz olmalı; arşiv kaydı `source_id` ile eşlenir.
    #[test]
    fn source_ids_are_unique() {
        let ids: HashSet<&str> = SOURCES.iter().map(|s| s.id).collect();
        assert_eq!(ids.len(), SOURCES.len());
    }
}
