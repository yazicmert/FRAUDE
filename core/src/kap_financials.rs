//! KAP "Finansal Rapor" bildiriminden mali tablo çıkarma.
//!
//! Mali tablo kalemleri bugüne dek yalnız İş Yatırım'dan geliyordu. Oysa
//! tablonun **resmî** hâli KAP'ta ve yapısal: bildirim gövdesi bilanço, gelir
//! tablosu, nakit akış ve özkaynak değişim tablolarını etiket/değer satırları
//! hâlinde taşıyor (KLSYN 2026/2'de 154, DENIZ'de 338 dolu satır). Yani
//! ayrıştırma sorunu değil, okunmamış bir kaynak söz konusuydu.
//!
//! Bu modülün yerini aldığı okuyucu **bildirim sayfasını** kazıyordu ve
//! sayfadaki 5 MB'lık Next.js yükünde "etiketten sonraki ilk sayı"yı arıyordu;
//! KLSYN ölçümünde hasılatı `3` okuyup arşive sahte bir çeyrek yazıyordu.
//!
//! İki tuzak sessizce yanlış sayı üretir:
//!
//! * **Sunum birimi.** Bankalar tabloyu milyon TL cinsinden veriyor
//!   (`Sunum Para Birimi = "1.000.000 TL"`), sanayi şirketleri tam TL. Birim
//!   okunmazsa banka bilançosu bir milyon kat küçük çıkar.
//! * **Sütun düzeni.** Banka bilançosunda bir satır `TP | YP | Toplam` üçlüsünü
//!   iki dönem için taşıyor; ilk hücre yalnız Türk parası kısmıdır.

use crate::domain::FinancialPeriod;
use crate::kap::KapForm;

/// Finansal rapor bildiriminin konusu. KAP bunu sabit yazıyor.
const FINANCIAL_SUBJECT: &str = "Finansal Rapor";

/// Tabloların hangi birimde sunulduğunu söyleyen alan.
const FIELD_UNIT: &str = "Sunum Para Birimi";

/// Sütun başlığındaki dönem etiketi: `"Cari Dönem 30.06.2026"`.
const HEADER_CURRENT_PERIOD: &str = "Cari Dönem";

/// `TP + YP = Toplam` özdeşliğinde kabul edilen oransal sapma.
///
/// Değerler yuvarlanmış sunuluyor (milyon TL); birkaç birimlik fark normaldir,
/// büyük sapma sütunların o üçlü olmadığını gösterir.
const TRIPLE_TOLERANCE: f64 = 0.01;

/// Konusu finansal rapor olan bildirim mi?
pub fn is_financial_report(subject: &str) -> bool {
    subject.trim() == FINANCIAL_SUBJECT
}

/// Aranan kalemlerin etiketleri; sırayla denenir, ilk bulunan kazanır.
///
/// Sanayi ve banka taksonomileri **ayrı**: bankada hasılatın karşılığı faiz
/// geliri, brüt kârınki net faiz geliridir. Etiketler canlı gövdeden birebir
/// alındı, tahmin değil.
const REVENUE: &[&str] = &["Hasılat", "Satış Gelirleri", "FAİZ GELİRLERİ"];
const GROSS_PROFIT: &[&str] = &["BRÜT KAR (ZARAR)", "NET FAİZ GELİRİ VEYA GİDERİ"];
const OPERATING_INCOME: &[&str] = &[
    "ESAS FAALİYET KARI (ZARARI)",
    "FİNANSMAN GELİRİ (GİDERİ) ÖNCESİ FAALİYET KARI (ZARARI)",
    "NET FAALİYET KARI (ZARARI)",
];
const NET_INCOME: &[&str] = &[
    "Net Dönem Karı veya Zararı",
    "DÖNEM NET KARI VEYA ZARARI",
    "Dönem Karı (Zararı)",
];
const TOTAL_ASSETS: &[&str] = &["TOPLAM VARLIKLAR", "VARLIKLAR TOPLAMI"];
const TOTAL_EQUITY: &[&str] = &["TOPLAM ÖZKAYNAKLAR", "ÖZKAYNAKLAR"];
const OPERATING_CASH_FLOW: &[&str] = &["İŞLETME FAALİYETLERİNDEN NAKİT AKIŞLARI"];

/// Toplam finansal borç, vade kırılımı toplanarak bulunur: tabloda tek bir
/// "finansal borçlar" kalemi yok.
const DEBT_PARTS: &[&str] = &[
    "Kısa Vadeli Borçlanmalar",
    "Uzun Vadeli Borçlanmaların Kısa Vadeli Kısımları",
    "Uzun Vadeli Borçlanmalar",
];

