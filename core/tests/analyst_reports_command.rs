//! `get_analyst_reports` komutunun uçtan uca doğrulaması.
//!
//! Birim testleri ayrıştırıcıları tek tek kapsıyor; burada asıl sorulan şey
//! **komut yolunun tamamının** ekrana gerçek veri taşıyıp taşımadığı: iki ayrı
//! kaynak (rapor arşivi + analist konsensüsü) tek yanıtta birleşiyor mu, ve
//! hisse istendiğinde/istenmediğinde doğru kesiti veriyor mu.
//!
//! Ağ gerektirdiği için `#[ignore]`; `cargo test -- --ignored` ile koşulur.

use fraude_core::{api, AppState};

#[tokio::test]
#[ignore = "ağ gerektirir"]
async fn list_mode_returns_reports_and_consensus_together() {
    let state = AppState::new();

    // Zorlamalı tazeleme: diskteki arşiv gün içinde tazelenmiş sayıldığında
    // yeni eklenen kaynaklar inmez. Ekrandaki "Yenile" düğmesinin yolu budur
    // ve testin bütün kurumları görebilmesi için gerekli.
    let payload = api::get_analyst_reports(&state, None, Some(true))
        .await
        .expect("komut yanıt vermeli");

    assert!(!payload.reports.is_empty(), "rapor arşivi boş döndü");
    assert!(!payload.consensus.is_empty(), "konsensüs boş döndü");

    // Arşiv birden çok kurumdan beslenmeli; tek kaynağa düşmüş olması
    // kaynakların sessizce kırıldığının işaretidir.
    let brokers: std::collections::HashSet<_> =
        payload.reports.iter().map(|report| report.broker.as_str()).collect();
    assert!(brokers.len() >= 4, "beklenenden az kurum: {brokers:?}");

    // Liste modunda konsensüs izleyen kurum sayısına göre azalan sıralı gelir.
    let totals: Vec<i64> = payload.consensus.iter().map(|row| row.total).collect();
    assert!(
        totals.windows(2).all(|pair| pair[0] >= pair[1]),
        "konsensüs sıralı değil: {:?}",
        &totals[..totals.len().min(10)]
    );

    let covered = payload.consensus.iter().filter(|row| row.total > 0).count();
    println!(
        "{} rapor / {} kurum · {} payda konsensüs ({} tanesinde analist kapsamı)",
        payload.reports.len(),
        brokers.len(),
        payload.consensus.len(),
        covered
    );
}

#[tokio::test]
#[ignore = "ağ gerektirir"]
async fn ticker_mode_scopes_both_sources_to_the_stock() {
    let state = AppState::new();

    // Kapsamı geniş, raporu bol bir pay seçilir; küçük paylarda konsensüs
    // boş dönebilir ve bu hata değildir.
    let payload = api::get_analyst_reports(&state, Some("THYAO".into()), Some(false))
        .await
        .expect("komut yanıt vermeli");

    for report in &payload.reports {
        assert!(
            report.tickers.iter().any(|code| code == "THYAO"),
            "istenmeyen hisse listeye sızdı: {} ({:?})",
            report.title,
            report.tickers
        );
    }

    // Hisse istendiğinde konsensüs en çok tek kayıt döner ve o da aynı paya ait.
    assert!(payload.consensus.len() <= 1, "hisse modunda birden çok konsensüs kaydı");
    if let Some(row) = payload.consensus.first() {
        assert_eq!(row.ticker, "THYAO");
        assert!(row.total > 0, "THYAO için analist kapsamı beklenirdi");
        println!(
            "THYAO: {} rapor · {} kurum · tavsiye {:?} · ort. hedef {:?} · potansiyel {:?}",
            payload.reports.len(),
            row.total,
            row.rating,
            row.target_average,
            row.upside
        );
    }
}
