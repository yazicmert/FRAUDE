//! `/v1/rpc/{command}` sevk (dispatch) katmanı ve zarf sözleşmesi.
//!
//! Sözleşme (frontend `platformClient.ts` ile birebir):
//!   İstek : POST /v1/rpc/{command}   gövde = JSON args
//!   Yanıt : 2xx `{ "data": ... }`  |  hata `{ "error": "..." }`

use axum::{
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use serde_json::Value;

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

fn is_shared(cmd: &str) -> bool {
    SHARED_COMMANDS.contains(&cmd)
}
fn is_user(cmd: &str) -> bool {
    USER_COMMANDS.contains(&cmd)
}
fn is_admin(cmd: &str) -> bool {
    ADMIN_COMMANDS.contains(&cmd)
}

/// Komut sevki. Args gövdesi opsiyoneldir (argümansız komutlar `{}` gönderir).
pub async fn dispatch(Path(command): Path<String>, body: Option<Json<Value>>) -> Response {
    let _args = body.map(|Json(v)| v).unwrap_or_else(|| Value::Object(Default::default()));

    // Bilinmeyen komut → 404.
    if !is_shared(&command) && !is_user(&command) && !is_admin(&command) {
        return (
            StatusCode::NOT_FOUND,
            Json(RpcResponse::error(format!("bilinmeyen komut: {command}"))),
        )
            .into_response();
    }

    // Admin komutları halka açık uçtan çağrılamaz.
    if is_admin(&command) {
        return (
            StatusCode::FORBIDDEN,
            Json(RpcResponse::error(format!(
                "'{command}' yalnızca arka plan/admin komutudur; web ucundan çağrılamaz"
            ))),
        )
            .into_response();
    }

    // Kişi-başı komut → JWT doğrulaması (Faz 2'de auth::require_user bağlanır).
    if is_user(&command) {
        // TODO(faz-2): let user_id = auth::require_user(&headers)?;
        return (
            StatusCode::UNAUTHORIZED,
            Json(RpcResponse::error(format!(
                "'{command}' kişi-başı komuttur; kimlik doğrulama (Faz 2) henüz bağlı değil"
            ))),
        )
            .into_response();
    }

    // Paylaşımlı komut, tanınıyor ama henüz fraude-core'a bağlı değil.
    // TODO(core-extraction): fraude_core::<command>(args, &state) çağrısına bağla.
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(RpcResponse::error(format!(
            "'{command}' tanınıyor fakat henüz fraude-core'a bağlanmadı (bkz. README)"
        ))),
    )
        .into_response()
}
