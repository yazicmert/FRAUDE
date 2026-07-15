use std::collections::HashSet;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::domain::{
    AiRequest, AiResponse, DashboardSnapshot, EquityRow, FqlResponse, KapAnnouncement, KapFilter,
    MarketMetric, ScreenerResult, SyncResult, TickerSnapshot,
};
use crate::fql::{self, FqlCommand};
use crate::providers::{
    BistProvider, CsvProvider, DataProvider, EvdsProvider, FundamentalsProvider, IpoIndexProvider,
    KapProvider, NewsProvider, TuikProvider,
};
use crate::storage::AppStore;

pub fn clock_string() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default();
    format!("unix:{secs}")
}

pub async fn dashboard(store: &AppStore, client: &reqwest::Client) -> DashboardSnapshot {
    let mut top_gainers = store.equities.clone();
    top_gainers.sort_by(|a, b| b.change_pct.total_cmp(&a.change_pct));

    let mut risk_watch = store.equities.clone();
    risk_watch.sort_by(|a, b| a.rsi.total_cmp(&b.rsi));

    // Try fetching live market metrics, fall back to hardcoded if it fails
    let market_metrics = {
        let live = crate::yahoo::fetch_market_metrics(client).await;
        if live.is_empty() {
            vec![
                MarketMetric { symbol: "BIST 100".into(), value: "—".into(), change: "—".into(), positive: true, as_of_ts: None },
                MarketMetric { symbol: "BIST 30".into(), value: "—".into(), change: "—".into(), positive: true, as_of_ts: None },
                MarketMetric { symbol: "BIST 50".into(), value: "—".into(), change: "—".into(), positive: true, as_of_ts: None },
                MarketMetric { symbol: "BIST BANKA".into(), value: "—".into(), change: "—".into(), positive: true, as_of_ts: None },
                MarketMetric { symbol: "BIST SINAI".into(), value: "—".into(), change: "—".into(), positive: true, as_of_ts: None },
                MarketMetric { symbol: "BIST TEKNOLOJI".into(), value: "—".into(), change: "—".into(), positive: true, as_of_ts: None },
                MarketMetric { symbol: "BIST HIZMETLER".into(), value: "—".into(), change: "—".into(), positive: true, as_of_ts: None },
                MarketMetric { symbol: "BIST HALKA ARZ".into(), value: "—".into(), change: "—".into(), positive: true, as_of_ts: None },
                MarketMetric { symbol: "USD/TRY".into(), value: "—".into(), change: "—".into(), positive: false, as_of_ts: None },
                MarketMetric { symbol: "EUR/TRY".into(), value: "—".into(), change: "—".into(), positive: true, as_of_ts: None },
            ]
        } else {
            live
        }
    };

    DashboardSnapshot {
        generated_at: clock_string(),
        market_metrics,
        top_gainers: top_gainers.into_iter().take(4).collect(),
        risk_watch: risk_watch.into_iter().take(4).collect(),
        data_sources: store.sources.clone(),
        equities: store.equities.clone(),
        spk_bulletins: store.spk_bulletins.clone(),
        kap_announcements: store.kap.clone(),
    }
}

pub fn ticker_snapshot(store: &AppStore, ticker: &str) -> Result<TickerSnapshot, String> {
    let normalized = ticker.to_uppercase();
    let equity = store
        .equities
        .iter()
        .find(|row| row.ticker == normalized)
        .cloned()
        .ok_or_else(|| format!("{normalized} was not found in the local universe. Run 'sync all' first."))?;
    let kap = filter_kap(
        store,
        KapFilter { ticker: Some(normalized), category: None, limit: Some(5) },
    );

    Ok(TickerSnapshot {
        technical_summary: technical_summary(&equity),
        fundamental_summary: fundamental_summary(&equity),
        equity,
        kap,
    })
}

pub fn filter_kap(store: &AppStore, filter: KapFilter) -> Vec<KapAnnouncement> {
    let mut rows = store.kap.clone();
    if let Some(ticker) = filter.ticker {
        let normalized = ticker.to_uppercase();
        rows.retain(|row| row.ticker == normalized);
    }
    if let Some(category) = filter.category {
        let normalized = category.to_lowercase();
        rows.retain(|row| row.category.to_lowercase().contains(&normalized));
    }
    rows.sort_by(|a, b| b.date.cmp(&a.date));
    rows.truncate(filter.limit.unwrap_or(25));
    rows
}

pub fn run_screener_query(store: &AppStore, query: &str) -> ScreenerResult {
    let rows = apply_simple_filters(&store.equities, query);
    let explanation = if rows.is_empty() {
        "No companies matched the filter.".into()
    } else {
        format!("{} companies matched the FQL filter.", rows.len())
    };
    ScreenerResult { query: query.into(), rows, explanation }
}

