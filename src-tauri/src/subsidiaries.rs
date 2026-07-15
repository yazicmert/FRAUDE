//! KAP "Şirket Genel Bilgileri" sayfasındaki bağlı ortaklık / iştirak
//! tablosu. Sayfa veriyi Next.js flight JSON'u olarak gömer (itemKey:
//! `kpy41_acc7_bagli_ortakliklar`). Ticker → KAP sayfa yolu eşlemesi
//! bist-sirketler listesinden çıkarılır; her iki veri de diske yazılır,
//! sonraki açılışlar önbellekten gelir ve "Yenile" ile tazelenebilir.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

const KAP_BASE: &str = "https://www.kap.org.tr";
const KAP_LIST_PATH: &str = "/tr/bist-sirketler";
// KAP, tarayıcı dışı User-Agent'ları Cloudflare ile engelleyebiliyor.
const BROWSER_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Subsidiary {
    pub name: String,
    pub activity: Option<String>,
    pub relation: Option<String>,
    pub pct: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SubsidiarySnapshot {
    pub ticker: String,
    /// Verinin çekildiği tarih (gg.aa.yyyy)
    pub as_of: String,
    pub items: Vec<Subsidiary>,
}

fn cache_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|home| home.join(".fraude_subsidiaries.json"))
}

fn slug_cache_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|home| home.join(".fraude_kap_slugs.json"))
}

fn load_json<T: serde::de::DeserializeOwned + Default>(path: Option<std::path::PathBuf>) -> T {
    path.and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|data| serde_json::from_str(&data).ok())
        .unwrap_or_default()
}

fn save_json<T: Serialize>(path: Option<std::path::PathBuf>, value: &T) {
    if let Some(p) = path {
        let _ = crate::persist::write_json_atomic(&p, value);
    }
}

async fn fetch_text(client: &reqwest::Client, url: &str) -> Result<String, String> {
    client
        .get(url)
        .timeout(std::time::Duration::from_secs(30))
        .header("User-Agent", BROWSER_UA)
        .header("Accept-Language", "tr-TR,tr;q=0.9")
        .send()
        .await
        .map_err(|error| format!("KAP isteği başarısız: {error}"))?
        .error_for_status()
        .map_err(|error| format!("KAP yanıtı: {error}"))?
        .text()
        .await
        .map_err(|error| format!("KAP sayfası okunamadı: {error}"))
}

pub async fn get_subsidiaries(
    client: &reqwest::Client,
    ticker: &str,
    force_refresh: bool,
) -> Result<SubsidiarySnapshot, String> {
    let key = ticker.trim().trim_end_matches(".IS").to_uppercase();

    if !force_refresh {
        let cache: HashMap<String, SubsidiarySnapshot> = load_json(cache_path());
        if let Some(snapshot) = cache.get(&key) {
            return Ok(snapshot.clone());
        }
    }

    let company_path = resolve_company_path(client, &key, force_refresh).await?;
    let genel_url = format!("{KAP_BASE}{}", company_path.replace("/ozet/", "/genel/"));
    let html = fetch_text(client, &genel_url).await?;
    let items = parse_subsidiaries(&html)?;

    let snapshot = SubsidiarySnapshot {
        ticker: key.clone(),
        as_of: chrono::Local::now().format("%d.%m.%Y").to_string(),
        items,
    };
    let mut cache: HashMap<String, SubsidiarySnapshot> = load_json(cache_path());
    cache.insert(key, snapshot.clone());
    save_json(cache_path(), &cache);
    Ok(snapshot)
}

/// bist-sirketler listesinden ticker → `/tr/sirket-bilgileri/ozet/...` eşlemesi.
/// Liste ~1,5 MB olduğundan bir kez indirilip diske yazılır.
async fn resolve_company_path(
    client: &reqwest::Client,
    ticker: &str,
    force_refresh: bool,
) -> Result<String, String> {
    if !force_refresh {
        let map: HashMap<String, String> = load_json(slug_cache_path());
        if let Some(path) = map.get(ticker) {
            return Ok(path.clone());
        }
    }

    let html = fetch_text(client, &format!("{KAP_BASE}{KAP_LIST_PATH}")).await?;
    let map = parse_company_paths(&html);
    if map.is_empty() {
        return Err("KAP şirket listesi çözümlenemedi.".into());
    }
    save_json(slug_cache_path(), &map);
    map.get(ticker)
        .cloned()
        .ok_or_else(|| format!("{ticker} için KAP şirket sayfası bulunamadı."))
}

fn parse_company_paths(html: &str) -> HashMap<String, String> {
    // Ticker hücresi: <a href="/tr/sirket-bilgileri/ozet/866-..."><div>ASELS</div></a>
    // Çok kodlu şirketlerde anchor içinde birden fazla <div> bulunur.
    let row = regex::Regex::new(
        r#"href="(/tr/sirket-bilgileri/ozet/[^"]+)">((?:\s*<div>[^<]*</div>)+)\s*</a>"#,
    )
    .expect("geçerli regex");
    let code = regex::Regex::new(r"<div>([^<]*)</div>").expect("geçerli regex");

    let mut map = HashMap::new();
    for captures in row.captures_iter(html) {
        let path = captures[1].to_string();
        for code_capture in code.captures_iter(&captures[2]) {
            let symbol = code_capture[1].trim().to_uppercase();
            if (3..=6).contains(&symbol.chars().count()) && symbol.chars().all(|c| c.is_ascii_alphanumeric()) {
                map.entry(symbol).or_insert_with(|| path.clone());
            }
        }
    }
    map
}

