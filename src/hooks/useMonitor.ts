import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isDesktopRuntime } from '../api/platformClient';
import { getMonitorState, syncMonitorTickers } from '../api/tauriClient';
import type { MonitorState } from '../types';
import type { WatchlistItem } from './useWatchlist';

interface MonitorAlertEvent {
  alerts: unknown[];
  unread: number;
}

/**
 * İzleme listesini hesaba (notify_prefs.tickers) yazar.
 *
 * Neden: uygulama içi izleme yalnız uygulama AÇIKKEN çalışır. Sunucudaki
 * market-watch işi (pg_cron, 10 dakikada bir) bildirimleri kullanıcının
 * `notify_prefs.tickers` listesine göre süzüyor; iki liste ayrı tutulduğunda
 * kullanıcı aynı hisseleri iki yerde işaretlemek zorunda kalıyor ve uygulama
 * kapalıyken e-posta gelmiyordu. Tek kaynak: uygulamadaki takip listesi.
 *
 * Sessizce başarısız olur — oturum yoksa, satır henüz kurulmamışsa ya da ağ
 * yoksa izleme akışı etkilenmemeli. Yalnız hisse listesi yazılır; kullanıcının
 * eşik/anahtar kelime tercihlerine dokunulmaz.
 */
async function syncTickersToCloud(tickers: string[]): Promise<void> {
  try {
    const { getSession } = await import('../features/auth/session');
    const session = getSession();
    if (!session) return;

    const { supabase } = await import('../features/auth/supabaseClient');
    const normalized = Array.from(
      new Set(tickers.map((t) => t.trim().replace(/\.IS$/i, '').toUpperCase()).filter(Boolean)),
    ).sort();

    // Satır yoksa kurulur (e-posta zorunlu), varsa yalnız tickers güncellenir.
    await supabase.from('notify_prefs').upsert(
      {
        user_id: session.id,
        email: session.email,
        tickers: normalized,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
  } catch {
    // Bulut senkronu izleme akışını engellemez
  }
}

/**
 * İzleme motorunu arayüzle bağlar: başlangıçta durumu yükler, backend'in
 * `fraude-monitor-alert` olayını dinleyip canlı günceller ve takip listesi
 * (watchlist) her değiştiğinde izlenecek hisseleri backend'e senkronlar.
 * Uygulama seviyesinde bir kez kullanılır; hem zil rozeti hem izleme paneli
 * aynı state'i paylaşır.
 */
export function useMonitor() {
  const [state, setState] = useState<MonitorState | null>(null);
  const loadedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setState(await getMonitorState());
    } catch (err) {
      console.error('İzleme durumu alınamadı:', err);
    }
  }, []);

  // İlk yükleme + takip listesini backend'e senkronla.
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    const readWatchlist = (): string[] => {
      try {
        const saved = localStorage.getItem('fraude-watchlist');
        if (!saved) return [];
        const parsed = JSON.parse(saved) as (WatchlistItem | string)[];
        if (!Array.isArray(parsed)) return [];
        return parsed.map((item) => (typeof item === 'string' ? item : item.ticker)).filter(Boolean);
      } catch {
        return [];
      }
    };

    (async () => {
      try {
        const list = readWatchlist();
        const synced = await syncMonitorTickers(list);
        setState(synced);
        void syncTickersToCloud(list);
      } catch (err) {
        console.error('Takip listesi izleyiciye senkronlanamadı:', err);
        void refresh();
      }
    })();
  }, [refresh]);

  // Watchlist değişince backend'e yeniden senkronla.
  useEffect(() => {
    const handleWatchlistUpdate = (e: Event) => {
      const detail = (e as CustomEvent<WatchlistItem[]>).detail || [];
      const tickers = detail.map((item) => item.ticker).filter(Boolean);
      syncMonitorTickers(tickers).then(setState).catch((err) => console.error('İzleyici senkronu:', err));
      void syncTickersToCloud(tickers);
    };
    window.addEventListener('fraude-watchlist-updated', handleWatchlistUpdate);
    return () => window.removeEventListener('fraude-watchlist-updated', handleWatchlistUpdate);
  }, []);

  // Backend'in canlı uyarı olayını dinle. Tauri dışı ortamda (tarayıcıda
  // açılan dev sunucusu) event köprüsü yoktur; dinleyici kurulmaz.
  useEffect(() => {
    if (!isDesktopRuntime()) return;
    const unlistenPromise = listen<MonitorAlertEvent>('fraude-monitor-alert', () => {
      void refresh();
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [refresh]);

  return { state, setState, refresh };
}