pub async fn ask_ai(store: &mut AppStore, client: &reqwest::Client, request: AiRequest) -> AiResponse {
    let mut selected_key_index = None;
    let mut custom_system_prompt = None;
    let mut artifact_contents = String::new();

    if let Some(agent_id) = &request.agent_id {
        if let Some(agent) = store.agents.iter().find(|a| &a.id == agent_id && a.is_active) {
            let api_key_id = &agent.api_key_id;
            selected_key_index = store.ai_keys.iter().position(|k| &k.id == api_key_id);
            custom_system_prompt = Some(agent.system_prompt.clone());
            
            // Build linked artifacts context
            for art_id in &agent.linked_artifacts {
                if let Some(artifact) = store.artifacts.iter().find(|a| &a.id == art_id) {
                    artifact_contents.push_str(&format!("\n\n--- BAĞLI BELGE ({}): ---\n{}\n--- BELGE SONU ---", artifact.title, artifact.content));
                }
            }
        }
    }

    let target_index = selected_key_index.or_else(|| {
        store.ai_keys.iter().position(|key| key.is_default && key.enabled)
            .or_else(|| store.ai_keys.iter().position(|key| key.enabled))
    });

    if let Some(index) = target_index {
        let key = &mut store.ai_keys[index];
        key.last_used_at = Some(clock_string());
        let provider = key.provider.clone();
        let model = key.default_model.clone();
        let secret = key.secret.clone();
        let context = request.active_context.unwrap_or_else(|| "global workspace".into());

        // Build context from equity data if a ticker is mentioned
        let base_prompt = custom_system_prompt.unwrap_or_else(|| {
            "Sen bir BIST/Türk finans analisti AI'sın. Kullanıcıya teknik ve temel analiz yaparak Türkçe yanıt ver. Bu çıktı yatırım tavsiyesi değildir.".to_string()
        });

        // Collect recent index changes and compositions for additional context
        let mut index_changes_str = String::new();
        let mut bist30 = Vec::new();
        let mut bist50 = Vec::new();
        let mut bist100 = Vec::new();

        for eq in &store.equities {
            // Collect changes
            if let Some(changes) = &eq.index_changes {
                if !changes.added.is_empty() || !changes.removed.is_empty() {
                    let added_str = if changes.added.is_empty() { String::new() } else { format!("Eklendi: {}", changes.added.join(", ")) };
                    let removed_str = if changes.removed.is_empty() { String::new() } else { format!("Çıkarıldı: {}", changes.removed.join(", ")) };
                    let sep = if !added_str.is_empty() && !removed_str.is_empty() { " | " } else { "" };
                    index_changes_str.push_str(&format!("- {}: {}{}{}\n", eq.ticker, added_str, sep, removed_str));
                }
            }
            
            // Collect compositions
            if eq.index_memberships.iter().any(|idx| idx == "BIST 30") { bist30.push(eq.ticker.clone()); }
            if eq.index_memberships.iter().any(|idx| idx == "BIST 50") { bist50.push(eq.ticker.clone()); }
            if eq.index_memberships.iter().any(|idx| idx == "BIST 100") { bist100.push(eq.ticker.clone()); }
        }
        
        let mut extra_context = String::new();
        extra_context.push_str("\n\nSistem Notu: Endeks verileri resmi olarak https://borsaistanbul.com/datum/hisse_endeks_ds.csv adresinden çekilmiştir.");
        
        if !bist30.is_empty() {
            extra_context.push_str(&format!("\nGüncel BIST 30 Hisseleri: {}", bist30.join(", ")));
        }
        if !bist50.is_empty() {
            extra_context.push_str(&format!("\nGüncel BIST 50 Hisseleri: {}", bist50.join(", ")));
        }
        if !bist100.is_empty() {
            extra_context.push_str(&format!("\nGüncel BIST 100 Hisseleri: {}", bist100.join(", ")));
        }

        if !index_changes_str.is_empty() {
            extra_context.push_str(&format!("\nSon Endeks Değişiklikleri:\n{}", index_changes_str));
        }
        
        if !artifact_contents.is_empty() {
            extra_context.push_str(&artifact_contents);
        }

        let system_prompt = format!("{}\n\nBağlam: {}{}", base_prompt, context, extra_context);

        let raw_url = key.api_url.as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| default_url_for_provider(&provider));

        let api_url = if raw_url.ends_with("/chat/completions") {
            raw_url
        } else if raw_url.ends_with('/') {
            format!("{}chat/completions", raw_url)
        } else {
            format!("{}/chat/completions", raw_url)
        };

        let mut messages = vec![
            serde_json::json!({ "role": "system", "content": system_prompt })
        ];

        match &request.history {
            // Panel aktif sohbetin mesajlarını kendisi gönderir; yeni sohbette
            // boş liste gelir ve araya eski, alakasız kayıtlar karışmaz.
            Some(history) => {
                let start = history.len().saturating_sub(12);
                for message in &history[start..] {
                    let role = if message.role == "assistant" { "assistant" } else { "user" };
                    messages.push(serde_json::json!({ "role": role, "content": message.content }));
                }
            }
            // Geçmiş göndermeyen çağrılar için küresel kayıttan en yeni üç
            // etkileşim eklenir. Kayıtlar listenin BAŞINA eklendiğinden en
            // yeniler ilk üç elemandır; sondan almak en eski kayıtları
            // gönderip her mesajın yeni sohbet gibi algılanmasına yol açar.
            None => {
                for record in store.ai_history.iter().take(3).rev() {
                    messages.push(serde_json::json!({ "role": "user", "content": record.prompt }));
                    messages.push(serde_json::json!({ "role": "assistant", "content": record.response }));
                }
            }
        }

        messages.push(serde_json::json!({ "role": "user", "content": request.prompt }));

        let body = serde_json::json!({
            "model": model,
            "messages": messages,
            "temperature": 0.7,
            "max_tokens": 1024
        });

        let response = match client.post(&api_url)
            .header("Authorization", format!("Bearer {}", secret))
            .header("Content-Type", "application/json")
            .json(&body)
            .send().await {
            Ok(resp) => {
                match resp.text().await {
                    Ok(text) => {
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                            if let Some(content) = json["choices"][0]["message"]["content"].as_str() {
                                AiResponse {
                                    provider, model,
                                    summary: content.to_string(),
                                    tool_calls: Vec::new(),
                                    disclaimer: "Bu çıktı yatırım tavsiyesi değildir.".into(),
                                }
                            } else if let Some(err_msg) = json["error"]["message"].as_str() {
                                AiResponse {
                                    provider, model,
                                    summary: format!("API Hatası: {}", err_msg),
                                    tool_calls: Vec::new(),
                                    disclaimer: "".into(),
                                }
                            } else if let Some(err_msg) = json["message"].as_str() {
                                AiResponse {
                                    provider, model,
                                    summary: format!("Sağlayıcı Hatası: {}", err_msg),
                                    tool_calls: Vec::new(),
                                    disclaimer: "".into(),
                                }
                            } else {
                                AiResponse {
                                    provider, model,
                                    summary: format!("Beklenmeyen Yanıt Formatı: {}", &text[..text.len().min(200)]),
                                    tool_calls: Vec::new(),
                                    disclaimer: "".into(),
                                }
                            }
                        } else {
                            AiResponse {
                                provider, model,
                                summary: format!("API yanıtı ayrıştırılamadı: {}", &text[..text.len().min(200)]),
                                tool_calls: Vec::new(),
                                disclaimer: "".into(),
                            }
                        }
                    }
                    Err(e) => AiResponse {
                        provider, model,
                        summary: format!("Response read error: {}", e),
                        tool_calls: Vec::new(),
                        disclaimer: "Bu çıktı yatırım tavsiyesi değildir.".into(),
                    },
                }
            }
            Err(e) => AiResponse {
                provider, model,
                summary: format!("Connection error: {}", e),
                tool_calls: Vec::new(),
                disclaimer: "Bu çıktı yatırım tavsiyesi değildir.".into(),
            },
        };

        let mut tags = Vec::new();
        if let Ok(re) = regex::Regex::new(r"\b[A-Z]{4,5}\b") {
            for mat in re.find_iter(&request.prompt) {
                tags.push(mat.as_str().to_string());
            }
            // Optional: extract from response as well, but prompt is usually enough
        }
        tags.sort();
        tags.dedup();

        // Milisaniye bazlı kimlik aynı saniyedeki kayıtların çakışmasını önler;
        // zaman damgası kenar çubuğunda doğrudan gösterildiğinden okunur biçimdedir.
        let now = chrono::Local::now();
        let record = crate::domain::AiHistoryRecord {
            id: format!("ai-hist-{}", now.timestamp_millis()),
            timestamp: now.format("%d.%m.%Y %H:%M").to_string(),
            prompt: request.prompt.clone(),
            response: response.summary.clone(),
            tags,
        };
        store.ai_history.insert(0, record);
        if store.ai_history.len() > 100 {
            store.ai_history.truncate(100);
        }
        store.save_ai_history();

        response
    } else {
        AiResponse {
            provider: "none".into(),
            model: "not configured".into(),
            summary: "No enabled AI API key is configured. Add one in Settings > AI Providers.".into(),
            tool_calls: Vec::new(),
            disclaimer: "Bu çıktı yatırım tavsiyesi değildir.".into(),
        }
    }
}

