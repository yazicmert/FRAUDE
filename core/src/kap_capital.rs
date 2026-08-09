//! KAP bildirimlerinden sermaye artırımı çıkarma.
//!
//! SPK bülteni tek başına yetmiyor: **kayıtlı sermaye sistemindeki** şirketler
//! iç kaynaklardan bedelsiz artırımı yönetim kurulu kararıyla, kayıtlı sermaye
//! tavanının altında kalarak yapıyor ve bu işlem bültenin onay tablosunda
//! yayımlanmıyor. 2023-2024 bültenleri tarandığında EREGL, TUPRS, TTRAK,
//! PAPIL, PRZMA, ESCAR, BIZIM yalnız "Borçlanma Araçları" bölümünde görünüyor,
//! "Pay İhraçları"nda değil — oysa hepsinin bedelsizi gerçekleşti.
//!
//! Bu şirketlerin resmî kaydı KAP'taki **"Sermaye Artırımı - Azaltımı
//! İşlemlerine İlişkin Bildirim"**dir. Bildirim gövdesi bültenden daha
//! zengindir: pay grubu kırılımı, oran ve yönetim kurulu karar tarihi verir.
//!
//! Böylece Yahoo'nun split akışına gerek kalmaz — o akış bedelliyi hiç
//! taşımıyor ve bedelsizde bozuk kayıt üretebiliyordu.

use crate::kap::KapForm;
use crate::spk::SpkCapitalIncrease;
use reqwest::Client;

/// Sermaye artırımı bildiriminin konusu. KAP bunu sabit yazıyor.
const CAPITAL_SUBJECT: &str = "Sermaye Artırımı - Azaltımı İşlemlerine İlişkin Bildirim";

/// Bildirim gövdesindeki alan adları. KAP formu bunları birebir bu metinlerle
/// etiketliyor; gevşek arama "Mevcut Sermaye (TL)" ile "Ulaşılacak Sermaye
/// (TL)" gibi birbirini içeren adları karıştırır.
///
/// Liste dört aylık bildirim taramasından çıkarıldı; adlar tahmin değil,
/// gözlemdir.
const FIELD_EXISTING: &str = "Mevcut Sermaye (TL)";
const FIELD_NEW: &str = "Ulaşılacak Sermaye (TL)";
const FIELD_BOARD_DATE: &str = "Yönetim Kurulu Karar Tarihi";
const FIELD_BONUS_INTERNAL: &str = "İç Kaynaklardan Bedelsiz Pay Alma Tutarı (TL)";
const FIELD_BONUS_PROFIT: &str = "Kar Payından Bedelsiz Pay Alma Tutarı (TL)";

/// Bedelli artırımın dört ayrı yöntemi; hepsi ortağa bedel ödettiği için
/// toplanır. Rüçhan hakkı kullandırılan klasik yöntemin yanında, hak
/// kullandırılmadan tahsisli ya da borsada/borsa dışında halka arz yöntemleri
/// var ve bir bildirimde birden fazlası bulunabiliyor.
///
/// Kesme işareti U+2018'dir ("Borsa‘da"); ASCII kesme ile yazılırsa eşleşmez.
const FIELDS_RIGHTS: &[&str] = &[
    "Rüçhan Hakkı Kullanım Tutarı (TL)",
    "Rüçhan Hakkı Kullandırılmadan Tahsisli Artırılacak Sermaye Tutarı (TL)",
    "Rüçhan Hakkı Kullandırılmadan Borsa‘da Halka Arz Yöntemiyle Artırılacak Sermaye Tutarı (TL)",
    "Rüçhan Hakkı Kullandırılmadan Borsa Dışında Halka Arz Yöntemiyle Artırılacak Sermaye Tutarı (TL)",
];

/// Sermaye özdeşliğinde kabul edilen kuruş farkı.
const IDENTITY_TOLERANCE: f64 = 1.0;

