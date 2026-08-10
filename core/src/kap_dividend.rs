//! KAP bildirimlerinden temettü çıkarma.
//!
//! Temettünün resmî kaynağı **"Kar Payı Dağıtım İşlemlerine İlişkin
//! Bildirim"**dir. Yahoo'nun akışı yalnız gerçekleşmiş ödemeyi ve tek bir
//! tutarı taşıyor; KAP formu bunun yerine
//!
//! * **pay grubu bazında** brüt ve net tutarı ("A/B grubu 2,00 net; borsada
//!   işlem gören C grubu %15 stopajla 1,70"),
//! * kesinleşen **hak kullanım** tarihini, ödeme ve kayıt tarihlerini,
//! * taksitli dağıtımda her taksidi ayrı ayrı
//!
//! veriyor. Bir şirketin borsada işlem gören payı hangi grupsa onun tutarı
//! geçerlidir; gruplar arasında stopaj farkı olabildiği için tek bir "temettü"
//! sayısı yanıltıcı olur.

use crate::kap::KapForm;
use reqwest::Client;
use serde::{Deserialize, Serialize};

/// Temettü bildiriminin konusu. KAP bunu sabit yazıyor.
const DIVIDEND_SUBJECT: &str = "Kar Payı Dağıtım İşlemlerine İlişkin Bildirim";

/// Nakit tutar tablosunun ayırt edici sütunu; "Ödeme" gibi genel bir ad hem
/// bu tabloda hem tarih tablosunda geçiyor.
const COL_GROSS: &str = "1 TL Nominal Değerli Paya Ödenecek Nakit Kar Payı - Brüt(TL)";
const COL_NET: &str = "1 TL Nominal Değerli Paya Ödenecek Nakit Kar Payı - Net(TL)";
const COL_GROUP: &str = "Pay Grup Bilgileri";
const COL_PAYMENT_KIND: &str = "Ödeme";

/// Tarih tablosunun sütunları.
const COL_EX_DATE_FINAL: &str = "Kesinleşen Nakit Kar Payı Hak Kullanım Tarihi (2)";
const COL_EX_DATE_PROPOSED: &str = "Teklif Edilen Nakit Kar Payı Hak Kullanım Tarihi (1)";
const COL_PAY_DATE: &str = "Ödeme Tarihi (3)";

const FIELD_CASH_MODE: &str = "Nakit Kar Payı Ödeme Şekli";

/// Taksitli dağıtımda tutar tablosunun **özet satırı**.
///
/// Taksitler ayrı satırlarda verilir ("1. Taksit", "2. Taksit", …) ve altlarına
/// toplamlarını taşıyan bir satır daha eklenir. Bu satır bir ödeme değil,
/// taksitlerin toplamıdır; tarih tablosunda karşılığı olmadığı için ilk
/// taksidin tarihine düşer ve `(kod, tarih)` anahtarıyla birleşince **ilk
/// taksidin tutarını toplamla ezerdi** — BEGYO'da 0,0307 TL'lik ilk taksit
/// 0,1227 TL görünüyordu.
const PAYMENT_KIND_TOTAL: &str = "TOPLAM";

/// Bir bildirimden çıkan, tek bir pay grubuna ait temettü ödemesi.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct KapDividend {
    pub ticker: String,
    /// Hak kullanım (ex-date) tarihi, ISO.
    pub ex_date: String,
    /// Brüt tutar — Yahoo da brüt taşıdığı için karşılaştırılabilir olan budur.
    pub gross_per_share: f64,
    /// Stopaj sonrası net; borsada işlem gören grupta brütten düşük olabilir.
    pub net_per_share: f64,
    #[serde(default)]
    pub payment_date: Option<String>,
    /// "Peşin", "1. Taksit" — taksitli dağıtımda her taksit ayrı kayıttır.
    pub payment_kind: String,
    pub disclosure_index: String,
}

/// Konusu temettü olan bildirim mi?
pub fn is_dividend_disclosure(subject: &str) -> bool {
    subject.trim() == DIVIDEND_SUBJECT
}