pub async fn execute(store: &mut AppStore, client: &reqwest::Client, command: &str, active_context: Option<String>) -> Result<FqlResponse, String> {
    match fql::parse(command)? {
        FqlCommand::OpenTicker { ticker } => {
            let normalized = ticker.to_uppercase();
            // Try fetching fresh data if not in store
            if !store.equities.iter().any(|e| e.ticker == normalized) {
                match crate::yahoo::fetch_equity(client, &normalized, &normalized).await {
                    Ok(equity) => {
                        store.equities.push(equity);
                    }
                    Err(e) => {
                        return Err(format!("Failed to fetch ticker {}: {}", normalized, e));
                    }
                }
            }
            let snapshot = ticker_snapshot(store, &normalized)?;
            Ok(FqlResponse {
                command_type: "open".into(),
                message: format!("Opened {} - {} @ {:.2} ({:+.2}%)", snapshot.equity.ticker, snapshot.equity.name, snapshot.equity.price, snapshot.equity.change_pct),
                opened_tab: Some(snapshot.equity.ticker.clone()),
                rows: vec![snapshot.equity],
                kap: snapshot.kap,
                ai: None,
            })
        }
        FqlCommand::Scan { market, expression } => {
            let query = format!("{market} {expression}");
            let result = run_screener_query(store, &query);
            Ok(FqlResponse {
                command_type: "scan".into(),
                message: result.explanation,
                opened_tab: Some("Technical Screener".into()),
                rows: result.rows,
                kap: Vec::new(),
                ai: None,
            })
        }
        FqlCommand::Kap { ticker, period } => {
            let kap = filter_kap(store, KapFilter { ticker: ticker.clone(), category: None, limit: Some(10) });
            let period_label = period.unwrap_or_else(|| "latest".into());
            Ok(FqlResponse {
                command_type: "kap".into(),
                message: format!("Fetched {} KAP announcements for {} ({period_label}).", kap.len(), ticker.unwrap_or_else(|| "all tickers".into())),
                opened_tab: Some("KAP Feed".into()),
                rows: Vec::new(),
                kap,
                ai: None,
            })
        }
        FqlCommand::Ai { prompt } => {
            let ai = ask_ai(store, client, AiRequest { prompt, active_context, agent_id: None, history: None }).await;
            let preview: String = ai.summary.chars().take(80).collect();
            Ok(FqlResponse {
                command_type: "ai".into(),
                message: format!("AI Yanıtı Hazır: {}... (Detaylar için sağ üstten AI paneline göz atın)", preview),
                opened_tab: Some("AI Research".into()),
                rows: Vec::new(),
                kap: Vec::new(),
                ai: Some(ai),
            })
        }
        FqlCommand::Sync { source, mode } => {
            let result = sync_data(store, client, &source, &mode).await;
            Ok(FqlResponse {
                command_type: "sync".into(),
                message: result.message,
                opened_tab: Some("Dashboard".into()),
                rows: Vec::new(),
                kap: Vec::new(),
                ai: None,
            })
        }
        FqlCommand::Help => Ok(FqlResponse {
            command_type: "help".into(),
            message: "Commands: open ASELS, scan BIST100 where rsi < 35, kap ASELS last 30d, ai explain ASELS, sync all".into(),
            opened_tab: None,
            rows: Vec::new(),
            kap: Vec::new(),
            ai: None,
        }),
    }
}

pub async fn sync_data(store: &mut AppStore, client: &reqwest::Client, source: &str, mode: &str) -> SyncResult {
    let equities = crate::yahoo::fetch_all_equities(client, false).await;
    let eq_count = equities.len();

    if !equities.is_empty() {
        store.equities = equities;
    }

    if let Ok(news_items) = crate::news::fetch_news(client).await {
        store.news = news_items;
    }

    store.sources = vec![
        BistProvider.status(store.equities.len()),
        FundamentalsProvider.status(store.equities.iter().filter(|row| row.fundamentals_available).count()),
        IpoIndexProvider.status(store.equities.iter().filter(|row| row.index_memberships.iter().any(|index| index == "BIST HALKA ARZ")).count()),
        KapProvider.status(store.kap.len()),
        EvdsProvider.status(0),
        TuikProvider.status(0),
        NewsProvider.status(store.news.len()),
        CsvProvider.status(0),
    ];

    SyncResult {
        source: source.into(),
        mode: mode.into(),
        status: "completed".into(),
        message: format!("Synced {} equities from Yahoo Finance ({} mode).", eq_count, mode),
        updated_records: eq_count + store.kap.len(),
    }
}

fn apply_simple_filters(equities: &[EquityRow], query: &str) -> Vec<EquityRow> {
    let lower = query.to_lowercase();
    let mut rows = equities.to_vec();

    // Helper closure to filter by a generic field
    fn apply_filter(rows: &mut Vec<EquityRow>, lower: &str, keyword: &str, extract_field: fn(&EquityRow) -> Option<f64>) {
        if lower.contains(keyword) {
            if let Some(val) = number_after_keyword(lower, keyword, '<') {
                rows.retain(|row| extract_field(row).is_some_and(|v| v < val));
            }
            if let Some(val) = number_after_keyword(lower, keyword, '>') {
                rows.retain(|row| extract_field(row).is_some_and(|v| v > val));
            }
        }
    }

    // --- Technical Filters ---
    apply_filter(&mut rows, &lower, "rsi", |row| Some(row.rsi));
    apply_filter(&mut rows, &lower, "macd", |row| Some(row.macd));
    apply_filter(&mut rows, &lower, "sma50", |row| Some(row.sma_50));
    apply_filter(&mut rows, &lower, "ema20", |row| Some(row.ema_20));
    
    // Crosses
    if lower.contains("ema20 > sma50") || lower.contains("golden cross") {
        rows.retain(|row| row.ema_20 > row.sma_50);
    }
    if lower.contains("ema20 < sma50") || lower.contains("death cross") {
        rows.retain(|row| row.ema_20 < row.sma_50);
    }

    // --- Fundamental Filters ---
    apply_filter(&mut rows, &lower, "roe", |row| row.roe);
    apply_filter(&mut rows, &lower, "roa", |row| row.roa);
    
    // P/E variations
    if lower.contains("fk") || lower.contains("pe") || lower.contains("f/k") {
        let keyword = if lower.contains("fk") { "fk" } else if lower.contains("pe") { "pe" } else { "f/k" };
        apply_filter(&mut rows, &lower, keyword, |row| row.pe);
    }

    // P/B variations
    if lower.contains("pb") || lower.contains("p/b") {
        let keyword = if lower.contains("pb") { "pb" } else { "p/b" };
        apply_filter(&mut rows, &lower, keyword, |row| row.pb);
    }

    // Growth & Margins
    apply_filter(&mut rows, &lower, "sales_growth", |row| row.sales_growth);
    apply_filter(&mut rows, &lower, "profit_growth", |row| row.profit_growth);
    apply_filter(&mut rows, &lower, "net_margin", |row| row.net_margin);
    apply_filter(&mut rows, &lower, "gross_margin", |row| row.gross_margin);
    apply_filter(&mut rows, &lower, "dividend_yield", |row| row.dividend_yield);

    rows
}

fn number_after_keyword(input: &str, keyword: &str, marker: char) -> Option<f64> {
    if let Some(idx) = input.find(keyword) {
        let remainder = &input[idx + keyword.len()..];
        if let Some(marker_idx) = remainder.find(marker) {
            let after_marker = &remainder[marker_idx + 1..];
            return after_marker
                .split(|c: char| c.is_whitespace() || c == '&' || c == '|' || c == ',' || c == ';')
                .find(|s| !s.is_empty())
                .and_then(|v| v.parse::<f64>().ok());
        }
    }
    None
}

pub fn technical_summary(equity: &EquityRow) -> Vec<String> {
    vec![
        format!("RSI {:.1} ile {} bolgede.", equity.rsi, if equity.rsi < 30.0 { "asiri satim" } else if equity.rsi > 70.0 { "asiri alim" } else { "notr" }),
        format!("MACD {:.2}, EMA20 {:.2}, SMA50 {:.2}.", equity.macd, equity.ema_20, equity.sma_50),
        format!("Bollinger konumu: {}, ATR {:.2}.", equity.bollinger_position, equity.atr),
    ]
}

