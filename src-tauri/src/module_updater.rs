use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};

use crate::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivateModuleRequest {
    module_id: String,
    version: String,
    artifact_url: String,
    artifact_hash: String,
    manifest_json: String,
    previous_module_json: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivationResult {
    module_id: String,
    version: String,
    artifact_hash: String,
    snapshot_id: String,
    runtime: &'static str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackModuleRequest {
    module_id: String,
    snapshot_id: String,
}

#[derive(Debug, Serialize)]
pub struct RollbackResult {
    module: serde_json::Value,
}

fn validate_module_id(module_id: &str) -> Result<(), String> {
    if !module_id.starts_with("fraude.")
        || module_id.len() > 96
        || !module_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_'))
    {
        return Err("Invalid module identifier.".into());
    }
    Ok(())
}

fn validate_snapshot_id(snapshot_id: &str) -> Result<(), String> {
    if snapshot_id.is_empty()
        || snapshot_id.len() > 160
        || !snapshot_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_' | ':'))
    {
        return Err("Invalid snapshot identifier.".into());
    }
    Ok(())
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn safe_bundle_path(path: &str) -> bool {
    let prefix_allowed =
        path.starts_with("views/") || path.starts_with("data/") || path.starts_with("locales/");
    prefix_allowed
        && !path.contains("..")
        && !path.contains('\\')
        && !path.starts_with('/')
        && path.len() <= 190
        && path
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '/' | '.' | '-' | '_'))
}

fn validate_declarative_bundle(
    bytes: &[u8],
    module_id: &str,
    version: &str,
    manifest: &serde_json::Value,
) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() > 2 * 1024 * 1024 {
        return Err("Module bundle size is invalid.".into());
    }
    let bundle: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|_| "Module artifact is not valid JSON.".to_string())?;
    if bundle.get("schemaVersion").and_then(|value| value.as_u64()) != Some(1)
        || bundle.get("moduleId").and_then(|value| value.as_str()) != Some(module_id)
        || bundle.get("version").and_then(|value| value.as_str()) != Some(version)
        || bundle
            .pointer("/runtime/kind")
            .and_then(|value| value.as_str())
            != Some("declarative-v1")
    {
        return Err("Bundle identity or runtime is invalid.".into());
    }
    let permissions = manifest
        .get("permissions")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "Signed manifest permissions are invalid.".to_string())?;
    let requests = bundle
        .get("requests")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "Bundle capability request list is invalid.".to_string())?;
    if requests.len() > 10 {
        return Err("Bundle contains too many capability requests.".into());
    }
    let mut request_ids = std::collections::HashSet::new();
    for request in requests {
        let id = request
            .get("id")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "Capability request id is missing.".to_string())?;
        let capability = request
            .get("capability")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "Capability is missing.".to_string())?;
        let operation = request
            .get("operation")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "Capability operation is missing.".to_string())?;
        let required = match operation {
            "news.latest" => "api:news",
            "market.snapshot" => "api:market-data",
            "workspace.read-preferences" => "storage:workspace",
            _ => return Err("Unsupported capability operation.".into()),
        };
        let declared = permissions
            .iter()
            .any(|value| value.as_str() == Some(required));
        if id.is_empty()
            || id.len() > 64
            || !request_ids.insert(id)
            || capability != required
            || !declared
        {
            return Err(format!("Undeclared or invalid capability request: {id}"));
        }
    }
    let files = bundle
        .get("files")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "Bundle file list is invalid.".to_string())?;
    if files.len() > 100 {
        return Err("Bundle contains too many files.".into());
    }
    let mut contents = std::collections::HashMap::new();
    for file in files {
        let path = file
            .get("path")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "Bundle file path is missing.".to_string())?;
        let media_type = file
            .get("mediaType")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "Bundle media type is missing.".to_string())?;
        let content = file
            .get("content")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "Bundle file content is missing.".to_string())?;
        if !safe_bundle_path(path)
            || !matches!(media_type, "application/json" | "text/plain")
            || content.len() > 256_000
            || contents.insert(path, content).is_some()
        {
            return Err(format!("Unsafe or duplicate bundle file: {path}"));
        }
    }
    let contributions = bundle
        .get("contributions")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "Bundle contribution list is invalid.".to_string())?;
    if contributions.len() > 25
        || contributions.iter().any(|item| {
            item.get("slot").and_then(|value| value.as_str()) != Some("module-center")
                || item.get("kind").and_then(|value| value.as_str()) != Some("notice")
        })
    {
        return Err("Unsupported bundle contribution.".into());
    }
    let tests = bundle
        .get("tests")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "Bundle test list is invalid.".to_string())?;
    if tests.len() > 100 {
        return Err("Bundle contains too many tests.".into());
    }
    for test in tests {
        let path = test
            .get("path")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "Bundle test path is missing.".to_string())?;
        let kind = test
            .get("kind")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "Bundle test kind is missing.".to_string())?;
        let content = contents
            .get(path)
            .ok_or_else(|| format!("Bundle test file was not found: {path}"))?;
        match kind {
            "json-valid" => {
                serde_json::from_str::<serde_json::Value>(content)
                    .map_err(|_| format!("Bundle JSON test failed: {path}"))?;
            }
            "contains" => {
                let expected = test
                    .get("value")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                if !content.contains(expected) {
                    return Err(format!("Bundle contains test failed: {path}"));
                }
            }
            _ => return Err("Unsupported bundle test kind.".into()),
        }
    }
    Ok(())
}