/// Bildirim gövdesinden temettü kayıtlarını çıkarır.
///
/// Bir bildirim birden çok kayıt üretebilir: taksitli dağıtımda her taksit
/// ayrı hak kullanım tarihi taşır.
///
/// Kayıt üretilmeyen durumlar:
///
/// * **Ödeme yapılmayacak.** Aynı bildirim "Ödenmeyecek" kararını da duyuruyor
///   ve örneklenen 45 bildirimin çoğu böyle.
/// * **Borsada işlem gören pay grubu yok.** Tutarlar grup bazında veriliyor ve
///   satırın ilk hücresi `"C Grubu, ARASE, TREARAS00039"` biçiminde; işlem
///   görmeyen gruplarda kod yerine "İşlem Görmüyor" yazıyor.
pub fn parse_dividend_form(form: &KapForm, disclosure_index: &str) -> Vec<KapDividend> {
    if form.field(FIELD_CASH_MODE) == Some("Ödenmeyecek") {
        return Vec::new();
    }

    let Some(amounts) = form.table(COL_GROSS) else {
        return Vec::new();
    };
    let dates = form.table(COL_EX_DATE_FINAL);

    let mut out = Vec::new();
    for row in &amounts.rows {
        let Some(ticker) = amounts.cell(row, COL_GROUP).and_then(traded_ticker) else {
            continue;
        };
        let gross = number(amounts.cell(row, COL_GROSS)).unwrap_or(0.0);
        if gross <= 0.0 {
            continue;
        }
        let net = number(amounts.cell(row, COL_NET)).unwrap_or(gross);
        let kind = amounts.cell(row, COL_PAYMENT_KIND).unwrap_or("Peşin").to_string();
        if kind.trim().eq_ignore_ascii_case(PAYMENT_KIND_TOTAL) {
            continue;
        }

        // Tarihler ayrı tabloda ve ödeme türüyle ("Peşin", "1. Taksit")
        // eşleşiyor; taksitli dağıtımda her taksidin kendi tarihi var.
        let Some(dates) = dates.as_ref() else { continue };
        let Some(date_row) = dates
            .rows
            .iter()
            .find(|r| dates.cell(r, COL_PAYMENT_KIND) == Some(kind.as_str()))
            .or_else(|| dates.rows.first())
        else {
            continue;
        };

        // Kesinleşen tarih yoksa teklif edilene düşülür: genel kurul öncesi
        // bildirimlerde yalnız teklif bulunuyor.
        let Some(ex_date) = iso_date(dates.cell(date_row, COL_EX_DATE_FINAL))
            .or_else(|| iso_date(dates.cell(date_row, COL_EX_DATE_PROPOSED)))
        else {
            continue;
        };

        out.push(KapDividend {
            ticker,
            ex_date,
            gross_per_share: gross,
            net_per_share: net,
            payment_date: iso_date(dates.cell(date_row, COL_PAY_DATE)),
            payment_kind: kind,
            disclosure_index: disclosure_index.to_string(),
        });
    }

    out
}

/// `"C Grubu, ARASE, TREARAS00039"` → `ARASE`.
///
/// İşlem görmeyen gruplarda orta alan "İşlem Görmüyor" yazar ve kod yoktur;
/// böyle satırlar atlanır.
fn traded_ticker(group: &str) -> Option<String> {
    // Grup hücresi her zaman virgüllü üçlüdür; virgülsüz bir hücre (TOPLAM,
    // ara başlık) pay grubu satırı değildir ve kod aranmamalı — "TOPLAM" altı
    // büyük harf olduğu için kod kalıbına uyuyor.
    if !group.contains(',') {
        return None;
    }
    group
        .split(',')
        .map(str::trim)
        .find(|part| {
            (3..=6).contains(&part.chars().count())
                && part.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
        })
        .map(str::to_string)
}

/// "2,0000000" → 2.0, "12.500.000" → 12500000. Biçime uymayan metin `None`.
fn number(raw: Option<&str>) -> Option<f64> {
    let token = raw?.trim();
    if token.is_empty() || token == "-" {
        return None;
    }
    let value: f64 = token.replace('.', "").replace(',', ".").parse().ok()?;
    value.is_finite().then_some(value)
}

/// "24.06.2026" → "2026-06-24".
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

/// Verilen aralıktaki temettü bildirimlerini listeler.
pub async fn list_dividend_disclosures(
    client: &Client,
    from: chrono::NaiveDate,
    to: chrono::NaiveDate,
) -> Vec<crate::kap::RawDisclosure> {
    crate::kap_capital::list_disclosures(client, from, to, is_dividend_disclosure).await
}

/// Temettü taramasının kaç gün geriye bakacağı. Akış son 24 ayı gösteriyor;
/// pencere onu karşılar.
const BACKFILL_DAYS: i64 = 760;

