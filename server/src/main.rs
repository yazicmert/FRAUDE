//! FRAUDE web API sunucusu.
//!
//! Frontend (`src/api/platformClient.ts`) web modunda her komutu
//! `POST {VITE_FRAUDE_API_URL}/v1/rpc/{command}` olarak çağırır ve
//! `{ data | error }` zarfı bekler. Bu sunucu o sözleşmeyi sunar.
//!
//! Komut gövdeleri fraude-core'dan gelir (masaüstüyle birebir aynı);
//! kişi-başı komutlar Faz 2'de (Supabase JWT) bağlanacaktır.

mod auth;
mod registry;
mod rpc;

use axum::{
    http::{header, Method},
    routing::{get, post},
    Router,
};
use fraude_core::AppState;
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};
use tower_http::trace::TraceLayer;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string()))
        .init();

    // Masaüstündekiyle aynı durum: tohumlu depo + HTTP istemcisi + önbellekler.
    let state = Arc::new(AppState::new());

    // Piyasa verisi kendini besler: açılışta tam senkron, sonra 15 dk'da bir
    // artımlı, günde bir tam tur. (Masaüstünde bu, kullanıcının Eşitle düğmesi
    // ve açılış senkronudur; sunucuda otomatik olmak zorunda.)
    {
        let state = state.clone();
        tokio::spawn(async move {
            let mut turns: u64 = 0;
            loop {
                let mode = if turns % 96 == 0 { "full" } else { "incremental" };
                match fraude_core::api::sync_data(&state, "ALL".into(), mode.into()).await {
                    Ok(result) => tracing::info!("veri senkronu ({mode}): {}", result.message),
                    Err(error) => tracing::warn!("veri senkronu başarısız ({mode}): {error}"),
                }
                turns += 1;
                tokio::time::sleep(std::time::Duration::from_secs(15 * 60)).await;
            }
        });
    }

    // IPO takvimi + piyasa geneli kurumsal olaylar (masaüstü setup döngüsünün
    // sunucu karşılığı; KAP izleme motoru masaüstüne özgüdür, burada yok).
    {
        let state = state.clone();
        tokio::spawn(async move {
            loop {
                fraude_core::refresh_ipo_cache(&state).await;
                if fraude_core::corporate_actions::backfill_ipo_history(&state.http).await {
                    let records = fraude_core::corporate_actions::load_archive_records();
                    let mut cache = state.ipo_cache.lock().await;
                    cache.base_records = records;
                    cache.last_updated =
                        Some(chrono::Local::now().format("%d.%m.%Y %H:%M").to_string());
                }
                if fraude_core::corporate_actions::market_events_stale() {
                    fraude_core::corporate_actions::refresh_market_events(&state.http).await;
                }
                tokio::time::sleep(std::time::Duration::from_secs(
                    fraude_core::IPO_REFRESH_INTERVAL_SECS,
                ))
                .await;
            }
        });
    }

    // Veri API'si (rpc) — sıkı/dev CORS + kimlik bilgisi taşır.
    let api = Router::new()
        .route("/healthz", get(healthz))
        .route("/v1/rpc/{command}", post(rpc::dispatch))
        .layer(build_cors())
        .with_state(state);

    // Registry — herkese açık, imzalı içerik. Masaüstü (tauri://) ve web
    // istemcilerinin okuyabilmesi için esnek CORS; kimlik bilgisi taşımaz.
    let registry = registry::router().layer(CorsLayer::permissive());

    let app = Router::new()
        .merge(api)
        .merge(registry)
        .layer(TraceLayer::new_for_http());

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8787);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    tracing::info!("FRAUDE web API dinlemede: http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("port bind edilemedi");
    axum::serve(listener, app)
        .await
        .expect("sunucu başlatılamadı");
}

async fn healthz() -> &'static str {
    "ok"
}

/// CORS: üretimde yalnızca `ALLOWED_ORIGIN` (virgülle ayrılmış) origin'lerine
/// izin verilir ve kimlik bilgisi (cookie/oturum) taşınır. Tanımsızsa (yerel
/// geliştirme) tüm origin'lere kimlik bilgisiz izin verilir.
fn build_cors() -> CorsLayer {
    let base = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION]);

    match std::env::var("ALLOWED_ORIGIN") {
        Ok(origins) if !origins.trim().is_empty() => {
            let list: Vec<_> = origins
                .split(',')
                .filter_map(|o| o.trim().parse().ok())
                .collect();
            base.allow_origin(AllowOrigin::list(list))
                .allow_credentials(true)
        }
        _ => base.allow_origin(Any),
    }
}