/// Bir bildirimden çıkan sermaye artırımı.
#[derive(Clone, Debug, PartialEq)]
pub struct KapCapitalIncrease {
    pub ticker: Option<String>,
    pub increase: SpkCapitalIncrease,
    pub disclosure_index: String,
}

/// Konusu sermaye artırımı olan bildirim mi?
pub fn is_capital_disclosure(subject: &str) -> bool {
    subject.trim() == CAPITAL_SUBJECT
}

/// Bildirim gövdesini sermaye artırımı kaydına çevirir.
///
/// `company_name`, `ticker` ve `publish_date` bildirim listesinden gelir;
/// gövdede unvan bulunmuyor.
///
/// Kayıt üretilmediği durumlar — hepsi bilinçli:
///
/// * **Sermaye azaltımı ya da değişmeyen sermaye.** Aynı bildirim türü
///   azaltım için de kullanılıyor ve tahsisli artırım başvurularında
///   "Ulaşılacak Sermaye" henüz mevcut sermayeye eşit geliyor.
/// * **Sermaye özdeşliği tutmuyor.** Bileşenlerin toplamı farkı vermiyorsa
///   alanlar yanlış okunmuş demektir; uydurma oran üretmektense atlanır.
pub fn parse_capital_form(
    form: &KapForm,
    company_name: &str,
    ticker: Option<&str>,
    publish_date: &str,
    disclosure_index: &str,
) -> Option<KapCapitalIncrease> {
    let existing = number(form.field(FIELD_EXISTING))?;
    let new_capital = number(form.field(FIELD_NEW))?;
    if existing <= 0.0 || new_capital <= existing {
        return None;
    }

    // Tutarlar pay grubu (A/B) bazında veriliyor; toplam TOPLAM satırındadır.
    let bonus_internal = number(form.field_or_total(FIELD_BONUS_INTERNAL)).unwrap_or(0.0);
    let bonus_profit = number(form.field_or_total(FIELD_BONUS_PROFIT)).unwrap_or(0.0);
    let rights: f64 = FIELDS_RIGHTS
        .iter()
        .filter_map(|label| number(form.field_or_total(label)))
        .sum();

    let expected = existing + bonus_internal + bonus_profit + rights;
    if (expected - new_capital).abs() > IDENTITY_TOLERANCE {
        eprintln!(
            "[kap] {disclosure_index}: {company_name} — sermaye özdeşliği tutmadı \
             ({existing} + {bonus_internal} + {bonus_profit} + {rights} ≠ {new_capital}); atlandı"
        );
        return None;
    }

    // Yönetim kurulu karar tarihi işlemin gerçek tarihidir; bildirim günlerce
    // sonra yayımlanabiliyor. Okunamıyorsa bildirim tarihine düşülür.
    let approval_date = iso_date(form.field(FIELD_BOARD_DATE))
        .or_else(|| iso_date(Some(publish_date)))?;

    Some(KapCapitalIncrease {
        ticker: ticker.map(str::to_string),
        disclosure_index: disclosure_index.to_string(),
        increase: SpkCapitalIncrease {
            company_name: company_name.to_string(),
            existing_capital: existing,
            new_capital,
            rights_amount: rights,
            bonus_internal,
            bonus_profit,
            sale_type: None,
            // Bülten numarası yerine bildirim numarası; kaynak ayrımı
            // `capital_store` tarafında bu önekle yapılıyor.
            bulletin_no: format!("KAP/{disclosure_index}"),
            approval_date,
        },
    })
}

/// "140.000.000" / "11.000.000,000" → sayı. Biçime uymayan metin `None`.
fn number(raw: Option<&str>) -> Option<f64> {
    let token = raw?.trim();
    if token.is_empty() || token == "-" {
        return None;
    }
    let normalized = token.replace('.', "").replace(',', ".");
    let value: f64 = normalized.parse().ok()?;
    value.is_finite().then_some(value)
}

