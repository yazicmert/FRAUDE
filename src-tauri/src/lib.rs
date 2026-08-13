mod bridge;
mod commands;
mod device;
mod module_updater;
mod publisher;
mod research_worker;

// Veri katmanı fraude-core'da yaşar (bkz. core/); yeniden dışa aktarım
// sayesinde commands.rs içindeki `crate::X` yolları aynen çalışır.
pub use fraude_core::{
    ai_tagger, bist, bist_indices, bist_universe, corporate_actions, domain,
    economic_calendar, fql, fundamentals, indicators, ipo_scraper, ipo_store, isyatirim,
    isyatirim_price, kap, kap_dividend, kap_pdr, keychain, live_quotes, market_calendar, monitor, news,
    news_tagger, persist, providers, refresh_ipo_cache, research, secrets, services, shareholders,
    spk, storage, subsidiaries, tefas, tefas_issuer, yahoo, AppState, IpoCache,
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
    // single_instance::init callback'i sarmalar: deep-link özelliği açıkken
    // adresi çağırmadan ÖNCE deep-link eklentisine iletir, bu yüzden gövde boş.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}));

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState::new())
        .manage(research_worker::ResearchSignal::default())
        .manage(bridge::BridgeHandle::load())
        .setup(|app| {
            // fraude:// şemasını her açılışta kaydet. Windows/Linux'ta kaydı
            // normalde kurulum yapar; kurulum atlanmışsa (taşınabilir kopya,
            // geliştirme derlemesi) ya da başka bir kurulum kaydı ezmişse
            // GitHub girişinin dönüşü hiç ulaşmaz. Windows'ta HKCU'ya yazar,
            // yönetici hakkı istemez. macOS'ta şema paketin Info.plist'inden
            // gelir; orada çağrı UnsupportedPlatform döner, bu beklenen
            // durumdur ve sessiz geçilir. Diğer hatalar girişi engellemesin
            // diye yalnız günlüğe düşer.
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::{DeepLinkExt, Error as DeepLinkError};
                match app.deep_link().register_all() {
                    Ok(()) | Err(DeepLinkError::UnsupportedPlatform) => {}
                    Err(error) => eprintln!("deep-link şeması kaydedilemedi: {error}"),
                }
            }

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

            // Temettü tarayıcısı: KAP "Kar Payı Dağıtım İşlemlerine İlişkin
            // Bildirim"leri temettünün resmî kaynağı. Kendi döngüsünde çalışır
            // çünkü haftalık backfill'in bütçesi akışın gerisinde kalıyordu;
            // kuyruk kalıcı, ilerleme her turda diske yazılıyor.
            let dividend_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Açılış trafiği yatışsın; ilk turun aceleyle KAP'a yüklenmesi
                // kullanıcının beklediği isteklerden pay götürürdü.
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                let state = dividend_handle.state::<AppState>();
                kap_dividend::crawl(&state.http).await;
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
                        // Aralık saate duyarlıdır: bildirimlerin yayımlandığı
                        // saatlerde sık, gece/hafta sonu seyrek.
                        monitor::effective_interval(
                            runtime.config.interval_secs,
                            chrono::Local::now(),
                        )
                    };
                    tokio::time::sleep(std::time::Duration::from_secs(interval)).await;
                }
            });

            // Araştırma worker'ı: kuyruktaki AI araştırma işlerini (uygulama ve
            // Chrome eklentisi kaynaklı) arka planda işler.
            let research_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                research_worker::run_research_worker(research_handle).await;
            });

            // Chrome eklentisi köprüsü: 127.0.0.1'de araştırma görevi alır.
            let bridge_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                bridge::run_bridge(bridge_handle).await;
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
            commands::get_kap_disclosure_detail,
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
            commands::get_fund_holdings_ai,
            commands::get_live_quotes,
            commands::get_news_feed,
            commands::get_news_preview,
            commands::get_news_html,
            commands::get_bist_indices,
            commands::update_bist_indices,
            commands::get_financial_statements,
            commands::get_dividends,
            commands::get_capital_increases,
            commands::get_analyst_reports,
            commands::get_report_document,
            device::device_identity,
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
            commands::submit_research_job,
            commands::list_research_jobs,
            commands::get_research_job,
            commands::delete_research_job,
            commands::cancel_research_job,
            commands::get_team_config,
            commands::save_team_config,
            commands::get_bridge_info,
            commands::regenerate_bridge_token,
            commands::set_bridge_identity,
            module_updater::activate_module_release,
            module_updater::rollback_module_release,
            publisher::publish_config_status,
            publisher::publish_module_release,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
