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
///
/// Sınır kaynakların gerçek derinliğine göre konur: yalnız Garanti'nin arşivi
/// 6.880 kayıt, Ziraat'inki 892. Eski 4.000'lik sınır tek bir kaynağı bile
/// almaya yetmiyordu.
const MAX_REPORTS: usize = 12_000;

/// Günlük tazelemede taranan sayfa sayısı. Yeni raporlar akışın başına
/// eklendiği için birkaç sayfa yeter; derinlik `deep_pages` ile ayrı gelir.
const INCREMENTAL_PAGES: usize = 3;

/// Derin taramada aynı anda kaç sayfa çekileceği.
///
/// Garanti'nin arşivi 380 sayfa; teker teker çekmek ilk kurulumu dakikalara
/// yayıyor. Sayfalar birbirinden bağımsız olduğu için bir arada istenir —
/// eşzamanlılık kaynağı yormayacak kadar düşük tutulur.
const PAGE_CONCURRENCY: usize = 4;

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

/// Ayrıştırıcı sürümü. Kaynak eklendiğinde ya da bir alanın çıkarımı
/// düzeltildiğinde artırılır: diskteki arşiv eski sürümdeyse atılıp baştan
/// kurulur, yoksa yalnız yeni gelen kayıtlar düzelir ve geçmiş bozuk kalır.
pub const PARSER_VERSION: u32 = 2;

/// Diskteki arşiv.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ReportArchive {
    pub reports: Vec<AnalystReport>,
    #[serde(default)]
    pub last_updated: Option<String>,
    #[serde(default)]
    pub parser_version: u32,
}

// ---------------------------------------------------------------------------
// Kaynak kaydı
// ---------------------------------------------------------------------------