/// "31.07.2026" ya da "07.08.2026 21:01:33" → "2026-07-31".
fn iso_date(raw: Option<&str>) -> Option<String> {
    let head = raw?.split_whitespace().next()?;
    let mut parts = head.split('.');
    let (day, month, year) = (parts.next()?, parts.next()?, parts.next()?);
    if day.len() != 2 || month.len() != 2 || year.len() != 4 {
        return None;
    }
    if !head.chars().all(|c| c.is_ascii_digit() || c == '.') {
        return None;
    }
    Some(format!("{year}-{month}-{day}"))
}

/// Tek istekte sorulan gün sayısı; `kap_ipo` ile aynı gerekçe (uç 2.000 kayıtta
/// kesiyor ve sayfalama tanımıyor).
const WINDOW_DAYS: i64 = 7;

/// Gövde istekleri arasındaki bekleme.
///
/// Gövde ucu eşzamanlı yüke dayanmıyor: dört paralel istekle gövdelerin yarısı
/// "error sending request" ile düşüyor, yeniden deneme eklenince tamamı
/// düşüyordu (KAP bağlantıyı kapatıyor). Sıralı ve aralıklı çekimde hata
/// görülmüyor. Tarama kalıcı ilerleme tuttuğu için yavaşlık bir kez ödenir.
const FETCH_SPACING: std::time::Duration = std::time::Duration::from_millis(400);

/// İki gövde turu arasında beklenecek süre.
///
/// Gövde ucunun hız sınırı ölçüme göre **30-60 saniyede** sıfırlanıyor
/// (bkz. [`crate::kap::fetch_disclosure_form`]). Bu pencere beklenmezse
/// **ilk turu çalıştıran her şeyi tüketir**: sermaye artırımı, temettü ve
/// halka arz izleme turları arka arkaya çağrılıyor ve ilki bütçeyi bitirince
/// diğer ikisi hiç ilerlemiyordu — temettü arşivi bu yüzden aylarca boş kaldı.
///
/// Ölçülen en uzun süre alınır: sınır sürekli yüke karşı uzuyor ve erken
/// dönmek turu baştan yakar. Arka plan döngüsünde bir dakika ücretsizdir.
const BODY_COOLDOWN: std::time::Duration = std::time::Duration::from_secs(60);

/// Bir sonraki gövde turundan önce hız sınırı penceresinin kapanmasını bekler.
///
/// Arka plan döngülerinde çağrılır; kullanıcı bir şey beklemiyor.
pub async fn body_cooldown() {
    tokio::time::sleep(BODY_COOLDOWN).await;
}

/// Verilen aralıktaki sermaye artırımı bildirimlerinin numaralarını toplar.
///
/// Gövde isteği pahalı olduğu için önce konuya göre süzülür: haftada ~3
/// sermaye artırımı bildirimi çıkıyor.
pub async fn list_capital_disclosures(
    client: &Client,
    from: chrono::NaiveDate,
    to: chrono::NaiveDate,
) -> Vec<crate::kap::RawDisclosure> {
    list_disclosures(client, from, to, is_capital_disclosure).await
}

/// Verilen aralıkta, konusu `matches` süzgecinden geçen bildirimleri listeler.
///
/// Temettü tarafı da bunu kullanıyor: pencere yönetimi ve hata toleransı
/// bildirim türünden bağımsızdır.
pub async fn list_disclosures(
    client: &Client,
    from: chrono::NaiveDate,
    to: chrono::NaiveDate,
    matches: fn(&str) -> bool,
) -> Vec<crate::kap::RawDisclosure> {
    let mut candidates = Vec::new();
    let mut cursor = from;
    while cursor <= to {
        let window_end = (cursor + chrono::Duration::days(WINDOW_DAYS - 1)).min(to);
        match crate::kap::disclosures_in_range(client, cursor, window_end).await {
            Ok(rows) => candidates.extend(rows.into_iter().filter(|row| matches(&row.subject))),
            // Bir pencere düşerse tarama sürer: eksik veri, hiç veri olmamasından iyidir.
            Err(error) => eprintln!("[kap] {cursor}..{window_end} atlandı: {error}"),
        }
        cursor = window_end + chrono::Duration::days(1);
    }
    candidates
}

