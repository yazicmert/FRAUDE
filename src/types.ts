export interface MarketMetric {
  symbol: string;
  value: string;
  change: string;
  positive: boolean;
  as_of_ts: number | null;
}

export interface NewsTag {
  ticker: string;
  confidence: number;
  sentiment: string; // "POSITIVE" | "NEGATIVE" | "NEUTRAL"
  reason: string;
}

export interface NewsItem {
  title: string;
  link: string;
  pub_date: string;
  source: string;
  summary: string | null;
  ticker: string | null;
  is_kap: boolean;
  tags: NewsTag[];
  sector_tags: string[];
}

export interface HistoricalQuote {
  time: number; // Unix timestamp
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface EquityRow {
  ticker: string;
  name: string;
  price: number;
  change_pct: number;
  /** Fiyat sağlayıcısının bildirdiği son veri zamanı (unix saniye). */
  as_of_ts: number | null;
  change_1w?: number | null;
  change_1m?: number | null;
  change_6m?: number | null;
  change_1y?: number | null;
  volume: number;
  rsi: number;
  macd: number;
  sma_50: number;
  ema_20: number;
  bollinger_position: string;
  atr: number;
  week_52_high: number;
  week_52_low: number;
  pe: number | null;
  pb: number | null;
  roe: number | null;
  roa: number | null;
  net_debt_ebitda: number | null;
  gross_margin: number | null;
  net_margin: number | null;
  sales_growth: number | null;
  profit_growth: number | null;
  dividend_yield: number | null;
  market_cap: number | null;
  fundamentals_available: boolean;
  fundamentals_source: string | null;
  fundamentals_as_of: string | null;
  fundamentals_currency: string | null;
  index_memberships: string[];
  index_changes?: IndexChange;
  free_float_ratio?: number | null;
  foreign_ratio?: number | null;
}

export interface FinancialPeriod {
  period: string;
  revenue?: number | null;
  gross_profit?: number | null;
  operating_income?: number | null;
  net_income?: number | null;
  total_assets?: number | null;
  total_equity?: number | null;
  total_debt?: number | null;
  operating_cash_flow?: number | null;
  free_cash_flow?: number | null;
}

export interface FinancialStatement {
  ticker: string;
  currency: string;
  annuals: FinancialPeriod[];
  quarterlies: FinancialPeriod[];
}

export interface IndexChange {
  added: string[];
  removed: string[];
  timestamp: number;
}

export interface KapAttachment {
  name: string;
  url: string;
}

export interface KapAnnouncement {
  id: string;
  ticker: string;
  title: string;
  date: string;
  category: string;
  summary: string;
  url: string;
  ai_importance_score: number;
  attachment_count: number;
  attachments?: KapAttachment[];
}

export interface DataSourceStatus {
  name: string;
  provider: string;
  status: string;
  last_sync: string;
  records: number;
}

export interface SpkBulletin {
  title: string;
  date: string;
  url: string;
}

export interface DashboardSnapshot {
  generated_at: string;
  market_metrics: MarketMetric[];
  top_gainers: EquityRow[];
  risk_watch: EquityRow[];
  data_sources: DataSourceStatus[];
  equities: EquityRow[];
  spk_bulletins: SpkBulletin[];
  kap_announcements: KapAnnouncement[];
}

export interface TickerSnapshot {
  equity: EquityRow;
  technical_summary: string[];
  fundamental_summary: string[];
  kap: KapAnnouncement[];
}

export interface ScreenerResult {
  query: string;
  rows: EquityRow[];
  explanation: string;
}

export interface AiResponse {
  provider: string;
  model: string;
  summary: string;
  tool_calls: string[];
  disclaimer: string;
}

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface Shareholder {
  name: string;
  pct: number;
}

export interface ShareholderSnapshot {
  ticker: string;
  as_of: string;
  holders: Shareholder[];
}

export interface Subsidiary {
  name: string;
  activity: string | null;
  relation: string | null;
  pct: number | null;
}

export type MonitorEventType = 'ownership' | 'business' | 'capital' | 'other';

export interface MonitorAlert {
  id: string;
  ticker: string;
  company: string | null;
  title: string;
  url: string;
  date: string;
  category: string;
  event_type: MonitorEventType;
  severity: number;
  ai_comment: string | null;
  created_at: string;
  read: boolean;
}

export interface MonitorConfig {
  enabled: boolean;
  interval_secs: number;
  agent_id: string | null;
  os_notifications: boolean;
  tickers: string[];
}

export interface MonitorState {
  config: MonitorConfig;
  alerts: MonitorAlert[];
  last_run: string | null;
  unread: number;
  baselined: string[];
}

export interface SubsidiarySnapshot {
  ticker: string;
  as_of: string;
  items: Subsidiary[];
}

export interface FqlResponse {
  command_type: string;
  message: string;
  opened_tab: string | null;
  rows: EquityRow[];
  kap: KapAnnouncement[];
  ai: AiResponse | null;
}

export interface AiKeyRecord {
  id: string;
  provider: string;
  label: string;
  masked_key: string;
  default_model: string;
  enabled: boolean;
  is_default: boolean;
  created_at: string;
  last_used_at: string | null;
  api_url?: string;
}

export interface SaveAiKeyRequest {
  id?: string;
  provider: string;
  label: string;
  api_key: string;
  default_model: string;
  enabled: boolean;
  api_url?: string;
}

export interface SyncResult {
  source: string;
  mode: string;
  status: string;
  message: string;
  updated_records: number;
  market_updated_records: number;
  market_coverage: number | null;
  market_as_of_ts: number | null;
}

export interface AiHistoryRecord {
  id: string;
  timestamp: string;
  prompt: string;
  response: string;
  tags: string[];
}

export interface AiAgent {
  id: string;
  name: string;
  role_description: string;
  system_prompt: string;
  api_key_id: string;
  is_active: boolean;
  created_at: string;
  linked_artifacts: string[];
  linked_tickers: string[];
}

export interface SaveAiAgentRequest {
  id?: string;
  name: string;
  role_description: string;
  system_prompt: string;
  api_key_id: string;
  is_active: boolean;
  linked_artifacts?: string[];
  linked_tickers?: string[];
}

export interface AgentAnalysisResult {
  summary: string;
  artifact_id: string;
  artifact_title: string;
  tickers: string[];
}

export interface Artifact {
  id: string;
  title: string;
  content: string;
  created_at: string;
}

export interface SaveArtifactRequest {
  id?: string;
  title: string;
  content: string;
}

// --- Araştırma işleri (agent takımı + Chrome eklentisi görevleri) ---

export type JobSource = 'app' | 'extension';
export type JobKind = 'ticker_team' | 'custom';
export type JobStatus = 'queued' | 'running' | 'done' | 'error';
export type RoleKind = 'fundamental' | 'kap_news' | 'technical' | 'ownership';

export interface JobInput {
  prompt?: string;
  url?: string;
  image_data_url?: string;
  ticker?: string;
}

export interface TeamRole {
  role: RoleKind;
  agent_id: string | null;
}

export interface TeamConfig {
  roles: TeamRole[];
  lead_agent_id: string | null;
}

export interface ResearchJob {
  id: string;
  source: JobSource;
  kind: JobKind;
  input: JobInput;
  agent_id?: string | null;
  team?: TeamConfig | null;
  title: string;
  status: JobStatus;
  report?: string | null;
  artifact_id?: string | null;
  error?: string | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  updated_at_ms: number;
  notified_app: boolean;
  notified_ext: boolean;
}

export interface SubmitResearchJobRequest {
  kind: JobKind;
  ticker?: string;
  prompt?: string;
  url?: string;
  image_data_url?: string;
  agent_id?: string;
}

export interface BridgeInfo {
  port: number;
  token: string;
  running: boolean;
}

export interface IndexConstituent {
  ticker: string;
  name: string;
}

export interface IndexChange {
  ticker: string;
  index_code: string;
  action: string;
  date: string;
}

export interface DividendRecord {
  ticker: string;
  ex_date: string;
  amount_per_share: number;
  yield_pct: number;
  period: string;
  installment: number;
  /** "KAP Bildirimi 1617428" / "Yahoo Finance" — kaydın geldiği kaynak. */
  source?: string;
  /**
   * Tutarın para birimi ("TRY", "USD", "EUR"). "TRY" dışında bir değerde
   * `amount_per_share` lira **değildir**; eski kayıtlarda alan bulunmaz.
   */
  currency?: string;
}

export interface CapitalIncrease {
  ticker: string;
  date: string;
  increase_type: string;
  ratio: string;
  rights_price: number | null;
  source: string;
}

export interface IpoRecord {
  ticker: string;
  company_name: string;
  ipo_date: string;
  price: number;
  current_price: number | null;
  return_pct: number | null;
  lot_size: number;
  status: string;
  book_building_dates: string | null;
  trading_start_date: string | null;
  distribution_type: string | null;
  participant_count: string | null;
  split_factor: number | null;
  fund_usage?: string | null;
  share_structure?: string | null;
  ipo_size?: string | null;
  katilim_index?: string | null;
  lockup_period?: string | null;
  consortium_lead?: string | null;
  t1_t2_available?: string | null;
  distribution_ratios?: string | null;
  /** "76,60 TL" ya da "20,00 - 22,00 TL" — ham fiyat/aralık metni. */
  price_range?: string | null;
  /** Arza konu toplam pay: "48.312.950 Lot". */
  lot_amount?: string | null;
  market?: string | null;
  index_name?: string | null;
  free_float_lots?: string | null;
  free_float_ratio?: string | null;
  sale_method?: string | null;
  /** Katılımcı sayısına göre beklenen/gerçekleşen lot dağılımı. */
  expected_lots?: string | null;
  financials?: string | null;
  price_stability?: string | null;
  public_float_ratio?: string | null;
  discount?: string | null;
  results_table?: IpoResultRow[] | null;
  major_shareholders?: string | null;
  data_sources?: string[];
  spk_bulletin_no?: string | null;
}

/** Tamamlanmış bir arzın yatırımcı grubu bazında dağıtım satırı. */
export interface IpoResultRow {
  group: string;
  people: string;
  lots: string;
  ratio: string;
}

export interface UpcomingDividend {
  ticker: string;
  ex_date: string;
  annual_rate: number | null;
  installment: number;
  /** Ödemenin para birimi; bkz. `DividendRecord.currency`. */
  currency?: string;
}

/** Kâr payını lira dışında bir para biriminde açıklayan şirket. */
export interface FxDividendPayer {
  ticker: string;
  currency: string;
  source: string;
}

export interface CorporateEventsPayload {
  dividends: DividendRecord[];
  splits: CapitalIncrease[];
  upcoming: UpcomingDividend[];
  /** Temettü ekranındaki döviz notunu besleyen liste. */
  fx_payers?: FxDividendPayer[];
  last_updated: string | null;
  ready: boolean;
}

export interface IpoCalendarPayload {
  records: IpoRecord[];
  last_updated: string | null;
  scrape_ok: boolean;
}
