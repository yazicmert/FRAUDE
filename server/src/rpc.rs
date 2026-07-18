//! `/v1/rpc/{command}` sevk (dispatch) katmanı ve zarf sözleşmesi.
//!
//! Sözleşme (frontend `platformClient.ts` ile birebir):
//!   İstek : POST /v1/rpc/{command}   gövde = JSON args (Tauri invoke ile aynı,
//!           çok kelimeli anahtarlar camelCase — Tauri'nin JS köprüsü gibi)
//!   Yanıt : 2xx `{ "data": ... }`  |  hata `{ "error": "..." }`
//!
//! Paylaşımlı komut gövdeleri fraude-core/src/api.rs'ten gelir; masaüstüyle
//! birebir aynı fonksiyonlardır. Kişi-başı komutlar Faz 2'de (Supabase JWT)
//! bağlanana kadar 401 döner.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use fraude_core::{api, AppState};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;

#[derive(Serialize)]
pub struct RpcResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl RpcResponse {
    fn error(msg: impl Into<String>) -> Self {
        RpcResponse { data: None, error: Some(msg.into()) }
    }
}

/// Paylaşımlı piyasa verisi — auth opsiyonel, sunucuda cache'lenir.
/// (Masaüstü `invoke_handler` yüzeyinden türetildi.)
pub const SHARED_COMMANDS: &[&str] = &[
    "execute_fql",
    "get_dashboard_snapshot",
    "get_ticker_snapshot",
    "run_screener",
    "list_kap_announcements",
    "get_price_history",
    "get_news_feed",
    "get_news_preview",
    "get_news_html",
    "get_bist_indices",
    "get_financial_statements",
    "get_dividends",
    "get_capital_increases",
    "get_ipo_calendar",
    "get_kap_for_ticker",
    "get_shareholders",
    "get_subsidiaries",
    "research_entity_news",
    "get_corporate_events",
    "get_market_holidays",
    "get_economic_calendar",
    "get_live_quotes",
    "get_funds",
    "get_fund_allocation",
    "get_fund_history",
    "get_fund_issuer",
    "get_fund_disclosures",
    "get_fund_holdings",
    "get_fund_returns",
];

/// Kişi-başı veri — auth ZORUNLU, Postgres'te `user_id` ile izole edilir.
pub const USER_COMMANDS: &[&str] = &[
    "ask_ai",
    "list_ai_keys",
    "save_ai_key",
    "delete_ai_key",
    "set_default_ai_key",
    "test_ai_key",
    "list_ai_history",
    "delete_ai_history",
    "clear_ai_history",
    "list_ai_agents",
    "save_ai_agent",
    "delete_ai_agent",
    "list_artifacts",
    "save_artifact",
    "delete_artifact",
    "run_agent_analysis",
    "get_monitor_state",
    "sync_monitor_tickers",
    "set_monitor_config",
    "run_monitor_now",
    "mark_monitor_alerts_read",
    "clear_monitor_alerts",
];

/// Yalnızca arka plan / admin — halka açık uçtan tetiklenmez. Yayıncı ve
/// modül güncelleme komutları masaüstüne özgüdür (yerel dosya sistemi).
pub const ADMIN_COMMANDS: &[&str] = &[
    "sync_data",
    "update_bist_indices",
    "publish_config_status",
    "publish_module_release",
    "activate_module_release",
    "rollback_module_release",
];

fn is_user(cmd: &str) -> bool {
    USER_COMMANDS.contains(&cmd)
}
fn is_admin(cmd: &str) -> bool {
    ADMIN_COMMANDS.contains(&cmd)
}

fn ok_response<T: Serialize>(data: T) -> Response {
    match serde_json::to_value(data) {
        Ok(value) => {
            (StatusCode::OK, Json(RpcResponse { data: Some(value), error: None })).into_response()
        }
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(RpcResponse::error(format!("serileştirme hatası: {error}"))),
        )
            .into_response(),
    }
}

