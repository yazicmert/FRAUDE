//! Küresel kurumların BIST çağrıları — haber akışından çıkarım.
//!
//! **Neden haberden.** JPMorgan, Goldman Sachs, Morgan Stanley gibi kurumların
//! BIST raporları kurumsal aboneliğe kapalıdır; kamuya açık bir uç yoktur ve
//! olmayacaktır. Bu yüzden bu modül raporun kendisini değil, çağrıyı **aktaran
//! haberi** kaydeder. Kayıt bunu saklamaz: `via` alanı haberi geçen yayını
//! taşır, `url` rapora değil habere gider ve ekran kaydı "haber kaynaklı"
//! diye işaretler. Rapor PDF'i uydurulmaz.
//!
//! **Asıl iş süzmede, sorguda değil.** Google News `OR`'ları gevşek bağlıyor:
//! "(Goldman Sachs OR JPMorgan) (BIST OR Türk)" sorgusu Riskified, Snap,
//! SanDisk ve Güney Kore borsası haberleri döndürüyor (ölçüldü: ilk 10
//! sonucun 8'i Türkiye dışı). Sorgu yalnız ağı atar; kaydın üretilip
//! üretilmeyeceğine dört kapı karar verir:
//!
//! 1. **Kurum**: başlıkta tanınan bir küresel kurum kelime sınırıyla geçmeli.
//! 2. **Çağrı**: "hedef fiyat", "tavsiye", "rating" gibi bir analiz izi olmalı.
//!    Takas/akış haberleri ("en çok alım satım yaptığı hisseler") elenir —
//!    BIST kodu taşırlar ama analiz değildirler.
//! 3. **Türkiye**: ya evrende doğrulanmış bir BIST kodu çıkmalı, ya da
//!    Türkiye + hisse bağlamı birlikte bulunmalı.
//! 4. **Emtia/FX değil**: kod çıkmadıysa altın, petrol, bakır, kur haberleri
//!    elenir; bunlar şirket analizi değildir.
//!
//! Hiçbiri sağlanmazsa kayıt üretilmez. Kesinlik, kapsamdan önce gelir:
//! yanlış bir "Goldman AL dedi" kaydı, eksik kayıttan çok daha pahalıdır.
//!
//! **Tekilleştirme.** Aynı çağrıyı on yayın birden geçer. Kimlik habere değil
//! **çağrıya** bağlanır (kurum + kodlar + tarih + tavsiye + hedef), böylece on
//! haber tek kayda iner; `research_reports::merge` aynı kimliği güncelleyerek
//! çoğalmayı kendiliğinden önler.

use std::collections::HashSet;

use crate::domain::NewsItem;
use crate::research_reports::{
    extract_rating, extract_target_price, fold, ticker_from_company_name, AnalystReport,
    BrokerScope, ReportKind,
};

/// `SOURCES` dışındaki bu akışın kaynak kimliği; ekran süzgeci bunu kullanır.
pub const SOURCE_ID: &str = "global-news";

/// Kaynağın ekranda görünen adı.
pub const SOURCE_LABEL: &str = "Küresel kurum çağrıları (haber kaynaklı)";

/// Tek turda bir sorgudan alınacak en fazla haber.
const MAX_PER_QUERY: usize = 40;

// ---------------------------------------------------------------------------
// Kurum sözlüğü
// ---------------------------------------------------------------------------

/// Takip edilen küresel kurum. `aliases` katlanmış (ASCII, küçük harf) yazılır;
/// karşılaştırma da katlanmış metin üzerinde yapılır.
#[derive(Clone, Copy, Debug)]
pub struct GlobalBroker {
    /// Kayda yazılacak tek biçim ad.
    pub canonical: &'static str,
    /// Haberlerde geçen yazımlar.
    pub aliases: &'static [&'static str],
}