pub fn fundamental_summary(equity: &EquityRow) -> Vec<String> {
    if !equity.fundamentals_available {
        return vec!["Temel veriler doğrulanmış bir finansal tablo kaynağından alınamadı.".into()];
    }
    let value = |number: Option<f64>| number.map(|v| format!("{v:.1}")).unwrap_or_else(|| "—".into());
    vec![
        format!("F/K {}, PD/DD {}, ROE {}%.", value(equity.pe), value(equity.pb), value(equity.roe)),
        format!("Net borc/FAVOK {}, net marj {}%.", value(equity.net_debt_ebitda), value(equity.net_margin)),
        format!("Satis buyumesi {}%, kar buyumesi {}%.", value(equity.sales_growth), value(equity.profit_growth)),
    ]
}

fn default_url_for_provider(provider: &str) -> String {
    let lower = provider.to_lowercase();
    if lower.contains("deepseek") {
        "https://api.deepseek.com/v1/chat/completions".to_string()
    } else if lower.contains("qwen") {
        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions".to_string()
    } else if lower.contains("google") {
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions".to_string()
    } else {
        "https://api.openai.com/v1/chat/completions".to_string()
    }
}

pub async fn get_news_feed(
    client: &reqwest::Client,
    ticker: Option<&str>,
    company: Option<&str>,
) -> Result<Vec<crate::domain::NewsItem>, String> {
    let normalized_ticker = ticker.map(|value| value.trim().to_uppercase());
    let query = company_query(normalized_ticker.as_deref(), company);
    let google_query = format!("({query}) when:30d");
    let kap_query = format!("site:kap.org.tr/tr/Bildirim ({query}) when:30d");

    // These endpoints require no API key. Requests run concurrently so a slow or
    // temporarily unavailable provider cannot hold up the entire feed.
    let (gdelt, google, kap, bloomberg) = tokio::join!(
        fetch_gdelt(client, &query, normalized_ticker.as_deref(), "1month"),
        fetch_google_news(client, &google_query, normalized_ticker.as_deref(), false),
        fetch_google_news(client, &kap_query, normalized_ticker.as_deref(), true),
        fetch_rss(client, "Bloomberg HT", "https://www.bloomberght.com/rss", normalized_ticker.as_deref(), false),
    );

    let mut all_news = Vec::new();
    let mut errors = Vec::new();
    for result in [gdelt, google, kap, bloomberg] {
        match result {
            Ok(items) => all_news.extend(items),
            Err(error) => errors.push(error),
        }
    }

    let query_terms: Vec<String> = normalized_ticker
        .iter()
        .map(|value| value.to_lowercase())
        .chain(company.into_iter().map(|value| value.to_lowercase()))
        .collect();

    if normalized_ticker.is_some() {
        all_news.retain(|item| {
            item.is_kap
                || query_terms
                    .iter()
                    .any(|term| item.title.to_lowercase().contains(term))
        });
    }

    let mut seen = HashSet::new();
    all_news.retain(|item| {
        let key = item.title.to_lowercase();
        seen.insert(key)
    });
    all_news.sort_by(|a, b| news_timestamp(&b.pub_date).cmp(&news_timestamp(&a.pub_date)));
    all_news.truncate(50);

    if all_news.is_empty() && errors.len() == 4 {
        return Err(format!("Haber kaynaklarına ulaşılamadı: {}", errors.join(" | ")));
    }

    Ok(all_news)
}

/// Ortaklık yapısındaki bir tüzel/gerçek kişi hakkında haber araması yapar.
/// `kind == "person"` için pencere geniş tutulur (geçmiş araştırması),
/// şirketler için son dönem haberleri hedeflenir. GDELT ve Google News
/// anahtarsız kaynaklardır; sonuçlar başlığa göre tekilleştirilir.
pub async fn research_entity_news(
    client: &reqwest::Client,
    name: &str,
    kind: &str,
) -> Result<Vec<crate::domain::NewsItem>, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Araştırılacak isim boş olamaz.".into());
    }

    let quoted = format!("\"{trimmed}\"");
    let is_person = kind.eq_ignore_ascii_case("person");
    // Google News `when:` penceresi kişi geçmişi için kaldırılır; GDELT arşivi
    // kişilerde 1 yıla, şirketlerde 3 aya kadar taranır.
    let google_query = if is_person {
        quoted.clone()
    } else {
        format!("({quoted}) when:90d")
    };
    let gdelt_timespan = if is_person { "12months" } else { "3months" };

    let (gdelt, google) = tokio::join!(
        fetch_gdelt(client, &quoted, None, gdelt_timespan),
        fetch_google_news(client, &google_query, None, false),
    );

    let mut all_news = Vec::new();
    let mut errors = Vec::new();
    for result in [gdelt, google] {
        match result {
            Ok(items) => all_news.extend(items),
            Err(error) => errors.push(error),
        }
    }

    // İsim eşleşmeyen alakasız sonuçları ele: adın en az bir belirgin
    // kelimesi (3+ harf) başlıkta geçmeli.
    let name_words: Vec<String> = trimmed
        .split_whitespace()
        .map(|word| word.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase())
        .filter(|word| word.chars().count() >= 3)
        .collect();
    if !name_words.is_empty() {
        all_news.retain(|item| {
            let title = item.title.to_lowercase();
            name_words.iter().any(|word| title.contains(word.as_str()))
        });
    }

    let mut seen = HashSet::new();
    all_news.retain(|item| seen.insert(item.title.to_lowercase()));
    all_news.sort_by(|a, b| news_timestamp(&b.pub_date).cmp(&news_timestamp(&a.pub_date)));
    all_news.truncate(40);

    if all_news.is_empty() && errors.len() == 2 {
        return Err(format!("Haber kaynaklarına ulaşılamadı: {}", errors.join(" | ")));
    }

    Ok(all_news)
}

/// Bir hissenin gerçek KAP bildirimlerini Google News'in kap.org.tr'ye
/// daraltılmış aramasıyla getirir. KAP'ın kendi API'si Cloudflare arkasında
/// olduğundan bu, kimlik doğrulamasız erişilebilen en güvenilir yoldur.
pub async fn fetch_kap_disclosures(
    client: &reqwest::Client,
    ticker: &str,
    company: Option<&str>,
) -> Result<Vec<crate::domain::KapAnnouncement>, String> {
    let normalized = ticker.trim().to_uppercase();
    // kap.org.tr sayfa başlıkları jenerik olduğundan site kısıtı yerine
    // bildirimleri haberleştiren sonuçları da kapsayan "KAP" sorgusu kullanılır
    let query = format!("({}) KAP when:90d", company_query(Some(&normalized), company));
    let items = fetch_google_news(client, &query, Some(&normalized), true).await?;

    let announcements = items
        .into_iter()
        .filter(|item| !item.title.to_lowercase().contains("kap.org.tr"))
        .enumerate()
        .map(|(i, item)| crate::domain::KapAnnouncement {
            id: format!("KAP-{}-{}", normalized, i + 1),
            ticker: normalized.clone(),
            title: item.title,
            date: crate::kap::format_rss_date(&item.pub_date),
            category: "KAP Bildirimi".to_string(),
            summary: item.summary.unwrap_or_default(),
            url: item.link,
            ai_importance_score: 50,
        })
        .take(10)
        .collect();

    Ok(announcements)
}

#[cfg(test)]
mod news_reader_tests {
    #[tokio::test]
    #[ignore = "requires live Google News access"]
    async fn live_google_news_link_resolves_to_article_html() {
        let client = reqwest::Client::new();
        let items = super::fetch_google_news(&client, "(ASELS OR Aselsan) when:7d", Some("ASELS"), false)
            .await
            .unwrap();
        let item = items
            .iter()
            .find(|item| item.link.contains("news.google.com"))
            .expect("Google News linki bulunmalı");
        println!("çözümlenecek link: {}", item.link);
        let html = super::get_news_html(&client, &item.link).await.unwrap();
        assert!(html.contains("<base href=\""), "base etiketi eklenmeli");
        assert!(html.len() > 5_000, "makale HTML'i dolu olmalı, uzunluk: {}", html.len());
        assert!(
            !html.contains("news.google.com/_/DotsSplashUi"),
            "yanıt Google ara sayfası olmamalı"
        );
    }
}

