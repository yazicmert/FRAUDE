use std::collections::HashSet;
use crate::domain::{NewsItem, NewsTag, EquityRow};

pub const COMPANY_NAMES: &[(&str, &str)] = &[
    ("Türk Hava Yolları", "THYAO"), ("THY", "THYAO"),
    ("Aselsan", "ASELS"), ("Garanti", "GARAN"), ("Garanti BBVA", "GARAN"),
    ("Akbank", "AKBNK"), ("Yapı Kredi", "YKBNK"), ("İş Bankası", "ISCTR"),
    ("Koç Holding", "KCHOL"), ("Koç", "KCHOL"), ("Sabancı", "SAHOL"),
    ("Ereğli", "EREGL"), ("Erdemir", "EREGL"), ("Tüpraş", "TUPRS"),
    ("Arçelik", "ARCLK"), ("BİM", "BIMAS"), ("Migros", "MGROS"),
    ("Ford Otosan", "FROTO"), ("Tofaş", "TOASO"), ("Pegasus", "PGSUS"),
    ("Şişecam", "SISE"), ("Turkcell", "TCELL"), ("Enka", "ENKAI"),
    ("Petkim", "PETKM"), ("Doğan Holding", "DOHOL"), ("Halkbank", "HALKB"),
    ("Vakıfbank", "VAKBN"), ("Vestel", "VESTL"), ("TAV", "TAVHL"),
    ("Kardemir", "KRDMD"), ("Coca-Cola İçecek", "CCOLA"), ("Tekfen", "TKFEN"),
    ("Emlak Konut", "EKGYO"), ("Sasa", "SASA"), ("Astor", "ASTOR"),
    ("Enjsa", "ENJSA"), ("Bim", "BIMAS"), ("Çimsa", "CIMSA"),
    ("Brisa", "BRISA"), ("Koza Madencilik", "KOZAL"), ("Otokar", "OTKAR"),
    ("Türk Telekom", "TTKOM"), ("Aygaz", "AYGAZ"), ("Doğuş Otomotiv", "DOAS"),
];

pub const SECTOR_KEYWORDS: &[(&str, &[&str])] = &[
    ("faiz", &["GARAN", "AKBNK", "YKBNK", "ISCTR", "HALKB", "VAKBN"]),
    ("petrol", &["TUPRS", "PETKM"]),
    ("otomotiv", &["FROTO", "TOASO", "DOAS"]),
    ("enerji", &["AKSEN", "ENKAI", "AYEN"]),
    ("inşaat", &["ENKAI", "EKGYO"]),
    ("havacılık", &["THYAO", "PGSUS", "TAVHL"]),
    ("savunma", &["ASELS", "TUSAS"]),
    ("perakende", &["BIMAS", "MGROS"]),
    ("enflasyon", &["GARAN", "AKBNK", "YKBNK", "ISCTR"]),
    ("dolar", &["THYAO", "FROTO"]),
    ("ihracat", &["FROTO", "ARCLK", "VESTL"]),
    ("banka", &["GARAN", "AKBNK", "YKBNK", "ISCTR", "HALKB", "VAKBN"]),
    ("çelik", &["EREGL", "KRDMD"]),
    ("turizm", &["THYAO", "PGSUS", "TAVHL"]),
    ("temettü", &[]),
    ("halka arz", &[]),
];

const FALSE_POSITIVE_TICKERS: &[&str] = &[
    "ABD", "NATO", "USD", "EUR", "TRY", "IMF", "TCMB", "SPK", "KAP",
    "BDDK", "TUIK", "AKP", "CHP", "MHP", "HDP", "BIS", "FED", "ECB",
    "TRT", "CDS", "PMI", "GSE", "ISE", "TSE", "KGF", "OVP", "YEP",
];

pub fn tag_news(item: &mut NewsItem, equities: &[EquityRow]) {
    let mut seen = HashSet::new();
    let mut tags: Vec<NewsTag> = Vec::new();

    let text = format!(
        "{} {}",
        &item.title,
        item.summary.as_deref().unwrap_or("")
    );
    let text_lower = text.to_lowercase();
    let ticker_set: HashSet<&str> = equities.iter().map(|e| e.ticker.as_str()).collect();

    // Step 1: Direct ticker extraction (uppercase 3-5 letter words)
    for word in text.split(|c: char| !c.is_ascii_alphanumeric()) {
        let w = word.trim();
        if w.len() >= 3 && w.len() <= 5 && w.chars().all(|c| c.is_ascii_uppercase()) {
            if FALSE_POSITIVE_TICKERS.contains(&w) { continue; }
            if ticker_set.contains(w) && !seen.contains(w) {
                seen.insert(w.to_string());
                tags.push(NewsTag {
                    ticker: w.to_string(),
                    confidence: 0.95,
                    sentiment: "NEUTRAL".to_string(),
                    reason: "Doğrudan ticker eşleşmesi".to_string(),
                });
            }
        }
    }

    // Step 2: Company name matching
    for (name, ticker) in COMPANY_NAMES {
        if seen.contains(*ticker) { continue; }
        let name_lower = name.to_lowercase();
        if text_lower.contains(&name_lower) {
            seen.insert(ticker.to_string());
            tags.push(NewsTag {
                ticker: ticker.to_string(),
                confidence: 0.85,
                sentiment: "NEUTRAL".to_string(),
                reason: format!("Şirket adı eşleşmesi: {}", name),
            });
        }
    }

    // Step 3: Sector keyword matching
    let mut sector_tags_set: HashSet<String> = HashSet::new();
    for (keyword, tickers) in SECTOR_KEYWORDS {
        if text_lower.contains(keyword) {
            sector_tags_set.insert(keyword.to_string());
            for t in *tickers {
                if seen.contains(*t) { continue; }
                if tags.len() >= 8 { break; }
                seen.insert(t.to_string());
                tags.push(NewsTag {
                    ticker: t.to_string(),
                    confidence: 0.5,
                    sentiment: "NEUTRAL".to_string(),
                    reason: format!("Sektörel etki: {}", keyword),
                });
            }
        }
    }

    tags.truncate(8);
    item.tags = tags;
    item.sector_tags = sector_tags_set.into_iter().collect();
}
