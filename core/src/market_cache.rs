//! Hisse evreninin disk önbelleği.
//!
//! Tam senkron evrendeki her sembol için bir Yahoo grafik isteği yapar — ~650
//! istek. Bellekteki depo süreçle öldüğü için, önbelleksiz kurulumda uygulamanın
//! **her açılışı** bu turu baştan tetikliyordu: kullanıcı dakikalarca boş bir
//! tabloya bakıyor, sağlayıcı ise hiç değişmemiş veriyi yeniden gönderiyordu.
//!
//! Evreni son başarılı tam senkronun zamanıyla birlikte diske yazmak açılışı
//! anlık yapar ve `services::effective_sync_mode` yeniden başlatmadan sonra da
//! "incremental" kalabilir. Aynı yaklaşımın TEFAS'taki karşılığı için bkz.
//! `tefas.rs` disk önbelleği.

use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::domain::EquityRow;

/// Bu yaştan eski bir evren başlangıç noktası olarak kullanılmaz: fiyatlar da
/// göstergeler de anlamını yitirmiş olur, boş depoyla başlamak daha dürüsttür.
const MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

/// İki disk yazımı arasındaki en kısa süre (tam senkron bunu es geçer).
///
/// Dolu bir evren ~695 KB tutuyor; artımlı senkronun beş dakikalık temposunda
/// yazmak saatte ~8 MB'lık boş yere disk trafiği demek. Önbelleğin asıl işi tam
/// senkronu tekrarlatmamak, fiyatı saniyesinde tutmak değil: açılışta zaten
/// artımlı senkron çalışıp fiyatları tazeliyor.
const MIN_WRITE_INTERVAL: Duration = Duration::from_secs(15 * 60);

#[derive(Serialize, Deserialize)]
#[serde(default)]
struct Snapshot {
    /// Dosyanın yazıldığı an (unix saniye). **Verinin** yaşı buradan ölçülür.
    written_at_unix: u64,
    /// Kapsama eşiğini geçmiş son tam senkronun anı (unix saniye); 0 = hiç
    /// olmadı. Kısmi turlar bu alanı ileri taşımaz — taşısaydı yarım kalmış bir
    /// evren tam senkronu saatlerce erteletirdi.
    full_sync_at_unix: u64,
    equities: Vec<EquityRow>,
}

impl Default for Snapshot {
    fn default() -> Self {
        Snapshot { written_at_unix: 0, full_sync_at_unix: 0, equities: Vec::new() }
    }
}

fn cache_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|home| home.join(".fraude_market.json"))
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default()
}

fn read_snapshot() -> Option<Snapshot> {
    cache_path()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str::<Snapshot>(&raw).ok())
}

/// Diskten okunan tam senkron damgası (mutlak unix saniye), süreçte bir kez.
static DISK_FULL_SYNC_AT: OnceLock<Option<u64>> = OnceLock::new();

/// Bu süreçte yazılmış en güncel tam senkron damgası.
static WRITTEN_FULL_SYNC_AT: OnceLock<Mutex<Option<u64>>> = OnceLock::new();

/// En son disk yazımı — yazım sıklığını sınırlar.
static LAST_WRITE: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();

/// Bilinen en güncel tam senkron damgası: bu süreçte yazılan, yoksa diskten
/// okunan. **Mutlak** zaman tutulur; yaş değil. Yaş saklansaydı sonraki artımlı
/// yazım `şimdi - yaş` hesabıyla damgayı süreç çalışma süresi kadar ileri
/// taşır ve tam senkron sonsuza dek ertelenirdi.
fn known_full_sync_at() -> Option<u64> {
    let written = *WRITTEN_FULL_SYNC_AT
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    written.or_else(|| *DISK_FULL_SYNC_AT.get_or_init(|| {
        read_snapshot().map(|snapshot| snapshot.full_sync_at_unix).filter(|at| *at > 0)
    }))
}

/// Kayıtlı evreni okur. Dosya yoksa, bozuksa ya da `MAX_AGE`'i aşmışsa boş döner.
pub fn load() -> Vec<EquityRow> {
    let Some(snapshot) = read_snapshot() else {
        let _ = DISK_FULL_SYNC_AT.set(None);
        return Vec::new();
    };

    let _ = DISK_FULL_SYNC_AT.set((snapshot.full_sync_at_unix > 0).then_some(snapshot.full_sync_at_unix));

    let age = Duration::from_secs(unix_now().saturating_sub(snapshot.written_at_unix));
    if age >= MAX_AGE {
        return Vec::new();
    }
    snapshot.equities
}

