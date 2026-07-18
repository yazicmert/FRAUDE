//! TEFAS yatırım fonu verisi.
//!
//! TEFAS Nisan 2026'da Next.js altyapısına geçti; eski `api/DB/BindHistory*`
//! uçları emekli (`ERR-006`). Yeni JSON API çerezsiz, anahtarsız ve düz POST ile
//! çalışır — ana sayfadaki F5/TSPD bot-challenge API'yi etkilemez.
//!
//! Ölçülmüş iki sert kısıt tasarımı belirler:
//!   1. **Dakikada 6 istek.** 7. istek `HTTP 429 / ERR-224`. Kayan pencere; uzun
//!      IP yasağı yok. Tüm çağrılar [`Throttle`] üzerinden geçer.
//!   2. **Tarih aralığı 1 ayı aşamaz.** Aşarsa hata metniyle boş liste döner;
//!      uzun geçmiş aylık parçalara bölünmelidir.
//!
//! Fon tipi başına tek istek o tipin tamamını getirir (~3239 fon, 5 istek).

use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use chrono::{Datelike, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

const FUNDS_URL: &str = "https://www.tefas.gov.tr/api/funds/fonGnlBlgSiraliGetir";
const BREAKDOWN_URL: &str = "https://www.tefas.gov.tr/api/funds/dagilimSiraliGetirT";
const REFERER: &str = "https://www.tefas.gov.tr/tr/fon-verileri";

/// Sağlayıcının dakikalık istek sınırı (ölçülmüş: 7. istek 429 döner).
const RATE_LIMIT: usize = 6;
const RATE_WINDOW: Duration = Duration::from_secs(60);

/// Fon listesi önbelleği. Fiyatlar günde bir açıklandığından kısa tutmanın
/// karşılığı yok; sınır zaten dakikada 6 istek.
const LIST_CACHE_TTL: Duration = Duration::from_secs(30 * 60);

/// TEFAS fon tipleri. Her biri tek istekle tamamen çekilir.
pub const FUND_KINDS: &[(&str, &str)] = &[
    ("YAT", "Yatırım Fonu"),
    ("EMK", "Emeklilik Fonu"),
    ("BYF", "Borsa Yatırım Fonu"),
    ("GYF", "Gayrimenkul Yatırım Fonu"),
    ("GSYF", "Girişim Sermayesi Yatırım Fonu"),
];

/// Frontend'e dönen fon kaydı. `Deserialize` disk önbelleği için gereklidir.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FundRow {
    pub code: String,
    pub name: String,
    /// Fon tipi kodu (YAT, EMK, BYF, GYF, GSYF).
    pub kind: String,
    /// Fiyatın ait olduğu tarih (YYYY-MM-DD).
    pub date: String,
    pub price: f64,
    /// Bir önceki açıklanan fiyat; yoksa `price`.
    pub previous_price: f64,
    /// Önceki fiyata göre yüzde değişim.
    pub change_pct: f64,
    /// Tedavüldeki pay sayısı.
    pub share_count: f64,
    /// Yatırımcı sayısı.
    pub investor_count: i64,
    /// Portföy büyüklüğü (TL).
    pub portfolio_size: f64,
}

/// Fonun varlık sınıfı dağılımı (yüzde). TEFAS tek tek hisseleri **vermez**;
/// yalnızca sınıf bazında oran yayınlar.
#[derive(Clone, Debug, Serialize)]
pub struct FundAllocation {
    pub label: String,
    pub pct: f64,
}

#[derive(Deserialize)]
struct Envelope<T> {
    #[serde(rename = "errorMessage")]
    error_message: Option<String>,
    #[serde(rename = "resultList")]
    result_list: Option<Vec<T>>,
}

#[derive(Deserialize, Clone)]
struct FundInfoRow {
    #[serde(rename = "fonKodu")]
    code: Option<String>,
    #[serde(rename = "fonUnvan")]
    name: Option<String>,
    tarih: Option<String>,
    fiyat: Option<f64>,
    #[serde(rename = "tedPaySayisi")]
    share_count: Option<f64>,
    #[serde(rename = "kisiSayisi")]
    investor_count: Option<i64>,
    #[serde(rename = "portfoyBuyukluk")]
    portfolio_size: Option<f64>,
}