/// Bildirim gövdesini tek bir döneme çevirir.
///
/// Dönem etiketi gövdedeki sütun başlığından okunur ve `2026-06-30` biçimine
/// getirilir; okunamazsa `fallback` kullanılır. Bu etiket **hesap dönemi
/// sonu** olmalı, bildirimin yayın tarihi değil: mali tablo listesi dönemi bu
/// biçimde anahtarlıyor ve yayın tarihi yazılırsa aynı çeyrek iki ayrı kayıt
/// olarak görünür.
///
/// Hiçbir ana kalem okunamazsa `None` döner — boş bir dönem arşive girerse
/// gerçek veriyi bastırır.
pub fn parse_financial_form(form: &KapForm, fallback: &str) -> Option<FinancialPeriod> {
    let period = period_end(form).unwrap_or_else(|| fallback.to_string());
    let scale = presentation_scale(form);
    let read = |labels: &[&str]| first_value(form, labels).map(|value| value * scale);

    let total_debt = {
        let parts: Vec<f64> = DEBT_PARTS.iter().filter_map(|label| first_value(form, &[label])).collect();
        (!parts.is_empty()).then(|| parts.iter().sum::<f64>() * scale)
    };

    let period = FinancialPeriod {
        period,
        revenue: read(REVENUE),
        gross_profit: read(GROSS_PROFIT),
        operating_income: read(OPERATING_INCOME),
        net_income: read(NET_INCOME),
        total_assets: read(TOTAL_ASSETS),
        total_equity: read(TOTAL_EQUITY),
        total_debt,
        operating_cash_flow: read(OPERATING_CASH_FLOW),
        // Serbest nakit akışı tabloda kalem olarak yok; yatırım harcaması
        // kalemlerinden türetmek ayrı bir iş, uydurma değer yazılmaz.
        free_cash_flow: None,
    };

    (period.total_assets.is_some() || period.revenue.is_some() || period.net_income.is_some())
        .then_some(period)
}

/// Cari dönem sonu, `"Cari Dönem 30.06.2026"` başlığından → `"2026-06-30"`.
///
/// Başlık taksonomi satırı değil, düz bir sütun başlığı; bu yüzden ızgarada
/// herhangi bir hücrede geçebiliyor.
fn period_end(form: &KapForm) -> Option<String> {
    form.rows
        .iter()
        .flatten()
        .find(|cell| cell.starts_with(HEADER_CURRENT_PERIOD))
        .and_then(|cell| iso_date(cell.trim_start_matches(HEADER_CURRENT_PERIOD).trim()))
}

/// `"30.06.2026"` → `"2026-06-30"`.
fn iso_date(raw: &str) -> Option<String> {
    let head = raw.split_whitespace().next()?;
    let mut parts = head.split('.');
    let (day, month, year) = (parts.next()?, parts.next()?, parts.next()?);
    if day.len() != 2 || month.len() != 2 || year.len() != 4 {
        return None;
    }
    head.chars()
        .all(|c| c.is_ascii_digit() || c == '.')
        .then(|| format!("{year}-{month}-{day}"))
}

/// Sunum biriminin çarpanı: `"TL"` → 1, `"1.000.000 TL"` → 1e6.
///
/// Alan okunamazsa 1 kabul edilir; sanayi şirketlerinin ezici çoğunluğu tam TL
/// sunuyor ve yanlış tarafta hata yapmak bilançoyu milyon kat şişirirdi.
fn presentation_scale(form: &KapForm) -> f64 {
    let Some(raw) = form.field(FIELD_UNIT) else {
        return 1.0;
    };
    let digits: String = raw.chars().filter(|c| c.is_ascii_digit()).collect();
    match digits.parse::<f64>() {
        Ok(value) if value >= 1.0 => value,
        _ => 1.0,
    }
}

/// Etiketlerden ilk bulunanın geçerli sütunundaki değer.
fn first_value(form: &KapForm, labels: &[&str]) -> Option<f64> {
    labels
        .iter()
        .find_map(|label| form.values(label).and_then(resolve_column))
}