/// BIST kapsayan küresel kurumlar.
///
/// Kısa rumuzlarda dikkat: "ing" Türkçede sık geçen bir hece olduğu için tek
/// başına alınmaz, "ing bank" olarak aranır. "citi" ve "ubs" kelime sınırıyla
/// arandığı için "Citibank"/"Citigroup" ayrı yazılır.
///
/// Derecelendirme kuruluşları (Moody's, Fitch, S&P) burada YOKTUR: onlarınki
/// kredi notu, hisse analizi değil — ayrı bir kayıt türü olmaları gerekir.
pub const GLOBAL_BROKERS: &[GlobalBroker] = &[
    GlobalBroker { canonical: "Goldman Sachs", aliases: &["goldman sachs", "goldman"] },
    GlobalBroker {
        canonical: "JPMorgan",
        aliases: &["jpmorgan", "jp morgan", "j.p. morgan", "jp. morgan"],
    },
    GlobalBroker { canonical: "Morgan Stanley", aliases: &["morgan stanley"] },
    GlobalBroker { canonical: "HSBC", aliases: &["hsbc"] },
    GlobalBroker { canonical: "Citi", aliases: &["citigroup", "citibank", "citi bank", "citi"] },
    GlobalBroker { canonical: "UBS", aliases: &["ubs"] },
    GlobalBroker { canonical: "Deutsche Bank", aliases: &["deutsche bank"] },
    GlobalBroker { canonical: "Barclays", aliases: &["barclays"] },
    GlobalBroker {
        canonical: "Bank of America",
        aliases: &["bank of america", "bofa", "merrill lynch"],
    },
    GlobalBroker { canonical: "BNP Paribas", aliases: &["bnp paribas", "bnp"] },
    GlobalBroker { canonical: "Société Générale", aliases: &["societe generale", "socgen"] },
    GlobalBroker { canonical: "Jefferies", aliases: &["jefferies"] },
    GlobalBroker {
        canonical: "Wood & Company",
        aliases: &["wood & company", "wood and company", "wood&company"],
    },
    GlobalBroker { canonical: "Raiffeisen", aliases: &["raiffeisen"] },
    GlobalBroker { canonical: "Erste Group", aliases: &["erste group", "erste bank"] },
    GlobalBroker { canonical: "Renaissance Capital", aliases: &["renaissance capital"] },
    GlobalBroker { canonical: "Tellimer", aliases: &["tellimer"] },
    GlobalBroker { canonical: "ING", aliases: &["ing bank", "ing groep"] },
    GlobalBroker { canonical: "UniCredit", aliases: &["unicredit"] },
    GlobalBroker { canonical: "Standard Chartered", aliases: &["standard chartered"] },
    GlobalBroker { canonical: "Nomura", aliases: &["nomura"] },
    GlobalBroker { canonical: "Credit Suisse", aliases: &["credit suisse"] },
];

// ---------------------------------------------------------------------------
// Süzgeç sözlükleri
// ---------------------------------------------------------------------------

/// Haberin bir analiz çağrısını aktardığını gösteren izler.
const CALL_MARKERS: &[&str] = &[
    "hedef fiyat",
    "hedef deger",
    "hedefini",
    "hedeflerini",
    "hedefleri",
    "price target",
    "tavsiye",
    "onerisi",
    "onerdi",
    "rating",
    "not artis",
    "notunu",
    "raporu",
    "raporunda",
    "analizi",
    "gorunumu",
    "degerlendirmesi",
    "beklentisi",
    "tahmini",
    "yukseltti",
    "dusurdu",
    "revize",
];

/// Analiz değil **akış/takas** haberi olduğunu gösteren izler. Bunlar BIST
/// kodu taşıdıkları için kod süzgecini geçerler; ayrıca elenmeleri gerekir.
const FLOW_MARKERS: &[&str] = &[
    "alim satim",
    "en cok alan",
    "en cok satan",
    "en cok alim",
    "en ciddi satici",
    "takas",
    "portfoyunden cikti",
    "geri alim programi",
    "net alici",
    "net satici",
    // "topla" yazılmaz: "toplantı" da eşleşir ve sağlam haberler elenir.
    "topladi",
    "toplarken",
    "hisse geri alim",
];

/// Türkiye bağlamı.
const TURKEY_MARKERS: &[&str] =
    &["turkiye", "turk", "bist", "borsa istanbul", "istanbul borsasi"];

/// Hisse/şirket bağlamı — Türkiye geçse bile makro haber kayda girmesin diye.
const EQUITY_MARKERS: &[&str] = &[
    "hisse",
    "bist",
    "borsa istanbul",
    "banka",
    "bankacilik",
    "endeks",
    "sirket",
    "sektor",
];

/// Emtia ve kur haberleri: şirket analizi değildir.
const COMMODITY_MARKERS: &[&str] = &[
    "altin",
    "gumus",
    "bakir",
    "petrol",
    "brent",
    "dogalgaz",
    "bitcoin",
    "kripto",
    "dolar/tl",
    "euro/tl",
    "dolar kuru",
];