/// Son tam senkronun üzerinden geçen süre; hiç yapılmamışsa `None`.
///
/// `services::last_full_sync_age` yalnız süreç içi `Instant`'a bakarsa, yeniden
/// başlatılan uygulama "hiç tam senkron yapılmamış" sayılır ve evren diskten
/// dolu gelmiş olsa bile tam senkrona yükselir — önbelleğin varlık nedenini
/// ortadan kaldırır.
pub fn disk_full_sync_age() -> Option<Duration> {
    known_full_sync_at().map(|at| Duration::from_secs(unix_now().saturating_sub(at)))
}

/// Evreni diske yazar. `full_sync`, **kapsama eşiğini geçmiş** bir tam senkron
/// turunda true olmalıdır; kısmi turlar false geçmelidir.
///
/// Yazım bloklayıcı olduğundan ayrı bir iş parçacığına verilir; senkron yolu
/// diski beklemez. Tam senkron dışındaki çağrılar `MIN_WRITE_INTERVAL` ile
/// seyreltilir.
pub fn save(equities: &[EquityRow], full_sync: bool) {
    if equities.is_empty() {
        return;
    }

    {
        let last_write = LAST_WRITE.get_or_init(|| Mutex::new(None));
        let mut guard = last_write.lock().unwrap_or_else(|error| error.into_inner());
        if !full_sync && guard.is_some_and(|at| at.elapsed() < MIN_WRITE_INTERVAL) {
            return;
        }
        *guard = Some(Instant::now());
    }

    let now = unix_now();
    let full_sync_at_unix = if full_sync {
        *WRITTEN_FULL_SYNC_AT
            .get_or_init(|| Mutex::new(None))
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = Some(now);
        now
    } else {
        // Kısmi/artımlı yazım mevcut damgayı olduğu gibi taşır. Damga hiç yoksa
        // 0 kalır: dosya okunur ama `disk_full_sync_age` None döner, yani bir
        // sonraki açılış yine tam senkron dener.
        known_full_sync_at().unwrap_or(0)
    };

    let snapshot = Snapshot { written_at_unix: now, full_sync_at_unix, equities: equities.to_vec() };
    std::thread::spawn(move || {
        if let Some(path) = cache_path() {
            let _ = crate::persist::write_json_atomic(&path, &snapshot);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(ticker: &str, price: f64) -> EquityRow {
        EquityRow { ticker: ticker.into(), price, ..Default::default() }
    }

    /// Yazılan evren aynı alanlarla geri okunabilmeli; `EquityRow` yalnız
    /// Serialize türetirse bu test derlenmez ve regresyon anında yakalanır.
    #[test]
    fn snapshot_round_trips_through_json() {
        let snapshot = Snapshot {
            written_at_unix: 1_700_000_100,
            full_sync_at_unix: 1_700_000_000,
            equities: vec![row("ASELS", 312.25), row("GRAM ALTIN", 4_100.0)],
        };
        let json = serde_json::to_string(&snapshot).unwrap();
        let parsed: Snapshot = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.full_sync_at_unix, 1_700_000_000);
        assert_eq!(parsed.written_at_unix, 1_700_000_100);
        assert_eq!(parsed.equities.len(), 2);
        assert_eq!(parsed.equities[0].ticker, "ASELS");
        assert!((parsed.equities[1].price - 4_100.0).abs() < 1e-9);
    }

    /// Eski sürümlerin yazdığı, alanı eksik kayıtlar okunabilmeli: `EquityRow`
    /// eksik alanları varsayılanla doldurmalı, tüm dosyayı çöpe atmamalı.
    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let json = r#"{"written_at_unix":2,"full_sync_at_unix":1,"equities":[{"ticker":"THYAO","price":300.0}]}"#;
        let parsed: Snapshot = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.equities[0].ticker, "THYAO");
        assert_eq!(parsed.equities[0].rsi, 0.0);
        assert!(parsed.equities[0].index_memberships.is_empty());
    }

    /// Damga alanı hiç bulunmayan (bu modülden önce yazılmış ya da elle
    /// bozulmuş) dosya, alan eksikliğinden panikleyip tüm önbelleği düşürmemeli.
    #[test]
    fn snapshot_without_timestamps_parses_as_never_synced() {
        let parsed: Snapshot = serde_json::from_str(r#"{"equities":[]}"#).unwrap();
        assert_eq!(parsed.full_sync_at_unix, 0);
        assert_eq!(parsed.written_at_unix, 0);
    }
}