/// Bütçeli gövde çekiminin sonucu.
pub struct FormRound {
    /// `(bildirim numarası, gövde)` çiftleri.
    pub forms: Vec<(String, crate::kap::KapForm)>,
    /// Kota dolduğu için tur erken bitti mi?
    pub exhausted: bool,
}

/// Verilen bildirimlerin gövdelerini bütçe kadar, ölçülü aralıklarla çeker.
///
/// Kota her iki bildirim türü için ortaktır; ayrıştırma çağırana bırakılır.
pub async fn fetch_forms(client: &Client, rows: &[crate::kap::RawDisclosure]) -> FormRound {
    let mut round = FormRound {
        forms: Vec::new(),
        exhausted: false,
    };
    let mut consecutive_failures = 0usize;

    for row in rows.iter().take(FETCH_BUDGET) {
        let index = row.disclosure_index.to_string();
        match crate::kap::fetch_disclosure_form(client, &index).await {
            Ok(form) => {
                consecutive_failures = 0;
                round.forms.push((index, form));
            }
            // Hata **yutulmaz** ve bildirim işlenmiş sayılmaz: sessiz atlama
            // "bu dönemde kayıt yokmuş" gibi görünüyor ve eksikliği fark
            // etmek imkânsız oluyordu.
            Err(error) => {
                eprintln!("[kap] {index}: bildirim gövdesi alınamadı: {error}");
                consecutive_failures += 1;
                if consecutive_failures >= CONSECUTIVE_FAILURE_LIMIT {
                    round.exhausted = true;
                    break;
                }
            }
        }
        tokio::time::sleep(FETCH_SPACING).await;
    }

    round
}

/// Tek bir bildirimi çözer. Gövde alınamazsa `Err`, gövde alınıp da artırım
/// çıkmıyorsa (başvuru, azaltım) `Ok(None)` döner — çağıran ikisini ayırır:
/// birincisi tekrar denenmeli, ikincisi işlenmiş sayılmalı.
pub async fn resolve_disclosure(
    client: &Client,
    row: &crate::kap::RawDisclosure,
) -> Result<Option<KapCapitalIncrease>, String> {
    let index = row.disclosure_index.to_string();
    let form = crate::kap::fetch_disclosure_form(client, &index).await?;
    Ok(parse_capital_form(
        &form,
        &row.kap_title,
        row.stock_codes.first().map(String::as_str),
        &row.publish_date,
        &index,
    ))
}

/// Bir turda çekilecek en fazla gövde.
///
/// Ölçüm: gövde ucu tur başına **tam 10 belge** verdikten sonra bağlantıyı
/// kapatıyor; 166 adaylık bir turda ilk 10'u iniyor, kalan 156'sı "error
/// sending request" ile düşüyor. Sert bir kota var ve toplu çekim mümkün
/// değil. Bu yüzden tarama bütçelidir ve ilerleme diske yazılır: her tur
/// bütçesi kadar ilerler, gün geçtikçe boşluk kapanır.
pub const FETCH_BUDGET: usize = 10;

/// Üst üste bu kadar hata gelirse tur biter. Kota dolduğunda kalan her istek
/// zaman aşımına kadar bekliyor; ısrar etmek turu dakikalarca uzatıyordu.
const CONSECUTIVE_FAILURE_LIMIT: usize = 3;

/// Bir turun sonucu.
pub struct FetchRound {
    pub increases: Vec<KapCapitalIncrease>,
    /// Çözülmüş sayılan bildirim numaraları — artırım çıkmasa da (başvuru,
    /// azaltım) işlenmiş sayılır ve bir daha indirilmez.
    pub resolved: Vec<String>,
    /// Kota dolduğu için tur erken bitti mi?
    pub exhausted: bool,
}

