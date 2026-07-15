use tauri::State;

use crate::providers::DataProvider;
use crate::domain::{
    AiKeyRecord, AiRequest, AiResponse, DashboardSnapshot, FqlResponse, KapAnnouncement, KapFilter,
    SaveAiKeyRequest, ScreenerRequest, ScreenerResult, SyncResult, TickerSnapshot, NewsItem, AiHistoryRecord,
};
use crate::{secrets, services, AppState};

#[tauri::command]
pub async fn execute_fql(
    state: State<'_, AppState>,
    command: String,
    active_context: Option<String>,
) -> Result<FqlResponse, String> {
    let mut store = state.store.lock().await;
    services::execute(&mut store, &state.http, &command, active_context).await
}

#[tauri::command]
pub async fn sync_data(
    state: State<'_, AppState>,
    source: String,
    mode: String,
) -> Result<SyncResult, String> {
    let force_bist = source == "BIST_INDICES";
    let (equities_res, kap_res, spk_res) = tokio::join!(
        crate::yahoo::fetch_all_equities(&state.http, force_bist),
        crate::kap::fetch_kap_announcements(&state.http),
        crate::spk::fetch_latest_bulletins(&state.http)
    );
    let equities = equities_res;
    let kap = kap_res.unwrap_or_default();
    let spk = spk_res.unwrap_or_default();

    // Lock the mutex briefly only to save the new records
    let mut store = state.store.lock().await;
    let eq_count = equities.len();
    if !equities.is_empty() {
        store.equities = equities;
    }
    if !kap.is_empty() {
        store.kap = kap;
    }
    if !spk.is_empty() {
        store.spk_bulletins = spk;
    }

    store.sources = vec![
        crate::providers::BistProvider.status(store.equities.len()),
        crate::providers::FundamentalsProvider.status(store.equities.iter().filter(|row| row.fundamentals_available).count()),
        crate::providers::IpoIndexProvider.status(store.equities.iter().filter(|row| row.index_memberships.iter().any(|index| index == "BIST HALKA ARZ")).count()),
        crate::providers::KapProvider.status(store.kap.len()),
        crate::providers::EvdsProvider.status(0),
        crate::providers::TuikProvider.status(0),
        crate::providers::NewsProvider.status(0),
        crate::providers::CsvProvider.status(0),
    ];

    Ok(SyncResult {
        source,
        mode,
        status: "completed".into(),
        message: format!("Synced {} equities from Yahoo Finance.", eq_count),
        updated_records: eq_count + store.kap.len(),
    })
}

#[tauri::command]
pub async fn get_dashboard_snapshot(state: State<'_, AppState>) -> Result<DashboardSnapshot, String> {
    let store = state.store.lock().await;
    Ok(services::dashboard(&store, &state.http).await)
}

#[tauri::command]
pub async fn get_ticker_snapshot(
    state: State<'_, AppState>,
    ticker: String,
) -> Result<TickerSnapshot, String> {
    let normalized = ticker.trim().to_uppercase();

    {
        let store = state.store.lock().await;
        if let Ok(snapshot) = services::ticker_snapshot(&store, &normalized) {
            return Ok(snapshot);
        }
    }

    // Yerel evrende yok (örn. sync'ten önce tıklanan yeni halka arz):
    // Yahoo'dan canlı çek; şirket adını IPO arşivinden bulmaya çalış.
    let name = crate::ipo_store::load()
        .iter()
        .find(|p| p.ticker == normalized)
        .map(|p| p.name.clone())
        .unwrap_or_else(|| normalized.clone());

    let equity = crate::yahoo::fetch_equity(&state.http, &normalized, &name)
        .await
        .map_err(|e| format!("{normalized} yerel evrende yok ve canlı veri alınamadı: {e}"))?;

    let mut store = state.store.lock().await;
    if !store.equities.iter().any(|row| row.ticker == normalized) {
        store.equities.push(equity.clone());
    }
    let kap = services::filter_kap(
        &store,
        crate::domain::KapFilter { ticker: Some(normalized), category: None, limit: Some(5) },
    );

    Ok(TickerSnapshot {
        technical_summary: services::technical_summary(&equity),
        fundamental_summary: services::fundamental_summary(&equity),
        equity,
        kap,
    })
}