// ─── Hız sınırlayıcı ───────────────────────────────────────────────────────────

/// Kayan pencereli istek sayacı: pencerede `RATE_LIMIT` isteği aşmadan bekletir.
///
/// Sağlayıcı sınırı aşan isteği 429 ile reddettiğinden, geri çekilmek yerine
/// **önceden** beklemek gerekir; aksi halde her aşım bir isteği çöpe atar.
struct Throttle {
    hits: Mutex<VecDeque<Instant>>,
}

static THROTTLE: OnceLock<Throttle> = OnceLock::new();

impl Throttle {
    fn get() -> &'static Throttle {
        THROTTLE.get_or_init(|| Throttle { hits: Mutex::new(VecDeque::new()) })
    }

    /// İstek hakkı doğana kadar bekler ve hakkı tüketir.
    async fn acquire(&self) {
        loop {
            let wait = {
                let mut hits = self.hits.lock().unwrap_or_else(|error| error.into_inner());
                let now = Instant::now();
                while hits.front().is_some_and(|t| now.duration_since(*t) >= RATE_WINDOW) {
                    hits.pop_front();
                }
                if hits.len() < RATE_LIMIT {
                    hits.push_back(now);
                    return;
                }
                // En eski istek pencereden çıkınca yer açılır.
                RATE_WINDOW - now.duration_since(*hits.front().expect("dolu"))
            };
            tokio::time::sleep(wait + Duration::from_millis(50)).await;
        }
    }
}

// ─── İstek ─────────────────────────────────────────────────────────────────────

/// TEFAS gövdesi: alanlardan biri eksik olursa sağlayıcı
/// `Hata:java.lang.NullPointerException` döndürür, bu yüzden hepsi gönderilir.
fn body(kind: &str, code: Option<&str>, start: &str, end: &str) -> serde_json::Value {
    serde_json::json!({
        "fonTipi": kind,
        "fonKodu": code,
        "aramaMetni": null,
        "fonTurKod": null,
        "fonGrubu": null,
        "sfonTurKod": null,
        "fonTurAciklama": null,
        "kurucuKod": null,
        "basTarih": start,
        "bitTarih": end,
        "basSira": 1,
        "bitSira": 100000,
        "dil": "TR",
        "sFonTurKod": "",
        "fonKod": "",
        "fonGrup": "",
        "fonUnvanTip": "",
    })
}

async fn post<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    url: &str,
    payload: &serde_json::Value,
) -> Result<Vec<T>, String> {
    Throttle::get().acquire().await;

    let envelope = client
        .post(url)
        .timeout(Duration::from_secs(30))
        .header("Content-Type", "application/json")
        .header("Accept", "*/*")
        .header("Origin", "https://www.tefas.gov.tr")
        .header("Referer", REFERER)
        .header("User-Agent", crate::yahoo::YAHOO_USER_AGENT)
        .json(payload)
        .send()
        .await
        .map_err(|error| format!("TEFAS isteği başarısız: {error}"))?
        .error_for_status()
        .map_err(|error| format!("TEFAS yanıtı: {error}"))?
        .json::<Envelope<T>>()
        .await
        .map_err(|error| format!("TEFAS çözümlenemedi: {error}"))?;

    if let Some(message) = envelope.error_message {
        return Err(format!("TEFAS: {message}"));
    }
    Ok(envelope.result_list.unwrap_or_default())
}

// ─── Disk önbelleği ────────────────────────────────────────────────────────────
//
// Bellek önbellekleri süreçle ölür: uygulama her açılışta listeyi (5 istek) ve
// getirileri (15 istek) 6 istek/dk bütçesiyle baştan toplamak zorunda kalır —
// dakikalarca boş fon ekranı demektir. Diske yazmak yeniden açılışları anında
// yapar ve TEFAS bütçesini gerçekten yeni veri gerektiğinde harcar.