#[cfg(test)]
mod agent_tests {
    #[tokio::test]
    #[ignore = "requires live network access"]
    async fn live_agent_context_gathers_kap_and_news() {
        let client = reqwest::Client::new();
        let (ctx, analyzed) = super::gather_agent_context(&client, &["ASELS".to_string()], &[]).await;
        println!("bağlam uzunluğu: {} karakter", ctx.len());
        assert_eq!(analyzed, vec!["ASELS".to_string()], "analiz edilen hisse listesi dönmeli");
        assert!(ctx.contains("===== ASELS ====="));
        assert!(ctx.contains("[KAP BİLDİRİMLERİ"), "KAP bölümü olmalı");
        assert!(ctx.contains("[HABERLER"), "haber bölümü olmalı");
        assert!(ctx.len() > 500, "bağlam dolu olmalı, uzunluk: {}", ctx.len());
    }
}

#[cfg(test)]
mod rss_tests {
    use super::strip_publisher_suffix;

    #[test]
    fn strips_matching_publisher_suffix() {
        assert_eq!(
            strip_publisher_suffix("ASELSAN yeni sözleşme imzaladı - Sözcü", Some("Sözcü")),
            "ASELSAN yeni sözleşme imzaladı"
        );
    }

    #[test]
    fn strip_is_case_insensitive_and_handles_dash_variants() {
        assert_eq!(
            strip_publisher_suffix("Koç Holding pay satışı – BloombergHT", Some("bloomberght")),
            "Koç Holding pay satışı"
        );
    }

    #[test]
    fn keeps_title_when_publisher_absent_or_mismatched() {
        assert_eq!(
            strip_publisher_suffix("THY - Airbus anlaşması", Some("Sözcü")),
            "THY - Airbus anlaşması",
            "yayıncı eşleşmiyorsa başlıktaki tire korunur"
        );
        assert_eq!(
            strip_publisher_suffix("Tek parçalı başlık", None),
            "Tek parçalı başlık"
        );
    }

    #[test]
    fn does_not_empty_title_when_whole_title_equals_publisher() {
        // Baş kısım boşsa kırpma yapılmaz (başlığı yok etmemek için).
        assert_eq!(strip_publisher_suffix("Sözcü", Some("Sözcü")), "Sözcü");
    }

    #[test]
    fn two_publishers_same_headline_produce_identical_titles() {
        // Aynı bildirimi iki yayıncı haberleştirince başlıklar eşitlenir → tekilleşir.
        let a = strip_publisher_suffix("Ereğli bedelsiz sermaye artırımı - Sözcü", Some("Sözcü"));
        let b = strip_publisher_suffix("Ereğli bedelsiz sermaye artırımı - Dünya", Some("Dünya"));
        assert_eq!(a, b);
    }
}

#[cfg(test)]
mod kap_tests {
    #[tokio::test]
    #[ignore = "requires live Google News access"]
    async fn live_kap_disclosures_return_results() {
        let client = reqwest::Client::new();
        let items = super::fetch_kap_disclosures(&client, "ASELS", Some("Aselsan"))
            .await
            .unwrap();
        assert!(!items.is_empty(), "ASELS için KAP bildirimi bulunmalı");
        assert!(items.iter().all(|i| !i.url.is_empty()), "bildirimler linkli olmalı");
        for i in items.iter().take(3) {
            println!("KAP: {} | {} | {}", i.date, i.title, i.url);
        }
    }
}

/// Ajan analizinde tek turda bağlam toplanacak en fazla hisse sayısı. Her
/// hisse iki ağ isteği (KAP + haber) gerektirir; aşıldığında kalan hisseler
/// analiz dışı bırakılır ve çağıran taraf bunu kullanıcıya/modele bildirir.
pub const AGENT_CONTEXT_MAX_TICKERS: usize = 20;

/// Bağlam toplarken aynı anda işlenecek hisse sayısı. Sıralı toplamada 20
/// hisse dakikalarca sürerdi; paralellik hızlandırır. Sınır, GDELT/Google
/// News'in hız limitlerine takılmamak için düşük tutulur (rate-limit
/// hataları zaten hisse bazında tolere edilir).
const AGENT_CONTEXT_CONCURRENCY: usize = 4;

/// Tek bir hisse için bağlam bölümünü (fiyat + KAP + haber) toplar.
async fn gather_ticker_section(
    client: &reqwest::Client,
    ticker: &str,
    equities: &[crate::domain::EquityRow],
) -> String {
    let company = equities.iter().find(|e| e.ticker == ticker).map(|e| e.name.clone());
    let mut section = format!("\n\n===== {} =====\n", ticker);

    if let Some(eq) = equities.iter().find(|e| e.ticker == ticker) {
        section.push_str(&format!(
            "Fiyat: {:.2} TL (günlük {:+.2}%) · RSI {:.0}\n",
            eq.price, eq.change_pct, eq.rsi
        ));
    }

    match fetch_kap_disclosures(client, ticker, company.as_deref()).await {
        Ok(kap) if !kap.is_empty() => {
            section.push_str("\n[KAP BİLDİRİMLERİ - son 90 gün]\n");
            for item in kap.iter().take(8) {
                section.push_str(&format!("- ({}) {}\n", item.date, item.title));
            }
        }
        _ => section.push_str("\n[KAP BİLDİRİMLERİ] Kayıt bulunamadı.\n"),
    }

    match get_news_feed(client, Some(ticker), company.as_deref()).await {
        Ok(news) if !news.is_empty() => {
            section.push_str("\n[HABERLER]\n");
            for item in news.iter().take(8) {
                let summary = item.summary.as_deref().unwrap_or("");
                let clipped: String = summary.chars().take(200).collect();
                section.push_str(&format!("- ({}) {} — {}\n", item.pub_date, item.title, clipped));
            }
        }
        _ => section.push_str("\n[HABERLER] Haber bulunamadı.\n"),
    }

    section
}

/// Ajan analizi için bağlı hisselerin KAP bildirimlerini, haberlerini ve
/// fiyat durumunu tek bir bağlam metninde toplar. AI'ya kullanıcı mesajı
/// olarak verilir; ağ hataları hisse bazında tolere edilir.
///
/// Dönüş: (bağlam metni, gerçekten bağlamı toplanan hisseler). İkinci değer
/// prompt ve çıktı etiketlerinin yalnızca veri bulunan hisseleri iddia etmesi
/// için kullanılır; böylece model veri görmediği hisse hakkında yorum üretmez.
/// Hisseler sınırlı eşzamanlılıkla paralel işlenir; çıktı sırası korunur.
pub async fn gather_agent_context(
    client: &reqwest::Client,
    tickers: &[String],
    equities: &[crate::domain::EquityRow],
) -> (String, Vec<String>) {
    use futures::stream::StreamExt;

    let analyzed: Vec<String> = tickers
        .iter()
        .take(AGENT_CONTEXT_MAX_TICKERS)
        .cloned()
        .collect();

    let sections: Vec<String> = futures::stream::iter(analyzed.iter().cloned())
        .map(|ticker| async move { gather_ticker_section(client, &ticker, equities).await })
        .buffered(AGENT_CONTEXT_CONCURRENCY)
        .collect()
        .await;

    (sections.concat(), analyzed)
}

