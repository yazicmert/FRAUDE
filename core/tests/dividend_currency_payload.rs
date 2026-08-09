//! Temettü yükünün arayüze giden JSON biçimi.
//!
//! Arayüz `fx_payers` ve `currency` alanlarını **isteğe bağlı** okuyor: alan
//! adı değişse ya da serileştirmeden düşse tip denetimi susar, not da sessizce
//! kapanır. Bu tur o sözleşmeyi sabitler.
//!
//! Dosya `get_corporate_events`i çağırmaz — o uç `dirs::home_dir()`den okuyor
//! ve `HOME`u değiştirmek süreç geneli olurdu (bkz. `market_cache_roundtrip`).
//! Sınanan şey zaten kablolamanın kendisi değil, alanların diğer uca hangi
//! adla ve hangi değerle vardığı.

use fraude_core::domain::{CorporateEventsPayload, DividendRecord, FxDividendPayer, UpcomingDividend};

fn dividend(currency: &str) -> DividendRecord {
    DividendRecord {
        ticker: "DOCO".into(),
        ex_date: "2026-07-28".into(),
        amount_per_share: 2.5,
        yield_pct: 1.24,
        period: "2026".into(),
        installment: 0,
        source: "KAP Bildirimi 1611833".into(),
        currency: currency.into(),
    }
}

#[test]
fn the_payload_carries_currency_and_the_fx_note() {
    let payload = CorporateEventsPayload {
        dividends: vec![dividend("EUR")],
        splits: Vec::new(),
        upcoming: vec![UpcomingDividend {
            ticker: "DOCO".into(),
            ex_date: "2027-07-28".into(),
            annual_rate: None,
            installment: 0,
            currency: "EUR".into(),
        }],
        fx_payers: vec![FxDividendPayer {
            ticker: "DOCO".into(),
            currency: "EUR".into(),
            source: "KAP Bildirimi 1611833".into(),
        }],
        last_updated: None,
        ready: true,
    };

    let json: serde_json::Value = serde_json::to_value(&payload).unwrap();
    assert_eq!(json["dividends"][0]["currency"], "EUR");
    assert_eq!(json["upcoming"][0]["currency"], "EUR");
    assert_eq!(json["fx_payers"][0]["ticker"], "DOCO");
    assert_eq!(json["fx_payers"][0]["currency"], "EUR");
    assert_eq!(json["fx_payers"][0]["source"], "KAP Bildirimi 1611833");
}

/// Kullanıcının diskindeki arşiv para birimi alanını **taşımıyor** — alan
/// bugün eklendi. Varsayılan olmasaydı çözümleme düşer ve mevcut temettü
/// kayıtlarının tamamı kaybolurdu.
#[test]
fn an_old_record_without_the_field_still_loads_as_lira() {
    let old = serde_json::json!({
        "ticker": "ARASE",
        "ex_date": "2026-06-24",
        "amount_per_share": 2.0,
        "yield_pct": 0.0,
        "period": "2026",
        "installment": 0,
        "source": "KAP Bildirimi 1617428"
    });

    let record: DividendRecord = serde_json::from_value(old).unwrap();
    assert_eq!(record.currency, "TRY");
}
