use std::collections::HashSet;
use crate::domain::{NewsItem, NewsTag, EquityRow};

pub const COMPANY_NAMES: &[(&str, &str)] = &[
    // BIST Equities
    ("Türk Hava Yolları", "THYAO"), ("Turkish Airlines", "THYAO"), ("THY", "THYAO"),
    ("Aselsan", "ASELS"), ("Garanti BBVA", "GARAN"), ("Garanti Bankası", "GARAN"), ("Garanti", "GARAN"),
    ("Akbank", "AKBNK"), ("Yapı Kredi", "YKBNK"), ("İş Bankası", "ISCTR"),
    ("Koç Holding", "KCHOL"), ("Koç", "KCHOL"), ("Sabancı Holding", "SAHOL"), ("Sabancı", "SAHOL"),
    ("Ereğli Demir Çelik", "EREGL"), ("Ereğli", "EREGL"), ("Erdemir", "EREGL"), ("Tüpraş", "TUPRS"),
    ("Arçelik", "ARCLK"), ("BİM Birleşik Mağazalar", "BIMAS"), ("BİM", "BIMAS"), ("Bim", "BIMAS"),
    ("Migros", "MGROS"), ("Ford Otosan", "FROTO"), ("Tofaş", "TOASO"), ("Pegasus", "PGSUS"),
    ("Şişecam", "SISE"), ("Turkcell", "TCELL"), ("Enka İnşaat", "ENKAI"), ("Enka", "ENKAI"),
    ("Petkim", "PETKM"), ("Doğan Holding", "DOHOL"), ("Halkbank", "HALKB"),
    ("Vakıfbank", "VAKBN"), ("Vestel", "VESTL"), ("TAV Havalimanları", "TAVHL"), ("TAV", "TAVHL"),
    ("Kardemir", "KRDMD"), ("Coca-Cola İçecek", "CCOLA"), ("Tekfen Holding", "TKFEN"), ("Tekfen", "TKFEN"),
    ("Emlak Konut", "EKGYO"), ("Sasa Polyester", "SASA"), ("Sasa", "SASA"), ("Astor Enerji", "ASTOR"),
    ("Astor", "ASTOR"), ("Enerjisa", "ENJSA"), ("Çimsa", "CIMSA"),
    ("Brisa", "BRISA"), ("Koza Altın", "KOZAL"), ("Koza Madencilik", "KOZAA"), ("Otokar", "OTKAR"),
    ("Türk Telekom", "TTKOM"), ("Aygaz", "AYGAZ"), ("Doğuş Otomotiv", "DOAS"),
    // Global Equities
    ("Apple", "AAPL"), ("Microsoft", "MSFT"), ("Nvidia", "NVDA"), ("NVIDIA", "NVDA"),
    ("Amazon", "AMZN"), ("Meta Platforms", "META"), ("Alphabet", "GOOGL"), ("Google", "GOOGL"),
    ("Tesla", "TSLA"), ("Berkshire Hathaway", "BRK-B"), ("Broadcom", "AVGO"),
    ("JPMorgan", "JPM"), ("Walmart", "WMT"), ("Netflix", "NFLX"),
    ("Advanced Micro Devices", "AMD"), ("AMD", "AMD"), ("Qualcomm", "QCOM"), ("Intel", "INTC"),
    // Crypto Assets
    ("Bitcoin", "BTC-USD"), ("Ethereum", "ETH-USD"), ("Solana", "SOL-USD"),
    ("Ripple", "XRP-USD"), ("Avalanche", "AVAX-USD"), ("Cardano", "ADA-USD"),
    ("Chainlink", "LINK-USD"), ("Polkadot", "DOT-USD"),
];