/// OpenAI uyumlu tek seferlik sohbet tamamlama. Ajan analizlerinde kullanılır.
pub async fn run_completion(
    client: &reqwest::Client,
    key: &crate::domain::StoredAiKey,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String, String> {
    let raw_url = key.api_url.as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| default_url_for_provider(&key.provider));
    let api_url = if raw_url.ends_with("/chat/completions") {
        raw_url
    } else if raw_url.ends_with('/') {
        format!("{}chat/completions", raw_url)
    } else {
        format!("{}/chat/completions", raw_url)
    };

    let body = serde_json::json!({
        "model": key.default_model,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_prompt },
        ],
        "temperature": 0.4,
    });

    let resp = client
        .post(&api_url)
        .header("Authorization", format!("Bearer {}", key.secret))
        .header("Content-Type", "application/json")
        .json(&body)
        .timeout(std::time::Duration::from_secs(90))
        .send()
        .await
        .map_err(|e| format!("AI isteği başarısız: {e}"))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("AI sağlayıcı hatası (HTTP {status}): {}", text.chars().take(300).collect::<String>()));
    }

    let parsed: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    parsed
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .map(|s| s.trim().to_string())
        .ok_or_else(|| "AI yanıtı çözümlenemedi".to_string())
}

fn company_query(ticker: Option<&str>, company: Option<&str>) -> String {
    match (ticker, company) {
        (Some(symbol), Some(name)) if !name.trim().is_empty() => {
            format!("\"{}\" OR \"{}\"", symbol, name.trim())
        }
        (Some(symbol), _) => format!("\"{}\"", symbol),
        _ => "\"Borsa İstanbul\" OR BIST OR \"Türk şirketleri\"".into(),
    }
}

async fn fetch_gdelt(
    client: &reqwest::Client,
    query: &str,
    ticker: Option<&str>,
    timespan: &str,
) -> Result<Vec<crate::domain::NewsItem>, String> {
    #[derive(serde::Deserialize)]
    struct GdeltResponse {
        #[serde(default)]
        articles: Vec<GdeltArticle>,
    }

    #[derive(serde::Deserialize)]
    struct GdeltArticle {
        title: String,
        url: String,
        #[serde(default)]
        seendate: String,
        #[serde(default)]
        domain: String,
    }

    let mut url = reqwest::Url::parse("https://api.gdeltproject.org/api/v2/doc/doc")
        .map_err(|error| format!("GDELT URL: {error}"))?;
    url.query_pairs_mut()
        .append_pair("query", query)
        .append_pair("mode", "artlist")
        .append_pair("format", "json")
        .append_pair("sort", "datedesc")
        .append_pair("timespan", timespan)
        .append_pair("maxrecords", "35");

    let response = client
        .get(url)
        .timeout(std::time::Duration::from_secs(8))
        .header("User-Agent", "Fraude/0.1 financial-news-reader")
        .send()
        .await
        .map_err(|error| format!("GDELT: {error}"))?
        .error_for_status()
        .map_err(|error| format!("GDELT: {error}"))?;
    let payload = response
        .json::<GdeltResponse>()
        .await
        .map_err(|error| format!("GDELT JSON: {error}"))?;

    Ok(payload
        .articles
        .into_iter()
        .filter(|article| !article.title.trim().is_empty() && !article.url.trim().is_empty())
        .map(|article| crate::domain::NewsItem {
            title: decode_xml_entities(&article.title),
            link: article.url,
            pub_date: article.seendate,
            source: if article.domain.is_empty() {
                "GDELT".into()
            } else {
                format!("GDELT / {}", article.domain)
            },
            summary: None,
            ticker: ticker.map(str::to_string),
            is_kap: false,
            tags: Vec::new(),
            sector_tags: Vec::new(),
        })
        .collect())
}

async fn fetch_google_news(
    client: &reqwest::Client,
    query: &str,
    ticker: Option<&str>,
    is_kap: bool,
) -> Result<Vec<crate::domain::NewsItem>, String> {
    let mut url = reqwest::Url::parse("https://news.google.com/rss/search")
        .map_err(|error| format!("Google News URL: {error}"))?;
    url.query_pairs_mut()
        .append_pair("q", query)
        .append_pair("hl", "tr")
        .append_pair("gl", "TR")
        .append_pair("ceid", "TR:tr");
    fetch_rss(
        client,
        if is_kap { "KAP (Google News)" } else { "Google News" },
        url.as_str(),
        ticker,
        is_kap,
    )
    .await
}

async fn fetch_rss(
    client: &reqwest::Client,
    source: &str,
    url: &str,
    ticker: Option<&str>,
    is_kap: bool,
) -> Result<Vec<crate::domain::NewsItem>, String> {
    let response = client
        .get(url)
        .timeout(std::time::Duration::from_secs(8))
        .header("User-Agent", "Fraude/0.1 financial-news-reader")
        .send()
        .await
        .map_err(|error| format!("{source}: {error}"))?
        .error_for_status()
        .map_err(|error| format!("{source}: {error}"))?;
    let xml = response
        .text()
        .await
        .map_err(|error| format!("{source}: {error}"))?;
    Ok(parse_rss(&xml, source, ticker, is_kap))
}

fn parse_rss(xml: &str, source: &str, ticker: Option<&str>, is_kap: bool) -> Vec<crate::domain::NewsItem> {
    let mut items = Vec::new();
    let mut search_str = xml;
    
    while let Some(item_start) = search_str.find("<item>") {
        let item_end = search_str[item_start..].find("</item>").map(|idx| item_start + idx).unwrap_or(search_str.len());
        let item_content = &search_str[item_start..item_end];
        
        let title = extract_tag(item_content, "title").unwrap_or_default();
        let link = extract_tag(item_content, "link").unwrap_or_default();
        let pub_date = extract_tag(item_content, "pubDate").unwrap_or_default();
        let publisher = extract_tag_with_attributes(item_content, "source").map(|p| clean_cdata(&p));
        // Google News descriptions repeat the headline and publisher; they are
        // not article summaries. Keep them empty so the UI can request a real
        // page preview or show a clean headline-based fallback.
        let description = if source.starts_with("Google News") || is_kap {
            None
        } else {
            extract_tag(item_content, "description")
                .map(|value| clean_summary(&value, &title))
                .filter(|value| !value.is_empty())
        };
        
        if !title.is_empty() {
            // Google News başlıkları "Manşet - Yayıncı" biçimindedir; yayıncı
            // zaten ayrı alındığından bu son ek temizlenir, böylece aynı
            // bildirimi farklı yayıncıların haberleştirmesi tekilleştirmede
            // (başlık anahtarı) tek kayda iner.
            let clean_title = strip_publisher_suffix(&clean_cdata(&title), publisher.as_deref());
            items.push(crate::domain::NewsItem {
                title: clean_title,
                link: clean_cdata(&link),
                pub_date: clean_cdata(&pub_date),
                source: if is_kap {
                    source.to_string()
                } else if let Some(publisher) = publisher.filter(|value| !value.trim().is_empty()) {
                    format!("{source} / {}", publisher)
                } else {
                    source.to_string()
                },
                summary: description.map(|value| clean_cdata(&value)),
                ticker: ticker.map(str::to_string),
                is_kap,
                tags: Vec::new(),
                sector_tags: Vec::new(),
            });
        }
        
        search_str = &search_str[item_end..];
    }
    
    items
}

