import { lazy } from 'react';
import type { ReactNode } from 'react';
import type { EquityRow, KapAnnouncement, MonitorState } from '../types';
import type { InstalledModule, ModuleManifest, ModulePermission } from './types';
import { isDesktopRuntime } from '../api/platformClient';

// ---------------------------------------------------------------------------
// Plug-and-play workspace registry ("tak-çıkar modüller")
//
// This file is the single source of truth for FRAUDE's workspace modules.
// To ADD a module: append one entry to `workspaceModules` below.
// To REMOVE a module: delete its entry. Nothing else in the app hardcodes the
// list — App.tsx, the sidebar, the tab bar, the FMUP catalog, and the Module
// Center are all derived from this array.
// ---------------------------------------------------------------------------

const AiPanel = lazy(() => import('../features/ai/AiPanel'));
const DashboardView = lazy(() => import('../features/dashboard/DashboardView'));
const KapFeedView = lazy(() => import('../features/kap/KapFeedView'));
const ScreenerView = lazy(() => import('../features/screener/ScreenerView'));
const SettingsView = lazy(() => import('../features/settings/SettingsView'));
const TickerView = lazy(() => import('../features/ticker/TickerView'));
const IndexView = lazy(() => import('../features/index/IndexView'));
const NewsFeedView = lazy(() => import('../features/news/NewsFeedView'));
const FundsView = lazy(() => import('../features/funds/FundsView'));
const ModuleCenterView = lazy(() => import('../features/modules/ModuleCenterView'));
const TeamView = lazy(() => import('../features/team/TeamView'));
const CorporateActionsView = lazy(() => import('../features/corporate/CorporateActionsView'));
const MonitorView = lazy(() => import('../features/monitor/MonitorView'));
const GuideView = lazy(() => import('../features/guide/GuideView'));
const PublishView = lazy(() => import('../features/publish/PublishView'));

export const CORE_VERSION = '0.1.4';

/** A single open workspace tab. `data` carries per-tab payloads. */
export interface WorkspaceTab {
  id: string;
  /** Matches a `WorkspaceModule.kind`. */
  kind: string;
  /** Display title for ephemeral tabs (ticker/index symbols). */
  title?: string;
  /** Structured per-tab payload (screener rows, kap rows, ticker symbol, ...). */
  data?: Record<string, unknown>;
}

/** Shared services handed to every module's `render` function. */
export interface ModuleHost {
  t: (key: string) => string;
  lang: 'tr' | 'en';
  activeContext: string;
  openTicker: (ticker: string) => void;
  openIndex: (symbol: string) => void;
  monitor: {
    state: MonitorState | null;
    setState: (state: MonitorState) => void;
  };
  moduleCenter: {
    modules: Array<{ manifest: ModuleManifest; installed?: InstalledModule }>;
    onToggle: (id: ModuleManifest['id'], enabled: boolean) => void;
    onInstalledModulesChange: (modules: InstalledModule[]) => void;
  };
}

/**
 * A plug-in workspace module.
 *
 * - Entries WITH a `manifest` join the FMUP catalog and can be freely enabled
 *   or disabled from the Module Center ("tak-çıkar").
 * - Entries WITHOUT a `manifest` are always-on core views (Module Center) or
 *   internal detail views (ticker/index) opened on demand.
 */
export interface WorkspaceModule {
  /** Unique tab kind / registry key. */
  kind: string;
  /** FMUP manifest. Present => catalog module, toggle-able in Module Center. */
  manifest?: ModuleManifest;
  /** i18n key for the default tab / nav title. */
  titleKey?: string;
  /** Dynamic title override (e.g. unread badges). Falls back to `titleKey`. */
  title?: (host: ModuleHost, tab: WorkspaceTab) => string;
  /** Show in the sidebar navigation. Default: true for catalog modules. */
  nav?: boolean;
  /** Open as a tab on startup. Default: true for catalog modules. */
  defaultTab?: boolean;
  /**
   * Geçici sekme: başka bir sekmeye geçilince sekme çubuğundan kendiliğinden
   * kalkar (Ayarlar/Rehber gibi araç görünümleri kalıcı yer kaplamaz).
   */
  transient?: boolean;
  /** Render the tab body. `tab` carries per-tab params, `host` shared services. */
  render: (tab: WorkspaceTab, host: ModuleHost) => ReactNode;
}

/** Concise builder so each manifest reads as one line in the registry. */
function manifest(
  id: ModuleManifest['id'],
  name: ModuleManifest['name'],
  description: ModuleManifest['description'],
  permissions: ModulePermission[],
  tabKind: string,
  titleKey: string,
): ModuleManifest {
  return {
    schemaVersion: 1,
    id,
    version: CORE_VERSION,
    name,
    description,
    kind: 'workspace',
    channel: 'official',
    targets: ['web', 'desktop'],
    compatibility: { fraude: '>=0.1.0 <1.0.0' },
    permissions,
    navigation: { tabKind, titleKey },
  };
}