// ---------------------------------------------------------------------------
// Süzme
// ---------------------------------------------------------------------------

/// `needle`, `hay` içinde **kelime olarak** geçiyor mu?
///
/// "ubs" gibi kısa rumuzlar serbest aramada "clubs" içinde de eşleşir; sınır
/// denetimi olmadan kurum sözlüğü kullanılamaz. Katlanmış metin üzerinde
/// çalışıldığı varsayılır.
fn contains_word(hay: &str, needle: &str) -> bool {
    if needle.is_empty() {
        return false;
    }
    let bytes = hay.as_bytes();
    let mut from = 0;
    while let Some(offset) = hay[from..].find(needle) {
        let start = from + offset;
        let end = start + needle.len();
        let before_ok = start == 0 || !(bytes[start - 1] as char).is_alphanumeric();
        let after_ok = end == bytes.len() || !(bytes[end] as char).is_alphanumeric();
        if before_ok && after_ok {
            return true;
        }
        // Katlanmış metinde ilerlerken bayt sınırına dikkat: `needle` ASCII
        // olduğu için `start + 1` her zaman geçerli bir sınırdır.
        from = start + 1;
        if from >= hay.len() {
            break;
        }
    }
    false
}

/// `needle` bir kelimenin **başında** geçiyor mu? Sonrasına ek gelebilir.
///
/// Türkçe eklemeli bir dildir: "hedef fiyat" haberde "hedef fiyatları",
/// "banka" ise "bankaları" olarak geçer. İki yanda da sınır arayan
/// `contains_word` bu kalıpları kaçırır — sözlük eşleşmeleri bu yüzden yalnız
/// baş sınırını arar. Kurum rumuzlarında ise katı sınır şarttır ("clubs"
/// içinde "ubs" bulunmasın diye), o yüzden iki ayrı işlev var.
fn starts_word(hay: &str, needle: &str) -> bool {
    if needle.is_empty() {
        return false;
    }
    let bytes = hay.as_bytes();
    let mut from = 0;
    while let Some(offset) = hay[from..].find(needle) {
        let start = from + offset;
        if start == 0 || !(bytes[start - 1] as char).is_alphanumeric() {
            return true;
        }
        from = start + 1;
        if from >= hay.len() {
            break;
        }
    }
    false
}

/// Sözlük eşleşmesi (ek toleranslı).
fn any_prefix(hay: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| starts_word(hay, needle))
}

/// Katı kelime eşleşmesi.
fn any_word(hay: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| contains_word(hay, needle))
}

/// Katlanmış başlıkta geçen küresel kurumu bulur.
pub fn detect_broker(folded: &str) -> Option<&'static GlobalBroker> {
    GLOBAL_BROKERS
        .iter()
        .find(|broker| broker.aliases.iter().any(|alias| contains_word(folded, alias)))
}

/// Haber bir analiz çağrısı mı, yoksa akış/kurumsal haber mi?
fn looks_like_call(folded: &str) -> bool {
    any_prefix(folded, CALL_MARKERS) && !any_prefix(folded, FLOW_MARKERS)
}

// ---------------------------------------------------------------------------
// Kod eşleme
// ---------------------------------------------------------------------------

