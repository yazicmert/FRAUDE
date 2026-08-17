import { supabase } from '../auth/supabaseClient';
import type { DrawingItem } from './drawingTypes';

const STORAGE_KEY = 'fraude-chart-drawings';

interface StoredTickerData {
  drawings: DrawingItem[];
  updatedAt: number;
}

type StoredDrawingsMap = Record<string, StoredTickerData>;

function getAllLocal(): StoredDrawingsMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as StoredDrawingsMap;
  } catch (err) {
    console.warn('[DrawingStorage] Failed to read localStorage', err);
    return {};
  }
}

function saveAllLocal(map: StoredDrawingsMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (err) {
    console.warn('[DrawingStorage] Failed to write localStorage', err);
  }
}

/**
 * Belirtilen sembole ait yerel çizimleri döndürür.
 */
export function getLocalDrawings(ticker: string): DrawingItem[] {
  const normTicker = ticker.toUpperCase().trim();
  const all = getAllLocal();
  return all[normTicker]?.drawings ?? [];
}

/**
 * Belirtilen sembolün çizimlerini yerel belleğe kaydeder ve olay yayınlar.
 */
export function saveLocalDrawings(ticker: string, drawings: DrawingItem[]): void {
  const normTicker = ticker.toUpperCase().trim();
  const all = getAllLocal();
  all[normTicker] = {
    drawings,
    updatedAt: Date.now(),
  };
  saveAllLocal(all);

  window.dispatchEvent(
    new CustomEvent('fraude-chart-drawings-changed', {
      detail: { ticker: normTicker, drawings },
    })
  );
}

// Bulut senkronizasyonu için debounce zamanlayıcıları
const syncTimers = new Map<string, number>();

/**
 * Çizimleri kullanıcının Supabase hesabına (`user_chart_drawings`) yedekler.
 * Kullanıcı giriş yapmamışsa sessizce yerelde kalır.
 */
export function queueCloudSync(ticker: string, drawings: DrawingItem[]): void {
  const normTicker = ticker.toUpperCase().trim();

  // Önceki bekleyen senkronizasyonu temizle
  const existingTimer = syncTimers.get(normTicker);
  if (existingTimer) {
    window.clearTimeout(existingTimer);
  }

  const timer = window.setTimeout(async () => {
    syncTimers.delete(normTicker);
    try {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData?.user) return;

      const { error } = await supabase.from('user_chart_drawings').upsert(
        {
          user_id: authData.user.id,
          ticker: normTicker,
          drawings: drawings as any,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,ticker' }
      );

      if (error) {
        console.warn('[DrawingStorage] Cloud sync error:', error.message);
      }
    } catch (err) {
      console.warn('[DrawingStorage] Failed to sync drawings to cloud', err);
    }
  }, 800);

  syncTimers.set(normTicker, timer);
}

/**
 * Supabase bulutundan en güncel çizimleri çeker ve yerel önbellekle birleştirir.
 * Uygulama silinse/tekrar yüklense dahi bu fonksiyon sayesinde çizimler geri gelir.
 */
export async function syncAndFetchDrawings(
  ticker: string,
  onRemoteLoaded?: (drawings: DrawingItem[]) => void
): Promise<DrawingItem[]> {
  const normTicker = ticker.toUpperCase().trim();
  const localDrawings = getLocalDrawings(normTicker);

  try {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData?.user) return localDrawings;

    const { data, error } = await supabase
      .from('user_chart_drawings')
      .select('drawings, updated_at')
      .eq('ticker', normTicker)
      .maybeSingle();

    if (error) {
      console.warn('[DrawingStorage] Cloud fetch error:', error.message);
      return localDrawings;
    }

    if (data && Array.isArray(data.drawings)) {
      const remoteDrawings = data.drawings as DrawingItem[];
      const remoteUpdatedAt = new Date(data.updated_at).getTime();
      const localData = getAllLocal()[normTicker];
      const localUpdatedAt = localData?.updatedAt ?? 0;

      // Eğer uzaktaki veri yereldekinden yeniyse veya yerelde hiç çizim yoksa
      if (remoteUpdatedAt >= localUpdatedAt || localDrawings.length === 0) {
        const all = getAllLocal();
        all[normTicker] = {
          drawings: remoteDrawings,
          updatedAt: remoteUpdatedAt,
        };
        saveAllLocal(all);
        if (onRemoteLoaded) {
          onRemoteLoaded(remoteDrawings);
        }
        return remoteDrawings;
      }
    } else if (localDrawings.length > 0) {
      // Yerelde çizim var ama bulutta yoksa buluta yedekle
      queueCloudSync(normTicker, localDrawings);
    }
  } catch (err) {
    console.warn('[DrawingStorage] Failed to fetch remote drawings', err);
  }

  return localDrawings;
}