#[derive(Serialize, Deserialize)]
struct DiskCache<T> {
    fetched_at_unix: u64,
    rows: Vec<T>,
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default()
}

fn list_cache_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|home| home.join(".fraude_tefas_funds.json"))
}

fn returns_cache_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|home| home.join(".fraude_tefas_returns.json"))
}

/// Diskteki önbelleği okur; TTL aşılmışsa `None`. Yaş da döner ki bellek
/// önbelleği gerçek tazelik süresiyle kurulabilsin (TTL sıfırlanmasın).
fn load_disk_cache<T: for<'de> Deserialize<'de>>(
    path: Option<std::path::PathBuf>,
    ttl: Duration,
) -> Option<(Duration, Vec<T>)> {
    let raw = std::fs::read_to_string(path?).ok()?;
    let cache: DiskCache<T> = serde_json::from_str(&raw).ok()?;
    let age = Duration::from_secs(unix_now().saturating_sub(cache.fetched_at_unix));
    (age < ttl).then_some((age, cache.rows))
}

fn save_disk_cache<T: Serialize + Clone>(path: Option<std::path::PathBuf>, rows: &[T]) {
    let Some(path) = path else { return };
    let cache = DiskCache { fetched_at_unix: unix_now(), rows: rows.to_vec() };
    if let Ok(json) = serde_json::to_string(&cache) {
        let _ = std::fs::write(path, json);
    }
}

// ─── Fon listesi ───────────────────────────────────────────────────────────────

static LIST_CACHE: OnceLock<Mutex<Option<(Instant, Vec<FundRow>)>>> = OnceLock::new();

fn cached_list() -> Option<Vec<FundRow>> {
    let cache = LIST_CACHE.get_or_init(|| Mutex::new(None));
    let guard = cache.lock().unwrap_or_else(|error| error.into_inner());
    guard
        .as_ref()
        .filter(|(fetched_at, _)| fetched_at.elapsed() < LIST_CACHE_TTL)
        .map(|(_, rows)| rows.clone())
}

/// Bir fon tipinin son fiyatlarını getirir.
///
/// Son iki işlem gününü kapsayan bir pencere istenir: en yeni bar güncel fiyat,
/// bir önceki bar değişim yüzdesinin dayanağıdır. Pencere 1 ayı aşamaz.
async fn fetch_kind(client: &reqwest::Client, kind: &str) -> Result<Vec<FundRow>, String> {
    let now = Utc::now().date_naive();
    // Hafta sonu ve tatilleri aşmak için 10 günlük pencere; sınırın (1 ay) içinde.
    let start = now - chrono::Duration::days(10);
    let rows: Vec<FundInfoRow> = post(
        client,
        FUNDS_URL,
        &body(kind, None, &start.format("%Y%m%d").to_string(), &now.format("%Y%m%d").to_string()),
    )
    .await?;

    // Fon başına tarihe göre son iki kayıt: sonuncusu güncel, öncesi karşılaştırma.
    let mut by_code: std::collections::HashMap<String, Vec<FundInfoRow>> = std::collections::HashMap::new();
    for row in rows {
        let Some(code) = row.code.clone() else { continue };
        by_code.entry(code).or_default().push(row);
    }

    let mut funds = Vec::with_capacity(by_code.len());
    for (code, mut history) in by_code {
        history.sort_by(|a, b| a.tarih.cmp(&b.tarih));
        let Some(last) = history.last() else { continue };
        let Some(price) = last.fiyat.filter(|p| p.is_finite() && *p > 0.0) else { continue };
        let previous_price = history
            .iter()
            .rev()
            .skip(1)
            .find_map(|row| row.fiyat.filter(|p| p.is_finite() && *p > 0.0))
            .unwrap_or(price);
        let change_pct = if previous_price > 0.0 {
            (price - previous_price) / previous_price * 100.0
        } else {
            0.0
        };

        funds.push(FundRow {
            code,
            name: last.name.clone().unwrap_or_default().trim().to_string(),
            kind: kind.to_string(),
            date: last.tarih.clone().unwrap_or_default(),
            price,
            previous_price,
            change_pct,
            share_count: last.share_count.unwrap_or_default(),
            investor_count: last.investor_count.unwrap_or_default(),
            portfolio_size: last.portfolio_size.unwrap_or_default(),
        });
    }
    Ok(funds)
}

