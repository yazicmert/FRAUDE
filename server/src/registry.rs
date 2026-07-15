//! FMUP registry uçları — masaüstü/web istemcisinin modül güncellemesi aldığı yüzey.
//!
//! Sözleşme (istemci: `src/modules/registryClient.ts`):
//!   GET /v1/trust/keys                     → { keys: [...] }
//!   GET /v1/channels/{channel}/latest      → { releases: [...] }   (imzalı)
//!   GET /v1/artifacts/{sha256}             → declarative artifact baytları
//!
//! Güvenlik modeli: sürümler ÇEVRİMDIŞI imzalanır (`scripts/registry-build.mjs`),
//! bu sunucu yalnız imzalı baytları OLDUĞU GİBİ sunar. Özel imza anahtarı burada
//! bulunmaz. İstemci imzayı pinlenmiş güven anahtarıyla doğrular
//! (`VITE_FRAUDE_TRUST_KEYS`, `src/modules/crypto.ts`).
//!
//! Katkı uçları (contribution intake) bu sürümde etkin değildir — bkz. `contributions_disabled`.

use axum::{
    extract::Path,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use sha2::{Digest, Sha256};
use std::path::{Path as FsPath, PathBuf};

/// Registry statik dosyalarının kök dizini (`FRAUDE_REGISTRY_DATA_DIR`).
fn data_dir() -> PathBuf {
    PathBuf::from(std::env::var("FRAUDE_REGISTRY_DATA_DIR").unwrap_or_else(|_| ".fraude-registry".into()))
}

/// Registry alt-router'ı. Herkese açık, imzalı içerik olduğu için ana uygulamada
/// esnek CORS ile katmanlanır (bkz. main.rs).
pub fn router() -> Router {
    Router::new()
        .route("/v1/trust/keys", get(trust_keys))
        .route("/v1/channels/{channel}/latest", get(channel_latest))
        .route("/v1/artifacts/{sha256}", get(artifact))
        .route("/v1/contributions", post(contributions_disabled))
        .route("/v1/contributions/{id}", get(contributions_disabled))
        .route("/v1/review/contributions", get(contributions_disabled))
        .route("/v1/review/contributions/{id}", post(contributions_disabled))
}

fn json_error(status: StatusCode, msg: &str) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, "application/json; charset=utf-8")],
        format!("{{\"error\":{}}}", serde_json::Value::String(msg.into())),
    )
        .into_response()
}

/// Bir statik JSON dosyasını olduğu gibi (yeniden serialize etmeden) sunar.
fn serve_json_file(path: &FsPath) -> Response {
    match std::fs::read(path) {
        Ok(bytes) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "application/json; charset=utf-8")],
            bytes,
        )
            .into_response(),
        Err(_) => json_error(StatusCode::NOT_FOUND, "not-found"),
    }
}

async fn trust_keys() -> Response {
    serve_json_file(&data_dir().join("trust").join("keys.json"))
}

/// Kanal adı güvenli slug olmalı (yol geçişini engeller).
fn safe_slug(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

async fn channel_latest(Path(channel): Path<String>) -> Response {
    if !safe_slug(&channel) {
        return json_error(StatusCode::BAD_REQUEST, "invalid-channel");
    }
    serve_json_file(&data_dir().join("channels").join(&channel).join("latest.json"))
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64 && value.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

async fn artifact(Path(sha256): Path<String>) -> Response {
    // Yalnız düşük harfli 64 hex → yol geçişi imkânsız.
    if !is_sha256_hex(&sha256) {
        return json_error(StatusCode::BAD_REQUEST, "invalid-artifact-hash");
    }
    let path = data_dir().join("artifacts").join(&sha256);
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(_) => return json_error(StatusCode::NOT_FOUND, "not-found"),
    };

    // Savunma katmanı: sunulan baytların hash'i yol ile eşleşmeli (bozulma/oynama yakalar).
    let digest = Sha256::digest(&bytes);
    let actual = hex_lower(&digest);
    if actual != sha256 {
        tracing::error!("artifact hash uyuşmazlığı: {sha256} beklendi, {actual} bulundu");
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "artifact-hash-mismatch");
    }

    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/octet-stream".to_string()),
            (header::CONTENT_LENGTH, bytes.len().to_string()),
        ],
        bytes,
    )
        .into_response()
}

fn hex_lower(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// Katkı (contribution) alımı bu sürümde etkin değil.
/// Etkinleştirmek için Ed25519 katkı-imzası doğrulaması (istemcinin kanonik
/// baytlarıyla parite) + kimlik doğrulamalı review akışı gerekir (bkz. README).
async fn contributions_disabled() -> Response {
    json_error(
        StatusCode::SERVICE_UNAVAILABLE,
        "contribution intake bu sunucuda henüz etkin değil",
    )
}
