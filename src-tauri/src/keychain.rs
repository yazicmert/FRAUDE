//! AI sağlayıcı API anahtarlarının (sırların) işletim sistemi anahtarlığında
//! saklanması. Sırlar artık `~/.fraude_keys.json` içinde düz metin tutulmaz;
//! yalnızca metadata (id, sağlayıcı, etiket, model, bayraklar) dosyada kalır,
//! sır macOS Keychain / Windows Credential Manager / Linux Secret Service'te
//! tutulur. Anahtarlığa erişilemezse çağıran taraf düz-metin yedeğe düşer,
//! böylece işlevsellik bozulmaz.

const SERVICE: &str = "dev.fraude.ai-keys";

/// Sırrı anahtarlığa yazar. Başarılıysa `true` döner; anahtarlık yoksa/erişim
/// reddedilirse `false` (çağıran taraf düz-metin yedeğe düşer).
pub fn store_secret(id: &str, secret: &str) -> bool {
    match keyring::Entry::new(SERVICE, id) {
        Ok(entry) => entry.set_password(secret).is_ok(),
        Err(_) => false,
    }
}

/// Sırrı anahtarlıktan okur. Kayıt yoksa/erişilemezse `None`.
pub fn read_secret(id: &str) -> Option<String> {
    keyring::Entry::new(SERVICE, id)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .filter(|secret| !secret.is_empty())
}

/// Sırrı anahtarlıktan siler (anahtar silindiğinde çağrılır). Sessizce
/// başarısız olabilir (kayıt zaten yoksa).
pub fn delete_secret(id: &str) {
    if let Ok(entry) = keyring::Entry::new(SERVICE, id) {
        let _ = entry.delete_credential();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Anahtarlık CI/headless ortamlarda bulunmayabileceğinden bu test canlı
    // erişim ister; yalnızca elle çalıştırılır.
    #[test]
    #[ignore = "requires OS keychain access"]
    fn round_trip_secret() {
        let id = format!("fraude-test-{}", std::process::id());
        assert!(store_secret(&id, "sk-secret-123"));
        assert_eq!(read_secret(&id).as_deref(), Some("sk-secret-123"));
        delete_secret(&id);
        assert_eq!(read_secret(&id), None);
    }
}