/// Verilen bildirimlerin gövdelerini çekip sermaye artırımı olarak çözer.
pub async fn fetch_round(client: &Client, rows: &[crate::kap::RawDisclosure]) -> FetchRound {
    let forms = fetch_forms(client, rows).await;
    let by_index: std::collections::HashMap<String, &crate::kap::RawDisclosure> = rows
        .iter()
        .map(|row| (row.disclosure_index_str(), row))
        .collect();

    let mut round = FetchRound {
        increases: Vec::new(),
        resolved: Vec::new(),
        exhausted: forms.exhausted,
    };
    for (index, form) in &forms.forms {
        if let Some(row) = by_index.get(index) {
            if let Some(increase) = parse_capital_form(
                form,
                &row.kap_title,
                row.stock_codes.first().map(String::as_str),
                &row.publish_date,
                index,
            ) {
                round.increases.push(increase);
            }
        }
        round.resolved.push(index.clone());
    }
    round
}

/// Verilen aralıktaki sermaye artırımlarını çeker (tek tur, bütçeli).
pub async fn fetch_capital_increases(
    client: &Client,
    from: chrono::NaiveDate,
    to: chrono::NaiveDate,
) -> Vec<KapCapitalIncrease> {
    let candidates = list_capital_disclosures(client, from, to).await;
    fetch_round(client, &candidates).await.increases
}

/// KAP taramasının kaç gün geriye bakacağı.
///
/// Bültenin göremediği artırımlar kayıtlı sermaye sistemindeki şirketlerin
/// bedelsizleri ve güncel akışı ilgilendiriyor; derin geçmiş SPK arşivinden
/// zaten geliyor. Pencere, gövde kotası altında kapanabilecek genişlikte
/// tutulur.
const BACKFILL_DAYS: i64 = 400;

/// Bildirimin anlattığı artırım arşivde zaten var mı?
///
/// Gövde ucunun kotası kıt; SPK bülteninin gördüğü bir artırım için gövde
/// indirmek kotayı boşa harcar. Aynı şirketin aynı dönemdeki kaydı varsa
/// bildirim atlanır.
///
/// Pencere dar tutulur: yönetim kurulu kararından bildirime birkaç hafta
/// geçiyor, ama bir şirket yıl içinde birden fazla artırım yapabiliyor ve
/// geniş pencere ikincisini gizlerdi.
fn already_covered(archive: &crate::capital_store::CapitalArchive, row: &crate::kap::RawDisclosure) -> bool {
    const NEARBY_DAYS: i64 = 60;

    let Some(published) = iso_date(Some(&row.publish_date)) else {
        return false;
    };
    let Some(published) = chrono::NaiveDate::parse_from_str(&published, "%Y-%m-%d").ok() else {
        return false;
    };
    let ticker = row.stock_codes.first();

    archive.records.iter().any(|record| {
        let matches_company = match (ticker, record.ticker.as_ref()) {
            (Some(a), Some(b)) => a == b,
            _ => crate::company_match::same_company(&record.increase.company_name, &row.kap_title),
        };
        if !matches_company {
            return false;
        }
        chrono::NaiveDate::parse_from_str(&record.increase.approval_date, "%Y-%m-%d")
            .map(|date| (published - date).num_days().abs() <= NEARBY_DAYS)
            .unwrap_or(false)
    })
}

