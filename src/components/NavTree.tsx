import { useCallback, useMemo, useState } from 'react';
import {
  NAV_TREE,
  workspaceModules,
  getWorkspaceModule,
  isModuleEnabled,
  moduleHasNav,
  type ModuleHost,
  type NavEntry,
  type NavSection,
} from '../modules/workspaceRegistry';
import type { InstalledModule } from '../modules/types';

interface NavTreeProps {
  activeTabId: string;
  installedModules: InstalledModule[];
  host: ModuleHost;
  onOpen: (kind: string) => void;
  t: (key: string) => string;
}

const OPEN_KEY = 'fraude-nav-open';

/** Bir girişin (ve alt ağacının) menüde görünür olup olmadığı. */
function isEntryVisible(entry: NavEntry, installed: InstalledModule[]): boolean {
  switch (entry.type) {
    case 'soon':
      return true;
    case 'module': {
      const module = getWorkspaceModule(entry.kind);
      return Boolean(module && isModuleEnabled(module, installed));
    }
    case 'group':
      return entry.children.some((child) => isEntryVisible(child, installed));
  }
}

/** Bir grubun altında (herhangi bir derinlikte) aktif sekme var mı. */
function groupContainsActive(entry: NavEntry, activeTabId: string): boolean {
  if (entry.type !== 'group') return false;
  return entry.children.some((child) =>
    child.type === 'module'
      ? child.kind === activeTabId
      : groupContainsActive(child, activeTabId),
  );
}

export default function NavTree({ activeTabId, installedModules, host, onOpen, t }: NavTreeProps) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(OPEN_KEY);
      return saved ? (JSON.parse(saved) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });

  const toggle = useCallback((id: string) => {
    setOpen((cur) => {
      const next = { ...cur, [id]: !isOpen(cur, id) };
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      } catch {
        /* kalıcılık yoksa geç */
      }
      return next;
    });
  }, []);

  const renderEntry = useCallback(
    (entry: NavEntry, depth: number): React.ReactNode => {
      if (!isEntryVisible(entry, installedModules)) return null;

      if (entry.type === 'soon') {
        return (
          <div
            key={entry.id}
            className="nav-leaf nav-soon"
            style={{ paddingLeft: 16 + depth * 14 }}
            title={t('navComingSoon')}
          >
            <span>{t(entry.labelKey)}</span>
            <span className="nav-soon-badge">{t('navComingSoon')}</span>
          </div>
        );
      }

      if (entry.type === 'module') {
        const module = getWorkspaceModule(entry.kind);
        if (!module) return null;
        const label = module.title
          ? module.title(host, { id: module.kind, kind: module.kind })
          : t(module.titleKey ?? module.kind);
        return (
          <button
            type="button"
            key={entry.kind}
            className={`nav-leaf nav-item${activeTabId === entry.kind ? ' active' : ''}`}
            style={{ paddingLeft: 16 + depth * 14 }}
            onClick={() => onOpen(entry.kind)}
          >
            {label}
          </button>
        );
      }

      // group
      const expanded = isOpen(open, entry.id, entry.defaultOpen) || groupContainsActive(entry, activeTabId);
      return (
        <div key={entry.id} className="nav-group">
          <button
            type="button"
            className={`nav-group-head${expanded ? ' open' : ''}`}
            style={{ paddingLeft: 16 + depth * 14 }}
            onClick={() => toggle(entry.id)}
          >
            <span className="nav-chevron">{expanded ? '▾' : '▸'}</span>
            {entry.icon && <span className="nav-group-icon">{entry.icon}</span>}
            <span className="nav-group-label">{t(entry.labelKey)}</span>
          </button>
          {expanded && (
            <div className="nav-group-children">
              {entry.children.map((child) => renderEntry(child, depth + 1))}
            </div>
          )}
        </div>
      );
    },
    [activeTabId, installedModules, host, onOpen, open, toggle, t],
  );

  // Tak-çıkar güvencesi: ağaçta hiç yer verilmemiş ama etkin bir nav modülü
  // (ör. registry'ye sonradan eklenmiş) menüden kaybolmasın — "Diğer"e düşer.
  const sections = useMemo<NavSection[]>(() => {
    const referenced = new Set<string>();
    const collect = (entry: NavEntry) => {
      if (entry.type === 'module') referenced.add(entry.kind);
      else if (entry.type === 'group') entry.children.forEach(collect);
    };
    NAV_TREE.forEach((section) => section.entries.forEach(collect));

    const extras = workspaceModules.filter(
      (m) => moduleHasNav(m) && isModuleEnabled(m, installedModules) && !referenced.has(m.kind),
    );

    const base = NAV_TREE.filter((section) =>
      section.entries.some((entry) => isEntryVisible(entry, installedModules)),
    );

    if (extras.length === 0) return base;
    return [
      ...base,
      {
        id: 'other',
        labelKey: 'navOther',
        entries: extras.map((m) => ({ type: 'module', kind: m.kind }) as NavEntry),
      },
    ];
  }, [installedModules]);

  return (
    <nav className="nav nav-tree">
      {sections.map((section) => (
        <div key={section.id} className="nav-section">
          {section.labelKey && <div className="nav-section-label">{t(section.labelKey)}</div>}
          {section.entries.map((entry) => renderEntry(entry, 0))}
        </div>
      ))}
    </nav>
  );
}

/** defaultOpen'ı hesaba katan açık-durum okuması. */
function isOpen(state: Record<string, boolean>, id: string, defaultOpen = false): boolean {
  return state[id] ?? defaultOpen;
}
