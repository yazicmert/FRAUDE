use crate::ipo_scraper::ScrapedIpo;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// İlk kurulumda arşivi tohumlamak için kullanılan geçmiş halka arz verisi.
/// Çalışma zamanındaki gerçek kaynak ~/.fraude_ipos.json arşividir; scraper
/// her başarılı çekişte arşivi günceller, siteden düşen arzlar arşivde kalır.
const IPO_SEED_JSON: &str = include_str!("../data/ipo_seed.json");

/// XHARZ endeksi halka arzları yaklaşık 2 yıl taşır; sync evreni ve endeks
/// üyeliği için aynı pencereyi kullanıyoruz.
const RECENT_IPO_WINDOW_DAYS: i64 = 730;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedIpo {
    pub ticker: String,
    pub name: String,
    pub ipo_date: String,
    pub price: f64,
    pub status: String,
    #[serde(default)]
    pub book_building_dates: Option<String>,
    #[serde(default)]
    pub trading_start_date: Option<String>,
    #[serde(default)]
    pub distribution_type: Option<String>,
    #[serde(default)]
    pub participant_count: Option<String>,
    #[serde(default)]
    pub last_seen: Option<String>,
    /// Arz tarihinden sonraki bölünme/bedelsiz olaylarının kümülatif çarpanı
    /// (2:1 bedelsiz = 2.0). Getiri hesabında fiyat düzeltmesi için kullanılır.
    #[serde(default)]
    pub split_factor: Option<f64>,
    /// Bölünme çarpanının en son kontrol edildiği tarih (YYYY-MM-DD).
    #[serde(default)]
    pub split_checked: Option<String>,
}

fn archive_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join(".fraude_ipos.json"))
}

pub fn load() -> Vec<PersistedIpo> {
    if let Some(path) = archive_path() {
        if let Ok(contents) = std::fs::read_to_string(&path) {
            if let Ok(ipos) = serde_json::from_str::<Vec<PersistedIpo>>(&contents) {
                if !ipos.is_empty() {
                    return ipos;
                }
            }
        }
    }
    let seeded: Vec<PersistedIpo> = serde_json::from_str(IPO_SEED_JSON).unwrap_or_default();
    save(&seeded);
    seeded
}

pub fn save(ipos: &[PersistedIpo]) {
    if let Some(path) = archive_path() {
        if let Ok(json) = serde_json::to_string_pretty(ipos) {
            let _ = std::fs::write(&path, json);
        }
    }
}

pub fn looks_like_iso_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && value.chars().take(4).all(|c| c.is_ascii_digit())
}

/// Taze scrape sonucunu arşive işler. Yeni ticker eklenir, mevcut kayıt
/// güncellenir; scrape'in boş döndürdüğü alanlar arşivdeki dolu değeri ezmez.
pub fn merge_scraped(archive: &mut Vec<PersistedIpo>, scraped: &[ScrapedIpo]) -> bool {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut changed = false;

    for ipo in scraped {
        if ipo.ticker.is_empty() {
            continue;
        }
        if let Some(existing) = archive.iter_mut().find(|p| p.ticker == ipo.ticker) {
            if ipo.price > 0.0 {
                existing.price = ipo.price;
            }
            if !ipo.name.is_empty() {
                existing.name = ipo.name.clone();
            }
            existing.status = ipo.status.clone();
            if looks_like_iso_date(&ipo.ipo_date) {
                existing.ipo_date = ipo.ipo_date.clone();
            }
            if ipo.book_building_dates.is_some() {
                existing.book_building_dates = ipo.book_building_dates.clone();
            }
            if ipo.trading_start_date.is_some() {
                existing.trading_start_date = ipo.trading_start_date.clone();
            }
            if ipo.distribution_type.is_some() {
                existing.distribution_type = ipo.distribution_type.clone();
            }
            if ipo.participant_count.is_some() {
                existing.participant_count = ipo.participant_count.clone();
            }
            existing.last_seen = Some(today.clone());
        } else {
            archive.push(PersistedIpo {
                ticker: ipo.ticker.clone(),
                name: ipo.name.clone(),
                ipo_date: ipo.ipo_date.clone(),
                price: ipo.price,
                status: ipo.status.clone(),
                book_building_dates: ipo.book_building_dates.clone(),
                trading_start_date: ipo.trading_start_date.clone(),
                distribution_type: ipo.distribution_type.clone(),
                participant_count: ipo.participant_count.clone(),
                last_seen: Some(today.clone()),
                split_factor: None,
                split_checked: None,
            });
        }
        changed = true;
    }

    changed
}

fn recent_cutoff() -> String {
    (chrono::Local::now() - chrono::Duration::days(RECENT_IPO_WINDOW_DAYS))
        .format("%Y-%m-%d")
        .to_string()
}