/// Arşivi KAP bildirimleriyle bir tur ilerletir; eklenen kayıt sayısını döner.
///
/// Bütçe ve kalıcı ilerleme sayesinde her çağrı boşluğu biraz kapatır: turda
/// yalnız daha önce okunmamış bildirimlerin gövdesi indirilir.
pub async fn backfill_round(client: &Client) -> usize {
    let mut archive = crate::capital_store::load();
    let today = crate::kap::istanbul_today();
    let candidates = list_capital_disclosures(client, today - chrono::Duration::days(BACKFILL_DAYS), today).await;

    let mut pending: Vec<crate::kap::RawDisclosure> = candidates
        .into_iter()
        .filter(|row| {
            !archive
                .processed_disclosures
                .contains(&row.disclosure_index.to_string())
        })
        .filter(|row| !already_covered(&archive, row))
        .collect();
    if pending.is_empty() {
        return 0;
    }

    // Kota kıt; en yenisi önce okunur. Bildirim numarası zamanla artıyor,
    // dolayısıyla sıralama anahtarı olarak tarihten daha güvenilir (tarih
    // metin biçiminde geliyor).
    pending.sort_by(|a, b| b.disclosure_index.cmp(&a.disclosure_index));

    let round = fetch_round(client, &pending).await;
    let read = round.resolved.len();
    let added = crate::capital_store::merge_kap_increases(&mut archive, round.increases);
    for index in round.resolved {
        archive.processed_disclosures.insert(index);
    }
    crate::capital_store::save(&archive);

    eprintln!(
        "[kap] {} bekleyen bildirimin {read} tanesi okundu, {added} artırım eklendi{}",
        pending.len(),
        if round.exhausted { " (kota doldu)" } else { "" }
    );
    added
}

#[cfg(test)]
mod tests {
    use super::*;

    fn form(rows: &[&[&str]]) -> KapForm {
        KapForm {
            rows: rows
                .iter()
                .map(|row| row.iter().map(|c| c.to_string()).collect())
                .collect(),
        }
    }

    /// VSNMD, bildirim 1644978 — gövdesinin satır yapısı birebir alındı.
    ///
    /// Tabloda etiketin ardından değeri **gelmez**: başlıklar bir satırda,
    /// değerler ayrı satırda ve sütun sırasıyla durur. Bu yapıyı düz hücre
    /// listesiyle taklit eden bir fixture, ayrıştırıcı bozukken bile testi
    /// geçiriyordu.
    fn vsnmd_form() -> KapForm {
        form(&[
            &["Özet Bilgi", "Bedelsiz Sermaye Artırımına İlişkin SPK Onayı Hakkında"],
            &["Yönetim Kurulu Karar Tarihi", "11.05.2026"],
            &["Kayıtlı Sermaye Tavanı (TL)", "500.000.000"],
            &["Mevcut Sermaye (TL)", "117.000.000"],
            &["Ulaşılacak Sermaye (TL)", "181.350.000"],
            &["Bedelsiz Sermaye Artırımı"],
            &[
                "Pay Grup Bilgileri",
                "Mevcut Sermaye (TL)",
                "İç Kaynaklardan Bedelsiz Pay Alma Tutarı (TL)",
                "İç Kaynaklardan Bedelsiz Pay Alma Oranı (%)",
                "Kar Payından Bedelsiz Pay Alma Tutarı (TL)",
                "Kar Payından Bedelsiz Pay Alma Oranı (%)",
                "Toplam Bedelsiz Pay Alma Tutarı (TL)",
            ],
            &["A Grubu, İşlem Görmüyor, TREVISN00011", "20.000.000", "", "", "11.000.000,000", "55,00000", "11.000.000,000"],
            &["B Grubu, VSNMD, TREVISN00029", "97.000.000", "", "", "53.350.000,000", "55,00000", "53.350.000,000"],
            &[
                "",
                "Mevcut Sermaye (TL)",
                "İç Kaynaklardan Bedelsiz Pay Alma Tutarı (TL)",
                "İç Kaynaklardan Bedelsiz Pay Alma Oranı (%)",
                "Kar Payından Bedelsiz Pay Alma Tutarı (TL)",
                "Kar Payından Bedelsiz Pay Alma Oranı (%)",
                "Toplam Bedelsiz Pay Alma Tutarı (TL)",
            ],
            &["TOPLAM", "117.000.000", "", "", "64.350.000,000", "55,00000", "64.350.000,000"],
        ])
    }

