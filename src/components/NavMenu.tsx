import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  NAV_TREE,
  getWorkspaceModule,
  isModuleEnabled,
  type ModuleHost,
  type NavEntry,
} from '../modules/workspaceRegistry';
import type { InstalledModule } from '../modules/types';

interface NavMenuProps {
  activeTabId: string;
  installedModules: InstalledModule[];
  host: ModuleHost;
  onOpen: (kind: string) => void;
  t: (key: string) => string;
}

function isEntryVisible(entry: NavEntry, installed: InstalledModule[]): boolean {
  switch (entry.type) {
    case 'soon':
      return true;
    case 'module': {
      const m = getWorkspaceModule(entry.kind);
      return Boolean(m && isModuleEnabled(m, installed));
    }
    case 'group':
      return entry.children.some((c) => isEntryVisible(c, installed));
  }
}

function entryContainsActive(entry: NavEntry, active: string): boolean {
  if (entry.type === 'module') return entry.kind === active;
  if (entry.type === 'group') return entry.children.some((c) => entryContainsActive(c, active));
  return false;
}

/** Bir grubun görünür içeriği tek bir modüle iniyorsa (yer tutucu/alt grup yok)
 *  o modülün kind'ini döner; aksi halde null (açılır menü gerekir). */
function soleModule(entries: NavEntry[], installed: InstalledModule[]): string | null {
  const modules: string[] = [];
  let hasOther = false;
  const walk = (e: NavEntry) => {
    if (!isEntryVisible(e, installed)) return;
    if (e.type === 'module') modules.push(e.kind);
    else if (e.type === 'soon') hasOther = true;
    else e.children.forEach(walk);
  };
  entries.forEach(walk);
  return !hasOther && modules.length === 1 ? modules[0] : null;
}

type TopItem =
  | { kind: 'module'; moduleKind: string; labelKey?: string; icon?: string }
  | { kind: 'soon'; id: string; labelKey: string }
  | { kind: 'dropdown'; id: string; labelKey: string; icon?: string; entries: NavEntry[] };

export default function NavMenu({ activeTabId, installedModules, host, onOpen, t }: NavMenuProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpenId(null);
    setAnchor(null);
  }, []);

  // Dışarı tıkla / Esc / kaydırma-boyutlanma → kapat.
  useEffect(() => {
    if (!openId) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [openId, close]);

  const topItems = useMemo<TopItem[]>(() => {
    const items: TopItem[] = [];
    for (const section of NAV_TREE) {
      const visible = section.entries.filter((e) => isEntryVisible(e, installedModules));
      if (visible.length === 0) continue;

      if (section.menu === 'group') {
        const sole = soleModule(section.entries, installedModules);
        if (sole) items.push({ kind: 'module', moduleKind: sole, labelKey: section.labelKey });
        else items.push({ kind: 'dropdown', id: section.id, labelKey: section.labelKey!, entries: section.entries });
        continue;
      }

      for (const entry of visible) {
        if (entry.type === 'module') {
          items.push({ kind: 'module', moduleKind: entry.kind });
        } else if (entry.type === 'soon') {
          items.push({ kind: 'soon', id: entry.id, labelKey: entry.labelKey });
        } else {
          const sole = soleModule(entry.children, installedModules);
          if (sole) items.push({ kind: 'module', moduleKind: sole, labelKey: entry.labelKey, icon: entry.icon });
          else items.push({ kind: 'dropdown', id: entry.id, labelKey: entry.labelKey, icon: entry.icon, entries: entry.children });
        }
      }
    }
    return items;
  }, [installedModules]);

  const moduleLabel = (kind: string): string => {
    const m = getWorkspaceModule(kind);
    if (!m) return kind;
    return m.title ? m.title(host, { id: kind, kind }) : t(m.titleKey ?? kind);
  };

  const openModule = (kind: string) => {
    onOpen(kind);
    close();
  };

  const toggleDropdown = (id: string, e: React.MouseEvent<HTMLButtonElement>) => {
    if (openId === id) {
      close();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setAnchor({ left: rect.left, top: rect.bottom + 4 });
    setOpenId(id);
  };

  const renderPanelEntry = (entry: NavEntry, depth: number): React.ReactNode => {
    if (!isEntryVisible(entry, installedModules)) return null;
    if (entry.type === 'soon') {
      return (
        <div key={entry.id} className="navmenu-dd-item navmenu-dd-soon" style={{ paddingLeft: 14 + depth * 12 }}>
          <span>{t(entry.labelKey)}</span>
          <span className="navmenu-soon-badge">{t('navComingSoon')}</span>
        </div>
      );
    }
    if (entry.type === 'module') {
      const m = getWorkspaceModule(entry.kind);
      if (!m) return null;
      return (
        <button
          type="button"
          key={entry.kind}
          className={`navmenu-dd-item${activeTabId === entry.kind ? ' active' : ''}`}
          style={{ paddingLeft: 14 + depth * 12 }}
          onClick={() => openModule(entry.kind)}
        >
          {moduleLabel(entry.kind)}
        </button>
      );
    }
    return (
      <div key={entry.id} className="navmenu-dd-group">
        <div className="navmenu-dd-header" style={{ paddingLeft: 14 + depth * 12 }}>{t(entry.labelKey)}</div>
        {entry.children.map((c) => renderPanelEntry(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="navmenu" ref={rootRef}>
      {topItems.map((item) => {
        if (item.kind === 'soon') {
          return (
            <span key={item.id} className="navmenu-item navmenu-soon" title={t('navComingSoon')}>
              {t(item.labelKey)}
              <span className="navmenu-soon-badge">{t('navComingSoon')}</span>
            </span>
          );
        }
        if (item.kind === 'module') {
          const label = item.labelKey ? t(item.labelKey) : moduleLabel(item.moduleKind);
          return (
            <button
              type="button"
              key={item.moduleKind}
              className={`navmenu-item${activeTabId === item.moduleKind ? ' active' : ''}`}
              onClick={() => openModule(item.moduleKind)}
            >
              {item.icon && <span className="navmenu-icon">{item.icon}</span>}
              {label}
            </button>
          );
        }
        // dropdown
        const active = item.entries.some((e) => entryContainsActive(e, activeTabId));
        const isOpen = openId === item.id;
        return (
          <div key={item.id} className="navmenu-slot">
            <button
              type="button"
              className={`navmenu-item${active ? ' active' : ''}${isOpen ? ' open' : ''}`}
              onClick={(e) => toggleDropdown(item.id, e)}
            >
              {item.icon && <span className="navmenu-icon">{item.icon}</span>}
              {t(item.labelKey)}
              <span className="navmenu-caret">{isOpen ? '▾' : '▸'}</span>
            </button>
            {isOpen && anchor && (
              <div className="navmenu-dd" style={{ position: 'fixed', left: anchor.left, top: anchor.top }}>
                {item.entries.map((e) => renderPanelEntry(e, 0))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
