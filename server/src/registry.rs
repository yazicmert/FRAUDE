//! FMUP registry uçları — masaüstü/web istemcisinin modül güncellemesi aldığı yüzey
//! ve admin'in imzalı sürüm YAYINLADIĞI uç.
//!
//! Okuma sözleşmesi (istemci: `src/modules/registryClient.ts`):
//!   GET  /v1/trust/keys                     → { keys: [...] }
//!   GET  /v1/channels/{channel}/latest      → { releases: [...] }   (imzalı)
//!   GET  /v1/artifacts/{sha256}             → declarative artifact baytları
//!
//! Yayın (admin):
//!   POST /v1/registry/releases              → imzalı release + artifact'i saklar
//!
//! Güvenlik modeli:
//! - Sürümler admin'in YEREL makinesinde imzalanır; özel imza anahtarı ne bu
//!   sunucuda ne de web istemcisinde bulunur.
//! - Yayın ucu `FRAUDE_REGISTRY_ADMIN_TOKEN` ile yetkilendirilir (spam/DoS koruması).
//! - SON KULLANICI güvencesi: her istemci imzayı pinlenmiş güven anahtarıyla
//!   doğrular (`VITE_FRAUDE_TRUST_KEYS`). Sunucu ele geçse bile, admin'in özel
//!   anahtarıyla imzalanmamış hiçbir sürüm istemci tarafından kabul edilmez.
//! - Sunucu, artifact hash'inin manifest ile tutarlılığını doğrular; imzanın
//!   kriptografik doğrulaması istemci tarafındadır (kanonik-bayt paritesi orada).

use axum::{
    extract::Path,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::Engine;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::{Path as FsPath, PathBuf};

/// Registry statik dosyalarının kök dizini (`FRAUDE_REGISTRY_DATA_DIR`).
fn data_dir() -> PathBuf {
    PathBuf::from(std::env::var("FRAUDE_REGISTRY_DATA_DIR").unwrap_or_else(|_| ".fraude-registry".into()))
}

/// Yayın için admin token'ı; tanımsızsa yayın devre dışıdır.
fn admin_token() -> Option<String> {
    std::env::var("FRAUDE_REGISTRY_ADMIN_TOKEN")
        .ok()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
}

pub fn router() -> Router {
    Router::new()
        .route("/v1/trust/keys", get(trust_keys))
        .route("/v1/channels/{channel}/latest", get(channel_latest))
        .route("/v1/artifacts/{sha256}", get(artifact))
        .route("/v1/registry/releases", post(publish_release))
        .route("/v1/contributions", post(contributions_disabled))
        .route("/v1/contributions/{id}", get(contributions_disabled))
        .route("/v1/review/contributions", get(contributions_disabled))
        .route("/v1/review/contributions/{id}", post(contributions_disabled))
}

fn json_error(status: StatusCode, msg: &str) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, "application/json; charset=utf-8")],
        format!("{{\"error\":{}}}", Value::String(msg.into())),
    )
        .into_response()
}

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