fn is_valid_bist_code(ticker: &str) -> bool {
    (3..=6).contains(&ticker.len())
        && ticker.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
}

/// Son 2 yıl içinde işlem görmeye başlamış (taslak olmayan) halka arz kodları.
/// XHARZ / "BIST HALKA ARZ" endeks üyeliği bu kümeden türetilir.
pub fn recent_ipo_tickers(archive: &[PersistedIpo]) -> HashSet<String> {
    let cutoff = recent_cutoff();
    archive
        .iter()
        .filter(|p| p.status != "TASLAK")
        .filter(|p| looks_like_iso_date(&p.ipo_date) && p.ipo_date.as_str() >= cutoff.as_str())
        .filter(|p| is_valid_bist_code(&p.ticker))
        .map(|p| p.ticker.clone())
        .collect()
}

/// Statik evrende bulunmayan güncel IPO ticker'ları; Yahoo sync evrenine
/// eklenerek güncel fiyat/getiri verisinin otomatik dolması sağlanır.
pub fn sync_universe_additions(
    archive: &[PersistedIpo],
    known: &HashSet<&str>,
) -> Vec<(String, String)> {
    let recent = recent_ipo_tickers(archive);
    archive
        .iter()
        .filter(|p| recent.contains(&p.ticker) && !known.contains(p.ticker.as_str()))
        .map(|p| (p.ticker.clone(), p.name.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scraped(ticker: &str, price: f64, status: &str) -> ScrapedIpo {
        ScrapedIpo {
            ticker: ticker.into(),
            name: format!("{ticker} A.Ş."),
            ipo_date: "2027-01-15".into(),
            price,
            status: status.into(),
            book_building_dates: None,
            trading_start_date: None,
            distribution_type: None,
            participant_count: None,
        }
    }

    fn persisted(ticker: &str, price: f64) -> PersistedIpo {
        PersistedIpo {
            ticker: ticker.into(),
            name: format!("{ticker} A.Ş."),
            ipo_date: "2026-05-01".into(),
            price,
            status: "TAMAMLANDI".into(),
            book_building_dates: Some("1-2 Mayıs 2026".into()),
            trading_start_date: None,
            distribution_type: None,
            participant_count: None,
            last_seen: None,
            split_factor: None,
            split_checked: None,
        }
    }

    #[test]
    fn merge_adds_new_tickers() {
        let mut archive = vec![persisted("AAAA", 10.0)];
        let changed = merge_scraped(&mut archive, &[scraped("BBBB", 25.0, "AKTİF")]);
        assert!(changed);
        assert_eq!(archive.len(), 2);
        assert_eq!(archive[1].ticker, "BBBB");
        assert!(archive[1].last_seen.is_some());
    }

    #[test]
    fn merge_does_not_erase_known_values_with_empty_scrape() {
        let mut archive = vec![persisted("AAAA", 10.0)];
        merge_scraped(&mut archive, &[scraped("AAAA", 0.0, "TAMAMLANDI")]);
        assert_eq!(archive[0].price, 10.0);
        assert_eq!(
            archive[0].book_building_dates.as_deref(),
            Some("1-2 Mayıs 2026")
        );
    }

    #[test]
    fn merge_updates_status_and_price() {
        let mut archive = vec![persisted("AAAA", 10.0)];
        merge_scraped(&mut archive, &[scraped("AAAA", 12.5, "AKTİF")]);
        assert_eq!(archive[0].price, 12.5);
        assert_eq!(archive[0].status, "AKTİF");
        assert_eq!(archive[0].ipo_date, "2027-01-15");
    }

    #[test]
    fn recent_tickers_exclude_drafts_and_old_ipos() {
        let recent_date = chrono::Local::now().format("%Y-%m-%d").to_string();
        let mut fresh = persisted("FRSH", 5.0);
        fresh.ipo_date = recent_date;
        let mut old = persisted("OLDD", 5.0);
        old.ipo_date = "2019-01-01".into();
        let mut draft = persisted("DRFT", 5.0);
        draft.ipo_date = chrono::Local::now().format("%Y-%m-%d").to_string();
        draft.status = "TASLAK".into();

        let set = recent_ipo_tickers(&[fresh, old, draft]);
        assert!(set.contains("FRSH"));
        assert!(!set.contains("OLDD"));
        assert!(!set.contains("DRFT"));
    }

    #[test]
    fn seed_json_parses() {
        let seeded: Vec<PersistedIpo> = serde_json::from_str(IPO_SEED_JSON).unwrap();
        assert!(seeded.len() >= 30);
        assert!(seeded.iter().all(|p| !p.ticker.is_empty()));
    }
}
