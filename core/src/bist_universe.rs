//! Tam BIST hisse evreni. `kap.org.tr/tr/bist-sirketler` sayfası tüm BIST
//! şirketlerini borsa kodları ve ünvanlarıyla listeler; elle güncellenen
//! statik listenin aksine her zaman güncel ve eksiksizdir. Böylece yeni halka
//! arzlar ve pay grupları evrene otomatik katılır. Liste ~1,5 MB olduğundan
//! günde bir çekilip diske yazılır; sonraki çağrılar önbellekten gelir.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

const KAP_LIST_URL: &str = "https://www.kap.org.tr/tr/bist-sirketler";
const BROWSER_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

#[derive(Serialize, Deserialize, Default)]
struct Cache {
    /// Verinin çekildiği gün (YYYY-MM-DD).
    fetched_date: String,
    /// (ticker, ünvan) çiftleri.
    symbols: Vec<(String, String)>,
}

fn cache_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|home| home.join(".fraude_bist_universe.json"))
}

fn read_cache() -> Option<Cache> {
    cache_path()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|data| serde_json::from_str(&data).ok())
}

fn write_cache(cache: &Cache) {
    if let Some(path) = cache_path() {
        let _ = crate::persist::write_json_atomic(&path, cache);
    }
}

/// Tam BIST evrenini (ticker, ünvan) döndürür. Önbellek bugüne aitse ağdan
/// çekmez. Ağ hatasında bayat önbellek (varsa) döner, o da yoksa boş liste —
/// bu durumda çağıran taraf statik listeye güvenmeye devam eder.
pub async fn load(client: &reqwest::Client) -> Vec<(String, String)> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let cached = read_cache();
    if let Some(cache) = &cached {
        if cache.fetched_date == today && !cache.symbols.is_empty() {
            return cache.symbols.clone();
        }
    }

    match fetch(client).await {
        Ok(symbols) if !symbols.is_empty() => {
            write_cache(&Cache {
                fetched_date: today,
                symbols: symbols.clone(),
            });
            symbols
        }
        _ => cached.map(|cache| cache.symbols).unwrap_or_default(),
    }
}

async fn fetch(client: &reqwest::Client) -> Result<Vec<(String, String)>, String> {
    let html = client
        .get(KAP_LIST_URL)
        .timeout(std::time::Duration::from_secs(30))
        .header("User-Agent", BROWSER_UA)
        .header("Accept-Language", "tr-TR,tr;q=0.9")
        .send()
        .await
        .map_err(|error| format!("KAP BIST listesi alınamadı: {error}"))?
        .error_for_status()
        .map_err(|error| format!("KAP BIST listesi yanıtı: {error}"))?
        .text()
        .await
        .map_err(|error| format!("KAP BIST listesi okunamadı: {error}"))?;
    Ok(parse_symbols(&html))
}

/// Şirket satırlarından (ticker, ünvan) çiftlerini çıkarır. Ticker hücresi
/// anchor içinde `<div>KOD</div>` (çok pay gruplu şirketlerde birden çok),
/// ünvan ise aynı slug'a giden düz metinli anchor'dur.
fn parse_symbols(html: &str) -> Vec<(String, String)> {
    let row = regex::Regex::new(
        r#"href="(/tr/sirket-bilgileri/ozet/[^"]+)">((?:\s*<div>[^<]*</div>)+)\s*</a>"#,
    )
    .expect("geçerli regex");
    let code = regex::Regex::new(r"<div>([^<]*)</div>").expect("geçerli regex");
    // Ünvan hücresi: içinde etiket olmayan (düz metin) anchor. Ticker hücresi
    // `<div>` içerdiğinden `[^<]+` ile eşleşmez, doğal olarak elenir.
    let name_re = regex::Regex::new(
        r#"href="(/tr/sirket-bilgileri/ozet/[^"]+)">([^<]+)</a>"#,
    )
    .expect("geçerli regex");

    let mut slug_name = std::collections::HashMap::new();
    for captures in name_re.captures_iter(html) {
        let name = captures[2].trim();
        if !name.is_empty() {
            slug_name
                .entry(captures[1].to_string())
                .or_insert_with(|| name.to_string());
        }
    }

    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for captures in row.captures_iter(html) {
        let name = slug_name.get(&captures[1]).cloned().unwrap_or_default();
        for code_capture in code.captures_iter(&captures[2]) {
            let ticker = code_capture[1].trim().to_uppercase();
            if (3..=6).contains(&ticker.chars().count())
                && ticker.chars().all(|c| c.is_ascii_alphanumeric())
                && seen.insert(ticker.clone())
            {
                out.push((ticker, name.clone()));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ticker_and_name_including_multi_code() {
        let html = r#"
        <tr><td><a href="/tr/sirket-bilgileri/ozet/866-aselsan"><div>ASELS</div></a></td>
        <td><a href="/tr/sirket-bilgileri/ozet/866-aselsan">ASELSAN ELEKTRONİK SANAYİ VE TİCARET A.Ş.</a></td></tr>
        <tr><td><a href="/tr/sirket-bilgileri/ozet/2425-is-bankasi"><div>ISATR</div><div> ISBTR</div><div> ISCTR</div></a></td>
        <td><a href="/tr/sirket-bilgileri/ozet/2425-is-bankasi">TÜRKİYE İŞ BANKASI A.Ş.</a></td></tr>"#;
        let symbols = parse_symbols(html);
        assert!(symbols.contains(&("ASELS".to_string(), "ASELSAN ELEKTRONİK SANAYİ VE TİCARET A.Ş.".to_string())));
        // Çok pay gruplu şirketin her kodu aynı ünvanla gelir.
        assert!(symbols.contains(&("ISATR".to_string(), "TÜRKİYE İŞ BANKASI A.Ş.".to_string())));
        assert!(symbols.contains(&("ISCTR".to_string(), "TÜRKİYE İŞ BANKASI A.Ş.".to_string())));
    }

    #[tokio::test]
    #[ignore = "requires live KAP access"]
    async fn live_full_bist_universe_is_comprehensive() {
        let client = reqwest::Client::new();
        let symbols = fetch(&client).await.unwrap();
        println!("KAP evreni: {} sembol", symbols.len());
        // Tam BIST ~600+ hisse; statik listeden (613) daha kapsamlı olmalı.
        assert!(symbols.len() > 400, "beklenenden az sembol: {}", symbols.len());
        assert!(symbols.iter().all(|(ticker, name)| !ticker.is_empty() && !name.is_empty()));
        assert!(symbols.iter().any(|(ticker, _)| ticker == "ASELS"));
    }

    #[test]
    fn deduplicates_and_skips_non_ticker_cells() {
        let html = r#"<a href="/tr/sirket-bilgileri/ozet/1-x"><div>ACSEL</div></a>
        <a href="/tr/sirket-bilgileri/ozet/1-x">ACISELSAN A.Ş.</a>
        <a href="/tr/sirket-bilgileri/ozet/1-x"><div>ACSEL</div></a>"#;
        let symbols = parse_symbols(html);
        assert_eq!(symbols.iter().filter(|(t, _)| t == "ACSEL").count(), 1);
    }
}