/// Google News RSS başlığındaki " - Yayıncı" son ekini, yayıncı `<source>`
/// etiketiyle eşleşiyorsa temizler. Karşılaştırma büyük/küçük harf duyarsız,
/// ayraç `-`, `–`, `—` varyantlarını kapsar. Bölme UTF-8 sınırında güvenlidir
/// (ayracı orijinal başlıkta `rfind` ile bulup ondan böleriz).
fn strip_publisher_suffix(title: &str, publisher: Option<&str>) -> String {
    let title = title.trim();
    let Some(pubs) = publisher.map(str::trim).filter(|value| !value.is_empty()) else {
        return title.to_string();
    };
    for sep in [" - ", " – ", " — "] {
        if let Some(pos) = title.rfind(sep) {
            let head = &title[..pos];
            let tail = &title[pos + sep.len()..];
            if tail.to_lowercase() == pubs.to_lowercase() && !head.trim().is_empty() {
                return head.trim().to_string();
            }
        }
    }
    title.to_string()
}

fn extract_tag_with_attributes(content: &str, tag: &str) -> Option<String> {
    let open_prefix = format!("<{}", tag);
    let start = content.find(&open_prefix)?;
    let content_start = content[start..].find('>')? + start + 1;
    let close_tag = format!("</{}>", tag);
    let end = content[content_start..].find(&close_tag)? + content_start;
    Some(content[content_start..end].to_string())
}

fn extract_tag(content: &str, tag: &str) -> Option<String> {
    let open_tag = format!("<{}>", tag);
    let close_tag = format!("</{}>", tag);
    
    let start = content.find(&open_tag)? + open_tag.len();
    let end = content[start..].find(&close_tag)? + start;
    Some(content[start..end].to_string())
}

fn clean_cdata(s: &str) -> String {
    decode_xml_entities(&s.replace("<![CDATA[", "").replace("]]>", ""))
        .trim()
        .to_string()
}