/// Satırın hangi sütununun "cari dönem toplamı" olduğunu seçer.
///
/// Sanayi tablosunda sütunlar `cari | önceki` (bilanço) ya da
/// `cari kümüle | önceki kümüle | cari çeyrek | önceki çeyrek` (gelir
/// tablosu); ikisinde de ilk sütun doğrudur.
///
/// Banka bilançosunda ise `TP | YP | Toplam` üçlüsü iki dönem için tekrarlanır
/// ve ilk sütun yalnız Türk parası kısmıdır. Bu düzen sütun **başlığından
/// değil aritmetikten** tanınır: ilk iki değerin toplamı üçüncüyü veriyorsa
/// üçlüdür. Başlığa bakmak, başlık satırının kalem satırıyla aynı ızgarada
/// olmasını gerektirirdi; özdeşlik kendi kendini doğrular.
fn resolve_column(values: &[String]) -> Option<f64> {
    let numbers: Vec<Option<f64>> = values.iter().map(|cell| number(cell)).collect();

    if numbers.len() == 6 {
        if let (Some(tp), Some(fx), Some(total)) = (numbers[0], numbers[1], numbers[2]) {
            if is_sum(tp, fx, total) {
                return Some(total);
            }
        }
    }

    numbers.into_iter().flatten().next()
}

fn is_sum(left: f64, right: f64, total: f64) -> bool {
    let scale = total.abs().max(1.0);
    (left + right - total).abs() / scale <= TRIPLE_TOLERANCE
}

