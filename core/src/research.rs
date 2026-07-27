//! Araştırma işleri: agent takımıyla hisse araştırması ve serbest (custom)
//! araştırma görevleri. Bu modül Tauri'den bağımsızdır — arka plan worker'ı
//! (src-tauri) ve localhost köprüsü buradaki tipleri ve orkestrasyonu kullanır.
//!
//! İki besleme yolu vardır:
//!   1. Uygulamadan hisse araştırması: sabit roller (temel/KAP-haber/teknik/
//!      ortaklık) kullanıcının ajanlarına atanır, paralel çalışır, lider ajan
//!      tek rapora sentezler.
//!   2. Chrome eklentisinden serbest görev: metin / URL / görsel boştaki bir
//!      ajana atanır.

use serde::{Deserialize, Serialize};

use crate::domain::{AiAgent, EquityRow, StoredAiKey};

/// Diskte tutulan en fazla iş sayısı (en yeni önde). Eski işler kırpılır.
pub const MAX_RESEARCH_JOBS: usize = 100;

/// Bağlam maliyetini sınırlamak için bir URL'den alınacak azami metin.
const MAX_URL_TEXT: usize = 12_000;

const BROWSER_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum JobSource {
    App,
    Extension,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum JobKind {
    TickerTeam,
    Custom,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Queued,
    Running,
    Done,
    Error,
}

/// Bir işin girdisi. Team işlerinde yalnız `ticker` dolu olur; custom işlerde
/// `prompt`/`url`/`image_data_url` kombinasyonu gelir.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct JobInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// `data:image/...;base64,...` biçiminde tam veri-URL. Diskte yer kaplamasın
    /// diye iş tamamlanınca worker tarafından temizlenir.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_data_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ticker: Option<String>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum RoleKind {
    Fundamental,
    KapNews,
    Technical,
    Ownership,
}

impl RoleKind {
    pub fn all() -> [RoleKind; 4] {
        [
            RoleKind::Fundamental,
            RoleKind::KapNews,
            RoleKind::Technical,
            RoleKind::Ownership,
        ]
    }

