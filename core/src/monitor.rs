//! Model portföy / izleme listesi için KAP izleme motoru.
//!
//! Kullanıcının takip listesindeki hisselerin KAP bildirimleri periyodik
//! olarak çekilir; daha önce görülmemiş bildirimler başlık parmak izine göre
//! ayıklanır, ortaklık / iş ilişkisi / sermaye olaylarına sınıflandırılır ve
//! önemli olanlar bir yapay zeka ajanına yorumlatılır. Sonuç, uyarı olarak
//! saklanır; arka plan döngüsü ayrıca uygulamaya olay ve işletim sistemi
//! bildirimi gönderir. Böylece "ortak pay sattı" gibi gelişmeler erken görülür.
//!
//! İlk taramada (baseline) mevcut 90 günlük geçmiş yalnızca "görüldü" olarak
//! işaretlenir, uyarı üretilmez; yalnızca sonradan çıkan yeni bildirimler
//! uyarıya dönüşür.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

/// Uyarı üretilen KAP olay türleri. UI renk/rozet için string olarak taşınır.
pub const EVENT_OWNERSHIP: &str = "ownership";
pub const EVENT_BUSINESS: &str = "business";
pub const EVENT_CAPITAL: &str = "capital";
pub const EVENT_OTHER: &str = "other";

/// Materyal olay eşiği: ortaklık (8-9), iş ilişkisi (7) ve sermaye (6)
/// olayları bu eşiğin üstündedir. Yalnızca materyal olaylar uyarıya çevrilir,
/// yapay zekaya yorumlatılır ve okunmamış rozetinde sayılır. Rutin "diğer"
/// bildirimler (şiddet 3) radarı ve rozeti gürültüye boğmasın diye elenir;
/// tam KAP akışı için ayrı "KAP Feed" sekmesi vardır.
pub const MATERIAL_SEVERITY: u8 = 6;
/// Saklanan en fazla uyarı sayısı (en yeni başta).
const MAX_ALERTS: usize = 200;
pub const DEFAULT_INTERVAL_SECS: u64 = 20 * 60;
const MIN_INTERVAL_SECS: u64 = 5 * 60;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MonitorConfig {
    pub enabled: bool,
    pub interval_secs: u64,
    /// Yorumu yapacak ajan (anahtar + kişilik). Boşsa varsayılan AI anahtarı kullanılır.
    #[serde(default)]
    pub agent_id: Option<String>,
    /// Uygulama-içi bildirime ek olarak işletim sistemi bildirimi gönderilsin mi.
    #[serde(default = "default_true")]
    pub os_notifications: bool,
    /// Frontend takip listesinden senkronlanan izlenecek hisse kodları.
    #[serde(default)]
    pub tickers: Vec<String>,
}

fn default_true() -> bool {
    true
}

impl Default for MonitorConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            interval_secs: DEFAULT_INTERVAL_SECS,
            agent_id: None,
            os_notifications: true,
            tickers: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MonitorAlert {
    pub id: String,
    pub ticker: String,
    pub company: Option<String>,
    pub title: String,
    pub url: String,
    pub date: String,
    pub category: String,
    /// "ownership" | "business" | "capital" | "other"
    pub event_type: String,
    pub severity: u8,
    pub ai_comment: Option<String>,
    pub created_at: String,
    pub read: bool,
}

/// Kalıcı izleme durumu; `.fraude_monitor.json` dosyasına yazılır.
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct MonitorRuntime {
    #[serde(default)]
    pub config: MonitorConfig,
    /// Görülen bildirimlerin kararlı parmak izleri (ticker + normalize başlık).
    #[serde(default)]
    pub seen_keys: HashSet<String>,
    /// İlk taraması (baseline) tamamlanmış hisseler.
    #[serde(default)]
    pub baselined: HashSet<String>,
    #[serde(default)]
    pub alerts: Vec<MonitorAlert>,
    #[serde(default)]
    pub last_run: Option<String>,
    /// Ticker → ortaklık yapısının en son karşılaştırıldığı tarih (YYYY-MM-DD).
    /// İş Yatırım'ı günde bir kereden fazla yormamak için gate olarak kullanılır.
    #[serde(default)]
    pub shareholder_checked: std::collections::HashMap<String, String>,
}

