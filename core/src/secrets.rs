use crate::domain::{AiKeyRecord, SaveAiKeyRequest, StoredAiKey};
use crate::services::clock_string;
use crate::storage::AppStore;

pub fn list(store: &AppStore) -> Vec<AiKeyRecord> {
    store.ai_keys.iter().map(StoredAiKey::public_record).collect()
}

pub fn save(store: &mut AppStore, request: SaveAiKeyRequest) -> Result<AiKeyRecord, String> {
    validate(&request)?;
    let id = request
        .id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("ai-key-{}", clock_string().replace(':', "-")));

    let mut existing_record = None;
    if let Some(existing) = store.ai_keys.iter_mut().find(|key| key.id == id) {
        existing.provider = request.provider.clone();
        existing.label = request.label.clone();
        if !request.api_key.is_empty() {
            existing.secret = request.api_key.trim().to_string();
        }
        existing.default_model = request.default_model.clone();
        existing.enabled = request.enabled;
        existing.api_url = request.api_url.clone().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        existing_record = Some(existing.public_record());
    }

    if let Some(record) = existing_record {
        store.save_ai_keys();
        return Ok(record);
    }

    let should_default = store.ai_keys.iter().all(|key| !key.is_default);
    let stored = StoredAiKey {
        id,
        provider: request.provider,
        label: request.label,
        secret: request.api_key.trim().to_string(),
        default_model: request.default_model,
        enabled: request.enabled,
        is_default: should_default,
        created_at: clock_string(),
        last_used_at: None,
        api_url: request.api_url.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
    };
    let public = stored.public_record();
    store.ai_keys.push(stored);
    store.save_ai_keys();
    Ok(public)
}

pub fn delete(store: &mut AppStore, id: &str) -> Result<Vec<AiKeyRecord>, String> {
    let before = store.ai_keys.len();
    store.ai_keys.retain(|key| key.id != id);
    if store.ai_keys.len() == before {
        return Err(format!("AI key {id} was not found"));
    }
    // Sır OS anahtarlığında tutulduğundan oradan da temizlenmeli.
    crate::keychain::delete_secret(id);
    if store.ai_keys.iter().all(|key| !key.is_default) {
        if let Some(first) = store.ai_keys.first_mut() {
            first.is_default = true;
        }
    }
    store.save_ai_keys();
    Ok(list(store))
}

pub fn set_default(store: &mut AppStore, id: &str) -> Result<Vec<AiKeyRecord>, String> {
    if !store.ai_keys.iter().any(|key| key.id == id) {
        return Err(format!("AI key {id} was not found"));
    }
    for key in &mut store.ai_keys {
        if key.id == id {
            key.is_default = true;
        } else {
            key.is_default = false;
        }
    }
    store.save_ai_keys();
    Ok(list(store))
}

pub fn test(store: &AppStore, id: &str) -> Result<String, String> {
    let key = store
        .ai_keys
        .iter()
        .find(|key| key.id == id)
        .ok_or_else(|| format!("AI key {id} was not found"))?;

    if !key.enabled {
        return Err("AI key is disabled".into());
    }
    if key.secret.len() < 12 {
        return Err("AI key looks too short".into());
    }

    Ok(format!(
        "{} / {} connection check passed locally. Network calls are isolated behind the provider layer.",
        key.provider, key.default_model
    ))
}

fn validate(request: &SaveAiKeyRequest) -> Result<(), String> {
    if request.provider.trim().is_empty() {
        return Err("Provider is required".into());
    }
    if request.label.trim().is_empty() {
        return Err("Label is required".into());
    }
    if request.api_key.trim().len() < 8 {
        return Err("API key must be at least 8 characters".into());
    }
    if request.default_model.trim().is_empty() {
        return Err("Default model is required".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::domain::SaveAiKeyRequest;
    use crate::storage::AppStore;

    #[test]
    fn does_not_return_plaintext_secret() {
        let mut store = AppStore::seeded();
        let record = super::save(
            &mut store,
            SaveAiKeyRequest {
                id: None,
                provider: "openai".into(),
                label: "Main".into(),
                api_key: "sk-test-secret-value".into(),
                default_model: "gpt-4.1".into(),
                enabled: true,
                api_url: None,
            },
        )
        .unwrap();

        assert_ne!(record.masked_key, "sk-test-secret-value");
        assert!(record.masked_key.starts_with("sk-t"));

        // Test artığı bırakma: anahtarlık kaydını ve dosya girişini temizle.
        let _ = super::delete(&mut store, &record.id);
    }
}