fn hex_lower(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

fn safe_slug(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64 && value.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

/// tmp'ye yaz + atomik rename (aynı dosya sistemi).
fn write_atomic(path: &FsPath, data: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_file_name(format!(
        "{}.tmp",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("out")
    ));
    std::fs::write(&tmp, data)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

// ── Okuma uçları ─────────────────────────────────────────────────────────────

async fn trust_keys() -> Response {
    serve_json_file(&data_dir().join("trust").join("keys.json"))
}

async fn channel_latest(Path(channel): Path<String>) -> Response {
    if !safe_slug(&channel) {
        return json_error(StatusCode::BAD_REQUEST, "invalid-channel");
    }
    serve_json_file(&data_dir().join("channels").join(&channel).join("latest.json"))
}

async fn artifact(Path(sha256): Path<String>) -> Response {
    if !is_sha256_hex(&sha256) {
        return json_error(StatusCode::BAD_REQUEST, "invalid-artifact-hash");
    }
    let path = data_dir().join("artifacts").join(&sha256);
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(_) => return json_error(StatusCode::NOT_FOUND, "not-found"),
    };
    let actual = hex_lower(&Sha256::digest(&bytes));
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

// ── Yayın ucu (admin) ────────────────────────────────────────────────────────

/// Beklenen gövde:
/// { "release": <imzalı ModuleRelease>, "artifactBase64": "<base64 artifact>" }
async fn publish_release(headers: HeaderMap, Json(body): Json<Value>) -> Response {
    // 1) Yetkilendirme.
    let Some(expected) = admin_token() else {
        return json_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "yayın devre dışı: FRAUDE_REGISTRY_ADMIN_TOKEN tanımlı değil",
        );
    };
    if crate::auth::extract_bearer(&headers).as_deref() != Some(expected.as_str()) {
        return json_error(StatusCode::UNAUTHORIZED, "admin yetkilendirmesi gerekli");
    }

    // 2) Gövde alanları.
    let release = &body["release"];
    if !release.is_object() {
        return json_error(StatusCode::BAD_REQUEST, "release nesnesi gerekli");
    }
    let manifest = &release["manifest"];
    let module_id = manifest["id"].as_str().unwrap_or_default();
    let version = manifest["version"].as_str().unwrap_or_default();
    let channel = manifest["channel"].as_str().unwrap_or_default();
    let declared_hash = manifest["artifact"]["sha256"].as_str().unwrap_or_default();
    let has_signature = release["provenance"]["signature"].as_str().is_some();

    if !module_id.starts_with("fraude.") || module_id.len() > 96 {
        return json_error(StatusCode::BAD_REQUEST, "geçersiz modül kimliği");
    }
    if version.is_empty() {
        return json_error(StatusCode::BAD_REQUEST, "sürüm gerekli");
    }
    if !safe_slug(channel) {
        return json_error(StatusCode::BAD_REQUEST, "geçersiz kanal");
    }
    if !is_sha256_hex(declared_hash) {
        return json_error(StatusCode::BAD_REQUEST, "geçersiz artifact hash");
    }
    if !has_signature {
        return json_error(StatusCode::BAD_REQUEST, "imza (provenance.signature) gerekli");
    }

    // 3) Artifact'i çöz + hash tutarlılığı.
    let Some(b64) = body["artifactBase64"].as_str() else {
        return json_error(StatusCode::BAD_REQUEST, "artifactBase64 gerekli");
    };
    let artifact_bytes = match base64::engine::general_purpose::STANDARD.decode(b64) {
        Ok(b) => b,
        Err(_) => return json_error(StatusCode::BAD_REQUEST, "artifactBase64 çözülemedi"),
    };
    let actual_hash = hex_lower(&Sha256::digest(&artifact_bytes));
    if actual_hash != declared_hash {
        return json_error(
            StatusCode::BAD_REQUEST,
            "artifact hash manifest ile eşleşmiyor",
        );
    }

    // 4) Artifact'i yaz.
    let dir = data_dir();
    if let Err(e) = write_atomic(&dir.join("artifacts").join(&actual_hash), &artifact_bytes) {
        tracing::error!("artifact yazılamadı: {e}");
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "artifact yazılamadı");
    }

    // 5) channels/{channel}/latest.json içine upsert (aynı modül kimliğini değiştir).
    let latest_path = dir.join("channels").join(channel).join("latest.json");
    let mut releases: Vec<Value> = std::fs::read(&latest_path)
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|v| v["releases"].as_array().cloned())
        .unwrap_or_default();
    releases.retain(|r| r["manifest"]["id"].as_str() != Some(module_id));
    releases.push(release.clone());

    let out = json!({ "releases": releases });
    let serialized = match serde_json::to_vec_pretty(&out) {
        Ok(v) => v,
        Err(e) => {
            tracing::error!("latest.json serileştirilemedi: {e}");
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, "latest.json yazılamadı");
        }
    };
    if let Err(e) = write_atomic(&latest_path, &serialized) {
        tracing::error!("latest.json yazılamadı: {e}");
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "latest.json yazılamadı");
    }

    tracing::info!("yayınlandı: {module_id}@{version} (kanal {channel}, artifact {})", &actual_hash[..12]);
    (
        StatusCode::OK,
        Json(json!({
            "published": { "id": module_id, "version": version, "channel": channel, "sha256": actual_hash }
        })),
    )
        .into_response()
}

/// Katkı alımı bu sürümde etkin değil (bkz. README).
async fn contributions_disabled() -> Response {
    json_error(
        StatusCode::SERVICE_UNAVAILABLE,
        "contribution intake bu sunucuda henüz etkin değil",
    )
}
