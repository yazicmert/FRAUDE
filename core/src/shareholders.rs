//! Şirket ortaklık yapıları. Veri İş Yatırım şirket kartına gömülü
//! `OrtaklikYapisidata` dizisinden bir kez çekilir ve diske kalıcı yazılır;
//! sonraki açılışlar önbellekten gelir. Değişikliklerin takibi KAP
//! bildirimleri üzerinden yapılır, elle "Yenile" ile de tazelenebilir.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

const CARD_URL: &str =
    "https://www.isyatirim.com.tr/tr-tr/analiz/hisse/Sayfalar/sirket-karti.aspx";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Shareholder {
    pub name: String,
    pub pct: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ShareholderSnapshot {
    pub ticker: String,
    /// Verinin çekildiği tarih (gg.aa.yyyy)
    pub as_of: String,
    pub holders: Vec<Shareholder>,
}

/// İki snapshot arasındaki tek bir ortak için pay değişimi. `prev_pct`/`new_pct`
/// None ise ortak sırasıyla yeni eklenmiş / ortaklıktan çıkmıştır.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ShareholderChange {
    pub name: String,
    pub prev_pct: Option<f64>,
    pub new_pct: Option<f64>,
    /// new - prev (ekleme: +new, çıkış: -prev)
    pub delta: f64,
}

/// Bu yüzde-puan eşiğinin altındaki değişiklikler (yuvarlama gürültüsü)
/// yok sayılır.
const MIN_PCT_DELTA: f64 = 0.5;

/// İş Yatırım şirket kartı bağlantısı (uyarıda kaynak linki olarak kullanılır).
pub fn card_url(ticker: &str) -> String {
    let key = ticker.trim().trim_end_matches(".IS").to_uppercase();
    format!("{CARD_URL}?hisse={key}")
}

/// Türkçe-doğru küçük harfe çevirme: 'İ' → 'i', 'I' → 'ı'. Varsayılan
/// `to_lowercase()` büyük İ'yi birleşik noktalı diziye çevirdiğinden ("İ" →
/// "i̇") düz metin karşılaştırmalarını bozar; bu yardımcı onu önler.
fn tr_lower(s: &str) -> String {
    s.chars()
        .flat_map(|c| match c {
            'İ' => vec!['i'],
            'I' => vec!['ı'],
            other => other.to_lowercase().collect::<Vec<char>>(),
        })
        .collect()
}

/// "Diğer", "Halka Açık" gibi kalıntı/serbest dolaşım kalemleri gerçek bir
/// ortak değildir; herhangi bir pay değişiminde artık olarak oynadıklarından
/// diff'te uyarı üretmezler.
fn is_generic_holder(name: &str) -> bool {
    let lower = tr_lower(name.trim());
    const GENERIC: [&str; 6] = [
        "diğer", "diger", "halka açık", "halka acik", "free float", "diğer ortaklar",
    ];
    GENERIC.iter().any(|pattern| lower.contains(pattern))
}

/// İki ortak listesi arasındaki materyal değişiklikleri çıkarır. İsimler
/// büyük/küçük harf duyarsız eşleştirilir; jenerik kalemler ve eşiğin
/// altındaki oynamalar elenir.
fn diff_holders(prev: &[Shareholder], new: &[Shareholder]) -> Vec<ShareholderChange> {
    let norm = |s: &str| tr_lower(s.trim());
    let mut changes = Vec::new();

    // Değişen veya çıkan ortaklar.
    for p in prev {
        if is_generic_holder(&p.name) {
            continue;
        }
        match new.iter().find(|n| norm(&n.name) == norm(&p.name)) {
            Some(n) => {
                let delta = n.pct - p.pct;
                if delta.abs() >= MIN_PCT_DELTA {
                    changes.push(ShareholderChange {
                        name: p.name.clone(),
                        prev_pct: Some(p.pct),
                        new_pct: Some(n.pct),
                        delta,
                    });
                }
            }
            None if p.pct >= MIN_PCT_DELTA => {
                changes.push(ShareholderChange {
                    name: p.name.clone(),
                    prev_pct: Some(p.pct),
                    new_pct: None,
                    delta: -p.pct,
                });
            }
            None => {}
        }
    }

    // Yeni eklenen ortaklar.
    for n in new {
        if is_generic_holder(&n.name) || n.pct < MIN_PCT_DELTA {
            continue;
        }
        if !prev.iter().any(|p| norm(&p.name) == norm(&n.name)) {
            changes.push(ShareholderChange {
                name: n.name.clone(),
                prev_pct: None,
                new_pct: Some(n.pct),
                delta: n.pct,
            });
        }
    }

    changes
}

