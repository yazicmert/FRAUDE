//! SPK haftalık bülten arşivi: bedelli/bedelsiz sermaye artırımları **ve**
//! halka arz onayları.
//!
//! İkisi aynı PDF'in iki ayrı bölümünden çıkar (`A.1 İlk Halka Arzlar` ve
//! `A.2 Halka Açık Ortaklıkların Pay İhraçları`), bu yüzden tek arşivde
//! tutulur: bülten bir kez indirilir, bir kez ayrıştırılır.
//!
//! Sermaye artırımı tablosu Yahoo'nun split akışının yerini alır. İki nedenle:
//!
//! * Yahoo akışı **bedelliyi hiç taşımaz** — rüçhan haklı artırımlar orada
//!   yok, dolayısıyla sulanma hesaba girmiyordu.
//! * Bedelsizde de bozulabiliyor: KTLEV'de üç kayıt çarpılınca ×937,9
//!   çıkıyor ve arz getirisi %304.256 görünüyordu. SPK tablosu aynı artırımı
//!   `2.070.000.000 → 7.000.000.000`, yani ×3,3816 olarak veriyor.
//!
//! Halka arz onay tablosu ise fiyat, lot ve arz büyüklüğünün resmî kaynağıdır:
//! izahname onayı olmadan halka arz yapılamaz.
//!
//! Bülten PDF'leri bir kez indirilip ayrıştırılır; işlenen bültenlerin
//! adresleri arşivde tutulduğu için tekrar çalıştırmada yalnız yeni bültenler
//! çekilir.

use crate::spk::{SpkCapitalIncrease, SpkIpoApproval};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Kaydın geldiği resmî kaynak.
///
/// İki kaynak birbirini tamamlıyor: bülten esas sermaye sistemindeki ve halka
/// arzlı artırımları, KAP bildirimi ise kayıtlı sermaye tavanı altında yönetim
/// kurulu kararıyla yapılan ve bültende **hiç yayımlanmayan** artırımları
/// taşıyor.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub enum CapitalSource {
    /// SPK haftalık bülteni. Eski arşivlerde alan yok; varsayılan budur.
    #[default]
    SpkBulletin,
    /// KAP "Sermaye Artırımı - Azaltımı İşlemlerine İlişkin Bildirim".
    KapDisclosure,
}

/// Bir sermaye artırımı kaydı ve bağlandığı BIST kodu.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct StoredCapitalIncrease {
    /// Unvandan çözülemediyse `None`; kod uydurulmaz.
    pub ticker: Option<String>,
    #[serde(default)]
    pub source: CapitalSource,
    #[serde(flatten)]
    pub increase: SpkCapitalIncrease,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct CapitalArchive {
    pub records: Vec<StoredCapitalIncrease>,
    /// Bültenlerin "İlk Halka Arzlar" bölümünden çıkan onaylar.
    #[serde(default)]
    pub ipo_approvals: Vec<SpkIpoApproval>,
    /// KAP "Kar Payı Dağıtım İşlemlerine İlişkin Bildirim"lerinden çıkan
    /// temettüler. Dosya adı sermaye artırımını anıyor ama arşiv, resmî
    /// kurumsal olayların tamamını tutuyor: hepsi aynı iki kaynaktan ve aynı
    /// `processed_disclosures` kümesiyle geliyor.
    #[serde(default)]
    pub dividends: Vec<crate::kap_dividend::KapDividend>,
    /// Ayrıştırılmış bülten adresleri — aynı PDF ikinci kez indirilmez.
    #[serde(default)]
    pub processed_bulletins: HashSet<String>,
    /// Gövdesi okunmuş KAP bildirim numaraları.
    ///
    /// Gövde ucu tur başına ~10 belge veriyor; ilerleme diske yazılmazsa her
    /// tur aynı ilk on bildirimi indirir ve arşiv hiç ilerlemez.
    #[serde(default)]
    pub processed_disclosures: HashSet<String>,
    /// Gövdesi henüz okunmamış temettü bildirimleri, kalıcı kuyruk olarak.
    ///
    /// Keşif ve okuma **ayrılmıştır**: aday listesini her turda 760 günlük
    /// pencereyi baştan tarayarak çıkarmak tur başına ~109 liste isteği
    /// demekti ve okunabilecek gövde sayısının yanında bu tamamen israftı.
    /// Kuyruk diske yazıldığı için keşif bir kez yapılır, okuma turlar boyunca
    /// bütçesi kadar ilerler.
    #[serde(default)]
    pub dividend_queue: Vec<QueuedDividend>,
    /// Geriye dönük keşfin ulaştığı en eski tarih (ISO).
    ///
    /// Tarama her turda bir dilim daha geriye iner; bu damga olmadan tur
    /// yeniden en baştan başlar ve arşiv hiç derinleşmez.
    #[serde(default)]
    pub dividend_scanned_from: Option<String>,
    /// Arşivi üreten ayrıştırıcının sürümü; bkz. [`crate::spk::BULLETIN_PARSER_VERSION`].
    #[serde(default)]
    pub parser_version: u32,
    #[serde(default)]
    pub last_updated: Option<String>,
}