impl MonitorRuntime {
    /// Okunmamış materyal uyarı sayısı. Rozet yalnızca ortaklık/iş ilişkisi/
    /// sermaye olaylarını sayar; eski kayıtlardaki "diğer" uyarılar (varsa)
    /// rozeti şişirmesin diye eşiğin altındakiler hariç tutulur.
    pub fn unread_count(&self) -> usize {
        self.alerts
            .iter()
            .filter(|a| !a.read && a.severity >= MATERIAL_SEVERITY)
            .count()
    }

    /// Frontend'e gönderilecek yalın görünüm (iç diff kümeleri hariç).
    pub fn view(&self) -> MonitorStateView {
        MonitorStateView {
            config: self.config.clone(),
            alerts: self.alerts.clone(),
            last_run: self.last_run.clone(),
            unread: self.unread_count(),
            baselined: self.baselined.iter().cloned().collect(),
        }
    }
}

/// Arayüze taşınan izleme durumu.
#[derive(Clone, Debug, Serialize)]
pub struct MonitorStateView {
    pub config: MonitorConfig,
    pub alerts: Vec<MonitorAlert>,
    pub last_run: Option<String>,
    pub unread: usize,
    /// İlk taraması tamamlanmış hisseler (arayüzde "izleniyor" göstergesi için).
    pub baselined: Vec<String>,
}

fn file_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|home| home.join(".fraude_monitor.json"))
}

pub fn load() -> MonitorRuntime {
    file_path()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|data| serde_json::from_str(&data).ok())
        .unwrap_or_default()
}

pub fn save(runtime: &MonitorRuntime) {
    if let Some(path) = file_path() {
        let _ = crate::persist::write_json_atomic(&path, runtime);
    }
}

/// Başlık bazlı kararlı parmak izi. KAP kimliği indeks tabanlı olduğundan
/// (her çekmede değişebilir) diff için başlık normalize edilir.
fn stable_key(ticker: &str, title: &str) -> String {
    let normalized: String = title
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect();
    format!("{}::{}", ticker.to_uppercase(), normalized)
}

/// Bildirim başlığından olay türü ve şiddet (1-10) çıkarır.
pub fn classify(title: &str) -> (&'static str, u8) {
    let lower = title.to_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|n| lower.contains(n));

    // Ortaklık yapısı değişimi — en yüksek öncelik (ortak pay alım/satımı).
    if has(&[
        "pay satış", "pay satis", "pay alım", "pay alim", "pay devri", "hisse devri",
        "pay geri alım", "pay geri alim", "geri alım programı", "ortaklık yapısı",
        "ortaklik yapisi", "hakim ortak", "hâkim ortak", "yönetim kontrol", "kontrol değişik",
        "blok satış", "blok satis", "çağrı", "cagri", "önemli nitelikte", "onemli nitelikte",
        "pay sahipliği", "azınlık pay", "bedelli olmayan pay",
    ]) {
        // "geri alım" şirketin kendi payını alması; yine de önemli ama bir tık düşük.
        let severity = if has(&["pay satış", "pay satis", "blok satış", "blok satis", "hakim ortak", "hâkim ortak", "kontrol değişik", "çağrı", "cagri"]) {
            9
        } else {
            8
        };
        return (EVENT_OWNERSHIP, severity);
    }

    // Yeni iş ilişkisi — sözleşme, ihale, satın alma, ortak girişim.
    if has(&[
        "sözleşme", "sozlesme", "ihale", "iş birliği", "işbirliği", "is birligi",
        "protokol", "anlaşma", "anlasma", "satın alma", "satin alma", "devralma",
        "birleşme", "birlesme", "ortak girişim", "ortak girisim", "iştirak",
        "istirak", "yeni şirket", "şirket kuruluş", "sirket kurulus", "mutabakat",
        "niyet mektubu", "bayilik", "distribütör", "lisans anlaş", "tedarik sözleş",
    ]) {
        return (EVENT_BUSINESS, 7);
    }

    // Sermaye / kâr payı olayları.
    if has(&[
        "sermaye artırım", "sermaye artirim", "bedelsiz", "bedelli", "temettü",
        "temettu", "kar payı", "kâr payı", "kar payi", "tahvil", "bono ihra",
    ]) {
        return (EVENT_CAPITAL, 6);
    }

    (EVENT_OTHER, 3)
}

