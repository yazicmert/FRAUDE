use tauri::State;

use crate::domain::{
    AiKeyRecord, AiRequest, AiResponse, DashboardSnapshot, FqlResponse, KapAnnouncement, KapFilter,
    SaveAiKeyRequest, ScreenerRequest, ScreenerResult, SyncResult, TickerSnapshot, NewsItem, AiHistoryRecord,
};
use crate::{secrets, services, AppState};
use fraude_core::api;

// ─────────────────────────────────────────────────────────────────────────────
// Paylaşımlı komutlar: gövdeler fraude-core/src/api.rs'te yaşar; buradaki
// sarmalayıcılar yalnızca Tauri State'i çözer. Web API (server/src/rpc.rs)
// aynı api::* fonksiyonlarını çağırır — sözleşme tek yerden değişir.
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn execute_fql(
    state: State<'_, AppState>,
    command: String,
    active_context: Option<String>,
) -> Result<FqlResponse, String> {
    api::execute_fql(&state, command, active_context).await
}

#[tauri::command]
pub async fn sync_data(
    state: State<'_, AppState>,
    source: String,
    mode: String,
) -> Result<SyncResult, String> {
    api::sync_data(&state, source, mode).await
}

#[tauri::command]
pub async fn get_dashboard_snapshot(state: State<'_, AppState>) -> Result<DashboardSnapshot, String> {
    api::get_dashboard_snapshot(&state).await
}

#[tauri::command]
pub async fn get_ticker_snapshot(
    state: State<'_, AppState>,
    ticker: String,
) -> Result<TickerSnapshot, String> {
    api::get_ticker_snapshot(&state, ticker).await
}

#[tauri::command]
pub async fn get_financial_statements(
    state: State<'_, AppState>,
    ticker: String,
) -> Result<crate::domain::FinancialStatement, String> {
    api::get_financial_statements(&state, ticker).await
}

#[tauri::command]
pub async fn run_screener(
    state: State<'_, AppState>,
    request: ScreenerRequest,
) -> Result<ScreenerResult, String> {
    api::run_screener(&state, request).await
}

#[tauri::command]
pub async fn list_kap_announcements(
    state: State<'_, AppState>,
    filter: KapFilter,
) -> Result<Vec<KapAnnouncement>, String> {
    api::list_kap_announcements(&state, filter).await
}

#[tauri::command]
pub async fn get_price_history(
    state: State<'_, AppState>,
    ticker: String,
    range: Option<String>,
    source: Option<String>,
) -> Result<Vec<crate::domain::HistoricalQuote>, String> {
    api::get_price_history(&state, ticker, range, source).await
}

#[tauri::command]
pub async fn get_market_holidays(
    state: State<'_, AppState>,
) -> Result<Vec<crate::market_calendar::MarketHoliday>, String> {
    api::get_market_holidays(&state).await
}

#[tauri::command]
pub async fn get_funds(state: State<'_, AppState>) -> Result<Vec<crate::tefas::FundRow>, String> {
    api::get_funds(&state).await
}

#[tauri::command]
pub async fn get_fund_returns(
    state: State<'_, AppState>,
) -> Result<Vec<crate::tefas::FundReturns>, String> {
    api::get_fund_returns(&state).await
}

#[tauri::command]
pub async fn get_ticker_funds(
    state: State<'_, AppState>,
    ticker: String,
) -> Result<api::TickerFundsPayload, String> {
    api::get_ticker_funds(&state, ticker).await
}

#[tauri::command]
pub async fn get_fund_holdings_ai(
    state: State<'_, AppState>,
    code: String,
) -> Result<crate::kap_pdr::FundHoldingsReport, String> {
    api::get_fund_holdings_ai(&state, code).await
}

#[tauri::command]
pub async fn get_fund_allocation(
    state: State<'_, AppState>,
    code: String,
) -> Result<Vec<crate::tefas::FundAllocation>, String> {
    api::get_fund_allocation(&state, code).await
}

#[tauri::command]
pub async fn get_fund_history(
    state: State<'_, AppState>,
    code: String,
    months: u32,
) -> Result<Vec<(String, f64)>, String> {
    api::get_fund_history(&state, code, months).await
}

#[tauri::command]
pub async fn get_fund_issuer(
    state: State<'_, AppState>,
    fund_name: String,
) -> Result<Option<crate::tefas_issuer::FundIssuer>, String> {
    api::get_fund_issuer(&state, fund_name).await
}

#[tauri::command]
pub async fn get_fund_disclosures(
    state: State<'_, AppState>,
    code: String,
) -> Result<Vec<crate::kap::FundDisclosure>, String> {
    api::get_fund_disclosures(&state, code).await
}

