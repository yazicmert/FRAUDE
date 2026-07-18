mod commands;
mod module_updater;
mod publisher;

// Veri katmanı fraude-core'da yaşar (bkz. core/); yeniden dışa aktarım
// sayesinde commands.rs içindeki `crate::X` yolları aynen çalışır.
pub use fraude_core::{
    ai_tagger, bist, bist_indices, bist_universe, corporate_actions, domain,
    economic_calendar, fql, fundamentals, indicators, ipo_scraper, ipo_store, isyatirim,
    isyatirim_price, kap, kap_pdr, keychain, live_quotes, market_calendar, monitor, news,
    news_tagger, persist, providers, refresh_ipo_cache, secrets, services, shareholders, spk,
    storage, subsidiaries, tefas, tefas_issuer, yahoo, AppState, IpoCache,
    IPO_REFRESH_INTERVAL_SECS,
};
use tauri::Manager;

/// Bir izleme turu çalıştırır; yeni uyarı çıktıysa webview'e olay ve
/// (yapılandırılmışsa) işletim sistemi bildirimi gönderir.
pub async fn run_monitor_and_notify(handle: &tauri::AppHandle, state: &AppState) {
    use tauri::Emitter;

    let new_alerts = monitor::run_cycle(state).await;
    if new_alerts.is_empty() {
        return;
    }

    let unread = { state.monitor.lock().await.unread_count() };
    // Webview her zaman güncellenir (zil rozeti + panel canlı yenilenir).
    let _ = handle.emit(
        "fraude-monitor-alert",
        serde_json::json!({ "alerts": new_alerts, "unread": unread }),
    );

    let os_enabled = { state.monitor.lock().await.config.os_notifications };
    if !os_enabled {
        return;
    }

    use tauri_plugin_notification::NotificationExt;
    // Yalnızca önemli (ortaklık/iş ilişkisi) olaylar için OS bildirimi;
    // gürültüyü azaltmak adına en fazla ilk 3 uyarı gösterilir.
    let material: Vec<&monitor::MonitorAlert> = new_alerts
        .iter()
        .filter(|a| a.severity >= 7)
        .take(3)
        .collect();
    for alert in material {
        let icon = match alert.event_type.as_str() {
            monitor::EVENT_OWNERSHIP => "🔴 Ortaklık değişimi",
            monitor::EVENT_BUSINESS => "🤝 Yeni iş ilişkisi",
            _ => "📢 KAP",
        };
        let body = alert
            .ai_comment
            .clone()
            .unwrap_or_else(|| alert.title.clone());
        let _ = handle
            .notification()
            .builder()
            .title(format!("{icon} · {}", alert.ticker))
            .body(body)
            .show();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Windows/Linux'ta derin bağlantı ikinci örnek açar; single-instance
    // (deep-link özelliği) adresi çalışan örneğe iletir. İlk eklenti olmalı.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}));

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState::new())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    let state = handle.state::<AppState>();
                    refresh_ipo_cache(&state).await;

                    // Haftada bir: ana sayfadan düşmüş eski arzları yıl
                    // arşivlerinden tamamla, değişiklik olduysa cache'i tazele.
                    if corporate_actions::backfill_ipo_history(&state.http).await {
                        let records = corporate_actions::load_archive_records();
                        let mut cache = state.ipo_cache.lock().await;
                        cache.base_records = records;
                        cache.last_updated =
                            Some(chrono::Local::now().format("%d.%m.%Y %H:%M").to_string());
                    }

                    // Günde bir: piyasa geneli temettü/bölünme akışını topla
                    if corporate_actions::market_events_stale() {
                        corporate_actions::refresh_market_events(&state.http).await;
                    }

                    tokio::time::sleep(std::time::Duration::from_secs(IPO_REFRESH_INTERVAL_SECS)).await;
                }
            });

            // PDR ters dizin taraması: en büyük fonların aylık portföy dağılım
            // raporlarını arka planda toplar; "bu hisseyi hangi fonlar tutuyor"
            // sorusu bu birikmiş dizinden anında yanıtlanır. Rapor aylık olduğu
            // için dönemi güncel kayıtlar atlanır; oturum başına indirme sınırlı
            // ve istekler aralıklıdır (KAP'a nazik).
            let pdr_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Açılış trafiği (liste, pano, izleme) yatışsın
                tokio::time::sleep(std::time::Duration::from_secs(45)).await;
                let state = pdr_handle.state::<AppState>();
                let funds = tefas::get_funds(&state.http).await;
                // Hisse taşıma olasılığı yüksek türler; büyükten küçüğe
                let codes: Vec<String> = funds
                    .iter()
                    .filter(|f| matches!(f.kind.as_str(), "YAT" | "EMK" | "BYF"))
                    .map(|f| f.code.clone())
                    .take(150)
                    .collect();
                kap_pdr::crawl_fund_holdings(&state.http, &codes, 60).await;
            });

            // KAP izleme döngüsü: takip listesindeki hisselerin yeni
            // bildirimlerini periyodik tarar, uyarı üretir ve bildirir.
            let monitor_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // İlk turdan önce kısa bir gecikme: uygulama açılışı ve
                // takip listesi senkronu tamamlansın.
                tokio::time::sleep(std::time::Duration::from_secs(20)).await;
                loop {
                    let interval = {
                        let state = monitor_handle.state::<AppState>();
                        run_monitor_and_notify(&monitor_handle, &state).await;
                        let runtime = state.monitor.lock().await;
                        monitor::clamp_interval(runtime.config.interval_secs)
                    };
                    tokio::time::sleep(std::time::Duration::from_secs(interval)).await;
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::execute_fql,
            commands::sync_data,
            commands::get_dashboard_snapshot,
            commands::get_ticker_snapshot,
            commands::run_screener,
            commands::list_kap_announcements,
            commands::ask_ai,
            commands::list_ai_keys,
            commands::save_ai_key,
            commands::delete_ai_key,
            commands::set_default_ai_key,
            commands::test_ai_key,
            commands::list_ai_history,
            commands::delete_ai_history,
            commands::clear_ai_history,
            commands::list_ai_agents,
            commands::save_ai_agent,
            commands::delete_ai_agent,
            commands::list_artifacts,
            commands::save_artifact,
            commands::delete_artifact,
            commands::get_price_history,
            commands::get_market_holidays,
            commands::get_economic_calendar,
            commands::get_funds,
            commands::get_fund_allocation,
            commands::get_fund_history,
            commands::get_fund_issuer,
            commands::get_fund_disclosures,
            commands::get_fund_holdings,
            commands::get_fund_returns,
            commands::get_ticker_funds,
            commands::get_live_quotes,
            commands::get_news_feed,
            commands::get_news_preview,
            commands::get_news_html,
            commands::get_bist_indices,
            commands::update_bist_indices,
            commands::get_financial_statements,
            commands::get_dividends,
            commands::get_capital_increases,
            commands::get_ipo_calendar,
            commands::get_kap_for_ticker,
            commands::get_shareholders,
            commands::get_subsidiaries,
            commands::research_entity_news,
            commands::get_monitor_state,
            commands::sync_monitor_tickers,
            commands::set_monitor_config,
            commands::run_monitor_now,
            commands::mark_monitor_alerts_read,
            commands::clear_monitor_alerts,
            commands::get_corporate_events,
            commands::run_agent_analysis,
            module_updater::activate_module_release,
            module_updater::rollback_module_release,
            publisher::publish_config_status,
            publisher::publish_module_release,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