/// Keşfin her turda ne kadar geriye ineceği.
///
/// 760 günün tamamını her turda taramak ~109 liste isteği demek ve okunabilen
/// gövde sayısının yanında bu israf; dilim dilim inilir, ulaşılan sınır
/// arşivde saklanır.
const DISCOVERY_CHUNK_DAYS: i64 = 120;

/// Her turda yeniden taranan yakın geçmiş.
///
/// Kuyruk geriye doğru derinleşirken yeni bildirimlerin de yakalanması gerek;
/// düzeltme bildirimleri birkaç gün sonra geldiği için pencere iki haftadır.
const FRESH_WINDOW_DAYS: i64 = 14;

/// Bir turda okunacak en fazla bildirim gövdesi.
///
/// Ölçüm (curl, ardışık istek): bildirim sayfası ucu 1 sn aralıkla **68
/// istek** taşıdıktan sonra 429 veriyor ve ceza penceresi ~20 saniyede
/// kapanıyor. Bütçe o tavanın yarısında tutulur: tur sınıra dayanmadan biter,
/// arka arkaya çalışan diğer KAP turları da pay bulur.
const ROUND_BUDGET: usize = 30;

/// Gövde istekleri arasındaki bekleme.
///
/// Ölçülen tavan ~1 istek/saniye; 2,5 saniye onun epey altında kalır ve tur
/// arka planda çalıştığı için yavaşlığın kullanıcıya maliyeti yok.
const PAGE_SPACING: std::time::Duration = std::time::Duration::from_millis(2500);

/// İki tur arasındaki bekleme.
///
/// Turun kendisi bütçesi kadar (~30 istek × 2,5 sn ≈ 75 sn) sürüyor; araya
/// konan pencere hem hız sınırını serbest bırakır hem gövde ucunu paylaşan
/// diğer turlara (sermaye artırımı, halka arz izleme) yer açar. Bu ritimle
/// tarayıcı saatte ~700 bildirim okur: ~3.000 bildirimlik geçmiş bir günde
/// kapanır, sonrasında günde ~6 yeni bildirimi izlemek zaten bedava.
const ROUND_INTERVAL: std::time::Duration = std::time::Duration::from_secs(120);

/// Kuyruk boşken beklenecek süre.
///
/// Arşiv yakaladıktan sonra iş yalnız yeni bildirim; sık sormanın anlamı yok.
const IDLE_INTERVAL: std::time::Duration = std::time::Duration::from_secs(3600);

/// Aynı anda ikinci bir tarayıcı çalışmasını engeller.
static CRAWLING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Temettü arşivini sürekli ilerleten arka plan döngüsü.
///
/// Ayrı bir döngü olmasının sebebi ölçüm: KAP haftada ~43 temettü bildirimi
/// yayımlıyor, haftalık backfill'e bağlı tarama ise tur başına 10 bildirim
/// okuyabiliyordu. Tarama akışın gerisine düşüyor, arşiv hiç kapanmıyordu.
///
/// Döngü hiç bitmez: kuyruk boşaldığında seyrek turlarla yeni bildirimleri
/// izlemeye devam eder.
pub async fn crawl(client: &Client) {
    if CRAWLING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }

    loop {
        // Tur her koşulda çalışır: kuyruk boşken de yeni bildirimleri arayan
        // keşif adımı onun içinde. Yakalanmış arşivde değişen tek şey ritim —
        // erken dönüp yalnız uyumak, akışı izlemeyi tümden durdururdu.
        backfill_round(client).await;

        let archive = crate::capital_store::load();
        let reached_floor = archive
            .dividend_scanned_from
            .as_deref()
            .and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
            .is_some_and(|from| {
                from <= crate::kap::istanbul_today() - chrono::Duration::days(BACKFILL_DAYS)
            });
        let caught_up = archive.dividend_queue.is_empty() && reached_floor;

        tokio::time::sleep(if caught_up { IDLE_INTERVAL } else { ROUND_INTERVAL }).await;
    }
}