/// Kuyrukta bekleyen, gövdesi henüz okunmamış temettü bildirimi.
///
/// Yayım tarihi kuyrukta taşınır: bildirim numarası artan sırada olsa da
/// okuma önceliği tarihe göre verilir ("en yeni önce") ve numara ile tarih
/// arasındaki eşleşme yalnız liste ucunda bulunuyor.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct QueuedDividend {
    pub disclosure_index: String,
    /// KAP'ın yayım damgası, "07.08.2026 18:40" biçiminde.
    pub publish_date: String,
}

/// Tek bir bültenden çıkan her şey.
///
/// İki tablo birlikte taşınır çünkü birlikte üretilirler: bülten yeniden
/// işlendiğinde o bültene ait **eski kayıtların tamamı** bunlarla değişir.
pub struct BulletinExtract {
    pub bulletin_no: String,
    pub increases: Vec<SpkCapitalIncrease>,
    pub approvals: Vec<SpkIpoApproval>,
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

/// Bir bültenin kayıtlarını arşive işler ve **o bültenden daha önce çıkmış
/// kayıtların yerini alır**.
///
/// Değiştirme, sürüm artışıyla yeniden taranan bültenlerde ayrıştırıcı
/// düzeltmelerinin geçmişe ulaşması için şart: yalnız ekleyen bir birleştirme,
/// bozuk unvanlı eski kaydı arşivde bırakır ve düzeltilmişi yanına yazardı.
///
/// Dönen sayı `(sermaye artırımı, halka arz onayı)`.
pub fn merge_bulletin(archive: &mut CapitalArchive, extract: BulletinExtract) -> (usize, usize) {
    let bulletin = extract.bulletin_no.as_str();
    // Yalnız bültenden gelen kayıtlar değiştirilir; KAP kaynaklı kayıtlar
    // bültenin yeniden taranmasından etkilenmemeli.
    archive
        .records
        .retain(|r| r.source != CapitalSource::SpkBulletin || r.increase.bulletin_no != bulletin);
    archive.ipo_approvals.retain(|a| a.bulletin_no != bulletin);

    let mut increases = 0;
    for increase in extract.increases {
        // Tarih, artırımın arzdan önce mi sonra mı olduğunun tek ölçütü;
        // çözülemeyen tarih kaydı arşive girmemeli.
        if !crate::ipo_store::looks_like_iso_date(&increase.approval_date) {
            continue;
        }
        archive.records.push(StoredCapitalIncrease {
            ticker: crate::company_match::bist_ticker_for(&increase.company_name)
                .map(str::to_string),
            source: CapitalSource::SpkBulletin,
            increase,
        });
        increases += 1;
    }

    let mut approvals = 0;
    for mut approval in extract.approvals {
        if !crate::ipo_store::looks_like_iso_date(&approval.approval_date) {
            continue;
        }
        // Arz sırasında şirketin kodu yoktur, ama listelendikten sonra BIST
        // evreninde belirir; çözülebiliyorsa kayda yazılır ki halka arz
        // arşiviyle isim değil kod üzerinden eşleşsin.
        if approval.ticker.is_none() {
            approval.ticker =
                crate::company_match::bist_ticker_for(&approval.company_name).map(str::to_string);
        }
        archive.ipo_approvals.push(approval);
        approvals += 1;
    }

    (increases, approvals)
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

/// KAP bildirimlerinden çıkan artırımları arşive işler; eklenen sayıyı döner.
///
/// **SPK bülteni önceliklidir.** Aynı artırım iki kaynakta da varsa bültenin
/// kaydı korunur: bülten onay tarihini verir, KAP bildirimi süreç boyunca
/// birkaç kez tekrarlanır.
///
/// Tekillik ölçütü ekonomik kimliktir — `(şirket, mevcut sermaye, yeni
/// sermaye)`. Bildirim numarası anahtar olamaz: bir şirket **aynı** artırım
/// için art arda bildirim yayımlıyor (yönetim kurulu kararı, SPK başvurusu,
/// SPK onayı, tamamlandı) ve hepsi aynı konu ve aynı tutarlarla geliyor.
pub fn merge_kap_increases(archive: &mut CapitalArchive, rows: Vec<crate::kap_capital::KapCapitalIncrease>) -> usize {
    let mut added = 0;

    for row in rows {
        if !crate::ipo_store::looks_like_iso_date(&row.increase.approval_date) {
            continue;
        }
        if archive.records.iter().any(|existing| same_event(&existing.increase, &row.increase)) {
            continue;
        }
        archive.records.push(StoredCapitalIncrease {
            ticker: row.ticker.or_else(|| {
                crate::company_match::bist_ticker_for(&row.increase.company_name).map(str::to_string)
            }),
            source: CapitalSource::KapDisclosure,
            increase: row.increase,
        });
        added += 1;
    }

    added
}

/// İki kayıt aynı sermaye geçişini mi anlatıyor?
///
/// Bir şirketin aynı `mevcut → yeni` geçişini iki ayrı kez yapması pratikte
/// olmuyor; tutarlar bu yüzden olayın kimliğidir. Tarih ölçüte **girmez**:
/// bülten onay tarihini, KAP yönetim kurulu karar tarihini veriyor ve ikisi
/// haftalarca ayrı düşebiliyor.
fn same_event(a: &SpkCapitalIncrease, b: &SpkCapitalIncrease) -> bool {
    const TOLERANCE: f64 = 1.0;
    (a.existing_capital - b.existing_capital).abs() <= TOLERANCE
        && (a.new_capital - b.new_capital).abs() <= TOLERANCE
        && crate::company_match::same_company(&a.company_name, &b.company_name)
}

/// KAP bildirimlerinden çıkan temettüleri arşive işler; eklenen sayıyı döner.
///
/// Tekillik ölçütü `(kod, hak kullanım tarihi)`: aynı dağıtım için şirket art
/// arda bildirim yapıyor (yönetim kurulu teklifi, genel kurul kararı,
/// güncelleme) ve hepsi aynı tarihi taşıyor. Sonradan gelen bildirim tutarı
/// **günceller**: kesinleşen tutar teklif edilenden farklı olabilir.
///
/// Tarih değiştiğinde eşleşme kurulamaz ve eski kayıt arşivde kalırdı: genel
/// kurul teklif edilen günü öteleyince takvimde **hem eski hem yeni** tarih
/// görünürdü. Bu yüzden aynı `(kod, yıl, taksit)` için **daha eski bir
/// bildirimden** gelmiş kayıt, yeni bildirim işlenirken düşürülür.
pub fn merge_kap_dividends(
    archive: &mut CapitalArchive,
    rows: Vec<crate::kap_dividend::KapDividend>,
) -> usize {
    let mut added = 0;

    for row in rows {
        supersede_older(archive, &row);

        match archive
            .dividends
            .iter_mut()
            .find(|existing| existing.ticker == row.ticker && existing.ex_date == row.ex_date)
        {
            Some(existing) => *existing = row,
            None => {
                archive.dividends.push(row);
                added += 1;
            }
        }
    }

    added
}

/// Aynı ödemenin **eski bildirimden** gelmiş, tarihi değişmiş kaydını siler.
///
/// Ölçüt üçlüdür ve üçü de gerekli:
///
/// * **Yıl** — bir şirket aynı yıl içinde hem geçmiş yılın kârını hem avans
///   temettü dağıtabilir; yıl ayrımı olmadan biri diğerini silerdi.
/// * **Taksit** — taksitli dağıtımın beş satırı tek bildirimden gelir ve
///   birbirinin yerini almamalı.
/// * **Bildirim numarası** — yalnız *daha eski* bildirimin kaydı düşer. KAP
///   numarayı yayım sırasıyla veriyor; eşit numara aynı bildirimin başka bir
///   taksidi demektir ve ona dokunulmaz.
fn supersede_older(archive: &mut CapitalArchive, row: &crate::kap_dividend::KapDividend) {
    let Ok(incoming) = row.disclosure_index.parse::<u64>() else { return };
    let year = row.ex_date.get(..4).unwrap_or_default().to_string();

    archive.dividends.retain(|existing| {
        let older = existing
            .disclosure_index
            .parse::<u64>()
            .is_ok_and(|index| index < incoming);

        !(older
            && existing.ticker == row.ticker
            && existing.payment_kind == row.payment_kind
            && existing.ex_date.get(..4) == Some(year.as_str())
            && existing.ex_date != row.ex_date)
    });
}

/// Yeni bulunan temettü bildirimlerini kuyruğa ekler; eklenen sayıyı döner.
///
/// Gövdesi okunmuş olanlar **kuyruğa girmez**: keşif penceresi her turda aynı
/// yakın geçmişi yeniden tarıyor ve süzülmezse kuyruk okunmuş bildirimlerle
/// şişerdi.
pub fn enqueue_dividends(
    archive: &mut CapitalArchive,
    rows: &[crate::kap::RawDisclosure],
) -> usize {
    let known: HashSet<String> = archive
        .dividend_queue
        .iter()
        .map(|q| q.disclosure_index.clone())
        .collect();

    let mut added = 0;
    for row in rows {
        let index = row.disclosure_index_str();
        if known.contains(&index) || archive.processed_disclosures.contains(&index) {
            continue;
        }
        archive.dividend_queue.push(QueuedDividend {
            disclosure_index: index,
            publish_date: row.publish_date.clone(),
        });
        added += 1;
    }
    added
}

/// Kuyruktan, en yeni bildirim önce gelecek biçimde sıralı numaralar.
///
/// Sıralama bildirim numarasına göre: KAP numarayı yayım sırasıyla veriyor ve
/// sayısal karşılaştırma tarih metnini ayrıştırmaktan hem ucuz hem güvenilir.
/// Güncel akışın doğruluğu geçmişten önce gelir — kullanıcı önce yaklaşan
/// temettüye bakıyor.
pub fn dividend_queue_newest_first(archive: &CapitalArchive) -> Vec<String> {
    let mut queue: Vec<&QueuedDividend> = archive.dividend_queue.iter().collect();
    queue.sort_by_key(|q| std::cmp::Reverse(q.disclosure_index.parse::<u64>().unwrap_or(0)));
    queue.iter().map(|q| q.disclosure_index.clone()).collect()
}

/// Gövdesi okunmuş bildirimleri kuyruktan düşürür ve işlenmiş sayar.
pub fn drain_dividend_queue(archive: &mut CapitalArchive, done: &[String]) {
    let done: HashSet<&str> = done.iter().map(String::as_str).collect();
    archive
        .dividend_queue
        .retain(|q| !done.contains(q.disclosure_index.as_str()));
    for index in done {
        archive.processed_disclosures.insert(index.to_string());
    }
}

/// Bir hissenin resmî temettü kayıtları, yeniden eskiye.
pub fn dividends_for(archive: &CapitalArchive, ticker: &str) -> Vec<crate::kap_dividend::KapDividend> {
    let mut rows: Vec<_> = archive
        .dividends
        .iter()
        .filter(|row| row.ticker == ticker)
        .cloned()
        .collect();
    rows.sort_by(|a, b| b.ex_date.cmp(&a.ex_date));
    rows
}

/// Kodu boş kalmış kayıtlarda unvan → BIST kodu çözümünü yeniden dener;
/// doldurulan kayıt sayısını döner.
///
/// Kod **türetilmiş** veridir: ayrıştırmaya değil, o anki BIST evrenine ve
/// eşleştiriciye bağlıdır. Kayıt anında dondurulursa iki durumda bayatlar —
/// şirket sonradan listelendiğinde ve eşleştirici düzeldiğinde. İkisi de
/// bültenin yeniden indirilmesini gerektirmemeli; bu geçiş ağ erişimi yapmaz.
///
/// Kodu zaten çözülmüş kayda dokunulmaz: yerleşmiş bir bağı her turda yeniden
/// kurmak, evren geçici olarak eksik geldiğinde kodu düşürürdü.
pub fn refresh_tickers(archive: &mut CapitalArchive) -> usize {
    let mut filled = 0;

    for record in archive.records.iter_mut().filter(|r| r.ticker.is_none()) {
        if let Some(ticker) = crate::company_match::bist_ticker_for(&record.increase.company_name) {
            record.ticker = Some(ticker.to_string());
            filled += 1;
        }
    }

    for approval in archive.ipo_approvals.iter_mut().filter(|a| a.ticker.is_none()) {
        if let Some(ticker) = crate::company_match::bist_ticker_for(&approval.company_name) {
            approval.ticker = Some(ticker.to_string());
            filled += 1;
        }
    }

    filled
}

/// Arşivdeki bütün halka arz onayları, en yeni bültenden eskiye.
///
/// Halka arz pipeline'ı bunu canlı bülten taramasıyla birleştirir: arşiv
/// geçmişi (2017'ye dek), canlı tarama son günlerin tazeliğini verir.
pub fn ipo_approvals(archive: &CapitalArchive) -> Vec<SpkIpoApproval> {
    let mut rows = archive.ipo_approvals.clone();
    rows.sort_by(|a, b| b.approval_date.cmp(&a.approval_date));
    rows
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

    /// Kayıtları bültenlerine göre gruplayıp arşive işleyen test yardımcısı.
    fn merge(archive: &mut CapitalArchive, increases: Vec<SpkCapitalIncrease>) -> usize {
        let mut grouped: Vec<(String, Vec<SpkCapitalIncrease>)> = Vec::new();
        for increase in increases {
            match grouped.iter_mut().find(|(no, _)| *no == increase.bulletin_no) {
                Some((_, rows)) => rows.push(increase),
                None => grouped.push((increase.bulletin_no.clone(), vec![increase])),
            }
        }

        grouped
            .into_iter()
            .map(|(bulletin_no, rows)| {
                merge_bulletin(
                    archive,
                    BulletinExtract {
                        bulletin_no,
                        increases: rows,
                        approvals: Vec::new(),
                    },
                )
                .0
            })
            .sum()
    }

    fn approval(company: &str, bulletin_no: &str, date: &str) -> SpkIpoApproval {
        SpkIpoApproval {
            company_name: company.into(),
            ticker: None,
            capital_increase_lots: 25_100_000.0,
            share_sale_lots: 0.0,
            extra_sale_lots: 0.0,
            total_lots: 25_100_000.0,
            price: 94.0,
            ipo_size_tl: 25_100_000.0 * 94.0,
            price_range: None,
            consortium_lead: None,
            bulletin_no: bulletin_no.into(),
            approval_date: date.into(),
        }
    }

    #[test]
    fn merge_resolves_tickers() {
        let mut archive = CapitalArchive::default();
        let row = increase("Katılımevim Tasarruf Finansman AŞ", "2026-08-01", 2_070_000_000.0, 4_930_000_000.0, 0.0);

        assert_eq!(merge(&mut archive, vec![row]), 1);
        assert_eq!(archive.records[0].ticker.as_deref(), Some("KTLEV"));
    }

    /// Bülten yeniden işlendiğinde eski kayıtları **değişir**, yanına
    /// eklenmez. Yalnız ekleyen bir birleştirme, ayrıştırıcı düzeltmesinden
    /// sonra bozuk kaydı arşivde bırakıyordu.
    #[test]
    fn reprocessing_a_bulletin_replaces_its_rows() {
        let mut archive = CapitalArchive::default();
        let corrupt = increase(
            "Ortaklık Mevcut Sermaye Yeni Sermaye Global Yatırım Holding AŞ",
            "2026-08-01",
            100.0,
            100.0,
            0.0,
        );
        let bulletin_no = corrupt.bulletin_no.clone();
        merge(&mut archive, vec![corrupt]);
        assert_eq!(archive.records.len(), 1);

        let fixed = increase("Global Yatırım Holding AŞ", "2026-08-01", 100.0, 100.0, 0.0);
        merge(&mut archive, vec![fixed]);

        assert_eq!(archive.records.len(), 1, "{:#?}", archive.records);
        assert_eq!(archive.records[0].increase.company_name, "Global Yatırım Holding AŞ");
        assert_eq!(archive.records[0].ticker.as_deref(), Some("GLYHO"));
        assert_eq!(archive.records[0].increase.bulletin_no, bulletin_no);
    }

    /// Halka arz onayları da aynı bülten geçişinde arşivlenir; şirket
    /// listelendiyse kodu çözülür.
    #[test]
    fn ipo_approvals_are_archived_alongside_increases() {
        let mut archive = CapitalArchive::default();
        let (increases, approvals) = merge_bulletin(
            &mut archive,
            BulletinExtract {
                bulletin_no: "2026/49".into(),
                increases: vec![increase(
                    "Derlüks Yatırım Holding AŞ",
                    "2026-08-05",
                    197_281_323.0,
                    791_897_760.0,
                    0.0,
                )],
                approvals: vec![
                    approval("Kapeks Kimya Sanayi AŞ", "2026/49", "2026-08-05"),
                    approval("Katılımevim Tasarruf Finansman AŞ", "2026/49", "2026-08-05"),
                ],
            },
        );

        assert_eq!((increases, approvals), (1, 2));
        assert_eq!(ipo_approvals(&archive).len(), 2);
        // Arz sırasında kod yoktur; listelenmiş şirkette çözülür.
        let listed = archive
            .ipo_approvals
            .iter()
            .find(|a| a.company_name.starts_with("Katılımevim"))
            .unwrap();
        assert_eq!(listed.ticker.as_deref(), Some("KTLEV"));
    }

    /// Kod türetilmiş veridir: eşleştirici düzeldiğinde ya da şirket sonradan
    /// listelendiğinde, bülteni yeniden indirmeden dolmalı.
    #[test]
    fn missing_tickers_are_resolved_without_reparsing() {
        let mut archive = CapitalArchive::default();
        merge_bulletin(
            &mut archive,
            BulletinExtract {
                bulletin_no: "2026/41".into(),
                increases: vec![increase("Goodyear Lastikleri Türk AŞ", "2026-06-10", 270_000_000.0, 1_250_000_000.0, 0.0)],
                approvals: vec![approval("Kapeks Kimya Sanayi AŞ", "2026/41", "2026-06-10")],
            },
        );

        // Kayıt anında çözülmemiş gibi davran (eski arşiv hâli).
        archive.records[0].ticker = None;
        archive.ipo_approvals[0].ticker = None;

        assert_eq!(refresh_tickers(&mut archive), 1, "yalnız BIST'te olan çözülmeli");
        assert_eq!(archive.records[0].ticker.as_deref(), Some("GOODY"));
        // Henüz listelenmemiş şirkete kod uydurulmaz.
        assert_eq!(archive.ipo_approvals[0].ticker, None);

        // Yerleşmiş bağ ikinci turda değişmemeli.
        assert_eq!(refresh_tickers(&mut archive), 0);
    }

    /// Tarihi çözülemeyen onay arşive girmemeli.
    #[test]
    fn approvals_with_an_unparsable_date_are_rejected() {
        let mut archive = CapitalArchive::default();
        let (_, approvals) = merge_bulletin(
            &mut archive,
            BulletinExtract {
                bulletin_no: "2026/49".into(),
                increases: Vec::new(),
                approvals: vec![approval("Kapeks Kimya Sanayi AŞ", "2026/49", "05 Ağustos 2026")],
            },
        );
        assert_eq!(approvals, 0);
        assert!(archive.ipo_approvals.is_empty());
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

    fn dividend(
        ticker: &str,
        ex_date: &str,
        kind: &str,
        gross: f64,
        index: u64,
    ) -> crate::kap_dividend::KapDividend {
        crate::kap_dividend::KapDividend {
            ticker: ticker.into(),
            ex_date: ex_date.into(),
            gross_per_share: gross,
            net_per_share: gross * 0.85,
            payment_date: Some(ex_date.into()),
            payment_kind: kind.into(),
            disclosure_index: index.to_string(),
        }
    }

    fn queued(index: u64, publish_date: &str) -> crate::kap::RawDisclosure {
        crate::kap::RawDisclosure {
            publish_date: publish_date.into(),
            subject: "Kar Payı Dağıtım İşlemlerine İlişkin Bildirim".into(),
            disclosure_index: index,
            kap_title: "Test AŞ".into(),
            stock_codes: Vec::new(),
            related_stocks: Vec::new(),
        }
    }

    /// Teklif edilen tarih genel kurulda kayar; eski kayıt kalırsa takvimde
    /// aynı ödeme iki tarihte birden görünür.
    #[test]
    fn a_newer_disclosure_supersedes_the_proposed_date() {
        let mut archive = CapitalArchive::default();
        merge_kap_dividends(&mut archive, vec![dividend("TRALT", "2026-10-06", "Peşin", 0.5, 1_635_844)]);
        merge_kap_dividends(&mut archive, vec![dividend("TRALT", "2026-10-20", "Peşin", 0.5, 1_639_873)]);

        assert_eq!(archive.dividends.len(), 1, "eski teklif kaydı düşmeli");
        assert_eq!(archive.dividends[0].ex_date, "2026-10-20");
        assert_eq!(archive.dividends[0].disclosure_index, "1639873");
    }

    /// Aynı bildirimin taksitleri birbirini silmez: ölçüt ödeme türünü de
    /// içeriyor ve numaraları eşit olduğu için "daha eski" koşulu tutmuyor.
    #[test]
    fn installments_of_one_disclosure_survive_together() {
        let mut archive = CapitalArchive::default();
        merge_kap_dividends(&mut archive, vec![
            dividend("BEGYO", "2026-08-20", "1. Taksit", 0.0306748, 1_639_434),
            dividend("BEGYO", "2026-10-20", "2. Taksit", 0.0122699, 1_639_434),
            dividend("BEGYO", "2026-12-21", "3. Taksit", 0.0184049, 1_639_434),
        ]);
        assert_eq!(archive.dividends.len(), 3);
    }

    /// Avans temettü ile geçmiş yıl kârı aynı yıl içinde ayrı ödemelerdir;
    /// farklı yıla düşen kayıt üstü örtülmemeli.
    #[test]
    fn a_payment_in_another_year_is_left_alone() {
        let mut archive = CapitalArchive::default();
        merge_kap_dividends(&mut archive, vec![dividend("ASTOR", "2025-10-15", "Peşin", 1.2, 1_500_000)]);
        merge_kap_dividends(&mut archive, vec![dividend("ASTOR", "2026-10-15", "Peşin", 2.19, 1_645_625)]);

        assert_eq!(archive.dividends.len(), 2);
    }

    /// Kuyruk yalnız gövdesi okunmamış bildirimleri taşır: keşif penceresi her
    /// turda aynı yakın geçmişi yeniden tarıyor.
    #[test]
    fn the_queue_skips_what_was_already_read() {
        let mut archive = CapitalArchive::default();
        archive.processed_disclosures.insert("1639434".into());

        let rows = vec![
            queued(1_645_625, "07.08.2026 18:40"),
            queued(1_639_434, "01.08.2026 09:10"),
            queued(1_643_778, "05.08.2026 12:00"),
        ];
        assert_eq!(enqueue_dividends(&mut archive, &rows), 2);
        // İkinci tur aynı listeyi görse de kuyruk büyümemeli.
        assert_eq!(enqueue_dividends(&mut archive, &rows), 0);

        assert_eq!(
            dividend_queue_newest_first(&archive),
            vec!["1645625".to_string(), "1643778".to_string()],
            "en yeni bildirim önce okunmalı"
        );

        drain_dividend_queue(&mut archive, &["1645625".to_string()]);
        assert_eq!(dividend_queue_newest_first(&archive), vec!["1643778".to_string()]);
        assert!(archive.processed_disclosures.contains("1645625"));
        // İşlenmiş bildirim kuyruğa geri dönmemeli.
        assert_eq!(enqueue_dividends(&mut archive, &rows), 0);
    }
}
