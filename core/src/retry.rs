//! Geçici ağ hataları için ortak yeniden deneme.
//!
//! Dış sağlayıcılarla konuşan her yol aynı sorunu yaşıyor: bağlantı zaman zaman
//! "error sending request" ile düşüyor ve tek denemede vazgeçen kod veriyi
//! **sessizce** kaybediyor — KAP akışı o turda boş kalıyor, bir fonun portföyü
//! dizine hiç girmiyor, mali tablodan birkaç yıl eksiliyor. Hata kullanıcıya
//! gösterilmediği için fark edilmiyor.
//!
//! Sağlayıcıya özgü geri çekilme mantığı olan yollar (Yahoo 429 işleme,
//! `yahoo::chart_with_retry`) kendi döngülerini korur; burası "sadece bir kez
//! daha dene" diyen sade yollar içindir.

use std::time::Duration;

/// KAP'a aynı anda gönderilen en fazla istek.
///
/// kap.org.tr eşzamanlı bağlantıya duyarlı: sınır aşılınca istekleri
/// "error sending request" ile reddediyor. Yük tek bir çağrıdan değil
/// **toplamdan** geliyor — bildirim pencereleri (4, sınıra dayanınca özyinelemeli
/// bölünüp 8-16), fon pencereleri, şirket listesi ve PDR taraması aynı anda
/// akabiliyor. Yeniden deneme eklemek bu durumda yükü artırıp sorunu büyütür;
/// doğru çözüm kaynağı sınırlamaktır.
const KAP_CONCURRENCY: usize = 4;

static KAP_GATE: std::sync::OnceLock<tokio::sync::Semaphore> = std::sync::OnceLock::new();

/// KAP'a istek atmadan önce alınacak izin. İzin, dönen guard düşene kadar tutulur.
pub async fn kap_permit() -> tokio::sync::SemaphorePermit<'static> {
    KAP_GATE
        .get_or_init(|| tokio::sync::Semaphore::new(KAP_CONCURRENCY))
        .acquire()
        .await
        .expect("KAP semaforu kapatılmaz")
}

/// Varsayılan toplam deneme sayısı (ilk deneme dahil).
pub const DEFAULT_ATTEMPTS: u32 = 3;

/// İlk bekleme; her denemede ikiye katlanır.
const BASE_BACKOFF: Duration = Duration::from_millis(300);

/// `operation`'ı geçici hatalarda üstel geri çekilerek yeniden dener.
///
/// `is_permanent` ile kalıcı hatalar ayrılır (ör. "kayıt bulunamadı"): onlar
/// beklemeden döner, çünkü tekrar denemek yalnız zaman kaybettirir.
pub async fn with_retry<T, F, Fut>(
    attempts: u32,
    is_permanent: impl Fn(&str) -> bool,
    mut operation: F,
) -> Result<T, String>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    let mut attempt = 1;
    loop {
        let error = match operation().await {
            Ok(value) => return Ok(value),
            Err(error) => error,
        };
        if attempt >= attempts.max(1) || is_permanent(&error) {
            return Err(error);
        }
        tokio::time::sleep(BASE_BACKOFF * 2u32.pow(attempt - 1)).await;
        attempt += 1;
    }
}

/// Hiçbir hatanın kalıcı sayılmadığı kısayol.
pub async fn retry_transient<T, F, Fut>(operation: F) -> Result<T, String>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    with_retry(DEFAULT_ATTEMPTS, is_rate_limited, operation).await
}

/// Hata metni hız sınırına mı işaret ediyor?
///
/// `with_retry`'a "kalıcı" olarak verilir: sağlayıcı sınırı dakikalar
/// mertebesinde sıfırlanır, aynı çağrı içinde ısrar etmek sınırı uzatmaktan
/// başka işe yaramaz. Doğru davranış hızla ve **anlaşılır** biçimde başarısız
/// olup bir sonraki önbellek turunu beklemektir.
pub fn is_rate_limited(error: &str) -> bool {
    error.contains("429") || error.to_lowercase().contains("rate limit")
}

/// HTTP durumunu denetler ve hız sınırını ayırt edilebilir biçimde raporlar.
///
/// Durum denetlenmeden gövde JSON'a verildiğinde 429/5xx yanıtları "yanıtı
/// çözümlenemedi" gibi görünüyor ve gerçek sebep kayboluyordu.
pub fn check_status(response: reqwest::Response, context: &str) -> Result<reqwest::Response, String> {
    let status = response.status();
    if status.as_u16() == 429 {
        return Err(format!(
            "{context}: sağlayıcı hız sınırı (429). İstek yoğunluğu düşene kadar bekleniyor."
        ));
    }
    response
        .error_for_status()
        .map_err(|error| format!("{context} yanıtı: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    #[tokio::test]
    async fn succeeds_after_transient_failures() {
        let calls = AtomicU32::new(0);
        let result = retry_transient(|| async {
            if calls.fetch_add(1, Ordering::SeqCst) < 2 {
                Err("error sending request".to_string())
            } else {
                Ok(42)
            }
        })
        .await;
        assert_eq!(result, Ok(42));
        assert_eq!(calls.load(Ordering::SeqCst), 3, "iki hatadan sonra başarılı olmalı");
    }

    #[tokio::test]
    async fn gives_up_after_the_attempt_budget() {
        let calls = AtomicU32::new(0);
        let result: Result<u32, String> = retry_transient(|| async {
            calls.fetch_add(1, Ordering::SeqCst);
            Err("hep hata".to_string())
        })
        .await;
        assert!(result.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), DEFAULT_ATTEMPTS);
    }

    #[test]
    fn recognizes_rate_limit_errors() {
        assert!(is_rate_limited("KAP members yanıtı: HTTP status 429 Too Many Requests"));
        assert!(is_rate_limited("provider rate limit reached"));
        assert!(!is_rate_limited("error sending request"));
        assert!(!is_rate_limited("HTTP status 500"));
    }

    /// 429 yeniden DENENMEMELİ: sağlayıcı sınırı dakikalar mertebesinde
    /// sıfırlanır, ısrar etmek sınırı uzatır. (Bu tam olarak yaşandı: yeniden
    /// deneme eklemek KAP hatalarını 2'den 11'e çıkardı.)
    #[tokio::test]
    async fn rate_limit_is_not_retried() {
        let calls = AtomicU32::new(0);
        let result: Result<u32, String> = retry_transient(|| async {
            calls.fetch_add(1, Ordering::SeqCst);
            Err("KAP members yanıtı: HTTP status 429".to_string())
        })
        .await;
        assert!(result.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 1, "429 tek denemede bırakılmalı");
    }

    /// Kalıcı hata beklemeden dönmeli: tekrar denemek sonucu değiştirmez.
    #[tokio::test]
    async fn permanent_errors_are_not_retried() {
        let calls = AtomicU32::new(0);
        let result: Result<u32, String> =
            with_retry(5, |error| error.contains("bulunamadı"), || async {
                calls.fetch_add(1, Ordering::SeqCst);
                Err("kayıt bulunamadı".to_string())
            })
            .await;
        assert!(result.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }
}