fn now_iso() -> String {
    chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%.3f%:z").to_string()
}

/// Tek bir uyarıyı yapay zekaya yorumlatır: ne oldu, olası etki, dikkat edilecek nokta.
async fn interpret_alert(
    client: &reqwest::Client,
    key: &crate::domain::StoredAiKey,
    agent: Option<&crate::domain::AiAgent>,
    alert: &MonitorAlert,
    extra_context: &str,
) -> Result<String, String> {
    let persona = match agent {
        Some(a) => format!("Sen '{}' adlı yatırım analistisin. Görevin: {}", a.name, a.role_description),
        None => "Sen deneyimli bir Türkiye borsası (BIST) yatırım analistisin.".to_string(),
    };
    let system_prompt = format!(
        "{persona}\n\nSana bir hisseyle ilgili YENİ bir gelişme verilecek (KAP bildirimi ya da ortaklık yapısındaki pay değişimi). Kısa ve net Türkçe yaz (en fazla 3 cümle): (1) özünde ne olduğu, (2) ortaklık yapısı veya iş ilişkisi açısından olası etkisi, (3) yatırımcının dikkat etmesi gereken nokta. Abartma, spekülasyon yapma, veriye dayan. Sonuna kısa bir '⚠ Tavsiye değildir.' notu ekle."
    );
    let user_prompt = format!(
        "Hisse: {} ({})\nOlay türü: {}\nKaynak: {}\nGelişme: {}\nTarih: {}\n{}\n\nBu gelişmeyi yukarıdaki formatta yorumla.",
        alert.ticker,
        alert.company.as_deref().unwrap_or("—"),
        event_label(&alert.event_type),
        alert.category,
        alert.title,
        alert.date,
        extra_context,
    );
    crate::services::run_completion(client, key, &system_prompt, &user_prompt).await
}

pub fn event_label(event_type: &str) -> &'static str {
    match event_type {
        EVENT_OWNERSHIP => "Ortaklık yapısı / pay değişimi",
        EVENT_BUSINESS => "Yeni iş ilişkisi",
        EVENT_CAPITAL => "Sermaye / kâr payı",
        _ => "Diğer",
    }
}

/// İzleme durumu için gereken anlık görüntü; kilit kısa tutulur.
struct CycleInputs {
    tickers: Vec<String>,
    agent: Option<crate::domain::AiAgent>,
    key: Option<crate::domain::StoredAiKey>,
    equities: Vec<crate::domain::EquityRow>,
    seen: HashSet<String>,
    baselined: HashSet<String>,
    shareholder_checked: std::collections::HashMap<String, String>,
}

