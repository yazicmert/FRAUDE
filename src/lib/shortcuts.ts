/**
 * Uygulama genelindeki klavye kısayollarının tek kaynağı.
 *
 * Tanım burada durur; kısayolu dinleyen App, ipucunu gösteren üst çubuk
 * düğmeleri, komut paleti ve kılavuz aynı listeden okur. Böylece belgelenen
 * kısayol ile gerçekte çalışan kısayol birbirinden ayrışamaz.
 */

/** macOS'ta ⌘, diğer platformlarda Ctrl. */
export const MOD_KEY: '⌘' | 'Ctrl' =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent) ? '⌘' : 'Ctrl';

export type ShortcutId =
  | 'palette'
  | 'sidebar'
  | 'terminal'
  | 'aiPanel'
  | 'alerts'
  | 'monitor'
  | 'sync'
  | 'settings'
  | 'close';

export interface Shortcut {
  id: ShortcutId;
  /** KeyboardEvent.key ile karşılaştırılan tuş (harfler küçük yazılır). */
  key: string;
  /** ⌘/Ctrl basılı olmalı mı. */
  mod: boolean;
  /** ⇧ basılı olmalı mı (belirtilmezse hayır). */
  shift?: boolean;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { id: 'palette', key: 'k', mod: true },
  { id: 'sidebar', key: 'b', mod: true },
  { id: 'terminal', key: 'j', mod: true },
  { id: 'aiPanel', key: 'i', mod: true },
  { id: 'alerts', key: 'a', mod: true, shift: true },
  { id: 'monitor', key: 'm', mod: true, shift: true },
  { id: 'sync', key: 's', mod: true, shift: true },
  { id: 'settings', key: ',', mod: true },
  { id: 'close', key: 'escape', mod: false },
];

/** Modül türünden kısayola eşleme; kenar çubuğu rozetleri bunu okur. */
export const MODULE_SHORTCUTS: Readonly<Record<string, ShortcutId>> = {
  settings: 'settings',
};

function find(id: ShortcutId): Shortcut | undefined {
  return SHORTCUTS.find((shortcut) => shortcut.id === id);
}

/** Kısayolun tuş parçaları, ör. ['⌘', 'B'], ['⌘', '⇧', 'A'] veya ['Esc']. */
export function shortcutKeys(id: ShortcutId): string[] {
  const shortcut = find(id);
  if (!shortcut) return [];
  const key = shortcut.key === 'escape' ? 'Esc' : shortcut.key.toUpperCase();
  const parts: string[] = [];
  if (shortcut.mod) parts.push(MOD_KEY);
  if (shortcut.shift) parts.push(MOD_KEY === '⌘' ? '⇧' : 'Shift');
  parts.push(key);
  return parts;
}

/** Tek satırlık gösterim, ör. "⌘B" (macOS) veya "Ctrl+B". */
export function shortcutLabel(id: ShortcutId): string {
  return shortcutKeys(id).join(MOD_KEY === '⌘' ? '' : '+');
}

/** Olayın verilen kısayolla eşleşip eşleşmediğini döndürür. */
export function matchesShortcut(event: KeyboardEvent, id: ShortcutId): boolean {
  const shortcut = find(id);
  if (!shortcut) return false;
  const mod = event.metaKey || event.ctrlKey;
  if (shortcut.mod !== mod) return false;
  if (Boolean(shortcut.shift) !== event.shiftKey) return false;
  return event.key.toLowerCase() === shortcut.key;
}