fn decode_xml_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&nbsp;", " ")
        .replace("&#160;", " ")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn strip_html(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut inside_tag = false;
    for character in value.chars() {
        match character {
            '<' => inside_tag = true,
            '>' => {
                inside_tag = false;
                output.push(' ');
            }
            _ if !inside_tag => output.push(character),
            _ => {}
        }
    }
    output.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn clean_summary(value: &str, title: &str) -> String {
    let cleaned = strip_html(&decode_xml_entities(
        &value.replace("<![CDATA[", "").replace("]]>", ""),
    ));
    let without_title = cleaned
        .strip_prefix(&clean_cdata(title))
        .unwrap_or(&cleaned)
        .trim_matches(|character: char| character.is_whitespace() || character == '-' || character == '·')
        .trim();

    if without_title.len() < 30 {
        String::new()
    } else {
        without_title.chars().take(420).collect()
    }
}

const NEWS_BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/// Haber bağlantısını doğrular ve Google News yönlendirme bağlantılarını gerçek
/// haber adresine çözümler. Google News RSS linkleri makalenin kendisine değil,
/// JavaScript ile yönlendiren bir ara sayfaya gittiğinden içerik çekilemez.
async fn resolve_news_target(client: &reqwest::Client, raw_url: &str) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(raw_url).map_err(|_| "Geçersiz haber bağlantısı.".to_string())?;
    if url.scheme() != "https" {
        return Err("Yalnızca güvenli HTTPS haber bağlantıları açılabilir.".into());
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if is_forbidden_news_host(&host) {
        return Err("Bu haber adresine güvenli biçimde erişilemiyor.".into());
    }

    if host == "news.google.com" {
        let resolved = resolve_google_news_url(client, &url).await?;
        url = reqwest::Url::parse(&resolved).map_err(|_| "Çözümlenen haber adresi geçersiz.".to_string())?;
        if url.scheme() == "http" {
            let _ = url.set_scheme("https");
        }
        let resolved_host = url.host_str().unwrap_or_default().to_ascii_lowercase();
        if url.scheme() != "https" || is_forbidden_news_host(&resolved_host) {
            return Err("Çözümlenen haber adresine güvenli biçimde erişilemiyor.".into());
        }
    }

    Ok(url)
}

async fn resolve_google_news_url(client: &reqwest::Client, url: &reqwest::Url) -> Result<String, String> {
    let segments: Vec<&str> = url.path_segments().map(|s| s.collect()).unwrap_or_default();
    let id = segments
        .iter()
        .position(|segment| *segment == "articles")
        .and_then(|index| segments.get(index + 1))
        .copied()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Google News bağlantısında makale kimliği bulunamadı.".to_string())?;

    if let Some(resolved) = decode_google_news_id(id) {
        return Ok(resolved);
    }
    resolve_google_news_via_api(client, id).await
}

/// Eski biçim makale kimlikleri (CBMi...) gerçek adresi base64 içinde taşır.
fn decode_google_news_id(id: &str) -> Option<String> {
    use base64::Engine;
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(id.trim_end_matches('='))
        .ok()?;
    let start = decoded.windows(4).position(|window| window == b"http")?;
    let bytes: Vec<u8> = decoded[start..]
        .iter()
        .copied()
        .take_while(|byte| byte.is_ascii_graphic() && !matches!(byte, b'"' | b'\\' | b'<' | b'>'))
        .collect();
    let candidate = String::from_utf8(bytes).ok()?;
    reqwest::Url::parse(&candidate).ok()?;
    Some(candidate)
}

/// Yeni biçim kimlikler (AU_yqL...) yalnızca Google'ın kendi iç uç noktasıyla
/// çözülebilir: ara sayfadan imza ve zaman damgası okunur, batchexecute'a
/// gönderilir ve yanıttaki gerçek adres ayıklanır.
async fn resolve_google_news_via_api(client: &reqwest::Client, id: &str) -> Result<String, String> {
    let page = client
        .get(format!("https://news.google.com/rss/articles/{id}"))
        .timeout(std::time::Duration::from_secs(8))
        .header("User-Agent", NEWS_BROWSER_UA)
        .header("Cookie", "CONSENT=YES+cb; SOCS=CAI")
        .send()
        .await
        .map_err(|error| format!("Google News ara sayfası alınamadı: {error}"))?
        .text()
        .await
        .map_err(|error| format!("Google News ara sayfası okunamadı: {error}"))?;

    let attribute = |name: &str| -> Option<String> {
        regex::Regex::new(&format!(r#"{name}="([^"]+)""#))
            .ok()?
            .captures(&page)
            .map(|captures| captures[1].to_string())
    };
    let (Some(timestamp), Some(signature)) = (attribute("data-n-a-ts"), attribute("data-n-a-sg")) else {
        return Err("Google News makale imzası bulunamadı; haber yalnızca kaynağında açılabilir.".into());
    };

    let request = format!(
        "[\"garturlreq\",[[\"X\",\"X\",[\"X\",\"X\"],null,null,1,1,\"US:en\",null,1,null,null,null,null,null,0,1],\"X\",\"X\",1,[1,1,1],1,1,null,0,0,null,0],\"{id}\",{timestamp},\"{signature}\"]"
    );
    let f_req = serde_json::to_string(&serde_json::json!([[["Fbv4je", request, null, "generic"]]]))
        .map_err(|error| format!("Google News isteği kurulamadı: {error}"))?;

    let body = client
        .post("https://news.google.com/_/DotsSplashUi/data/batchexecute")
        .timeout(std::time::Duration::from_secs(8))
        .header("User-Agent", NEWS_BROWSER_UA)
        .form(&[("f.req", f_req.as_str())])
        .send()
        .await
        .map_err(|error| format!("Google News çözümleme isteği başarısız: {error}"))?
        .text()
        .await
        .map_err(|error| format!("Google News çözümleme yanıtı okunamadı: {error}"))?;

    parse_batchexecute_url(&body)
        .ok_or_else(|| "Google News gerçek haber adresini vermedi.".to_string())
}

fn parse_batchexecute_url(body: &str) -> Option<String> {
    let start = body.find("[[")?;
    let outer = serde_json::Deserializer::from_str(&body[start..])
        .into_iter::<serde_json::Value>()
        .next()?
        .ok()?;
    let payload = outer.get(0)?.get(2)?.as_str()?;
    let inner: serde_json::Value = serde_json::from_str(payload).ok()?;
    let resolved = inner.get(1)?.as_str()?;
    resolved.starts_with("http").then(|| resolved.to_string())
}

pub async fn get_news_preview(client: &reqwest::Client, raw_url: &str) -> Result<String, String> {
    let url = resolve_news_target(client, raw_url).await?;

    let response = client
        .get(url)
        .timeout(std::time::Duration::from_secs(8))
        .header("User-Agent", "Fraude/0.1 article-preview")
        .send()
        .await
        .map_err(|error| format!("Haber özeti alınamadı: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Haber özeti alınamadı: {error}"))?;
    let html = response
        .text()
        .await
        .map_err(|error| format!("Haber sayfası okunamadı: {error}"))?;

    for key in ["og:description", "twitter:description", "description"] {
        if let Some(content) = extract_meta_content(&html, key) {
            let summary = strip_html(&decode_xml_entities(&content));
            if summary.len() >= 30 {
                return Ok(summary.chars().take(600).collect());
            }
        }
    }

    Err("Kaynak site kısa özet bilgisi sağlamadı.".into())
}

pub async fn get_news_html(client: &reqwest::Client, raw_url: &str) -> Result<String, String> {
    let url = resolve_news_target(client, raw_url).await?;

    let response = client
        .get(url)
        .timeout(std::time::Duration::from_secs(12))
        .header("User-Agent", NEWS_BROWSER_UA)
        .send()
        .await
        .map_err(|error| format!("Haber sayfası alınamadı: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Haber sayfası alınamadı: {error}"))?;

    let final_url = response.url().to_string();
    let html = response
        .text()
        .await
        .map_err(|error| format!("Haber içeriği okunamadı: {error}"))?;
    Ok(inject_base_href(html, &final_url))
}

/// Okuyucu görünümü sayfayı kendi origin'inde ayrıştırdığından, göreli görsel
/// ve bağlantı adreslerinin kaynağa göre çözülmesi için <base> etiketi eklenir.
fn inject_base_href(html: String, base_url: &str) -> String {
    let base_regex = regex::Regex::new(r"(?i)<base[\s>]").expect("geçerli regex");
    if base_regex.is_match(&html) {
        return html;
    }
    let tag = format!("<base href=\"{}\">", base_url.replace('"', "%22"));
    let head_regex = regex::Regex::new(r"(?i)<head[^>]*>").expect("geçerli regex");
    if let Some(insert_at) = head_regex.find(&html).map(|found| found.end()) {
        let mut output = html;
        output.insert_str(insert_at, &tag);
        return output;
    }
    format!("{tag}{html}")
}

fn is_forbidden_news_host(host: &str) -> bool {
    if host.is_empty() || host == "localhost" || host.ends_with(".localhost") {
        return true;
    }
    match host.parse::<std::net::IpAddr>() {
        Ok(std::net::IpAddr::V4(ip)) => {
            ip.is_private() || ip.is_loopback() || ip.is_link_local() || ip.is_unspecified()
        }
        Ok(std::net::IpAddr::V6(ip)) => {
            ip.is_loopback() || ip.is_unique_local() || ip.is_unicast_link_local() || ip.is_unspecified()
        }
        Err(_) => false,
    }
}

fn extract_meta_content(html: &str, key: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let mut cursor = 0;
    while let Some(relative_start) = lower[cursor..].find("<meta") {
        let start = cursor + relative_start;
        let end = lower[start..].find('>')? + start + 1;
        let tag = &html[start..end];
        let tag_lower = tag.to_lowercase();
        if tag_lower.contains(&format!("property=\"{key}\""))
            || tag_lower.contains(&format!("property='{key}'"))
            || tag_lower.contains(&format!("name=\"{key}\""))
            || tag_lower.contains(&format!("name='{key}'"))
        {
            if let Some(content) = extract_html_attribute(tag, "content") {
                return Some(content);
            }
        }
        cursor = end;
    }
    None
}

fn extract_html_attribute(tag: &str, attribute: &str) -> Option<String> {
    let lower = tag.to_lowercase();
    for quote in ['\"', '\''] {
        let needle = format!("{attribute}={quote}");
        if let Some(start) = lower.find(&needle) {
            let value_start = start + needle.len();
            let value_end = tag[value_start..].find(quote)? + value_start;
            return Some(tag[value_start..value_end].to_string());
        }
    }
    None
}

fn news_timestamp(value: &str) -> i64 {
    chrono::DateTime::parse_from_rfc2822(value)
        .map(|date| date.timestamp())
        .or_else(|_| chrono::DateTime::parse_from_rfc3339(value).map(|date| date.timestamp()))
        .or_else(|_| {
            chrono::NaiveDateTime::parse_from_str(value, "%Y%m%dT%H%M%SZ")
                .map(|date| date.and_utc().timestamp())
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod news_tests {
    use super::*;

    #[test]
    fn parses_google_news_rss_and_publisher() {
        let xml = r#"<rss><channel><item><title><![CDATA[ASELSAN &amp; yeni sözleşme - Örnek Haber]]></title><link>https://example.test/story</link><pubDate>Sat, 11 Jul 2026 14:51:54 GMT</pubDate><description>&lt;a&gt;ASELSAN &amp; yeni sözleşme&lt;/a&gt;&amp;nbsp;&amp;nbsp;Örnek Haber</description><source url="https://example.test">Örnek Haber</source></item></channel></rss>"#;
        let items = parse_rss(xml, "Google News", Some("ASELS"), false);

        assert_eq!(items.len(), 1);
        // Yayıncı eki (" - Örnek Haber") başlıktan temizlenir; yayıncı kaynak
        // alanında korunur. Böylece aynı bildirim farklı yayıncılarda tekilleşir.
        assert_eq!(items[0].title, "ASELSAN & yeni sözleşme");
        assert_eq!(items[0].source, "Google News / Örnek Haber");
        assert_eq!(items[0].summary, None);
        assert_eq!(items[0].ticker.as_deref(), Some("ASELS"));
        assert!(!items[0].is_kap);
    }

    #[test]
    fn marks_kap_search_results() {
        let xml = "<item><title>KAP bildirimi</title><link>https://kap.org.tr/tr/Bildirim/1</link><pubDate>Sat, 11 Jul 2026 14:51:54 GMT</pubDate></item>";
        let items = parse_rss(xml, "KAP (Google News)", Some("THYAO"), true);

        assert_eq!(items.len(), 1);
        assert!(items[0].is_kap);
        assert_eq!(items[0].source, "KAP (Google News)");
    }

    #[test]
    fn extracts_article_meta_description_in_any_attribute_order() {
        let html = r#"<html><head><meta content="Şirket yeni yatırım kararının ayrıntılarını kamuoyuyla paylaştı." property="og:description"></head></html>"#;
        assert_eq!(
            extract_meta_content(html, "og:description").as_deref(),
            Some("Şirket yeni yatırım kararının ayrıntılarını kamuoyuyla paylaştı.")
        );
        assert!(is_forbidden_news_host("192.168.1.12"));
        assert!(!is_forbidden_news_host("example.com"));
    }
}