fn err_response(status: StatusCode, msg: String) -> Response {
    (status, Json(RpcResponse::error(msg))).into_response()
}

// ── Komut argümanları (Tauri JS köprüsüyle aynı camelCase anahtarlar) ──────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FqlArgs {
    command: String,
    #[serde(default)]
    active_context: Option<String>,
}

#[derive(Deserialize)]
struct TickerArgs {
    ticker: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RefreshTickerArgs {
    ticker: String,
    #[serde(default)]
    force_refresh: Option<bool>,
}

#[derive(Deserialize)]
struct ScreenerArgs {
    request: fraude_core::domain::ScreenerRequest,
}

#[derive(Deserialize)]
struct KapFilterArgs {
    filter: fraude_core::domain::KapFilter,
}

#[derive(Deserialize)]
struct PriceHistoryArgs {
    ticker: String,
    #[serde(default)]
    range: Option<String>,
    #[serde(default)]
    source: Option<String>,
}

#[derive(Deserialize)]
struct CodeArgs {
    code: String,
}

#[derive(Deserialize)]
struct FundHistoryArgs {
    code: String,
    months: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FundNameArgs {
    fund_name: String,
}

#[derive(Deserialize)]
struct TickersArgs {
    tickers: Vec<String>,
}

#[derive(Deserialize)]
struct OptionalTickerArgs {
    #[serde(default)]
    ticker: Option<String>,
}

#[derive(Deserialize)]
struct UrlArgs {
    url: String,
}

#[derive(Deserialize)]
struct EntityArgs {
    name: String,
    kind: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IpoCalendarArgs {
    #[serde(default)]
    force_refresh: Option<bool>,
}

/// Argümanları çözüp komutu çalıştıran kısayol: hatalı gövde → 400,
/// komut hatası → 500, başarı → `{ data }`.
macro_rules! run {
    ($args:expr, $ty:ty, |$p:ident| $fut:expr) => {{
        match serde_json::from_value::<$ty>($args) {
            Ok($p) => match $fut.await {
                Ok(data) => ok_response(data),
                Err(error) => err_response(StatusCode::INTERNAL_SERVER_ERROR, error),
            },
            Err(error) => err_response(
                StatusCode::BAD_REQUEST,
                format!("geçersiz argümanlar: {error}"),
            ),
        }
    }};
}

/// Komut sevki. Args gövdesi opsiyoneldir (argümansız komutlar `{}` gönderir).
pub async fn dispatch(
    State(state): State<Arc<AppState>>,
    Path(command): Path<String>,
    body: Option<Json<Value>>,
) -> Response {
    let args = body.map(|Json(v)| v).unwrap_or_else(|| Value::Object(Default::default()));

    // Admin komutları halka açık uçtan çağrılamaz.
    if is_admin(&command) {
        return err_response(
            StatusCode::FORBIDDEN,
            format!("'{command}' yalnızca arka plan/admin komutudur; web ucundan çağrılamaz"),
        );
    }

    // Kişi-başı komut → JWT doğrulaması (Faz 2'de auth::require_user bağlanır).
    if is_user(&command) {
        return err_response(
            StatusCode::UNAUTHORIZED,
            format!("'{command}' kişi-başı komuttur; kimlik doğrulama (Faz 2) henüz bağlı değil"),
        );
    }

    let s = &*state;
    match command.as_str() {
        "execute_fql" => run!(args, FqlArgs, |p| api::execute_fql(s, p.command, p.active_context)),
        "get_dashboard_snapshot" => match api::get_dashboard_snapshot(s).await {
            Ok(data) => ok_response(data),
            Err(error) => err_response(StatusCode::INTERNAL_SERVER_ERROR, error),
        },
        "get_ticker_snapshot" => run!(args, TickerArgs, |p| api::get_ticker_snapshot(s, p.ticker)),
        "run_screener" => run!(args, ScreenerArgs, |p| api::run_screener(s, p.request)),
        "list_kap_announcements" => {
            run!(args, KapFilterArgs, |p| api::list_kap_announcements(s, p.filter))
        }
        "get_price_history" => run!(args, PriceHistoryArgs, |p| api::get_price_history(
            s, p.ticker, p.range, p.source
        )),
        "get_news_feed" => run!(args, OptionalTickerArgs, |p| api::get_news_feed(s, p.ticker)),
        "get_news_preview" => run!(args, UrlArgs, |p| api::get_news_preview(s, p.url)),
        "get_news_html" => run!(args, UrlArgs, |p| api::get_news_html(s, p.url)),
        "get_bist_indices" => match api::get_bist_indices(s).await {
            Ok(data) => ok_response(data),
            Err(error) => err_response(StatusCode::INTERNAL_SERVER_ERROR, error),
        },
        "get_financial_statements" => {
            run!(args, TickerArgs, |p| api::get_financial_statements(s, p.ticker))
        }
        "get_dividends" => run!(args, TickerArgs, |p| api::get_dividends(s, p.ticker)),
        "get_capital_increases" => {
            run!(args, TickerArgs, |p| api::get_capital_increases(s, p.ticker))
        }
        "get_ipo_calendar" => {
            run!(args, IpoCalendarArgs, |p| api::get_ipo_calendar(s, p.force_refresh))
        }
        "get_kap_for_ticker" => run!(args, TickerArgs, |p| api::get_kap_for_ticker(s, p.ticker)),
        "get_shareholders" => run!(args, RefreshTickerArgs, |p| api::get_shareholders(
            s,
            p.ticker,
            p.force_refresh
        )),
        "get_subsidiaries" => run!(args, RefreshTickerArgs, |p| api::get_subsidiaries(
            s,
            p.ticker,
            p.force_refresh
        )),
        "research_entity_news" => {
            run!(args, EntityArgs, |p| api::research_entity_news(s, p.name, p.kind))
        }
        "get_corporate_events" => match api::get_corporate_events().await {
            Ok(data) => ok_response(data),
            Err(error) => err_response(StatusCode::INTERNAL_SERVER_ERROR, error),
        },
        "get_market_holidays" => match api::get_market_holidays(s).await {
            Ok(data) => ok_response(data),
            Err(error) => err_response(StatusCode::INTERNAL_SERVER_ERROR, error),
        },
        "get_economic_calendar" => match api::get_economic_calendar(s).await {
            Ok(data) => ok_response(data),
            Err(error) => err_response(StatusCode::INTERNAL_SERVER_ERROR, error),
        },
        "get_live_quotes" => run!(args, TickersArgs, |p| api::get_live_quotes(s, p.tickers)),
        "get_funds" => match api::get_funds(s).await {
            Ok(data) => ok_response(data),
            Err(error) => err_response(StatusCode::INTERNAL_SERVER_ERROR, error),
        },
        "get_fund_returns" => match api::get_fund_returns(s).await {
            Ok(data) => ok_response(data),
            Err(error) => err_response(StatusCode::INTERNAL_SERVER_ERROR, error),
        },
        "get_fund_allocation" => run!(args, CodeArgs, |p| api::get_fund_allocation(s, p.code)),
        "get_fund_history" => {
            run!(args, FundHistoryArgs, |p| api::get_fund_history(s, p.code, p.months))
        }
        "get_fund_issuer" => run!(args, FundNameArgs, |p| api::get_fund_issuer(s, p.fund_name)),
        "get_fund_disclosures" => run!(args, CodeArgs, |p| api::get_fund_disclosures(s, p.code)),
        "get_fund_holdings" => run!(args, CodeArgs, |p| api::get_fund_holdings(s, p.code)),
        _ => err_response(StatusCode::NOT_FOUND, format!("bilinmeyen komut: {command}")),
    }
}
