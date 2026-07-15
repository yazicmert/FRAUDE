// Kullanıcının kaydettiği FQL screener sorguları. Yerleşik preset'lerden
// bağımsızdır; dışa/içe aktarma (yedek/paylaşım) kapsamındadır.
export interface ScreenerPreset {
  name: string;
  query: string;
}

const KEY = 'fraude-screener-presets';
const EVENT = 'fraude-screener-presets-updated';

export function loadScreenerPresets(): ScreenerPreset[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p) => p && p.name && p.query) : [];
  } catch {
    return [];
  }
}

export function saveScreenerPresets(presets: ScreenerPreset[]) {
  localStorage.setItem(KEY, JSON.stringify(presets));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: presets }));
}

export function addScreenerPreset(preset: ScreenerPreset): ScreenerPreset[] {
  const existing = loadScreenerPresets().filter((p) => p.name !== preset.name);
  const next = [...existing, preset];
  saveScreenerPresets(next);
  return next;
}

export function removeScreenerPreset(name: string): ScreenerPreset[] {
  const next = loadScreenerPresets().filter((p) => p.name !== name);
  saveScreenerPresets(next);
  return next;
}

export const SCREENER_PRESETS_EVENT = EVENT;