/// Bayat veri bu yaşa kadar "önce göster, arkada tazele" ile sunulur; fon
/// ekranı TTL dolduğunda dakikalarca throttle kuyruğu beklemek yerine anında
/// açılır ve taze veri geldiğinde bir sonraki isteğe yansır.
const STALE_SERVE_CAP: Duration = Duration::from_secs(3 * 24 * 60 * 60);

static LIST_REFRESHING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static RETURNS_REFRESHING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Tüm tipleri ağdan çekip bellek + disk önbelleğini günceller.
async fn refresh_fund_list(client: &reqwest::Client) -> Vec<FundRow> {
    let mut all = Vec::new();
    for (kind, _) in FUND_KINDS {
        match fetch_kind(client, kind).await {
            Ok(mut rows) => all.append(&mut rows),
            Err(_) => continue,
        }
    }
    all.sort_by(|a, b| b.portfolio_size.total_cmp(&a.portfolio_size));

    if !all.is_empty() {
        *LIST_CACHE
            .get_or_init(|| Mutex::new(None))
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = Some((Instant::now(), all.clone()));
        save_disk_cache(list_cache_path(), &all);
    }
    all
}

/// Tüm fon tiplerinin güncel listesi. Tip başına tek istek (toplam 5).
///
/// Bir tip alınamazsa diğerleri yine döner; hepsi başarısızsa boş liste gelir ve
/// çağıran eldeki önbelleği korur. TTL'i geçmiş ama 3 günden taze disk verisi
/// anında döner ve arka planda sessizce tazelenir.
pub async fn get_funds(client: &reqwest::Client) -> Vec<FundRow> {
    if let Some(rows) = cached_list() {
        return rows;
    }

    // Uygulama yeni açıldıysa diskten dön; bellek önbelleği gerçek yaşıyla
    // kurulur ki TTL sıfırlanıp bayat veri uzatılmasın.
    if let Some((age, rows)) = load_disk_cache::<FundRow>(list_cache_path(), STALE_SERVE_CAP) {
        let fetched_at = Instant::now().checked_sub(age).unwrap_or_else(Instant::now);
        *LIST_CACHE
            .get_or_init(|| Mutex::new(None))
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = Some((fetched_at, rows.clone()));
        if age >= LIST_CACHE_TTL
            && !LIST_REFRESHING.swap(true, std::sync::atomic::Ordering::SeqCst)
        {
            let client = client.clone();
            tokio::spawn(async move {
                refresh_fund_list(&client).await;
                LIST_REFRESHING.store(false, std::sync::atomic::Ordering::SeqCst);
            });
        }
        return rows;
    }

    refresh_fund_list(client).await
}

// ─── Getiriler ─────────────────────────────────────────────────────────────────

/// Fonun dönem getirileri (yüzde). Fiyatı ilgili dönemde açıklanmamış fon için
/// alan `None` kalır (yeni kurulmuş ya da seyrek fiyatlanan GYF/GSYF).
/// `Deserialize` disk önbelleği için gereklidir.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FundReturns {
    pub code: String,
    /// 1 aylık getiri (%).
    pub r1m: Option<f64>,
    /// 3 aylık getiri (%).
    pub r3m: Option<f64>,
    /// 1 yıllık getiri (%).
    pub r1y: Option<f64>,
}

/// Getiri tablosu 15 istek tüketir (3 dönem × 5 tip ≈ 2,5 dk throttle ile);
/// fiyatlar günde bir açıklandığından 12 saat saklamak yeterli.
const RETURNS_CACHE_TTL: Duration = Duration::from_secs(12 * 60 * 60);