/// Sektörel veya makro konu anahtar kelimeleri.
///
/// DİKKAT: Bu anahtar kelimeler YALNIZCA sektörel etiket (`item.sector_tags`) üretir.
/// Asla şirketin adı geçmeyen bir habere yapay olarak THYAO, FROTO, GARAN vb.
/// hisse etiketi (`item.tags`) eklemez.
pub const SECTOR_KEYWORDS: &[(&str, &str)] = &[
    ("faiz", "faiz"),
    ("enflasyon", "enflasyon"),
    ("inflation", "enflasyon"),
    ("dolar", "döviz"),
    ("dollar", "döviz"),
    ("euro", "döviz"),
    ("döviz", "döviz"),
    ("forex", "döviz"),
    ("ihracat", "ihracat"),
    ("export", "ihracat"),
    ("ithalat", "dış ticaret"),
    ("otomotiv", "otomotiv"),
    ("automotive", "otomotiv"),
    ("havacılık", "havacılık"),
    ("aviation", "havacılık"),
    ("turizm", "turizm"),
    ("tourism", "turizm"),
    ("banka", "bankacılık"),
    ("bankacılık", "bankacılık"),
    ("banking", "bankacılık"),
    ("petrol", "enerji"),
    ("oil", "enerji"),
    ("enerji", "enerji"),
    ("energy", "enerji"),
    ("inşaat", "inşaat"),
    ("construction", "inşaat"),
    ("savunma", "savunma"),
    ("defense", "savunma"),
    ("perakende", "perakende"),
    ("retail", "perakende"),
    ("çelik", "demir-çelik"),
    ("steel", "demir-çelik"),
    ("kripto", "kripto"),
    ("crypto", "kripto"),
    ("bitcoin", "kripto"),
    ("ethereum", "kripto"),
    ("altın", "emtia"),
    ("gold", "emtia"),
    ("gümüş", "emtia"),
    ("silver", "emtia"),
    ("yapay zeka", "teknoloji"),
    ("yapay zekâ", "teknoloji"),
    ("artificial intelligence", "teknoloji"),
    ("temettü", "temettü"),
    ("dividend", "temettü"),
    ("halka arz", "halka arz"),
    ("ipo", "halka arz"),
    ("merkez bankası", "merkez bankası"),
    ("central bank", "merkez bankası"),
    ("fed", "merkez bankası"),
    ("tcmb", "merkez bankası"),
    ("ecb", "merkez bankası"),
];

const FALSE_POSITIVE_TICKERS: &[&str] = &[
    "ABD", "NATO", "USD", "EUR", "TRY", "GBP", "JPY", "CHF", "CAD", "AUD",
    "IMF", "TCMB", "SPK", "KAP", "BDDK", "TUIK", "AKP", "CHP", "MHP", "HDP",
    "BIS", "FED", "ECB", "SEC", "CFTC", "TRT", "CDS", "PMI", "CPI", "PPI",
    "GSE", "ISE", "TSE", "KGF", "OVP", "YEP", "GDP", "GNP", "ETF", "IPO",
    "CEO", "CFO", "CTO", "COO", "BIST", "NYSE", "AI", "API", "APP", "ALL",
    "AND", "FOR", "THE", "NEW", "NOW", "TOP", "BIG", "NET", "SET", "RUN",
    "WIN", "GET", "ONE", "TWO", "PER", "MID", "LOW", "MAX", "MIN", "KEY",
    "BUY", "HOLD", "SELL", "GAIN", "REAL", "CARE", "BEST", "FREE", "PAR",
    "OPEN", "RATE", "DATA", "INFO", "TECH", "BANK", "CORE", "LINK", "MOVE",
    "PEAK", "POST", "RISK", "SALE", "SITE", "STAR", "STEP", "STOP", "UNIT",
    "VIEW", "WAVE", "YEAR", "ZERO", "BOND", "CASH", "CALL", "PUTS", "SWAP",
    "SAFE", "DEAL", "NEWS", "BILL", "COST", "GROW", "FAST", "DROP", "FALL",
    "HIGH", "JUMP", "LOSS", "MEET", "OVER", "PLAN", "RISE", "SOAR", "TEST",
    "TIME", "USER", "WEEK", "WILL", "WITH", "TRUE", "NONE", "PLUS", "AUTO",
    "MASS", "MOAT", "POOL", "PULL", "PUSH", "SENT", "SPOT", "STAY", "TAKE",
    "TELL", "WARN", "WELL", "WENT", "WEST", "WIRE", "YELD",
];