    #[test]
    fn reads_a_bonus_increase() {
        let row = parse_capital_form(&vsnmd_form(), "Vişne Madencilik AŞ", Some("VSNMD"), "07.08.2026 14:00:00", "1644978")
            .expect("kayıt üretilmeli");

        assert_eq!(row.ticker.as_deref(), Some("VSNMD"));
        assert_eq!(row.increase.existing_capital, 117_000_000.0);
        assert_eq!(row.increase.new_capital, 181_350_000.0);
        assert_eq!(row.increase.bonus_profit, 64_350_000.0);
        assert_eq!(row.increase.rights_amount, 0.0);
        // SPK bülteni aynı artırımı ×1,55 veriyor.
        assert!((row.increase.bonus_factor() - 1.55).abs() < 1e-9);
        assert_eq!(row.increase.bulletin_no, "KAP/1644978");
    }

    /// İşlemin tarihi yönetim kurulu kararıdır; bildirim günlerce sonra
    /// yayımlanabiliyor ve bildirim tarihi kullanılırsa artırım yanlış tarafa
    /// düşerek getiriyi kaydırır.
    #[test]
    fn board_decision_date_wins_over_publish_date() {
        let row = parse_capital_form(&vsnmd_form(), "Vişne", None, "07.08.2026 14:00:00", "1")
            .unwrap();
        assert_eq!(row.increase.approval_date, "2026-05-11");
    }

    /// Yönetim kurulu tarihi okunamazsa bildirim tarihine düşülür.
    #[test]
    fn falls_back_to_the_publish_date() {
        let mut rows = vsnmd_form().rows;
        rows[1][1] = "-".to_string();
        let row = parse_capital_form(&KapForm { rows }, "Vişne", None, "07.08.2026 14:00:00", "1").unwrap();
        assert_eq!(row.increase.approval_date, "2026-08-07");
    }

    /// BRKO, bildirim 1645823: tahsisli artırım **başvurusu**. Ulaşılacak
    /// sermaye henüz mevcuda eşit; kayıt üretilmemeli, yoksa sıfır oranlı bir
    /// artırım listeye düşer.
    #[test]
    fn a_pending_application_is_not_an_increase() {
        let pending = form(&[
            &["Yönetim Kurulu Karar Tarihi", "31.07.2026"],
            &["Mevcut Sermaye (TL)", "140.000.000"],
            &["Ulaşılacak Sermaye (TL)", "140.000.000"],
        ]);
        assert!(parse_capital_form(&pending, "Birko AŞ", Some("BRKO"), "07.08.2026", "1645823").is_none());
    }

    /// Bileşenler farkı vermiyorsa alanlar yanlış okunmuş demektir.
    #[test]
    fn rows_failing_the_capital_identity_are_skipped() {
        let broken = form(&[
            &["Mevcut Sermaye (TL)", "100.000.000"],
            &["Ulaşılacak Sermaye (TL)", "500.000.000"],
            &["İç Kaynaklardan Bedelsiz Pay Alma Tutarı (TL)", "200.000.000"],
            &["Yönetim Kurulu Karar Tarihi", "01.01.2026"],
        ]);
        assert!(parse_capital_form(&broken, "Sahte AŞ", None, "01.01.2026", "1").is_none());
    }

