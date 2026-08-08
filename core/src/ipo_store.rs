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
    #[serde(default)]
    pub fund_usage: Option<String>,
    #[serde(default)]
    pub share_structure: Option<String>,
    #[serde(default)]
    pub ipo_size: Option<String>,
    #[serde(default)]
    pub katilim_index: Option<String>,
    #[serde(default)]
    pub lockup_period: Option<String>,
    #[serde(default)]
    pub consortium_lead: Option<String>,
    #[serde(default)]
    pub t1_t2_available: Option<String>,
    #[serde(default)]
    pub distribution_ratios: Option<String>,
}

fn archive_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join(".fraude_ipos.json"))
}

pub fn load() -> Vec<PersistedIpo> {
    let mut ipos = if let Some(path) = archive_path() {
        if let Ok(contents) = std::fs::read_to_string(&path) {
            if let Ok(records) = serde_json::from_str::<Vec<PersistedIpo>>(&contents) {
                if !records.is_empty() {
                    records
                } else {
                    serde_json::from_str(IPO_SEED_JSON).unwrap_or_default()
                }
            } else {
                serde_json::from_str(IPO_SEED_JSON).unwrap_or_default()
            }
        } else {
            serde_json::from_str(IPO_SEED_JSON).unwrap_or_default()
        }
    } else {
        serde_json::from_str(IPO_SEED_JSON).unwrap_or_default()
    };

    if enrich_consortium_leads(&mut ipos) {
        save(&ipos);
    }
    ipos
}

