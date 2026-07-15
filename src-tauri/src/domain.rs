use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NewsTag {
    pub ticker: String,
    pub confidence: f32,
    pub sentiment: String, // "POSITIVE" | "NEGATIVE" | "NEUTRAL"
    pub reason: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NewsItem {
    pub title: String,
    pub link: String,
    pub pub_date: String,
    pub source: String,
    pub summary: Option<String>,
    pub ticker: Option<String>,
    pub is_kap: bool,
    #[serde(default)]
    pub tags: Vec<NewsTag>,
    #[serde(default)]
    pub sector_tags: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct MarketMetric {
    pub symbol: String,
    pub value: String,
    pub change: String,
    pub positive: bool,
    /// Yahoo'nun bildirdiği son veri zamanı (unix sn). Gecikme göstergesi için.
    pub as_of_ts: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct EquityRow {
    pub ticker: String,
    pub name: String,
    pub price: f64,
    pub change_pct: f64,
    pub change_1w: Option<f64>,
    pub change_1m: Option<f64>,
    pub change_6m: Option<f64>,
    pub change_1y: Option<f64>,
    pub volume: u64,
    pub rsi: f64,
    pub macd: f64,
    pub sma_50: f64,
    pub ema_20: f64,
    pub bollinger_position: String,
    pub atr: f64,
    pub week_52_high: f64,
    pub week_52_low: f64,
    pub pe: Option<f64>,
    pub pb: Option<f64>,
    pub roe: Option<f64>,
    pub roa: Option<f64>,
    pub net_debt_ebitda: Option<f64>,
    pub gross_margin: Option<f64>,
    pub net_margin: Option<f64>,
    pub sales_growth: Option<f64>,
    pub profit_growth: Option<f64>,
    pub dividend_yield: Option<f64>,
    pub market_cap: Option<f64>,
    pub fundamentals_available: bool,
    pub fundamentals_source: Option<String>,
    pub fundamentals_as_of: Option<String>,
    pub fundamentals_currency: Option<String>,
    pub index_memberships: Vec<String>,
    pub index_changes: Option<crate::bist_indices::IndexChange>,
    pub free_float_ratio: Option<f64>,
    /// Cari yabancı takas oranı (%). İş Yatırım screener kriter kodu 40.
    pub foreign_ratio: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Default)]
pub struct FinancialPeriod {
    pub period: String,
    pub revenue: Option<f64>,
    pub gross_profit: Option<f64>,
    pub operating_income: Option<f64>,
    pub net_income: Option<f64>,
    pub total_assets: Option<f64>,
    pub total_equity: Option<f64>,
    pub total_debt: Option<f64>,
    pub operating_cash_flow: Option<f64>,
    pub free_cash_flow: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Default)]
pub struct FinancialStatement {
    pub ticker: String,
    pub currency: String,
    pub annuals: Vec<FinancialPeriod>,
    pub quarterlies: Vec<FinancialPeriod>,
}

#[derive(Clone, Debug, Serialize)]
pub struct KapAnnouncement {
    pub id: String,
    pub ticker: String,
    pub title: String,
    pub date: String,
    pub category: String,
    pub summary: String,
    pub url: String,
    pub ai_importance_score: u8,
}



#[derive(Clone, Debug, Serialize)]
pub struct DataSourceStatus {
    pub name: String,
    pub provider: String,
    pub status: String,
    pub last_sync: String,
    pub records: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct DashboardSnapshot {
    pub generated_at: String,
    pub market_metrics: Vec<MarketMetric>,
    pub top_gainers: Vec<EquityRow>,
    pub risk_watch: Vec<EquityRow>,
    pub data_sources: Vec<DataSourceStatus>,
    pub equities: Vec<EquityRow>,
    pub spk_bulletins: Vec<crate::spk::SpkBulletin>,
    pub kap_announcements: Vec<crate::domain::KapAnnouncement>,
}

#[derive(Clone, Debug, Serialize)]
pub struct TickerSnapshot {
    pub equity: EquityRow,
    pub technical_summary: Vec<String>,
    pub fundamental_summary: Vec<String>,
    pub kap: Vec<KapAnnouncement>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ScreenerRequest {
    pub market: Option<String>,
    pub query: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct ScreenerResult {
    pub query: String,
    pub rows: Vec<EquityRow>,
    pub explanation: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct KapFilter {
    pub ticker: Option<String>,
    pub category: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AiChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AiRequest {
    pub prompt: String,
    pub active_context: Option<String>,
    pub agent_id: Option<String>,
    /// Panelin gönderdiği aktif sohbetin mesajları; None ise (terminal gibi
    /// tek atımlık çağrılar) küresel geçmişten kısa bağlam eklenir.
    #[serde(default)]
    pub history: Option<Vec<AiChatMessage>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AiResponse {
    pub provider: String,
    pub model: String,
    pub summary: String,
    pub tool_calls: Vec<String>,
    pub disclaimer: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct FqlResponse {
    pub command_type: String,
    pub message: String,
    pub opened_tab: Option<String>,
    pub rows: Vec<EquityRow>,
    pub kap: Vec<KapAnnouncement>,
    pub ai: Option<AiResponse>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SaveAiKeyRequest {
    pub id: Option<String>,
    pub provider: String,
    pub label: String,
    pub api_key: String,
    pub default_model: String,
    pub enabled: bool,
    pub api_url: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AiKeyRecord {
    pub id: String,
    pub provider: String,
    pub label: String,
    pub masked_key: String,
    pub default_model: String,
    pub enabled: bool,
    pub is_default: bool,
    pub created_at: String,
    pub last_used_at: Option<String>,
    pub api_url: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct StoredAiKey {
    pub id: String,
    pub provider: String,
    pub label: String,
    pub secret: String,
    pub default_model: String,
    pub enabled: bool,
    pub is_default: bool,
    pub created_at: String,
    pub last_used_at: Option<String>,
    pub api_url: Option<String>,
}

impl StoredAiKey {
    pub fn public_record(&self) -> AiKeyRecord {
        AiKeyRecord {
            id: self.id.clone(),
            provider: self.provider.clone(),
            label: self.label.clone(),
            masked_key: mask_secret(&self.secret),
            default_model: self.default_model.clone(),
            enabled: self.enabled,
            is_default: self.is_default,
            created_at: self.created_at.clone(),
            last_used_at: self.last_used_at.clone(),
            api_url: self.api_url.clone(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AiHistoryRecord {
    pub id: String,
    pub timestamp: String,
    pub prompt: String,
    pub response: String,
    pub tags: Vec<String>,
}

pub fn mask_secret(secret: &str) -> String {
    if secret.len() <= 8 {
        return "********".to_string();
    }

    let start = &secret[..4];
    let end = &secret[secret.len() - 4..];
    format!("{start}...{end}")
}

#[derive(Clone, Debug, Serialize)]
pub struct SyncResult {
    pub source: String,
    pub mode: String,
    pub status: String,
    pub message: String,
    pub updated_records: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct HistoricalQuote {
    pub time: u64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AiAgent {
    pub id: String,
    pub name: String,
    pub role_description: String,
    pub system_prompt: String,
    pub api_key_id: String,
    pub is_active: bool,
    pub created_at: String,
    pub linked_artifacts: Vec<String>,
    /// Ajanın takip ettiği hisse kodları; analiz çalıştırıldığında bu
    /// hisselerin KAP bildirimleri ve haberleri otomatik toplanır.
    #[serde(default)]
    pub linked_tickers: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SaveAiAgentRequest {
    pub id: Option<String>,
    pub name: String,
    pub role_description: String,
    pub system_prompt: String,
    pub api_key_id: String,
    pub is_active: bool,
    pub linked_artifacts: Option<Vec<String>>,
    #[serde(default)]
    pub linked_tickers: Option<Vec<String>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Artifact {
    pub id: String,
    pub title: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SaveArtifactRequest {
    pub id: Option<String>,
    pub title: String,
    pub content: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct IndexConstituent {
    pub ticker: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct IndexChange {
    pub ticker: String,
    pub index_code: String,
    pub action: String, // "ADDED" or "REMOVED"
    pub date: String,
}

// --- Corporate Actions ---

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DividendRecord {
    pub ticker: String,
    pub ex_date: String,
    pub amount_per_share: f64,
    /// Hak düşüm ayındaki kapanışa göre brüt verim (%); fiyat yoksa 0.
    pub yield_pct: f64,
    pub period: String,
    /// Aynı takvim yılı içindeki kaçıncı ödeme (1 tabanlı). 0 = hesaplanmadı.
    #[serde(default)]
    pub installment: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CapitalIncrease {
    pub ticker: String,
    pub date: String,
    pub increase_type: String, // "BEDELSIZ" | "BEDELLI" | "KARMA"
    pub ratio: String,
    pub rights_price: Option<f64>,
    pub source: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct IpoRecord {
    pub ticker: String,
    pub company_name: String,
    pub ipo_date: String,
    pub price: f64,
    pub current_price: Option<f64>,
    pub return_pct: Option<f64>,
    pub lot_size: u32,
    pub status: String, // "TAMAMLANDI" | "AKTİF" | "TALEP TOPLAMA" | "TASLAK"
    pub book_building_dates: Option<String>,
    pub trading_start_date: Option<String>,
    pub distribution_type: Option<String>,
    pub participant_count: Option<String>,
    /// Arzdan bu yana bedelsiz/bölünme kümülatif çarpanı (2:1 bedelsiz = 2.0).
    /// return_pct bu çarpanla düzeltilerek hesaplanır.
    pub split_factor: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct IpoCalendarPayload {
    pub records: Vec<IpoRecord>,
    pub last_updated: Option<String>,
    pub scrape_ok: bool,
}

/// Açıklanmış gelecek temettü (Yahoo calendarEvents.exDividendDate).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UpcomingDividend {
    pub ticker: String,
    pub ex_date: String,
    /// Yahoo'nun yıllık temettü oranı (hisse başı TL, tahmini)
    pub annual_rate: Option<f64>,
    /// Aynı yıl içinde daha önce ödenenler dahil kaçıncı taksit olacağı.
    #[serde(default)]
    pub installment: u32,
}

#[derive(Clone, Debug, Serialize)]
pub struct AgentAnalysisResult {
    pub summary: String,
    pub artifact_id: String,
    pub artifact_title: String,
    pub tickers: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CorporateEventsPayload {
    pub dividends: Vec<DividendRecord>,
    pub splits: Vec<CapitalIncrease>,
    #[serde(default)]
    pub upcoming: Vec<UpcomingDividend>,
    pub last_updated: Option<String>,
    /// false ise piyasa taraması henüz tamamlanmadı (ilk açılış)
    pub ready: bool,
}
