//! Çok kaynaklı halka arz veri pipeline'ı.
//!
//! Kaynaklar öncelik sırasıyla:
//! 1. SPK Başvuru Listesi → TASLAK adaylar
//! 2. SPK Haftalık Bültenleri → Onaylı halka arzlar (fiyat, lot, büyüklük)
//! 3. KAP Bildirimleri → İzahname detayları, sonuç bildirimleri
//! 4. halkarz.com (mevcut scraper) → Ek detaylar, fallback
//!
//! Her kaynak bağımsız çalışır; biri başarısız olursa diğerleri devam eder.

use crate::ipo_store::PersistedIpo;
use crate::kap_ipo::KapIpoDisclosure;
use crate::spk::{SpkApplication, SpkIpoApproval};
use crate::ipo_scraper::ScrapedIpo;
use reqwest::Client;

/// Pipeline çalıştırma sonucu.
pub struct PipelineResult {
    pub spk_applications: Vec<SpkApplication>,
    pub spk_approvals: Vec<SpkIpoApproval>,
    pub kap_disclosures: Vec<KapIpoDisclosure>,
    pub scraper_ipos: Vec<ScrapedIpo>,
    pub errors: Vec<String>,
}

/// Ana pipeline fonksiyonu: tüm kaynakları paralel çeker.
///
/// Kaynaklar bağımsız çalışır; biri başarısız olursa diğerleri etkilenmez.
/// Hatalar `errors` listesinde toplanır.
pub async fn run_full_pipeline(client: &Client) -> PipelineResult {
    let (spk_apps, spk_approvals, kap_disclosures, scraper) = tokio::join!(
        fetch_spk_applications_safe(client),
        fetch_spk_approvals_safe(client),
        fetch_kap_ipo_safe(client),
        fetch_scraper_safe(client),
    );

    let mut errors = Vec::new();

    let spk_applications = match spk_apps {
        Ok(apps) => apps,
        Err(e) => {
            errors.push(format!("SPK başvuru: {e}"));
            Vec::new()
        }
    };

    let spk_approvals = match spk_approvals {
        Ok(approvals) => approvals,
        Err(e) => {
            errors.push(format!("SPK bülten: {e}"));
            Vec::new()
        }
    };

    let kap_disclosures = match kap_disclosures {
        Ok(d) => d,
        Err(e) => {
            errors.push(format!("KAP bildirim: {e}"));
            Vec::new()
        }
    };

    let scraper_ipos = match scraper {
        Ok(ipos) => ipos,
        Err(e) => {
            errors.push(format!("halkarz.com: {e}"));
            Vec::new()
        }
    };

    PipelineResult {
        spk_applications,
        spk_approvals,
        kap_disclosures,
        scraper_ipos,
        errors,
    }
}

// ---------- Kaynak çekicileri (her biri izole hata yakalar) ----------

async fn fetch_spk_applications_safe(
    client: &Client,
) -> Result<Vec<SpkApplication>, String> {
    crate::spk::fetch_spk_applications(client)
        .await
        .map_err(|e| e.to_string())
}

async fn fetch_spk_approvals_safe(
    client: &Client,
) -> Result<Vec<SpkIpoApproval>, String> {
    // Aşama 2'de SPK bülten PDF parsing eklenecek.
    // Şimdilik boş döner — yapı hazır, içerik sonra dolar.
    let _ = client;
    Ok(Vec::new())
}

async fn fetch_kap_ipo_safe(
    client: &Client,
) -> Result<Vec<KapIpoDisclosure>, String> {
    crate::kap_ipo::fetch_ipo_disclosures(client, 90)
        .await
        .map_err(|e| e.to_string())
}

async fn fetch_scraper_safe(
    client: &Client,
) -> Result<Vec<ScrapedIpo>, String> {
    crate::ipo_scraper::scrape_recent_ipos(client)
        .await
        .map_err(|e| e.to_string())
}

// ---------- Birleştirme ----------

/// Pipeline sonuçlarını mevcut arşive birleştirir.
///
/// Öncelik sırası: SPK onayları > KAP bildirimleri > halkarz.com scraper.
/// Resmi kaynak (SPK/KAP) verileri scraper verilerini ezer.
pub fn merge_pipeline_into_archive(
    archive: &mut Vec<PersistedIpo>,
    result: &PipelineResult,
) -> bool {
    let mut changed = false;

    // 1. SPK başvurularını TASLAK olarak ekle
    changed |= merge_spk_applications(archive, &result.spk_applications);

    // 2. SPK onaylarını birleştir (fiyat, lot, büyüklük)
    changed |= merge_spk_approvals(archive, &result.spk_approvals);

    // 3. KAP bildirimlerini birleştir
    changed |= merge_kap_disclosures(archive, &result.kap_disclosures);

    // 4. halkarz.com scraper (mevcut merge_scraped mantığı)
    if !result.scraper_ipos.is_empty() {
        changed |= crate::ipo_store::merge_scraped(archive, &result.scraper_ipos);
    }

    changed
}

