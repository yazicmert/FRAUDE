//! FRAUDE web API sunucusu.
//!
//! Frontend (`src/api/platformClient.ts`) web modunda her komutu
//! `POST {VITE_FRAUDE_API_URL}/v1/rpc/{command}` olarak çağırır ve
//! `{ data | error }` zarfı bekler. Bu sunucu o sözleşmeyi sunar.
//!
//! Bu ilk sürüm (Faz 0) deploy edilebilir bir iskelettir: sağlık ucu, CORS,
//! zarf sözleşmesi ve tam komut kayıt defteri hazırdır. Komut gövdeleri
//! `fraude-core` çıkarıldığında bağlanır (bkz. README).

mod auth;
mod rpc;

use axum::{
    http::{header, Method},
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};
use tower_http::trace::TraceLayer;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string()))
        .init();

    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/v1/rpc/{command}", post(rpc::dispatch))
        .layer(TraceLayer::new_for_http())
        .layer(build_cors());

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
