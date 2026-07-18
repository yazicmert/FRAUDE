use std::collections::{HashMap, HashSet};
use std::fs;
use serde::{Deserialize, Serialize};

const BIST_CSV_URL: &str = "https://borsaistanbul.com/datum/hisse_endeks_ds.csv";
const CACHE_FILE: &str = "bist_indices_cache.json";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IndexChange {
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub timestamp: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct BistIndicesCache {
    pub last_updated: u64,
    pub memberships: HashMap<String, Vec<String>>,
    pub changes: HashMap<String, IndexChange>,
}

fn cache_path() -> std::path::PathBuf {
    let mut path = std::env::temp_dir();
    path.push("fraude");
    fs::create_dir_all(&path).ok();
    path.push(CACHE_FILE);
    path
}

fn load_cache() -> BistIndicesCache {
    if let Ok(data) = fs::read_to_string(cache_path()) {
        if let Ok(cache) = serde_json::from_str(&data) {
            return cache;
        }
    }
    BistIndicesCache::default()
}

fn save_cache(cache: &BistIndicesCache) {
    if let Ok(data) = serde_json::to_string(cache) {
        let _ = fs::write(cache_path(), data);
    }
}

pub async fn fetch_and_update_indices(force: bool) -> BistIndicesCache {
    let cache = load_cache();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();

    // Update if older than 30 days (2592000 seconds) or if forced
    if !force && cache.last_updated > 0 && now - cache.last_updated < 2592000 {
        return cache;
    }

    let client = reqwest::Client::new();
    let res = client.get(BIST_CSV_URL).header("User-Agent", "Mozilla/5.0").send().await;

    if let Ok(response) = res {
        if let Ok(text) = response.text().await {
            return update_from_csv_text(&text);
        }
    }

    cache
}

/// İndirilmiş endeks CSV metnini üyelik önbelleğine işler ve diskteki
/// önbelleği tazeler. Endeksler sayfasındaki elle CSV güncellemesi de bu
/// yolu kullanır; böylece hisse üyelikleri ile endeks listesi tek kaynaktan
/// beslenir ve 30 günlük önbellek beklenmeden güncellenir.
pub fn update_from_csv_text(text: &str) -> BistIndicesCache {
    let mut cache = load_cache();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();

    let mut new_memberships: HashMap<String, Vec<String>> = HashMap::new();

    for line in text.lines().skip(2) { // Skip 2 header rows
        let parts: Vec<&str> = line.split(';').collect();
        if parts.len() >= 4 {
            let mut symbol = parts[0].to_string();
            if symbol.ends_with(".E") {
                symbol = symbol.replace(".E", "");
            }
            let index_name = parts[3].trim().to_string();

            new_memberships.entry(symbol).or_default().push(index_name);
        }
    }

    if new_memberships.is_empty() {
        return cache;
    }

    // Diffing logic
    if cache.last_updated > 0 {
        let mut new_changes: HashMap<String, IndexChange> = HashMap::new();

        // Track changes for all known symbols
        let mut all_symbols: HashSet<String> = HashSet::new();
        for s in cache.memberships.keys() { all_symbols.insert(s.clone()); }
        for s in new_memberships.keys() { all_symbols.insert(s.clone()); }

        for symbol in all_symbols {
            let old_indices = cache.memberships.get(&symbol).cloned().unwrap_or_default();
            let current_indices = new_memberships.get(&symbol).cloned().unwrap_or_default();

            let mut added = Vec::new();
            let mut removed = Vec::new();

            for idx in &current_indices {
                if !old_indices.contains(idx) {
                    added.push(idx.clone());
                }
            }
            for idx in &old_indices {
                if !current_indices.contains(idx) {
                    removed.push(idx.clone());
                }
            }

            if !added.is_empty() || !removed.is_empty() {
                new_changes.insert(symbol.clone(), IndexChange {
                    added,
                    removed,
                    timestamp: now,
                });
            }
        }

        // Keep changes that are less than 2 days old (172800 seconds)
        for (sym, change) in cache.changes.drain() {
            if now - change.timestamp < 172800 {
                if !new_changes.contains_key(&sym) {
                    new_changes.insert(sym, change);
                }
            }
        }

        cache.changes = new_changes;
    }

    cache.memberships = new_memberships;
    cache.last_updated = now;
    save_cache(&cache);

    cache
}