#[tauri::command]
pub async fn get_financial_statements(
    state: State<'_, AppState>,
    ticker: String,
) -> Result<crate::domain::FinancialStatement, String> {
    crate::fundamentals::get_financial_statements(&state.http, &ticker).await
}

#[tauri::command]
pub async fn run_screener(
    state: State<'_, AppState>,
    request: ScreenerRequest,
) -> Result<ScreenerResult, String> {
    let store = state.store.lock().await;
    let query = match request.market {
        Some(market) => format!("{market} {}", request.query),
        None => request.query,
    };
    Ok(services::run_screener_query(&store, &query))
}

#[tauri::command]
pub async fn list_kap_announcements(
    state: State<'_, AppState>,
    filter: KapFilter,
) -> Result<Vec<KapAnnouncement>, String> {
    let store = state.store.lock().await;
    Ok(services::filter_kap(&store, filter))
}

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

#[tauri::command]
pub async fn get_price_history(
    state: State<'_, AppState>,
    ticker: String,
    range: Option<String>,
    source: Option<String>,
) -> Result<Vec<crate::domain::HistoricalQuote>, String> {
    let r = range.unwrap_or_else(|| "6mo".to_string());
    // Kullanıcı grafikte "İş Yatırım" kaynağını seçtiyse fiyat serisi oradan
    // gelir (düzeltilmiş kapanış-only). Yalnızca BIST hisseleri için anlamlıdır;
    // frontend seçiciyi zaten yalnız BIST sembollerinde gösterir.
    if source.as_deref() == Some("isyatirim") {
        return crate::isyatirim_price::fetch_price_history(&state.http, &ticker, &r).await;
    }
    // X ile başlayan BIST endeksleri Borsa İstanbul'dan gelir; XRP-USD gibi
    // kripto sembolleri bu yola girmemeli.
    if ticker.starts_with('X') && !ticker.contains('-') && (ticker.ends_with(".IS") || !ticker.contains('=')) {
        if let Ok(rows) = crate::bist::fetch_index_history(&state.http, &ticker, &r).await {
            if !rows.is_empty() { return Ok(rows); }
        }
    }
    // GRAM ALTIN / GRAM GÜMÜŞ özel dönüşümü (ons → gram TL) fetch_price_history
    // içinde yapılır; burada erken eşleme yapılırsa TL dönüşümü devre dışı kalır.
    crate::yahoo::fetch_price_history(&state.http, &ticker, &r).await
}

#[tauri::command]
pub async fn get_news_feed(
    state: State<'_, AppState>,
    ticker: Option<String>,
) -> Result<Vec<NewsItem>, String> {
    let company = if let Some(symbol) = ticker.as_ref() {
        let store = state.store.lock().await;
        store
            .equities
            .iter()
            .find(|row| row.ticker.eq_ignore_ascii_case(symbol))
            .map(|row| row.name.clone())
    } else {
        None
    };

    let mut items = services::get_news_feed(&state.http, ticker.as_deref(), company.as_deref()).await?;
    
    // Apply rule-based news tagging
    let store = state.store.lock().await;
    for item in items.iter_mut() {
        crate::news_tagger::tag_news(item, &store.equities);
    }
    
    Ok(items)
}