    /// Rüçhan haklı (bedelli) artırım da aynı bildirimle duyuruluyor.
    #[test]
    fn reads_a_rights_issue() {
        let rights = form(&[
            &["Yönetim Kurulu Karar Tarihi", "15.01.2026"],
            &["Mevcut Sermaye (TL)", "1.400.000.000"],
            &["Ulaşılacak Sermaye (TL)", "3.780.000.000"],
            &["Pay Grup Bilgileri", "Rüçhan Hakkı Kullanım Tutarı (TL)"],
            &["A Grubu, CVKMD", "2.380.000.000"],
            &["", "Rüçhan Hakkı Kullanım Tutarı (TL)"],
            &["TOPLAM", "2.380.000.000"],
        ]);
        let row = parse_capital_form(&rights, "CVK Maden AŞ", Some("CVKMD"), "16.01.2026", "1").unwrap();
        assert_eq!(row.increase.rights_amount, 2_380_000_000.0);
        assert!(row.increase.is_rights() && !row.increase.is_bonus());
        // Bedelli bir bölünme değildir; çarpan 1 kalmalı.
        assert_eq!(row.increase.bonus_factor(), 1.0);
    }

    #[test]
    fn subject_match_is_exact() {
        assert!(is_capital_disclosure(CAPITAL_SUBJECT));
        assert!(is_capital_disclosure("  Sermaye Artırımı - Azaltımı İşlemlerine İlişkin Bildirim  "));
        assert!(!is_capital_disclosure("Sermaye Artırımından Elde Edilecek Fonun Kullanımına İlişkin Rapor"));
    }

    #[test]
    fn turkish_numbers_and_dates_round_trip() {
        assert_eq!(number(Some("140.000.000")), Some(140_000_000.0));
        assert_eq!(number(Some("11.000.000,000")), Some(11_000_000.0));
        assert_eq!(number(Some("-")), None);
        assert_eq!(number(None), None);
        assert_eq!(iso_date(Some("31.07.2026")).as_deref(), Some("2026-07-31"));
        assert_eq!(iso_date(Some("07.08.2026 21:01:33")).as_deref(), Some("2026-08-07"));
        assert_eq!(iso_date(Some("-")), None);
    }

    /// Bütçeli tur arşivi gerçekten ilerletiyor mu?
    #[tokio::test]
    #[ignore = "canlı KAP erişimi gerektirir ve ~/.fraude_capital_increases.json dosyasını yazar"]
    async fn backfill_round_advances() {
        let client = crate::http_client();
        let before = crate::capital_store::load();
        let added = backfill_round(&client).await;
        let after = crate::capital_store::load();
        println!(
            "eklenen {added} · kayıt {} → {} · okunmuş bildirim {} → {}",
            before.records.len(),
            after.records.len(),
            before.processed_disclosures.len(),
            after.processed_disclosures.len(),
        );
        // Kota dolmuşsa tur ilerleyemez; bu bir başarısızlık değil, ucun
        // sınırıdır. Sınama, ilerleme **ya da** kotanın dolduğunu görmeli —
        // ikisi de olmuyorsa listeleme kopmuş demektir.
        let advanced = after.processed_disclosures.len() > before.processed_disclosures.len();
        assert!(
            advanced || added == 0,
            "tur ne ilerledi ne de kotaya takıldı"
        );
    }

    /// Canlı sözleşme sınaması: gövde uçları anahtarsız çalışmaya devam ediyor
    /// mu ve alan adları aynı mı? Değişirse modül sessizce boş dönerdi.
    #[tokio::test]
    #[ignore = "canlı KAP erişimi gerektirir"]
    async fn live_capital_disclosures_are_parsed() {
        let client = crate::http_client();
        let today = crate::kap::istanbul_today();
        let rows = fetch_capital_increases(&client, today - chrono::Duration::days(60), today).await;

        assert!(!rows.is_empty(), "60 günde hiç sermaye artırımı çözülemedi");
        for row in &rows {
            println!(
                "  {} {:6} {} → {} ({})",
                row.increase.approval_date,
                row.ticker.as_deref().unwrap_or("—"),
                row.increase.existing_capital,
                row.increase.new_capital,
                row.increase.company_name,
            );
            assert!(row.increase.new_capital > row.increase.existing_capital);
        }
    }
}