/// Bir kaynağın hangi biçimde yayımladığı.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Feed {
    /// WordPress araştırma blogu: `/feed/` RSS ve `?paged=N` sayfalama.
    /// Kod, hisse etiketini RSS `category` alanlarından okur — başlıktan
    /// çıkarmaya göre çok daha sağlam; kategori kod taşımayan sitelerde
    /// (Marbaş, A1) başlıktan çıkarıma düşer.
    ///
    /// `tag_feeds`: site `/tag/{kod}/feed/` ile hisse bazlı akış veriyor mu.
    /// Yalnız İş Yatırım veriyor; diğerlerinde bu yol 404 döndüğü için
    /// hisse açılışında boşuna istek atılmaz.
    WordPress { base: &'static str, tag_feeds: bool },
    /// `listeici` bloklu PDF listesi (Vakıf Yatırım / vkyanaliz.com).
    VakifListing { url: &'static str, base: &'static str },
    /// Rapor gövdesini `data-baslik` / `data-detay` özniteliklerine kaçıran
    /// liste (Halk Yatırım / analizim.halkyatirim.com.tr).
    HalkListing { url: &'static str },
    /// Garanti BBVA Yatırım'ın araştırma ucu: JSON döner, sayfa numarası
    /// gövdede değil **`Page` başlığında** taşınır.
    GarantiJson { url: &'static str },
    /// Ziraat Yatırım'ın Umbraco "Clockwork" belge ucu: JSON gövdeli POST'a
    /// karşılık HTML parçası döndürür. `category_id` şirket raporları
    /// klasörüdür; alt kategoriler (hisse bazlı) `CheckSubCategory` ile gelir.
    ZiraatClockwork { url: &'static str, base: &'static str, category_id: &'static str },
    /// Gedik Yatırım: sayfa Next.js ile sunulur ve bütün rapor listesi
    /// `__NEXT_DATA__` betiğinde gömülü gelir; ayrı bir uç çağrılmaz.
    GedikNextData { url: &'static str },
    /// Ahlatcı Yatırım: `ar-entry` bloklu zaman çizelgesi, `?sayfa=N` ile
    /// geriye gider. Dosya adı BIST kodunu taşır.
    AhlatciTimeline { url: &'static str, base: &'static str },
    /// PhillipCapital: `product-item` kartları; başlık, tarih ve kategori ayrı
    /// alanlarda durur, `?page=N` ile geriye gider. Dosya adı GUID olduğu için
    /// kod yalnız başlıktan çıkar.
    PhillipCards { url: &'static str, base: &'static str },
    /// Integral Yatırım: `card-title` blokları; sayfa numarası sorgu dizesinde
    /// değil **yolun sonunda** durur (`…/sirket-sektor-raporlari/p2`).
    IntegralCards { url: &'static str, base: &'static str },
}

impl Feed {
    /// Kaynağın ana adresi — beyaz liste denetiminde kullanılır.
    pub fn primary_url(&self) -> &'static str {
        match *self {
            Feed::WordPress { base, .. } => base,
            Feed::VakifListing { url, .. }
            | Feed::HalkListing { url }
            | Feed::GarantiJson { url }
            | Feed::ZiraatClockwork { url, .. }
            | Feed::GedikNextData { url }
            | Feed::AhlatciTimeline { url, .. }
            | Feed::PhillipCards { url, .. }
            | Feed::IntegralCards { url, .. } => url,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct SourceSpec {
    pub id: &'static str,
    pub broker: &'static str,
    pub scope: BrokerScope,
    pub feed: Feed,
    /// Derin taramada bu kaynaktan kaç sayfa istenecek.
    ///
    /// Kaynakların sayfa boyu ve arşiv derinliği çok farklı: Garanti sayfada
    /// 18 kayıt verip 380 sayfa geriye gidiyor, Ziraat sayfada 50 kayıtla 18
    /// sayfada bitiyor, Gedik'te sayfalama hiç yok. Tek bir sınır ya büyük
    /// arşivi kırpar ya küçük kaynağa boşuna istek attırır.
    pub deep_pages: usize,
}

/// Taranan kaynaklar. Yeni kurum eklemek buraya bir satır eklemektir; biçimi
/// mevcut üç ayrıştırıcıdan birine uymuyorsa `Feed`'e yeni bir varyant girer.
pub const SOURCES: &[SourceSpec] = &[
    SourceSpec {
        id: "isyatirim",
        broker: "İş Yatırım",
        scope: BrokerScope::Domestic,
        feed: Feed::WordPress {
            base: "https://arastirma.isyatirim.com.tr",
            tag_feeds: true,
        },
        // Akış günde birkaç bülten yayımlıyor: 40 sayfa yalnız beş haftalık
        // geçmiş veriyordu. Ölçümde 600. sayfa hâlâ dolu (2024'e iniyor) ama
        // kayıtların yalnız dörtte biri bir hisseye bağlanıyor; arşiv payını
        // tek kaynak yutmasın diye üç aya denk gelen sınırda durulur.
        deep_pages: 120,
    },
    SourceSpec {
        id: "marbas",
        broker: "Marbaş Menkul",
        scope: BrokerScope::Domestic,
        feed: Feed::WordPress { base: "https://marbas.com.tr", tag_feeds: false },
        // Sayfa başına 5 kayıt (diğer WordPress akışlarında 10); aynı geçmişe
        // ulaşmak iki katı sayfa ister.
        deep_pages: 60,
    },
    SourceSpec {
        id: "a1capital",
        broker: "A1 Capital",
        scope: BrokerScope::Domestic,
        feed: Feed::WordPress { base: "https://a1capital.com.tr", tag_feeds: false },
        deep_pages: 60,
    },
    SourceSpec {
        id: "vakif",
        broker: "Vakıf Yatırım",
        scope: BrokerScope::Domestic,
        feed: Feed::VakifListing {
            url: "https://www.vkyanaliz.com/arastirma-raporlari/sirket-raporlari",
            base: "https://www.vkyanaliz.com",
        },
        deep_pages: 1,
    },
    SourceSpec {
        id: "halk",
        broker: "Halk Yatırım",
        scope: BrokerScope::Domestic,
        feed: Feed::HalkListing {
            url: "https://analizim.halkyatirim.com.tr/Analysis/AnalystRecommendations",
        },
        deep_pages: 1,
    },
    SourceSpec {
        id: "garanti",
        broker: "Garanti BBVA Yatırım",
        scope: BrokerScope::Domestic,
        feed: Feed::GarantiJson { url: "https://www.garantibbvayatirim.com.tr/api/researchreports" },
        deep_pages: 260,
    },
    SourceSpec {
        id: "ziraat",
        broker: "Ziraat Yatırım",
        scope: BrokerScope::Domestic,
        feed: Feed::ZiraatClockwork {
            url: "https://www.ziraatyatirim.com.tr/umbraco/api/ClockworkUploaderPublic/GetFilesByFilter",
            base: "https://www.ziraatyatirim.com.tr",
            category_id: "39326",
        },
        // Arşiv 21. sayfada bitiyor (2019 başı); 20'de durmak son kayıtları
        // dışarıda bırakıyordu.
        deep_pages: 22,
    },
    SourceSpec {
        id: "gedik",
        broker: "Gedik Yatırım",
        scope: BrokerScope::Domestic,
        feed: Feed::GedikNextData {
            url: "https://gedik.com/analiz/rapor-ve-analizler/yurt-ici-piyasa-rapor-ve-analizleri",
        },
        deep_pages: 1,
    },
    SourceSpec {
        id: "ahlatci",
        broker: "Ahlatcı Yatırım",
        scope: BrokerScope::Domestic,
        feed: Feed::AhlatciTimeline {
            url: "https://www.ahlatciyatirim.com.tr/arastirma/sirket-raporlari",
            base: "https://www.ahlatciyatirim.com.tr",
        },
        // Arşiv 33 sayfa, 34 temiz 404 veriyor; sınır sonu geçecek kadar açık
        // tutulur, tarama 404'te kendiliğinden durur.
        deep_pages: 34,
    },
    SourceSpec {
        id: "phillip",
        broker: "PhillipCapital",
        scope: BrokerScope::Domestic,
        feed: Feed::PhillipCards {
            url: "https://www.phillipcapital.com.tr/arastirma",
            base: "https://www.phillipcapital.com.tr",
        },
        // Arşiv 412 sayfa ama büyük kısmı günlük bülten; şirket ve sektör
        // raporlarını yakalayacak kadar geriye gidilir.
        deep_pages: 60,
    },
    SourceSpec {
        id: "integral",
        broker: "Integral Yatırım",
        scope: BrokerScope::Domestic,
        feed: Feed::IntegralCards {
            url: "https://integralyatirim.com.tr/sirket-sektor-raporlari",
            base: "https://integralyatirim.com.tr",
        },
        // Arşiv tam 60 sayfa (2023'e kadar) ve sonrası **404 vermiyor**: p61
        // son sayfayı yeniden döndürüyor. Bütçe fazla tutulursa boş sayfa
        // beklentisiyle biten tarama aynı kayıtları tekrar tekrar çeker.
        deep_pages: 60,
    },
];

// ---------------------------------------------------------------------------
// Metin çıkarımı
// ---------------------------------------------------------------------------

/// HTML etiketlerini ve varlıklarını atıp tek satırlık düz metin bırakır.
///
/// `<style>` ve `<script>` gövdeleri metin değildir: WordPress kurulumları
/// (Marbaş, A1) yazının başına eklenti biçemlerini gömüyor ve yalnız etiket
/// atılsa özet "/*! elementor - v3.7.4 …" diye başlıyor.
fn strip_html(input: &str) -> String {
    let without_code = strip_elements(input, &["style", "script"]);
    let mut out = String::with_capacity(without_code.len());
    let mut in_tag = false;
    for ch in without_code.chars() {
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

/// Verilen etiketleri gövdeleriyle birlikte siler.
///
/// Arama büyük/küçük harfe duyarsızdır ama **küçültülmüş bir kopya üzerinden
/// değil**: `to_lowercase()` Türkçe 'İ' harfini iki kod noktasına açıyor ve
/// kopyanın bayt uzunluğu özgün metinden farklı oluyor. Kopyada bulunan konum
/// özgün metne uygulanınca yanlış yer siliniyor, etiket yerinde kalıyor ve
/// döngü aynı etiketi yeniden buluyordu — her turda bütün metnin yeni bir
/// küçük harfli kopyası çıkarıldığı için maliyet ikinci dereceye çıkıyor.
/// Ahlatcı sayfalarında derin tarama tam bu yüzden saatlerce %100 CPU'da
/// asılı kaldı: sayfanın CSS'i `.ar-entry` kuralı taşıdığı için bloklara
/// `<style>` parçaları düşüyor, Türkçe başlıklar da 'İ' ile dolu.
///
/// Etiket adları ASCII olduğundan yerinde ASCII karşılaştırması hem doğru hem
/// uzunluk korur; metin tek geçişte kopyalanır.
fn strip_elements(input: &str, names: &[&str]) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    loop {
        // Hangi etiket önce geliyorsa o silinir; adlar tek tek taranırsa
        // iç içe geçmiş `<script>` / `<style>` sırası bozulur.
        let Some((at, name)) = names
            .iter()
            .filter_map(|name| find_ascii_ci(rest, &format!("<{name}")).map(|at| (at, *name)))
            .min_by_key(|(at, _)| *at)
        else {
            break;
        };
        out.push_str(&rest[..at]);
        let after = &rest[at..];
        let close = format!("</{name}>");
        rest = match find_ascii_ci(after, &close) {
            Some(offset) => &after[offset + close.len()..],
            // Kapanışı olmayan etiket bozuk gövde demektir; sonuna kadar atılır.
            None => "",
        };
    }
    out.push_str(rest);
    out
}

/// `needle`'ın ilk konumu; karşılaştırma ASCII büyük/küçük harfe duyarsızdır.
///
/// Küçük harfli kopya çıkarmak yerine yerinde karşılaştırılır — kopya Türkçe
/// harflerde bayt uzunluğunu değiştirir ve dönen konum özgün metinde başka
/// bir yeri gösterir.
fn find_ascii_ci(haystack: &str, needle: &str) -> Option<usize> {
    let (hay, ned) = (haystack.as_bytes(), needle.as_bytes());
    if ned.is_empty() || hay.len() < ned.len() {
        return None;
    }
    (0..=hay.len() - ned.len()).find(|&at| hay[at..at + ned.len()].eq_ignore_ascii_case(ned))
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
        if let Some(code) = ticker_from_company_name(title) {
            push(code.to_string(), &mut found);
        }
    }

    found
}

/// Başlıkta geçen şirket unvanından BIST kodunu bulur.
///
/// Kurumlar unvanı başlığın herhangi bir yerine, arkasına da rapor türünü
/// ekleyerek yazıyor: "Şirket Bilgi Notu | Akfen Yenilenebilir Enerji",
/// "Ereğli Demir Çelik 2Ç26 Bilanço Analizi". Unvanın tamamını tek parça
/// sanmak bu yüzden çoğu kaydı kaçırıyordu; başlık bölümlere ayrılıp her
/// bölümün **giderek kısalan** kelime dizileri deneniyor.
///
/// Uzun dizi önce denenir: "Türk Hava Yolları" ile "Türk Traktör" ilk
/// kelimeyi paylaşır, kısa eşleşme kazansaydı yanlış şirkete bağlanırdı.
fn ticker_from_company_name(title: &str) -> Option<&'static str> {
    for segment in title.split(['|', ':', '–', '—', '(', ')', '/']) {
        let words: Vec<&str> = segment.split_whitespace().collect();
        if words.is_empty() {
            continue;
        }
        for start in 0..words.len() {
            // Unvan en çok altı kelimedir; daha uzun dizi denemek hem boşuna
            // hem de rapor türünü unvana katma riski taşır.
            let longest = words.len().min(start + 6);
            for end in (start + 1..=longest).rev() {
                let candidate = words[start..end].join(" ");
                if candidate.chars().filter(|c| c.is_alphabetic()).count() < 5 {
                    continue;
                }
                if let Some(code) = crate::company_match::bist_ticker_for(&candidate) {
                    return Some(code);
                }
            }
        }
    }
    None
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
    // Yıl noktalama ile bitişik gelebiliyor ("… 2026, Pazartesi").
    let year: i32 = parts[2].trim_matches(|c: char| !c.is_ascii_digit()).parse().ok()?;
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

/// Bloktaki ilk `name="…"` özniteliğinin değerini verir.
fn attr_value(block: &str, name: &str) -> Option<String> {
    let needle = format!("{name}=\"");
    let at = block.find(&needle)? + needle.len();
    let end = block[at..].find('"')?;
    Some(block[at..at + end].to_string())
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

// ---------------------------------------------------------------------------
// Garanti BBVA Yatırım
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct GarantiFeed {
    #[serde(default)]
    items: Vec<GarantiItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct GarantiItem {
    #[serde(default)]
    title: String,
    #[serde(default)]
    short_description: String,
    #[serde(default)]
    category_name: String,
    /// "10.08.2026 16:23"
    #[serde(default)]
    publish_date: String,
    /// Kayıt aboneye kapalıysa gelmez; o kayıt okunamayacağı için atlanır.
    #[serde(default)]
    pdf_url: Option<String>,
}

/// Garanti BBVA Yatırım'ın JSON araştırma ucunu ayrıştırır.
///
/// Kategori adı (`Şirket Raporları`, `Açıklanan Bilançolar`) etiket olarak
/// verilir; başlıklar BIST kodunu önde taşır ("HALKB 2Ç26 Finansal Sonuçlar").
/// PDF'i olmayan kayıt üretilmez — ekranda açılamayacak satır arşive girmez.
pub fn parse_garanti_json(
    json: &str,
    spec: &SourceSpec,
    universe: &HashSet<String>,
) -> Result<Vec<AnalystReport>, String> {
    let feed: GarantiFeed = serde_json::from_str(json)
        .map_err(|error| format!("{} JSON çözümlenemedi: {error}", spec.broker))?;

    let mut reports = Vec::new();
    for item in feed.items {
        let Some(pdf_url) = item.pdf_url.filter(|url| !url.trim().is_empty()) else { continue };
        let title = decode_entities(item.title.trim());
        if title.is_empty() {
            continue;
        }
        // Tarihin saat kısmı atılır; gün bazında sıralanır.
        let Some((published, published_ts)) = parse_dotted_date(&item.publish_date) else {
            continue;
        };
        let tags = vec![item.category_name.clone()];
        let summary = decode_entities(item.short_description.trim());
        let haystack = format!("{title} {summary}");
        let tickers = extract_tickers(&title, &tags, universe);

        reports.push(AnalystReport {
            id: report_id(&pdf_url),
            broker: spec.broker.to_string(),
            scope: spec.scope,
            kind: classify_with_tickers(&title, &tags, &tickers),
            tickers,
            rating: extract_rating(&haystack),
            target_price: extract_target_price(&haystack),
            title,
            summary: (!summary.is_empty()).then(|| truncate(&summary, 400)),
            url: pdf_url.clone(),
            pdf_url: Some(pdf_url),
            published,
            published_ts,
            analyst: None,
            source_id: spec.id.to_string(),
        });
    }
    Ok(reports)
}

/// "10.08.2026" ya da "10.08.2026 16:23" biçimli tarihi çözer.
fn parse_dotted_date(raw: &str) -> Option<(String, i64)> {
    let day_part = raw.split_whitespace().next()?;
    let parts: Vec<&str> = day_part.split(['.', '-', '/']).collect();
    if parts.len() < 3 {
        return None;
    }
    let day: u32 = parts[0].parse().ok()?;
    let month: u32 = parts[1].parse().ok()?;
    let year: i32 = parts[2].parse().ok()?;
    iso_from_ymd(year, month, day)
}

// ---------------------------------------------------------------------------
// Ziraat Yatırım
// ---------------------------------------------------------------------------

/// Ziraat Yatırım'ın belge listesini ayrıştırır.
///
/// Satırlar `<a href="…pdf" … aria-label="KCHOL 2Ç26 10-08-2026">` biçimindedir;
/// başlık ve tarih tek bir öznitelikte birlikte durur. Dosya adları Türkçe harf
/// taşıdığı için adres yeniden yüzde-kodlanır, yoksa gömülü görüntüleyicide
/// açılmaz.
pub fn parse_ziraat_listing(
    html: &str,
    base: &str,
    spec: &SourceSpec,
    universe: &HashSet<String>,
) -> Vec<AnalystReport> {
    let mut reports = Vec::new();
    for block in html.split("<a ").skip(1) {
        let Some(href) = attr_value(block, "href") else { continue };
        if !href.to_lowercase().contains(".pdf") {
            continue;
        }
        let Some(label) = attr_value(block, "aria-label") else { continue };
        let label = decode_entities(&label);
        // Etiketin son parçası tarihtir: "KCHOL 2Ç26 10-08-2026".
        let mut words: Vec<&str> = label.split_whitespace().collect();
        let Some((published, published_ts)) = words.last().and_then(|last| parse_dotted_date(last))
        else {
            continue;
        };
        words.pop();
        let title = words.join(" ");
        if title.is_empty() {
            continue;
        }

        let href = decode_entities(&href);
        let pdf_url = if href.starts_with("http") {
            encode_url_path(&href)
        } else {
            encode_url_path(&format!(
                "{}/{}",
                base.trim_end_matches('/'),
                href.trim_start_matches('/')
            ))
        };

        let tickers = extract_tickers(&title, &[], universe);
        reports.push(AnalystReport {
            id: report_id(&pdf_url),
            broker: spec.broker.to_string(),
            scope: spec.scope,
            kind: classify_with_tickers(&title, &[], &tickers),
            tickers,
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

/// Adresteki ASCII olmayan baytları ve boşlukları yüzde-kodlar. Şema ve konak
/// adı olduğu gibi bırakılır; yalnız yol kısmı güvenli hale getirilir.
fn encode_url_path(url: &str) -> String {
    let mut out = String::with_capacity(url.len());
    for byte in url.bytes() {
        match byte {
            b' ' => out.push_str("%20"),
            0x00..=0x1f | 0x7f..=0xff | b'"' | b'<' | b'>' | b'\\' | b'^' | b'`' | b'{' | b'|'
            | b'}' => out.push_str(&format!("%{byte:02X}")),
            _ => out.push(byte as char),
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Gedik Yatırım
// ---------------------------------------------------------------------------

/// Gedik Yatırım sayfasındaki `__NEXT_DATA__` gömülü verisini ayrıştırır.
///
/// Rapor kayıtları sayfa ağacının derinlerinde sekme/gruplar içinde durur;
/// yol sürüm sürüm değiştiği için ağaç dolaşılır ve `pdfUrl` taşıyan her nesne
/// rapor kabul edilir. Başlık BIST kodu taşımaz ("Çeyreklik Finansal Görünüm
/// Değerlendirme Raporları - 10.08.2026") ama **dosya adı taşır**
/// (`…_SASA_20260810.pdf`); kod oradan çıkarılır.
pub fn parse_gedik_next_data(
    html: &str,
    spec: &SourceSpec,
    universe: &HashSet<String>,
) -> Result<Vec<AnalystReport>, String> {
    let marker = "id=\"__NEXT_DATA__\"";
    let start = html
        .find(marker)
        .and_then(|at| html[at..].find('>').map(|offset| at + offset + 1))
        .ok_or_else(|| format!("{}: __NEXT_DATA__ bulunamadı", spec.broker))?;
    let end = html[start..]
        .find("</script>")
        .ok_or_else(|| format!("{}: __NEXT_DATA__ kapanmıyor", spec.broker))?;

    let root: serde_json::Value = serde_json::from_str(&html[start..start + end])
        .map_err(|error| format!("{} JSON çözümlenemedi: {error}", spec.broker))?;

    let mut nodes = Vec::new();
    collect_pdf_nodes(&root, &mut nodes);

    let mut reports = Vec::new();
    for node in nodes {
        let Some(pdf_url) = node.get("pdfUrl").and_then(|value| value.as_str()) else { continue };
        let title = node.get("title").and_then(|value| value.as_str()).unwrap_or_default().trim();
        if title.is_empty() {
            continue;
        }
        let published = node
            .get("summaryDate")
            .and_then(|value| value.as_str())
            .and_then(parse_dotted_date)
            // Tarih alanı boşsa dosya adındaki "20260810" damgasına düşülür.
            .or_else(|| date_from_compact_stamp(pdf_url));
        let Some((published, published_ts)) = published else { continue };

        let period = node.get("period").and_then(|value| value.as_str()).unwrap_or_default();
        // Başlıkta kod yok; dosya adındaki büyük harfli parçalar etiket sayılır.
        let tags: Vec<String> = uppercase_tokens(pdf_url)
            .into_iter()
            .chain(std::iter::once(period.to_string()))
            .collect();
        let tickers = extract_tickers(title, &tags, universe);

        reports.push(AnalystReport {
            id: report_id(pdf_url),
            broker: spec.broker.to_string(),
            scope: spec.scope,
            kind: classify_with_tickers(title, &[period.to_string()], &tickers),
            tickers,
            rating: extract_rating(title),
            target_price: extract_target_price(title),
            title: decode_entities(title),
            summary: None,
            url: pdf_url.to_string(),
            pdf_url: Some(pdf_url.to_string()),
            published,
            published_ts,
            analyst: None,
            source_id: spec.id.to_string(),
        });
    }
    Ok(reports)
}

/// `pdfUrl` alanı dolu olan bütün nesneleri ağaçtan toplar.
fn collect_pdf_nodes<'a>(value: &'a serde_json::Value, out: &mut Vec<&'a serde_json::Value>) {
    match value {
        serde_json::Value::Object(map) => {
            if map.get("pdfUrl").and_then(|url| url.as_str()).is_some_and(|url| !url.is_empty()) {
                out.push(value);
            }
            for child in map.values() {
                collect_pdf_nodes(child, out);
            }
        }
        serde_json::Value::Array(items) => {
            for child in items {
                collect_pdf_nodes(child, out);
            }
        }
        _ => {}
    }
}

/// Dosya adındaki "20260810" damgasını tarihe çevirir.
fn date_from_compact_stamp(url: &str) -> Option<(String, i64)> {
    let name = url.rsplit('/').next()?;
    let digits: Vec<&str> = name
        .split(|c: char| !c.is_ascii_digit())
        .filter(|part| part.len() == 8)
        .collect();
    for group in digits {
        let year: i32 = group[0..4].parse().ok()?;
        let month: u32 = group[4..6].parse().ok()?;
        let day: u32 = group[6..8].parse().ok()?;
        if (2000..=2100).contains(&year) && (1..=12).contains(&month) && (1..=31).contains(&day) {
            return iso_from_ymd(year, month, day);
        }
    }
    None
}

/// Dosya adındaki **tamamı büyük harf** parçaları verir.
///
/// Büyütme yapılmaz bilerek: `Gedik_BIST100_…` içindeki "Gedik" büyütülseydi
/// GEDIK payına bağlanır, kurumun her bülteni kendi hissesine etiketlenirdi.
fn uppercase_tokens(url: &str) -> Vec<String> {
    let name = url.rsplit('/').next().unwrap_or(url);
    name.split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|token| {
            (3..=6).contains(&token.len()) && token.chars().all(|c| c.is_ascii_uppercase())
        })
        .map(String::from)
        .collect()
}

// ---------------------------------------------------------------------------
// Ahlatcı Yatırım
// ---------------------------------------------------------------------------

/// Ahlatcı Yatırım'ın zaman çizelgesini ayrıştırır.
///
/// Her kayıt `class="ar-entry"` bağlantısıdır: adres doğrudan PDF'e gider,
/// başlık `ar-etitle`, tarih ise "10 Ağustos 2026, Pazartesi" biçiminde bir
/// alt satırda durur. Başlıktaki "Yeni" rozeti ayrı bir `span` olduğu için
/// metne karışmadan atılır.
pub fn parse_ahlatci_timeline(
    html: &str,
    base: &str,
    spec: &SourceSpec,
    universe: &HashSet<String>,
) -> Vec<AnalystReport> {
    let mut reports = Vec::new();
    for block in html.split("ar-entry").skip(1) {
        let Some(href) = attr_value(block, "href") else { continue };
        if !href.to_lowercase().contains(".pdf") {
            continue;
        }
        // Başlık rozetten önce biter; `<span class="ar-badge">Yeni</span>`
        // metne karışırsa her yeni rapor "… Yeni" diye görünür.
        let title = tag_text_until_child(block, "ar-etitle").unwrap_or_default();
        let title = decode_entities(title.trim());
        if title.is_empty() {
            continue;
        }
        let Some((published, published_ts)) = ahlatci_date(block) else { continue };

        let pdf_url = if href.starts_with("http") {
            encode_url_path(&decode_entities(&href))
        } else {
            encode_url_path(&format!(
                "{}/{}",
                base.trim_end_matches('/'),
                decode_entities(&href).trim_start_matches('/')
            ))
        };

        // Eski kayıtlarda kod dosya adında küçük harfle geçiyor
        // ("asels-20192-ceyrek-bilanco-analizi"); başlık yetmezse oradan alınır.
        let mut tickers = extract_tickers(&title, &[], universe);
        if tickers.is_empty() {
            tickers = tickers_from_slug(&pdf_url, universe);
        }

        reports.push(AnalystReport {
            id: report_id(&pdf_url),
            broker: spec.broker.to_string(),
            scope: spec.scope,
            kind: classify_with_tickers(&title, &[], &tickers),
            tickers,
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

/// Bloktaki ilk "GG Ay YYYY" tarihini çözer.
fn ahlatci_date(block: &str) -> Option<(String, i64)> {
    let text = strip_html(block);
    let mut words = text.split_whitespace();
    // Metin gün/ay/yıl üçlüsünü içerir; ilk çözülebilen üçlü alınır.
    let mut window: Vec<&str> = Vec::new();
    for word in words.by_ref() {
        window.push(word);
        if window.len() > 3 {
            window.remove(0);
        }
        if window.len() == 3 {
            if let Some(parsed) = parse_turkish_date(&window.join(" ")) {
                return Some(parsed);
            }
        }
    }
    None
}

/// Dosya adının başındaki küçük harfli kodu ("asels-2019…") çıkarır.
fn tickers_from_slug(url: &str, universe: &HashSet<String>) -> Vec<String> {
    let name = url.rsplit('/').next().unwrap_or(url);
    let first = name.split(|c: char| !c.is_ascii_alphanumeric()).next().unwrap_or_default();
    let candidate = first.to_uppercase();
    if (3..=6).contains(&candidate.len())
        && candidate.chars().all(|c| c.is_ascii_uppercase())
        && universe.contains(&candidate)
    {
        return vec![candidate];
    }
    Vec::new()
}

/// `class="X"` taşıyan etiketin metnini **ilk iç etikete kadar** verir.
fn tag_text_until_child<'a>(block: &'a str, class: &str) -> Option<&'a str> {
    let start = block.find(class)?;
    let rest = &block[start..];
    let open = rest.find('>')? + 1;
    let end = rest[open..].find('<')?;
    Some(&rest[open..open + end])
}

// ---------------------------------------------------------------------------
// PhillipCapital
// ---------------------------------------------------------------------------

/// PhillipCapital'in rapor kartlarını ayrıştırır.
///
/// Her kart `class="product-item"` bloğudur; tarih, kategori ve başlık ayrı
/// alanlarda temiz durur. Dosya adı GUID olduğu için hisse kodu yalnız
/// başlıktan çıkar ("EREGL Company Update Report").
pub fn parse_phillip_cards(
    html: &str,
    base: &str,
    spec: &SourceSpec,
    universe: &HashSet<String>,
) -> Vec<AnalystReport> {
    let mut reports = Vec::new();
    for block in html.split("class=\"product-item\"").skip(1) {
        let Some(href) = attr_value(block, "href") else { continue };
        if !href.to_lowercase().contains(".pdf") {
            continue;
        }
        let title = decode_entities(&tag_text_until_child(block, "product-title").unwrap_or_default());
        let title = title.trim().to_string();
        if title.is_empty() {
            continue;
        }
        let date_raw = decode_entities(&tag_text_until_child(block, "product-date").unwrap_or_default());
        let Some((published, published_ts)) = parse_turkish_date(date_raw.trim()) else { continue };
        let category = decode_entities(&tag_text_until_child(block, "product-category").unwrap_or_default());

        let pdf_url = if href.starts_with("http") {
            encode_url_path(&decode_entities(&href))
        } else {
            encode_url_path(&format!(
                "{}/{}",
                base.trim_end_matches('/'),
                decode_entities(&href).trim_start_matches('/')
            ))
        };

        let tags = vec![category.trim().to_string()];
        let tickers = extract_tickers(&title, &tags, universe);
        reports.push(AnalystReport {
            id: report_id(&pdf_url),
            broker: spec.broker.to_string(),
            scope: spec.scope,
            kind: classify_with_tickers(&title, &tags, &tickers),
            tickers,
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

// ---------------------------------------------------------------------------
// Integral Yatırım
// ---------------------------------------------------------------------------

/// Integral Yatırım'ın şirket/sektör rapor kartlarını ayrıştırır.
///
/// Kart `class="card-title"` ile başlar; başlık `<h3>`, tarih `<small>`
/// etiketinin **`title` özniteliğinde** ("07.08.2026") — görünen metin
/// "4 Gün Önce" gibi göreli olduğu için işe yaramaz. Özet `card-text`
/// paragrafındadır, PDF ise kartın altındaki ilk `.pdf` bağlantısıdır.
///
/// Kurum başlık biçimini yıllar içinde değiştirmiş: yeni kayıtlar kodu önde
/// taşıyor ("EKDMR 2Ç26 Bilanço Analizi"), 2023 kayıtları yalnız unvan
/// yazıyor ("Ford Otosan 2Ç23 Bilanço Analizi"). İkincisi unvan eşleşmesiyle,
/// o da tutmazsa dosya adındaki kodla ("ŞirketAnalizi_FROTO.pdf") bağlanır.
pub fn parse_integral_cards(
    html: &str,
    base: &str,
    spec: &SourceSpec,
    universe: &HashSet<String>,
) -> Vec<AnalystReport> {
    let mut reports = Vec::new();
    for block in html.split("class=\"card-title").skip(1) {
        // Kartın başlık bağlantısı belgeye değil ayrıntı sayfasına gider;
        // aranan, bloktaki ilk PDF bağlantısıdır. Sayfada rapor kartına
        // benzeyen ama belgesi olmayan bloklar da var, onlar listeye girmez.
        let Some(pdf_href) = block
            .match_indices("href=\"")
            .filter_map(|(at, needle)| {
                let rest = &block[at + needle.len()..];
                rest.find('"').map(|end| &rest[..end])
            })
            .find(|href| href.to_lowercase().contains(".pdf"))
            .map(decode_entities)
        else {
            continue;
        };
        let Some(title) = text_between(block, "<h3", "</h3>") else { continue };
        let title = decode_entities(&title).split_whitespace().collect::<Vec<_>>().join(" ");
        if title.is_empty() {
            continue;
        }
        // Görünen metin göreli ("4 Gün Önce"); gerçek tarih öznitelikte.
        let Some(date_raw) = attribute_after(block, "<small", "title=\"") else { continue };
        let Some((published, published_ts)) = parse_dotted_date(date_raw.trim()) else { continue };

        let pdf_url = if pdf_href.starts_with("http") {
            encode_url_path(&pdf_href)
        } else {
            encode_url_path(&format!(
                "{}/{}",
                base.trim_end_matches('/'),
                pdf_href.trim_start_matches('/')
            ))
        };

        let summary = tag_text_until_child(block, "card-text")
            .map(|text| decode_entities(text).split_whitespace().collect::<Vec<_>>().join(" "))
            .filter(|text| !text.is_empty());

        let mut tickers = extract_tickers(&title, &[], universe);
        if tickers.is_empty() {
            tickers = extract_tickers("", &uppercase_tokens(&pdf_url), universe);
        }

        reports.push(AnalystReport {
            id: report_id(&pdf_url),
            broker: spec.broker.to_string(),
            scope: spec.scope,
            kind: classify_with_tickers(&title, &[], &tickers),
            tickers,
            rating: extract_rating(&title),
            target_price: extract_target_price(&title),
            title,
            summary,
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

/// `open` etiketinin açılışından `close` etiketine kadarki ham metin.
fn text_between<'a>(block: &'a str, open: &str, close: &str) -> Option<&'a str> {
    let start = block.find(open)?;
    let rest = &block[start..];
    let from = rest.find('>')? + 1;
    let end = rest.find(close)?;
    (end > from).then(|| &rest[from..end])
}

/// `classify` üzerine tek kural ekler: türü belirlenemeyen ama tek bir hisseye
/// bağlanan rapor şirket raporudur. Kod taşıyan başlıklar ("KCHOL 2Ç26")
/// sözlükteki kalıpların hiçbirine uymuyor ama şirket raporu olduğu kesin.
fn classify_with_tickers(title: &str, tags: &[String], tickers: &[String]) -> ReportKind {
    let kind = classify(title, tags);
    if kind == ReportKind::Other && tickers.len() == 1 {
        return ReportKind::Company;
    }
    kind
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
    let archive: ReportArchive = archive_path()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|data| serde_json::from_str(&data).ok())
        .unwrap_or_default();

    // Eski sürümle kurulmuş arşiv atılır; boş arşiv bir sonraki turda derin
    // taranıp yeni ayrıştırıcıyla yeniden kurulur.
    if archive.parser_version != PARSER_VERSION {
        return ReportArchive { parser_version: PARSER_VERSION, ..Default::default() };
    }
    archive
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
    archive.parser_version = PARSER_VERSION;
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

/// Sayfaları sınırlı eşzamanlılıkla çeker ve **sırayla** birleştirir.
///
/// Sayfa başına tek tek istek atmak Garanti'nin 260 sayfalık arşivinde ilk
/// kurulumu dakikalara yayıyordu. Sayfalar birbirinden bağımsız olduğu için
/// bir arada istenir; sonuçlar yine sayfa sırasına göre eklenir ki arşivde
/// tarih sırası bozulmasın.
///
/// Boş sayfa **son** demektir: o sayfadan sonrası atılır. Hata veren sayfa da
/// sonu işaretler ama önce yeniden denenir (bkz. `page_failure_is_final`).
/// Bir sayfa için toplam deneme sayısı (ilki dahil).
const PAGE_ATTEMPTS: u32 = 2;

/// Sayfa hatası gerçekten "arşivin sonu" mu, yoksa geçici arıza mı?
///
/// Sayfalama tükendiğinde kaynaklar 404 veriyor; bu beklenen sondur ve
/// yeniden denemek boşuna istek demektir. Zaman aşımı ya da 5xx ise geçicidir
/// ama eskiden ikisi aynı sepetteydi: **tek bir yavaş sayfa arşivi sessizce
/// kırpıyordu**. Ölçümde Integral'in 60 sayfalık arşivi 40. sayfada kesildi,
/// hata listesi boş kaldı, ekran dolu göründü. Eksik veriyi hatasız
/// göstermek, hata göstermekten daha kötüdür.
fn page_failure_is_final(error: &str) -> bool {
    error.contains("404") || crate::retry::is_rate_limited(error)
}

async fn fetch_pages<F, Fut>(pages: usize, fetch: F) -> Vec<AnalystReport>
where
    F: Fn(usize) -> Fut,
    Fut: std::future::Future<Output = Result<Vec<AnalystReport>, String>>,
{
    use futures::stream::StreamExt;

    let fetch = &fetch;
    let results: Vec<Result<Vec<AnalystReport>, String>> =
        futures::stream::iter((1..=pages.max(1)).map(|page| async move {
            crate::retry::with_retry(PAGE_ATTEMPTS, page_failure_is_final, || fetch(page)).await
        }))
        .buffered(PAGE_CONCURRENCY)
        .collect()
        .await;

    let mut all = Vec::new();
    for result in results {
        match result {
            Ok(reports) if !reports.is_empty() => all.extend(reports),
            _ => break,
        }
    }
    all
}

/// Garanti'nin JSON ucundan tek sayfa çeker.
///
/// `keyword` boşken bütün akış, doluyken o kelimeyi (hisse kodu) içeren
/// raporlar gelir — hisse bazlı geçmiş bu ikinci biçimden alınır.
async fn garanti_page(
    client: &reqwest::Client,
    url: &str,
    page: usize,
    keyword: &str,
    spec: &SourceSpec,
    universe: &HashSet<String>,
) -> Result<Vec<AnalystReport>, String> {
    // Sayfa numarası sorgu dizesinde değil `Page` başlığında taşınır;
    // başlıksız çağrı hep ilk sayfayı verir.
    let full = format!("{url}?keyword={keyword}&dateRange=");
    let response = client
        .get(&full)
        .timeout(std::time::Duration::from_secs(20))
        .header("User-Agent", BROWSER_UA)
        .header("Page", page.to_string())
        .header("X-Bone-Language", "TR")
        .send()
        .await
        .map_err(|error| format!("{full}: {error}"))?;
    let body = crate::retry::check_status(response, &full)?
        .text()
        .await
        .map_err(|error| format!("{full}: {error}"))?;
    parse_garanti_json(&body, spec, universe)
}

/// Ziraat'in Clockwork ucundan tek sayfa çeker.
async fn ziraat_page(
    client: &reqwest::Client,
    url: &str,
    base: &str,
    category_id: &str,
    page: usize,
    spec: &SourceSpec,
    universe: &HashSet<String>,
) -> Result<Vec<AnalystReport>, String> {
    // Uç tarih aralığı ister; arşivin tamamı istendiği için pencere sitenin en
    // eski kaydından bugüne kadar açık tutulur. Biçim katı: "31.12.2026" 400
    // döndürür, ISO çalışır.
    let end = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let body = serde_json::json!({
        "BeginDate": "2015-01-01",
        "EndDate": end,
        "Page": page,
        "PageSize": 50,
        "SearchTerm": serde_json::Value::Null,
        "CategoryId": category_id,
        "CheckSubCategory": "True",
    });
    let response = client
        .post(url)
        .timeout(std::time::Duration::from_secs(20))
        .header("User-Agent", BROWSER_UA)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("{url}: {error}"))?;
    let html = crate::retry::check_status(response, url)?
        .text()
        .await
        .map_err(|error| format!("{url}: {error}"))?;
    Ok(parse_ziraat_listing(&html, base, spec, universe))
}

/// Tek bir kaynağı tarar.
pub async fn fetch_source(
    client: &reqwest::Client,
    spec: &SourceSpec,
    universe: &HashSet<String>,
    pages: usize,
) -> Result<Vec<AnalystReport>, String> {
    let pages = pages.max(1).min(spec.deep_pages.max(1));
    match spec.feed {
        Feed::WordPress { base, .. } => Ok(fetch_pages(pages, |page| async move {
            let url = if page == 1 {
                format!("{base}/feed/")
            } else {
                format!("{base}/feed/?paged={page}")
            };
            // Sayfa tükendiğinde WordPress 404 verir; bu hata değil, sondur.
            let body = get_text(client, &url).await?;
            parse_wordpress_feed(body.as_bytes(), spec, universe)
        })
        .await),
        Feed::VakifListing { url, base } => {
            let html = get_text(client, url).await?;
            Ok(parse_vakif_listing(&html, base, spec, universe))
        }
        Feed::HalkListing { url } => {
            let html = get_text(client, url).await?;
            Ok(parse_halk_listing(&html, spec, universe))
        }
        Feed::GarantiJson { url } => {
            Ok(fetch_pages(pages, |page| garanti_page(client, url, page, "", spec, universe)).await)
        }
        Feed::ZiraatClockwork { url, base, category_id } => Ok(fetch_pages(pages, |page| {
            ziraat_page(client, url, base, category_id, page, spec, universe)
        })
        .await),
        Feed::GedikNextData { url } => {
            // Sayfalama yok: bütün liste ilk yanıtın gömülü verisinde gelir.
            let html = get_text(client, url).await?;
            parse_gedik_next_data(&html, spec, universe)
        }
        Feed::AhlatciTimeline { url, base } => Ok(fetch_pages(pages, |page| async move {
            let full = if page == 1 { url.to_string() } else { format!("{url}?sayfa={page}") };
            let html = get_text(client, &full).await?;
            Ok(parse_ahlatci_timeline(&html, base, spec, universe))
        })
        .await),
        Feed::PhillipCards { url, base } => Ok(fetch_pages(pages, |page| async move {
            let full = if page == 1 { url.to_string() } else { format!("{url}?page={page}") };
            let html = get_text(client, &full).await?;
            Ok(parse_phillip_cards(&html, base, spec, universe))
        })
        .await),
        Feed::IntegralCards { url, base } => Ok(fetch_pages(pages, |page| async move {
            let full = if page == 1 { url.to_string() } else { format!("{url}/p{page}") };
            let html = get_text(client, &full).await?;
            Ok(parse_integral_cards(&html, base, spec, universe))
        })
        .await),
    }
}

/// Tek bir hissenin raporlarını kurumların hisse bazlı uçlarından çeker.
///
/// Arşiv taraması geriye doğru sınırlıdır; kullanıcı bir hisseyi açtığında o
/// hissenin geçmişi tam istenir. Üç kurum bunu doğrudan veriyor ve üçü üç ayrı
/// biçimde: İş Yatırım `/tag/{kod}/feed/` etiket akışıyla, Garanti arama
/// kelimesiyle (`?keyword=EREGL`), Ziraat ise hissenin kendi alt kategorisiyle.
/// Diğer kurumlarda böyle bir uç yok; onların kayıtları arşivden gelir.
pub async fn fetch_ticker_feed(
    client: &reqwest::Client,
    ticker: &str,
    universe: &HashSet<String>,
) -> Vec<AnalystReport> {
    let upper = ticker.trim().to_uppercase();
    let code = upper.trim_end_matches(".IS");
    if code.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();

    for spec in SOURCES {
        match spec.feed {
            Feed::WordPress { base, tag_feeds: true } => {
                let url = format!("{base}/tag/{}/feed/", code.to_lowercase());
                let Ok(body) = get_text(client, &url).await else { continue };
                if let Ok(reports) = parse_wordpress_feed(body.as_bytes(), spec, universe) {
                    out.extend(reports);
                }
            }
            Feed::GarantiJson { url } => {
                // Arama bütün arşivi tarar; birkaç sayfa o hissenin geçmişini
                // fazlasıyla veriyor (ölçümde THYAO 59 rapor, 2023'e kadar).
                out.extend(
                    fetch_pages(6, |page| garanti_page(client, url, page, code, spec, universe))
                        .await,
                );
            }
            Feed::ZiraatClockwork { url, base, .. } => {
                let Some(category) = ziraat_category_for(code) else { continue };
                out.extend(
                    fetch_pages(3, |page| {
                        ziraat_page(client, url, base, category, page, spec, universe)
                    })
                    .await,
                );
            }
            _ => {}
        }
    }

    // Arama kelimesi başlıkta geçtiği halde başka bir şirketin raporu olabilir
    // ("EREGL etkisiyle ISDMR…"); yalnız kayda gerçekten bağlananlar kalır.
    out.retain(|report| report.tickers.iter().any(|found| found == code));
    out.sort_by(|a, b| b.published_ts.cmp(&a.published_ts));
    out.dedup_by(|a, b| a.id == b.id);
    out
}

/// Ziraat'in hisse bazlı alt kategori kimliği.
///
/// Kurum şirket raporlarını hisse başına ayrı bir klasörde tutuyor ve
/// kimlikler sabit. Listede olmayan pay için `None` döner — uydurma kimlikle
/// istek atılmaz.
fn ziraat_category_for(code: &str) -> Option<&'static str> {
    // Kimlikler kurumun kendi seçim listesinden birebir alındı; sıra sayısal
    // değil ve tahmin edilemez (HALKB 42141, THYAO 42149).
    const CATEGORIES: &[(&str, &str)] = &[
        ("AKBNK", "41127"), ("AKCNS", "42118"), ("ARCLK", "42119"), ("ASELS", "42120"),
        ("AYGAZ", "42121"), ("BIMAS", "42122"), ("CIMSA", "42123"), ("EKGYO", "42124"),
        ("ENKAI", "42125"), ("EREGL", "42127"), ("FROTO", "42128"), ("GARAN", "42129"),
        ("ISDMR", "42130"), ("ISCTR", "42131"), ("ISGYO", "42132"), ("KRDMD", "42133"),
        ("KCHOL", "42134"), ("KORDS", "42135"), ("KOZAL", "42136"), ("MAVI", "42137"),
        ("OTKAR", "42138"), ("PETKM", "42139"), ("SAHOL", "42140"), ("HALKB", "42141"),
        ("TSKB", "42142"), ("TAVHL", "42143"), ("TKFEN", "42144"), ("TOASO", "42145"),
        ("TRGYO", "42146"), ("TCELL", "42147"), ("TUPRS", "42148"), ("THYAO", "42149"),
        ("TTKOM", "42150"), ("TURSG", "42151"), ("ULKER", "42152"), ("VAKBN", "42153"),
        ("YKBNK", "42154"),
    ];
    CATEGORIES.iter().find(|(ticker, _)| *ticker == code).map(|(_, id)| *id)
}

/// Bir kaynağın tek turda harcayabileceği en uzun süre.
///
/// Sayfa isteklerinin kendi zaman aşımı var ama sayfa sayısıyla çarpılıyor;
/// üstelik takılan bir sayfa isteği hiç geri dönmeyebiliyor. Ölçümde derin
/// tarama tek bir kaynakta **20 saat** asılı kaldı: arşiv sığ kaldı, hata
/// listesi boş göründü, kullanıcı tarafında çark hiç durmadı. Sessiz sonsuz
/// bekleme, açık bir hatadan çok daha kötüdür.
const SOURCE_DEADLINE: std::time::Duration = std::time::Duration::from_secs(240);

/// `fetch_source`'u ölüm süresiyle sarar: süre dolarsa kaynak hata verir.
///
/// Tarama bir kaynağın iyi niyetine bırakılmaz — bir kurumun yanıt vermemesi
/// yalnız o kurumu listeden düşürür.
pub async fn fetch_source_bounded(
    client: &reqwest::Client,
    spec: &SourceSpec,
    universe: &HashSet<String>,
    pages: usize,
) -> Result<Vec<AnalystReport>, String> {
    match tokio::time::timeout(SOURCE_DEADLINE, fetch_source(client, spec, universe, pages)).await {
        Ok(result) => result,
        Err(_) => Err(format!("{} sn içinde tamamlanmadı", SOURCE_DEADLINE.as_secs())),
    }
}

/// Kaynağı tarar ve sonucu **hangi kaynağa ait olduğuyla** birlikte döndürür.
///
/// Bu ayrı bir `async fn`, kapanış içinde yazılmış bir `async` blok değil:
/// `|spec| async move { … }` biçimi derleyicinin yüksek dereceli ömür
/// çıkarımına takılıyor ve hata ancak Tauri komut sınırında ("implementation
/// of `FnOnce` is not general enough") ortaya çıkıyor — çekirdek tek başına
/// sorunsuz derlendiği için fark edilmesi zor.
async fn fetch_labelled(
    client: &reqwest::Client,
    spec: &'static SourceSpec,
    universe: &HashSet<String>,
    pages: usize,
) -> (&'static SourceSpec, Result<Vec<AnalystReport>, String>) {
    (spec, fetch_source_bounded(client, spec, universe, pages).await)
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

    // Derin turda sayfa sınırını kaynağın kendi bütçesi belirler; buradaki
    // sayı yalnız üst sınırdır ve `fetch_source` onu `deep_pages` ile keser.
    let pages = if deep { usize::MAX } else { INCREMENTAL_PAGES };
    let mut archive = load();
    let mut added = 0;
    let mut errors = Vec::new();

    // Kaynaklar birbirinden bağımsız; sırayla beklemek derin turu kaynakların
    // toplamı kadar uzatıyordu. Eşzamanlılık düşük tutulur: her kaynak kendi
    // içinde de sayfaları paralel çekiyor, çarpım hızla büyür.
    use futures::stream::StreamExt;
    const SOURCE_CONCURRENCY: usize = 3;

    let universe = &universe;
    // Görevler kapanışsız kurulur: `SOURCES.iter().map(|spec| …)` biçiminde
    // derleyici kapanışın bağımsız değişkenini yüksek dereceli ömür sanıyor ve
    // hata ancak Tauri komut sınırında patlıyor. Düz döngüde kapanış yok,
    // dolayısıyla `FnOnce` sınırı da yok.
    let mut tasks = Vec::with_capacity(SOURCES.len());
    for spec in SOURCES {
        tasks.push(fetch_labelled(client, spec, universe, pages));
    }
    let results: Vec<(&'static SourceSpec, Result<Vec<AnalystReport>, String>)> =
        futures::stream::iter(tasks)
            .buffer_unordered(SOURCE_CONCURRENCY)
            .collect()
            .await;

    for (spec, result) in results {
        match result {
            Ok(reports) => added += merge(&mut archive, reports),
            Err(error) => errors.push(format!("{}: {error}", spec.broker)),
        }
    }

    save(&archive);
    (added, errors)
}

// ---------------------------------------------------------------------------
// Belge indirme
// ---------------------------------------------------------------------------

/// İndirilmiş bir rapor belgesi; gömülü görüntüleyiciye veri-URL olarak verilir.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ReportDocument {
    pub content_type: String,
    /// Belge gövdesinin base64'ü.
    pub base64: String,
    pub bytes: usize,
}

/// İndirilen belgenin üst sınırı.
///
/// Şirket raporları birkaç yüz KB'dır ama kurumlar aynı akışta halka arz
/// izahnamesi de yayımlıyor ve onlar 50 MB'ı bulabiliyor. Sınır bunları da
/// alacak kadar geniş tutulur; aşan belge okuyucuda hata verip tarayıcıya
/// yönlendirilir, sessizce boş ekran gösterilmez.
const MAX_DOCUMENT_BYTES: usize = 64 * 1024 * 1024;

/// Belge indirmeye izin verilen konaklar.
///
/// Adres kullanıcı arayüzünden geldiği için serbest bırakılamaz: bilgi
/// deposunun gösterdiği kayıtların konakları neyse yalnız onlar çekilir.
/// **Yeni kaynak eklerken buraya da eklenmeli**, yoksa raporlar listede
/// görünür ama açılmaz.
fn document_host_is_allowed(url: &str) -> bool {
    const ALLOWED_SUFFIXES: &[&str] = &[
        "isyatirim.com.tr",
        "marbas.com.tr",
        "a1capital.com.tr",
        "vkyanaliz.com",
        "halkyatirim.com.tr",
        "garantibbvayatirim.com.tr",
        "ziraatyatirim.com.tr",
        "gedik.com",
        "ahlatciyatirim.com.tr",
        "phillipcapital.com.tr",
        "integralyatirim.com.tr",
        // Bilgi deposu SPK haftalık bültenlerini de aynı okuyucuda açar.
        "spk.gov.tr",
    ];
    let Some(rest) = url.strip_prefix("https://") else { return false };
    let host = rest.split(['/', '?', '#']).next().unwrap_or_default();
    let host = host.split('@').next_back().unwrap_or_default();
    let host = host.split(':').next().unwrap_or_default().to_ascii_lowercase();
    ALLOWED_SUFFIXES
        .iter()
        .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
}

/// Rapor belgesini indirir ve base64 olarak döndürür.
///
/// Kurumların çoğu PDF'lerini `X-Frame-Options: SAMEORIGIN` ile yayımlıyor;
/// adres doğrudan bir çerçeveye verilirse görüntüleyici boş kalır. Belge
/// uygulama tarafından indirilip veri-URL'i olarak gömülünce bu kısıt
/// devreden çıkar ve rapor uygulamanın içinde okunur.
pub async fn fetch_document(client: &reqwest::Client, url: &str) -> Result<ReportDocument, String> {
    use base64::Engine as _;

    if !document_host_is_allowed(url) {
        return Err(format!("bu adres rapor kaynağı değil: {url}"));
    }
    // Kaynaklar dosya adlarını olduğu gibi yayımlıyor: SPK bültenlerinde
    // boşluk, aracı kurumlarda Türkçe harf geçiyor. Kodlama `%` dokunmadığı
    // için zaten kodlanmış adresler ikinci kez kodlanmaz.
    let url = &encode_url_path(url);

    // Süre gövdenin tamamını kapsar. Şirket raporu saniyeler sürer ama aynı
    // akıştaki izahnameler 50 MB'ı bulup dakikaya yaklaşıyor; sınır ona göre.
    let response = client
        .get(url)
        .timeout(std::time::Duration::from_secs(180))
        .header("User-Agent", BROWSER_UA)
        .header("Accept", "application/pdf,*/*")
        .send()
        .await
        .map_err(|error| format!("{url}: {error}"))?;
    let response = crate::retry::check_status(response, url)?;

    // Kurum belgeyi eklenti adı olmadan da sunabiliyor (Garanti `.vsf` verir);
    // tür başlıktan okunur, adresin uzantısından değil.
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.split(';').next().unwrap_or(value).trim().to_string())
        .unwrap_or_else(|| "application/pdf".to_string());

    let body = response.bytes().await.map_err(|error| format!("{url}: {error}"))?;
    if body.len() > MAX_DOCUMENT_BYTES {
        return Err(format!("belge çok büyük ({} bayt): {url}", body.len()));
    }

    // PDF'i olmayan kaynaklarda (A1 Capital gibi) rapor bir web yazısıdır.
    // Gövde blob olarak gömüldüğünde sayfanın kökü kaybolur ve göreli duran
    // biçem/görsel adresleri çözülemez; `<base>` bunu kaynağa geri bağlar.
    if content_type.contains("html") {
        let html = String::from_utf8_lossy(&body);
        let patched = inject_base_href(&html, url);
        return Ok(ReportDocument {
            content_type,
            base64: base64::engine::general_purpose::STANDARD.encode(patched.as_bytes()),
            bytes: patched.len(),
        });
    }

    Ok(ReportDocument {
        content_type,
        base64: base64::engine::general_purpose::STANDARD.encode(&body),
        bytes: body.len(),
    })
}

/// Belgeye `<base href>` ekler; zaten varsa dokunmaz.
fn inject_base_href(html: &str, url: &str) -> String {
    let lower = html.to_lowercase();
    if lower.contains("<base ") {
        return html.to_string();
    }
    let tag = format!("<base href=\"{}\">", url.replace('"', "%22"));
    match lower.find("<head").and_then(|at| html[at..].find('>').map(|off| at + off + 1)) {
        Some(at) => format!("{}{tag}{}", &html[..at], &html[at..]),
        // `<head>` yoksa belge parçası demektir; etiket başa konur.
        None => format!("{tag}{html}"),
    }
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

    /// Kaynağı kimliğinden bulur. Konumla erişmek, listeye araya yeni kurum
    /// eklendiğinde testleri sessizce başka kaynağa bağlıyordu.
    fn source(id: &str) -> SourceSpec {
        *SOURCES
            .iter()
            .find(|spec| spec.id == id)
            .unwrap_or_else(|| panic!("{id} kaynağı SOURCES içinde yok"))
    }

    fn spec() -> SourceSpec {
        source("isyatirim")
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

    /// Unvan başlığın ortasında ve arkasında rapor türüyle geçebiliyor;
    /// eskiden yalnız son bölüm denendiği için bu kayıtlar bağlanmıyordu.
    #[test]
    fn tickers_match_company_name_anywhere_in_title() {
        let universe: HashSet<String> = ["THYAO", "EREGL", "AKFYE"].into_iter().map(String::from).collect();
        assert_eq!(
            extract_tickers("Ereğli Demir ve Çelik Fabrikaları 2Ç26 Bilanço Analizi", &[], &universe),
            vec!["EREGL".to_string()]
        );
        assert_eq!(
            extract_tickers("Şirket Bilgi Notu | Akfen Yenilenebilir Enerji", &[], &universe),
            vec!["AKFYE".to_string()]
        );
        // Evrende olmayan şirket üretilmez.
        assert!(extract_tickers("Filanca Holding 2Ç26 Değerlendirme", &[], &universe).is_empty());
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
        let spec = source("vakif");
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
        let spec = source("halk");
        let reports = parse_halk_listing(html, &spec, &universe());
        assert_eq!(reports.len(), 1, "tek rapor beklenir: {reports:?}");
        assert_eq!(reports[0].broker, "Halk Yatırım");
        assert_eq!(reports[0].title, "Finansal Radar");
        assert_eq!(reports[0].published, "2026-08-07");
        assert!(reports[0].pdf_url.as_deref().unwrap().ends_with(".pdf"));
    }

    /// Garanti BBVA: kod başlıkta önde, kategori etikette; abone kaydı atlanır.
    #[test]
    fn garanti_json_maps_to_reports() {
        let json = r#"{"Items":[
            {"Title":"HALKB 2Ç26 Finansal Sonuçlar","ShortDescription":"Halkbank 2Ç26'da 8.2mlr TL net kar açıkladı","CategoryName":"Şirket Raporları","PublishDate":"10.08.2026 08:03","PdfUrl":"https://www.garantibbvayatirim.com.tr/medium/ResearchReports-Constant-83920.vsf","FileType":"pdf","Tags":[]},
            {"Title":"Bir Bakışta Yurt Dışı","ShortDescription":"","CategoryName":"Bir Bakışta Yurt Dışı","PublishDate":"10.08.2026 16:01","PdfUrl":null,"FileType":"","Tags":[]}
        ],"TotalItems":6880}"#;
        let spec = source("garanti");
        let universe: HashSet<String> = ["HALKB"].into_iter().map(String::from).collect();
        let reports = parse_garanti_json(json, &spec, &universe).unwrap();
        // PDF'i olmayan kayıt arşive girmez: ekranda açılamaz.
        assert_eq!(reports.len(), 1, "yalnız PDF'li kayıt beklenir: {reports:?}");
        let report = &reports[0];
        assert_eq!(report.broker, "Garanti BBVA Yatırım");
        assert_eq!(report.published, "2026-08-10");
        assert_eq!(report.tickers, vec!["HALKB".to_string()]);
        // "Finansal Sonuçlar" sözlükteki kalıplara uymaz; tek hisseye bağlı
        // olduğu için yine de şirket raporu sayılır.
        assert_eq!(report.kind, ReportKind::Company);
        assert!(report.summary.is_some());
    }

    /// Ziraat: başlık ve tarih tek `aria-label` içinde; Türkçe dosya adı
    /// yüzde-kodlanmalı, yoksa gömülü görüntüleyici açamaz.
    #[test]
    fn ziraat_listing_maps_to_reports() {
        let html = r#"<ul class="list-document popup" id="pdfView">
            <li><a href="/documents/category/Ko&#xE7;Holding-2&#xC7;26-20260810.pdf" target="_blank" class="lnk-download" aria-label="KCHOL 2&#xC7;26 10-08-2026"><span class="file-title">KCHOL 2&#xC7;26 10-08-2026</span></a></li>
            <li><a href="/documents/category/rehber.html" class="lnk-download" aria-label="Rehber 01-01-2026"></a></li>
        </ul>"#;
        let spec = source("ziraat");
        let universe: HashSet<String> = ["KCHOL"].into_iter().map(String::from).collect();
        let reports = parse_ziraat_listing(html, "https://www.ziraatyatirim.com.tr", &spec, &universe);
        assert_eq!(reports.len(), 1, "PDF olmayan satır atlanmalı: {reports:?}");
        let report = &reports[0];
        assert_eq!(report.title, "KCHOL 2Ç26");
        assert_eq!(report.published, "2026-08-10");
        assert_eq!(report.tickers, vec!["KCHOL".to_string()]);
        let pdf = report.pdf_url.as_deref().unwrap();
        assert!(pdf.starts_with("https://www.ziraatyatirim.com.tr/documents/"), "{pdf}");
        assert!(pdf.is_ascii(), "Türkçe harf yüzde-kodlanmalı: {pdf}");
    }

    /// Gedik: liste `__NEXT_DATA__` içinde; kod başlıkta değil dosya adındadır.
    #[test]
    fn gedik_next_data_maps_to_reports() {
        let html = r#"<html><body><script id="__NEXT_DATA__" type="application/json">
        {"props":{"pageProps":{"data":{"fields":{"components":[{"fields":[{"tabs":[{"tabsInfo":[
            {"title":"Çeyreklik Finansal Görünüm Değerlendirme Raporları - 10.08.2026","summaryDate":"10/08/2026","period":"Çeyreklik","pdfUrl":"https://cdn.gedik.com/cdn/bulletin/2026/08/10/2C26_Finansal_Degerlendirme_SASA_20260810_a8d4d240.pdf"},
            {"title":"Günlük Bülten - 10.08.2026","summaryDate":"10/08/2026","period":"Günlük","pdfUrl":"https://cdn.gedik.com/cdn/bulletin/2026/08/10/Gedik_Gunluk_Bulten_10082026.pdf"}
        ]}]}]}]}}}}}</script></body></html>"#;
        let spec = source("gedik");
        let universe: HashSet<String> = ["SASA", "GEDIK"].into_iter().map(String::from).collect();
        let reports = parse_gedik_next_data(html, &spec, &universe).unwrap();
        assert_eq!(reports.len(), 2);
        assert_eq!(reports[0].tickers, vec!["SASA".to_string()]);
        assert_eq!(reports[0].published, "2026-08-10");
        assert_eq!(reports[0].kind, ReportKind::Company);
        // Kurumun kendi adı hisse koduyla çakışır; "Gedik_" büyütülüp GEDIK'e
        // bağlanırsa her bülten kurumun kendi payına etiketlenirdi.
        assert!(reports[1].tickers.is_empty(), "{:?}", reports[1].tickers);
        assert_eq!(reports[1].kind, ReportKind::Bulletin);
    }

    /// Ahlatcı: başlıktaki "Yeni" rozeti metne karışmamalı, tarih virgülle
    /// bitse de çözülmeli, eski kayıtlarda kod dosya adından gelmeli.
    #[test]
    fn ahlatci_timeline_maps_to_reports() {
        let html = r#"<div class="ar-timeline">
            <a class="ar-entry ar-new" href="/arastirma/sirket-raporlari/35473/EREGL_26Q2_Finansal_Degerlendirme.pdf">
              <div class="ar-edate"><span class="ar-day">10</span><span class="ar-mon">Ağu</span></div>
              <div class="ar-emeta"><div class="ar-etitle">EREGL 26Q2 Finansal Değerlendirme <span class="ar-badge">Yeni</span></div>
              <div class="ar-esub"><span> 10 Ağustos 2026, Pazartesi </span></div></div></a>
            <a class="ar-entry" href="/arastirma/sirket-raporlari/30743/asels-20192-ceyrek-bilanco-analizi_4239_2019-08-22.pdf">
              <div class="ar-emeta"><div class="ar-etitle">2019/2 Çeyrek Bilanço Analizi</div>
              <div class="ar-esub"><span> 22 Ağustos 2019, Perşembe </span></div></div></a>
        </div>"#;
        let spec = source("ahlatci");
        let universe: HashSet<String> = ["EREGL", "ASELS"].into_iter().map(String::from).collect();
        let reports = parse_ahlatci_timeline(html, "https://www.ahlatciyatirim.com.tr", &spec, &universe);
        assert_eq!(reports.len(), 2, "{reports:?}");
        assert_eq!(reports[0].title, "EREGL 26Q2 Finansal Değerlendirme", "rozet metne karıştı");
        assert_eq!(reports[0].published, "2026-08-10");
        assert_eq!(reports[0].tickers, vec!["EREGL".to_string()]);
        // Başlıkta kod yok; dosya adının başındaki küçük harfli koddan gelir.
        assert_eq!(reports[1].tickers, vec!["ASELS".to_string()]);
        assert_eq!(reports[1].published, "2019-08-22");
    }

    /// PhillipCapital: tarih, kategori ve başlık ayrı alanlarda.
    #[test]
    fn phillip_cards_map_to_reports() {
        let html = r#"<article class="product-item">
            <div class="product-meta"><span class="product-date">07 A&#x11F;ustos 2026</span>
            <span class="product-category">&#x15E;irket Raporlar&#x131;</span></div>
            <h3 class="product-title">EREGL Company Update Report </h3>
            <a href="/Files/CompanyReport/0654e001-8778-4847-a71a-404d3b309822.pdf" class="btn-review">Raporu İncele</a>
          </article>"#;
        let spec = source("phillip");
        let universe: HashSet<String> = ["EREGL"].into_iter().map(String::from).collect();
        let reports = parse_phillip_cards(html, "https://www.phillipcapital.com.tr", &spec, &universe);
        assert_eq!(reports.len(), 1, "{reports:?}");
        assert_eq!(reports[0].title, "EREGL Company Update Report");
        assert_eq!(reports[0].published, "2026-08-07");
        assert_eq!(reports[0].tickers, vec!["EREGL".to_string()]);
        assert_eq!(reports[0].kind, ReportKind::Company);
    }

    /// Türkçe 'İ' küçültülünce iki kod noktasına açılır ve metnin bayt
    /// uzunluğu değişir. Konumlar küçültülmüş kopyadan alınırsa yanlış yer
    /// silinir, etiket yerinde kalır ve döngü aynı etiketi yeniden bulur:
    /// derin tarama Ahlatcı sayfalarında saatlerce %100 CPU'da asılı kaldı.
    #[test]
    fn strip_elements_survives_turkish_dotted_i() {
        // 'İ'ler `<style>`den önce: kopyada her biri bir bayt uzatır.
        let html = "İŞ İLETİŞİM<style>.ar-entry{color:red}</style> 10 Ağustos 2026";
        assert_eq!(strip_html(html), "İŞ İLETİŞİM 10 Ağustos 2026");

        // Etiket adı büyük harfli de olabilir; duyarsızlık korunmalı.
        let mixed = "İİİ<SCRIPT>var a=1;</SCRIPT>Rapor";
        assert_eq!(strip_html(mixed), "İİİRapor");

        // Kapanışı olmayan etiket sonuna kadar atılır, döngü kilitlenmez.
        assert_eq!(strip_html("İİİ<style>.a{}"), "İİİ");
    }

    /// Ahlatcı bloklarına sayfanın CSS'i karışıyor (`.ar-entry` kuralı
    /// yüzünden blok `<style>` ortasından başlıyor); tarih yine de çözülmeli.
    #[test]
    fn ahlatci_date_reads_past_stylesheet_noise() {
        let block = ".ar-entry{display:flex}</style><div class=\"ar-esub\">\
                     <span> 22 Ağustos 2019, Perşembe </span></div>";
        assert_eq!(ahlatci_date(block).map(|(iso, _)| iso), Some("2019-08-22".to_string()));
    }

    /// Integral: tarih göreli metinde değil `title` özniteliğinde; eski
    /// kayıtlar kodu yalnız dosya adında taşıyor.
    #[test]
    fn integral_cards_map_to_reports() {
        let html = r#"<div class="card-title d-flex justify-content-between ">
            <a href="https://integralyatirim.com.tr/sirket-sektor-raporlari/ekdmr-2c26-bilanco-analizi" class="text-dark">
            <h3 class="fw-600"> EKDMR 2Ç26 Bilanço Analizi </h3></a>
            <small title="07.08.2026"> 4 Gün Önce </small></div>
            <p class="card-text fs-18"> EKDMR 2Ç26 finansallarına ilişkin raporumuza ulaşabilirsiniz. </p>
            <a href="https://integralyatirim.com.tr/uploads/PDF/ekdmr-2c26-bilanco-analizi/Sirket-Analizi_EKDMR.pdf" class="card-link">Dosyayı Görüntüle</a>
          <div class="card-title d-flex justify-content-between ">
            <a href="https://integralyatirim.com.tr/sirket-sektor-raporlari/ford-otosan"><h3> Ford Otosan 2Ç23 Bilanço Analizi </h3></a>
            <small title="06.09.2023"> 3 Yıl Önce </small></div>
            <a href="https://integralyatirim.com.tr/uploads/PDF/SirketAnalizi_FROTO.pdf" class="card-link">Dosyayı Görüntüle</a>"#;
        let spec = source("integral");
        let universe: HashSet<String> = ["EKDMR", "FROTO"].into_iter().map(String::from).collect();
        let reports = parse_integral_cards(html, "https://integralyatirim.com.tr", &spec, &universe);
        assert_eq!(reports.len(), 2, "{reports:?}");
        assert_eq!(reports[0].title, "EKDMR 2Ç26 Bilanço Analizi");
        // Görünen metin "4 Gün Önce"; tarih öznitelikten gelmeli.
        assert_eq!(reports[0].published, "2026-08-07");
        assert_eq!(reports[0].tickers, vec!["EKDMR".to_string()]);
        assert!(reports[0].summary.as_deref().unwrap_or_default().starts_with("EKDMR 2Ç26"));
        assert!(reports[0].pdf_url.as_deref().unwrap_or_default().ends_with("Sirket-Analizi_EKDMR.pdf"));
        // Başlıkta kod yok: unvandan da, dosya adındaki koddan da FROTO çıkar.
        assert_eq!(reports[1].tickers, vec!["FROTO".to_string()]);
        assert_eq!(reports[1].published, "2023-09-06");
    }

    /// Ziraat'in hisse bazlı kategori kimlikleri tahmin edilemez; listedeki
    /// eşleşme birebir kurumun seçim listesinden gelmeli.
    #[test]
    fn ziraat_category_map_is_exact() {
        assert_eq!(ziraat_category_for("THYAO"), Some("42149"));
        assert_eq!(ziraat_category_for("HALKB"), Some("42141"));
        assert_eq!(ziraat_category_for("AKBNK"), Some("41127"));
        // Listede olmayan pay için uydurma kimlik üretilmez.
        assert_eq!(ziraat_category_for("ZZZZZ"), None);
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
            ..Default::default()
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

    /// Her kaynağın belgesi gerçekten indirilebilmeli. Ekranda okunabilmesi
    /// listede görünmesine değil, gövdenin çekilebilmesine bağlı.
    #[tokio::test]
    #[ignore = "requires live broker site access"]
    async fn live_documents_can_be_downloaded() {
        let client = reqwest::Client::new();
        let universe: HashSet<String> = crate::bist_universe::load(&client)
            .await
            .into_iter()
            .map(|(code, _)| code)
            .collect();

        for spec in SOURCES {
            let reports = fetch_source(&client, spec, &universe, 1).await.unwrap_or_default();
            let Some(report) = reports.iter().find(|r| r.pdf_url.is_some()) else {
                println!("{}: PDF taşıyan rapor yok, atlandı", spec.broker);
                continue;
            };
            let url = report.pdf_url.as_deref().unwrap();
            match fetch_document(&client, url).await {
                Ok(document) => {
                    assert!(document.bytes > 1_000, "{}: belge boş ({url})", spec.broker);
                    println!(
                        "{}: {} · {} bayt · {}",
                        spec.broker, document.content_type, document.bytes, report.title
                    );
                }
                Err(error) => panic!("{} belgesi indirilemedi ({url}): {error}", spec.broker),
            }
        }
    }

    /// Bilgi deposu SPK bültenlerini de aynı okuyucuda açıyor; bültenin
    /// gövdesi gerçekten indirilebilmeli.
    #[tokio::test]
    #[ignore = "requires live broker site access"]
    async fn live_spk_bulletin_document_downloads() {
        let client = reqwest::Client::new();
        let bulletins = crate::spk::fetch_latest_bulletins(&client).await.unwrap_or_default();
        let Some(bulletin) = bulletins.iter().find(|b| b.url.to_lowercase().ends_with(".pdf")) else {
            panic!("SPK bülten listesinde PDF yok: {bulletins:?}");
        };
        let document = fetch_document(&client, &bulletin.url)
            .await
            .unwrap_or_else(|error| panic!("SPK bülteni indirilemedi ({}): {error}", bulletin.url));
        assert!(document.content_type.contains("pdf"), "{}", document.content_type);
        assert!(document.bytes > 1_000, "boş bülten: {}", bulletin.url);
        println!("SPK: {} · {} bayt · {}", document.content_type, document.bytes, bulletin.title);
    }

    /// Derin tarama gerçekten derin olmalı. Arşivin sığ kalması sessiz bir
    /// hatadır: ekran dolu görünür ama kapsam yoktur.
    #[tokio::test]
    #[ignore = "requires live broker site access"]
    async fn live_deep_scan_is_actually_deep() {
        let client = reqwest::Client::new();
        let universe: HashSet<String> = crate::bist_universe::load(&client)
            .await
            .into_iter()
            .map(|(code, _)| code)
            .collect();

        let mut total = 0;
        let mut linked = 0;
        for spec in SOURCES {
            // Süre de ölçülür: yavaşlayan bir kaynak ölüm süresine dayanıp
            // bütün turu uzatır, sayıya bakınca bu görünmez.
            let started = std::time::Instant::now();
            let outcome = fetch_source_bounded(&client, spec, &universe, usize::MAX).await;
            let elapsed = started.elapsed().as_secs_f32();
            let reports = match outcome {
                Ok(reports) => reports,
                Err(error) => {
                    println!("{:24} DÜŞTÜ ({elapsed:.0} sn): {error}", spec.broker);
                    continue;
                }
            };
            let with_ticker = reports.iter().filter(|r| !r.tickers.is_empty()).count();
            total += reports.len();
            linked += with_ticker;
            let oldest = reports.iter().map(|r| r.published.as_str()).filter(|d| !d.is_empty()).min().unwrap_or("-");
            println!(
                "{:24} {:5} rapor | {:5} hisseli | en eski {} | {elapsed:.0} sn",
                spec.broker, reports.len(), with_ticker, oldest
            );
        }
        println!("TOPLAM {total} rapor, {linked} tanesi hisseye bağlı");
        assert!(total > 2_000, "derin tarama sığ kaldı: {total}");
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

    /// Belge indirme yalnız rapor kaynaklarına açılır; keyfi adres çekilmez.
    #[test]
    fn document_host_allowlist_rejects_foreign_urls() {
        assert!(document_host_is_allowed(
            "https://www.ziraatyatirim.com.tr/documents/category/TTKOM_2C26.pdf"
        ));
        assert!(document_host_is_allowed("https://cdn.gedik.com/cdn/bulletin/x.pdf"));
        assert!(document_host_is_allowed("https://spk.gov.tr/data/61e0/abc.pdf"));
        assert!(!document_host_is_allowed("https://evil.example.com/x.pdf"));
        // Konak adının bir kaynağı *içermesi* yetmez, onunla bitmeli.
        assert!(!document_host_is_allowed("https://gedik.com.evil.example/x.pdf"));
        // Kullanıcı-bilgisi hilesi konak yerine geçmemeli.
        assert!(!document_host_is_allowed("https://cdn.gedik.com@evil.example/x.pdf"));
        // Şifresiz taşımaya izin yok.
        assert!(!document_host_is_allowed("http://cdn.gedik.com/x.pdf"));
        assert!(!document_host_is_allowed("file:///etc/passwd"));
    }

    /// Özet, eklenti biçemleriyle başlamamalı. WordPress kurulumları yazının
    /// başına `<style>` gömüyor; etiket atılıp gövde bırakılırsa ekranda
    /// raporun metni yerine CSS görünüyordu.
    #[test]
    fn summary_drops_style_and_script_bodies() {
        let body = r#"<style>/*! elementor - v3.7.4 */ .elementor-drop-cap{color:#818a91}</style>
            <p>Kapeks Kimya Sanayi A.Ş. Halka Arz Detayları: Talep Toplama 12 – 13 Ağustos.</p>
            <script>var x = 1;</script>"#;
        let text = strip_html(body);
        assert!(text.starts_with("Kapeks Kimya"), "{text}");
        assert!(!text.contains("elementor"), "{text}");
        assert!(!text.contains("var x"), "{text}");
    }

    /// HTML rapor blob olarak gömülünce göreli adresler kaynağa bağlanmalı.
    #[test]
    fn base_href_is_injected_once() {
        let html = "<html><head><meta charset=\"utf-8\"></head><body>x</body></html>";
        let patched = inject_base_href(html, "https://a1capital.com.tr/petkm-analiz/");
        assert!(patched.contains("<head><base href=\"https://a1capital.com.tr/petkm-analiz/\">"));
        // İkinci geçiş yeni etiket eklemez.
        assert_eq!(inject_base_href(&patched, "https://example.com/"), patched);
        // `<head>` yoksa parça başına konur.
        assert!(inject_base_href("<p>x</p>", "https://a1capital.com.tr/").starts_with("<base href="));
    }

    /// Her kaynağın konağı belge beyaz listesinde olmalı. Kaynak eklenip
    /// listeye eklenmezse raporlar listede görünür ama açılmaz — sessiz ve
    /// ancak tıklandığında fark edilen bir kusur.
    #[test]
    fn every_source_host_can_be_opened_in_the_reader() {
        for spec in SOURCES {
            let url = spec.feed.primary_url();
            assert!(
                document_host_is_allowed(url),
                "{} beyaz listede yok: {url}",
                spec.broker
            );
        }
    }

    /// Kaynak kimlikleri benzersiz olmalı; arşiv kaydı `source_id` ile eşlenir.
    #[test]
    fn source_ids_are_unique() {
        let ids: HashSet<&str> = SOURCES.iter().map(|s| s.id).collect();
        assert_eq!(ids.len(), SOURCES.len());
    }
}