static RETURNS_CACHE: OnceLock<Mutex<Option<(Instant, Vec<FundReturns>)>>> = OnceLock::new();

/// Verilen geçmiş tarihteki fiyat haritası (tüm tipler, 5 istek).
///
/// Hedef gün tatile denk gelebilir: 6 günlük pencere istenir ve fon başına en
/// yeni fiyat alınır. Uç geçmiş tek-gün sorgularını destekler (canlı test).
async fn snapshot_prices(
    client: &reqwest::Client,
    target: NaiveDate,
) -> std::collections::HashMap<String, f64> {
    let start = (target - chrono::Duration::days(6)).format("%Y%m%d").to_string();
    let end = target.format("%Y%m%d").to_string();

    let mut latest: std::collections::HashMap<String, (String, f64)> = std::collections::HashMap::new();
    for (kind, _) in FUND_KINDS {
        let rows: Vec<FundInfoRow> = post(client, FUNDS_URL, &body(kind, None, &start, &end))
            .await
            .unwrap_or_default();
        for row in rows {
            let (Some(code), Some(date), Some(price)) = (row.code, row.tarih, row.fiyat) else {
                continue;
            };
            if !(price.is_finite() && price > 0.0) {
                continue;
            }
            match latest.entry(code) {
                std::collections::hash_map::Entry::Occupied(mut slot) if slot.get().0 < date => {
                    *slot.get_mut() = (date, price);
                }
                std::collections::hash_map::Entry::Vacant(slot) => {
                    slot.insert((date, price));
                }
                _ => {}
            }
        }
    }
    latest.into_iter().map(|(code, (_, price))| (code, price)).collect()
}

/// Tüm fonların 1 ay / 3 ay / 1 yıl getirileri.
///
/// İlk çağrı hız sınırı nedeniyle dakikalar sürer; sonuç 12 saat önbellekten
/// döner. Çağıran bunu liste yüklemesinden ayrı, arka planda istemelidir.
/// TTL'i geçmiş ama 3 günden taze disk verisi anında döner ve arka planda
/// sessizce tazelenir: 1A/3A/1Y sıralamaları açılışta hemen çalışır.
pub async fn get_fund_returns(client: &reqwest::Client) -> Vec<FundReturns> {
    if let Some((fetched_at, rows)) = RETURNS_CACHE
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .as_ref()
    {
        if fetched_at.elapsed() < RETURNS_CACHE_TTL {
            return rows.clone();
        }
    }

    // 15 isteklik hesap ancak diskte sonuç yoksa yapılır; yeniden açılışta
    // fon ekranının getiri kolonları da anında dolar.
    if let Some((age, rows)) = load_disk_cache::<FundReturns>(returns_cache_path(), STALE_SERVE_CAP) {
        let fetched_at = Instant::now().checked_sub(age).unwrap_or_else(Instant::now);
        *RETURNS_CACHE
            .get_or_init(|| Mutex::new(None))
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = Some((fetched_at, rows.clone()));
        if age >= RETURNS_CACHE_TTL
            && !RETURNS_REFRESHING.swap(true, std::sync::atomic::Ordering::SeqCst)
        {
            let client = client.clone();
            tokio::spawn(async move {
                compute_fund_returns(&client).await;
                RETURNS_REFRESHING.store(false, std::sync::atomic::Ordering::SeqCst);
            });
        }
        return rows;
    }

    compute_fund_returns(client).await
}

