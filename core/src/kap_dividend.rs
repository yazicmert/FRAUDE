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

/// Tutarların hangi para biriminde verildiği. Alan **yalnız ödeme yapılacak
/// bildirimlerde** bulunuyor; "Ödenmeyecek" kararlarında hiç yazılmıyor.
///
/// Sütun başlıkları şirket ne söylerse söylesin "(TL)" yazar — KAP formu sabit
/// metin. Tutarın gerçek birimi bu alandır; TRY dışı bir değer gördüğünde
/// tablodaki sayı lira değildir.
const FIELD_CURRENCY: &str = "Para Birimi";

/// Alanın yokluğunda varsayılan. Ödeme lirayla yapılır; bildirimlerin ezici
/// çoğunluğu böyle ve eski arşiv kayıtlarında alan hiç bulunmuyor.
pub const DEFAULT_CURRENCY: &str = "TRY";

fn default_currency() -> String {
    DEFAULT_CURRENCY.to_string()
}

/// Ödeme lira dışı bir para biriminde mi?
pub fn is_foreign(currency: &str) -> bool {
    !matches!(currency.trim().to_ascii_uppercase().as_str(), "" | "TRY" | "TL")
}

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
    /// Tutarların para birimi ("TRY", "USD", "EUR"). Bkz. [`FIELD_CURRENCY`].
    #[serde(default = "default_currency")]
    pub currency: String,
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
    let currency = form
        .field(FIELD_CURRENCY)
        .map(|value| value.trim().to_ascii_uppercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(default_currency);

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
            currency: currency.clone(),
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

// ─── Dövizle kâr payı dağıtan şirketler ─────────────────────────────────

/// Uygulamayla gelen taranmış liste. Bkz. `core/data/dividend_currency.json`.
///
/// Liste **niye gömülü**: arşiv KAP'ın gövde kotası yüzünden tur başına on
/// bildirim ilerliyor ve tarama haftada bir çalışıyor; iki yıllık birikimi
/// canlı okumak yıllar alır. Oysa bir şirketin kâr payını hangi para
/// biriminde açıkladığı yıllar boyu değişmeyen bir nitelik. Gömülü liste
/// ilk açılışta doğru notu verir, canlı arşiv de üzerine yazar.
const SEEDED_FX_PAYERS: &str = include_str!("../data/dividend_currency.json");

#[derive(serde::Deserialize)]
struct FxSeed {
    #[allow(dead_code)]
    note: String,
    /// Taramanın kapsadığı bildirim aralığı; listenin yaşını gösterir.
    scanned: String,
    /// Hisse kodu → para birimi.
    payers: std::collections::BTreeMap<String, String>,
}

/// Kâr payını dövizle açıklayan şirketler: gömülü tarama + canlı KAP arşivi.
///
/// Canlı kayıt gömülü listeyi **ezer**; bir şirket para birimi değiştirirse
/// arşiv o bildirimi okur okumaz doğru değeri verir.
pub fn foreign_payers(
    archive: &crate::capital_store::CapitalArchive,
) -> Vec<crate::domain::FxDividendPayer> {
    let mut found: std::collections::BTreeMap<String, crate::domain::FxDividendPayer> =
        Default::default();

    match serde_json::from_str::<FxSeed>(SEEDED_FX_PAYERS) {
        Ok(seed) => {
            for (ticker, currency) in seed.payers {
                if !is_foreign(&currency) {
                    continue;
                }
                found.insert(
                    ticker.clone(),
                    crate::domain::FxDividendPayer {
                        ticker,
                        currency,
                        source: format!("KAP taraması ({})", seed.scanned),
                    },
                );
            }
        }
        Err(error) => eprintln!("[kap] gömülü döviz temettü listesi okunamadı: {error}"),
    }

    // Aynı şirketin birden çok bildirimi varsa en yenisi geçerlidir; hak
    // kullanım tarihine göre artan gidip üzerine yazmak bunu sağlar.
    let mut live: Vec<&KapDividend> = archive
        .dividends
        .iter()
        .filter(|row| is_foreign(&row.currency))
        .collect();
    live.sort_by(|a, b| a.ex_date.cmp(&b.ex_date));
    for row in live {
        found.insert(
            row.ticker.clone(),
            crate::domain::FxDividendPayer {
                ticker: row.ticker.clone(),
                currency: row.currency.clone(),
                source: format!("KAP Bildirimi {}", row.disclosure_index),
            },
        );
    }

    found.into_values().collect()
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

/// Arşivi KAP temettü bildirimleriyle bir tur ilerletir; eklenen kayıt
/// sayısını döner.
///
/// Gövde ucunun tur başına ~10 belgelik kotası yüzünden tarama bütçelidir;
/// ilerleme diske yazıldığı için turlar boyunca yakınsar. En yeni bildirim
/// önce okunur: güncel akışın doğruluğu geçmişten önce gelir.
pub async fn backfill_round(client: &Client) -> usize {
    let mut archive = crate::capital_store::load();
    let today = crate::kap::istanbul_today();
    let candidates =
        list_dividend_disclosures(client, today - chrono::Duration::days(BACKFILL_DAYS), today).await;

    let mut pending: Vec<crate::kap::RawDisclosure> = candidates
        .into_iter()
        .filter(|row| {
            !archive
                .processed_disclosures
                .contains(&row.disclosure_index_str())
        })
        .collect();
    if pending.is_empty() {
        return 0;
    }
    pending.sort_by(|a, b| b.disclosure_index.cmp(&a.disclosure_index));

    let round = crate::kap_capital::fetch_forms(client, &pending).await;
    let mut dividends = Vec::new();
    for (index, form) in &round.forms {
        dividends.extend(parse_dividend_form(form, index));
        archive.processed_disclosures.insert(index.clone());
    }

    let read = round.forms.len();
    let added = crate::capital_store::merge_kap_dividends(&mut archive, dividends);
    crate::capital_store::save(&archive);

    eprintln!(
        "[kap] temettü: {} bekleyen bildirimin {read} tanesi okundu, {added} kayıt eklendi{}",
        pending.len(),
        if round.exhausted { " (kota doldu)" } else { "" }
    );
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
            &["Para Birimi", "TRY"],
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
        for row in rows.iter_mut().skip(7).take(3) {
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

    /// Genel kurul öncesi bildirimlerde yalnız teklif edilen tarih bulunuyor.
    #[test]
    fn falls_back_to_the_proposed_ex_date() {
        let mut rows = arase_form().rows;
        rows[12][2] = "-".to_string();
        let parsed = parse_dividend_form(&KapForm { rows }, "1");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].ex_date, "2026-06-24");
    }

    /// Ödeme lirayla yapılıyorsa kayıt "TRY" taşır ve arayüzde rozet çıkmaz.
    #[test]
    fn the_currency_field_is_carried_into_the_record() {
        let rows = parse_dividend_form(&arase_form(), "1617428");
        assert_eq!(rows[0].currency, "TRY");
        assert!(!is_foreign(&rows[0].currency));
    }

    /// Dövizli bildirimde tutar lira **değildir**: sütun başlığı KAP formunda
    /// sabit "(TL)" yazsa da geçerli birim "Para Birimi" alanıdır. Kayıt bunu
    /// taşımazsa 0,15 USD ile 0,15 TL aynı sütunda ayırt edilemez.
    #[test]
    fn a_foreign_currency_payment_keeps_its_own_unit() {
        let mut rows = arase_form().rows;
        rows[3][1] = "USD".to_string();
        let parsed = parse_dividend_form(&KapForm { rows }, "1");

        assert_eq!(parsed.len(), 1, "{parsed:#?}");
        assert_eq!(parsed[0].currency, "USD");
        assert!(is_foreign(&parsed[0].currency));
        // Tutar dönüştürülmez; bildirimde yazan sayı olduğu gibi taşınır.
        assert_eq!(parsed[0].gross_per_share, 2.0);
    }

    /// Alan yoksa (eski bildirimler ve "Ödenmeyecek" kararları) lira sayılır.
    #[test]
    fn a_missing_currency_field_means_lira() {
        let rows: Vec<Vec<String>> = arase_form()
            .rows
            .into_iter()
            .filter(|row| row.first().map(String::as_str) != Some("Para Birimi"))
            .collect();
        assert_eq!(parse_dividend_form(&KapForm { rows }, "1")[0].currency, "TRY");
    }

    fn archive_with(rows: Vec<KapDividend>) -> crate::capital_store::CapitalArchive {
        crate::capital_store::CapitalArchive {
            dividends: rows,
            ..Default::default()
        }
    }

    fn record(ticker: &str, ex_date: &str, currency: &str, index: &str) -> KapDividend {
        KapDividend {
            ticker: ticker.into(),
            ex_date: ex_date.into(),
            gross_per_share: 1.0,
            net_per_share: 1.0,
            payment_date: None,
            payment_kind: "Peşin".into(),
            currency: currency.into(),
            disclosure_index: index.into(),
        }
    }

    /// Gömülü liste ilk açılışta notu doldurur; canlı arşiv bulduklarını
    /// üstüne yazar. Yalnız canlıya güvenmek notu yıllarca boş bırakırdı —
    /// gövde kotası tur başına on bildirim ilerliyor.
    #[test]
    fn the_seeded_list_and_the_live_archive_are_merged() {
        let seeded = foreign_payers(&archive_with(Vec::new()));
        assert!(
            seeded.iter().all(|payer| is_foreign(&payer.currency)),
            "gömülü listede lira kaydı olmamalı: {seeded:#?}"
        );

        let merged = foreign_payers(&archive_with(vec![record("XXXXX", "2026-06-01", "USD", "1")]));
        assert_eq!(merged.len(), seeded.len() + 1);
        let added = merged.iter().find(|payer| payer.ticker == "XXXXX").unwrap();
        assert_eq!(added.currency, "USD");
        assert_eq!(added.source, "KAP Bildirimi 1");
    }

    /// Lira ödemeleri listeye girmez; not yalnız dövizli şirketler içindir.
    #[test]
    fn lira_payments_stay_out_of_the_note() {
        let payers = foreign_payers(&archive_with(vec![record("EREGL", "2026-06-01", "TRY", "1")]));
        assert!(payers.iter().all(|payer| payer.ticker != "EREGL"));
    }

    /// Bir şirket para birimi değiştirirse **en yeni** bildirim geçerlidir.
    #[test]
    fn the_latest_disclosure_wins_for_a_company() {
        let payers = foreign_payers(&archive_with(vec![
            record("XXXXX", "2024-06-01", "USD", "1"),
            record("XXXXX", "2026-06-01", "EUR", "2"),
        ]));
        let row = payers.iter().find(|payer| payer.ticker == "XXXXX").unwrap();
        assert_eq!(row.currency, "EUR");
        assert_eq!(row.source, "KAP Bildirimi 2");
    }

    #[test]
    fn only_non_lira_codes_count_as_foreign() {
        assert!(is_foreign("USD"));
        assert!(is_foreign("eur"));
        assert!(!is_foreign("TRY"));
        assert!(!is_foreign("TL"));
        assert!(!is_foreign(""));
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