/// Başlıktaki BIST kodları — **haber düzyazısına göre**.
///
/// `research_reports::extract_tickers` rapor başlıkları içindir: metni büyük
/// harfe çevirip evrende arar, çünkü orada "Şirket Raporu | THYAO" gibi
/// biçimler var. Haberde aynısını yapmak yıkıcı: "hedef fiyat" ifadesindeki
/// "hedef" büyük harfe çevrilince HEDEF (Hedef Holding) koduna eşleşiyor ve
/// her çağrı haberi bu şirkete bağlanıyordu. Üstelik kod bulunmuş sayıldığı
/// için Türkiye kapısı atlanıyor, Marvell ve Block gibi ABD hisselerinin
/// haberleri de akışa giriyordu (canlı ölçümde 17 kaydın 9'u).
///
/// Haberde BIST kodu BÜYÜK HARFLE yazılır, Türkçe sözcük ise yazılmaz — ayrım
/// tam da budur. Bu yüzden özgün başlıktaki büyük harfli belirteçlere bakılır,
/// harf çevrimi yapılmaz.
fn tickers_in_news(title: &str, universe: &HashSet<String>) -> Vec<String> {
    // Tümü büyük harfle atılmış başlıkta bu ayrım kaybolur; orada kod aramak
    // her sözcüğü aday yapar, o yüzden yalnız unvan eşlemesine düşülür.
    let letters = title.chars().filter(|c| c.is_alphabetic()).count();
    let uppercase = title.chars().filter(|c| c.is_uppercase()).count();
    let shouty = letters >= 12 && uppercase * 10 >= letters * 6;

    let mut found: Vec<String> = Vec::new();
    if !shouty {
        for chunk in title.split(|c: char| !c.is_alphanumeric()) {
            if chunk.len() < 3 || chunk.len() > 6 {
                continue;
            }
            if !chunk.chars().all(|c| c.is_ascii_uppercase()) {
                continue;
            }
            let code = chunk.to_string();
            if universe.contains(&code) && !found.contains(&code) {
                found.push(code);
            }
        }
    }

    // Kod geçmiyorsa unvandan eşlenir: "Türk Hava Yolları" → THYAO.
    if found.is_empty() {
        if let Some(code) = ticker_from_company_name(title) {
            if universe.contains(code) {
                found.push(code.to_string());
            }
        }
    }

    found
}

// ---------------------------------------------------------------------------
// Kayda çevirme
// ---------------------------------------------------------------------------

/// Çağrının kimliği — **habere değil çağrıya** bağlanır.
///
/// Aynı çağrıyı on yayın geçtiğinde on ayrı kayıt oluşmasın diye adres değil,
/// çağrının kendisi imzalanır. Aynı kurum + aynı kod + aynı gün + aynı hedef
/// pratikte aynı çağrıdır.
fn call_id(broker: &str, tickers: &[String], date: &str, rating: Option<&str>, target: Option<f64>) -> String {
    use sha2::{Digest, Sha256};
    let signature = format!(
        "global|{broker}|{}|{date}|{}|{}",
        tickers.join(","),
        rating.unwrap_or(""),
        target.map(|value| format!("{value:.2}")).unwrap_or_default(),
    );
    let digest = Sha256::digest(signature.as_bytes());
    digest.iter().take(12).map(|byte| format!("{byte:02x}")).collect()
}

/// Haber tarihini ISO + unix saniyeye çevirir.
///
/// İki biçim gelir: Google News RFC 2822 ("Tue, 11 Aug 2026 07:30:00 GMT"),
/// GDELT ise sıkışık damga ("20260811T073000Z").
///
/// RFC 2822 ayrıştırıcısı gün ADINI da doğrular: tarihle uyuşmayan "Mon"
/// yazan bir akış yüzünden haber düşerdi. Gün adı zaten tarihten türetilebilir
/// bir fazlalık olduğu için, baştaki ad reddedilirse atılıp yeniden denenir.
fn parse_news_date(raw: &str) -> Option<(String, i64)> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(parsed) = chrono::DateTime::parse_from_rfc2822(trimmed) {
        return Some((parsed.format("%Y-%m-%d").to_string(), parsed.timestamp()));
    }

    if let Some((_, rest)) = trimmed.split_once(',') {
        if let Ok(parsed) = chrono::DateTime::parse_from_rfc2822(rest.trim()) {
            return Some((parsed.format("%Y-%m-%d").to_string(), parsed.timestamp()));
        }
    }

    // GDELT: 20260811T073000Z
    let bytes = trimmed.as_bytes();
    if bytes.len() >= 15 && bytes[8] == b'T' {
        let iso = format!(
            "{}-{}-{}T{}:{}:{}Z",
            &trimmed[0..4],
            &trimmed[4..6],
            &trimmed[6..8],
            &trimmed[9..11],
            &trimmed[11..13],
            &trimmed[13..15],
        );
        if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(&iso) {
            return Some((parsed.format("%Y-%m-%d").to_string(), parsed.timestamp()));
        }
    }

    None
}

/// Haberi aktaran yayının adı. Akış kaynakları "GDELT / bloomberght.com" ya da
/// "Google News" biçiminde geliyor; ekranda yalnız yayın adı gösterilir.
fn outlet_of(item: &NewsItem) -> String {
    let source = item.source.trim();
    match source.split_once('/') {
        Some((_, tail)) if !tail.trim().is_empty() => tail.trim().to_string(),
        _ => source.to_string(),
    }
}