fn parse_subsidiaries(html: &str) -> Result<Vec<Subsidiary>, String> {
    // Tablo hiç yoksa şirketin bildirilmiş bağlı ortaklığı yok demektir.
    let Some(anchor) = html.find("kpy41_acc7_bagli_ortakliklar") else {
        return Ok(Vec::new());
    };
    let after = &html[anchor..];
    // Flight verisinde JSON, JS dizgisi içinde kaçışlı durur: value\":[...]
    let (value_pos, escaped) = match after.find("value\\\":[") {
        Some(pos) => (pos + "value\\\":".len(), true),
        None => match after.find("value\":[") {
            Some(pos) => (pos + "value\":".len(), false),
            None => return Err("KAP bağlı ortaklık verisi çözümlenemedi.".into()),
        },
    };
    let segment_end = (value_pos + 600_000).min(after.len());
    let segment = &after[value_pos..segment_end];
    let unescaped = if escaped {
        segment.replace("\\\"", "\"")
    } else {
        segment.to_string()
    };
    let json_array = extract_json_array(&unescaped)
        .ok_or("KAP bağlı ortaklık dizisi tamamlanamadı.")?;
    let rows: Vec<serde_json::Value> = serde_json::from_str(json_array)
        .map_err(|error| format!("KAP bağlı ortaklık JSON hatası: {error}"))?;

    let mut items: Vec<Subsidiary> = rows
        .iter()
        .filter_map(|row| {
            let name = row["companyTitle"].as_str()?.trim().to_string();
            if name.is_empty() {
                return None;
            }
            let text = |key: &str| {
                row[key]
                    .as_str()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
            };
            let pct = row["ratioOfCapitalShareOfCompany"]
                .as_str()
                .and_then(|value| value.trim().replace(',', ".").parse::<f64>().ok())
                .filter(|value| value.is_finite() && *value > 0.0);
            Some(Subsidiary {
                name,
                activity: text("scopeOfActivitiesOfCompany"),
                relation: text("relationWithTheCompany"),
                pct,
            })
        })
        .collect();

    items.sort_by(|a, b| {
        b.pct
            .unwrap_or(-1.0)
            .partial_cmp(&a.pct.unwrap_or(-1.0))
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(items)
}

/// `[` ile başlayan metinde, dizgi içi köşeli ayraçları sayarak dengeli
/// kapanışı bulur ve dizinin tamamını döndürür.
fn extract_json_array(text: &str) -> Option<&str> {
    let bytes = text.as_bytes();
    if bytes.first() != Some(&b'[') {
        return None;
    }
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escaped = false;
    for (i, &byte) in bytes.iter().enumerate() {
        if in_string {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
        } else {
            match byte {
                b'"' => in_string = true,
                b'[' => depth += 1,
                b']' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(&text[..=i]);
                    }
                }
                _ => {}
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_company_paths_with_multiple_codes() {
        let html = r#"<td><a href="/tr/sirket-bilgileri/ozet/2425-turkiye-is-bankasi-a-s"><div>ISATR</div><div> ISBTR</div><div> ISCTR</div></a></td>
            <td><a href="/tr/sirket-bilgileri/ozet/866-aselsan-elektronik-sanayi-ve-ticaret-a-s"><div>ASELS</div></a></td>"#;
        let map = parse_company_paths(html);
        assert_eq!(map.get("ASELS").unwrap(), "/tr/sirket-bilgileri/ozet/866-aselsan-elektronik-sanayi-ve-ticaret-a-s");
        assert_eq!(map.get("ISCTR").unwrap(), "/tr/sirket-bilgileri/ozet/2425-turkiye-is-bankasi-a-s");
        assert_eq!(map.get("ISATR").unwrap(), map.get("ISBTR").unwrap());
    }

    #[test]
    fn parses_escaped_flight_subsidiaries() {
        let html = r#"{\"itemKey\":\"kpy41_acc7_bagli_ortakliklar\",\"value\":[{\"companyTitle\":\"ASELSAN BAKÜ MMC\",\"scopeOfActivitiesOfCompany\":\"Bakım ve Onarım\",\"ratioOfCapitalShareOfCompany\":\"100\",\"relationWithTheCompany\":\"Bağlı Ortaklık (Konsolidasyona Tabi)\"},{\"companyTitle\":\"ORAN YATIRIM\",\"scopeOfActivitiesOfCompany\":null,\"ratioOfCapitalShareOfCompany\":\"50,5\",\"relationWithTheCompany\":\"İştirak\"}]}"#;
        let items = parse_subsidiaries(html).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].name, "ASELSAN BAKÜ MMC");
        assert!((items[0].pct.unwrap() - 100.0).abs() < 1e-9);
        assert_eq!(items[1].name, "ORAN YATIRIM");
        assert!((items[1].pct.unwrap() - 50.5).abs() < 1e-9);
        assert_eq!(items[1].relation.as_deref(), Some("İştirak"));
    }

    #[test]
    fn missing_table_means_no_subsidiaries() {
        assert!(parse_subsidiaries("<html>genel bilgiler</html>").unwrap().is_empty());
    }
}
