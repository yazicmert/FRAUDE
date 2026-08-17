import type { WorkspaceTab } from '../modules/workspaceRegistry';
import { workspaceModules, isModuleEnabled } from '../modules/workspaceRegistry';
import type { InstalledModule } from '../modules/types';

const OPEN_TABS_KEY = 'fraude-open-tabs';
const ACTIVE_TAB_KEY = 'fraude-active-tab-id';
const TICKER_HISTORY_KEY = 'fraude-ticker-history';
const READ_ARTICLES_KEY = 'fraude-read-articles';
const SEARCH_HISTORY_KEY = 'fraude-search-history';
const LAST_SEARCH_KEY = 'fraude-last-searched-query';

/**
 * Açık sekmeleri yerel depolamaya kaydeder.
 */
export function saveOpenTabs(tabs: WorkspaceTab[]): void {
  try {
    localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(tabs));
  } catch (e) {
    console.warn('saveOpenTabs error:', e);
  }
}

/**
 * Açık sekmeleri yerel depolamadan yükler.
 * Devre dışı bırakılmış modülleri ayıklar, ephemeral sekmeleri (hisse, endeks vb.) korur.
 */
export function loadOpenTabs(installed: InstalledModule[]): WorkspaceTab[] | null {
  try {
    const raw = localStorage.getItem(OPEN_TABS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    const validTabs: WorkspaceTab[] = [];
    for (const tab of parsed) {
      if (!tab || typeof tab.id !== 'string' || typeof tab.kind !== 'string') continue;

      // Ephemeral sekmeler (ticker, index vb.) her zaman geçerlidir
      if (tab.kind === 'ticker' || tab.kind === 'index' || tab.kind.startsWith('custom-')) {
        validTabs.push(tab);
        continue;
      }

      // Modül sekmeleri: modülün yüklü ve etkin olduğunu doğrula
      const mod = workspaceModules.find((m) => m.kind === tab.kind);
      if (mod && isModuleEnabled(mod, installed)) {
        validTabs.push(tab);
      }
    }

    return validTabs.length > 0 ? validTabs : null;
  } catch (e) {
    console.warn('loadOpenTabs error:', e);
    return null;
  }
}

/**
 * Aktif sekme ID'sini kaydeder.
 */
export function saveActiveTabId(tabId: string): void {
  try {
    localStorage.setItem(ACTIVE_TAB_KEY, tabId);
  } catch (e) {
    console.warn('saveActiveTabId error:', e);
  }
}

/**
 * Aktif sekme ID'sini yükler.
 */
export function loadActiveTabId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_TAB_KEY);
  } catch (e) {
    return null;
  }
}

/**
 * Hisse arama / ziyaret geçmişini günceller.
 */
export function recordTickerSearch(ticker: string): void {
  try {
    const raw = localStorage.getItem(TICKER_HISTORY_KEY);
    const history: string[] = raw ? JSON.parse(raw) : [];
    const upper = ticker.toUpperCase().trim();
    const updated = [upper, ...history.filter((t) => t !== upper)].slice(0, 50);
    localStorage.setItem(TICKER_HISTORY_KEY, JSON.stringify(updated));
    localStorage.setItem(LAST_SEARCH_KEY, upper);
  } catch (e) {
    console.warn('recordTickerSearch error:', e);
  }
}

/**
 * Arama geçmişini döner.
 */
export function getTickerHistory(): string[] {
  try {
    const raw = localStorage.getItem(TICKER_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

/**
 * Genel komut/arama geçmişini kaydeder.
 */
export function recordSearchQuery(query: string): void {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
    const history: string[] = raw ? JSON.parse(raw) : [];
    const trimmed = query.trim();
    if (!trimmed) return;
    const updated = [trimmed, ...history.filter((q) => q !== trimmed)].slice(0, 50);
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(updated));
    localStorage.setItem(LAST_SEARCH_KEY, trimmed);
  } catch (e) {
    console.warn('recordSearchQuery error:', e);
  }
}

/**
 * Okunan haberi kaydeder (URL / Link üzerinden).
 */
export function markArticleAsRead(link: string): void {
  try {
    const raw = localStorage.getItem(READ_ARTICLES_KEY);
    const readList: string[] = raw ? JSON.parse(raw) : [];
    if (!readList.includes(link)) {
      const updated = [link, ...readList].slice(0, 1000); // Son 1000 okunan haber
      localStorage.setItem(READ_ARTICLES_KEY, JSON.stringify(updated));
      window.dispatchEvent(new CustomEvent('fraude-article-read', { detail: link }));
    }
  } catch (e) {
    console.warn('markArticleAsRead error:', e);
  }
}

/**
 * Haberin okunup okunmadığını kontrol eder.
 */
export function isArticleRead(link: string): boolean {
  try {
    const raw = localStorage.getItem(READ_ARTICLES_KEY);
    if (!raw) return false;
    const readList: string[] = JSON.parse(raw);
    return Array.isArray(readList) && readList.includes(link);
  } catch (e) {
    return false;
  }
}

/**
 * Tüm okunan haber linkleri kümesini döner.
 */
export function getReadArticlesSet(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_ARTICLES_KEY);
    if (!raw) return new Set();
    const readList: string[] = JSON.parse(raw);
    return new Set(readList);
  } catch (e) {
    return new Set();
  }
}
