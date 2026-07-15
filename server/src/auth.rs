//! Kimlik doğrulama (Faz 2 iskeleti).
//!
//! Kişi-başı komutlar `Authorization: Bearer <JWT>` başlığı taşır. JWT,
//! Supabase Auth tarafından üretilir ve burada Supabase JWKS ile doğrulanır;
//! `sub` (user_id) çıkarılıp istek bağlamına konur.
//!
//! Bu dosya şimdilik yalnızca token'ı ayrıştıran yardımcıyı içerir. Gerçek
//! JWKS imza doğrulaması (jsonwebtoken + JWKS cache) Faz 2'de eklenecek.

#![allow(dead_code)]

use axum::http::HeaderMap;

/// `Authorization: Bearer <token>` başlığından ham token'ı çıkarır.
pub fn extract_bearer(headers: &HeaderMap) -> Option<String> {
    let value = headers.get(axum::http::header::AUTHORIZATION)?.to_str().ok()?;
    let token = value.strip_prefix("Bearer ").or_else(|| value.strip_prefix("bearer "))?;
    let token = token.trim();
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

/// Faz 2'de: token'ı Supabase JWKS ile doğrula ve `user_id` (sub) döndür.
/// Şimdilik yer tutucu — bilinçli olarak reddeder.
pub fn require_user(_headers: &HeaderMap) -> Result<String, &'static str> {
    Err("kimlik doğrulama henüz uygulanmadı (Faz 2)")
}
