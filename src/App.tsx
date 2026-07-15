import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { executeFql, syncData } from './api/tauriClient';
import { isDataRuntimeConfigured } from './api/platformClient';
import TabBar from './features/tabs/TabBar';
import TerminalPanel from './features/terminal/TerminalPanel';
import TopSearch from './components/TopSearch';
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
import { getMarketStatus, type MarketStatus } from './lib/marketHours';
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
  return workspaceModules
    .filter((module) => moduleIsDefaultTab(module) && isModuleEnabled(module, installed))
    .map((module) => ({ id: module.kind, kind: module.kind }));
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

  const toggleSidebar = () => {
    const next = !showSidebar;
    setShowSidebar(next);
    localStorage.setItem('fraude-show-sidebar', JSON.stringify(next));
  };
  const toggleTerminal = () => {
    const next = !showTerminal;
    setShowTerminal(next);
    localStorage.setItem('fraude-show-terminal', JSON.stringify(next));
  };
  const toggleRightPanel = () => {
    const next = !showRightPanel;
    setShowRightPanel(next);
    localStorage.setItem('fraude-show-right-panel', JSON.stringify(next));
  };

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
      localStorage.setItem('fraude-show-right-panel', JSON.stringify(true));
      setAiQuickPrompt({ text: prompt, nonce: Date.now() });
    };
    const onOpenPalette = () => setPaletteOpen(true);
    const onOpenShare = () => setShareOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('fraude-open-alerts', onOpenAlerts);
    window.addEventListener('fraude-ai-ask', onAiAsk);
    window.addEventListener('fraude-open-palette', onOpenPalette);
    window.addEventListener('fraude-open-share', onOpenShare);
    window.addEventListener('keydown', onKey);
    const statusTimer = setInterval(() => setMarketStatus(getMarketStatus()), 30_000);
    return () => {
      window.removeEventListener('fraude-open-alerts', onOpenAlerts);
      window.removeEventListener('fraude-ai-ask', onAiAsk);
      window.removeEventListener('fraude-open-palette', onOpenPalette);
      window.removeEventListener('fraude-open-share', onOpenShare);
      window.removeEventListener('keydown', onKey);
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

  // Komut paleti eylemleri: navigasyon modülleri + panel aç/kapatma + alarm + senkron.
  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    const cmds: PaletteCommand[] = [];
    for (const m of navModules) {
      const title = m.title ? m.title(host, { id: m.kind, kind: m.kind }) : t(m.titleKey ?? m.kind);
      cmds.push({ id: `open-${m.kind}`, label: `Aç · ${title}`, keywords: `${m.kind} ${title} panel modül`, hint: 'panel', run: () => openModuleTab(m.kind) });
    }
    cmds.push({ id: 'toggle-sidebar', label: 'Kenar çubuğunu aç/kapat', keywords: 'sidebar kenar', run: toggleSidebar });
    cmds.push({ id: 'toggle-terminal', label: 'Terminali aç/kapat', keywords: 'terminal konsol', run: toggleTerminal });
    cmds.push({ id: 'toggle-ai', label: 'AI panelini aç/kapat', keywords: 'ai yapay zeka panel', run: toggleRightPanel });
    cmds.push({ id: 'open-alerts', label: 'Alarmları aç', keywords: 'alarm alert fiyat teknik', hint: 'alarm', run: () => { setAlertsTicker(undefined); setAlertsOpen(true); } });
    cmds.push({ id: 'sync', label: 'Verileri şimdi senkronla', keywords: 'sync senkron güncelle veri', run: () => void handleCommand('sync all incremental') });
    cmds.push({ id: 'share', label: 'Yedekle & Paylaş', keywords: 'yedek paylaş export import dışa içe aktar', hint: 'yedek', run: () => setShareOpen(true) });
    return cmds;
  }, [navModules, host, t, openModuleTab, handleCommand]);

  const recentTickers = useMemo<string[]>(() => {
    if (!paletteOpen) return [];
    try {
      const h = JSON.parse(localStorage.getItem('fraude-ticker-history') || '[]');
      return Array.isArray(h) ? h : [];
    } catch {
      return [];
    }
  }, [paletteOpen]);

  const shellStyle = {
    gridTemplateColumns: `${showSidebar ? '208px' : '0px'} minmax(0, 1fr) ${showRightPanel ? '300px' : '0px'}`,
    gridTemplateRows: `52px minmax(0, 1fr) ${showTerminal ? 'auto' : '0px'}`,
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
      <header className="topbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flex: 1 }}>
          <TopSearch
            placeholder={t('searchOrCommand')}
            onCommand={(cmd) => void handleCommand(cmd)}
            onSelectTicker={upsertTickerTab}
            onSelectIndex={upsertIndexTab}
          />
          <div className="connection-pill" style={{ opacity: 0.8 }}>{t('aiContext')}: {activeContext}</div>
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {/* Language Toggle */}
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginRight: '8px' }}>
            <button
              type="button"
              onClick={() => setLanguage('tr')}
              style={{
                padding: '4px 8px',
                fontSize: '0.75rem',
                fontFamily: 'var(--font-mono)',
                background: lang === 'tr' ? 'var(--accent-primary)' : 'transparent',
                color: lang === 'tr' ? '#000' : 'var(--text-muted)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              TR
            </button>
            <button
              type="button"
              onClick={() => setLanguage('en')}
              style={{
                padding: '4px 8px',
                fontSize: '0.75rem',
                fontFamily: 'var(--font-mono)',
                background: lang === 'en' ? 'var(--accent-primary)' : 'transparent',
                color: lang === 'en' ? '#000' : 'var(--text-muted)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              EN
            </button>
          </div>

          <div style={{ width: '1px', height: '20px', background: 'var(--border-color)' }} />

          {/* BIST seans durumu */}
          <div
            title={`Borsa İstanbul · ${marketStatus.istanbulTime} (TR)`}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '4px 10px', fontSize: '0.7rem', fontFamily: 'var(--font-mono)',
              color: marketStatus.color, border: '1px solid var(--border-color)',
              borderRadius: '4px', whiteSpace: 'nowrap',
            }}
          >
            <span style={{
              display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%',
              background: marketStatus.color,
              animation: marketStatus.state === 'open' ? 'pulse-dot 1.6s ease-in-out infinite' : 'none',
            }} />
            {marketStatus.label}
          </div>

          <div style={{ width: '1px', height: '20px', background: 'var(--border-color)' }} />

          {/* Fiyat & teknik alarm zili */}
          <button
            type="button"
            onClick={() => { setAlertsTicker(undefined); setAlertsOpen(true); }}
            title="Fiyat & Teknik Alarmlar"
            style={{
              position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '32px', height: '28px', fontSize: '0.95rem',
              background: alertsOpen ? 'var(--accent-primary)' : 'var(--bg-panel)',
              border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer',
            }}
          >
            <span>⏰</span>
            {alertUnread > 0 && (
              <span style={{
                position: 'absolute', top: '-6px', right: '-6px', minWidth: '16px', height: '16px',
                padding: '0 4px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: '#d29922', color: '#000', fontSize: '0.62rem', fontWeight: 700,
                borderRadius: '8px', boxSizing: 'border-box',
              }}>
                {alertUnread > 99 ? '99+' : alertUnread}
              </span>
            )}
          </button>

          <div style={{ width: '1px', height: '20px', background: 'var(--border-color)' }} />

          {/* İzleme Radarı zil rozeti — yalnızca modül etkinken görünür */}
          {monitorEnabled && (
            <>
              <button
                type="button"
                onClick={() => openModuleTab('monitor')}
                title={monitorState
                  ? `İzleme Radarı · ${monitorState.config.tickers.length} hisse izleniyor${monitorState.unread > 0 ? ` · ${monitorState.unread} yeni uyarı` : ''}`
                  : 'İzleme Radarı'}
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '32px',
                  height: '28px',
                  fontSize: '0.95rem',
                  background: activeTabId === 'monitor' ? 'var(--accent-primary)' : 'var(--bg-panel)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                <span style={{ filter: monitorState?.config.enabled ? 'none' : 'grayscale(1) opacity(0.5)' }}>🔔</span>
                {monitorState && monitorState.unread > 0 && (
                  <span style={{
                    position: 'absolute',
                    top: '-6px',
                    right: '-6px',
                    minWidth: '16px',
                    height: '16px',
                    padding: '0 4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#f85149',
                    color: '#fff',
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    borderRadius: '8px',
                    boxSizing: 'border-box',
                  }}>
                    {monitorState.unread > 99 ? '99+' : monitorState.unread}
                  </span>
                )}
              </button>

              <div style={{ width: '1px', height: '20px', background: 'var(--border-color)' }} />
            </>
          )}

          {/* Last Sync Indicator */}
          <div className="sync-indicator" style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 10px',
            fontSize: '0.7rem',
            fontFamily: 'var(--font-mono)',
            color: isSyncing ? 'var(--accent-primary)' : 'var(--text-muted)',
            background: isSyncing ? 'rgba(0, 255, 157, 0.08)' : 'transparent',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            transition: 'all 0.3s ease',
          }}>
            <span style={{
              display: 'inline-block',
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: isSyncing ? 'var(--accent-primary)' : (lastSyncTime ? '#3fb950' : '#8b949e'),
              animation: isSyncing ? 'pulse-dot 1.2s ease-in-out infinite' : 'none',
            }} />
            {isSyncing ? t('syncing') : `${t('lastSync')}: ${formatSyncTime(lastSyncTime, t)}`}
          </div>

          <div style={{ width: '1px', height: '20px', background: 'var(--border-color)', marginRight: '4px' }} />

          <button
            type="button"
            onClick={toggleSidebar}
            style={{
              padding: '4px 8px',
              fontSize: '0.75rem',
              fontFamily: 'var(--font-mono)',
              background: showSidebar ? 'var(--accent-primary)' : 'var(--bg-panel)',
              color: showSidebar ? '#000000' : 'var(--text-muted)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: showSidebar ? 'bold' : 'normal'
            }}
          >
            {t('sidebar')}: {showSidebar ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            onClick={toggleTerminal}
            style={{
              padding: '4px 8px',
              fontSize: '0.75rem',
              fontFamily: 'var(--font-mono)',
              background: showTerminal ? 'var(--accent-primary)' : 'var(--bg-panel)',
              color: showTerminal ? '#000000' : 'var(--text-muted)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: showTerminal ? 'bold' : 'normal'
            }}
          >
            {t('terminal')}: {showTerminal ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            onClick={toggleRightPanel}
            style={{
              padding: '4px 8px',
              fontSize: '0.75rem',
              fontFamily: 'var(--font-mono)',
              background: showRightPanel ? 'var(--accent-primary)' : 'var(--bg-panel)',
              color: showRightPanel ? '#000000' : 'var(--text-muted)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: showRightPanel ? 'bold' : 'normal'
            }}
          >
            {t('aiPanel')}: {showRightPanel ? 'ON' : 'OFF'}
          </button>
        </div>
      </header>
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
            <div style={{ flex: 1, minWidth: 0 }}>
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
              Panele git
            </button>
            <button
              type="button"
              onClick={dismissBrief}
              title="Kapat"
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