/// Metinde bir kelime ya da ifadenin TAM BİR KELİME ÖBEĞİ olarak (sözcük sınırlarıyla)
/// geçip geçmediğini denetler. Alt dizge (substring) çakışmalarını ("anything" -> "thy",
/// "iskoçya" -> "koç", "pastor" -> "astor" vb.) kesin olarak engeller.
fn contains_whole_word(text_lower: &str, phrase_lower: &str) -> bool {
    let mut search_from = 0;
    while let Some(index) = text_lower[search_from..].find(phrase_lower) {
        let start = search_from + index;
        let end = start + phrase_lower.len();

        let left_ok = start == 0 || !text_lower[..start].chars().next_back().map_or(false, |c| c.is_alphanumeric());
        let right_ok = end == text_lower.len() || !text_lower[end..].chars().next().map_or(false, |c| c.is_alphanumeric());

        if left_ok && right_ok {
            return true;
        }

        search_from = start + phrase_lower.chars().next().map_or(1, |c| c.len_utf8());
    }
    false
}

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

    // 1. Adım: Doğrudan Ticker Tespiti (Büyük harfli 3-6 karakterlik bağımsız semboller)
    for word in text.split(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '=') {
        let w = word.trim();
        if w.len() >= 3 && w.len() <= 6 && w.chars().all(|c| c.is_ascii_uppercase() || c == '-' || c == '=') {
            if FALSE_POSITIVE_TICKERS.contains(&w) { continue; }
            if (ticker_set.contains(w) || w == "AAPL" || w == "MSFT" || w == "NVDA" || w == "TSLA" || w == "AMZN" || w == "GOOGL" || w == "META" || w == "BTC-USD" || w == "ETH-USD" || w == "SOL-USD") && !seen.contains(w) {
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

    // 2. Adım: Şirket ve Varlık Adı Eşleştirmesi (Kelime sınırları ile tam eşleşme)
    for (name, ticker) in COMPANY_NAMES {
        if seen.contains(*ticker) { continue; }
        let name_lower = name.to_lowercase();
        if contains_whole_word(&text_lower, &name_lower) {
            seen.insert(ticker.to_string());
            tags.push(NewsTag {
                ticker: ticker.to_string(),
                confidence: 0.85,
                sentiment: "NEUTRAL".to_string(),
                reason: format!("Şirket/Varlık adı eşleşmesi: {}", name),
            });
        }
    }

    // 3. Adım: Sektörel ve Makro Konu Eşleştirmesi
    // NOT: Sektör anahtar kelimeleri YALNIZCA `sector_tags` üretir, rastgele şirket etiketi üretmez!
    let mut sector_tags_set: HashSet<String> = HashSet::new();
    for (keyword, sector_label) in SECTOR_KEYWORDS {
        if contains_whole_word(&text_lower, keyword) {
            sector_tags_set.insert(sector_label.to_string());
        }
    }

    tags.truncate(6);
    item.tags = tags;
    let mut sorted_sectors: Vec<String> = sector_tags_set.into_iter().collect();
    sorted_sectors.sort();
    sorted_sectors.truncate(6);
    item.sector_tags = sorted_sectors;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_equities() -> Vec<EquityRow> {
        vec![
            dummy_equity("THYAO", "TÜRK HAVA YOLLARI A.O."),
            dummy_equity("FROTO", "FORD OTOMOTİV SANAYİ A.Ş."),
            dummy_equity("GARAN", "TÜRKİYE GARANTİ BANKASI A.Ş."),
            dummy_equity("ASELS", "ASELSAN ELEKTRONİK SANAYİ VE TİCARET A.Ş."),
            dummy_equity("ISCTR", "TÜRKİYE İŞ BANKASI A.Ş."),
            dummy_equity("KCHOL", "KOÇ HOLDİNG A.Ş."),
            dummy_equity("BIMAS", "BİM BİRLEŞİK MAĞAZALAR A.Ş."),
            dummy_equity("SASA", "SASA POLYESTER SANAYİ A.Ş."),
        ]
    }

    fn dummy_equity(ticker: &str, name: &str) -> EquityRow {
        EquityRow {
            ticker: ticker.into(),
            name: name.into(),
            ..Default::default()
        }
    }

    fn dummy_news(title: &str, summary: Option<&str>) -> NewsItem {
        NewsItem {
            title: title.into(),
            link: "https://example.com/news".into(),
            pub_date: "2026-08-17T12:00:00Z".into(),
            source: "Financial News".into(),
            summary: summary.map(String::from),
            ticker: None,
            is_kap: false,
            tags: Vec::new(),
            sector_tags: Vec::new(),
        }
    }

    #[test]
    fn english_words_containing_thy_substring_do_not_tag_thyao() {
        let equities = dummy_equities();

        let mut news1 = dummy_news("Python library for quantitative analysis released", None);
        tag_news(&mut news1, &equities);
        assert!(!news1.tags.iter().any(|t| t.ticker == "THYAO"), "Python THYAO etiketi üretmemeli");

        let mut news2 = dummy_news("Healthy growth observed in retail sales figures", None);
        tag_news(&mut news2, &equities);
        assert!(!news2.tags.iter().any(|t| t.ticker == "THYAO"), "Healthy THYAO etiketi üretmemeli");

        let mut news3 = dummy_news("Anything can happen in crypto markets today", None);
        tag_news(&mut news3, &equities);
        assert!(!news3.tags.iter().any(|t| t.ticker == "THYAO"), "Anything THYAO etiketi üretmemeli");

        let mut news4 = dummy_news("Debunking the myth about interest rate cycles", None);
        tag_news(&mut news4, &equities);
        assert!(!news4.tags.iter().any(|t| t.ticker == "THYAO"), "Myth THYAO etiketi üretmemeli");
    }

    #[test]
    fn macro_and_sector_words_do_not_inject_unrelated_company_tickers() {
        let equities = dummy_equities();

        let mut news = dummy_news("Dolar kuru ve faiz kararı sonrası ihracat rakamları açıklandı", None);
        tag_news(&mut news, &equities);

        // Şirket adı geçmediği için item.tags boş olmalı
        assert!(news.tags.is_empty(), "Dolar/faiz/ihracat kelimeleri rastgele hisse etiketi üretmemeli: {:?}", news.tags);

        // Ancak sector_tags doğru dolmalı
        assert!(news.sector_tags.contains(&"döviz".to_string()));
        assert!(news.sector_tags.contains(&"faiz".to_string()));
        assert!(news.sector_tags.contains(&"ihracat".to_string()));
    }

    #[test]
    fn legitimate_company_and_crypto_mentions_are_tagged() {
        let equities = dummy_equities();

        let mut news1 = dummy_news("Ford Otosan yeni elektrikli araç fabrikasını duyurdu", None);
        tag_news(&mut news1, &equities);
        assert!(news1.tags.iter().any(|t| t.ticker == "FROTO"));

        let mut news2 = dummy_news("THY yolcu sayısında rekor artış kaydetti", None);
        tag_news(&mut news2, &equities);
        assert!(news2.tags.iter().any(|t| t.ticker == "THYAO"));

        let mut news3 = dummy_news("Apple unveils new M4 chip with advanced AI capabilities", None);
        tag_news(&mut news3, &equities);
        assert!(news3.tags.iter().any(|t| t.ticker == "AAPL"));

        let mut news4 = dummy_news("Bitcoin surges past 100k as institutional demand accelerates", None);
        tag_news(&mut news4, &equities);
        assert!(news4.tags.iter().any(|t| t.ticker == "BTC-USD"));
        assert!(news4.sector_tags.contains(&"kripto".to_string()));
    }

    #[test]
    fn substring_turkish_words_do_not_false_match() {
        let equities = dummy_equities();

        let mut news1 = dummy_news("İskoçya parlamentosu yeni bütçeyi onayladı", None);
        tag_news(&mut news1, &equities);
        assert!(!news1.tags.iter().any(|t| t.ticker == "KCHOL"), "İskoçya KCHOL etiketi üretmemeli");

        let mut news2 = dummy_news("Kombine bilet satışları başladı", None);
        tag_news(&mut news2, &equities);
        assert!(!news2.tags.iter().any(|t| t.ticker == "BIMAS"), "Kombine BIMAS etiketi üretmemeli");

        let mut news3 = dummy_news("Kasaba halkı sel felaketine karşı uyarıldı", None);
        tag_news(&mut news3, &equities);
        assert!(!news3.tags.iter().any(|t| t.ticker == "SASA"), "Kasaba SASA etiketi üretmemeli");
    }
}
