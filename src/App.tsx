import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { executeFql, syncData, getMarketHolidays } from './api/tauriClient';
import { isDataRuntimeConfigured } from './api/platformClient';
import TabBar from './features/tabs/TabBar';
import TerminalPanel from './features/terminal/TerminalPanel';
import TopSearch from './components/TopSearch';
import MarketMarquee, { type MarqueeMode } from './components/MarketMarquee';
import { PRESET_SYMBOLS } from './components/symbolCatalog';
import { useTranslation } from './api/i18n';
import {
  getWorkspaceModule,
  getWorkspaceModuleById,
  isModuleEnabled,
  moduleHasNav,
  moduleIsDefaultTab,
  workspaceModules,
} from './modules/workspaceRegistry';
import type { ModuleHost, WorkspaceModule, WorkspaceTab } from './modules/workspaceRegistry';
import { useModuleRegistry } from './modules/useModuleRegistry';
import { useMonitor } from './hooks/useMonitor';
import { useAlerts } from './features/alerts/useAlerts';
import AlertsModal from './features/alerts/AlertsModal';
import ShareModal from './features/share/ShareModal';
import ToastHost from './components/Toast';
import CommandPalette, { type PaletteCommand } from './components/CommandPalette';
import MorningBriefModal from './components/MorningBriefModal';
import HotkeyTip from './components/HotkeyTip';
import EconomicCalendar from './components/EconomicCalendar';
import { ActivityIcon, BellIcon, BookOpenIcon, CalendarIcon, GearIcon, PanelBottomIcon, PanelLeftIcon, PanelRightIcon } from './components/icons';
import { matchesShortcut, shortcutKeys } from './lib/shortcuts';
import { getMarketStatus, type MarketStatus } from './lib/marketHours';
import { setFetchedHolidays } from './lib/marketHolidays';
import { ensureNotificationPermission } from './lib/notify';
import { useMorningBrief } from './hooks/useMorningBrief';
import type { FqlResponse } from './types';
import type { InstalledModule, ModuleManifest } from './modules/types';
import './App.css';

// The right-hand AI panel is always available regardless of the AI Research
// workspace module, so it is imported directly rather than through the registry.
const AiPanel = lazy(() => import('./features/ai/AiPanel'));

function formatSyncTime(date: Date | null, t: (key: string) => string): string {
  if (!date) return t('neverSynced');
  const now = Date.now();
  const diff = Math.floor((now - date.getTime()) / 1000);
  if (diff < 60) return t('justNow');
  if (diff < 3600) return `${Math.floor(diff / 60)} ${t('minutesAgo')}`;
  return `${Math.floor(diff / 3600)} ${t('hoursAgo')}`;
}

interface TerminalEntry {
  cmd: string;
  output: string;
  ok: boolean;
}

/** Build the initial set of open tabs from the enabled, default-tab modules. */
function initialOpenTabs(installed: InstalledModule[]): WorkspaceTab[] {
  const tabs = workspaceModules
    .filter((module) => moduleIsDefaultTab(module) && isModuleEnabled(module, installed))
    .map((module) => ({ id: module.kind, kind: module.kind }));
  // Modül durumu ne olursa olsun çalışma alanı asla boş açılmaz; pano her
  // zaman son çaredir.
  return tabs.length > 0 ? tabs : [{ id: 'dashboard', kind: 'dashboard' }];
}

/** Static (non-dynamic) title used for context labels. */
function staticTitle(tab: WorkspaceTab, t: (key: string) => string): string {
  const module = getWorkspaceModule(tab.kind);
  if (module?.titleKey) return t(module.titleKey);
  return tab.title ?? tab.kind;
}

