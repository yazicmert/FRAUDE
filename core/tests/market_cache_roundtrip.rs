//! Evren disk önbelleğinin gerçek dosya sistemi turu.
//!
//! Bu dosya bilerek tek testten oluşuyor: önbellek yolu `dirs::home_dir()`'den
//! türediği için test `HOME`'u geçici bir dizine çeviriyor ve `set_var` süreç
//! geneli. Aynı ikilide başka bir test olsaydı ondan da etkilenirdi.

use std::time::Duration;

use fraude_core::domain::EquityRow;
use fraude_core::market_cache;

#[test]
fn saved_universe_comes_back_after_restart() {
    let home = std::env::temp_dir().join(format!("fraude_market_cache_{}", std::process::id()));
    std::fs::create_dir_all(&home).unwrap();
    std::env::set_var("HOME", &home);
    // Windows'ta dirs bu ikiliyi kullanır; testin taşınabilir kalması için ikisi de kurulur.
    std::env::set_var("USERPROFILE", &home);

    let rows = vec![
        EquityRow { ticker: "ASELS".into(), price: 380.25, rsi: 61.4, ..Default::default() },
        EquityRow { ticker: "THYAO".into(), price: 312.0, ..Default::default() },
    ];

    // Tam senkron yazımı: damga ileri taşınır, hız sınırı uygulanmaz.
    market_cache::save(&rows, true);

    // `save` diski ayrı bir iş parçacığına yazıyor; dosya belirene kadar bekle.
    let path = home.join(".fraude_market.json");
    for _ in 0..100 {
        if path.exists() {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(path.exists(), "önbellek dosyası yazılmalı: {}", path.display());

    let restored = market_cache::load();
    assert_eq!(restored.len(), 2, "evren geri yüklenmeli");
    assert_eq!(restored[0].ticker, "ASELS");
    assert!((restored[0].price - 380.25).abs() < 1e-9);
    assert!((restored[0].rsi - 61.4).abs() < 1e-9, "göstergeler de korunmalı");

    // Yeni yazılan damga taze olduğundan, yeniden başlatılan süreç tam senkronu
    // "bayat" saymamalı — artımlı modda kalabilmesinin koşulu budur.
    let age = market_cache::disk_full_sync_age().expect("taze damga okunmalı");
    assert!(age < Duration::from_secs(60), "damga taze olmalı: {age:?}");

    // Damga **mutlak** unix zamanı olmalı, yaş ya da 0 değil. Yaş saklansaydı
    // her artımlı yazım damgayı süreç çalışma süresi kadar ileri taşır ve tam
    // senkron hiç tetiklenmezdi.
    let raw = std::fs::read_to_string(&path).unwrap();
    let stored: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let full_sync_at = stored["full_sync_at_unix"].as_u64().expect("damga alanı");
    let written_at = stored["written_at_unix"].as_u64().expect("yazım alanı");
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    assert_eq!(full_sync_at, written_at, "tam senkron yazımında iki damga da şimdi olmalı");
    assert!(
        now.saturating_sub(full_sync_at) < 60,
        "damga mutlak unix zamanı olmalı, {full_sync_at} okundu (şimdi {now})"
    );

    let _ = std::fs::remove_dir_all(&home);
}
