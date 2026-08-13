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

/// Testi çalıştırmadan önceki yerel kontroller; sırrı anahtarlıktan çözerek
/// anahtarın bir kopyasını verir. Ağ çağrısı kilidi tutmadan yapılabilsin diye
/// bağlantı denemesinden ayrıldı.
pub fn prepare_test(store: &AppStore, id: &str) -> Result<StoredAiKey, String> {
    let key = store
        .ai_keys
        .iter()
        .find(|key| key.id == id)
        .ok_or_else(|| format!("AI key {id} was not found"))?;

    if !key.enabled {
        return Err("AI key is disabled".into());
    }

    let mut resolved = key.clone();
    resolved.secret = crate::keychain::resolve_secret(&key.id, &key.secret);
    if resolved.secret.trim().len() < 8 {
        return Err("Anahtarın sırrı okunamadı ya da çok kısa.".into());
    }
    Ok(resolved)
}

/// Anahtarı sağlayıcıya karşı gerçekten dener. Önceki sürüm yalnız sırrın
/// uzunluğuna bakıp "bağlantı doğrulandı" diyordu; yanlış uç nokta, geçersiz
/// anahtar ve tanınmayan model bu yüzden ancak ilk gerçek soruda ortaya
/// çıkıyordu.
pub async fn test_connection(
    client: &reqwest::Client,
    key: &StoredAiKey,
) -> Result<String, String> {
    let started = std::time::Instant::now();
    crate::services::probe_ai_key(client, key).await?;
    Ok(format!(
        "{} / {} bağlantısı doğrulandı ({} ms).",
        key.provider,
        key.default_model,
        started.elapsed().as_millis()
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
    // Bilinmeyen bir sağlayıcı adı için URL zorunlu: boş bırakılırsa istek
    // varsayılan uç noktaya, yani kullanıcının anahtarı yanlış sağlayıcıya gider.
    let has_url = request
        .api_url
        .as_ref()
        .map(|url| !url.trim().is_empty())
        .unwrap_or(false);
    if !has_url && !crate::services::has_known_endpoint(&request.provider) {
        return Err(format!(
            "'{}' için Base API URL zorunlu (ör. https://api.example.com/v1). \
             Boş bırakılan adres anahtarınızı yanlış sağlayıcıya gönderir.",
            request.provider.trim()
        ));
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

    #[test]
    fn custom_provider_without_url_is_rejected() {
        // Adres boşsa istek varsayılan uca, yani kullanıcının anahtarı yanlış
        // sağlayıcıya giderdi; kayıt aşamasında durduruluyor.
        let mut store = AppStore::seeded();
        let result = super::save(
            &mut store,
            SaveAiKeyRequest {
                id: None,
                provider: "custom".into(),
                label: "Gateway".into(),
                api_key: "sk-test-secret-value".into(),
                default_model: "meta-llama/Llama-3-70b-chat-hf".into(),
                enabled: true,
                api_url: Some("   ".into()),
            },
        );
        assert!(result.is_err());

        // Aynı kayıt açık adresle kabul edilmeli.
        let accepted = super::save(
            &mut store,
            SaveAiKeyRequest {
                id: None,
                provider: "custom".into(),
                label: "Gateway".into(),
                api_key: "sk-test-secret-value".into(),
                default_model: "meta-llama/Llama-3-70b-chat-hf".into(),
                enabled: true,
                api_url: Some("https://openrouter.ai/api/v1".into()),
            },
        )
        .expect("açık adresle kayıt kabul edilmeli");
        let _ = super::delete(&mut store, &accepted.id);
    }
}