/// SPK başvuru listesindeki şirketleri TASLAK olarak arşive ekler.
/// Zaten mevcut olan (isimle eşleşen) kayıtlar atlanır.
fn merge_spk_applications(
    archive: &mut Vec<PersistedIpo>,
    applications: &[SpkApplication],
) -> bool {
    let mut changed = false;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    for app in applications {
        if app.company_name.is_empty() {
            continue;
        }

        // İsimle fuzzy eşleştir
        let existing = archive.iter().position(|p| {
            fuzzy_company_match(&p.name, &app.company_name)
        });

        if existing.is_none() {
            archive.push(PersistedIpo {
                ticker: String::new(),
                name: app.company_name.clone(),
                ipo_date: app.application_date.clone(),
                price: 0.0,
                status: "TASLAK".to_string(),
                book_building_dates: None,
                trading_start_date: None,
                distribution_type: None,
                participant_count: None,
                last_seen: Some(today.clone()),
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
                data_sources: vec!["SPK".to_string()],
                spk_bulletin_no: None,
                spk_approval_date: None,
                kap_disclosure_index: None,
            });
            changed = true;
        } else if let Some(idx) = existing {
            let entry = &mut archive[idx];
            if !entry.data_sources.contains(&"SPK".to_string()) {
                entry.data_sources.push("SPK".to_string());
                changed = true;
            }
        }
    }

    changed
}

/// SPK onaylı halka arzları arşive birleştirir.
/// Fiyat, lot sayısı, arz büyüklüğü gibi veriler SPK bülteninden gelir.
fn merge_spk_approvals(
    archive: &mut Vec<PersistedIpo>,
    approvals: &[SpkIpoApproval],
) -> bool {
    let mut changed = false;

    for approval in approvals {
        let idx = archive.iter().position(|p| {
            fuzzy_company_match(&p.name, &approval.company_name)
        });

        if let Some(i) = idx {
            let entry = &mut archive[i];

            if approval.price > 0.0 && entry.price == 0.0 {
                entry.price = approval.price;
                changed = true;
            }

            if approval.ipo_size_tl > 0.0 && entry.ipo_size.is_none() {
                let size = if approval.ipo_size_tl >= 1_000_000_000.0 {
                    format!("{:.0} TL ({:.2} Milyar ₺)", approval.ipo_size_tl, approval.ipo_size_tl / 1_000_000_000.0)
                } else {
                    format!("{:.0} TL ({:.0} Milyon ₺)", approval.ipo_size_tl, approval.ipo_size_tl / 1_000_000.0)
                };
                entry.ipo_size = Some(size);
                changed = true;
            }

            if approval.total_lots > 0.0 && entry.share_structure.is_none() {
                entry.share_structure = Some(format!("{:.0} Lot", approval.total_lots));
                changed = true;
            }

            if let Some(ref lead) = approval.consortium_lead {
                if entry.consortium_lead.is_none() {
                    entry.consortium_lead = Some(lead.clone());
                    changed = true;
                }
            }

            if !approval.bulletin_no.is_empty() {
                entry.spk_bulletin_no = Some(approval.bulletin_no.clone());
                entry.spk_approval_date = Some(approval.approval_date.clone());
                changed = true;
            }

            if !entry.data_sources.contains(&"SPK_BULLETIN".to_string()) {
                entry.data_sources.push("SPK_BULLETIN".to_string());
                changed = true;
            }
        }
    }

    changed
}