/// Bir izleme turu çalıştırır: yeni KAP olaylarını bulur, sınıflar, yorumlar,
/// kalıcı duruma yazar ve üretilen yeni uyarıları döndürür.
pub async fn run_cycle(state: &crate::AppState) -> Vec<MonitorAlert> {
    // Tur boyu tutulan guard: eşzamanlı turlar (arka plan döngüsü + elle
    // "Şimdi Tara") seri çalışır, böylece ikinci tur birincinin yazdığı
    // güncel `seen` kümesini görür; mükerrer uyarı ve kayıp işaret olmaz.
    let _cycle_guard = state.monitor_cycle_lock.lock().await;

    let inputs = {
        let runtime = state.monitor.lock().await;
        if !runtime.config.enabled || runtime.config.tickers.is_empty() {
            return Vec::new();
        }
        let store = state.store.lock().await;
        let agent = runtime
            .config
            .agent_id
            .as_ref()
            .and_then(|id| store.agents.iter().find(|a| &a.id == id).cloned());
        // Anahtar seçimi run_agent_analysis ile aynı sırayı izler.
        let key = agent
            .as_ref()
            .and_then(|a| store.ai_keys.iter().find(|k| k.id == a.api_key_id && k.enabled).cloned())
            .or_else(|| store.ai_keys.iter().find(|k| k.is_default && k.enabled).cloned())
            .or_else(|| store.ai_keys.iter().find(|k| k.enabled).cloned());
        CycleInputs {
            tickers: runtime.config.tickers.clone(),
            agent,
            key,
            equities: store.equities.clone(),
            seen: runtime.seen_keys.clone(),
            baselined: runtime.baselined.clone(),
            shareholder_checked: runtime.shareholder_checked.clone(),
        }
    };

    let mut seen = inputs.seen;
    let mut baselined = inputs.baselined;
    let mut shareholder_checked = inputs.shareholder_checked;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut new_alerts: Vec<MonitorAlert> = Vec::new();

    for ticker in &inputs.tickers {
        let ticker = ticker.trim().to_uppercase();
        if ticker.is_empty() {
            continue;
        }
        let company = inputs
            .equities
            .iter()
            .find(|e| e.ticker == ticker)
            .map(|e| e.name.clone());
        let disclosures =
            match crate::services::fetch_kap_disclosures(&state.http, &ticker, company.as_deref()).await {
                Ok(items) => items,
                Err(_) => continue, // geçici hata: bu turu atla, baseline bozma
            };
        let is_baseline = !baselined.contains(&ticker);

        for item in disclosures {
            let key_str = stable_key(&ticker, &item.title);
            if !seen.insert(key_str) {
                continue; // zaten görülmüş
            }
            if is_baseline {
                continue; // ilk tarama: yalnızca tohumla, uyarı üretme
            }
            let (event_type, severity) = classify(&item.title);
            // Rutin "diğer" bildirimler görüldü işaretlenir ama radara alınmaz;
            // aksi halde faaliyet raporu vb. gürültü materyal uyarıları
            // (MAX_ALERTS sınırında) dışarı iter ve rozeti şişirir.
            if severity < MATERIAL_SEVERITY {
                continue;
            }
            new_alerts.push(MonitorAlert {
                id: format!(
                    "mon-{}-{}",
                    ticker,
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_micros())
                        .unwrap_or(0)
                ),
                ticker: ticker.clone(),
                company: company.clone(),
                title: item.title,
                url: item.url,
                date: item.date,
                category: item.category,
                event_type: event_type.to_string(),
                severity,
                ai_comment: None,
                created_at: now_iso(),
                read: false,
            });
        }

        // Ortaklık yapısı diff'i: İş Yatırım'dan payları yeniden çek, önceki
        // snapshot ile karşılaştır. KAP başlığına değil, kesin yüzde değişimine
        // dayandığından "ortak pay sattı" gibi olayları daha güvenilir yakalar.
        // İş Yatırım'ı yormamak için ticker başına günde bir kez çalışır.
        if shareholder_checked.get(&ticker).map(String::as_str) != Some(today.as_str()) {
            match crate::shareholders::refresh_and_diff(&state.http, &ticker).await {
                Ok((snapshot, changes)) => {
                    // İlk tarama yalnızca tohumlar (KAP ile aynı mantık); eski
                    // önbelleğe karşı gecikmiş sahte uyarı üretmemek için.
                    if !is_baseline {
                        for (index, change) in changes.iter().enumerate() {
                            let title = match (change.prev_pct, change.new_pct) {
                                (Some(prev), Some(new)) => format!(
                                    "Ortaklık değişimi: {} %{:.2} → %{:.2} ({:+.2} puan)",
                                    change.name, prev, new, change.delta
                                ),
                                (Some(prev), None) => {
                                    format!("Ortaklıktan çıkış: {} (önceki %{:.2})", change.name, prev)
                                }
                                (None, Some(new)) => {
                                    format!("Yeni ortak: {} (%{:.2})", change.name, new)
                                }
                                (None, None) => continue,
                            };
                            new_alerts.push(MonitorAlert {
                                id: format!(
                                    "mon-shr-{}-{}-{}",
                                    ticker,
                                    std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .map(|d| d.as_micros())
                                        .unwrap_or(0),
                                    index
                                ),
                                ticker: ticker.clone(),
                                company: company.clone(),
                                title,
                                url: crate::shareholders::card_url(&ticker),
                                date: snapshot.as_of.clone(),
                                category: "Ortaklık Yapısı Değişimi · İş Yatırım".to_string(),
                                event_type: EVENT_OWNERSHIP.to_string(),
                                severity: 9,
                                ai_comment: None,
                                created_at: now_iso(),
                                read: false,
                            });
                        }
                    }
                    shareholder_checked.insert(ticker.clone(), today.clone());
                }
                // İş Yatırım erişilemedi: bugün tekrar denensin diye işaretleme.
                Err(_) => {}
            }
        }

        baselined.insert(ticker.clone());
    }

    // Önemli (ortaklık / iş ilişkisi) uyarılarını yapay zekaya yorumlat.
    if let Some(key) = inputs.key.as_ref() {
        for alert in new_alerts.iter_mut() {
            if alert.severity < MATERIAL_SEVERITY {
                continue;
            }
            let extra = if alert.event_type == EVENT_OWNERSHIP {
                "Not: Bu bir ortaklık/pay değişimi bildirimidir; kimin kime pay sattığını ve oranı vurgula."
            } else {
                ""
            };
            match interpret_alert(&state.http, key, inputs.agent.as_ref(), alert, extra).await {
                Ok(comment) => alert.ai_comment = Some(comment.trim().to_string()),
                Err(_) => {} // yorum başarısızsa uyarı yine de kalır
            }
        }
    }

    // Kalıcı duruma yaz: yeni uyarılar başa eklenir.
    {
        let mut runtime = state.monitor.lock().await;
        runtime.seen_keys = seen;
        runtime.baselined = baselined;
        runtime.shareholder_checked = shareholder_checked;
        for alert in new_alerts.iter().rev() {
            runtime.alerts.insert(0, alert.clone());
        }
        if runtime.alerts.len() > MAX_ALERTS {
            runtime.alerts.truncate(MAX_ALERTS);
        }
        runtime.last_run = Some(now_iso());
        save(&runtime);
    }

    new_alerts
}

