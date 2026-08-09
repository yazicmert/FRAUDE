//! KAP finansal rapor zincirinin canlı turu: bildirim listesi → gövde →
//! `FinancialPeriod`.
//!
//! Alan adları KAP taksonomisinden geliyor; değişirlerse ayrıştırıcı sessizce
//! boş döner ve mali tablo eskisi gibi yalnız İş Yatırım'dan gelmeye devam
//! eder — hiçbir yerde hata görünmez. Bu tur o sessizliği kırar.

use fraude_core::kap_financials::{is_financial_report, parse_financial_form};

/// Sanayi şirketi: tam TL sunum, iki sütunlu bilanço.
///
/// KLSYN 2026/2 (bildirim 1636226) canlı gövdeden doğrulandı; birim
/// sınamalarındaki fixture bu belgeden yazıldı.
#[tokio::test]
#[ignore = "canlı KAP erişimi gerektirir"]
async fn live_industrial_report_parses() {
    let client = fraude_core::http_client();
    let form = fraude_core::kap::fetch_disclosure_form(&client, "1636226")
        .await
        .expect("gövde alınamadı — büyük olasılıkla hız sınırı");

    let period = parse_financial_form(&form, "2026/2").expect("KLSYN raporu ayrıştırılmalı");
    println!("{period:#?}");

    assert_eq!(period.total_assets, Some(6_440_904_330.0));
    assert_eq!(period.revenue, Some(1_054_431_984.0));
    assert_eq!(period.net_income, Some(-46_045_533.0));
}

/// Banka: milyon TL sunum ve `TP | YP | Toplam` üçlüsü.
#[tokio::test]
#[ignore = "canlı KAP erişimi gerektirir"]
async fn live_bank_report_uses_the_total_column() {
    let client = fraude_core::http_client();
    let form = fraude_core::kap::fetch_disclosure_form(&client, "1636727")
        .await
        .expect("gövde alınamadı — büyük olasılıkla hız sınırı");

    let period = parse_financial_form(&form, "2026/2").expect("DENIZ raporu ayrıştırılmalı");
    println!("{period:#?}");

    // Sunum milyon TL; okunmazsa varlıklar 2,06 trilyon yerine 2,06 milyon
    // görünürdü. Toplam sütunu yerine ilk sütun okunsaydı 1,26 trilyon çıkardı.
    assert_eq!(period.total_assets, Some(2_064_464.0 * 1e6));
    assert_eq!(period.total_equity, Some(247_652.0 * 1e6));
    // Bankada hasılatın karşılığı faiz geliri, brüt kârınki net faiz geliri.
    assert_eq!(period.revenue, Some(196_393.0 * 1e6));
    assert_eq!(period.gross_profit, Some(61_962.0 * 1e6));
}

/// Uçtan uca: hisse kodundan en güncel döneme.
#[tokio::test]
#[ignore = "canlı KAP erişimi gerektirir"]
async fn live_latest_period_for_a_ticker() {
    let client = fraude_core::http_client();
    match fraude_core::kap::fetch_latest_kap_financial_period(&client, "ASELS").await {
        Ok(Some(period)) => {
            println!("ASELS {period:#?}");
            // Sahte dönem üretilmediğinin kanıtı: eski okuyucu hasılatı `3`
            // okuyordu; gerçek kalemler milyar mertebesinde.
            if let Some(assets) = period.total_assets {
                assert!(assets > 1.0e9, "toplam varlık makul olmalı: {assets}");
            }
        }
        Ok(None) => println!("ASELS: güncel finansal rapor bulunamadı (hız sınırı olabilir)"),
        Err(error) => panic!("zincir koptu: {error}"),
    }
}

#[test]
fn the_responsibility_statement_is_not_a_report() {
    assert!(is_financial_report("Finansal Rapor"));
    assert!(!is_financial_report("Sorumluluk Beyanı (Konsolide)"));
}
