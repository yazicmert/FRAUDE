import { invokePlatform as invoke } from './platformClient';
import type {
  AiKeyRecord,
  AiHistoryRecord,
  AiResponse,
  AnalystReport,
  DashboardSnapshot,
  FqlResponse,
  HistoricalQuote,
  KapAnnouncement,
  ScreenerResult,
  SyncResult,
  TickerSnapshot,
  NewsItem,
  FinancialStatement,
  AiAgent,
  SaveAiKeyRequest,
  SaveAiAgentRequest,
} from '../types';

export type PriceSource = 'yahoo' | 'isyatirim';

export function getPriceHistory(ticker: string, range = '6mo', source: PriceSource = 'yahoo') {
  return invoke<HistoricalQuote[]>('get_price_history', { ticker, range, source });
}

export interface MarketHoliday {
  date: string; // YYYY-MM-DD (Europe/Istanbul)
  name: string;
}

export function getMarketHolidays() {
  return invoke<MarketHoliday[]>('get_market_holidays');
}

/* ── TEFAS fonları ──────────────────────────────────────────────────────────── */

/** TEFAS fon tipi kodu. */
export type FundKind = 'YAT' | 'EMK' | 'BYF' | 'GYF' | 'GSYF';

export const FUND_KIND_LABELS: Record<FundKind, string> = {
  YAT: 'Yatırım Fonu',
  EMK: 'Emeklilik Fonu',
  BYF: 'Borsa Yatırım Fonu',
  GYF: 'Gayrimenkul Yatırım Fonu',
  GSYF: 'Girişim Sermayesi Yatırım Fonu',
};

export interface FundRow {
  code: string;
  name: string;
  kind: FundKind;
  /** Fiyatın ait olduğu tarih (YYYY-MM-DD). */
  date: string;
  price: number;
  previous_price: number;
  change_pct: number;
  share_count: number;
  investor_count: number;
  /** Portföy büyüklüğü (TL). */
  portfolio_size: number;
}

/** Fonun varlık sınıfı dağılımı. TEFAS tek tek hisseleri yayınlamaz. */
export interface FundAllocation {
  label: string;
  pct: number;
}

/** Fon kurucusunun KAP künyesi. */
export interface FundIssuer {
  name: string;
  kap_url: string;
  website: string | null;
}

/** TEFAS'taki tüm fonlar. İlk çağrı hız sınırı nedeniyle ~1 dk sürebilir. */
export function getFunds() {
  return invoke<FundRow[]>('get_funds');
}

export function getFundAllocation(code: string) {
  return invoke<FundAllocation[]>('get_fund_allocation', { code });
}

/** Fon fiyat geçmişi; `months` büyüdükçe hız sınırı nedeniyle süre uzar. */
export function getFundHistory(code: string, months: number) {
  return invoke<[string, number][]>('get_fund_history', { code, months });
}

export function getFundIssuer(fundName: string) {
  return invoke<FundIssuer | null>('get_fund_issuer', { fundName });
}

/** Fonun KAP bildirimi. */
export interface FundDisclosure {
  date: string;
  subject: string;
  summary: string;
  url: string;
}

/** Fonun son ~4 haftadaki KAP bildirimleri. */
export function getFundDisclosures(code: string) {
  return invoke<FundDisclosure[]>('get_fund_disclosures', { code });
}

/** Fonun dönem getirileri (yüzde); fiyatı o dönemde yoksa alan null kalır. */
export interface FundReturns {
  code: string;
  r1m: number | null;
  r3m: number | null;
  r1y: number | null;
}

/**
 * Tüm fonların 1 ay / 3 ay / 1 yıl getirileri. İlk çağrı TEFAS hız sınırı
 * nedeniyle dakikalar sürer; 12 saat önbelleklenir. Liste yüklemesinden ayrı,
 * arka planda çağrılmalıdır.
 */
export function getFundReturns() {
  return invoke<FundReturns[]>('get_fund_returns');
}

/** Fon portföyündeki tek varlık (KAP Portföy Dağılım Raporu'ndan). */
export interface FundHolding {
  code: string;
  name: string;
  /** Fon toplam değerine göre yüzde. */
  pct: number;
  /** Rapordaki varlık grubu; okunamadıysa boş. */
  group: string;
}

export interface FundHoldingsReport {
  /** Rapor dönemi, "2026-06" biçiminde — veri ~1 ay gecikmelidir. */
  period: string;
  /** KAP bildirim sayfası. */
  url: string;
  holdings: FundHolding[];
}

/**
 * Fonun içindeki varlıklar. PDR vermeyen fonlarda reddedilir; PDF düzeni
 * okunamayan fonlarda `holdings` boş, `url` raporu gösterir.
 */
