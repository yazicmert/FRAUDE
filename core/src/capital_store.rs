//! SPK bültenlerinden çıkarılan bedelli/bedelsiz sermaye artırımı arşivi.
//!
//! Bu arşiv Yahoo'nun split akışının yerini alır. İki nedenle:
//!
//! * Yahoo akışı **bedelliyi hiç taşımaz** — rüçhan haklı artırımlar orada
//!   yok, dolayısıyla sulanma hesaba girmiyordu.
//! * Bedelsizde de bozulabiliyor: KTLEV'de üç kayıt çarpılınca ×937,9
//!   çıkıyor ve arz getirisi %304.256 görünüyordu. SPK tablosu aynı artırımı
//!   `2.070.000.000 → 7.000.000.000`, yani ×3,3816 olarak veriyor.
//!
//! Bülten PDF'leri bir kez indirilip ayrıştırılır; işlenen bültenlerin
//! adresleri arşivde tutulduğu için tekrar çalıştırmada yalnız yeni bültenler
//! çekilir.

use crate::spk::SpkCapitalIncrease;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Bir sermaye artırımı kaydı ve bağlandığı BIST kodu.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct StoredCapitalIncrease {
    /// Unvandan çözülemediyse `None`; kod uydurulmaz.
    pub ticker: Option<String>,
    #[serde(flatten)]
    pub increase: SpkCapitalIncrease,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct CapitalArchive {
    pub records: Vec<StoredCapitalIncrease>,
    /// Ayrıştırılmış bülten adresleri — aynı PDF ikinci kez indirilmez.
    #[serde(default)]
    pub processed_bulletins: HashSet<String>,
    #[serde(default)]
    pub last_updated: Option<String>,
}

fn archive_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join(".fraude_capital_increases.json"))
}

