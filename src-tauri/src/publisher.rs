//! Masaüstü admin yayın komutu — "Yayınla" butonunun Rust tarafı.
//!
//! Güvenlik modeli:
//! - Kanonikleştirme (imza-öncesi bayt üretimi) JS'te yapılır (`src/modules/crypto.ts`
//!   `releaseSigningPayload`), yani doğrulayan istemciyle BİREBİR aynı kod.
//! - Bu komut yalnız verilen kanonik baytları YEREL Ed25519 anahtarıyla imzalar
//!   (kanonikleştirme YAPMAZ → parite riski yok) ve imzalı sürümü admin token'ıyla
//!   registry'ye POST eder.
//! - Özel imza anahtarı ve admin token'ı yalnız bu makinede (Rust tarafında) durur;
//!   webview'e hiç girmez.

use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;

const URL_SAFE: base64::engine::general_purpose::GeneralPurpose =
    base64::engine::general_purpose::URL_SAFE_NO_PAD;

fn fraude_config_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("fraude"))
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublishConfig {
    key_file: Option<String>,
    publish_url: Option<String>,
    public_base_url: Option<String>,
    admin_token: Option<String>,
    key_id: Option<String>,
}

/// Config dosyası (`{config}/fraude/registry-publish.json`) + ortam değişkeni override.
fn load_config() -> PublishConfig {
    let mut cfg = fraude_config_dir()
        .map(|d| d.join("registry-publish.json"))
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice::<PublishConfig>(&b).ok())
        .unwrap_or_default();
    if let Ok(v) = std::env::var("FRAUDE_REGISTRY_KEY_FILE") { cfg.key_file = Some(v); }
    if let Ok(v) = std::env::var("FRAUDE_REGISTRY_PUBLISH_URL") { cfg.publish_url = Some(v); }
    if let Ok(v) = std::env::var("FRAUDE_REGISTRY_PUBLIC_URL") { cfg.public_base_url = Some(v); }
    if let Ok(v) = std::env::var("FRAUDE_REGISTRY_ADMIN_TOKEN") { cfg.admin_token = Some(v); }
    if let Ok(v) = std::env::var("FRAUDE_REGISTRY_KEY_ID") { cfg.key_id = Some(v); }
    cfg
}

fn key_file_path(cfg: &PublishConfig) -> Option<PathBuf> {
    if let Some(f) = &cfg.key_file {
        return Some(PathBuf::from(f));
    }
    fraude_config_dir().map(|d| d.join("registry-signing-key.json"))
}

fn key_id_of(cfg: &PublishConfig) -> String {
    cfg.key_id.clone().unwrap_or_else(|| "fraude-registry-1".to_string())
}