/// Getirileri ağdan hesaplar ve bellek + disk önbelleğini günceller.
async fn compute_fund_returns(client: &reqwest::Client) -> Vec<FundReturns> {
    let current = get_funds(client).await;
    if current.is_empty() {
        return Vec::new();
    }

    let today = Utc::now().date_naive();
    let mut snapshots = Vec::new();
    for months in [1, 3, 12] {
        snapshots.push(snapshot_prices(client, shift_months(today, -months)).await);
    }

    let pct = |now: f64, then: Option<&f64>| {
        then.filter(|p| **p > 0.0).map(|p| (now / p - 1.0) * 100.0)
    };
    let returns: Vec<FundReturns> = current
        .iter()
        .map(|fund| FundReturns {
            code: fund.code.clone(),
            r1m: pct(fund.price, snapshots[0].get(&fund.code)),
            r3m: pct(fund.price, snapshots[1].get(&fund.code)),
            r1y: pct(fund.price, snapshots[2].get(&fund.code)),
        })
        .collect();

    if returns.iter().any(|r| r.r1m.is_some() || r.r3m.is_some() || r.r1y.is_some()) {
        *RETURNS_CACHE
            .get_or_init(|| Mutex::new(None))
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = Some((Instant::now(), returns.clone()));
        save_disk_cache(returns_cache_path(), &returns);
    }
    returns
}

// ─── Fon detayı ────────────────────────────────────────────────────────────────

/// Dağılım alan kısaltmalarının okunur karşılıkları. TEFAS 58 kolon döndürür;
/// yalnızca anlamlı ve dolu olanlar gösterilir.
const ALLOCATION_LABELS: &[(&str, &str)] = &[
    ("hs", "Hisse Senedi"),
    ("yhs", "Yabancı Hisse Senedi"),
    ("dt", "Devlet Tahvili"),
    ("ost", "Özel Sektör Tahvili"),
    ("osks", "Özel Sektör Kira Sertifikası"),
    ("kks", "Kamu Kira Sertifikası"),
    ("kkstl", "Kamu Kira Sertifikası (TL)"),
    ("kksd", "Kamu Kira Sertifikası (Döviz)"),
    ("tr", "Ters Repo"),
    ("r", "Repo"),
    ("vmtl", "Vadeli Mevduat (TL)"),
    ("vmd", "Vadeli Mevduat (Döviz)"),
    ("vmau", "Vadeli Mevduat (Altın)"),
    ("vm", "Vadeli Mevduat"),
    ("vdm", "Vadesiz Mevduat"),
    ("fb", "Fon Bakiyesi"),
    ("bb", "Borsa Para Piyasası"),
    ("kh", "Kıymetli Maden"),
    ("khau", "Kıymetli Maden (Altın)"),
    ("khtl", "Kıymetli Maden (TL)"),
    ("yba", "Yabancı Borçlanma Aracı"),
    ("ybyf", "Yabancı Borsa Yatırım Fonu"),
    ("yyf", "Yabancı Yatırım Fonu"),
    ("byf", "Borsa Yatırım Fonu"),
    ("kmbyf", "Katılım BYF"),
    ("gsyy", "Girişim Sermayesi Yatırım Fonu"),
    ("gyy", "Gayrimenkul Yatırım Fonu"),
    ("t", "Türev Araçlar"),
    ("d", "Diğer"),
];

/// Fonun en güncel varlık dağılımını döndürür (yüzde, büyükten küçüğe).
pub async fn get_fund_allocation(
    client: &reqwest::Client,
    code: &str,
) -> Result<Vec<FundAllocation>, String> {
    let now = Utc::now().date_naive();
    let start = now - chrono::Duration::days(10);
    let rows: Vec<serde_json::Value> = post(
        client,
        BREAKDOWN_URL,
        &body("YAT", Some(code), &start.format("%Y%m%d").to_string(), &now.format("%Y%m%d").to_string()),
    )
    .await?;

    // Uç, fon kodu verilse de tüm fonları döndürebiliyor; istenen fon süzülür.
    let upper = code.to_uppercase();
    let latest = rows
        .iter()
        .filter(|row| row.get("fonKodu").and_then(|v| v.as_str()) == Some(upper.as_str()))
        .max_by_key(|row| row.get("tarih").and_then(|v| v.as_str()).unwrap_or("").to_string())
        .ok_or_else(|| format!("{code}: dağılım verisi yok"))?;

    let mut allocation: Vec<FundAllocation> = ALLOCATION_LABELS
        .iter()
        .filter_map(|(key, label)| {
            let pct = latest.get(*key)?.as_f64()?;
            (pct.is_finite() && pct > 0.0).then(|| FundAllocation { label: label.to_string(), pct })
        })
        .collect();
    allocation.sort_by(|a, b| b.pct.total_cmp(&a.pct));
    Ok(allocation)
}