/// Çağrının türü: koda bağlanabildiyse şirket, değilse bağlama göre sektör
/// ya da strateji.
fn classify_call(folded: &str, tickers: &[String]) -> ReportKind {
    if !tickers.is_empty() {
        return ReportKind::Company;
    }
    if any_prefix(folded, &["sektor", "banka", "bankacilik", "perakende", "havacilik"]) {
        return ReportKind::Sector;
    }
    ReportKind::Strategy
}

/// Haberi küresel kurum çağrısına çevirir; dört kapıdan geçemezse `None`.
///
/// `universe` BIST kod evrenidir: kod ancak evrende varsa kayda girer, yani
/// haberde geçen rastgele bir büyük harf dizisi hisse sanılmaz.
pub fn extract_call(item: &NewsItem, universe: &HashSet<String>) -> Option<AnalystReport> {
    let text = match item.summary.as_deref() {
        Some(summary) if !summary.trim().is_empty() => format!("{} {}", item.title, summary),
        _ => item.title.clone(),
    };
    let folded = fold(&text);

    // 1. Kurum
    let broker = detect_broker(&folded)?;

    // 2. Çağrı izi (akış haberi değil)
    if !looks_like_call(&folded) {
        return None;
    }

    // 3. Türkiye: doğrulanmış kod ya da Türkiye + hisse bağlamı
    let tickers = tickers_in_news(&item.title, universe);
    if tickers.is_empty() {
        let turkey = any_prefix(&folded, TURKEY_MARKERS);
        let equity = any_prefix(&folded, EQUITY_MARKERS);
        if !(turkey && equity) {
            return None;
        }
        // 4. Emtia/FX haberi kod çıkmadığında elenir.
        //
        // Burada KATI eşleşme kullanılır: "altın" ek toleranslı arandığında
        // "endeksin altında" da eşleşiyor ve sağlam bir hisse haberi emtia
        // sanılıp eleniyordu.
        if any_word(&folded, COMMODITY_MARKERS) {
            return None;
        }
    }

    let (published, published_ts) = parse_news_date(&item.pub_date)?;
    let rating = extract_rating(&text);
    let target_price = extract_target_price(&text);
    let kind = classify_call(&folded, &tickers);

    Some(AnalystReport {
        id: call_id(broker.canonical, &tickers, &published, rating.as_deref(), target_price),
        broker: broker.canonical.to_string(),
        scope: BrokerScope::Global,
        kind,
        title: item.title.trim().to_string(),
        summary: item.summary.clone(),
        url: item.link.trim().to_string(),
        pdf_url: None,
        published,
        published_ts,
        tickers,
        analyst: None,
        rating,
        target_price,
        source_id: SOURCE_ID.to_string(),
        via: Some(outlet_of(item)),
    })
}

// ---------------------------------------------------------------------------
// Çekme
// ---------------------------------------------------------------------------

/// Ağa atılan sorgular.
///
/// Kurumlar öbeklenir: her kurumu tek tek sormak 22 istek eder ve Google News
/// hız sınırına girer. Sorgunun kesinliği zaten önemsiz — süzme `extract_call`
/// içinde yapılır; buradaki tek amaç doğru haberlerin ağa düşmesi.
const QUERIES: &[&str] = &[
    r#"("Goldman Sachs" OR "JPMorgan" OR "JP Morgan" OR "Morgan Stanley") (BIST OR "Borsa İstanbul" OR Türk) hisse hedef fiyat when:45d"#,
    r#"(HSBC OR Citi OR UBS OR "Deutsche Bank" OR Barclays) (BIST OR "Borsa İstanbul" OR Türk) hisse hedef fiyat when:45d"#,
    r#"("Bank of America" OR BofA OR "BNP Paribas" OR Jefferies OR "Wood & Company") (BIST OR "Borsa İstanbul" OR Türk) hisse when:45d"#,
    r#"(Raiffeisen OR "Erste Group" OR "Renaissance Capital" OR UniCredit OR Nomura OR "Standard Chartered") (BIST OR "Borsa İstanbul" OR Türk) hisse when:45d"#,
    r#"(JPMorgan OR "Goldman Sachs" OR HSBC OR "Morgan Stanley") "Türk bankaları" tavsiye when:45d"#,
];