#[tauri::command]
pub async fn get_fund_holdings(
    state: State<'_, AppState>,
    code: String,
) -> Result<crate::kap_pdr::FundHoldingsReport, String> {
    api::get_fund_holdings(&state, code).await
}

#[tauri::command]
pub async fn get_live_quotes(
    state: State<'_, AppState>,
    tickers: Vec<String>,
) -> Result<Vec<crate::live_quotes::LiveQuote>, String> {
    api::get_live_quotes(&state, tickers).await
}

#[tauri::command]
pub async fn get_economic_calendar(
    state: State<'_, AppState>,
) -> Result<Vec<crate::economic_calendar::EconomicEvent>, String> {
    api::get_economic_calendar(&state).await
}

#[tauri::command]
pub async fn get_news_feed(
    state: State<'_, AppState>,
    ticker: Option<String>,
) -> Result<Vec<NewsItem>, String> {
    api::get_news_feed(&state, ticker).await
}

#[tauri::command]
pub async fn get_shareholders(
    state: State<'_, AppState>,
    ticker: String,
    force_refresh: Option<bool>,
) -> Result<crate::shareholders::ShareholderSnapshot, String> {
    api::get_shareholders(&state, ticker, force_refresh).await
}

#[tauri::command]
pub async fn get_subsidiaries(
    state: State<'_, AppState>,
    ticker: String,
    force_refresh: Option<bool>,
) -> Result<crate::subsidiaries::SubsidiarySnapshot, String> {
    api::get_subsidiaries(&state, ticker, force_refresh).await
}

#[tauri::command]
pub async fn research_entity_news(
    state: State<'_, AppState>,
    name: String,
    kind: String,
) -> Result<Vec<NewsItem>, String> {
    api::research_entity_news(&state, name, kind).await
}

#[tauri::command]
pub async fn get_news_preview(state: State<'_, AppState>, url: String) -> Result<String, String> {
    api::get_news_preview(&state, url).await
}

#[tauri::command]
pub async fn get_news_html(state: State<'_, AppState>, url: String) -> Result<String, String> {
    api::get_news_html(&state, url).await
}

#[tauri::command]
pub async fn get_bist_indices(state: State<'_, AppState>) -> Result<(std::collections::HashMap<String, Vec<crate::domain::IndexConstituent>>, Vec<crate::domain::IndexChange>), String> {
    api::get_bist_indices(&state).await
}

#[tauri::command]
pub async fn update_bist_indices(state: State<'_, AppState>) -> Result<(), String> {
    api::update_bist_indices(&state).await
}

#[tauri::command]
pub async fn get_corporate_events() -> Result<crate::domain::CorporateEventsPayload, String> {
    api::get_corporate_events().await
}

#[tauri::command]
pub async fn get_kap_for_ticker(
    state: State<'_, AppState>,
    ticker: String,
) -> Result<Vec<crate::domain::KapAnnouncement>, String> {
    api::get_kap_for_ticker(&state, ticker).await
}

#[tauri::command]
pub async fn get_dividends(
    state: State<'_, AppState>,
    ticker: String,
) -> Result<Vec<crate::domain::DividendRecord>, String> {
    api::get_dividends(&state, ticker).await
}

#[tauri::command]
pub async fn get_capital_increases(
    state: State<'_, AppState>,
    ticker: String,
) -> Result<Vec<crate::domain::CapitalIncrease>, String> {
    api::get_capital_increases(&state, ticker).await
}

#[tauri::command]
pub async fn get_ipo_calendar(
    state: State<'_, AppState>,
    force_refresh: Option<bool>,
) -> Result<crate::domain::IpoCalendarPayload, String> {
    api::get_ipo_calendar(&state, force_refresh).await
}

// ─────────────────────────────────────────────────────────────────────────────
// Kişi-başı / yerel komutlar: masaüstünde kalır (AI anahtarları OS keychain'e,
// izleme durumu yerel diske bağlı). Web karşılıkları Faz 2'de sunucuya gelir.
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ask_ai(state: State<'_, AppState>, request: AiRequest) -> Result<AiResponse, String> {
    let mut store = state.store.lock().await;
    Ok(services::ask_ai(&mut store, &state.http, request).await)
}

#[tauri::command]
pub async fn list_ai_keys(state: State<'_, AppState>) -> Result<Vec<AiKeyRecord>, String> {
    let store = state.store.lock().await;
    Ok(secrets::list(&store))
}

#[tauri::command]
pub async fn save_ai_key(
    state: State<'_, AppState>,
    request: SaveAiKeyRequest,
) -> Result<AiKeyRecord, String> {
    let mut store = state.store.lock().await;
    secrets::save(&mut store, request)
}