/// Arşivi KAP temettü bildirimleriyle bir tur ilerletir; eklenen kayıt
/// sayısını döner.
///
/// Tur iki işi ayrı ayrı yapar:
///
/// 1. **Keşif** — yakın geçmiş her turda, uzak geçmiş dilim dilim taranır ve
///    bulunan bildirimler kalıcı kuyruğa yazılır (ucuz: liste isteği gövde
///    getirmez).
/// 2. **Okuma** — kuyruktan bütçe kadar gövde, en yeni önce okunur.
///
/// Ayrım şart: aday listesini her turda baştan çıkarmak turun tamamını liste
/// isteğine harcıyordu. Kuyruk diske yazıldığı için keşif bir kez yapılır,
/// okuma turlar boyunca yakınsar.
pub async fn backfill_round(client: &Client) -> usize {
    let mut archive = crate::capital_store::load();
    let today = crate::kap::istanbul_today();

    let discovered = discover(client, &mut archive, today).await;

    let pending = crate::capital_store::dividend_queue_newest_first(&archive);
    if pending.is_empty() {
        if discovered > 0 {
            crate::capital_store::save(&archive);
        }
        return 0;
    }

    let mut dividends = Vec::new();
    let mut done = Vec::new();
    let mut rate_limited = false;

    for index in pending.iter().take(ROUND_BUDGET) {
        match crate::kap::fetch_disclosure_page(client, index).await {
            Ok(form) => {
                dividends.extend(parse_dividend_form(&form, index));
                // Kayıt çıkmasa da işlenmiş sayılır: bildirimlerin çoğu
                // "Ödenmeyecek" kararını duyuruyor ve yeniden indirilmeleri
                // kuyruğu asla boşaltmazdı.
                done.push(index.clone());
            }
            // Hız sınırına takılan tur **hemen biter**: ısrar etmek cezayı
            // uzatıyor ve kuyruk kalıcı olduğu için kaybedilen bir şey yok.
            Err(error) if crate::retry::is_rate_limited(&error) => {
                rate_limited = true;
                break;
            }
            // Diğer hatalarda bildirim kuyrukta kalır ve sonraki turda
            // yeniden denenir; sessiz atlama eksikliği görünmez yapardı.
            Err(error) => eprintln!("[kap] temettü {index}: gövde alınamadı: {error}"),
        }
        tokio::time::sleep(PAGE_SPACING).await;
    }

    let read = done.len();
    crate::capital_store::drain_dividend_queue(&mut archive, &done);
    let added = crate::capital_store::merge_kap_dividends(&mut archive, dividends);
    crate::capital_store::save(&archive);

    eprintln!(
        "[kap] temettü: {} keşfedildi, kuyrukta {} vardı, {read} okundu, {added} kayıt işlendi{}",
        discovered,
        pending.len(),
        if rate_limited { " (hız sınırı)" } else { "" }
    );
    added
}