/// `"1.054.431.984"` → 1054431984, `"-46.045.533"` → -46045533.
///
/// Boş hücre ve tire değer değildir; `0` ise gerçek sıfırdır ve okunur.
fn number(raw: &str) -> Option<f64> {
    let token = raw.trim();
    if token.is_empty() || token == "-" {
        return None;
    }
    let value: f64 = token.replace('.', "").replace(',', ".").parse().ok()?;
    value.is_finite().then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn form(rows: &[&[&str]]) -> KapForm {
        KapForm {
            rows: rows
                .iter()
                .map(|row| row.iter().map(|cell| cell.to_string()).collect())
                .collect(),
        }
    }

    /// KLSYN (Koleksiyon Mobilya) 2026/2 · bildirim 1636226.
    ///
    /// Satırlar canlı gövdeden alındı; sanayi taksonomisi, tam TL sunum,
    /// bilanço iki sütunlu, gelir tablosu dört sütunlu.
    fn klsyn_form() -> KapForm {
        form(&[
            &["Sunum Para Birimi", "TL"],
            &["Finansal Tablo Niteliği", "Konsolide"],
            &["", "Cari Dönem 30.06.2026", "Önceki Dönem 31.12.2025"],
            &["TOPLAM DÖNEN VARLIKLAR", "1.418.590.165", "1.422.778.926"],
            &["TOPLAM VARLIKLAR", "6.440.904.330", "6.404.744.397"],
            &["Kısa Vadeli Borçlanmalar", "391.363.320", "275.582.011"],
            &["Uzun Vadeli Borçlanmaların Kısa Vadeli Kısımları", "107.564.354", "72.866.326"],
            &["Uzun Vadeli Borçlanmalar", "419.601.195", "459.355.942"],
            &["Net Dönem Karı veya Zararı", "-46.045.533", "94.256.011"],
            &["TOPLAM ÖZKAYNAKLAR", "4.000.182.896", "4.037.237.889"],
            &["Hasılat", "1.054.431.984", "1.205.685.943", "507.315.835", "544.414.533"],
            &["BRÜT KAR (ZARAR)", "470.939.773", "514.835.122", "193.666.393", "227.949.273"],
            &["ESAS FAALİYET KARI (ZARARI)", "-57.289.415", "45.894.340", "-61.494.418", "12.743.149"],
            &["İŞLETME FAALİYETLERİNDEN NAKİT AKIŞLARI", "-338.326.757", "163.807.366"],
        ])
    }

    /// DENIZ (DenizBank) 2026/2 · bildirim 1636727 — banka taksonomisi,
    /// **milyon TL** sunum ve `TP | YP | Toplam` üçlüsü.
    fn deniz_form() -> KapForm {
        form(&[
            &["Sunum Para Birimi", "1.000.000 TL"],
            &["Finansal Tablo Niteliği", "Konsolide Olmayan"],
            &["VARLIKLAR TOPLAMI", "1.261.151", "803.313", "2.064.464", "1.036.710", "696.333", "1.733.043"],
            &["ÖZKAYNAKLAR", "246.527", "1.125", "247.652", "212.780", "3.068", "215.848"],
            &["FAİZ GELİRLERİ", "196.393", "157.291", "103.735", "80.835"],
            &["NET FAİZ GELİRİ VEYA GİDERİ", "61.962", "33.596", "31.067", "16.328"],
        ])
    }

    /// Sanayi tablosu: ilk sütun cari dönem, tutarlar olduğu gibi.
    #[test]
    fn an_industrial_statement_reads_the_current_column() {
        let period = parse_financial_form(&klsyn_form(), "2026/2").expect("dönem çıkmalı");

        assert_eq!(period.revenue, Some(1_054_431_984.0));
        assert_eq!(period.gross_profit, Some(470_939_773.0));
        assert_eq!(period.operating_income, Some(-57_289_415.0));
        assert_eq!(period.net_income, Some(-46_045_533.0));
        assert_eq!(period.total_assets, Some(6_440_904_330.0));
        assert_eq!(period.total_equity, Some(4_000_182_896.0));
        assert_eq!(period.operating_cash_flow, Some(-338_326_757.0));
    }

    /// Finansal borç tek kalem değil; vade kırılımı toplanır.
    #[test]
    fn financial_debt_sums_the_maturity_buckets() {
        let period = parse_financial_form(&klsyn_form(), "2026/2").unwrap();
        assert_eq!(period.total_debt, Some(391_363_320.0 + 107_564_354.0 + 419_601_195.0));
    }

    /// Bankada tutarlar milyon TL ve doğru sütun `Toplam`dır.
    ///
    /// İlk hücre (`TP`) okunsaydı varlıklar 2,06 trilyon yerine 1,26 milyon
    /// görünürdü: hem sütun hem birim yanlış.
    #[test]
    fn a_bank_statement_uses_the_total_column_and_the_million_unit() {
        let period = parse_financial_form(&deniz_form(), "2026/2").expect("dönem çıkmalı");

        assert_eq!(period.total_assets, Some(2_064_464.0 * 1e6));
        assert_eq!(period.total_equity, Some(247_652.0 * 1e6));
        // Gelir tablosu dört sütunlu; üçlü değil, ilk sütun geçerli.
        assert_eq!(period.revenue, Some(196_393.0 * 1e6));
        assert_eq!(period.gross_profit, Some(61_962.0 * 1e6));
    }

    /// Altı sütunlu ama özdeşliği tutmayan satır üçlü değildir; böyle bir
    /// satırda üçüncü hücreyi "toplam" saymak uydurma olurdu.
    #[test]
    fn six_columns_without_the_identity_fall_back_to_the_first() {
        let rows = form(&[
            &["Sunum Para Birimi", "TL"],
            &["TOPLAM VARLIKLAR", "100", "200", "999", "50", "60", "110"],
        ]);
        assert_eq!(parse_financial_form(&rows, "x").unwrap().total_assets, Some(100.0));
    }

    #[test]
    fn the_presentation_unit_defaults_to_lira() {
        assert_eq!(presentation_scale(&form(&[&["Sunum Para Birimi", "TL"]])), 1.0);
        assert_eq!(presentation_scale(&form(&[&["Sunum Para Birimi", "1.000.000 TL"]])), 1e6);
        assert_eq!(presentation_scale(&form(&[&["Karar Tarihi", "13.03.2026"]])), 1.0);
    }

    /// Ana kalemlerin hiçbiri okunamıyorsa dönem üretilmez: boş bir kayıt
    /// arşivde gerçek veriyi bastırırdı.
    #[test]
    fn a_body_without_any_headline_item_yields_nothing() {
        let rows = form(&[&["Sunum Para Birimi", "TL"], &["Karar Tarihi", "13.03.2026"]]);
        assert!(parse_financial_form(&rows, "2026/2").is_none());
    }

    /// Dönem etiketi **hesap dönemi sonu** olmalı, bildirimin yayın tarihi
    /// değil. Mali tablo listesi dönemi `2026-06-30` biçiminde anahtarlıyor;
    /// yayın tarihi yazılsaydı aynı çeyrek iki ayrı satır olarak görünürdü.
    #[test]
    fn the_period_label_comes_from_the_statement_header() {
        let period = parse_financial_form(&klsyn_form(), "24.07.2026").unwrap();
        assert_eq!(period.period, "2026-06-30");
    }

    /// Başlık okunamazsa çağıranın verdiği etiket korunur.
    #[test]
    fn a_missing_header_keeps_the_fallback_label() {
        let rows = form(&[&["Sunum Para Birimi", "TL"], &["TOPLAM VARLIKLAR", "100"]]);
        assert_eq!(parse_financial_form(&rows, "2026-06-30").unwrap().period, "2026-06-30");
    }

    #[test]
    fn subject_match_is_exact() {
        assert!(is_financial_report(FINANCIAL_SUBJECT));
        assert!(!is_financial_report("Finansal Rapor Sorumluluk Beyanı"));
    }
}