export function getFundHoldings(code: string) {
  return invoke<FundHoldingsReport>('get_fund_holdings', { code });
}

/** Taranmış (metinsiz) PDR'yi kullanıcının AI anahtarıyla görüntüden çözer. */
export function getFundHoldingsAi(code: string) {
  return invoke<FundHoldingsReport>('get_fund_holdings_ai', { code });
}

/** Bir hisseyi portföyünde taşıyan fon (birikmiş PDR dizininden). */
export interface TickerFundRow {
  fund_code: string;
  fund_name: string;
  fund_kind: string;
  weight_pct: number;
  period: string;
  url: string;
}

export interface TickerFundsPayload {
  entries: TickerFundRow[];
  scanned_funds: number;
}

export function getTickerFunds(ticker: string) {
  return invoke<TickerFundsPayload>('get_ticker_funds', { ticker });
}

/** Enstrüman türüne göre doğru sağlayıcıdan alınmış canlı/güncel fiyat. */
export interface LiveQuote {
  ticker: string;
  source: string;
  /** Sağlayıcının ilan edilen yaklaşık gecikmesi; bilinmiyorsa null. */
  delay_seconds: number | null;
  price: number;
  previous_close: number;
  change_pct: number;
  /** Son barın unix zaman damgası (saniye). */
  as_of_ts: number;
}

/**
 * Verilen sembollerin gecikmeli fiyatlarını çeker. Pano anlık görüntüsünden
 * bağımsızdır: sık çağrılabilir, haber/KAP/temel veriyi yeniden çekmez.
 * Yalnızca ekranda görünen semboller sorulmalıdır.
 */
export function getLiveQuotes(tickers: string[]) {
  return invoke<LiveQuote[]>('get_live_quotes', { tickers });
}

export type EconomicImpact = 'high' | 'medium' | 'low' | 'holiday';

export interface EconomicEvent {
  date: string;      // YYYY-MM-DD
  time: string;      // "11:00 AM" or ""
  event: string;     // Türkçe etkinlik adı
  category: string;
  actual: string;
  previous: string;
  consensus: string;
  forecast: string;
  impact: EconomicImpact;
  /** Verinin geldiği sayfa. Alan eklenmeden önce önbelleğe yazılmış
   *  kayıtlarda bulunmayabilir; okuyan taraf yedek adrese düşer. */
  source_url?: string;
}

export function getEconomicCalendar() {
  return invoke<EconomicEvent[]>('get_economic_calendar');
}

/**
 * Takvim maddesiyle ilgili haberler. Sorgu olayın KATEGORİSİNDEN üretilir
 * (görünen ad kaynağın İngilizce etiketidir, Türkçe basında geçmez).
 */
export function getCalendarEventNews(event: EconomicEvent, lang: string) {
  return invoke<NewsItem[]>('get_calendar_event_news', {
    category: event.category,
    event: event.event,
    date: event.date,
    lang,
  });
}

/** Takvim satırına etiketlenen tek bir enstrüman. */
export interface ImpactLink {
  /** BIST kodu ("FROTO") ya da sağlayıcı sembolü ("BZ=F", "STLA"). */
  symbol: string;
  name: string;
  /** İlişkinin gerekçesi — yön değil, kanal anlatır. */
  why: string;
}

/** Takvim maddesinin piyasa karşılığı. */
export interface CalendarImpact {
  /** Verinin piyasaya hangi yoldan geçtiğini anlatan cümle; boşsa bölüm çizilmez. */
  channel: string;
  bist: ImpactLink[];
  global: ImpactLink[];
  reports: AnalystReport[];
  /** Rapor arşivi kurulmuş mu — boş liste "rapor yok" mu, "arşiv yok" mu? */
  archive_ready: boolean;
}

/**
 * Takvim maddesinin etkilediği paylar ve o konudaki analiz raporları.
 *
 * Ağa çıkmaz: etiketler sabit tablodan, raporlar diskteki kurum arşivinden
 * gelir. Bu yüzden haber aramasından bağımsız ve anında döner.
 */
export function getCalendarEventImpact(event: EconomicEvent, lang: string) {
  return invoke<CalendarImpact>('get_calendar_event_impact', {
    category: event.category,
    lang,
  });
}

export function executeFql(command: string, activeContext?: string) {
  return invoke<FqlResponse>('execute_fql', {
    command,
    activeContext,
  });
}

export function syncData(source = 'all', mode = 'incremental') {
  return invoke<SyncResult>('sync_data', { source, mode });
}

export function getDashboardSnapshot() {
  return invoke<DashboardSnapshot>('get_dashboard_snapshot');
}

export async function getTickerSnapshot(ticker: string): Promise<TickerSnapshot> {
  return invoke('get_ticker_snapshot', { ticker });
}