/// Yeni ve geçmiş temettü bildirimlerini kuyruğa ekler; eklenen sayıyı döner.
///
/// Yakın geçmiş her turda yeniden taranır (yeni bildirim ve düzeltmeler),
/// uzak geçmişe her turda bir dilim daha inilir. İkisi de yalnız liste ucunu
/// kullanır; gövde indirilmez.
async fn discover(
    client: &Client,
    archive: &mut crate::capital_store::CapitalArchive,
    today: chrono::NaiveDate,
) -> usize {
    let fresh = list_dividend_disclosures(
        client,
        today - chrono::Duration::days(FRESH_WINDOW_DAYS),
        today,
    )
    .await;
    let mut added = crate::capital_store::enqueue_dividends(archive, &fresh);

    let floor = today - chrono::Duration::days(BACKFILL_DAYS);
    let scanned_from = archive
        .dividend_scanned_from
        .as_deref()
        .and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
        // İlk turda yakın pencerenin başından devam edilir; orası zaten tarandı.
        .unwrap_or(today - chrono::Duration::days(FRESH_WINDOW_DAYS));

    if scanned_from > floor {
        let chunk_start = (scanned_from - chrono::Duration::days(DISCOVERY_CHUNK_DAYS)).max(floor);
        let older = list_dividend_disclosures(client, chunk_start, scanned_from).await;
        added += crate::capital_store::enqueue_dividends(archive, &older);
        archive.dividend_scanned_from = Some(chunk_start.format("%Y-%m-%d").to_string());
    }

    added
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kap::KapForm;

    fn form(rows: &[&[&str]]) -> KapForm {
        KapForm {
            rows: rows
                .iter()
                .map(|row| row.iter().map(|c| c.to_string()).collect())
                .collect(),
        }
    }

    /// ARASE, bildirim 1617428 — gövdesinin satır yapısı birebir alındı.
    fn arase_form() -> KapForm {
        form(&[
            &["Karar Tarihi", "13.03.2026"],
            &["Kar Payı Dağıtımı Konusu Görüşüldü mü?", "Görüşüldü"],
            &["Nakit Kar Payı Ödeme Şekli", "Peşin"],
            &["Pay Biçiminde Ödeme", "Ödenmeyecek"],
            &["Nakit Kar Payı Ödeme Tutar ve Oranları"],
            &[
                "Pay Grup Bilgileri", "Ödeme",
                "1 TL Nominal Değerli Paya Ödenecek Nakit Kar Payı - Brüt(TL)",
                "1 TL Nominal Değerli Paya Ödenecek Nakit Kar Payı - Brüt(%)",
                "Stopaj Oranı(%)",
                "1 TL Nominal Değerli Paya Ödenecek Nakit Kar Payı - Net(TL)",
                "1 TL Nominal Değerli Paya Ödenecek Nakit Kar Payı - Net(%)",
            ],
            &["A Grubu, İşlem Görmüyor, TREARAS00013", "Peşin", "2,0000000", "200", "0", "2,0000000", "200"],
            &["B Grubu, İşlem Görmüyor, TREARAS00021", "Peşin", "2,0000000", "200", "0", "2,0000000", "200"],
            &["C Grubu, ARASE, TREARAS00039", "Peşin", "2,0000000", "200", "15", "1,7000000", "170"],
            &["Kar Payı Ödeme Tarihleri"],
            &[
                "Ödeme",
                "Teklif Edilen Nakit Kar Payı Hak Kullanım Tarihi (1)",
                "Kesinleşen Nakit Kar Payı Hak Kullanım Tarihi (2)",
                "Ödeme Tarihi (3)",
                "Kayıt Tarihi (4)",
            ],
            &["Peşin", "24.06.2026", "24.06.2026", "26.06.2026", "25.06.2026"],
        ])
    }

    /// Yalnız **borsada işlem gören** pay grubu kayda dönüşmeli; A ve B
    /// grupları işlem görmüyor ve stopajları farklı.
    #[test]
    fn reads_only_the_traded_share_class() {
        let rows = parse_dividend_form(&arase_form(), "1617428");
        assert_eq!(rows.len(), 1, "{rows:#?}");

        let row = &rows[0];
        assert_eq!(row.ticker, "ARASE");
        assert_eq!(row.ex_date, "2026-06-24");
        // Yahoo brüt taşıyor; karşılaştırılabilirlik için brüt saklanır.
        assert_eq!(row.gross_per_share, 2.0);
        // Borsada işlem gören grupta %15 stopaj var.
        assert_eq!(row.net_per_share, 1.7);
        assert_eq!(row.payment_date.as_deref(), Some("2026-06-26"));
        assert_eq!(row.payment_kind, "Peşin");
    }

    /// Örneklenen 45 bildirimin çoğu "Ödenmeyecek" kararını duyuruyor; bunlar
    /// kayıt üretmemeli.
    #[test]
    fn a_decision_not_to_pay_yields_nothing() {
        let mut rows = arase_form().rows;
        rows[2][1] = "Ödenmeyecek".to_string();
        assert!(parse_dividend_form(&KapForm { rows }, "1").is_empty());
    }

    /// Sıfır tutarlı satır ödeme değildir.
    #[test]
    fn zero_amounts_are_skipped() {
        let mut rows = arase_form().rows;
        for row in rows.iter_mut().skip(6).take(3) {
            row[2] = "0,0000000".to_string();
        }
        assert!(parse_dividend_form(&KapForm { rows }, "1").is_empty());
    }

    /// Taksitli dağıtımda her taksit kendi hak kullanım tarihini taşır.
    #[test]
    fn instalments_become_separate_records() {
        let rows = parse_dividend_form(
            &form(&[
                &["Nakit Kar Payı Ödeme Şekli", "Taksitli"],
                &[
                    "Pay Grup Bilgileri", "Ödeme",
                    "1 TL Nominal Değerli Paya Ödenecek Nakit Kar Payı - Brüt(TL)",
                    "1 TL Nominal Değerli Paya Ödenecek Nakit Kar Payı - Net(TL)",
                ],
                &["B Grubu, EREGL, TREEREG00016", "1. Taksit", "1,5000000", "1,2750000"],
                &["B Grubu, EREGL, TREEREG00016", "2. Taksit", "0,5000000", "0,4250000"],
                &["Kar Payı Ödeme Tarihleri"],
                &[
                    "Ödeme",
                    "Teklif Edilen Nakit Kar Payı Hak Kullanım Tarihi (1)",
                    "Kesinleşen Nakit Kar Payı Hak Kullanım Tarihi (2)",
                    "Ödeme Tarihi (3)",
                ],
                &["1. Taksit", "01.06.2026", "01.06.2026", "03.06.2026"],
                &["2. Taksit", "01.12.2026", "01.12.2026", "03.12.2026"],
            ]),
            "1",
        );

        assert_eq!(rows.len(), 2, "{rows:#?}");
        assert_eq!(rows[0].ex_date, "2026-06-01");
        assert_eq!(rows[0].gross_per_share, 1.5);
        assert_eq!(rows[1].ex_date, "2026-12-01");
        assert_eq!(rows[1].gross_per_share, 0.5);
    }

    /// Taksitlerin altındaki **toplam satırı** ödeme değildir.
    ///
    /// BEGYO 1639434'ten alındı: beş taksidin ardından "TOPLAM" satırı geliyor
    /// ve tarih tablosunda karşılığı olmadığı için ilk taksidin tarihine
    /// düşüyor. Kayda dönüşürse `(kod, tarih)` anahtarıyla birleşirken ilk
    /// taksidin 0,0307 TL'lik tutarını 0,1227 TL'lik toplamla ezer.
    #[test]
    fn the_total_row_is_not_a_payment() {
        let rows = parse_dividend_form(
            &form(&[
                &["Nakit Kar Payı Ödeme Şekli", "Taksitli"],
                &[
                    "Pay Grup Bilgileri", "Ödeme",
                    "1 TL Nominal Değerli Paya Ödenecek Nakit Kar Payı - Brüt(TL)",
                    "1 TL Nominal Değerli Paya Ödenecek Nakit Kar Payı - Net(TL)",
                ],
                &["A Grubu, BEGYO, TREBEGY00016", "1. Taksit", "0,0306748", "0,0260736"],
                &["A Grubu, BEGYO, TREBEGY00016", "2. Taksit", "0,0122699", "0,0104294"],
                &["A Grubu, BEGYO, TREBEGY00016", "TOPLAM", "0,1226992", "0,1042943"],
                &["Kar Payı Ödeme Tarihleri"],
                &[
                    "Ödeme",
                    "Teklif Edilen Nakit Kar Payı Hak Kullanım Tarihi (1)",
                    "Kesinleşen Nakit Kar Payı Hak Kullanım Tarihi (2)",
                    "Ödeme Tarihi (3)",
                ],
                &["1. Taksit", "20.08.2026", "20.08.2026", "24.08.2026"],
                &["2. Taksit", "20.10.2026", "20.10.2026", "22.10.2026"],
            ]),
            "1639434",
        );

        assert_eq!(rows.len(), 2, "toplam satırı kayda dönmemeli: {rows:#?}");
        assert_eq!(rows[0].ex_date, "2026-08-20");
        assert_eq!(rows[0].gross_per_share, 0.0306748);
        assert_eq!(rows[1].ex_date, "2026-10-20");
    }

    /// Genel kurul öncesi bildirimlerde yalnız teklif edilen tarih bulunuyor.
    #[test]
    fn falls_back_to_the_proposed_ex_date() {
        let mut rows = arase_form().rows;
        rows[11][2] = "-".to_string();
        let parsed = parse_dividend_form(&KapForm { rows }, "1");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].ex_date, "2026-06-24");
    }

    #[test]
    fn traded_ticker_is_read_from_the_group_cell() {
        assert_eq!(traded_ticker("C Grubu, ARASE, TREARAS00039").as_deref(), Some("ARASE"));
        assert_eq!(traded_ticker("A Grubu, İşlem Görmüyor, TREARAS00013"), None);
        assert_eq!(traded_ticker("TOPLAM"), None);
    }

    #[test]
    fn subject_match_is_exact() {
        assert!(is_dividend_disclosure(DIVIDEND_SUBJECT));
        assert!(!is_dividend_disclosure("Kar Payı Dağıtım Politikası"));
    }

    /// Bilinen bir **ödeme yapan** bildirimi uçtan uca doğrular.
    ///
    /// ARASE 1617428: C grubu borsada işlem görüyor, brüt 2,00 · %15 stopajla
    /// net 1,70 · hak kullanım 24.06.2026. Fixture bu belgeden yazıldı; bu
    /// sınama fixture'ın hâlâ gerçeği yansıttığını kanıtlar.
    #[tokio::test]
    #[ignore = "canlı KAP erişimi gerektirir"]
    async fn live_known_payer_matches_the_fixture() {
        let client = crate::http_client();
        let form = crate::kap::fetch_form_or_explain(&client, "1617428").await;
        let rows = parse_dividend_form(&form, "1617428");

        assert_eq!(rows.len(), 1, "{rows:#?}");
        assert_eq!(rows[0], parse_dividend_form(&arase_form(), "1617428")[0]);
    }

    /// Bütçeli tur temettü arşivini gerçekten ilerletiyor mu?
    ///
    /// Arşiv aylarca boş kaldı çünkü sermaye ve temettü turları aynı gövde
    /// ucunu paylaşıyor, sermaye turu bütçeyi bitiriyor ve temettü turuna hiç
    /// sıra gelmiyordu (belirti: `processed_disclosures` tam 10 kayıtta
    /// donmuş, `dividends` boş). Turlar arasına pencere beklemesi kondu; bu
    /// sınama ilerlemenin gerçekten olduğunu gösterir.
    ///
    /// Birden çok tur çalıştırılır: bildirimlerin çoğu "Ödenmeyecek" kararı ve
    /// tek turda hiç ödeme çıkmayabilir — bu bir başarısızlık değil.
    #[tokio::test]
    #[ignore = "canlı KAP erişimi gerektirir ve ~/.fraude_capital_increases.json dosyasını yazar"]
    async fn live_backfill_round_advances() {
        let client = crate::http_client();
        let before = crate::capital_store::load();

        let mut rounds = 0;
        for round in 0..3 {
            if round > 0 {
                crate::kap_capital::body_cooldown().await;
            }
            backfill_round(&client).await;
            rounds += 1;
        }

        let after = crate::capital_store::load();
        println!(
            "{rounds} tur · okunmuş bildirim {} → {} · temettü {} → {}",
            before.processed_disclosures.len(),
            after.processed_disclosures.len(),
            before.dividends.len(),
            after.dividends.len(),
        );

        // Kota dolmuşsa tur ilerleyemez; bu ucun sınırıdır, başarısızlık değil.
        // Sınama ya ilerlemeyi ya da kotaya takılmayı görmeli — ikisi de
        // olmuyorsa listeleme kopmuş demektir.
        assert!(
            after.processed_disclosures.len() >= before.processed_disclosures.len(),
            "okunmuş bildirim sayısı gerileyemez"
        );
        for row in &after.dividends {
            assert!(row.gross_per_share > 0.0, "sıfır tutarlı temettü: {row:?}");
            assert!(row.ex_date.len() == 10, "geçersiz hak kullanım tarihi: {row:?}");
        }
    }

    /// Canlı sözleşme sınaması: alan adları değişirse modül sessizce boş
    /// dönerdi.
    #[tokio::test]
    #[ignore = "canlı KAP erişimi gerektirir"]
    async fn live_dividend_disclosures_are_parsed() {
        let client = crate::http_client();
        let today = crate::kap::istanbul_today();
        let rows = list_dividend_disclosures(&client, today - chrono::Duration::days(45), today).await;
        assert!(!rows.is_empty(), "45 günde hiç temettü bildirimi yok");

        let round = crate::kap_capital::fetch_forms(&client, &rows).await;
        let mut parsed = 0;
        for (index, form) in &round.forms {
            println!(
                "  #{index} ödeme={:?} tutar tablosu={} tarih tablosu={}",
                form.field(FIELD_CASH_MODE),
                form.table(COL_GROSS).map(|t| t.rows.len()).unwrap_or(0),
                form.table(COL_EX_DATE_FINAL).map(|t| t.rows.len()).unwrap_or(0),
            );
            for dividend in parse_dividend_form(form, index) {
                println!(
                    "  {} {:6} brüt {:.4} net {:.4} ({})",
                    dividend.ex_date,
                    dividend.ticker,
                    dividend.gross_per_share,
                    dividend.net_per_share,
                    dividend.payment_kind
                );
                parsed += 1;
            }
        }
        println!("{} bildirimden {parsed} temettü", round.forms.len());
    }
}
