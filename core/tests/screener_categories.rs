//! Tarayıcı kategori süzgeci: her kategori KENDİ evrenini vermeli.
//!
//! Regresyon: istemci her sorgunun başına varsayılan olarak "BIST100" ekliyordu.
//! Kategori süzgeci else-if zinciriyle çalıştığından ilk dal (bist100) daima
//! kazanıyor, evren 100 hisseye iniyordu — Emtia/Kripto/Global kategorileri
//! hiç sonuç veremiyor, "Tüm Varlıklar" da sessizce BIST 100 demek oluyordu.

use fraude_core::domain::EquityRow;
use fraude_core::services::run_screener_query;
use fraude_core::storage::AppStore;

fn row(ticker: &str, groups: &[&str]) -> EquityRow {
    EquityRow {
        ticker: ticker.to_string(),
        name: format!("{ticker} A.Ş."),
        price: 100.0,
        rsi: 50.0,
        index_memberships: groups.iter().map(|g| g.to_string()).collect(),
        ..Default::default()
    }
}

fn store() -> AppStore {
    // `seeded` diskteki evreni yükler; test kendi evrenini dayatır ki
    // sonuç geliştiricinin makinesindeki önbelleğe bağlı olmasın.
    let mut store = AppStore::seeded();
    store.equities = vec![
        row("THYAO", &["BIST 100", "BIST TUM"]),
        row("KRDMD", &["BIST TUM"]), // BIST 100 dışında bir BIST hissesi
        row("GC=F", &["Emtialar"]),
        row("GRAM ALTIN", &["Emtialar"]),
        row("BTC-USD", &["Kripto"]),
        row("AAPL", &["Global"]),
    ];
    store
}

fn tickers(query: &str) -> Vec<String> {
    run_screener_query(&store(), query)
        .rows
        .into_iter()
        .map(|row| row.ticker)
        .collect()
}

#[test]
fn emtia_returns_only_commodities() {
    let mut found = tickers("EMTIA ");
    found.sort();
    assert_eq!(found, vec!["GC=F".to_string(), "GRAM ALTIN".to_string()]);
}

#[test]
fn kripto_and_global_have_their_own_universes() {
    assert_eq!(tickers("KRIPTO "), vec!["BTC-USD".to_string()]);
    assert_eq!(tickers("GLOBAL "), vec!["AAPL".to_string()]);
}

/// BIST kategorisi BIST 100 ile SINIRLI DEĞİLDİR: emtia/kripto/global dışında
/// kalan tüm hisseleri kapsar.
#[test]
fn bist_covers_more_than_the_hundred_index() {
    let mut found = tickers("BIST ");
    found.sort();
    assert_eq!(found, vec!["KRDMD".to_string(), "THYAO".to_string()]);
}

/// Kategori verilmeyince evren daralmamalı — "Tüm Varlıklar" gerçekten hepsi.
#[test]
fn no_category_keeps_the_whole_universe() {
    assert_eq!(tickers("").len(), 6);
}

/// Hatanın ta kendisi: "BIST100" öneki bir kategori sorgusunun önüne
/// düştüğünde evren yanlış daralıyor. İstemci artık öneki eklemiyor; bu test
/// davranışın neden zararlı olduğunu belgeler.
#[test]
fn bist100_prefix_swallows_the_category() {
    let found = tickers("BIST100 EMTIA ");
    assert!(
        !found.iter().any(|t| t.contains("=F") || t.contains("GRAM")),
        "BIST100 öneki emtia kategorisini yutuyor: {found:?}"
    );
}