/** Mali tablo para birimi. Çeviriyi sağlayıcı yapar (gelir tablosu ortalama,
 *  bilanço dönem sonu kuruyla — UMS 21). */
export type StatementCurrency = 'TRY' | 'USD';

export async function getFinancialStatements(
  ticker: string,
  currency: StatementCurrency = 'TRY',
): Promise<FinancialStatement> {
  return invoke('get_financial_statements', { ticker, currency });
}

/**
 * Tarayıcı sorgusunu çalıştırır.
 *
 * `market` VARSAYILAN OLARAK BOŞ: eskiden 'BIST100' idi ve arka uç sorgunun
 * başına ekliyordu ("BIST100 EMTIA where …"). Kategori süzgeci else-if
 * zinciriyle çalıştığı için ilk dal (bist100) her zaman kazanıyor, evren 100
 * hisseye iniyordu — Emtia/Kripto/Global kategorileri hiç sonuç veremiyor,
 * "Tüm Varlıklar" da sessizce BIST 100 demek oluyordu. Kategoriyi çağıran
 * belirler (ScreenerView sorgunun başına BIST/GLOBAL/EMTIA/KRIPTO yazar).
 */
export function runScreener(query: string, market?: string) {
  return invoke<ScreenerResult>('run_screener', {
    request: { market: market ?? null, query },
  });
}

export function listKapAnnouncements(ticker?: string) {
  return invoke<KapAnnouncement[]>('list_kap_announcements', {
    filter: { ticker, limit: 25 },
  });
}

export interface KapDisclosureDetail {
  disclosure_index: string;
  attachments: { name: string; url: string }[];
  pdf_url: string;
  word_url: string;
  excel_url: string;
}

export function getKapDisclosureDetail(disclosureIndex: string) {
  return invoke<KapDisclosureDetail>('get_kap_disclosure_detail', {
    disclosureIndex,
  });
}

export function askAi(
  prompt: string,
  activeContext?: string,
  agentId?: string,
  history?: import('../types').AiChatMessage[],
  effortLevel?: string,
  /** Arayüzden seçilen anahtar; boşsa arka uç varsayılanı kullanır. */
  apiKeyId?: string,
  /** Tam `data:image/...;base64,...` veri-URL'leri. */
  images?: string[],
) {
  return invoke<AiResponse>('ask_ai', {
    request: {
      prompt,
      active_context: activeContext,
      agent_id: agentId,
      api_key_id: apiKeyId,
      images,
      history,
      effort_level: effortLevel,
    },
  });
}

export function listAiKeys() {
  return invoke<AiKeyRecord[]>('list_ai_keys');
}

export function saveAiKey(request: SaveAiKeyRequest) {
  return invoke<AiKeyRecord>('save_ai_key', { request });
}

export function deleteAiKey(id: string) {
  return invoke<AiKeyRecord[]>('delete_ai_key', { id });
}

export function setDefaultAiKey(id: string) {
  return invoke<AiKeyRecord[]>('set_default_ai_key', { id });
}

export async function testAiKey(id: string): Promise<string> {
  return invoke<string>('test_ai_key', { id });
}

export async function listAiHistory(): Promise<AiHistoryRecord[]> {
  return invoke<AiHistoryRecord[]>('list_ai_history');
}

export function deleteAiHistory(id: string) {
  return invoke<AiHistoryRecord[]>('delete_ai_history', { id });
}

export function clearAiHistory() {
  return invoke<void>('clear_ai_history');
}

export function listAiAgents() {
  return invoke<AiAgent[]>('list_ai_agents');
}

export function saveAiAgent(request: SaveAiAgentRequest) {
  return invoke<AiAgent>('save_ai_agent', { request });
}

export function deleteAiAgent(id: string) {
  return invoke<AiAgent[]>('delete_ai_agent', { id });
}

export function getNewsFeed(ticker?: string) {
  return invoke<NewsItem[]>('get_news_feed', { ticker: ticker?.trim() || null });
}

export function getNewsPreview(url: string) {
  return invoke<string>('get_news_preview', { url });
}

export function getNewsHtml(url: string) {
  return invoke<string>('get_news_html', { url });
}

export function getBistIndices() {
  return invoke<[Record<string, import('../types').IndexConstituent[]>, import('../types').IndexChange[]]>('get_bist_indices');
}

export function updateBistIndices() {
  return invoke<void>('update_bist_indices');
}

export function getDividends(ticker: string) {
  return invoke<import('../types').DividendRecord[]>('get_dividends', { ticker });
}

export function getCapitalIncreases(ticker: string) {
  return invoke<import('../types').CapitalIncrease[]>('get_capital_increases', { ticker });
}