#[tauri::command]
pub async fn get_shareholders(
    state: State<'_, AppState>,
    ticker: String,
    force_refresh: Option<bool>,
) -> Result<crate::shareholders::ShareholderSnapshot, String> {
    crate::shareholders::get_shareholders(&state.http, &ticker, force_refresh.unwrap_or(false)).await
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

/// KAP Genel Bilgiler sayfasından bağlı ortaklık / iştirak tablosu.
#[tauri::command]
pub async fn get_subsidiaries(
    state: State<'_, AppState>,
    ticker: String,
    force_refresh: Option<bool>,
) -> Result<crate::subsidiaries::SubsidiarySnapshot, String> {
    crate::subsidiaries::get_subsidiaries(&state.http, &ticker, force_refresh.unwrap_or(false)).await
}

/// Ortaklık yapısındaki bir ortak (şirket ya da gerçek kişi) için haber araması.
/// `kind`: "company" | "person" — kişilerde arama penceresi geniş tutulur.
#[tauri::command]
pub async fn research_entity_news(
    state: State<'_, AppState>,
    name: String,
    kind: String,
) -> Result<Vec<NewsItem>, String> {
    services::research_entity_news(&state.http, &name, &kind).await
}

#[tauri::command]
pub async fn get_news_preview(state: State<'_, AppState>, url: String) -> Result<String, String> {
    services::get_news_preview(&state.http, &url).await
}

#[tauri::command]
pub async fn get_news_html(state: State<'_, AppState>, url: String) -> Result<String, String> {
    services::get_news_html(&state.http, &url).await
}

#[tauri::command]
pub async fn get_bist_indices(state: State<'_, AppState>) -> Result<(std::collections::HashMap<String, Vec<crate::domain::IndexConstituent>>, Vec<crate::domain::IndexChange>), String> {
    let store = state.store.lock().await;
    Ok((store.indices.clone(), store.index_changes.clone()))
}

#[tauri::command]
pub async fn update_bist_indices(state: State<'_, AppState>) -> Result<(), String> {
    let url = "https://borsaistanbul.com/datum/hisse_endeks_ds.csv";
    let resp = state.http.get(url).send().await.map_err(|e| e.to_string())?;
    let text = resp.text().await.map_err(|e| e.to_string())?;
    
    let mut new_indices: std::collections::HashMap<String, Vec<crate::domain::IndexConstituent>> = std::collections::HashMap::new();
    let mut changes: Vec<crate::domain::IndexChange> = Vec::new();
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    
    for (i, line) in text.lines().enumerate() {
        if i < 2 { continue; } // skip headers
        let parts: Vec<&str> = line.split(';').collect();
        if parts.len() >= 4 {
            let mut ticker = parts[0].trim().to_string();
            if ticker.ends_with(".E") {
                ticker = ticker.trim_end_matches(".E").to_string();
            }
            let name = parts[1].trim().to_string();
            let index_code = parts[2].trim().to_string(); // INDEX CODE (e.g. XU100)
            
            new_indices.entry(index_code).or_default().push(crate::domain::IndexConstituent {
                ticker,
                name,
            });
        }
    }
    
    let mut store = state.store.lock().await;
    
    // Compare and find changes
    if !store.indices.is_empty() {
        for (index_name, new_list) in &new_indices {
            if let Some(old_list) = store.indices.get(index_name) {
                let old_tickers: std::collections::HashSet<_> = old_list.iter().map(|c| c.ticker.clone()).collect();
                let new_tickers: std::collections::HashSet<_> = new_list.iter().map(|c| c.ticker.clone()).collect();
                
                for t in new_tickers.difference(&old_tickers) {
                    changes.push(crate::domain::IndexChange {
                        ticker: t.clone(),
                        index_code: index_name.clone(),
                        action: "ADDED".into(),
                        date: today.clone(),
                    });
                }
                for t in old_tickers.difference(&new_tickers) {
                    changes.push(crate::domain::IndexChange {
                        ticker: t.clone(),
                        index_code: index_name.clone(),
                        action: "REMOVED".into(),
                        date: today.clone(),
                    });
                }
            }
        }
    }
    
    store.indices = new_indices;
    store.index_changes.extend(changes);
    // keep only last 100 changes
    if store.index_changes.len() > 100 {
        store.index_changes = store.index_changes.clone().into_iter().rev().take(100).collect();
        store.index_changes.reverse();
    }

    store.save_indices();

    // Isı haritası ve bülten filtreleri endeks listesini değil, hisse
    // satırlarındaki index_memberships alanını okur. Aynı CSV üyelik
    // önbelleğine de işlenir ve bellekteki hisseler hemen tazelenir; aksi
    // halde yeni bileşim ancak 30 günlük önbellek dolunca görünür olurdu.
    let fresh = crate::bist_indices::update_from_csv_text(&text);
    if !fresh.memberships.is_empty() {
        for equity in store.equities.iter_mut() {
            let Some(memberships) = fresh.memberships.get(&equity.ticker) else { continue };
            let mut updated = memberships.clone();
            // CSV'de yer almayan sentetik üyelikler (emtia, halka arz) korunur.
            for special in ["Emtialar", "BIST HALKA ARZ"] {
                if equity.index_memberships.iter().any(|m| m == special)
                    && !updated.iter().any(|m| m == special)
                {
                    updated.push(special.to_string());
                }
            }
            equity.index_memberships = updated;
            if let Some(change) = fresh.changes.get(&equity.ticker) {
                equity.index_changes = Some(change.clone());
            }
        }
    }

    Ok(())
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

#[tauri::command]
pub async fn get_corporate_events() -> Result<crate::domain::CorporateEventsPayload, String> {
    let cache = crate::corporate_actions::load_market_events();
    Ok(crate::domain::CorporateEventsPayload {
        ready: cache.last_updated_ts > 0,
        last_updated: cache.last_updated,
        dividends: cache.dividends,
        splits: cache.splits,
        upcoming: cache.upcoming,
    })
}

#[tauri::command]
pub async fn get_kap_for_ticker(
    state: State<'_, AppState>,
    ticker: String,
) -> Result<Vec<crate::domain::KapAnnouncement>, String> {
    let normalized = ticker.trim().to_uppercase();

    // Şirket adı sorguyu güçlendirir: önce evrende, sonra IPO arşivinde ara
    let company = {
        let store = state.store.lock().await;
        store.equities.iter().find(|e| e.ticker == normalized).map(|e| e.name.clone())
    }
    .or_else(|| {
        crate::ipo_store::load()
            .iter()
            .find(|p| p.ticker == normalized)
            .map(|p| p.name.clone())
    });

    let live = services::fetch_kap_disclosures(&state.http, &normalized, company.as_deref())
        .await
        .unwrap_or_default();
    if !live.is_empty() {
        return Ok(live);
    }

    // Canlı arama sonuçsuzsa eşitlenmiş havuzdan süz
    let store = state.store.lock().await;
    Ok(services::filter_kap(
        &store,
        crate::domain::KapFilter { ticker: Some(normalized), category: None, limit: Some(10) },
    ))
}

#[tauri::command]
pub async fn get_dividends(
    state: State<'_, AppState>,
    ticker: String,
) -> Result<Vec<crate::domain::DividendRecord>, String> {
    crate::corporate_actions::fetch_dividends(&state.http, &ticker).await
}

#[tauri::command]
pub async fn get_capital_increases(
    state: State<'_, AppState>,
    ticker: String,
) -> Result<Vec<crate::domain::CapitalIncrease>, String> {
    crate::corporate_actions::fetch_capital_increases(&state.http, &ticker).await
}

#[tauri::command]
pub async fn get_ipo_calendar(
    state: State<'_, AppState>,
    force_refresh: Option<bool>,
) -> Result<crate::domain::IpoCalendarPayload, String> {
    const CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(30 * 60);

    let needs_refresh = {
        let cache = state.ipo_cache.lock().await;
        force_refresh.unwrap_or(false)
            || cache.base_records.is_empty()
            || cache.fetched_at.map(|t| t.elapsed() > CACHE_TTL).unwrap_or(true)
    };

    if needs_refresh {
        crate::refresh_ipo_cache(&state).await;
    }

    // Store kilidi yalnızca fiyat kopyası için kısaca tutulur; scrape sırasında asla.
    let equities = {
        let store = state.store.lock().await;
        store.equities.clone()
    };

    let cache = state.ipo_cache.lock().await;
    let mut records = cache.base_records.clone();
    crate::corporate_actions::apply_market_prices(&mut records, &equities);

    Ok(crate::domain::IpoCalendarPayload {
        records,
        last_updated: cache.last_updated.clone(),
        scrape_ok: cache.scrape_ok,
    })
}