fn enrich_consortium_leads(ipos: &mut [PersistedIpo]) -> bool {
    let mut changed = false;
    for ipo in ipos.iter_mut() {
        let is_savur = ipo.ticker == "SVGYO" || ipo.name.contains("Savur");
        if is_savur {
            if ipo.consortium_lead.is_none() || ipo.consortium_lead.as_deref() == Some("") {
                ipo.consortium_lead = Some("Tera Yatırım Menkul Değerler A.Ş.".to_string());
                changed = true;
            }
            if ipo.ipo_size.is_none() || ipo.ipo_size.as_deref().unwrap_or("").contains("İzahname") {
                ipo.ipo_size = Some("1.100.000.000 TL (1,1 Milyar ₺)".to_string());
                changed = true;
            }
            if ipo.fund_usage.is_none() || ipo.fund_usage.as_deref().unwrap_or("").contains("izahnamede") {
                ipo.fund_usage = Some("%25-40 Kandilli Projesi maliyetlerinin finansmanı, %60-75 Yeni gayrimenkul yatırımları, %0-15 İşletme sermayesi".to_string());
                changed = true;
            }
            if ipo.share_structure.is_none() || ipo.share_structure.as_deref().unwrap_or("").contains("izahnamede") {
                ipo.share_structure = Some("295.400.000 Lot (%27,28 Halka Açıklık Oranı)".to_string());
                changed = true;
            }
            if ipo.distribution_ratios.is_none() || ipo.distribution_ratios.as_deref().unwrap_or("").contains("bulunmuyor") {
                ipo.distribution_ratios = Some("Yurt İçi Bireysel: Bireysele Eşit Dağıtım (%80)".to_string());
                changed = true;
            }
            if ipo.katilim_index.is_none() || ipo.katilim_index.as_deref().unwrap_or("").contains("İzahname") {
                ipo.katilim_index = Some("Katılım Endeksine Uygun Değil".to_string());
                changed = true;
            }
        }
        if ipo.consortium_lead.is_none() || ipo.consortium_lead.as_deref() == Some("") {
            let lead = match ipo.ticker.as_str() {
                "SVGYO" => Some("Tera Yatırım Menkul Değerler A.Ş."),
                "TKNKA" => Some("Tera Yatırım Menkul Değerler A.Ş."),
                "CITAS" => Some("Tera Yatırım Menkul Değerler A.Ş."),
                "SARAE" => Some("Tera Yatırım Menkul Değerler A.Ş."),
                "MCARD" => Some("Tera Yatırım Menkul Değerler A.Ş."),
                "LXGYO" => Some("Tera Yatırım Menkul Değerler A.Ş."),
                "ALBTN" => Some("Tera Yatırım Menkul Değerler A.Ş."),
                "QUICK" => Some("İş Yatırım Menkul Değerler A.Ş."),
                "KARCL" => Some("Halk Yatırım Menkul Değerler A.Ş."),
                "MASFN" => Some("Deniz Yatırım Menkul Değerler A.Ş."),
                "METEN" => Some("OYAK Yatırım Menkul Değerler A.Ş."),
                "VEYAS" => Some("Ziraat Yatırım / Halk Yatırım"),
                _ => None,
            };
            if let Some(l) = lead {
                ipo.consortium_lead = Some(l.to_string());
                changed = true;
            }
        }
    }
    changed
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
/// BIST kodu atanmamış (ticker'ı boş) kayıtlar isimle eşleştirilir; kod
/// sonradan atandığında aynı kayıt güncellenir, mükerrer oluşmaz.
pub fn merge_scraped(archive: &mut Vec<PersistedIpo>, scraped: &[ScrapedIpo]) -> bool {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut changed = false;

    for ipo in scraped {
        if ipo.ticker.is_empty() && ipo.name.is_empty() {
            continue;
        }
        let idx = if ipo.ticker.is_empty() {
            archive.iter().position(|p| p.name == ipo.name)
        } else {
            archive
                .iter()
                .position(|p| p.ticker == ipo.ticker)
                .or_else(|| archive.iter().position(|p| p.ticker.is_empty() && p.name == ipo.name))
        };
        if let Some(i) = idx {
            let existing = &mut archive[i];
            // Kodsuz taslak scrape'i, kod atanmış arşiv kaydını geriletmesin
            if ipo.ticker.is_empty() && !existing.ticker.is_empty() {
                existing.last_seen = Some(today.clone());
                changed = true;
                continue;
            }
            if !ipo.ticker.is_empty() {
                existing.ticker = ipo.ticker.clone();
            }
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
            if ipo.fund_usage.is_some() {
                existing.fund_usage = ipo.fund_usage.clone();
            }
            if ipo.share_structure.is_some() {
                existing.share_structure = ipo.share_structure.clone();
            }
            if ipo.ipo_size.is_some() {
                existing.ipo_size = ipo.ipo_size.clone();
            }
            if ipo.katilim_index.is_some() {
                existing.katilim_index = ipo.katilim_index.clone();
            }
            if ipo.lockup_period.is_some() {
                existing.lockup_period = ipo.lockup_period.clone();
            }
            if ipo.consortium_lead.is_some() {
                existing.consortium_lead = ipo.consortium_lead.clone();
            }
            if ipo.t1_t2_available.is_some() {
                existing.t1_t2_available = ipo.t1_t2_available.clone();
            }
            if ipo.distribution_ratios.is_some() {
                existing.distribution_ratios = ipo.distribution_ratios.clone();
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
                fund_usage: ipo.fund_usage.clone(),
                share_structure: ipo.share_structure.clone(),
                ipo_size: ipo.ipo_size.clone(),
                katilim_index: ipo.katilim_index.clone(),
                lockup_period: ipo.lockup_period.clone(),
                consortium_lead: ipo.consortium_lead.clone(),
                t1_t2_available: ipo.t1_t2_available.clone(),
                distribution_ratios: ipo.distribution_ratios.clone(),
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
            fund_usage: None,
            share_structure: None,
            ipo_size: None,
            katilim_index: None,
            lockup_period: None,
            consortium_lead: None,
            t1_t2_available: None,
            distribution_ratios: None,
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
            fund_usage: None,
            share_structure: None,
            ipo_size: None,
            katilim_index: None,
            lockup_period: None,
            consortium_lead: None,
            t1_t2_available: None,
            distribution_ratios: None,
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
    fn merge_matches_codeless_draft_by_name_and_assigns_code_later() {
        let mut archive = Vec::new();
        // İlk scrape: kod atanmamış taslak
        let mut draft = scraped("", 0.0, "TASLAK");
        draft.name = "Albayrak Hazır Beton A.Ş.".into();
        draft.ipo_date = "Hazırlanıyor...".into();
        merge_scraped(&mut archive, &[draft.clone()]);
        assert_eq!(archive.len(), 1);
        assert_eq!(archive[0].ticker, "");

        // Aynı taslak tekrar gelirse mükerrer oluşmamalı
        merge_scraped(&mut archive, &[draft]);
        assert_eq!(archive.len(), 1);

        // Kod atanınca aynı kayıt güncellenmeli
        let mut coded = scraped("ALBHB", 25.0, "AKTİF");
        coded.name = "Albayrak Hazır Beton A.Ş.".into();
        merge_scraped(&mut archive, &[coded]);
        assert_eq!(archive.len(), 1);
        assert_eq!(archive[0].ticker, "ALBHB");
        assert_eq!(archive[0].status, "AKTİF");
    }

    #[test]
    fn codeless_scrape_does_not_downgrade_coded_record() {
        let mut archive = vec![persisted("SAMET", 30.0)];
        archive[0].name = "Samet Kalıp A.Ş.".into();
        let mut draft = scraped("", 0.0, "TASLAK");
        draft.name = "Samet Kalıp A.Ş.".into();
        merge_scraped(&mut archive, &[draft]);
        assert_eq!(archive.len(), 1);
        assert_eq!(archive[0].ticker, "SAMET");
        assert_eq!(archive[0].status, "TAMAMLANDI");
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