/**
 * Analiz raporları. `ticker` verilmezse piyasa geneli akış döner; verilirse
 * kurumun o hisseye ait etiket akışı da canlı olarak taranır.
 */
export function getAnalystReports(ticker?: string, forceRefresh?: boolean) {
  return invoke<import('../types').AnalystReportPayload>('get_analyst_reports', { ticker, forceRefresh });
}

/** Uygulama içinde açılan bir analiz raporunun indirilmiş gövdesi. */
export interface ReportDocument {
  content_type: string;
  base64: string;
  bytes: number;
}

/**
 * Rapor belgesini uygulama üzerinden indirir.
 *
 * Aracı kurumların PDF'leri `X-Frame-Options` ile korunduğundan adres doğrudan
 * bir çerçeveye verilemiyor; belge burada indirilip görüntüleyiciye veri
 * olarak geçirilir.
 */
export function getReportDocument(url: string) {
  return invoke<ReportDocument>('get_report_document', { url });
}

export function getCorporateEvents() {
  return invoke<import('../types').CorporateEventsPayload>('get_corporate_events');
}

export function runAgentAnalysis(agentId: string) {
  return invoke<import('../types').AgentAnalysisResult>('run_agent_analysis', { agentId });
}

export function getKapForTicker(ticker: string) {
  return invoke<import('../types').KapAnnouncement[]>('get_kap_for_ticker', { ticker });
}

export function getShareholders(ticker: string, forceRefresh = false) {
  return invoke<import('../types').ShareholderSnapshot>('get_shareholders', { ticker, forceRefresh });
}

export function researchEntityNews(name: string, kind: 'company' | 'person') {
  return invoke<NewsItem[]>('research_entity_news', { name, kind });
}

export function getSubsidiaries(ticker: string, forceRefresh = false) {
  return invoke<import('../types').SubsidiarySnapshot>('get_subsidiaries', { ticker, forceRefresh });
}

export function getIpoCalendar(forceRefresh = false) {
  return invoke<import('../types').IpoCalendarPayload>('get_ipo_calendar', { forceRefresh });
}

// ── KAP izleme motoru ──────────────────────────────────────────────────────

type MonitorState = import('../types').MonitorState;

export function getMonitorState() {
  return invoke<MonitorState>('get_monitor_state');
}

export function syncMonitorTickers(tickers: string[]) {
  return invoke<MonitorState>('sync_monitor_tickers', { tickers });
}

export function setMonitorConfig(patch: {
  enabled?: boolean;
  interval_secs?: number;
  agent_id?: string;
  os_notifications?: boolean;
  clear_agent?: boolean;
}) {
  return invoke<MonitorState>('set_monitor_config', {
    enabled: patch.enabled ?? null,
    intervalSecs: patch.interval_secs ?? null,
    agentId: patch.agent_id ?? null,
    osNotifications: patch.os_notifications ?? null,
    clearAgent: patch.clear_agent ?? null,
  });
}

export function runMonitorNow() {
  return invoke<MonitorState>('run_monitor_now');
}

export function markMonitorAlertsRead() {
  return invoke<MonitorState>('mark_monitor_alerts_read');
}

export function clearMonitorAlerts() {
  return invoke<MonitorState>('clear_monitor_alerts');
}

// ── Araştırma işleri (agent takımı + Chrome eklentisi görevleri) ──────────────

type ResearchJob = import('../types').ResearchJob;
type TeamConfig = import('../types').TeamConfig;
type SubmitResearchJobRequest = import('../types').SubmitResearchJobRequest;
type BridgeInfo = import('../types').BridgeInfo;

export function submitResearchJob(request: SubmitResearchJobRequest) {
  return invoke<string>('submit_research_job', { request });
}

export function listResearchJobs() {
  return invoke<ResearchJob[]>('list_research_jobs');
}

export function getResearchJob(id: string) {
  return invoke<ResearchJob | null>('get_research_job', { id });
}

export function deleteResearchJob(id: string) {
  return invoke<void>('delete_research_job', { id });
}

export function cancelResearchJob(id: string) {
  return invoke<void>('cancel_research_job', { id });
}

export function getTeamConfig() {
  return invoke<TeamConfig>('get_team_config');
}

export function saveTeamConfig(config: TeamConfig) {
  return invoke<TeamConfig>('save_team_config', { config });
}

export function getBridgeInfo() {
  return invoke<BridgeInfo>('get_bridge_info');
}

export function regenerateBridgeToken() {
  return invoke<BridgeInfo>('regenerate_bridge_token');
}

export interface BridgeAccount {
  email: string;
  name: string;
}

/** Giriş yapmış üyeyi köprüye bildirir (çıkışta null). */
export function setBridgeIdentity(account: BridgeAccount | null) {
  return invoke<void>('set_bridge_identity', { account });
}
