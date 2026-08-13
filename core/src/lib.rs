//! fraude-core: FRAUDE'nin Tauri'siz veri çekirdeği.
//!
//! Masaüstü (src-tauri) bu crate'i path bağımlılığı olarak kullanır ve
//! `commands.rs` içindeki ince Tauri sarmalayıcılarından çağırır; web API
//! (server) aynı fonksiyonları `/v1/rpc/{komut}` sevkinden çağırır. Buraya
//! Tauri'ye dokunan hiçbir şey giremez — bildirim/olay köprüsü src-tauri'de
//! (`run_monitor_and_notify`) yaşar.

pub mod ai_tagger;
pub mod analyst_consensus;
pub mod api;
pub mod bist;
pub mod bist_indices;
pub mod bist_universe;
pub mod capital_store;
pub mod company_match;
pub mod corporate_actions;
pub mod domain;
pub mod economic_calendar;
pub mod fql;
pub mod fundamentals;
pub mod global_calls;
pub mod indicators;
pub mod ipo_follow;
pub mod ipo_pipeline;
pub mod ipo_scraper;
pub mod ipo_store;
pub mod isyatirim;
pub mod isyatirim_price;
pub mod kap;
pub mod kap_capital;
pub mod kap_dividend;
pub mod kap_ipo;
pub mod kap_pdr;
pub mod kap_tssd;
pub mod keychain;
pub mod live_quotes;
pub mod market_cache;
pub mod market_calendar;
pub mod monitor;
pub mod news;
pub mod news_tagger;
pub mod persist;
pub mod providers;
pub mod research;
pub mod research_reports;
pub mod retry;
pub mod secrets;
pub mod services;
pub mod shareholders;
pub mod spk;
pub mod storage;
pub mod subsidiaries;
pub mod tefas;
pub mod tefas_issuer;
pub mod tradingview;
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

/// Boştaki bağlantıların havuzda tutulma süresi.
///
/// reqwest'in varsayılanı 90 sn, ama İş Yatırım keep-alive bağlantılarını bundan
/// çok daha erken kapatıyor. Havuzdan ölü bir bağlantı seçen istek "error sending
/// request" ile düşüyor — canlı fiyat yolundaki elle yeniden deneme tam olarak bu
/// yüzden var. Süreyi sağlayıcının kapatma penceresinin altına çekmek sorunu
/// kaynağında bitirir; yeniden deneme gerçek ağ dalgalanmaları için kalır.
const POOL_IDLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

/// Host başına havuzda tutulan boş bağlantı sayısı. Tam senkron Yahoo'ya 8,
/// canlı fiyat İş Yatırım'a 6 eşzamanlı istek gönderiyor; havuzun bu tepe
/// değerin altında kalması her turda yeniden TLS el sıkışması demek olurdu.
const POOL_MAX_IDLE_PER_HOST: usize = 12;

/// Ortak istemci yapılandırması: sıkıştırma, bağlantı havuzu, zaman aşımı.
///
/// Ayrı bir istemciye gerçekten ihtiyaç duyan tek yer (Yahoo crumb oturumu için
/// çerez deposu gereken `corporate_actions`) buradan türetir; böylece "ayrı
/// istemci" kararı sıkıştırmayı sessizce kaybetmeye dönüşmez.
pub fn http_client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        // Accept-Encoding otomatik eklenir ve yanıt saydam çözülür. Sağlayıcı
        // sıkıştırmayı desteklemiyorsa istek aynen düz metin döner.
        .gzip(true)
        .deflate(true)
        .pool_idle_timeout(POOL_IDLE_TIMEOUT)
        .pool_max_idle_per_host(POOL_MAX_IDLE_PER_HOST)
        // Uzun süren senkron turlarında sessizce düşen NAT/güvenlik duvarı
        // bağlantılarını canlı tutar.
        .tcp_keepalive(std::time::Duration::from_secs(30))
}

/// Tüm dış istekler için paylaşılan HTTP istemcisi.
///
/// Tek yapılandırma noktasıdır. Modüller kendi `Client::new()`ini kurmamalıdır —
/// öyle bir istemci havuzu paylaşmaz, her çağrıda yeniden TLS el sıkışır ve
/// sıkıştırma istemez.
pub fn http_client() -> reqwest::Client {
    http_client_builder()
        .build()
        .expect("Failed to create HTTP client")
}

impl AppState {
    /// Varsayılan durum: tohumlanmış depo + paylaşılan HTTP istemcisi.
    /// Masaüstü ve server aynı kurulumu paylaşır.
    pub fn new() -> Self {
        AppState {
            store: Mutex::new(AppStore::seeded()),
            http: http_client(),
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