/// İmza anahtarını (Node JWK: privateJwk.d = 32-bayt base64url seed) yükler.
fn load_signing_key(cfg: &PublishConfig) -> Result<SigningKey, String> {
    let path = key_file_path(cfg).ok_or("config dizini çözülemedi")?;
    let bytes = std::fs::read(&path)
        .map_err(|_| format!("imza anahtarı bulunamadı: {}", path.display()))?;
    let stored: Value = serde_json::from_slice(&bytes)
        .map_err(|e| format!("anahtar dosyası okunamadı: {e}"))?;
    let d = stored["privateJwk"]["d"]
        .as_str()
        .ok_or("anahtar dosyasında privateJwk.d yok")?;
    let seed = URL_SAFE.decode(d).map_err(|_| "privateJwk.d base64url çözülemedi")?;
    let seed: [u8; 32] = seed
        .as_slice()
        .try_into()
        .map_err(|_| "Ed25519 seed 32 bayt olmalı")?;
    Ok(SigningKey::from_bytes(&seed))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishConfigStatus {
    configured: bool,
    key_present: bool,
    publish_url: Option<String>,
    public_base_url: Option<String>,
    key_id: String,
    reason: Option<String>,
}

/// UI'nin "Yayınla" panelini gösterip göstermeyeceğine karar vermesi için durum.
#[tauri::command]
pub fn publish_config_status() -> PublishConfigStatus {
    let cfg = load_config();
    let key_present = key_file_path(&cfg).map(|p| p.exists()).unwrap_or(false);
    let reason = if !key_present {
        Some("imza anahtarı yok (registry-signing-key.json)".to_string())
    } else if cfg.publish_url.is_none() {
        Some("publishUrl ayarsız".to_string())
    } else if cfg.admin_token.is_none() {
        Some("adminToken ayarsız".to_string())
    } else {
        None
    };
    PublishConfigStatus {
        configured: reason.is_none(),
        key_present,
        publish_url: cfg.publish_url.clone(),
        public_base_url: cfg.public_base_url.clone(),
        key_id: key_id_of(&cfg),
        reason,
    }
}

/// Kanonik payload'ı yerel anahtarla imzala, provenance ekle ve registry'ye POST et.
/// `canonical_payload` istemci ile birebir `stableValue` çıktısıdır (JS'te üretildi).
#[tauri::command]
pub async fn publish_module_release(
    state: tauri::State<'_, crate::AppState>,
    unsigned_release: Value,
    artifact_base64: String,
    canonical_payload: String,
) -> Result<Value, String> {
    let cfg = load_config();
    let publish_url = cfg.publish_url.clone().ok_or("publishUrl ayarsız")?;
    let admin_token = cfg.admin_token.clone().ok_or("adminToken ayarsız")?;
    let signing_key = load_signing_key(&cfg)?;
    let key_id = key_id_of(&cfg);

    // Ed25519, kanonik payload baytları üzerinden. Deterministik (RFC 8032):
    // aynı anahtar+mesaj → istemcinin pinli açık anahtarıyla doğrulanan aynı imza.
    let signature = URL_SAFE.encode(signing_key.sign(canonical_payload.as_bytes()).to_bytes());

    let mut signed = unsigned_release;
    signed["provenance"] = json!({ "algorithm": "Ed25519", "keyId": key_id, "signature": signature });

    let url = format!("{}/v1/registry/releases", publish_url.trim_end_matches('/'));
    let response = state
        .http
        .post(&url)
        .bearer_auth(&admin_token)
        .json(&json!({ "release": signed, "artifactBase64": artifact_base64 }))
        .send()
        .await
        .map_err(|e| format!("yayın isteği başarısız: {e}"))?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("yayın reddedildi ({}): {body}", status.as_u16()));
    }
    serde_json::from_str::<Value>(&body).map_err(|e| format!("yanıt çözülemedi: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Rust (ed25519-dalek) imzasının Node/WebCrypto Ed25519 ile BİREBİR aynı
    // olduğunu kanıtlar: aşağıdaki (d, mesaj) için Node'un ürettiği imza SIG.
    // Böylece istemci (crypto.ts, WebCrypto) bu komutun imzasını doğrular.
    #[test]
    fn ed25519_signature_matches_node() {
        const D: &str = "nE_kEQCkLKSif1e6xg4O1EnfpvSdCbso66I0IefCR4U";
        const MSG_B64: &str = "a2Fub25pay10ZXN0LcO8w6ctxLHFn8Sxay17ImEiOjF9";
        const SIG: &str = "tJb3j_ZAc2Y-JDiFnelP78KhrcO4PR1KgU3eG3dgsR9JxYCoCOn-GgoX2IUQYpz7eywxrLAqkagiJOEFzZ26DA";

        let seed: [u8; 32] = URL_SAFE.decode(D).unwrap().as_slice().try_into().unwrap();
        let sk = SigningKey::from_bytes(&seed);
        let msg = URL_SAFE.decode(MSG_B64).unwrap();
        let sig = URL_SAFE.encode(sk.sign(&msg).to_bytes());
        assert_eq!(sig, SIG, "ed25519-dalek imzası Node ile eşleşmeli");
    }
}
