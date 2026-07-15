import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getMonitorState, syncMonitorTickers } from '../api/tauriClient';
import type { MonitorState } from '../types';
import type { WatchlistItem } from './useWatchlist';

interface MonitorAlertEvent {
  alerts: unknown[];
  unread: number;
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
        const synced = await syncMonitorTickers(readWatchlist());
        setState(synced);
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
    };
    window.addEventListener('fraude-watchlist-updated', handleWatchlistUpdate);
    return () => window.removeEventListener('fraude-watchlist-updated', handleWatchlistUpdate);
  }, []);

  // Backend'in canlı uyarı olayını dinle.
  useEffect(() => {
    const unlistenPromise = listen<MonitorAlertEvent>('fraude-monitor-alert', () => {
      void refresh();
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [refresh]);

  return { state, setState, refresh };
}
