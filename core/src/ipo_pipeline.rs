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
use crate::kap_ipo::{KapIpoDisclosure, KapIpoExtractedData};
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
    crate::spk::fetch_and_parse_latest_approvals(client)
        .await
        .map_err(|e| e.to_string())
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
        // Harf içermeyen unvan bir ayrıştırma kazasıdır (sıra numarası, tire).
        // Arşive sızdığında elle temizlenmesi gerekiyordu; kaynakta durduruluyor.
        if !app.company_name.chars().any(char::is_alphabetic) {
            continue;
        }

        // İsimle fuzzy eşleştir
        let existing = archive.iter().position(|p| {
            fuzzy_company_match(&p.name, &app.company_name)
        });

        if existing.is_none() {
            archive.push(PersistedIpo {
                name: app.company_name.clone(),
                ipo_date: app.application_date.clone(),
                status: "TASLAK".to_string(),
                last_seen: Some(today.clone()),
                data_sources: vec!["SPK".to_string()],
                ..PersistedIpo::default()
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
///
/// SPK bülteni fiyat, lot ve arz büyüklüğü için **en yetkili** kaynaktır:
/// izahname onayı olmadan halka arz yapılamaz. Bu yüzden eşleşen kayıt yoksa
/// kayıt oluşturulur — eşleşme aramakla yetinen eski davranış, halkarz.com'da
/// görünmeyen onaylı arzları sessizce düşürüyordu.
fn merge_spk_approvals(archive: &mut Vec<PersistedIpo>, approvals: &[SpkIpoApproval]) -> bool {
    let mut changed = false;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    for approval in approvals {
        let index = archive
            .iter()
            .position(|p| fuzzy_company_match(&p.name, &approval.company_name));

        let index = match index {
            Some(index) => index,
            None => {
                archive.push(PersistedIpo {
                    name: approval.company_name.clone(),
                    // Bülten tarihi Türkçe yazılır ("05 Ağustos 2026 Çarşamba").
                    // ISO'ya çevrilmezse kayıt takvimde sıralanamayan taslaklarla
                    // birlikte listenin dibine düşer.
                    ipo_date: crate::ipo_scraper::parse_turkish_date(&approval.approval_date),
                    status: SPK_APPROVED_STATUS.to_string(),
                    last_seen: Some(today.clone()),
                    data_sources: vec![SPK_BULLETIN_SOURCE.to_string()],
                    ..PersistedIpo::default()
                });
                changed = true;
                archive.len() - 1
            }
        };

        let entry = &mut archive[index];

        // Taslak kaydın SPK onayı gelmişse aşama ilerlemiştir.
        if entry.status == "TASLAK" {
            entry.status = SPK_APPROVED_STATUS.to_string();
            changed = true;
        }

        if approval.price > 0.0 && entry.price == 0.0 {
            entry.price = approval.price;
            changed = true;
        }

        if approval.ipo_size_tl > 0.0 && entry.ipo_size.is_none() {
            entry.ipo_size = Some(format_ipo_size(approval.ipo_size_tl));
            changed = true;
        }

        // "SPK onaylı" etiketi şart: bültendeki rakam **onaylanan tavandır**,
        // gerçekleşen arz bundan küçük olabilir. Enda Enerji 100.000.000 lotla
        // onaylanıp 91.719.684 lot satmış, Seğmen Kardeşler'in 24.000.000
        // lotluk ortak satışı kimi kaynaklarda hiç sayılmıyor. Etiketsiz sayı,
        // başka sitelerdekiyle çeliştiğinde hangisinin ne olduğu anlaşılmıyor.
        if approval.total_lots > 0.0 && entry.share_structure.is_none() {
            entry.share_structure = Some(format!("{:.0} Lot (SPK onaylı)", approval.total_lots));
            changed = true;
        }

        if let Some(lead) = &approval.consortium_lead {
            if entry.consortium_lead.is_none() {
                entry.consortium_lead = Some(lead.clone());
                changed = true;
            }
        }

        if !approval.bulletin_no.is_empty() && entry.spk_bulletin_no.is_none() {
            entry.spk_bulletin_no = Some(approval.bulletin_no.clone());
            entry.spk_approval_date = Some(approval.approval_date.clone());
            changed = true;
        }

        changed |= add_source(entry, SPK_BULLETIN_SOURCE);
    }

    changed
}

/// SPK onayı almış ama henüz talep toplaması başlamamış halka arzın durumu.
const SPK_APPROVED_STATUS: &str = "SPK ONAYLI";
const SPK_BULLETIN_SOURCE: &str = "SPK_BULLETIN";
const KAP_SOURCE: &str = "KAP";

/// Bir KAP bildiriminin bir halka arza ait sayılabilmesi için kaydın arz
/// tarihine en fazla bu kadar uzak olabileceği gün sayısı.
///
/// İzahname arzdan ~2 ay önce, sonuç bildirimi birkaç gün sonra yayımlanır;
/// altı ay iki yönde de rahat pay bırakır.
const KAP_MATCH_WINDOW_DAYS: i64 = 180;

fn format_ipo_size(size_tl: f64) -> String {
    if size_tl >= 1_000_000_000.0 {
        format!("{size_tl:.0} TL ({:.2} Milyar ₺)", size_tl / 1_000_000_000.0)
    } else {
        format!("{size_tl:.0} TL ({:.0} Milyon ₺)", size_tl / 1_000_000.0)
    }
}

fn add_source(entry: &mut PersistedIpo, source: &str) -> bool {
    if entry.data_sources.iter().any(|s| s == source) {
        return false;
    }
    entry.data_sources.push(source.to_string());
    true
}

/// KAP halka arz bildirimlerini arşive birleştirir.
///
/// Eşleşme yalnız **isim/kod + tarih penceresi** birlikte tuttuğunda kurulur.
/// Bildirim başlıkları halka arza özel değildir: "Tasarruf Sahiplerine Satış
/// Duyurusu" ve "Halka Arz Sonuçları" borsada işlem gören şirketlerin bedelli
/// sermaye artırımlarında da kullanılıyor. Tarih penceresi olmadan, 2018'de
/// halka arz olmuş bir şirketin bugünkü bedelli artırım bildirimi o şirketin
/// halka arz kaydına yapışıyordu.
fn merge_kap_disclosures(archive: &mut [PersistedIpo], disclosures: &[KapIpoDisclosure]) -> bool {
    let mut changed = false;

    for disclosure in disclosures {
        let Some(index) = match_disclosure(archive, disclosure) else {
            continue;
        };
        let entry = &mut archive[index];

        if entry.kap_disclosure_index.is_none() {
            entry.kap_disclosure_index = Some(disclosure.disclosure_index.clone());
            changed = true;
        }

        // Kodu henüz atanmamış bir arzın kodunu KAP bildirimi taşıyabilir.
        if entry.ticker.is_empty() {
            if let Some(ticker) = &disclosure.ticker {
                entry.ticker = ticker.clone();
                changed = true;
            }
        }

        if let Some(data) = &disclosure.extracted_data {
            changed |= merge_extracted(entry, data);
        }

        changed |= add_source(entry, KAP_SOURCE);
    }

    changed
}

/// Bildirimi arşivdeki bir kayda bağlar; bağlanamıyorsa `None`.
fn match_disclosure(archive: &[PersistedIpo], disclosure: &KapIpoDisclosure) -> Option<usize> {
    let candidate = archive
        .iter()
        .position(|p| {
            !p.ticker.is_empty() && Some(&p.ticker) == disclosure.ticker.as_ref()
        })
        .or_else(|| {
            archive
                .iter()
                .position(|p| fuzzy_company_match(&p.name, &disclosure.company_name))
        })?;

    disclosure_belongs_to(&archive[candidate], disclosure).then_some(candidate)
}

/// Bildirim tarihi kaydın halka arz süreciyle örtüşüyor mu?
///
/// Süreci devam eden kayıtlar (taslak, SPK onaylı, talep toplayan) her zaman
/// kabul edilir; tarihi bilinen tamamlanmış arzlarda pencere aranır.
fn disclosure_belongs_to(entry: &PersistedIpo, disclosure: &KapIpoDisclosure) -> bool {
    if matches!(
        entry.status.as_str(),
        "TASLAK" | SPK_APPROVED_STATUS | "TALEP TOPLAMA" | "AKTİF"
    ) {
        return true;
    }

    let (Some(ipo_date), Some(published)) = (
        parse_any_date(&entry.ipo_date),
        parse_any_date(&disclosure.publish_date),
    ) else {
        // Tarihlerden biri okunamıyorsa bağ kurulmaz: yanlış şirkete veri
        // yazmaktansa bildirimi atlamak yeğdir.
        return false;
    };

    (published - ipo_date).num_days().abs() <= KAP_MATCH_WINDOW_DAYS
}

/// ISO (`2026-07-14`) ya da Türkçe (`14.07.2026`, saat ekli olabilir) tarihi
/// çözer; ikisi de tutmuyorsa `None`.
fn parse_any_date(value: &str) -> Option<chrono::NaiveDate> {
    let head = value.split_whitespace().next()?;
    chrono::NaiveDate::parse_from_str(head, "%Y-%m-%d")
        .or_else(|_| chrono::NaiveDate::parse_from_str(head, "%d.%m.%Y"))
        .ok()
}

fn merge_extracted(entry: &mut PersistedIpo, data: &KapIpoExtractedData) -> bool {
    let mut changed = false;

    if let Some(price) = data.price {
        if price > 0.0 && entry.price == 0.0 {
            entry.price = price;
            changed = true;
        }
    }

    let fields: [(&mut Option<String>, &Option<String>); 6] = [
        (&mut entry.book_building_dates, &data.book_building_dates),
        (&mut entry.trading_start_date, &data.trading_start_date),
        (&mut entry.consortium_lead, &data.consortium_lead),
        (&mut entry.participant_count, &data.participant_count),
        (&mut entry.distribution_ratios, &data.distribution_ratios),
        (&mut entry.fund_usage, &data.fund_usage),
    ];
    for (target, source) in fields {
        if target.is_none() && source.is_some() {
            *target = source.clone();
            changed = true;
        }
    }

    if entry.katilim_index.is_none() && data.katilim_index.is_some() {
        entry.katilim_index = data.katilim_index.clone();
        changed = true;
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

/// Sıralama önemli: `to_lowercase` önce çalışırsa 'İ' iki koda ayrışır
/// ("i" + birleşen nokta) ve kaynaklar arasında eşleşme kaçar.
fn normalize_company(name: &str) -> String {
    crate::spk::normalize_turkish(name)
        .to_lowercase()
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

    fn approval(name: &str, price: f64) -> SpkIpoApproval {
        SpkIpoApproval {
            company_name: name.to_string(),
            ticker: None,
            capital_increase_lots: 30_000_000.0,
            share_sale_lots: 6_500_000.0,
            extra_sale_lots: 0.0,
            total_lots: 36_500_000.0,
            price,
            ipo_size_tl: 36_500_000.0 * price,
            consortium_lead: None,
            bulletin_no: "2026/49".to_string(),
            approval_date: "05 Ağustos 2026 Çarşamba".to_string(),
        }
    }

    fn disclosure(company: &str, published: &str) -> KapIpoDisclosure {
        KapIpoDisclosure {
            company_name: company.to_string(),
            ticker: None,
            disclosure_type: crate::kap_ipo::KapIpoDisclosureType::SaleNotice,
            publish_date: published.to_string(),
            disclosure_index: "1645150".to_string(),
            url: "https://www.kap.org.tr/tr/Bildirim/1645150".to_string(),
            extracted_data: None,
        }
    }

    /// SPK onayı halka arzın kesinleştiğini gösterir; arşivde karşılığı yoksa
    /// kayıt oluşturulmalı. Eşleşme aramakla yetinen eski davranış, yalnız
    /// halkarz.com'un gördüğü arzları kaydediyordu.
    #[test]
    fn spk_approvals_create_missing_records() {
        let mut archive = Vec::new();
        assert!(merge_spk_approvals(
            &mut archive,
            &[approval("Kapeks Kimya Sanayi AŞ", 94.0)]
        ));
        assert_eq!(archive.len(), 1);
        assert_eq!(archive[0].name, "Kapeks Kimya Sanayi AŞ");
        assert_eq!(archive[0].status, SPK_APPROVED_STATUS);
        assert_eq!(archive[0].price, 94.0);
        assert_eq!(archive[0].spk_bulletin_no.as_deref(), Some("2026/49"));
        // Onaylanan tavan, gerçekleşen arzdan ayırt edilebilmeli.
        assert_eq!(
            archive[0].share_structure.as_deref(),
            Some("36500000 Lot (SPK onaylı)")
        );
        // Türkçe bülten tarihi ISO'ya çevrilmeli; yoksa takvimde sıralanamaz.
        assert_eq!(archive[0].ipo_date, "2026-08-05");
    }

    /// Aynı şirket farklı yazımlarla geldiğinde mükerrer kayıt oluşmamalı.
    #[test]
    fn spk_approvals_update_matching_draft() {
        let mut archive = vec![PersistedIpo {
            name: "Savur Gayrimenkul Yatırım Ortaklığı A.Ş.".to_string(),
            status: "TASLAK".to_string(),
            ..PersistedIpo::default()
        }];
        merge_spk_approvals(&mut archive, &[approval("Savur GYO", 3.64)]);
        assert_eq!(archive.len(), 1);
        assert_eq!(archive[0].status, SPK_APPROVED_STATUS);
        assert_eq!(archive[0].price, 3.64);
    }

    /// Regresyon: "Tasarruf Sahiplerine Satış Duyurusu" bedelli sermaye
    /// artırımlarında da kullanılıyor. Tarih penceresi olmadan, yıllar önce
    /// halka arz olmuş bir şirketin bugünkü artırım bildirimi o şirketin
    /// halka arz kaydına yapışıyordu.
    #[test]
    fn kap_disclosure_outside_the_window_is_ignored() {
        let mut archive = vec![PersistedIpo {
            name: "Hektaş Ticaret T.A.Ş.".to_string(),
            ticker: "HEKTS".to_string(),
            ipo_date: "2018-03-15".to_string(),
            status: "TAMAMLANDI".to_string(),
            ..PersistedIpo::default()
        }];
        let changed = merge_kap_disclosures(
            &mut archive,
            &[disclosure("Hektaş Ticaret T.A.Ş.", "14.07.2026 11:58:43")],
        );
        assert!(!changed);
        assert!(archive[0].kap_disclosure_index.is_none());
    }

    #[test]
    fn kap_disclosure_inside_the_window_attaches() {
        let mut archive = vec![PersistedIpo {
            name: "Kapeks Kimya Sanayi AŞ".to_string(),
            ipo_date: "2026-08-20".to_string(),
            status: "TAMAMLANDI".to_string(),
            ..PersistedIpo::default()
        }];
        assert!(merge_kap_disclosures(
            &mut archive,
            &[disclosure("Kapeks Kimya Sanayi AŞ", "14.07.2026 11:58:43")]
        ));
        assert_eq!(archive[0].kap_disclosure_index.as_deref(), Some("1645150"));
        assert!(archive[0].data_sources.iter().any(|s| s == "KAP"));
    }

    /// Süreci devam eden kayıtlarda tarih henüz belli olmayabilir; bildirim
    /// yine de bağlanmalı.
    #[test]
    fn kap_disclosure_attaches_to_pending_record() {
        let mut archive = vec![PersistedIpo {
            name: "Kapeks Kimya Sanayi AŞ".to_string(),
            ipo_date: "Hazırlanıyor...".to_string(),
            status: SPK_APPROVED_STATUS.to_string(),
            ..PersistedIpo::default()
        }];
        assert!(merge_kap_disclosures(
            &mut archive,
            &[disclosure("Kapeks Kimya Sanayi AŞ", "14.07.2026 11:58:43")]
        ));
    }

    #[test]
    fn dates_parse_in_both_shapes() {
        assert!(parse_any_date("2026-07-14").is_some());
        assert!(parse_any_date("14.07.2026 11:58:43").is_some());
        assert!(parse_any_date("Hazırlanıyor...").is_none());
    }

    /// Uçtan uca: dört kaynağı da çeker, arşive işler ve özet basar.
    /// Kaynakların sözleşmesi bozulduğunda (gövde biçimi, alan adı, sayfa
    /// düzeni) burada görünür — birim testleri sabit fixture'larla çalışır.
    #[tokio::test]
    #[ignore = "canlı ağ erişimi gerektirir ve ~/.fraude_ipos.json dosyasını günceller"]
    async fn live_pipeline_refreshes_archive() {
        let client = crate::http_client();
        let result = run_full_pipeline(&client).await;

        println!("SPK başvuru      : {}", result.spk_applications.len());
        println!("SPK bülten onayı : {}", result.spk_approvals.len());
        println!("KAP bildirimi    : {}", result.kap_disclosures.len());
        println!("halkarz.com      : {}", result.scraper_ipos.len());
        println!("hatalar          : {:?}", result.errors);

        assert!(
            !result.spk_applications.is_empty(),
            "SPK başvuru listesi boş döndü"
        );
        assert!(
            !result.kap_disclosures.is_empty(),
            "KAP halka arz bildirimi boş döndü"
        );

        let before = crate::ipo_store::load();
        let mut archive = before.clone();
        merge_pipeline_into_archive(&mut archive, &result);
        println!("arşiv            : {} → {}", before.len(), archive.len());

        for ipo in &archive {
            assert!(
                ipo.name.chars().any(char::is_alphabetic),
                "unvansız kayıt: {ipo:?}"
            );
            assert!(ipo.price < 100_000.0, "olanaksız fiyat: {ipo:?}");
        }
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

    /// Regresyon: sıra numarası unvan sanıldığında arşive sahte kayıt düşüyordu.
    #[test]
    fn spk_applications_reject_nameless_rows() {
        let mut archive = Vec::new();
        let apps = vec![SpkApplication {
            company_name: "17".to_string(),
            application_date: "15.03.2026".to_string(),
            status: "SPK_APPLICATION".to_string(),
            source: "SPK".to_string(),
        }];
        assert!(!merge_spk_applications(&mut archive, &apps));
        assert!(archive.is_empty());
    }

    #[test]
    fn spk_applications_do_not_duplicate() {
        let mut archive = vec![PersistedIpo {
            ticker: String::new(),
            name: "Test Şirketi A.Ş.".to_string(),
            ipo_date: "15.03.2026".to_string(),
            price: 0.0,
            status: "TASLAK".to_string(),
            data_sources: vec!["SPK".to_string()],
            ..Default::default()
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