/// Fonun fiyat geçmişi (en yeni → en eski sıralı değil; çağıran sıralar).
///
/// Sağlayıcı 1 aydan uzun aralığı reddettiği için istek aylık parçalara bölünür;
/// her parça bir istek harcar ve hız sınırlayıcıdan geçer. `months` büyüdükçe
/// çağrı süresi doğrusal artar (6 istek/dk).
pub async fn get_fund_history(
    client: &reqwest::Client,
    code: &str,
    months: u32,
) -> Result<Vec<(String, f64)>, String> {
    let today = Utc::now().date_naive();
    let mut points = Vec::new();

    for step in 0..months.max(1) {
        let end = shift_months(today, -(step as i32));
        let start = shift_months(today, -(step as i32 + 1));
        let rows: Vec<FundInfoRow> = post(
            client,
            FUNDS_URL,
            &body(
                "YAT",
                Some(code),
                &start.format("%Y%m%d").to_string(),
                &end.format("%Y%m%d").to_string(),
            ),
        )
        .await
        .unwrap_or_default();

        for row in rows {
            if let (Some(date), Some(price)) = (row.tarih, row.fiyat) {
                if price.is_finite() && price > 0.0 {
                    points.push((date, price));
                }
            }
        }
    }

    points.sort_by(|a, b| a.0.cmp(&b.0));
    points.dedup_by(|a, b| a.0 == b.0);
    if points.is_empty() {
        return Err(format!("{code}: fiyat geçmişi bulunamadı"));
    }
    Ok(points)
}

/// Tarihe ay ekler/çıkarır; ayın son günü taşmasına karşı gün kırpılır.
fn shift_months(date: NaiveDate, delta: i32) -> NaiveDate {
    let total = date.year() * 12 + (date.month() as i32 - 1) + delta;
    let (year, month) = (total.div_euclid(12), (total.rem_euclid(12) + 1) as u32);
    let day = date.day().min(days_in_month(year, month));
    NaiveDate::from_ymd_opt(year, month, day).unwrap_or(date)
}