pub fn load() -> CapitalArchive {
    archive_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(archive: &CapitalArchive) {
    let Some(path) = archive_path() else { return };
    if let Ok(json) = serde_json::to_string(archive) {
        let _ = std::fs::write(&path, json);
    }
}

/// Bir bültenden çıkan kayıtları arşive işler.
///
/// Aynı bülten iki kez işlenirse kayıt çoğalmaz: tekillik anahtarı
/// `(bülten no, unvan)`.
pub fn merge(archive: &mut CapitalArchive, increases: Vec<SpkCapitalIncrease>) -> usize {
    let mut added = 0;
    for increase in increases {
        // Tarih, artırımın arzdan önce mi sonra mı olduğunun tek ölçütü;
        // çözülemeyen tarih kaydı arşive girmemeli.
        if !crate::ipo_store::looks_like_iso_date(&increase.approval_date) {
            continue;
        }
        let duplicate = archive.records.iter().any(|r| {
            r.increase.bulletin_no == increase.bulletin_no
                && r.increase.company_name == increase.company_name
        });
        if duplicate {
            continue;
        }
        archive.records.push(StoredCapitalIncrease {
            ticker: crate::company_match::bist_ticker_for(&increase.company_name)
                .map(str::to_string),
            increase,
        });
        added += 1;
    }
    added
}

/// Bir hissenin verilen tarihten **sonraki** bedelsiz artırımlarının kümülatif
/// çarpanı: arz gününde alınan 1 pay bugün kaç paya dönüştü.
///
/// Bedelli artırımlar bilerek dışarıda bırakılır. Bedelli bir bölünme değildir:
/// ortak yeni payları bedelini ödeyerek alır, pay adedi artarken karşılığında
/// nakit çıkar. Bedelsiz gibi çarpan uygulamak getiriyi olduğundan yüksek
/// gösterirdi.
pub fn bonus_factor_since(archive: &CapitalArchive, ticker: &str, after_date: &str) -> f64 {
    let factor: f64 = archive
        .records
        .iter()
        .filter(|r| r.ticker.as_deref() == Some(ticker))
        .filter(|r| r.increase.approval_date.as_str() > after_date)
        .filter(|r| r.increase.is_bonus())
        .map(|r| r.increase.bonus_factor())
        .product();

    if !factor.is_finite() || factor < 1.0 {
        return 1.0;
    }
    factor
}

/// Bir hissenin bütün artırımları, tarihe göre yeniden eskiye.
pub fn increases_for(archive: &CapitalArchive, ticker: &str) -> Vec<StoredCapitalIncrease> {
    let mut rows: Vec<StoredCapitalIncrease> = archive
        .records
        .iter()
        .filter(|r| r.ticker.as_deref() == Some(ticker))
        .cloned()
        .collect();
    rows.sort_by(|a, b| b.increase.approval_date.cmp(&a.increase.approval_date));
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    fn increase(company: &str, date: &str, existing: f64, bonus: f64, rights: f64) -> SpkCapitalIncrease {
        SpkCapitalIncrease {
            company_name: company.into(),
            existing_capital: existing,
            new_capital: existing + bonus + rights,
            rights_amount: rights,
            bonus_internal: bonus,
            bonus_profit: 0.0,
            sale_type: None,
            bulletin_no: format!("test/{date}"),
            approval_date: date.into(),
        }
    }

    #[test]
    fn merge_resolves_tickers_and_skips_duplicates() {
        let mut archive = CapitalArchive::default();
        let row = increase("Katılımevim Tasarruf Finansman AŞ", "2026-08-01", 2_070_000_000.0, 4_930_000_000.0, 0.0);

        assert_eq!(merge(&mut archive, vec![row.clone()]), 1);
        assert_eq!(archive.records[0].ticker.as_deref(), Some("KTLEV"));

        // Aynı bülten tekrar işlenirse kayıt çoğalmaz
        assert_eq!(merge(&mut archive, vec![row]), 0);
        assert_eq!(archive.records.len(), 1);
    }

    /// Bozuk tarihli kayıt arşive girmemeli: "arz sonrası mı" kıyası tarih
    /// üzerinden yapılıyor, çözülemeyen tarih çarpanı sessizce kaydırır.
    #[test]
    fn records_with_an_unparsable_date_are_rejected() {
        let mut archive = CapitalArchive::default();
        let mut row = increase("Europen Endüstri İnşaat Sanayi ve Ticaret AŞ", "2022-12-07", 168_780_000.0, 591_220_000.0, 0.0);
        row.approval_date = "2026-03-2022".into();

        assert_eq!(merge(&mut archive, vec![row]), 0);
        assert!(archive.records.is_empty());
    }

    #[test]
    fn unmatched_company_is_stored_without_a_ticker() {
        let mut archive = CapitalArchive::default();
        merge(&mut archive, vec![increase("Hiç Olmayan Şirket AŞ", "2026-01-01", 100.0, 100.0, 0.0)]);
        assert_eq!(archive.records[0].ticker, None);
    }

    #[test]
    fn bonus_factors_compound_only_after_the_given_date() {
        let mut archive = CapitalArchive::default();
        merge(&mut archive, vec![
            // Arzdan önce — sayılmamalı
            increase("Katılımevim Tasarruf Finansman AŞ", "2023-01-01", 100.0, 100.0, 0.0),
            // Arzdan sonra iki bedelsiz: ×2 ve ×3 → ×6
            increase("Katılımevim Tasarruf Finansman AŞ", "2024-01-01", 100.0, 100.0, 0.0),
            increase("Katılımevim Tasarruf Finansman AŞ", "2025-01-01", 100.0, 200.0, 0.0),
        ]);

        assert_eq!(bonus_factor_since(&archive, "KTLEV", "2023-06-12"), 6.0);
        assert_eq!(bonus_factor_since(&archive, "KTLEV", "2026-01-01"), 1.0);
    }

    /// Bedelli sulandırır ama bölünme değildir; çarpana girmemeli.
    #[test]
    fn rights_issues_are_excluded_from_the_factor() {
        let mut archive = CapitalArchive::default();
        merge(&mut archive, vec![
            increase("CVK Maden İşletmeleri Sanayi ve Ticaret AŞ", "2026-01-01", 1_400_000_000.0, 0.0, 2_380_000_000.0),
        ]);
        assert_eq!(bonus_factor_since(&archive, "CVKMD", "2023-01-01"), 1.0);
    }

    #[test]
    fn unknown_ticker_has_no_factor() {
        let archive = CapitalArchive::default();
        assert_eq!(bonus_factor_since(&archive, "YOKKK", "2020-01-01"), 1.0);
    }
}