fn module_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("modules"))
        .map_err(|error| error.to_string())
}

fn write_staging_dir(
    staging_dir: &Path,
    bytes: &[u8],
    manifest_json: &str,
    artifact_hash: &str,
    version: &str,
) -> Result<(), String> {
    fs::create_dir_all(staging_dir).map_err(|error| error.to_string())?;
    fs::write(staging_dir.join("artifact.bin"), bytes).map_err(|error| error.to_string())?;
    fs::write(staging_dir.join("manifest.json"), manifest_json)
        .map_err(|error| error.to_string())?;
    fs::write(
        staging_dir.join("activation.json"),
        serde_json::json!({
            "artifactHash": artifact_hash,
            "version": version,
            "activatedAt": Utc::now().to_rfc3339(),
        })
        .to_string(),
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn activate_module_release(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ActivateModuleRequest,
) -> Result<ActivationResult, String> {
    validate_module_id(&request.module_id)?;
    if !request
        .artifact_hash
        .chars()
        .all(|ch| ch.is_ascii_hexdigit())
        || request.artifact_hash.len() != 64
    {
        return Err("Invalid artifact SHA-256.".into());
    }
    let manifest = serde_json::from_str::<serde_json::Value>(&request.manifest_json)
        .map_err(|_| "Invalid module manifest JSON.".to_string())?;
    serde_json::from_str::<serde_json::Value>(&request.previous_module_json)
        .map_err(|_| "Invalid previous module state.".to_string())?;

    let response = state
        .http
        .get(&request.artifact_url)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Artifact download failed ({}).", response.status()));
    }
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if sha256_hex(&bytes) != request.artifact_hash.to_ascii_lowercase() {
        return Err("Artifact hash does not match signed manifest.".into());
    }
    validate_declarative_bundle(&bytes, &request.module_id, &request.version, &manifest)?;

    let root = module_root(&app)?;
    let module_dir = root.join(&request.module_id);
    let current_dir = module_dir.join("current");
    let nonce = Utc::now().timestamp_nanos_opt().unwrap_or_default();
    let snapshot_id = format!("{}:{}", request.module_id, nonce);
    let snapshot_dir = root.join("snapshots").join(&snapshot_id);
    let staging_dir = root
        .join(".staging")
        .join(format!("{}-{}", request.module_id, nonce));

    fs::create_dir_all(&module_dir).map_err(|error| error.to_string())?;
    fs::create_dir_all(&snapshot_dir).map_err(|error| error.to_string())?;
    fs::write(
        snapshot_dir.join("installed-module.json"),
        &request.previous_module_json,
    )
    .map_err(|error| error.to_string())?;
    write_staging_dir(
        &staging_dir,
        &bytes,
        &request.manifest_json,
        &request.artifact_hash,
        &request.version,
    )?;

    if current_dir.exists() {
        fs::rename(&current_dir, snapshot_dir.join("current"))
            .map_err(|error| error.to_string())?;
    }
    if let Err(error) = fs::rename(&staging_dir, &current_dir) {
        let previous = snapshot_dir.join("current");
        if previous.exists() {
            let _ = fs::rename(previous, &current_dir);
        }
        return Err(format!("Atomic activation failed: {error}"));
    }

    Ok(ActivationResult {
        module_id: request.module_id,
        version: request.version,
        artifact_hash: request.artifact_hash,
        snapshot_id,
        runtime: "desktop",
    })
}

#[tauri::command]
pub async fn rollback_module_release(
    app: AppHandle,
    request: RollbackModuleRequest,
) -> Result<RollbackResult, String> {
    validate_module_id(&request.module_id)?;
    validate_snapshot_id(&request.snapshot_id)?;
    if !request
        .snapshot_id
        .starts_with(&format!("{}:", request.module_id))
    {
        return Err("Snapshot does not belong to this module.".into());
    }

    let root = module_root(&app)?;
    let current_dir = root.join(&request.module_id).join("current");
    let snapshot_dir = root.join("snapshots").join(&request.snapshot_id);
    let module = fs::read_to_string(snapshot_dir.join("installed-module.json"))
        .map_err(|_| "Rollback snapshot state was not found.".to_string())?;
    let module = serde_json::from_str(&module)
        .map_err(|_| "Rollback snapshot state is invalid.".to_string())?;
    let previous_dir = snapshot_dir.join("current");
    let displaced_dir = root.join(".rollback").join(format!(
        "{}-{}",
        request.module_id,
        Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));

    if current_dir.exists() {
        if let Some(parent) = displaced_dir.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::rename(&current_dir, &displaced_dir).map_err(|error| error.to_string())?;
    }
    if previous_dir.exists() {
        if let Err(error) = fs::rename(&previous_dir, &current_dir) {
            if displaced_dir.exists() {
                let _ = fs::rename(&displaced_dir, &current_dir);
            }
            return Err(format!("Rollback activation failed: {error}"));
        }
    }

    Ok(RollbackResult { module })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_path_traversal_identifiers() {
        assert!(validate_module_id("fraude.news").is_ok());
        assert!(validate_module_id("fraude../news").is_err());
        assert!(validate_snapshot_id("fraude.news:123").is_ok());
        assert!(validate_snapshot_id("../snapshot").is_err());
    }

    #[test]
    fn hashes_artifacts_deterministically() {
        assert_eq!(
            sha256_hex(b"fraude"),
            "293f91ba1e22079e643ae62511cbb7ba6593dd3dc8b4d6e5f281c8e6dd0d6851"
        );
    }

    #[test]
    fn rejects_executable_and_traversal_bundles() {
        let unsafe_bundle = serde_json::json!({
            "schemaVersion": 1,
            "moduleId": "fraude.news",
            "version": "1.0.0",
            "runtime": { "kind": "javascript" },
            "requests": [],
            "files": [{ "path": "../src/main.ts", "mediaType": "text/javascript", "content": "alert(1)" }],
            "contributions": [],
            "tests": []
        });
        let manifest = serde_json::json!({"permissions": []});
        assert!(validate_declarative_bundle(
            unsafe_bundle.to_string().as_bytes(),
            "fraude.news",
            "1.0.0",
            &manifest
        )
        .is_err());
    }

    #[test]
    fn accepts_tested_declarative_bundle() {
        let bundle = serde_json::json!({
            "schemaVersion": 1,
            "moduleId": "fraude.news",
            "version": "1.0.0",
            "runtime": { "kind": "declarative-v1" },
            "requests": [{"id":"prefs","capability":"storage:workspace","operation":"workspace.read-preferences"}],
            "files": [{ "path": "views/news.json", "mediaType": "application/json", "content": "{\"safe\":true}" }],
            "contributions": [{ "slot": "module-center", "kind": "notice", "title": {"tr":"a","en":"a"}, "body": {"tr":"b","en":"b"} }],
            "tests": [{ "name": "json", "kind": "json-valid", "path": "views/news.json" }]
        });
        let manifest = serde_json::json!({"permissions": ["storage:workspace"]});
        assert!(validate_declarative_bundle(
            bundle.to_string().as_bytes(),
            "fraude.news",
            "1.0.0",
            &manifest
        )
        .is_ok());
    }

    #[test]
    fn rejects_undeclared_capabilities() {
        let bundle = serde_json::json!({
            "schemaVersion": 1,
            "moduleId": "fraude.news",
            "version": "1.0.0",
            "runtime": { "kind": "declarative-v1" },
            "requests": [{"id":"market","capability":"api:market-data","operation":"market.snapshot"}],
            "files": [], "contributions": [], "tests": []
        });
        let manifest = serde_json::json!({"permissions": ["api:news"]});
        assert!(validate_declarative_bundle(
            bundle.to_string().as_bytes(),
            "fraude.news",
            "1.0.0",
            &manifest
        )
        .is_err());
    }
}