/// KAP halka arz bildirimlerini arşive birleştirir.
fn merge_kap_disclosures(
    archive: &mut Vec<PersistedIpo>,
    disclosures: &[KapIpoDisclosure],
) -> bool {
    let mut changed = false;

    for disclosure in disclosures {
        // Ticker veya şirket adı ile eşleştir
        let idx = if let Some(ref ticker) = disclosure.ticker {
            archive.iter().position(|p| p.ticker == *ticker)
                .or_else(|| archive.iter().position(|p| fuzzy_company_match(&p.name, &disclosure.company_name)))
        } else {
            archive.iter().position(|p| fuzzy_company_match(&p.name, &disclosure.company_name))
        };

        if let Some(i) = idx {
            let entry = &mut archive[i];

            // KAP disclosure index kaydet
            if entry.kap_disclosure_index.is_none() {
                entry.kap_disclosure_index = Some(disclosure.disclosure_index.clone());
                changed = true;
            }

            // Extracted data varsa birleştir
            if let Some(ref data) = disclosure.extracted_data {
                if let Some(price) = data.price {
                    if price > 0.0 && entry.price == 0.0 {
                        entry.price = price;
                        changed = true;
                    }
                }
                if data.book_building_dates.is_some() && entry.book_building_dates.is_none() {
                    entry.book_building_dates = data.book_building_dates.clone();
                    changed = true;
                }
                if data.trading_start_date.is_some() && entry.trading_start_date.is_none() {
                    entry.trading_start_date = data.trading_start_date.clone();
                    changed = true;
                }
                if data.consortium_lead.is_some() && entry.consortium_lead.is_none() {
                    entry.consortium_lead = data.consortium_lead.clone();
                    changed = true;
                }
                if data.participant_count.is_some() && entry.participant_count.is_none() {
                    entry.participant_count = data.participant_count.clone();
                    changed = true;
                }
                if data.distribution_ratios.is_some() && entry.distribution_ratios.is_none() {
                    entry.distribution_ratios = data.distribution_ratios.clone();
                    changed = true;
                }
                if data.fund_usage.is_some() && entry.fund_usage.is_none() {
                    entry.fund_usage = data.fund_usage.clone();
                    changed = true;
                }
                if data.katilim_index.is_some() && entry.katilim_index.is_none() {
                    entry.katilim_index = data.katilim_index.clone();
                    changed = true;
                }
            }

            if !entry.data_sources.contains(&"KAP".to_string()) {
                entry.data_sources.push("KAP".to_string());
                changed = true;
            }
        }
    }

    changed
}

// ---------- Yardımcılar ----------

/// Şirket adı fuzzy eşleştirme.
///
/// Türkçe karakter normalize, A.Ş. / AŞ kaldırma, büyük/küçük harf
/// duyarsız karşılaştırma.
fn fuzzy_company_match(a: &str, b: &str) -> bool {
    normalize_company(a) == normalize_company(b)
}

fn normalize_company(name: &str) -> String {
    let lower = name.to_lowercase();
    let normalized = crate::spk::normalize_turkish(&lower);
    normalized
        .replace("a.s.", "")
        .replace("a.s", "")
        .replace(" as", "")
        .replace("anonim sirketi", "")
        .replace("gayrimenkul yatirim ortakligi", "gyo")
        .replace("menkul degerler", "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fuzzy_match_with_suffix_differences() {
        assert!(fuzzy_company_match(
            "Savur Gayrimenkul Yatırım Ortaklığı A.Ş.",
            "Savur GYO"
        ));
    }

    #[test]
    fn fuzzy_match_exact() {
        assert!(fuzzy_company_match("Orzaks İlaç", "Orzaks İlaç"));
    }

    #[test]
    fn no_match_different_companies() {
        assert!(!fuzzy_company_match("Savur GYO", "Orzaks İlaç"));
    }

    #[test]
    fn spk_applications_create_drafts() {
        let mut archive = Vec::new();
        let apps = vec![SpkApplication {
            company_name: "Test Şirketi A.Ş.".to_string(),
            application_date: "15.03.2026".to_string(),
            status: "SPK_APPLICATION".to_string(),
            source: "SPK".to_string(),
        }];
        let changed = merge_spk_applications(&mut archive, &apps);
        assert!(changed);
        assert_eq!(archive.len(), 1);
        assert_eq!(archive[0].status, "TASLAK");
        assert!(archive[0].data_sources.contains(&"SPK".to_string()));
    }

    #[test]
    fn spk_applications_do_not_duplicate() {
        let mut archive = vec![PersistedIpo {
            ticker: String::new(),
            name: "Test Şirketi A.Ş.".to_string(),
            ipo_date: "15.03.2026".to_string(),
            price: 0.0,
            status: "TASLAK".to_string(),
            book_building_dates: None,
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
            data_sources: vec!["SPK".to_string()],
            spk_bulletin_no: None,
            spk_approval_date: None,
            kap_disclosure_index: None,
        }];
        let apps = vec![SpkApplication {
            company_name: "Test Şirketi A.Ş.".to_string(),
            application_date: "15.03.2026".to_string(),
            status: "SPK_APPLICATION".to_string(),
            source: "SPK".to_string(),
        }];
        let changed = merge_spk_applications(&mut archive, &apps);
        assert!(!changed); // Already has SPK source
        assert_eq!(archive.len(), 1);
    }
}