export const workspaceModules: WorkspaceModule[] = [
  {
    kind: 'dashboard',
    titleKey: 'dashboard',
    manifest: manifest(
      'fraude.dashboard',
      { tr: 'Pano', en: 'Dashboard' },
      { tr: 'Piyasa özeti ve karar destek panelleri.', en: 'Market overview and decision-support panels.' },
      ['api:market-data', 'storage:workspace'],
      'dashboard',
      'dashboard',
    ),
    render: (_tab, host) => (
      <DashboardView onSelectTicker={host.openTicker} />
    ),
  },
  {
    kind: 'screener',
    titleKey: 'technicalScreener',
    manifest: manifest(
      'fraude.screener',
      { tr: 'Teknik Tarayıcı', en: 'Technical Screener' },
      { tr: 'FQL ile teknik ve temel analiz taramaları.', en: 'Technical and fundamental scans with FQL.' },
      ['api:market-data', 'api:fundamentals'],
      'screener',
      'technicalScreener',
    ),
    render: (tab, host) => (
      <ScreenerView
        initialRows={tab.data?.rows as EquityRow[] | undefined}
        onSelectTicker={host.openTicker}
      />
    ),
  },
  {
    kind: 'kap',
    titleKey: 'kapFeed',
    manifest: manifest(
      'fraude.kap',
      { tr: 'KAP Akışı', en: 'KAP Feed' },
      { tr: 'Şirket bildirimleri ve kaynak bağlantıları.', en: 'Company disclosures and source links.' },
      ['api:kap'],
      'kap',
      'kapFeed',
    ),
    render: (tab) => <KapFeedView initialRows={tab.data?.rows as KapAnnouncement[] | undefined} />,
  },
  {
    kind: 'news',
    titleKey: 'newsFeed',
    manifest: manifest(
      'fraude.news',
      { tr: 'Haber Akışı', en: 'News Feed' },
      { tr: 'Şirket haberleri, kısa özetler ve kaynak bağlantıları.', en: 'Company news, short summaries, and source links.' },
      ['api:news'],
      'news',
      'newsFeed',
    ),
    render: () => <NewsFeedView />,
  },
  {
    kind: 'funds',
    titleKey: 'funds',
    manifest: manifest(
      'fraude.funds',
      { tr: 'Fonlar', en: 'Funds' },
      {
        tr: 'TEFAS yatırım, emeklilik ve borsa yatırım fonları; portföy dağılımı ve kurucu künyesi.',
        en: 'TEFAS mutual, pension and exchange-traded funds; portfolio breakdown and issuer profile.',
      },
      ['api:market-data'],
      'funds',
      'funds',
    ),
    render: () => <FundsView />,
  },
  {
    kind: 'ai',
    titleKey: 'aiResearch',
    manifest: manifest(
      'fraude.ai-research',
      { tr: 'Yapay Zeka Araştırma', en: 'AI Research' },
      { tr: 'Seçili bağlam üzerinde sağlayıcı bağımsız araştırma.', en: 'Provider-independent research on the selected context.' },
      ['api:ai-provider', 'storage:workspace'],
      'ai',
      'aiResearch',
    ),
    render: (_tab, host) => <AiPanel mode="workspace" activeContext={host.activeContext} />,
  },
  {
    kind: 'team',
    titleKey: 'team',
    manifest: manifest(
      'fraude.team',
      { tr: 'Ekip', en: 'Team' },
      { tr: 'Ekip çalışma alanı ve paylaşılan izleme listeleri.', en: 'Team workspace and shared watchlists.' },
      ['storage:workspace'],
      'team',
      'team',
    ),
    render: () => <TeamView />,
  },
  {
    kind: 'monitor',
    titleKey: 'monitor',
    title: (host) => {
      const unread = host.monitor.state?.unread ?? 0;
      return `${host.t('monitor')}${unread > 0 ? ` (${unread})` : ''}`;
    },
    manifest: manifest(
      'fraude.monitor',
      { tr: 'İzleme Radarı', en: 'Monitor Radar' },
      { tr: 'Fiyat ve bildirim uyarıları için canlı izleme radarı.', en: 'Live radar for price and disclosure alerts.' },
      ['api:market-data', 'storage:workspace'],
      'monitor',
      'monitor',
    ),
    render: (_tab, host) => (
      <MonitorView
        state={host.monitor.state}
        onState={host.monitor.setState}
        onSelectTicker={host.openTicker}
      />
    ),
  },
  {
    kind: 'corporate',
    titleKey: 'corporateActions',
    manifest: manifest(
      'fraude.corporate-actions',
      { tr: 'Kurumsal Aksiyonlar', en: 'Corporate Actions' },
      { tr: 'Temettü, sermaye artırımı ve halka arz takibi.', en: 'Dividend, capital increase and IPO tracking.' },
      ['network:yahoo'],
      'corporate',
      'corporateActions',
    ),
    render: (_tab, host) => <CorporateActionsView onSelectTicker={host.openTicker} />,
  },
  {
    kind: 'guide',
    titleKey: 'guide',
    // Kenar çubuğunda değil, üst çubuktaki kitap ikonunda yaşar (App.tsx);
    // komut paleti girişini App ayrıca ekler. Açılışta sekme de açmaz —
    // yalnızca ikondan/paletten istenince gelir.
    nav: false,
    defaultTab: false,
    transient: true,
    manifest: manifest(
      'fraude.guide',
      { tr: 'Rehber', en: 'Guide' },
      { tr: 'FRAUDE terminali için kullanım rehberi ve ipuçları.', en: 'Usage guide and tips for the FRAUDE terminal.' },
      ['storage:workspace'],
      'guide',
      'guide',
    ),
    render: () => <GuideView />,
  },
  // Admin-only publishing surface. Core view (no manifest → not toggle-able);
  // desktop-only in the sidebar because the private signing key lives locally.
  {
    kind: 'publish',
    titleKey: 'publish',
    nav: isDesktopRuntime(),
    defaultTab: false,
    render: () => <PublishView />,
  },
  {
    kind: 'settings',
    titleKey: 'settings',
    // Kenar çubuğunda değil, üst çubuktaki dişli ikonunda yaşar (App.tsx, ⌘,);
    // komut paleti girişini App ayrıca ekler. Açılışta sekme de açmaz —
    // yalnızca ikondan/paletten (⌘,) istenince gelir.
    nav: false,
    defaultTab: false,
    transient: true,
    manifest: manifest(
      'fraude.settings',
      { tr: 'Ayarlar', en: 'Settings' },
      { tr: 'Yerel sağlayıcı ve terminal yapılandırması.', en: 'Local provider and terminal configuration.' },
      ['storage:settings'],
      'settings',
      'settings',
    ),
    render: () => <SettingsView />,
  },
  // Always-on core view: the control panel that enables/disables everything
  // else. Has no manifest, so it is never itself removable — the way back in.
  {
    kind: 'modules',
    titleKey: 'moduleCenter',
    nav: true,
    defaultTab: true,
    render: (_tab, host) => (
      <ModuleCenterView
        modules={host.moduleCenter.modules}
        onInstalledModulesChange={host.moduleCenter.onInstalledModulesChange}
        onToggle={host.moduleCenter.onToggle}
      />
    ),
  },
  // Internal detail views, opened on demand (no manifest, no nav, no default tab).
  {
    kind: 'ticker',
    render: (tab) => <TickerView ticker={String(tab.data?.ticker ?? tab.title ?? '')} />,
  },
  {
    kind: 'index',
    render: (tab, host) => (
      <IndexView symbol={String(tab.data?.symbol ?? tab.title ?? '')} onSelectTicker={host.openTicker} />
    ),
  },
];