/// Kullanıcının girdiği aralığı güvenli alt sınıra çeker.
pub fn clamp_interval(secs: u64) -> u64 {
    secs.max(MIN_INTERVAL_SECS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_ownership_share_sale_highest() {
        let (kind, sev) = classify("Ortağımız X A.Ş. Pay Satışı Hakkında Bildirim");
        assert_eq!(kind, EVENT_OWNERSHIP);
        assert_eq!(sev, 9);
    }

    #[test]
    fn classifies_buyback_as_ownership() {
        let (kind, sev) = classify("Pay Geri Alım Programı Kapsamında İşlemler");
        assert_eq!(kind, EVENT_OWNERSHIP);
        assert!(sev >= 8);
    }

    #[test]
    fn classifies_new_contract_as_business() {
        let (kind, sev) = classify("Yeni Sözleşme İmzalanması Hakkında");
        assert_eq!(kind, EVENT_BUSINESS);
        assert_eq!(sev, 7);
    }

    #[test]
    fn classifies_capital_increase() {
        let (kind, _) = classify("Bedelsiz Sermaye Artırımı Başvurusu");
        assert_eq!(kind, EVENT_CAPITAL);
    }

    #[test]
    fn classifies_unrelated_as_other() {
        let (kind, sev) = classify("Haziran 2026 Trafik Sonuçları");
        assert_eq!(kind, EVENT_OTHER);
        assert!(sev < MATERIAL_SEVERITY);
    }

    #[test]
    fn stable_key_ignores_punctuation_and_case() {
        assert_eq!(
            stable_key("asels", "Pay Satışı: Hakkında!"),
            stable_key("ASELS", "pay satışı hakkında")
        );
    }

    #[test]
    fn interval_is_clamped_to_minimum() {
        assert_eq!(clamp_interval(10), MIN_INTERVAL_SECS);
        assert_eq!(clamp_interval(3600), 3600);
    }
}