/// Ortaklık yapısını İş Yatırım'dan yeniden çeker, önceki önbellek snapshot'ı
/// ile karşılaştırır, yeni snapshot'ı kaydeder ve materyal pay değişikliklerini
/// döndürür. Önceki snapshot yoksa (ilk kez) yalnızca tohumlanır, değişiklik
/// listesi boş döner.
pub async fn refresh_and_diff(
    client: &reqwest::Client,
    ticker: &str,
) -> Result<(ShareholderSnapshot, Vec<ShareholderChange>), String> {
    let key = ticker.trim().trim_end_matches(".IS").to_uppercase();
    let previous = load_all().get(&key).cloned();
    let fresh = fetch_from_isyatirim(client, &key).await?;

    let changes = match &previous {
        Some(prev) => diff_holders(&prev.holders, &fresh.holders),
        None => Vec::new(),
    };

    let mut all = load_all();
    all.insert(key, fresh.clone());
    save_all(&all);
    Ok((fresh, changes))
}

fn file_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|home| home.join(".fraude_shareholders.json"))
}

fn load_all() -> HashMap<String, ShareholderSnapshot> {
    let Some(path) = file_path() else { return HashMap::new() };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|data| serde_json::from_str(&data).ok())
        .unwrap_or_default()
}

fn save_all(all: &HashMap<String, ShareholderSnapshot>) {
    if let Some(path) = file_path() {
        let _ = crate::persist::write_json_atomic(&path, all);
    }
}

pub async fn get_shareholders(
    client: &reqwest::Client,
    ticker: &str,
    force_refresh: bool,
) -> Result<ShareholderSnapshot, String> {
    let key = ticker.trim().trim_end_matches(".IS").to_uppercase();

    if !force_refresh {
        if let Some(snapshot) = load_all().get(&key) {
            return Ok(snapshot.clone());
        }
    }

    let snapshot = fetch_from_isyatirim(client, &key).await?;
    let mut all = load_all();
    all.insert(key, snapshot.clone());
    save_all(&all);
    Ok(snapshot)
}

async fn fetch_from_isyatirim(
    client: &reqwest::Client,
    ticker: &str,
) -> Result<ShareholderSnapshot, String> {
    let mut url = reqwest::Url::parse(CARD_URL).map_err(|error| error.to_string())?;
    url.query_pairs_mut().append_pair("hisse", ticker);

    let html = client
        .get(url)
        .timeout(std::time::Duration::from_secs(20))
        .header("User-Agent", crate::yahoo::YAHOO_USER_AGENT)
        .send()
        .await
        .map_err(|error| format!("İş Yatırım şirket kartı alınamadı: {error}"))?
        .error_for_status()
        .map_err(|error| format!("İş Yatırım şirket kartı yanıtı: {error}"))?
        .text()
        .await
        .map_err(|error| format!("Şirket kartı okunamadı: {error}"))?;

    let holders = parse_ownership(&html)
        .ok_or_else(|| format!("{ticker} için ortaklık yapısı verisi bulunamadı."))?;

    Ok(ShareholderSnapshot {
        ticker: ticker.to_string(),
        as_of: chrono::Local::now().format("%d.%m.%Y").to_string(),
        holders,
    })
}

