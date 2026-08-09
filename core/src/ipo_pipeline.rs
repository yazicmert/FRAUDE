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
    /// KAP taramasının **ham** sonucu.
    ///
    /// `kap_disclosures` sadeleştirilmiş görünüm; izleme turu (`ipo_follow`)
    /// ham satırdaki kod alanlarına ihtiyaç duyuyor ve aynı taramayı ikinci
    /// kez yapmak her yenilemede uçtan onlarca sayfa daha istemek olurdu.
    pub kap_scan: crate::kap_ipo::IpoScan,
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

    let kap_scan = kap_disclosures;
    if !kap_scan.complete {
        errors.push("KAP bildirim: bazı pencereler alınamadı".to_string());
    }
    let kap_disclosures = kap_scan
        .rows
        .iter()
        .filter_map(crate::kap_ipo::to_ipo_disclosure)
        .collect();

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
        kap_scan,
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
    crate::spk::fetch_all_approvals(client)
        .await
        .map_err(|e| e.to_string())
}

/// Taranacak pencere `ipo_follow`'un ilerlemesine göre daralır; geçmişi bir
/// kez kurduktan sonra her tur yalnız araya giren günleri sorar.
async fn fetch_kap_ipo_safe(client: &Client) -> crate::kap_ipo::IpoScan {
    let days = crate::ipo_follow::scan_days(crate::kap::istanbul_today());
    crate::kap_ipo::fetch_ipo_rows(client, days).await
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
///
/// **Sıra, önceliğin kendisidir.** `merge_scraped` alanları koşulsuz ezer;
/// resmî kaynaklardan sonra çalıştırıldığında SPK'nın fiyatını, KAP'ın
/// katılımcı sayısını ve ilk işlem tarihini her yenilemede halkarz.com'un
/// değeriyle değiştiriyordu — yani resmî veri yazılıyor ama saniyeler içinde
/// üzerine yazılıyordu. Yalnız halkarz.com'un tek kaynak olduğu alanlar
/// (endeks üyeliği gibi) hayatta kalabiliyordu, o da tesadüfen.
///
/// Bu yüzden scraper **önce** çalışır ve tabanı kurar; resmî kaynaklar
/// üstüne yazar.
pub fn merge_pipeline_into_archive(
    archive: &mut Vec<PersistedIpo>,
    result: &PipelineResult,
) -> bool {
    let mut changed = false;

    // 1. SPK başvurularını TASLAK olarak ekle (yalnız kayıt açar, alan yazmaz)
    changed |= merge_spk_applications(archive, &result.spk_applications);

    // 2. halkarz.com scraper: geniş ama gayriresmî taban
    if !result.scraper_ipos.is_empty() {
        changed |= crate::ipo_store::merge_scraped(archive, &result.scraper_ipos);
    }

    // 3. SPK onayları taban üzerine yazar (fiyat, aralık, konsorsiyum, bülten)
    changed |= merge_spk_approvals(archive, &result.spk_approvals);

    // 4. KAP bildirimleri en son söz sahibi; gövdeleri `ipo_follow` okur
    changed |= merge_kap_disclosures(archive, &result.kap_disclosures);

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
        // Kod varsa önce onunla eşleşilir: unvan yazımları kaynaklar arasında
        // değişiyor, kod değişmiyor.
        let index = approval
            .ticker
            .as_ref()
            .and_then(|ticker| {
                archive
                    .iter()
                    .position(|p| !p.ticker.is_empty() && &p.ticker == ticker)
            })
            .or_else(|| {
                archive
                    .iter()
                    .position(|p| fuzzy_company_match(&p.name, &approval.company_name))
            });

        let index = match index {
            Some(index) => index,
            None => {
                // Eşleşmeyen **eski** onay kayıt doğurmaz. Arşiv 2021'den
                // beri kazınıyor, SPK arşivi 2017'ye iniyor: eşleşmeyen eski
                // bir onay ya kapsam dışı kalmış ya da hiç gerçekleşmemiş bir
                // arzdır. Kayıt açmak, listeye yıllardır "SPK ONAYLI" bekleyen
                // hayalet arzlar eklerdi.
                if !is_recent_approval(&approval.approval_date, &today) {
                    continue;
                }
                archive.push(PersistedIpo {
                    ticker: approval.ticker.clone().unwrap_or_default(),
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

        // Şirket listelendikten sonra kodu belirir; unvanla eşleşen kodsuz
        // kayda yazılır.
        if entry.ticker.is_empty() {
            if let Some(ticker) = &approval.ticker {
                entry.ticker = ticker.clone();
                changed = true;
            }
        }

        // Fiyat **ezilir**: izahname onayı olmadan halka arz yapılamaz, yani
        // sabit fiyatlı arzda bültendeki rakam fiyatın kendisidir. Yalnız boş
        // alanı doldurmak, halkarz.com'un yuvarlanmış ya da eski değerini
        // resmî rakamın önünde tutuyordu.
        if approval.price > 0.0 && entry.price != approval.price {
            entry.price = approval.price;
            changed = true;
        }

        // Talep toplamalı arzlarda SPK sabit fiyat değil taban-tavan aralığı
        // onaylar; kesin fiyat sonra açıklanır. Aralık, fiyatın yerini almaz —
        // yanında durur ve "fiyat henüz belli değil"i görünür kılar.
        if let Some(range) = &approval.price_range {
            if entry.price_range.as_ref() != Some(range) {
                entry.price_range = Some(range.clone());
                changed = true;
            }
        }

        // Büyüklük ve lot **ezilmez**: bültendeki rakam onaylanan tavandır,
        // gerçekleşen arz bundan küçük olabilir. Enda Enerji 100.000.000 lotla
        // onaylanıp 91.719.684 lot satmış. Tamamlanmış bir arzda gerçekleşen
        // rakam tavandan daha doğrudur; tavan yalnız boşluğu doldurur.
        if approval.ipo_size_tl > 0.0 && entry.ipo_size.is_none() {
            entry.ipo_size = Some(format_ipo_size(approval.ipo_size_tl));
            changed = true;
        }

        // "SPK onaylı" etiketi şart: etiketsiz sayı, başka sitelerdekiyle
        // çeliştiğinde hangisinin ne olduğu anlaşılmıyor.
        if approval.total_lots > 0.0 && entry.share_structure.is_none() {
            entry.share_structure = Some(format!("{:.0} Lot (SPK onaylı)", approval.total_lots));
            changed = true;
        }

        // Konsorsiyum liderini bülten resmî olarak yazıyor; halkarz.com'un
        // listesi daha geniş olabildiği için yalnız **boşsa** yazılır.
        if let Some(lead) = &approval.consortium_lead {
            if entry.consortium_lead.is_none() {
                entry.consortium_lead = Some(lead.clone());
                changed = true;
            }
        }

        // Bülten numarası ve onay tarihi yalnız SPK'dan gelir; kaydın hangi
        // bültene dayandığı değişirse (yeniden onay) güncel olan yazılır.
        if !approval.bulletin_no.is_empty()
            && entry.spk_bulletin_no.as_deref() != Some(approval.bulletin_no.as_str())
        {
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

/// Arşivde karşılığı olmayan bir SPK onayının kayıt açabilmesi için en fazla
/// bu kadar eski olabileceği gün sayısı.
///
/// Onaydan talep toplamaya birkaç hafta geçiyor; bir yıl, gecikmiş ya da
/// halkarz.com'un henüz görmediği arzlara rahat pay bırakır.
const APPROVAL_RECENCY_DAYS: i64 = 365;

/// Onay tarihi kayıt açacak kadar yakın mı? Tarihi çözülemeyen onay
/// kayıt açmaz — yanlış tarihli hayalet kayıt, eksik kayıttan kötüdür.
fn is_recent_approval(approval_date: &str, today: &str) -> bool {
    let iso = crate::ipo_scraper::parse_turkish_date(approval_date);
    let (Some(approved), Some(today)) = (parse_any_date(&iso), parse_any_date(today)) else {
        return false;
    };
    (today - approved).num_days() <= APPROVAL_RECENCY_DAYS
}
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
///
/// Unvanla eşleşme yalnız bildirimi **şirketin kendisi** yaptığında denenir.
/// Halka arz bildirimlerini konsorsiyum lideri yapıyor; bildirimi yapanın
/// unvanıyla eşleşme aramak, aracı kurumun kendi halka arz kaydına yabancı
/// veri yazardı.
fn match_disclosure(archive: &[PersistedIpo], disclosure: &KapIpoDisclosure) -> Option<usize> {
    let candidate = archive
        .iter()
        .position(|p| {
            !p.ticker.is_empty() && Some(&p.ticker) == disclosure.ticker.as_ref()
        })
        .or_else(|| {
            // `or_else` şart: `or` argümanını hemen değerlendirir ve
            // gövdesi okunmamış bir bildirimde `?` erken tetiklenip listedeki
            // unvanı hiç denemeden `None` döndürür.
            let name = disclosure.company_name.as_deref().or_else(|| {
                disclosure.extracted_data.as_ref()?.company_name.as_deref()
            })?;
            archive.iter().position(|p| fuzzy_company_match(&p.name, name))
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

/// Gövdeden çıkan alanları kayda işler.
///
/// İki davranış var ve ayrımı **hangi kaynağın o alanı daha iyi bildiği**
/// belirliyor:
///
/// * **Ezilir** — alanın tek resmî kaynağı KAP. Katılımcı sayısı, dağıtım
///   tablosu, ilk işlem tarihi, pazar ve endeks üyeliği yalnız Borsa/KAP
///   bildiriminde yapısal olarak var; halkarz.com'unki ikinci elden aktarım.
/// * **Yalnız boşluğu doldurur** — halkarz.com aynı alanı daha zengin yazıyor.
///   Talep toplama tarihini KAP "22-23-24/07/2026" diye verirken halkarz
///   "12-13-14 Ağustos 2026 / 09:00-17:00" yazıyor; konsorsiyumu KAP tek aracı
///   kurum olarak verirken halkarz listenin tamamını taşıyor. Bunları ezmek
///   veriyi fakirleştirirdi.
pub(crate) fn merge_extracted(entry: &mut PersistedIpo, data: &KapIpoExtractedData) -> bool {
    let mut changed = false;

    // Fiyat "Halka Arz Sonuçları"nda **gerçekleşen** fiyattır; en yetkili odur.
    if let Some(price) = data.price {
        if price > 0.0 && entry.price != price {
            entry.price = price;
            changed = true;
        }
    }

    let authoritative: [(&mut Option<String>, &Option<String>); 6] = [
        (&mut entry.trading_start_date, &data.trading_start_date),
        (&mut entry.participant_count, &data.participant_count),
        (&mut entry.market, &data.market),
        (&mut entry.index_name, &data.index_name),
        (&mut entry.major_shareholders, &data.major_shareholders),
        (&mut entry.public_float_ratio, &data.public_float_ratio),
    ];
    for (target, source) in authoritative {
        if source.is_some() && target != source {
            *target = source.clone();
            changed = true;
        }
    }

    let fill_only: [(&mut Option<String>, &Option<String>); 6] = [
        (&mut entry.book_building_dates, &data.book_building_dates),
        (&mut entry.consortium_lead, &data.consortium_lead),
        (&mut entry.distribution_ratios, &data.distribution_ratios),
        (&mut entry.fund_usage, &data.fund_usage),
        (&mut entry.katilim_index, &data.katilim_index),
        (&mut entry.lot_amount, &data.lot_amount),
    ];
    for (target, source) in fill_only {
        if target.is_none() && source.is_some() {
            *target = source.clone();
            changed = true;
        }
    }

    // Dağıtım tablosu: KAP yalnız kişi sayısını verir, lot/oran sütunları "—".
    // halkarz.com'un tablosu üçünü birden taşıdığı için **zenginlik korunur**;
    // KAP tablosu ancak hiç tablo yokken yazılır.
    if entry.results_table.is_none() {
        if let Some(rows) = &data.results_table {
            entry.results_table = Some(rows.clone());
            changed = true;
        }
    }

    // Büyüklük "Halka Arz Sonuçları"nda gerçekleşen tutardır.
    if let Some(size) = data.ipo_size_tl.filter(|size| *size > 0.0) {
        let formatted = format_ipo_size(size);
        if entry.ipo_size.as_deref() != Some(formatted.as_str()) {
            entry.ipo_size = Some(formatted);
            changed = true;
        }
    }

    changed
}

// ---------- Yardımcılar ----------

/// Şirket adı fuzzy eşleştirme; tek kaynak `company_match`.
fn fuzzy_company_match(a: &str, b: &str) -> bool {
    crate::company_match::same_company(a, b)
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

    /// Bugünün tarihi, bültendeki Türkçe biçimiyle ve ISO karşılığıyla.
    ///
    /// Onayın yakınlık penceresine düşmesi gerekiyor; fixture'a sabit bir
    /// tarih yazmak testi bir yıl sonra sessizce bozardı.
    fn today_in_turkish() -> (String, String) {
        const MONTHS: [&str; 12] = [
            "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
            "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
        ];
        let now = chrono::Local::now();
        let month = MONTHS[chrono::Datelike::month0(&now) as usize];
        (
            format!("{} {month} {}", now.format("%d"), now.format("%Y")),
            now.format("%Y-%m-%d").to_string(),
        )
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
            price_range: None,
            consortium_lead: None,
            bulletin_no: "2026/49".to_string(),
            approval_date: today_in_turkish().0,
        }
    }

    /// **Regresyon: resmî kaynak scraper'a yenilmemeli.**
    ///
    /// `merge_scraped` alanları koşulsuz ezer. Resmî kaynaklardan **sonra**
    /// çalıştırıldığında SPK'nın onayladığı fiyat, halkarz.com'un değeriyle
    /// her yenilemede değiştiriliyordu: resmî veri yazılıyor ama saniyeler
    /// içinde üzerine yazıldığı için menüde hiç görünmüyordu.
    #[test]
    fn official_sources_win_over_the_scraper() {
        let (turkish_today, iso_today) = today_in_turkish();

        let scraped = crate::ipo_scraper::ScrapedIpo {
            ticker: "KPEKS".to_string(),
            name: "Kapeks Kimya Sanayi A.Ş.".to_string(),
            ipo_date: iso_today.clone(),
            // halkarz.com yuvarlamış; SPK bülteni 94,00 onaylamış.
            price: 93.5,
            status: "AKTİF".to_string(),
            ..Default::default()
        };

        let mut approved = approval("Kapeks Kimya Sanayi AŞ", 94.0);
        approved.ticker = Some("KPEKS".to_string());
        approved.approval_date = turkish_today;

        let result = PipelineResult {
            spk_applications: Vec::new(),
            spk_approvals: vec![approved],
            kap_disclosures: Vec::new(),
            kap_scan: crate::kap_ipo::IpoScan { rows: Vec::new(), complete: true },
            scraper_ipos: vec![scraped],
            errors: Vec::new(),
        };

        let mut archive = Vec::new();
        merge_pipeline_into_archive(&mut archive, &result);

        assert_eq!(archive.len(), 1, "iki kaynak tek kayıtta buluşmalı");
        assert_eq!(
            archive[0].price, 94.0,
            "SPK'nın onayladığı fiyat halkarz.com değerini ezmeli"
        );
        assert_eq!(archive[0].spk_bulletin_no.as_deref(), Some("2026/49"));
    }

    /// KAP'ın tek resmî kaynak olduğu alanlar scraper değerini ezmeli;
    /// halkarz.com'un daha zengin yazdığı alanlar korunmalı.
    #[test]
    fn kap_overwrites_only_the_fields_it_owns() {
        let mut entry = PersistedIpo {
            ticker: "MASFN".to_string(),
            name: "Masfen Enerji A.Ş.".to_string(),
            // halkarz.com'dan gelmiş taban
            participant_count: Some("1.000.000".to_string()),
            trading_start_date: Some("29 Temmuz 2026".to_string()),
            book_building_dates: Some("22-23-24 Temmuz 2026 / 09:00-17:00".to_string()),
            consortium_lead: Some("Deniz Yatırım / Ünlü Menkul / Gedik Yatırım".to_string()),
            ..PersistedIpo::default()
        };

        let data = KapIpoExtractedData {
            // KAP'ın tek kaynak olduğu alanlar
            participant_count: Some("1.093.898".to_string()),
            trading_start_date: Some("2026-07-30".to_string()),
            // halkarz.com'un daha zengin yazdığı alanlar
            book_building_dates: Some("22-23-24/07/2026".to_string()),
            consortium_lead: Some("Deniz Yatırım Menkul Kıymetler A.Ş.".to_string()),
            ..KapIpoExtractedData::default()
        };

        assert!(merge_extracted(&mut entry, &data));

        assert_eq!(entry.participant_count.as_deref(), Some("1.093.898"));
        assert_eq!(entry.trading_start_date.as_deref(), Some("2026-07-30"));
        assert_eq!(
            entry.book_building_dates.as_deref(),
            Some("22-23-24 Temmuz 2026 / 09:00-17:00"),
            "saat bilgisi taşıyan zengin değer korunmalı"
        );
        assert_eq!(
            entry.consortium_lead.as_deref(),
            Some("Deniz Yatırım / Ünlü Menkul / Gedik Yatırım"),
            "konsorsiyumun tamamı tek aracı kuruma indirgenmemeli"
        );
    }

    /// Şirketin **kendi** yaptığı bir bildirim; unvan listeden bilinir.
    fn disclosure(company: &str, published: &str) -> KapIpoDisclosure {
        KapIpoDisclosure {
            company_name: Some(company.to_string()),
            filer_name: company.to_string(),
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
        assert_eq!(archive[0].ipo_date, today_in_turkish().1);
    }

    /// Arşiv 2021'den beri kazınıyor, SPK arşivi 2017'ye iniyor. Eşleşmeyen
    /// eski bir onay ya kapsam dışıdır ya da hiç gerçekleşmemiş bir arzdır;
    /// kayıt açmak listeye yıllardır "SPK ONAYLI" bekleyen hayalet arzlar
    /// eklerdi.
    #[test]
    fn old_unmatched_approvals_do_not_create_records() {
        let mut archive = Vec::new();
        let mut old = approval("Vaktiyle Onaylanmış AŞ", 12.0);
        old.approval_date = "2018-04-11".to_string();

        assert!(!merge_spk_approvals(&mut archive, &[old]));
        assert!(archive.is_empty());
    }

    /// Geçmiş onay, arşivde karşılığı **varsa** kaydı zenginleştirmeli:
    /// fiyat/lot/büyüklük için en yetkili kaynak odur.
    #[test]
    fn old_approvals_still_enrich_existing_records() {
        let mut archive = vec![PersistedIpo {
            name: "Vaktiyle Onaylanmış AŞ".to_string(),
            ipo_date: "2018-05-02".to_string(),
            status: "TAMAMLANDI".to_string(),
            ..PersistedIpo::default()
        }];
        let mut old = approval("Vaktiyle Onaylanmış AŞ", 12.0);
        old.approval_date = "2018-04-11".to_string();

        assert!(merge_spk_approvals(&mut archive, &[old]));
        assert_eq!(archive.len(), 1);
        assert_eq!(archive[0].price, 12.0);
        assert_eq!(archive[0].spk_bulletin_no.as_deref(), Some("2026/49"));
    }

    /// Şirket listelendikten sonra kodu belirir; onay kodu taşıyorsa kodsuz
    /// kayda yazılmalı ve sonraki turlarda kod üzerinden eşleşmeli.
    #[test]
    fn approval_ticker_lands_on_the_record() {
        let mut archive = vec![PersistedIpo {
            name: "Kapeks Kimya Sanayi AŞ".to_string(),
            status: "TASLAK".to_string(),
            ..PersistedIpo::default()
        }];
        let mut with_code = approval("Kapeks Kimya Sanayi AŞ", 94.0);
        with_code.ticker = Some("KPEKS".to_string());

        merge_spk_approvals(&mut archive, &[with_code.clone()]);
        assert_eq!(archive.len(), 1);
        assert_eq!(archive[0].ticker, "KPEKS");

        // Unvan başka yazılsa da kod eşleşmeyi kurar.
        let mut renamed = with_code;
        renamed.company_name = "Kapeks Kimya San. ve Tic. A.Ş.".to_string();
        merge_spk_approvals(&mut archive, &[renamed]);
        assert_eq!(archive.len(), 1, "kod eşleşmesi mükerrer kaydı önlemeli");
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

    /// **Resmî veri bir yenileme turundan sağ çıkıyor mu?**
    ///
    /// Asıl sınama budur: alanın *yazılması* yetmez, bir sonraki turda yerinde
    /// **durması** gerekir. `merge_scraped` alanları koşulsuz ezdiği için
    /// resmî kaynaklardan sonra çalıştığı sürece SPK'nın fiyatı ve KAP'ın
    /// katılımcı sayısı her turda halkarz.com'un değerine geri dönüyordu —
    /// menüye bakan kullanıcı resmî veriyi hiç görmüyordu.
    ///
    /// Turu **iki kez** çalıştırır: tek tur, ezilmenin bir sonraki turda
    /// olduğu bu hatayı yakalayamaz.
    #[tokio::test]
    #[ignore = "canlı ağ erişimi gerektirir ve ~/.fraude_ipos.json dosyasını günceller"]
    async fn live_official_values_survive_a_refresh() {
        let client = crate::http_client();

        crate::corporate_actions::refresh_ipo_base(&client).await;
        let first = crate::ipo_store::load();
        crate::corporate_actions::refresh_ipo_base(&client).await;
        let second = crate::ipo_store::load();

        // SPK bülteninin onayladığı fiyatı taşıyan kayıtlar iki tur boyunca
        // aynı kalmalı.
        let mut checked = 0;
        for record in second.iter().filter(|r| r.spk_bulletin_no.is_some()) {
            let Some(before) = first.iter().find(|r| r.name == record.name) else {
                continue;
            };
            if before.price == 0.0 {
                continue;
            }
            assert_eq!(
                before.price, record.price,
                "{} fiyatı tur arasında değişti — scraper resmî değeri eziyor",
                record.name
            );
            checked += 1;
        }
        assert!(checked > 0, "SPK onaylı hiç kayıt bulunamadı");
        println!("{checked} SPK onaylı kaydın fiyatı iki tur boyunca sabit kaldı");

        // KAP'ın tek kaynak olduğu alanlar da kaybolmamalı.
        for record in first.iter().filter(|r| r.participant_count.is_some()) {
            let after = second.iter().find(|r| r.name == record.name);
            assert!(
                after.is_some_and(|r| r.participant_count.is_some()),
                "{} katılımcı sayısı yenilemede kayboldu",
                record.name
            );
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
