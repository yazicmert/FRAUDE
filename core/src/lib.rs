//! fraude-core: FRAUDE'nin Tauri'siz veri çekirdeği.
//!
//! Masaüstü (src-tauri) bu crate'i path bağımlılığı olarak kullanır ve
//! `commands.rs` içindeki ince Tauri sarmalayıcılarından çağırır; web API
//! (server) aynı fonksiyonları `/v1/rpc/{komut}` sevkinden çağırır. Buraya
//! Tauri'ye dokunan hiçbir şey giremez — bildirim/olay köprüsü src-tauri'de
//! (`run_monitor_and_notify`) yaşar.

pub mod ai_tagger;
pub mod api;
pub mod bist;
pub mod bist_indices;
pub mod bist_universe;
pub mod corporate_actions;
pub mod domain;
pub mod economic_calendar;
pub mod fql;
pub mod fundamentals;
pub mod indicators;
pub mod ipo_scraper;
pub mod ipo_store;
pub mod isyatirim;
pub mod isyatirim_price;
pub mod kap;
pub mod kap_pdr;
pub mod keychain;
pub mod live_quotes;
pub mod market_calendar;
pub mod monitor;
pub mod news;
pub mod news_tagger;
pub mod persist;
pub mod providers;
pub mod secrets;
pub mod services;
pub mod shareholders;
pub mod spk;
pub mod storage;
pub mod subsidiaries;
pub mod tefas;
pub mod tefas_issuer;
pub mod yahoo;

use storage::AppStore;
use tokio::sync::Mutex;

#[derive(Default)]
pub struct IpoCache {
    pub base_records: Vec<domain::IpoRecord>,
    pub scrape_ok: bool,
    pub last_updated: Option<String>,
    pub fetched_at: Option<std::time::Instant>,
}

pub struct AppState {
    pub store: Mutex<AppStore>,
    pub http: reqwest::Client,
    pub ipo_cache: Mutex<IpoCache>,
    pub monitor: Mutex<monitor::MonitorRuntime>,
    /// İzleme turlarını serileştirir: arka plan döngüsü ile elle "Şimdi Tara"
    /// aynı anda çalışıp mükerrer uyarı üretmesin ve "görüldü" güncellemesi
    /// kaybolmasın. Tur boyunca tutulur (ağ işlemleri dahil).
    pub monitor_cycle_lock: Mutex<()>,
}

impl AppState {
    /// Varsayılan durum: tohumlanmış depo + 30 sn zaman aşımı olan HTTP istemcisi.
    /// Masaüstü ve server aynı kurulumu paylaşır.
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("Failed to create HTTP client");
        AppState {
            store: Mutex::new(AppStore::seeded()),
            http,
            ipo_cache: Mutex::new(IpoCache::default()),
            monitor: Mutex::new(monitor::load()),
            monitor_cycle_lock: Mutex::new(()),
        }
    }
}

/// Halka arz verisi uygulama açıkken bu aralıkla arka planda tazelenir;
/// takvim kullanıcı sekmeyi açmadan hazır olur ve arşiv güncel kalır.
pub const IPO_REFRESH_INTERVAL_SECS: u64 = 30 * 60;

pub async fn refresh_ipo_cache(state: &AppState) {
    let (records, scrape_ok) = corporate_actions::refresh_ipo_base(&state.http).await;
    let mut cache = state.ipo_cache.lock().await;
    cache.base_records = records;
    cache.scrape_ok = scrape_ok;
    cache.last_updated = Some(chrono::Local::now().format("%d.%m.%Y %H:%M").to_string());
    cache.fetched_at = Some(std::time::Instant::now());
}