    /// Rol başlığı (rapor bölüm başlığı olarak da kullanılır).
    pub fn title_tr(&self) -> &'static str {
        match self {
            RoleKind::Fundamental => "Temel Analiz",
            RoleKind::KapNews => "KAP & Haber Taraması",
            RoleKind::Technical => "Teknik Görünüm",
            RoleKind::Ownership => "Ortaklık Yapısı",
        }
    }

    /// Role özel sabit sistem promptu. Rolün ne yapacağını belirler; hangi
    /// ajan/sağlayıcının kullanılacağı team eşlemesinden gelir.
    fn system_prompt(&self, ticker: &str) -> String {
        let common = "Türkçe, kısa ve maddeli yaz. Yalnızca sana verilen verilere dayan; \
                      veri yoksa 'veri bulunamadı' de, tahmin uydurma. Bu çıktı yatırım tavsiyesi değildir.";
        match self {
            RoleKind::Fundamental => format!(
                "Sen bir BIST temel analiz uzmanısın. {ticker} için değerleme (F/K, PD/DD), \
                 kârlılık (ROE/ROA, marjlar), büyüme ve borçluluk göstergelerini yorumla; \
                 güçlü ve zayıf yönleri belirt. {common}"
            ),
            RoleKind::KapNews => format!(
                "Sen bir BIST KAP bildirim ve haber analistisin. {ticker} için son KAP \
                 bildirimlerini ve haberleri tara; önemli (materyal) gelişmeleri, olası \
                 fiyat etkisini ve dikkat edilecek noktaları çıkar. {common}"
            ),
            RoleKind::Technical => format!(
                "Sen bir BIST teknik analiz uzmanısın. {ticker} için trend, momentum \
                 (RSI, MACD), hareketli ortalamalara göre konum, 52 hafta bandı ve volatilite \
                 (ATR) üzerinden kısa bir teknik görünüm çıkar. {common}"
            ),
            RoleKind::Ownership => format!(
                "Sen bir ortaklık yapısı ve iştirak analistisisin. {ticker} için ana ortakları, \
                 halka açıklık ve yabancı takas oranını, bağlı ortaklık/iştirakleri yorumla; \
                 yoğunlaşma ve kontrol yapısına dikkat çek. {common}"
            ),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TeamRole {
    pub role: RoleKind,
    /// Bu role atanan ajan; None ise varsayılan AI anahtarı kullanılır.
    #[serde(default)]
    pub agent_id: Option<String>,
}

/// Tek global takım yapılandırması (kullanıcı düzenler). Roller sabittir;
/// yalnız hangi ajanın hangi rolü üstleneceği değişir.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TeamConfig {
    pub roles: Vec<TeamRole>,
    /// Sentez/lider ajan; None ise varsayılan AI anahtarı sentezler.
    #[serde(default)]
    pub lead_agent_id: Option<String>,
}

impl Default for TeamConfig {
    fn default() -> Self {
        TeamConfig {
            roles: RoleKind::all()
                .into_iter()
                .map(|role| TeamRole { role, agent_id: None })
                .collect(),
            lead_agent_id: None,
        }
    }
}

impl TeamConfig {
    /// Eksik rolleri tamamlar (ileride yeni rol eklenirse config bozulmasın).
    pub fn normalized(mut self) -> Self {
        for role in RoleKind::all() {
            if !self.roles.iter().any(|r| r.role == role) {
                self.roles.push(TeamRole { role, agent_id: None });
            }
        }
        self
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ResearchJob {
    pub id: String,
    pub source: JobSource,
    pub kind: JobKind,
    pub input: JobInput,
    /// custom işlerde atanan tek ajan; team işlerinde None.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    /// team işlerinde oluşturma anındaki rol→ajan snapshot'ı.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team: Option<TeamConfig>,
    /// İnsan-okur başlık (liste ve artifact başlığı).
    pub title: String,
    pub status: JobStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub report: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artifact_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// ISO 8601 oluşturma zamanı.
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
    /// Her durum değişiminde güncellenen epoch-ms; köprünün `since` filtresi
    /// ve sıralama için kullanılır.
    #[serde(default)]
    pub updated_at_ms: i64,
    /// Uygulama içi bildirim gönderildi mi.
    #[serde(default)]
    pub notified_app: bool,
    /// Chrome eklentisine teslim edildi mi.
    #[serde(default)]
    pub notified_ext: bool,
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

/// Aynı milisaniyede birden çok iş oluşursa ID çakışmasın diye artan sayaç.
static JOB_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn next_job_id() -> String {
    let seq = JOB_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("job-{}-{}", now_ms(), seq)
}

pub fn iso_now() -> String {
    chrono::Local::now()
        .format("%Y-%m-%dT%H:%M:%S%.3f%:z")
        .to_string()
}

/// Yeni bir iş kaydı iskeleti (durum: Queued). ID zaman damgası tabanlıdır.
pub fn new_job(source: JobSource, kind: JobKind, input: JobInput, title: String) -> ResearchJob {
    ResearchJob {
        id: next_job_id(),
        source,
        kind,
        input,
        agent_id: None,
        team: None,
        title,
        status: JobStatus::Queued,
        report: None,
        artifact_id: None,
        error: None,
        created_at: iso_now(),
        started_at: None,
        finished_at: None,
        updated_at_ms: now_ms(),
        notified_app: false,
        notified_ext: false,
    }
}

// ---------------------------------------------------------------------------
// Anahtar çözümleme (merkezî)
// ---------------------------------------------------------------------------

/// Bir ajana (veya None ise varsayılana) karşılık gelen kullanılabilir AI
/// anahtarını çözer. Sıra: ajanın anahtarı → varsayılan etkin → herhangi etkin.
/// Sır anahtarlıktan `run_completion` içinde lazy çözülür.
pub fn resolve_key_for_agent(
    ai_keys: &[StoredAiKey],
    agent_api_key_id: Option<&str>,
) -> Option<StoredAiKey> {
    agent_api_key_id
        .and_then(|id| ai_keys.iter().find(|k| k.id == id && k.enabled))
        .or_else(|| ai_keys.iter().find(|k| k.is_default && k.enabled))
        .or_else(|| ai_keys.iter().find(|k| k.enabled))
        .cloned()
}

// ---------------------------------------------------------------------------
// Orkestrasyon: sonuç tipi
// ---------------------------------------------------------------------------

pub struct ResearchOutcome {
    /// Markdown rapor.
    pub report: String,
    /// Artifact başlığı için insan-okur etiket.
    pub title: String,
}

// ---------------------------------------------------------------------------
// Team araştırması
// ---------------------------------------------------------------------------

/// Hisseye özel sayısal bağlam (temel + teknik) satırı. gather_agent_context'in
/// KAP/haber metnini tamamlar.
fn equity_facts(equities: &[EquityRow], ticker: &str) -> String {
    let Some(eq) = equities.iter().find(|e| e.ticker == ticker) else {
        return format!("{ticker}: kart verisi bulunamadı.\n");
    };
    let opt = |v: Option<f64>, unit: &str| -> String {
        v.map(|x| format!("{x:.2}{unit}")).unwrap_or_else(|| "-".into())
    };
    format!(
        "Şirket: {name}\nFiyat: {price:.2} TL (gün {chg:+.2}%) · 1h {w} · 1a {m} · 1y {y}\n\
         Teknik: RSI {rsi:.0} · MACD {macd:.2} · SMA50 {sma:.2} · EMA20 {ema:.2} · Bollinger {boll} · ATR {atr:.2} · 52H {hi:.2}/{lo:.2}\n\
         Temel: F/K {pe} · PD/DD {pb} · ROE {roe} · ROA {roa} · NetBorç/FAVÖK {nde} · BrütMarj {gm} · NetMarj {nm} · SatışBüy {sg} · KârBüy {pg} · Temettü {dy} · PiyasaDeğeri {mc}\n\
         Ortaklık: Halka açıklık {ff} · Yabancı takas {fr} · Endeksler: {idx}\n",
        name = eq.name,
        price = eq.price,
        chg = eq.change_pct,
        w = opt(eq.change_1w, "%"),
        m = opt(eq.change_1m, "%"),
        y = opt(eq.change_1y, "%"),
        rsi = eq.rsi,
        macd = eq.macd,
        sma = eq.sma_50,
        ema = eq.ema_20,
        boll = eq.bollinger_position,
        atr = eq.atr,
        hi = eq.week_52_high,
        lo = eq.week_52_low,
        pe = opt(eq.pe, ""),
        pb = opt(eq.pb, ""),
        roe = opt(eq.roe, "%"),
        roa = opt(eq.roa, "%"),
        nde = opt(eq.net_debt_ebitda, ""),
        gm = opt(eq.gross_margin, "%"),
        nm = opt(eq.net_margin, "%"),
        sg = opt(eq.sales_growth, "%"),
        pg = opt(eq.profit_growth, "%"),
        dy = opt(eq.dividend_yield, "%"),
        mc = opt(eq.market_cap, ""),
        ff = opt(eq.free_float_ratio, "%"),
        fr = opt(eq.foreign_ratio, "%"),
        idx = if eq.index_memberships.is_empty() { "-".to_string() } else { eq.index_memberships.join(", ") },
    )
}

/// Ortaklık rolü için ana ortak + iştirak bağlamını ağdan toplar (kilitsiz).
async fn ownership_context(client: &reqwest::Client, ticker: &str) -> String {
    let mut out = String::new();
    match crate::shareholders::get_shareholders(client, ticker, false).await {
        Ok(snap) if !snap.holders.is_empty() => {
            out.push_str(&format!("\n[ANA ORTAKLAR — {}]\n", snap.as_of));
            for h in snap.holders.iter().take(12) {
                out.push_str(&format!("- {}: %{:.2}\n", h.name, h.pct));
            }
        }
        _ => out.push_str("\n[ANA ORTAKLAR] Kayıt bulunamadı.\n"),
    }
    match crate::subsidiaries::get_subsidiaries(client, ticker, false).await {
        Ok(snap) if !snap.items.is_empty() => {
            out.push_str(&format!("\n[BAĞLI ORTAKLIK / İŞTİRAKLER — {}]\n", snap.as_of));
            for s in snap.items.iter().take(15) {
                let pct = s.pct.map(|p| format!(" (%{p:.1})")).unwrap_or_default();
                let act = s.activity.as_deref().unwrap_or("");
                out.push_str(&format!("- {}{} {}\n", s.name, pct, act));
            }
        }
        _ => out.push_str("\n[BAĞLI ORTAKLIK / İŞTİRAKLER] Kayıt bulunamadı.\n"),
    }
    out
}

/// Bir rolü çalıştırır: ajanı/anahtarı çözer, role özel bağlamla completion alır.
/// Başarısızlıkta hata bir not olarak döner (tur devam eder).
async fn run_role(
    client: &reqwest::Client,
    role: RoleKind,
    ticker: &str,
    shared_context: &str,
    facts: &str,
    ownership: &str,
    agents: &[AiAgent],
    ai_keys: &[StoredAiKey],
    assigned_agent_id: Option<&str>,
) -> (RoleKind, String, Option<String>) {
    let agent = assigned_agent_id.and_then(|id| agents.iter().find(|a| a.id == id));
    let agent_name = agent.map(|a| a.name.clone());
    let key = resolve_key_for_agent(ai_keys, agent.map(|a| a.api_key_id.as_str()));
    let Some(key) = key else {
        return (
            role,
            format!("_Bu rol için kullanılabilir AI anahtarı yok._"),
            agent_name,
        );
    };

    let mut user = format!("Hisse: {ticker}\n\n[VERİLER]\n{facts}\n{shared_context}");
    if matches!(role, RoleKind::Ownership) {
        user.push_str(ownership);
    }

    let system = role.system_prompt(ticker);
    match crate::services::run_completion(client, &key, &system, &user).await {
        Ok(text) => (role, text, agent_name),
        Err(e) => (role, format!("_Bu rol tamamlanamadı: {e}_"), agent_name),
    }
}

/// Hisse için takım araştırması: rolleri paralel çalıştırır, lider sentezler.
pub async fn run_team_research(
    client: &reqwest::Client,
    ticker: &str,
    team: &TeamConfig,
    agents: &[AiAgent],
    ai_keys: &[StoredAiKey],
    equities: &[EquityRow],
) -> Result<ResearchOutcome, String> {
    if resolve_key_for_agent(ai_keys, None).is_none()
        && team
            .roles
            .iter()
            .all(|r| r.agent_id.is_none())
    {
        return Err("Kullanılabilir AI anahtarı yok. Ayarlar'dan bir anahtar ekleyin.".into());
    }

    let ticker = ticker.trim().to_uppercase();

    // Paylaşılan KAP + haber bağlamı (fiyat özeti dahil) — kilitsiz.
    let (shared_context, _analyzed) =
        crate::services::gather_agent_context(client, std::slice::from_ref(&ticker), equities).await;
    let facts = equity_facts(equities, &ticker);

    // Ortaklık rolü varsa ek bağlam çek.
    let needs_ownership = team.roles.iter().any(|r| matches!(r.role, RoleKind::Ownership));
    let ownership = if needs_ownership {
        ownership_context(client, &ticker).await
    } else {
        String::new()
    };

    // Rolleri paralel çalıştır.
    let role_futs = team.roles.iter().map(|tr| {
        run_role(
            client,
            tr.role,
            &ticker,
            &shared_context,
            &facts,
            &ownership,
            agents,
            ai_keys,
            tr.agent_id.as_deref(),
        )
    });
    let results = futures::future::join_all(role_futs).await;

    // Rol çıktılarını birleştir.
    let mut combined = String::new();
    for (role, text, agent_name) in &results {
        let by = agent_name
            .as_deref()
            .map(|n| format!(" · {n}"))
            .unwrap_or_default();
        combined.push_str(&format!("### {}{}\n{}\n\n", role.title_tr(), by, text.trim()));
    }

    // Lider sentez.
    let lead_agent = team
        .lead_agent_id
        .as_deref()
        .and_then(|id| agents.iter().find(|a| a.id == id));
    let lead_key = resolve_key_for_agent(ai_keys, lead_agent.map(|a| a.api_key_id.as_str()));

    let synthesis_system = format!(
        "Sen bir kıdemli BIST yatırım analistisin. Sana bir hissenin farklı uzman rollerince \
         hazırlanmış notları verilecek. Bunları TEK bir tutarlı Türkçe rapora sentezle: \
         önce 2-3 cümlelik özet, sonra 'Temel', 'Teknik', 'KAP & Haber', 'Ortaklık' başlıkları \
         altında maddeli değerlendirme, en sonda 'Genel Değerlendirme' ve riskler. \
         Çelişen görüşleri belirt. Markdown kullan. Sona '_Bu çıktı yatırım tavsiyesi değildir._' ekle."
    );
    let synthesis_user = format!("Hisse: {ticker}\n\n[UZMAN NOTLARI]\n\n{combined}");

    let report = match lead_key {
        Some(key) => match crate::services::run_completion(
            client,
            &key,
            &synthesis_system,
            &synthesis_user,
        )
        .await
        {
            Ok(text) => format!(
                "# 🔍 {ticker} — Takım Araştırması\n\n{text}\n\n---\n<details><summary>Ham rol notları</summary>\n\n{combined}</details>"
            ),
            // Sentez başarısızsa ham rol notlarını rapor olarak sun (kayıp olmasın).
            Err(e) => format!(
                "# 🔍 {ticker} — Takım Araştırması\n\n_Sentez adımı başarısız oldu: {e}. Ham rol notları aşağıdadır._\n\n{combined}"
            ),
        },
        None => format!("# 🔍 {ticker} — Takım Araştırması\n\n{combined}"),
    };

    let title = format!("🔍 {ticker} — Takım Araştırması");
    Ok(ResearchOutcome { report, title })
}

// ---------------------------------------------------------------------------
// Custom (serbest) araştırma
// ---------------------------------------------------------------------------

/// URL'den okunur metin çıkarır (başlık + paragraf/başlık/madde metinleri).
async fn fetch_readable_text(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let html = client
        .get(url)
        .header("User-Agent", BROWSER_UA)
        .header("Accept-Language", "tr-TR,tr;q=0.9")
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Sayfa alınamadı: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Sayfa yanıtı: {e}"))?
        .text()
        .await
        .map_err(|e| format!("Sayfa okunamadı: {e}"))?;

    let doc = scraper::Html::parse_document(&html);
    let sel = scraper::Selector::parse("h1, h2, h3, p, li").map_err(|_| "seçici hatası".to_string())?;
    let mut text = String::new();
    for el in doc.select(&sel) {
        let t = el.text().collect::<Vec<_>>().join(" ");
        let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
        if t.chars().count() >= 40 {
            text.push_str(&t);
            text.push('\n');
        }
        if text.len() >= MAX_URL_TEXT {
            break;
        }
    }
    if text.trim().is_empty() {
        return Err("Sayfadan okunabilir metin çıkarılamadı.".into());
    }
    Ok(text)
}

fn short_title(prefix: &str, body: &str) -> String {
    let first: String = body
        .lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .chars()
        .take(60)
        .collect();
    if first.trim().is_empty() {
        prefix.to_string()
    } else {
        format!("{prefix} {}", first.trim())
    }
}

/// Serbest görev: metin / URL / görsel. Atanan ajanın persona promptu (varsa)
/// kullanılır; yoksa genel araştırma asistanı.
pub async fn run_custom_research(
    client: &reqwest::Client,
    input: &JobInput,
    agent: Option<&AiAgent>,
    ai_keys: &[StoredAiKey],
) -> Result<ResearchOutcome, String> {
    let key = resolve_key_for_agent(ai_keys, agent.map(|a| a.api_key_id.as_str()))
        .ok_or_else(|| "Kullanılabilir AI anahtarı yok. Ayarlar'dan bir anahtar ekleyin.".to_string())?;

    let system = agent
        .map(|a| a.system_prompt.clone())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            "Sen dikkatli bir araştırma asistanısın. Sana verilen içeriği analiz edip Türkçe, \
             net ve maddeli bir özet/araştırma notu hazırla. Yalnızca verilen içeriğe dayan, \
             uydurma. Bu çıktı yatırım tavsiyesi değildir."
                .to_string()
        });

    let user_note = input.prompt.clone().unwrap_or_default();

    // Görsel varsa vision yolu.
    if let Some(image) = input.image_data_url.as_ref().filter(|s| !s.trim().is_empty()) {
        let text = if user_note.trim().is_empty() {
            "Bu görüntüyü analiz et ve önemli bilgileri Türkçe olarak çıkar.".to_string()
        } else {
            user_note.clone()
        };
        let report = crate::services::run_vision_completion(
            client,
            &key,
            &system,
            &text,
            std::slice::from_ref(image),
        )
        .await?;
        return Ok(ResearchOutcome {
            title: short_title("🖼️", &report),
            report,
        });
    }

    // URL varsa sayfa metnini çek.
    if let Some(url) = input.url.as_ref().filter(|s| !s.trim().is_empty()) {
        let page = fetch_readable_text(client, url).await?;
        let user = format!(
            "Kaynak URL: {url}\n{}\n\n[SAYFA İÇERİĞİ]\n{page}",
            if user_note.trim().is_empty() {
                "Görev: Bu sayfayı araştır ve özetle."
            } else {
                &user_note
            }
        );
        let report = crate::services::run_completion(client, &key, &system, &user).await?;
        return Ok(ResearchOutcome {
            title: short_title("🔗", url),
            report,
        });
    }

    // Yalnız metin.
    if !user_note.trim().is_empty() {
        let report = crate::services::run_completion(client, &key, &system, &user_note).await?;
        return Ok(ResearchOutcome {
            title: short_title("📝", &user_note),
            report,
        });
    }

    Err("Boş görev: metin, URL veya görsel gerekli.".into())
}

// ---------------------------------------------------------------------------
// İş oluşturma (komut + köprü ortak yolu)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Deserialize)]
pub struct SubmitResearchJobRequest {
    pub kind: JobKind,
    #[serde(default)]
    pub ticker: Option<String>,
    #[serde(default)]
    pub prompt: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub image_data_url: Option<String>,
    #[serde(default)]
    pub agent_id: Option<String>,
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// İsteği doğrular, iş kaydını kuyruğa (baş tarafa) ekler, kalıcılaştırır ve
/// iş id'sini döner. Team işlerinde mevcut takım yapılandırması snapshot'lanır.
/// Çağıran, dönüşte worker'ı uyandırmalıdır.
pub fn enqueue_job(
    store: &mut crate::storage::AppStore,
    source: JobSource,
    req: SubmitResearchJobRequest,
) -> Result<String, String> {
    let (kind, input, title) = match req.kind {
        JobKind::TickerTeam => {
            let ticker = non_empty(req.ticker.clone())
                .map(|t| t.to_uppercase())
                .ok_or_else(|| "Hisse kodu gerekli.".to_string())?;
            let input = JobInput {
                ticker: Some(ticker.clone()),
                ..Default::default()
            };
            (
                JobKind::TickerTeam,
                input,
                format!("🔍 {ticker} — Takım Araştırması"),
            )
        }
        JobKind::Custom => {
            let prompt = non_empty(req.prompt.clone());
            let url = non_empty(req.url.clone());
            let image = req
                .image_data_url
                .clone()
                .filter(|s| !s.trim().is_empty());
            if prompt.is_none() && url.is_none() && image.is_none() {
                return Err("Boş görev: metin, URL veya görsel gerekli.".into());
            }
            let title = if let Some(u) = &url {
                short_title("🔗", u)
            } else if image.is_some() {
                short_title("🖼️", prompt.as_deref().unwrap_or("Görsel araştırma"))
            } else {
                short_title("📝", prompt.as_deref().unwrap_or(""))
            };
            let input = JobInput {
                prompt,
                url,
                image_data_url: image,
                ticker: None,
            };
            (JobKind::Custom, input, title)
        }
    };

    let mut job = new_job(source, kind, input, title);
    job.agent_id = non_empty(req.agent_id.clone());
    if matches!(kind, JobKind::TickerTeam) {
        job.team = Some(store.team_config.clone());
    }
    let id = job.id.clone();
    store.research_jobs.insert(0, job);
    store.research_jobs.truncate(MAX_RESEARCH_JOBS);
    store.save_research_jobs();
    Ok(id)
}