/// Küresel kurum çağrılarını çeker.
///
/// Sorgulardan biri düşerse tur ölmez: hatalar toplanır, geri kalan sorguların
/// kayıtları yine döner. Bütün sorgular düşerse hata döndürülür ki çağıran
/// "kaynak sessizce boş" ile "kaynak erişilemedi"yi ayırabilsin.
pub async fn fetch(
    client: &reqwest::Client,
    universe: &HashSet<String>,
) -> Result<Vec<AnalystReport>, String> {
    let mut calls: Vec<AnalystReport> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut errors: Vec<String> = Vec::new();
    let mut ok = 0usize;

    for query in QUERIES {
        match crate::services::fetch_google_news(client, query, None, false, "tr").await {
            Ok(items) => {
                ok += 1;
                for item in items.into_iter().take(MAX_PER_QUERY) {
                    let Some(call) = extract_call(&item, universe) else { continue };
                    // Aynı çağrıyı birden çok yayın geçtiğinde ilki kalır.
                    if seen.insert(call.id.clone()) {
                        calls.push(call);
                    }
                }
            }
            Err(error) => errors.push(error),
        }
    }

    if ok == 0 {
        return Err(errors.join("; "));
    }
    Ok(calls)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn universe() -> HashSet<String> {
        // HEDEF gerçek bir BIST kodudur (Hedef Holding) ve "hedef fiyat"
        // ifadesiyle çakışır — testlerin tam da bunu yakalaması gerekir.
        ["THYAO", "PGSUS", "TAVHL", "TUPRS", "BIMAS", "AKBNK", "ASELS", "HEDEF"]
            .iter()
            .map(|code| code.to_string())
            .collect()
    }

    fn news(title: &str) -> NewsItem {
        NewsItem {
            title: title.to_string(),
            link: "https://example.com/haber".into(),
            pub_date: "Mon, 11 Aug 2026 07:30:00 GMT".into(),
            source: "Google News / Bloomberg HT".into(),
            summary: None,
            ticker: None,
            is_kap: false,
            tags: Vec::new(),
            sector_tags: Vec::new(),
        }
    }

    /// Kısa rumuzlar kelime sınırıyla aranmazsa "clubs" içinde "ubs" bulunur.
    #[test]
    fn short_aliases_need_word_boundaries() {
        assert!(contains_word("ubs turk bankalari", "ubs"));
        assert!(!contains_word("clubs raporu", "ubs"));
        assert!(!contains_word("cituation", "citi"));
        assert!(contains_word("citi turk bankalari", "citi"));
    }

    /// Türkçe ekler sona gelir: sözlük kalıpları ek toleranslı aranmazsa
    /// "hedef fiyatları" ve "bankaları" hiç eşleşmez ve akışın büyük bölümü
    /// sessizce düşer. Kurum rumuzları ise katı kalmalıdır.
    #[test]
    fn dictionary_matches_tolerate_turkish_suffixes() {
        assert!(starts_word("hedef fiyatlarini yukseltti", "hedef fiyat"));
        assert!(starts_word("turk bankalari icin", "banka"));
        assert!(starts_word("hisseleri icin", "hisse"));
        // Kelime ortasında başlamaz.
        assert!(!starts_word("muhisse", "hisse"));
        // Katı eşleşme ekleri kabul etmez — emtia süzgeci bunu kullanır.
        assert!(!contains_word("endeksin altinda kaldi", "altin"));
        assert!(contains_word("altin icin tahmin", "altin"));
    }

    /// "ing" tek başına alınsaydı Türkçedeki her "-ing" hecesi kurum sanılırdı.
    #[test]
    fn ing_is_not_matched_as_a_bare_syllable() {
        assert!(detect_broker(&fold("Holding raporu hedef fiyat")).is_none());
        assert!(detect_broker(&fold("ING Bank hedef fiyatını yükseltti")).is_some());
    }

    /// Gerçek başlıklar (Google News TR, 2026-08 ölçümü) kayda dönmeli.
    #[test]
    fn real_headlines_that_are_calls_become_records() {
        let cases = [
            "Goldman Sachs, Türk bankacılık hisseleri için hedef fiyatlarını düşürdü",
            "HSBC'den Borsa İstanbul hisseleri için yeni hedef fiyatlar",
            "JP Morgan, BIST'te 9 hisse için hedef fiyatını revize etti",
            "Goldman Sachs, Türk bankaları için hedef fiyatları yükseltti",
        ];
        for title in cases {
            let call = extract_call(&news(title), &universe())
                .unwrap_or_else(|| panic!("çağrı olarak tanınmadı: {title}"));
            assert_eq!(call.scope, BrokerScope::Global);
            assert_eq!(call.source_id, SOURCE_ID);
            assert!(call.via.is_some(), "haber kaynağı işaretlenmemiş: {title}");
        }
    }

    /// Türkiye dışı çağrılar, emtia tahminleri ve akış haberleri elenmeli.
    /// Hepsi gerçek başlıklardır — süzgeç bunların üstünde ölçüldü.
    #[test]
    fn foreign_commodity_and_flow_headlines_are_rejected() {
        let cases = [
            // Türkiye dışı hisse
            "Goldman Sachs, Riskified'ın hisse hedefini yükseltti",
            "Citi, Intel ve AMD için hedef fiyatları yükseltti",
            "Goldman Sachs'tan Güney Kore borsası için dikkat çeken tahmin",
            // Emtia / FX
            "Goldman Sachs'tan petrol için 120 dolar senaryosu",
            "JPMorgan'dan bakır fiyatları için kritik tahmin: Hedef 15 bin dolar",
            // Akış / kurumsal haber
            "Bank of America'nın (BofA) en çok alım satım yaptığı hisseler",
            "UBS 3 milyar dolarlık hisse geri alım programı başlattı",
        ];
        for title in cases {
            assert!(
                extract_call(&news(title), &universe()).is_none(),
                "elenmesi gerekirken kayda girdi: {title}"
            );
        }
    }

    /// "hedef fiyat" ifadesindeki "hedef", HEDEF (Hedef Holding) koduna
    /// bağlanmamalı. Canlı ölçümde her kayıt bu şirkete etiketlenmişti.
    #[test]
    fn a_lowercase_turkish_word_is_not_a_ticker() {
        assert!(tickers_in_news("Goldman Sachs hedef fiyatını yükseltti", &universe()).is_empty());
        // Aynı harfler büyük yazıldığında gerçekten koddur.
        assert_eq!(
            tickers_in_news("HSBC, HEDEF için tavsiyesini korudu", &universe()),
            vec!["HEDEF".to_string()]
        );
    }

    /// Yanlış kod eşlemesi Türkiye kapısını da atlatıyordu: kod bulundu
    /// sanıldığı için ABD hisselerinin haberleri akışa giriyordu.
    #[test]
    fn foreign_stock_calls_do_not_slip_through_a_false_ticker() {
        let cases = [
            "Goldman Sachs, Marvell için hedef fiyatı yükseltti",
            "UBS, Block hissesi için hedef fiyatı 98 dolara yükseltti",
            "Morgan Stanley, Lincoln Electric hissesi için hedef fiyatı yükseltti",
            "Euro/dolar için sürpriz tahmin! Goldman Sachs hedef fiyatını güncelledi",
        ];
        for title in cases {
            assert!(
                extract_call(&news(title), &universe()).is_none(),
                "yurt dışı çağrı akışa sızdı: {title}"
            );
        }
    }

    /// Başlık tümü büyük harfle atıldığında kod ayrımı kaybolur; orada
    /// belirteç taraması yapılmaz, yoksa her sözcük aday olur.
    #[test]
    fn a_shouty_headline_does_not_turn_every_word_into_a_ticker() {
        let found = tickers_in_news("HSBC HEDEF FİYATLARINI YÜKSELTTİ BORSA", &universe());
        assert!(found.is_empty(), "büyük harfli başlıkta kod uyduruldu: {found:?}");
    }

    /// Kod çıkan haberde emtia sözcüğü kaydı düşürmemeli: "Tüpraş" petrol
    /// rafinericisidir, haberinde petrol geçmesi doğaldır.
    #[test]
    fn commodity_guard_only_applies_when_no_ticker_matched() {
        let item = news("HSBC, TUPRS için hedef fiyatını yükseltti: petrol marjları güçlü");
        let call = extract_call(&item, &universe()).expect("kod çıkan haber elenmemeli");
        assert_eq!(call.tickers, vec!["TUPRS".to_string()]);
        assert_eq!(call.kind, ReportKind::Company);
    }

    /// Aynı çağrıyı farklı yayınlar geçtiğinde tek kayda inmeli.
    #[test]
    fn the_same_call_from_different_outlets_collapses_to_one_id() {
        let mut first = news("Goldman Sachs, Türk bankaları için hedef fiyatları yükseltti");
        first.link = "https://a.example/1".into();
        first.source = "Google News / Bloomberg HT".into();

        let mut second = news("Goldman Sachs, Türk bankaları için hedef fiyatları yükseltti");
        second.link = "https://b.example/2".into();
        second.source = "Google News / Ekonomim".into();

        let a = extract_call(&first, &universe()).expect("ilk kayıt");
        let b = extract_call(&second, &universe()).expect("ikinci kayıt");
        assert_eq!(a.id, b.id, "aynı çağrı iki ayrı kayıt oldu");
        // Yayın adı yine de kaydın kendisinde taşınır.
        assert_eq!(a.via.as_deref(), Some("Bloomberg HT"));
        assert_eq!(b.via.as_deref(), Some("Ekonomim"));
    }

    /// Farklı hedef fiyat farklı çağrıdır; kimlik ayrışmalı.
    #[test]
    fn a_different_target_price_is_a_different_call() {
        let a = call_id("HSBC", &["TUPRS".into()], "2026-08-11", Some("AL"), Some(180.0));
        let b = call_id("HSBC", &["TUPRS".into()], "2026-08-11", Some("AL"), Some(210.0));
        assert_ne!(a, b);
    }

    #[test]
    fn parses_both_news_date_formats() {
        let (iso, ts) = parse_news_date("Tue, 11 Aug 2026 07:30:00 GMT").expect("RFC 2822");
        assert_eq!(iso, "2026-08-11");
        assert!(ts > 0);

        let (iso, _) = parse_news_date("20260811T073000Z").expect("GDELT damgası");
        assert_eq!(iso, "2026-08-11");

        assert!(parse_news_date("").is_none());
    }

    /// 11 Ağustos 2026 salıdır. Akış "Mon" yazarsa tarih yine de okunmalı —
    /// gün adı fazlalıktır, onun yüzünden haber düşmemeli.
    #[test]
    fn a_wrong_weekday_does_not_drop_the_item() {
        let (iso, _) = parse_news_date("Mon, 11 Aug 2026 07:30:00 GMT")
            .expect("yanlış gün adı haberi düşürmemeli");
        assert_eq!(iso, "2026-08-11");
    }

    /// Yayın adı "Google News / X" biçiminden ayıklanmalı.
    #[test]
    fn outlet_is_taken_from_the_feed_label() {
        let mut item = news("x");
        item.source = "GDELT / bloomberght.com".into();
        assert_eq!(outlet_of(&item), "bloomberght.com");
        item.source = "Bloomberg HT".into();
        assert_eq!(outlet_of(&item), "Bloomberg HT");
    }

    /// Canlı akış gerçekten çağrı üretiyor mu? Ağ gerektirir, varsayılan
    /// koşuda atlanır; sözlükler ya da sorgular değiştiğinde elle çalıştırılır:
    ///   cargo test -p fraude-core global_calls -- --ignored --nocapture
    #[tokio::test]
    #[ignore = "ağ gerektirir"]
    async fn live_feed_yields_calls() {
        let client = reqwest::Client::new();
        let universe: HashSet<String> = crate::bist_universe::load(&client)
            .await
            .into_iter()
            .map(|(code, _)| code)
            .collect();
        assert!(!universe.is_empty(), "BIST evreni boş geldi");

        let calls = fetch(&client, &universe).await.expect("çekim düştü");
        println!("\n{} çağrı:", calls.len());
        for call in &calls {
            println!(
                "  · {} [{}] {:?} {:?} {} — {}",
                call.broker,
                call.published,
                call.tickers,
                call.rating,
                call.via.as_deref().unwrap_or("-"),
                call.title.chars().take(90).collect::<String>(),
            );
        }
        assert!(!calls.is_empty(), "canlı akıştan hiç çağrı çıkmadı");
    }

    /// Kurum tanınsa bile analiz izi yoksa kayıt üretilmez.
    #[test]
    fn a_mention_without_a_call_marker_is_not_a_record() {
        let item = news("Goldman Sachs İstanbul ofisine yeni genel müdür atadı");
        assert!(extract_call(&item, &universe()).is_none());
    }
}