export default function App() {
  const { t, lang, setLanguage } = useTranslation();
  const { modules, installedModules, toggleModule, replaceInstalledModules } = useModuleRegistry();
  const { state: monitorState, setState: setMonitorState } = useMonitor();
  const { unread: alertUnread } = useAlerts({ engine: true });
  const { brief: morningBrief, dismiss: dismissBrief } = useMorningBrief();

  const [alertsOpen, setAlertsOpen] = useState(false);
  const [alertsTicker, setAlertsTicker] = useState<string | undefined>(undefined);
  const [marketStatus, setMarketStatus] = useState<MarketStatus>(() => getMarketStatus());
  const [aiQuickPrompt, setAiQuickPrompt] = useState<{ text: string; nonce: number } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  // Rozet: bugünün yüksek etkili makro duyuru sayısı (takvim bileşeni bildirir).
  const [calendarHighToday, setCalendarHighToday] = useState(0);

  const [openTabs, setOpenTabs] = useState<WorkspaceTab[]>(() => initialOpenTabs(installedModules));
  const [activeTabId, setActiveTabId] = useState('dashboard');
  const [visitedTabIds, setVisitedTabIds] = useState<Set<string>>(() => new Set(['dashboard']));
  const [terminalHistory, setTerminalHistory] = useState<TerminalEntry[]>([]);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const [showSidebar, setShowSidebar] = useState(() => {
    const saved = localStorage.getItem('fraude-show-sidebar');
    return saved ? JSON.parse(saved) : true;
  });
  const [showTerminal, setShowTerminal] = useState(() => {
    const saved = localStorage.getItem('fraude-show-terminal');
    return saved ? JSON.parse(saved) : true;
  });
  const [showRightPanel, setShowRightPanel] = useState(() => {
    const saved = localStorage.getItem('fraude-show-right-panel');
    return saved ? JSON.parse(saved) : true;
  });

  const toggleSidebar = useCallback(() => setShowSidebar((v: boolean) => !v), []);
  const toggleTerminal = useCallback(() => setShowTerminal((v: boolean) => !v), []);
  const toggleRightPanel = useCallback(() => setShowRightPanel((v: boolean) => !v), []);

  // Panel görünürlüğü tek noktadan kalıcılaştırılır; toggle'lar böylece
  // klavye kısayolu dinleyicisinde de güvenle (bayat kapanış olmadan) kullanılır.
  useEffect(() => { localStorage.setItem('fraude-show-sidebar', JSON.stringify(showSidebar)); }, [showSidebar]);
  useEffect(() => { localStorage.setItem('fraude-show-terminal', JSON.stringify(showTerminal)); }, [showTerminal]);
  useEffect(() => { localStorage.setItem('fraude-show-right-panel', JSON.stringify(showRightPanel)); }, [showRightPanel]);

  // Sidebar navigation entries: every enabled module that opts into nav, in
  // registry order.
  const navModules = useMemo(
    () => workspaceModules.filter(
      (module) => moduleHasNav(module) && isModuleEnabled(module, installedModules),
    ),
    [installedModules],
  );

  // Keep the open-tab set consistent with the enabled modules: drop tabs for
  // modules that were just disabled; internal/ephemeral tabs are preserved.
  useEffect(() => {
    setOpenTabs((current) => {
      const next = current.filter((tab) => {
        const module = getWorkspaceModule(tab.kind);
        if (!module?.manifest) return true;
        return isModuleEnabled(module, installedModules);
      });
      // Süzme her sekmeyi kapatacaksa pano son çare olarak kalır; çalışma
      // alanı hiçbir modül durumunda boş kalamaz.
      if (next.length === 0) return [{ id: 'dashboard', kind: 'dashboard' }];
      return next.length === current.length ? current : next;
    });
  }, [installedModules]);

  // Never leave the active tab pointing at a closed tab.
  useEffect(() => {
    if (openTabs.length === 0) return;
    if (!openTabs.some((tab) => tab.id === activeTabId)) {
      const fallback = openTabs.find((tab) => tab.kind === 'dashboard')
        ?? openTabs.find((tab) => tab.kind === 'modules')
        ?? openTabs[0];
      setActiveTabId(fallback.id);
    }
  }, [openTabs, activeTabId]);

  useEffect(() => {
    setVisitedTabIds((current) => current.has(activeTabId) ? current : new Set([...current, activeTabId]));
  }, [activeTabId]);

  const activeTab = useMemo(
    () => openTabs.find((tab) => tab.id === activeTabId) ?? openTabs[0],
    [activeTabId, openTabs],
  );

  const activeContext = activeTab
    ? (activeTab.kind === 'ticker' ? String(activeTab.data?.ticker ?? activeTab.title ?? '') : staticTitle(activeTab, t))
    : '';

  // Şerit panoda endeksleri, diğer sayfalarda BIST gün içi hareketlerini akıtır.
  const marqueeMode: MarqueeMode = activeTab?.kind === 'dashboard' ? 'indices' : 'movers';

  const upsertTickerTab = useCallback((ticker: string) => {
    setOpenTabs((current) => {
      const filtered = current.filter((tab) => tab.kind !== 'ticker');
      return [...filtered, { id: `ticker-${ticker}`, kind: 'ticker', title: ticker, data: { ticker } }];
    });
    setActiveTabId(`ticker-${ticker}`);

    try {
      const history = JSON.parse(localStorage.getItem('fraude-ticker-history') || '[]');
      const newHistory = [ticker, ...history.filter((item: string) => item !== ticker)].slice(0, 50);
      localStorage.setItem('fraude-ticker-history', JSON.stringify(newHistory));
    } catch (e) {}
  }, []);

  const upsertIndexTab = useCallback((symbol: string) => {
    setOpenTabs((current) => {
      const id = `index-${symbol}`;
      if (current.some((tab) => tab.id === id)) return current;
      return [...current, { id, kind: 'index', title: symbol, data: { symbol } }];
    });
    setActiveTabId(`index-${symbol}`);
  }, []);

  // Ensure a module tab exists (opening it if needed), merge in payload, focus.
  const openModuleTab = useCallback((kind: string, data?: Record<string, unknown>) => {
    setOpenTabs((current) => {
      const withTab = current.some((tab) => tab.kind === kind)
        ? current
        : [...current, { id: kind, kind }];
      return data
        ? withTab.map((tab) => tab.kind === kind ? { ...tab, data: { ...tab.data, ...data } } : tab)
        : withTab;
    });
    setActiveTabId(kind);
  }, []);

  const closeTab = useCallback((id: string) => {
    setOpenTabs((current) => {
      const filtered = current.filter((tab) => tab.id !== id);
      if (activeTabId === id && filtered.length > 0) {
        const closedIdx = current.findIndex((tab) => tab.id === id);
        const nextIdx = closedIdx > 0 ? closedIdx - 1 : 0;
        setActiveTabId(current[nextIdx].id);
      }
      return filtered;
    });
  }, [activeTabId]);

  // Toggling a module from the Module Center. Enabling opens its tab; disabling
  // is handled by the reconciliation effect above.
  const handleModuleToggle = useCallback((id: ModuleManifest['id'], enabled: boolean) => {
    toggleModule(id, enabled);
    if (!enabled) return;
    const module = getWorkspaceModuleById(id);
    if (module && moduleIsDefaultTab(module)) {
      setOpenTabs((current) => current.some((tab) => tab.kind === module.kind)
        ? current
        : [...current, { id: module.kind, kind: module.kind }]);
    }
  }, [toggleModule]);

  const host: ModuleHost = useMemo(() => ({
    t,
    lang,
    activeContext,
    openTicker: upsertTickerTab,
    openIndex: upsertIndexTab,
    monitor: { state: monitorState, setState: setMonitorState },
    moduleCenter: {
      modules,
      onToggle: handleModuleToggle,
      onInstalledModulesChange: replaceInstalledModules,
    },
  }), [t, lang, activeContext, upsertTickerTab, upsertIndexTab, monitorState, setMonitorState, modules, handleModuleToggle, replaceInstalledModules]);

  const getTabTitle = useCallback((tab: WorkspaceTab): string => {
    const module = getWorkspaceModule(tab.kind);
    if (module?.title) return module.title(host, tab);
    if (module?.titleKey) return t(module.titleKey);
    return tab.title ?? tab.kind;
  }, [host, t]);

  const updateTabWithFql = useCallback((response: FqlResponse) => {
    if (response.command_type === 'open' && response.opened_tab) {
      const tabName = response.opened_tab.toUpperCase();
      // Yalnızca XU ve XB ile başlayanları veya BIST içerenleri endeks olarak kabul et, XAU (Altın) emtiadır ve TickerView'de açılır
      const isIndex = (tabName.startsWith('XU') || tabName.startsWith('XB') || tabName.startsWith('BIST')) && tabName !== 'XAU';
      if (isIndex) {
        upsertIndexTab(tabName);
      } else {
        upsertTickerTab(response.opened_tab);
      }
      return;
    }

    if (response.command_type === 'scan') {
      openModuleTab('screener', { rows: response.rows, query: response.message });
    }

    if (response.command_type === 'kap') {
      openModuleTab('kap', { rows: response.kap });
    }

    // Terminaldeki 'ask' yanıtları YZ paneline taşınmaz; panel bağımsız bir
    // sohbet alanıdır, terminal yanıtı kendi çıktısında gösterir.
  }, [upsertTickerTab, upsertIndexTab, openModuleTab]);

  const handleCommand = useCallback(
    async (cmd: string) => {
      try {
        const response = await executeFql(cmd, activeContext);
        updateTabWithFql(response);
        let output = response.message;
        if (response.command_type === 'open' && response.rows[0]) {
          const row = response.rows[0];
          output = `${t('terminalOpened')}: ${row.ticker} · ${row.name} @ ${row.price.toFixed(2)} (${row.change_pct >= 0 ? '+' : ''}${row.change_pct.toFixed(2)}%)`;
        } else if (response.command_type === 'scan') {
          output = `${response.rows.length} ${t('terminalCompaniesMatched')}`;
        } else if (response.command_type === 'kap') {
          output = `${response.kap.length} ${t('terminalKapFetched')}`;
        } else if (response.command_type === 'sync') {
          output = t('terminalSyncCompleted');
        } else if (response.command_type === 'help') {
          output = t('terminalHelp');
        } else if (response.command_type === 'ai' && response.ai) {
          output = response.ai.summary;
        }
        setTerminalHistory((prev) => [...prev, { cmd, output, ok: true }]);
      } catch (error: any) {
        console.error('FQL command failed:', error);
        setTerminalHistory((prev) => [
          ...prev,
          { cmd, output: typeof error === 'string' ? error : (error?.message || t('terminalCommandFailed')), ok: false },
        ]);
      }
    },
    [activeContext, t, updateTabWithFql],
  );

  useEffect(() => {
    setTerminalHistory([
      {
        cmd: 'help',
        output: t('terminalHelp'),
        ok: true,
      },
    ]);
  }, [lang]);

  useEffect(() => {
    if (!isDataRuntimeConfigured()) return;

    const refreshMarketData = async () => {
      try {
        setIsSyncing(true);
        await syncData('all', 'incremental');
        setLastSyncTime(new Date());
        window.dispatchEvent(new CustomEvent('fraude-sync-completed'));
      } catch (err) {
        console.error('Background sync failed:', err);
      } finally {
        setIsSyncing(false);
      }
    };

    void refreshMarketData();
    const interval = setInterval(refreshMarketData, 5 * 60 * 1000);

    // Update the relative time display every 30 seconds
    const displayInterval = setInterval(() => {
      setLastSyncTime(prev => prev ? new Date(prev.getTime()) : null);
    }, 30_000);

    return () => {
      clearInterval(interval);
      clearInterval(displayInterval);
    };
  }, []);

  // Bildirim izni + alarm penceresini açan olay + piyasa durumu saati.
  useEffect(() => {
    void ensureNotificationPermission();
    const onOpenAlerts = (e: Event) => {
      const detail = (e as CustomEvent<{ ticker?: string }>).detail;
      setAlertsTicker(detail?.ticker);
      setAlertsOpen(true);
    };
    // Proaktif AI: bir yerden tek-tık soru gelince sağ paneli aç ve prompt'u ilet.
    const onAiAsk = (e: Event) => {
      const prompt = (e as CustomEvent<{ prompt?: string }>).detail?.prompt;
      if (!prompt) return;
      setShowRightPanel(true);
      setAiQuickPrompt({ text: prompt, nonce: Date.now() });
    };
    const onOpenPalette = () => setPaletteOpen(true);
    const onOpenShare = () => setShareOpen(true);
    window.addEventListener('fraude-open-alerts', onOpenAlerts);
    window.addEventListener('fraude-ai-ask', onAiAsk);
    window.addEventListener('fraude-open-palette', onOpenPalette);
    window.addEventListener('fraude-open-share', onOpenShare);
    // Sağlam kaynaktan (Nager.Date, Rust get_market_holidays) resmi tatilleri
    // çek; yerleştir ve rozeti hemen güncelle. Çevrimdışıysa gömülü yedek takvim
    // (marketHolidays.ts) devrede kalır.
    getMarketHolidays()
      .then((list) => {
        setFetchedHolidays(list);
        setMarketStatus(getMarketStatus());
      })
      .catch(() => { /* çevrimdışı: gömülü yedek takvim kullanılır */ });
    const statusTimer = setInterval(() => setMarketStatus(getMarketStatus()), 30_000);
    return () => {
      window.removeEventListener('fraude-open-alerts', onOpenAlerts);
      window.removeEventListener('fraude-ai-ask', onAiAsk);
      window.removeEventListener('fraude-open-palette', onOpenPalette);
      window.removeEventListener('fraude-open-share', onOpenShare);
      clearInterval(statusTimer);
    };
  }, []);

  const renderTabContent = (tab: WorkspaceTab) => {
    const module = getWorkspaceModule(tab.kind);
    return module ? module.render(tab, host) : null;
  };

  const monitorEnabled = useMemo(() => {
    const module = getWorkspaceModule('monitor');
    return module ? isModuleEnabled(module, installedModules) : false;
  }, [installedModules]);

  // Rehber ve Ayarlar kenar çubuğunda değil üst çubukta yaşar (nav: false);
  // modül devre dışı bırakılmışsa ikonları da palet girişleri de gizlenir.
  const guideEnabled = useMemo(() => {
    const module = getWorkspaceModule('guide');
    return module ? isModuleEnabled(module, installedModules) : false;
  }, [installedModules]);
  const settingsEnabled = useMemo(() => {
    const module = getWorkspaceModule('settings');
    return module ? isModuleEnabled(module, installedModules) : false;
  }, [installedModules]);

  // Klavye kısayolları: tanımların tek kaynağı src/lib/shortcuts.ts. Üst çubuk
  // ipuçları ve kılavuz aynı listeden okuduğu için gösterilen her kısayol
  // burada gerçekten çalışır.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchesShortcut(e, 'palette')) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (matchesShortcut(e, 'sidebar')) {
        e.preventDefault();
        toggleSidebar();
      } else if (matchesShortcut(e, 'terminal')) {
        e.preventDefault();
        toggleTerminal();
      } else if (matchesShortcut(e, 'aiPanel')) {
        e.preventDefault();
        toggleRightPanel();
      } else if (matchesShortcut(e, 'alerts')) {
        e.preventDefault();
        setAlertsTicker(undefined);
        setAlertsOpen((v) => !v);
      } else if (matchesShortcut(e, 'monitor')) {
        if (!monitorEnabled) return;
        e.preventDefault();
        openModuleTab('monitor');
      } else if (matchesShortcut(e, 'sync')) {
        e.preventDefault();
        void handleCommand('sync all incremental');
      } else if (matchesShortcut(e, 'settings')) {
        e.preventDefault();
        openModuleTab('settings');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSidebar, toggleTerminal, toggleRightPanel, openModuleTab, handleCommand, monitorEnabled]);

  // Komut paleti eylemleri: navigasyon modülleri + panel aç/kapatma + alarm + senkron.
  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    const cmds: PaletteCommand[] = [];
    for (const m of navModules) {
      const title = m.title ? m.title(host, { id: m.kind, kind: m.kind }) : t(m.titleKey ?? m.kind);
      cmds.push({ id: `open-${m.kind}`, label: `${t('paletteOpen')} · ${title}`, keywords: `${m.kind} ${title} panel modül`, hint: t('hintPanel'), run: () => openModuleTab(m.kind) });
    }
    // Rehber ve Ayarlar nav dışı (üst çubuk ikonları); palete elle eklenir.
    if (guideEnabled) {
      cmds.push({ id: 'open-guide', label: `${t('paletteOpen')} · ${t('guide')}`, keywords: 'guide rehber kılavuz yardım help', hint: t('hintPanel'), run: () => openModuleTab('guide') });
    }
    if (settingsEnabled) {
      cmds.push({ id: 'open-settings', label: `${t('paletteOpen')} · ${t('settings')}`, keywords: 'settings ayarlar yapılandırma config', hint: t('hintPanel'), run: () => openModuleTab('settings') });
    }
    cmds.push({ id: 'toggle-sidebar', label: t('paletteToggleSidebar'), keywords: 'sidebar kenar', run: toggleSidebar });
    cmds.push({ id: 'toggle-terminal', label: t('paletteToggleTerminal'), keywords: 'terminal konsol', run: toggleTerminal });
    cmds.push({ id: 'toggle-ai', label: t('paletteToggleAi'), keywords: 'ai yapay zeka panel', run: toggleRightPanel });
    cmds.push({ id: 'open-alerts', label: t('paletteOpenAlerts'), keywords: 'alarm alert fiyat teknik', hint: t('hintAlert'), run: () => { setAlertsTicker(undefined); setAlertsOpen(true); } });
    cmds.push({ id: 'open-calendar', label: t('paletteOpenCalendar'), keywords: 'takvim calendar ekonomik makro tatil holiday', hint: t('hintCalendar'), run: () => setCalendarOpen(true) });
    // Banner kapatılmış olsa bile günlük özet buradan açılabilir.
    cmds.push({ id: 'daily-brief', label: t('paletteOpenBrief'), keywords: 'özet bülten brief piyasa günaydın sabah', hint: t('hintBrief'), run: () => setBriefOpen(true) });
    cmds.push({ id: 'sync', label: t('paletteSyncNow'), keywords: 'sync senkron güncelle veri', run: () => void handleCommand('sync all incremental') });
    cmds.push({ id: 'share', label: t('paletteShare'), keywords: 'yedek paylaş export import dışa içe aktar', hint: t('hintBackup'), run: () => setShareOpen(true) });
    return cmds;
  }, [navModules, host, t, openModuleTab, handleCommand, guideEnabled, settingsEnabled]);

  const recentTickers = useMemo<string[]>(() => {
    if (!paletteOpen) return [];
    try {
      const h = JSON.parse(localStorage.getItem('fraude-ticker-history') || '[]');
      return Array.isArray(h) ? h : [];
    } catch {
      return [];
    }
  }, [paletteOpen]);

  // Şerit sembolü katalogda bir endekse karşılık geliyorsa endeks sekmesi,
  // yoksa hisse sekmesi açılır.
  const openFromMarquee = useCallback((symbol: string) => {
    const preset = PRESET_SYMBOLS.find((item) => item.symbol === symbol);
    if (preset?.indexName) {
      upsertIndexTab(preset.indexName);
    } else {
      upsertTickerTab(symbol);
    }
  }, [upsertIndexTab, upsertTickerTab]);

  // Satır sayısı App.css'teki grid-template-areas ile birebir aynı olmak
  // ZORUNDA (topbar/marquee/workspace/terminal): eksik satır esnek alanı boş
  // şerit satırına kaydırır ve çalışma alanı pencere dışına itilir.
  const shellStyle = {
    gridTemplateColumns: `${showSidebar ? '208px' : '0px'} minmax(0, 1fr) ${showRightPanel ? '300px' : '0px'}`,
    gridTemplateRows: `52px auto minmax(0, 1fr) ${showTerminal ? 'auto' : '0px'}`,
  };

  return (
    <div className="app-shell" style={shellStyle}>
      {showSidebar && (
        <aside className="sidebar">
          <div className="logo">FRAUDE</div>
          <nav className="nav">
            {navModules.map((module: WorkspaceModule) => (
              <button
                type="button"
                key={module.kind}
                className={`nav-item ${activeTabId === module.kind ? 'active' : ''}`}
                onClick={() => openModuleTab(module.kind)}
              >
                {module.title
                  ? module.title(host, { id: module.kind, kind: module.kind })
                  : t(module.titleKey ?? module.kind)}
              </button>
            ))}
          </nav>
        </aside>
      )}
      <header className="topbar">
        <div className="topbar-group topbar-search">
          <TopSearch
            placeholder={t('searchOrCommand')}
            hintKeys={shortcutKeys('palette')}
            onCommand={(cmd) => void handleCommand(cmd)}
            onSelectTicker={upsertTickerTab}
            onSelectIndex={upsertIndexTab}
          />
          <div className="context-chip">
            <span className="context-chip-label">{t('aiContext')}</span>
            <span>{activeContext}</span>
          </div>
        </div>

        <div className="topbar-group">
          {/* BIST seans durumu */}
          <HotkeyTip label={`Borsa İstanbul · ${marketStatus.istanbulTime} (TR)`}>
            <div className="market-status" style={{ color: marketStatus.color }}>
              <span
                className="status-dot"
                style={{
                  background: marketStatus.color,
                  animation: marketStatus.state === 'open' ? 'pulse-dot 1.6s ease-in-out infinite' : 'none',
                }}
              />
              {marketStatus.state === 'open' ? t('marketOpen') : marketStatus.state === 'pre' ? t('marketPreOpen') : t('marketClosed')}
              {marketStatus.holidayName ? ` · ${marketStatus.holidayName}` : ''}
            </div>
          </HotkeyTip>

          {/* Eşitleme durumu; tıklanınca artımlı senkron başlar */}
          <HotkeyTip label={t('syncNow')} keys={shortcutKeys('sync')}>
            <button
              type="button"
              className={`sync-chip${isSyncing ? ' syncing' : ''}`}
              onClick={() => void handleCommand('sync all incremental')}
              disabled={isSyncing}
            >
              <span
                className="status-dot"
                style={{
                  background: isSyncing ? 'var(--accent-primary)' : (lastSyncTime ? '#3fb950' : '#8b949e'),
                  animation: isSyncing ? 'pulse-dot 1.2s ease-in-out infinite' : 'none',
                }}
              />
              {isSyncing ? t('syncing') : formatSyncTime(lastSyncTime, t)}
            </button>
          </HotkeyTip>

          <span className="topbar-sep" />

          {/* Fiyat & teknik alarm zili */}
          <HotkeyTip label={t('priceAlerts')} keys={shortcutKeys('alerts')}>
            <button
              type="button"
              className={`topbar-icon-btn${alertsOpen ? ' active' : ''}`}
              onClick={() => { setAlertsTicker(undefined); setAlertsOpen(true); }}
            >
              <BellIcon />
              {alertUnread > 0 && (
                <span className="topbar-badge amber">{alertUnread > 99 ? '99+' : alertUnread}</span>
              )}
            </button>
          </HotkeyTip>

          {/* Ekonomik takvim — makro duyurular + resmi tatiller */}
          <HotkeyTip label={t('economicCalendar')}>
            <div className="eco-cal-trigger">
              <button
                type="button"
                className={`topbar-icon-btn${calendarOpen ? ' active' : ''}`}
                // mousedown'u durdurmak, dropdown'ın "dışarı tıklandı" kapatması
                // ile toggle'ın çakışıp menünün anında yeniden açılmasını önler.
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => setCalendarOpen((v) => !v)}
              >
                <CalendarIcon />
                {calendarHighToday > 0 && (
                  <span className="topbar-badge red">{calendarHighToday}</span>
                )}
              </button>
              <EconomicCalendar
                open={calendarOpen}
                onClose={() => setCalendarOpen(false)}
                onCount={(_total, highToday) => setCalendarHighToday(highToday)}
              />
            </div>
          </HotkeyTip>

          {/* İzleme Radarı — yalnızca modül etkinken görünür */}
          {monitorEnabled && (
            <HotkeyTip label={t('monitor')} keys={shortcutKeys('monitor')}>
              <button
                type="button"
                className={`topbar-icon-btn${activeTabId === 'monitor' ? ' active' : ''}`}
                onClick={() => openModuleTab('monitor')}
                style={{ opacity: monitorState?.config.enabled ? 1 : 0.5 }}
              >
                <ActivityIcon />
                {monitorState && monitorState.unread > 0 && (
                  <span className="topbar-badge red">{monitorState.unread > 99 ? '99+' : monitorState.unread}</span>
                )}
              </button>
            </HotkeyTip>
          )}

          <span className="topbar-sep" />

          {/* Yerleşim anahtarları */}
          <HotkeyTip label={t('sidebar')} keys={shortcutKeys('sidebar')}>
            <button
              type="button"
              className={`topbar-icon-btn${showSidebar ? ' active' : ''}`}
              onClick={toggleSidebar}
            >
              <PanelLeftIcon />
            </button>
          </HotkeyTip>
          <HotkeyTip label={t('terminal')} keys={shortcutKeys('terminal')}>
            <button
              type="button"
              className={`topbar-icon-btn${showTerminal ? ' active' : ''}`}
              onClick={toggleTerminal}
            >
              <PanelBottomIcon />
            </button>
          </HotkeyTip>
          <HotkeyTip label={t('aiPanel')} keys={shortcutKeys('aiPanel')} align="right">
            <button
              type="button"
              className={`topbar-icon-btn${showRightPanel ? ' active' : ''}`}
              onClick={toggleRightPanel}
            >
              <PanelRightIcon />
            </button>
          </HotkeyTip>

          <span className="topbar-sep" />

          {/* Rehber ve Ayarlar: kenar çubuğundan üst çubuğa taşındı */}
          {guideEnabled && (
            <HotkeyTip label={t('guide')} align="right">
              <button
                type="button"
                className={`topbar-icon-btn${activeTabId === 'guide' ? ' active' : ''}`}
                onClick={() => openModuleTab('guide')}
              >
                <BookOpenIcon />
              </button>
            </HotkeyTip>
          )}
          {settingsEnabled && (
            <HotkeyTip label={t('settings')} keys={shortcutKeys('settings')} align="right">
              <button
                type="button"
                className={`topbar-icon-btn${activeTabId === 'settings' ? ' active' : ''}`}
                onClick={() => openModuleTab('settings')}
              >
                <GearIcon />
              </button>
            </HotkeyTip>
          )}

          <span className="topbar-sep" />

          {/* Dil seçimi */}
          <HotkeyTip label={t('language')} align="right">
            <div className="lang-seg">
              <button
                type="button"
                className={lang === 'tr' ? 'active' : ''}
                onClick={() => setLanguage('tr')}
              >
                TR
              </button>
              <button
                type="button"
                className={lang === 'en' ? 'active' : ''}
                onClick={() => setLanguage('en')}
              >
                EN
              </button>
            </div>
          </HotkeyTip>
        </div>
      </header>
      <MarketMarquee mode={marqueeMode} onOpenTicker={openFromMarquee} />
      <main className="workspace">
        <TabBar
          tabs={openTabs.map((tab) => ({ ...tab, title: getTabTitle(tab) }))}
          activeTabId={activeTabId}
          onSelect={setActiveTabId}
          onClose={closeTab}
        />
        {morningBrief && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '12px', margin: '8px 12px 0',
            padding: '10px 14px', background: 'linear-gradient(90deg, rgba(0,195,255,0.10), rgba(0,255,157,0.05))',
            border: '1px solid var(--border-color)', borderRadius: '8px',
          }}>
            <span style={{ fontSize: '1.2rem' }}>☀️</span>
            {/* Gövdeye tıklamak taze verili özet popup'ını açar */}
            <div
              role="button"
              tabIndex={0}
              title={t('paletteOpenBrief')}
              onClick={() => setBriefOpen(true)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setBriefOpen(true); }}
              style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
            >
              <strong style={{ fontSize: '0.85rem' }}>{morningBrief.headline}</strong>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                {morningBrief.lines.join('  ·  ')}
              </div>
            </div>
            <button
              type="button"
              onClick={() => openModuleTab('dashboard')}
              style={{ padding: '4px 10px', fontSize: '0.72rem', fontFamily: 'var(--font-mono)', background: 'var(--bg-panel)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              {t('goToDashboard')}
            </button>
            <button
              type="button"
              onClick={dismissBrief}
              title={t('close')}
              style={{ padding: '4px 8px', fontSize: '0.72rem', background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>
        )}
        {openTabs.filter((tab) => visitedTabIds.has(tab.id)).map((tab) => (
          <div
            key={tab.id}
            style={{
              display: tab.id === activeTabId ? 'flex' : 'none',
              flexDirection: 'column',
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
            }}
          >
            <Suspense fallback={<div className="module-loading-state">{t('loadingModule')}</div>}>
              {renderTabContent(tab)}
            </Suspense>
          </div>
        ))}
      </main>
      {showRightPanel && (
        <aside className="right-panel">
          <Suspense fallback={<div className="module-loading-state">{t('loadingModule')}</div>}>
            <AiPanel mode="side" activeContext={activeContext} quickPrompt={aiQuickPrompt} />
          </Suspense>
        </aside>
      )}
      {showTerminal && (
        <TerminalPanel history={terminalHistory} onCommand={handleCommand} />
      )}
      <AlertsModal open={alertsOpen} onClose={() => setAlertsOpen(false)} initialTicker={alertsTicker} />
      <ShareModal open={shareOpen} onClose={() => setShareOpen(false)} />
      <MorningBriefModal
        open={briefOpen}
        onClose={() => setBriefOpen(false)}
        onSelectTicker={upsertTickerTab}
        onOpenDashboard={() => openModuleTab('dashboard')}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={paletteCommands}
        onOpenTicker={upsertTickerTab}
        onRunFql={(c) => void handleCommand(c)}
        recentTickers={recentTickers}
      />
      <ToastHost />
    </div>
  );
}
