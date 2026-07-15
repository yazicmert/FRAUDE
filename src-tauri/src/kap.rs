use crate::domain::KapAnnouncement;
use reqwest::Client;
use std::error::Error;
use std::time::Duration;

const BLOOMBERG_HT_RSS: &str = "https://www.bloomberght.com/rss";
const DUNYA_RSS: &str = "https://www.dunya.com/rss";

/// Strip HTML tags from text
fn strip_html(input: &str) -> String {
    let re = regex::Regex::new(r"<[^>]*>").unwrap();
    re.replace_all(input, "").to_string()
}

/// Clean CDATA wrappers and HTML entities
fn clean_text(input: &str) -> String {
    input
        .replace("<![CDATA[", "")
        .replace("]]>", "")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#039;", "'")
        .replace("&apos;", "'")
        .trim()
        .to_string()
}

/// Try to extract a BIST ticker symbol from the title
/// Looks for well-known patterns like "THYAO", "ASELS", etc.
fn extract_ticker(title: &str) -> Option<String> {
    // Pattern: all-caps word of 3-5 letters that looks like a ticker
    let re = regex::Regex::new(r"\b([A-Z]{3,5})\b").unwrap();
    for cap in re.captures_iter(title) {
        let candidate = &cap[1];
        // Filter out common non-ticker words
        let skip = [
            "BES", "OKS", "ABD", "NATO", "PDF", "RSS", "CEO", "CFO",
            "TRT", "ING", "QNB", "TGA", "IMF", "ECB", "FED", "TCMB",
            "BDDK", "SPK", "KAP", "BIST", "IPO", "USD", "EUR", "TRY",
            "GBP", "JPY", "GSYH", "TEFE", "TUFE", "OPEC",
        ];
        if !skip.contains(&candidate) && candidate.len() >= 4 {
            return Some(candidate.to_string());
        }
    }
    None
}

/// Parse an RSS date string into a human-readable Turkish format
pub(crate) fn format_rss_date(raw: &str) -> String {
    // RSS dates come in formats like:
    // "Thu, 09 Jul 2026 08:48:51 +0000"  (BloombergHT)
    // "Sun, 12 Jul 2026 15:12:00 +0300"  (Dünya)
    let cleaned = clean_text(raw);
    
    // Try parsing RFC 2822 format
    if let Ok(dt) = chrono::DateTime::parse_from_rfc2822(&cleaned) {
        let istanbul = chrono::FixedOffset::east_opt(3 * 3600).unwrap();
        let local = dt.with_timezone(&istanbul);
        return local.format("%d.%m.%Y %H:%M").to_string();
    }
    
    // Try alternate format: "09.07.2026 12:51:48"
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(&cleaned, "%d.%m.%Y %H:%M:%S") {
        return dt.format("%d.%m.%Y %H:%M").to_string();
    }
    
    // Return cleaned raw if parsing fails
    cleaned
}

/// Fetch and parse a single RSS feed into KapAnnouncement items
async fn fetch_rss_feed(
    client: &Client,
    url: &str,
    source_name: &str,
    category: &str,
) -> Vec<KapAnnouncement> {
    let response = match client
        .get(url)
        .timeout(Duration::from_secs(10))
        .header("User-Agent", crate::yahoo::YAHOO_USER_AGENT)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("RSS fetch error for {}: {}", source_name, e);
            return Vec::new();
        }
    };

    let bytes = match response.bytes().await {
        Ok(b) => b,
        Err(e) => {
            eprintln!("RSS read error for {}: {}", source_name, e);
            return Vec::new();
        }
    };

    let channel = match rss::Channel::read_from(&bytes[..]) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("RSS parse error for {}: {}", source_name, e);
            return Vec::new();
        }
    };

    let mut items = Vec::new();

    for item in channel.items() {
        let title = clean_text(item.title().unwrap_or(""));
        let title = strip_html(&title);
        if title.is_empty() || title.len() < 10 {
            continue;
        }

        let link = clean_text(item.link().unwrap_or(""));
        let pub_date = format_rss_date(item.pub_date().unwrap_or(""));
        
        let description = item.description().map(|d| {
            let cleaned = clean_text(d);
            let stripped = strip_html(&cleaned);
            stripped.trim().to_string()
        }).filter(|s| !s.is_empty());

        let ticker = extract_ticker(&title).unwrap_or_else(|| "BIST".to_string());

        // Only include economy/borsa relevant items
        let is_relevant = is_finance_relevant(&title, description.as_deref());

        if !is_relevant {
            continue;
        }

        items.push(KapAnnouncement {
            id: format!("{}-{}", source_name.chars().take(3).collect::<String>().to_uppercase(), items.len() + 1),
            ticker,
            title,
            date: pub_date,
            category: category.to_string(),
            summary: description.unwrap_or_default(),
            url: link,
            ai_importance_score: 50,
        });

        if items.len() >= 15 {
            break;
        }
    }

    items
}

/// Check if a news item is finance/borsa relevant
fn is_finance_relevant(title: &str, description: Option<&str>) -> bool {
    let keywords = [
        "borsa", "bist", "hisse", "endeks", "faiz", "enflasyon", "dolar",
        "euro", "kur", "merkez bankası", "tcmb", "hazine", "tahvil",
        "bono", "halka arz", "sermaye", "temettü", "bedelsiz", "kar",
        "zarar", "bilanço", "gelir tablosu", "ciro", "satış", "üretim",
        "ihracat", "ithalat", "büyüme", "gsyh", "piyasa", "yatırım",
        "fon", "portföy", "altın", "petrol", "emtia", "kripto",
        "bitcoin", "sendikasyon", "kredi", "mevduat", "banka",
        "sigorta", "finansal", "ekonomi", "resesyon", "swap",
        "tahakkuk", "temerrüt", "rating", "not", "spk", "kap",
        "ipo", "kotasyon",
    ];
    
    let lower_title = title.to_lowercase();
    let lower_desc = description.unwrap_or("").to_lowercase();
    let combined = format!("{} {}", lower_title, lower_desc);
    
    keywords.iter().any(|kw| combined.contains(kw))
}

pub async fn fetch_kap_announcements(client: &Client) -> Result<Vec<KapAnnouncement>, Box<dyn Error + Send + Sync>> {
    let (bloomberg, dunya) = tokio::join!(
        fetch_rss_feed(client, BLOOMBERG_HT_RSS, "BloombergHT", "Finans Haberi"),
        fetch_rss_feed(client, DUNYA_RSS, "Dünya", "Ekonomi Haberi"),
    );

    let mut all: Vec<KapAnnouncement> = Vec::new();
    all.extend(bloomberg);
    all.extend(dunya);

    // Sort descending by date
    all.sort_by(|a, b| {
        let da = chrono::NaiveDateTime::parse_from_str(&a.date, "%d.%m.%Y %H:%M").unwrap_or_default();
        let db = chrono::NaiveDateTime::parse_from_str(&b.date, "%d.%m.%Y %H:%M").unwrap_or_default();
        db.cmp(&da)
    });

    all.truncate(25);
    
    // Re-number IDs
    for (i, item) in all.iter_mut().enumerate() {
        item.id = format!("NEWS-{}", i + 1);
    }

    Ok(all)
}