fn parse_ownership(html: &str) -> Option<Vec<Shareholder>> {
    let anchor = html.find("OrtaklikYapisidata")?;
    let segment_start = html[anchor..].find('[')? + anchor;
    let segment_end = html[segment_start..].find(']')? + segment_start + 1;
    let segment = &html[segment_start..segment_end];

    let pattern = regex::Regex::new(r"\{name:\s*'((?:\\'|[^'])*)'\s*,\s*y:\s*([0-9]+(?:\.[0-9]+)?)\}").ok()?;
    let mut holders: Vec<Shareholder> = pattern
        .captures_iter(segment)
        .filter_map(|captures| {
            let name = captures[1].replace("\\'", "'").trim().to_string();
            let pct = captures[2].parse::<f64>().ok()?;
            (!name.is_empty() && pct.is_finite()).then_some(Shareholder { name, pct })
        })
        .collect();

    if holders.is_empty() {
        return None;
    }
    holders.sort_by(|a, b| b.pct.partial_cmp(&a.pct).unwrap_or(std::cmp::Ordering::Equal));
    Some(holders)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_embedded_ownership_array() {
        let html = r#"<script>
            var OrtaklikYapisidata = [{name: 'Diğer',y: 25.8},{name: 'Türk Silahlı Kuvvetlerini Güçlendirme Vakfı',y: 74.2}];
        </script>"#;
        let holders = parse_ownership(html).unwrap();
        assert_eq!(holders.len(), 2);
        assert_eq!(holders[0].name, "Türk Silahlı Kuvvetlerini Güçlendirme Vakfı");
        assert!((holders[0].pct - 74.2).abs() < 1e-9);
        assert_eq!(holders[1].name, "Diğer");
    }

    #[test]
    fn missing_data_returns_none() {
        assert!(parse_ownership("<html>hisse sayfası</html>").is_none());
    }

    fn holder(name: &str, pct: f64) -> Shareholder {
        Shareholder { name: name.to_string(), pct }
    }

    #[test]
    fn diff_detects_material_pct_drop() {
        let prev = vec![holder("Vakıf", 74.2), holder("Diğer", 25.8)];
        let new = vec![holder("Vakıf", 60.0), holder("Diğer", 40.0)];
        let changes = diff_holders(&prev, &new);
        // "Diğer" jenerik olduğundan yalnızca Vakıf raporlanır.
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].name, "Vakıf");
        assert_eq!(changes[0].prev_pct, Some(74.2));
        assert_eq!(changes[0].new_pct, Some(60.0));
        assert!((changes[0].delta - (-14.2)).abs() < 1e-9);
    }

    #[test]
    fn diff_ignores_rounding_noise_below_threshold() {
        let prev = vec![holder("Ortak A", 30.00)];
        let new = vec![holder("Ortak A", 30.30)];
        assert!(diff_holders(&prev, &new).is_empty());
    }

    #[test]
    fn diff_reports_added_and_removed_holders() {
        let prev = vec![holder("Eski Ortak", 20.0), holder("Kalıcı", 50.0)];
        let new = vec![holder("Kalıcı", 50.0), holder("Yeni Ortak", 20.0)];
        let changes = diff_holders(&prev, &new);
        assert_eq!(changes.len(), 2);
        let removed = changes.iter().find(|c| c.name == "Eski Ortak").unwrap();
        assert_eq!(removed.new_pct, None);
        let added = changes.iter().find(|c| c.name == "Yeni Ortak").unwrap();
        assert_eq!(added.prev_pct, None);
        assert_eq!(added.new_pct, Some(20.0));
    }

    #[test]
    fn diff_matches_names_case_insensitively() {
        let prev = vec![holder("Türk Silahlı Kuvvetleri Vakfı", 74.2)];
        let new = vec![holder("türk silahlı kuvvetleri vakfı", 74.2)];
        assert!(diff_holders(&prev, &new).is_empty(), "aynı ortak eşleşmeli, değişim olmamalı");
    }

    #[test]
    fn generic_holders_are_recognized() {
        assert!(is_generic_holder("Diğer"));
        assert!(is_generic_holder("Halka Açık Kısım"));
        assert!(is_generic_holder("DİĞER ORTAKLAR"));
        assert!(!is_generic_holder("Koç Holding A.Ş."));
    }

    #[tokio::test]
    #[ignore = "requires live İş Yatırım access"]
    async fn live_asels_ownership_is_available() {
        let client = reqwest::Client::new();
        let snapshot = fetch_from_isyatirim(&client, "ASELS").await.unwrap();
        println!("{:?}", snapshot.holders);
        assert!(!snapshot.holders.is_empty());
        let total: f64 = snapshot.holders.iter().map(|h| h.pct).sum();
        assert!((90.0..=110.0).contains(&total), "paylar ~%100 olmalı: {total}");
    }
}