#[tauri::command]
pub async fn delete_ai_key(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<AiKeyRecord>, String> {
    let mut store = state.store.lock().await;
    secrets::delete(&mut store, &id)
}

#[tauri::command]
pub async fn set_default_ai_key(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<AiKeyRecord>, String> {
    let mut store = state.store.lock().await;
    secrets::set_default(&mut store, &id)
}

#[tauri::command]
pub async fn test_ai_key(state: State<'_, AppState>, id: String) -> Result<String, String> {
    let store = state.store.lock().await;
    secrets::test(&store, &id)
}

#[tauri::command]
pub async fn list_ai_history(state: tauri::State<'_, AppState>) -> Result<Vec<AiHistoryRecord>, String> {
    let store = state.store.lock().await;
    Ok(store.ai_history.clone())
}

#[tauri::command]
pub async fn delete_ai_history(state: tauri::State<'_, AppState>, id: String) -> Result<Vec<AiHistoryRecord>, String> {
    let mut store = state.store.lock().await;
    store.ai_history.retain(|record| record.id != id);
    store.save_ai_history();
    Ok(store.ai_history.clone())
}

#[tauri::command]
pub async fn clear_ai_history(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().await;
    store.ai_history.clear();
    store.save_ai_history();
    Ok(())
}

#[tauri::command]
pub async fn list_ai_agents(state: tauri::State<'_, AppState>) -> Result<Vec<crate::domain::AiAgent>, String> {
    let store = state.store.lock().await;
    Ok(store.agents.clone())
}

#[tauri::command]
pub async fn save_ai_agent(state: tauri::State<'_, AppState>, request: crate::domain::SaveAiAgentRequest) -> Result<crate::domain::AiAgent, String> {
    let mut store = state.store.lock().await;
    let id = request.id.unwrap_or_else(|| format!("agent-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()));
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%.3f%:z").to_string();

    // Ticker listesi normalize edilir; istek alanı hiç göndermediyse eski
    // bağlantılar korunur (farklı ekranlardan yapılan kayıtlar silmesin diye)
    let linked_tickers = match request.linked_tickers {
        Some(list) => {
            let mut seen = std::collections::HashSet::new();
            list.into_iter()
                .map(|t| t.trim().to_uppercase())
                .filter(|t| !t.is_empty() && t.len() <= 6 && seen.insert(t.clone()))
                .collect()
        }
        None => store
            .agents
            .iter()
            .find(|a| a.id == id)
            .map(|a| a.linked_tickers.clone())
            .unwrap_or_default(),
    };

    let agent = crate::domain::AiAgent {
        id: id.clone(),
        name: request.name,
        role_description: request.role_description,
        system_prompt: request.system_prompt,
        api_key_id: request.api_key_id,
        is_active: request.is_active,
        created_at: now,
        linked_artifacts: request.linked_artifacts.unwrap_or_default(),
        linked_tickers,
    };

    if let Some(existing) = store.agents.iter_mut().find(|a| a.id == id) {
        *existing = agent.clone();
    } else {
        store.agents.push(agent.clone());
    }

    store.save_agents();
    Ok(agent)
}

#[tauri::command]
pub async fn delete_ai_agent(state: tauri::State<'_, AppState>, id: String) -> Result<Vec<crate::domain::AiAgent>, String> {
    let mut store = state.store.lock().await;
    store.agents.retain(|a| a.id != id);
    store.save_agents();
    Ok(store.agents.clone())
}

#[tauri::command]
pub async fn list_artifacts(state: tauri::State<'_, AppState>) -> Result<Vec<crate::domain::Artifact>, String> {
    let store = state.store.lock().await;
    Ok(store.artifacts.clone())
}

#[tauri::command]
pub async fn save_artifact(state: tauri::State<'_, AppState>, request: crate::domain::SaveArtifactRequest) -> Result<crate::domain::Artifact, String> {
    let mut store = state.store.lock().await;
    let id = request.id.unwrap_or_else(|| format!("art-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()));
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%.3f%:z").to_string();

    let artifact = crate::domain::Artifact {
        id: id.clone(),
        title: request.title,
        content: request.content,
        created_at: now,
    };

    if let Some(pos) = store.artifacts.iter().position(|a| a.id == id) {
        store.artifacts[pos] = artifact.clone();
    } else {
        store.artifacts.push(artifact.clone());
    }

    store.save_artifacts();
    Ok(artifact)
}

#[tauri::command]
pub async fn delete_artifact(state: tauri::State<'_, AppState>, id: String) -> Result<Vec<crate::domain::Artifact>, String> {
    let mut store = state.store.lock().await;
    store.artifacts.retain(|a| a.id != id);
    store.save_artifacts();

    // Unlink this artifact from all agents
    for agent in &mut store.agents {
        agent.linked_artifacts.retain(|a_id| a_id != &id);
    }
    store.save_agents();

    Ok(store.artifacts.clone())
}

// ── KAP izleme motoru komutları ──────────────────────────────────────────

/// İzleme durumunu (yapılandırma + uyarılar) döndürür.
#[tauri::command]
pub async fn get_monitor_state(
    state: State<'_, AppState>,
) -> Result<crate::monitor::MonitorStateView, String> {
    Ok(state.monitor.lock().await.view())
}

/// Takip listesindeki hisseleri backend izleyicisine senkronlar.
/// Frontend, watchlist her değiştiğinde bunu çağırır.
#[tauri::command]
pub async fn sync_monitor_tickers(
    state: State<'_, AppState>,
    tickers: Vec<String>,
) -> Result<crate::monitor::MonitorStateView, String> {
    let mut normalized: Vec<String> = tickers
        .into_iter()
        .map(|t| t.trim().trim_end_matches(".IS").to_uppercase())
        .filter(|t| !t.is_empty())
        .collect();
    normalized.sort();
    normalized.dedup();

    let mut runtime = state.monitor.lock().await;
    if runtime.config.tickers != normalized {
        // Listeden çıkarılan hisselerin baseline işaretini de temizle ki
        // tekrar eklenirse geçmişiyle tekrar tohumlanabilsin.
        let removed: Vec<String> = runtime
            .config
            .tickers
            .iter()
            .filter(|t| !normalized.contains(t))
            .cloned()
            .collect();
        for ticker in removed {
            runtime.baselined.remove(&ticker);
        }
        runtime.config.tickers = normalized;
        crate::monitor::save(&runtime);
    }
    Ok(runtime.view())
}

/// İzleme yapılandırmasını günceller (açık/kapalı, aralık, ajan, OS bildirimi).
#[tauri::command]
pub async fn set_monitor_config(
    state: State<'_, AppState>,
    enabled: Option<bool>,
    interval_secs: Option<u64>,
    agent_id: Option<String>,
    os_notifications: Option<bool>,
    clear_agent: Option<bool>,
) -> Result<crate::monitor::MonitorStateView, String> {
    let mut runtime = state.monitor.lock().await;
    if let Some(value) = enabled {
        runtime.config.enabled = value;
    }
    if let Some(value) = interval_secs {
        runtime.config.interval_secs = crate::monitor::clamp_interval(value);
    }
    if clear_agent.unwrap_or(false) {
        runtime.config.agent_id = None;
    } else if agent_id.is_some() {
        runtime.config.agent_id = agent_id;
    }
    if let Some(value) = os_notifications {
        runtime.config.os_notifications = value;
    }
    crate::monitor::save(&runtime);
    Ok(runtime.view())
}

/// İzlemeyi hemen bir kez çalıştırır (elle "Şimdi Tara").
#[tauri::command]
pub async fn run_monitor_now(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<crate::monitor::MonitorStateView, String> {
    crate::run_monitor_and_notify(&app, &state).await;
    Ok(state.monitor.lock().await.view())
}

/// Tüm uyarıları okundu işaretler.
#[tauri::command]
pub async fn mark_monitor_alerts_read(
    state: State<'_, AppState>,
) -> Result<crate::monitor::MonitorStateView, String> {
    let mut runtime = state.monitor.lock().await;
    for alert in runtime.alerts.iter_mut() {
        alert.read = true;
    }
    crate::monitor::save(&runtime);
    Ok(runtime.view())
}

/// Uyarı listesini temizler (görülen parmak izleri korunur; tekrar uyarı üretilmez).
#[tauri::command]
pub async fn clear_monitor_alerts(
    state: State<'_, AppState>,
) -> Result<crate::monitor::MonitorStateView, String> {
    let mut runtime = state.monitor.lock().await;
    runtime.alerts.clear();
    crate::monitor::save(&runtime);
    Ok(runtime.view())
}

#[tauri::command]
pub async fn run_agent_analysis(
    state: State<'_, AppState>,
    agent_id: String,
) -> Result<crate::domain::AgentAnalysisResult, String> {
    // Ajanı ve gerekli verileri kısa kilitle kopyala; ağ işlemleri kilitsiz yapılır
    let (agent, key, equities) = {
        let store = state.store.lock().await;
        let agent = store
            .agents
            .iter()
            .find(|a| a.id == agent_id)
            .cloned()
            .ok_or_else(|| "Ajan bulunamadı".to_string())?;
        if !agent.is_active {
            return Err("Ajan pasif durumda. Önce aktifleştirin.".into());
        }
        if agent.linked_tickers.is_empty() {
            return Err("Bu ajana bağlı hisse yok. Ajan Düzenle ekranından hisse kodu ekleyin (ör: ASELS, THYAO).".into());
        }
        let key = store
            .ai_keys
            .iter()
            .find(|k| k.id == agent.api_key_id && k.enabled)
            .or_else(|| store.ai_keys.iter().find(|k| k.is_default && k.enabled))
            .or_else(|| store.ai_keys.iter().find(|k| k.enabled))
            .cloned()
            .ok_or_else(|| "Kullanılabilir AI anahtarı yok. Ayarlar'dan bir anahtar ekleyin.".to_string())?;
        (agent, key, store.equities.clone())
    };

    // Bağlam yalnızca ilk N hisse için toplanır (ağ maliyeti sınırı); geri
    // kalanlar analiz dışıdır. Prompt, başlık ve sonuç yalnızca gerçekten
    // veri toplanan hisseleri iddia etmeli ki model veri görmediği hisse
    // hakkında yorum uydurmasın.
    let (context, analyzed) =
        services::gather_agent_context(&state.http, &agent.linked_tickers, &equities).await;
    let skipped: Vec<String> = agent
        .linked_tickers
        .iter()
        .filter(|ticker| !analyzed.contains(ticker))
        .cloned()
        .collect();

    let system_prompt = format!(
        "Sen '{}' adlı yapay zeka ajanısın. Görevin: {}\n\nSana verilen KAP bildirimlerini, haberleri ve fiyat bilgilerini okuyup YALNIZCA bağlamı verilen hisseler için Türkçe, maddeli, kısa bir ÖZET NOT hazırla. Bağlamı verilmeyen hiçbir hisse hakkında yorum yapma, veri uydurma. Önemli gelişmeleri, olası etkileri ve dikkat edilecek noktaları belirt. Düz metin yaz (JSON kullanma). Sona 'Bu çıktı yatırım tavsiyesi değildir.' notunu ekle.",
        agent.name, agent.role_description
    );
    let mut user_prompt = format!(
        "Analiz edilecek hisseler (bağlamı aşağıda verilenler): {}\n{}\n\nYalnızca yukarıda verisi bulunan hisseler için özet notu hazırla.",
        analyzed.join(", "),
        context
    );
    if !skipped.is_empty() {
        user_prompt.push_str(&format!(
            "\n\nUYARI: Şu hisseler bu turda veri limiti (en fazla {} hisse) nedeniyle analiz DIŞI bırakıldı; bunlar hakkında YORUM YAPMA: {}.",
            services::AGENT_CONTEXT_MAX_TICKERS,
            skipped.join(", ")
        ));
    }

    let mut summary = services::run_completion(&state.http, &key, &system_prompt, &user_prompt).await?;
    // Kırpma olduysa kullanıcı çıktının eksik kapsamını görebilsin.
    if !skipped.is_empty() {
        summary.push_str(&format!(
            "\n\n— Not: Bu tur yalnızca {} hisseyi kapsadı. Veri limiti nedeniyle analiz dışı kalan: {}. Bir sonraki turda kapsanacak şekilde ajanı ayrı çalıştırabilirsiniz.",
            analyzed.join(", "),
            skipped.join(", ")
        ));
    }

    // Özeti kalıcı Artifact olarak kaydet ve ajanın hafızasına bağla
    let now = chrono::Local::now();
    let artifact_id = format!("art-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis());
    let ticker_label = if skipped.is_empty() {
        analyzed.join(", ")
    } else {
        format!("{} (+{} atlandı)", analyzed.join(", "), skipped.len())
    };
    let artifact_title = format!("🤖 {} — {} — {}", agent.name, ticker_label, now.format("%d.%m.%Y %H:%M"));

    let mut store = state.store.lock().await;
    store.artifacts.push(crate::domain::Artifact {
        id: artifact_id.clone(),
        title: artifact_title.clone(),
        content: summary.clone(),
        created_at: now.format("%Y-%m-%dT%H:%M:%S%.3f%:z").to_string(),
    });
    store.save_artifacts();
    if let Some(stored_agent) = store.agents.iter_mut().find(|a| a.id == agent_id) {
        stored_agent.linked_artifacts.push(artifact_id.clone());
        store.save_agents();
    }

    Ok(crate::domain::AgentAnalysisResult {
        summary,
        artifact_id,
        artifact_title,
        tickers: analyzed,
    })
}