const byKind = new Map(workspaceModules.map((module) => [module.kind, module]));
const byManifestId = new Map(
  workspaceModules
    .filter((module) => module.manifest)
    .map((module) => [module.manifest!.id, module]),
);

export function getWorkspaceModule(kind: string): WorkspaceModule | undefined {
  return byKind.get(kind);
}

export function getWorkspaceModuleById(id: ModuleManifest['id']): WorkspaceModule | undefined {
  return byManifestId.get(id);
}

/** True when a module should be treated as active (rendered in nav/tabs). */
export function isModuleEnabled(module: WorkspaceModule, installed: InstalledModule[]): boolean {
  if (!module.manifest) return true; // core / internal views are always available
  return installed.find((item) => item.id === module.manifest!.id)?.enabled ?? false;
}

/** Whether this module contributes a sidebar nav entry. */
export function moduleHasNav(module: WorkspaceModule): boolean {
  if (module.nav !== undefined) return module.nav;
  return Boolean(module.manifest);
}

/** Whether this module opens as a tab on startup / when enabled. */
export function moduleIsDefaultTab(module: WorkspaceModule): boolean {
  if (module.defaultTab !== undefined) return module.defaultTab;
  return Boolean(module.manifest);
}

export function moduleIsTransient(module: WorkspaceModule | undefined): boolean {
  return Boolean(module?.transient);
}

/** FMUP catalog, derived from every registry entry that ships a manifest. */
export const moduleCatalog: ModuleManifest[] = workspaceModules
  .filter((module): module is WorkspaceModule & { manifest: ModuleManifest } => Boolean(module.manifest))
  .map((module) => module.manifest);

export function getModuleManifest(id: ModuleManifest['id']): ModuleManifest | undefined {
  return byManifestId.get(id)?.manifest;
}
