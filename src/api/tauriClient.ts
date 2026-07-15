import { invokePlatform as invoke } from './platformClient';
import type {
  AiKeyRecord,
  AiHistoryRecord,
  AiResponse,
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

export async function getFinancialStatements(ticker: string): Promise<FinancialStatement> {
  return invoke('get_financial_statements', { ticker });
}

export function runScreener(query: string, market = 'BIST100') {
  return invoke<ScreenerResult>('run_screener', {
    request: { market, query },
  });
}

export function listKapAnnouncements(ticker?: string) {
  return invoke<KapAnnouncement[]>('list_kap_announcements', {
    filter: { ticker, limit: 25 },
  });
}

export function askAi(
  prompt: string,
  activeContext?: string,
  agentId?: string,
  history?: import('../types').AiChatMessage[],
) {
  return invoke<AiResponse>('ask_ai', {
    request: { prompt, active_context: activeContext, agent_id: agentId, history },
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