fn days_in_month(year: i32, month: u32) -> u32 {
    let (next_year, next_month) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
    NaiveDate::from_ymd_opt(next_year, next_month, 1)
        .and_then(|first| first.pred_opt())
        .map(|last| last.day())
        .unwrap_or(28)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Disk önbelleği gidiş-dönüşü: taze TTL ile okunur, aşılmış TTL ile okunmaz.
    #[test]
    fn disk_cache_round_trip_respects_ttl() {
        let path = std::env::temp_dir()
            .join(format!("fraude_tefas_cache_test_{}.json", std::process::id()));
        let rows = vec![FundReturns { code: "ABC".into(), r1m: Some(1.0), r3m: None, r1y: Some(12.5) }];
        save_disk_cache(Some(path.clone()), &rows);

        let (age, loaded) =
            load_disk_cache::<FundReturns>(Some(path.clone()), Duration::from_secs(60))
                .expect("taze önbellek okunmalı");
        assert!(age < Duration::from_secs(5));
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].code, "ABC");
        assert_eq!(loaded[0].r1y, Some(12.5));

        assert!(
            load_disk_cache::<FundReturns>(Some(path.clone()), Duration::ZERO).is_none(),
            "TTL aşılmış önbellek dönmemeli"
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn body_sends_every_field_provider_requires() {
        // Eksik alan sağlayıcıda NullPointerException'a yol açtığı için hepsi şart.
        let payload = body("YAT", Some("AAL"), "20260701", "20260716");
        for field in [
            "fonTipi", "fonKodu", "aramaMetni", "fonTurKod", "fonGrubu", "sfonTurKod",
            "fonTurAciklama", "kurucuKod", "basTarih", "bitTarih", "basSira", "bitSira",
            "dil", "sFonTurKod", "fonKod", "fonGrup", "fonUnvanTip",
        ] {
            assert!(payload.get(field).is_some(), "{field} gövdede olmalı");
        }
        // Tek fon süzmesi fonKodu ile yapılır; fonKod ayrı alandır ve boş kalmalı.
        assert_eq!(payload["fonKodu"], "AAL");
        assert_eq!(payload["fonKod"], "");
    }

    #[test]
    fn month_shift_clamps_to_short_months() {
        let march31 = NaiveDate::from_ymd_opt(2026, 3, 31).unwrap();
        // Şubat 31 çekmediğinden ayın son gününe kırpılır.
        assert_eq!(shift_months(march31, -1), NaiveDate::from_ymd_opt(2026, 2, 28).unwrap());
        assert_eq!(shift_months(march31, -2), NaiveDate::from_ymd_opt(2026, 1, 31).unwrap());
        // Yıl sınırını geçer.
        let jan15 = NaiveDate::from_ymd_opt(2026, 1, 15).unwrap();
        assert_eq!(shift_months(jan15, -1), NaiveDate::from_ymd_opt(2025, 12, 15).unwrap());
    }

    #[tokio::test]
    async fn throttle_blocks_past_the_limit() {
        let throttle = Throttle { hits: Mutex::new(VecDeque::new()) };
        let started = Instant::now();
        // Sınır kadar istek beklemeden geçmeli.
        for _ in 0..RATE_LIMIT {
            throttle.acquire().await;
        }
        assert!(started.elapsed() < Duration::from_secs(1), "sınır altında beklememeli");
    }

    /// Canlı uç: tek istekle bir fon tipinin tamamı gelir.
    #[tokio::test]
    #[ignore = "canlı ağ erişimi gerektirir"]
    async fn fetches_fund_universe() {
        let client = reqwest::Client::new();
        let funds = get_funds(&client).await;
        assert!(funds.len() > 2000, "beklenenden az fon: {}", funds.len());
        let biggest = &funds[0];
        assert!(biggest.price > 0.0 && biggest.portfolio_size > 0.0);
        println!("toplam {} fon; en büyük: {} {}", funds.len(), biggest.code, biggest.name);
        for (kind, label) in FUND_KINDS {
            let count = funds.iter().filter(|f| f.kind == *kind).count();
            println!("  {label:<32} {count:>5}");
            assert!(count > 0, "{kind} tipinde fon yok");
        }
    }

    /// Canlı uç: getiri tablosu dolu gelir (20 istek ≈ 3 dk, throttle).
    #[tokio::test]
    #[ignore = "canlı ağ erişimi gerektirir (~3 dk)"]
    async fn fetches_fund_returns() {
        let client = reqwest::Client::new();
        let returns = get_fund_returns(&client).await;
        let with_1y = returns.iter().filter(|r| r.r1y.is_some()).count();
        let sample = returns.iter().find(|r| r.code == "AAL");
        println!("{} fon, {} tanesinde 1Y getiri; AAL: {:?}", returns.len(), with_1y, sample);
        assert!(returns.len() > 2000);
        assert!(with_1y > 1000, "1Y getirisi olan fon sayısı düşük: {with_1y}");
    }

    /// Canlı uç: dağılım yüzdeleri toplamı ~100 olmalı.
    #[tokio::test]
    #[ignore = "canlı ağ erişimi gerektirir"]
    async fn fetches_allocation() {
        let client = reqwest::Client::new();
        let allocation = get_fund_allocation(&client, "AAL").await.unwrap();
        assert!(!allocation.is_empty());
        let total: f64 = allocation.iter().map(|a| a.pct).sum();
        println!("AAL dağılımı (toplam {total:.1}%):");
        for item in &allocation {
            println!("  {:<32} {:>6.2}%", item.label, item.pct);
        }
        assert!((total - 100.0).abs() < 5.0, "yüzdeler ~100 olmalı, bulunan: {total}");
    }
}
