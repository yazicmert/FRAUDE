import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isDesktopRuntime } from '../api/platformClient';
import { listResearchJobs } from '../api/tauriClient';
import { notify } from '../lib/notify';
import type { ResearchJob } from '../types';

const SEEN_KEY = 'fraude-research-seen-ms';

export interface ResearchApi {
  jobs: ResearchJob[];
  unread: number;
  refresh: () => Promise<void>;
  markSeen: () => void;
}

/**
 * Araştırma işlerini arayüzle bağlar: başlangıçta listeyi yükler, backend'in
 * `fraude-research-update` olayını dinleyip canlı günceller, `submit` sonrası
 * yayınlanan `fraude-research-refresh` olayında yeniden çeker. Uygulama
 * seviyesinde bir kez kullanılır; hem modül hem başlık rozeti aynı state'i
 * paylaşır. Biten işlerde uygulama içi toast gösterir (OS bildirimi backend'de
 * atıldığı için burada yalnız toast).
 */
export function useResearch(): ResearchApi {
  const [jobs, setJobs] = useState<ResearchJob[]>([]);
  const [seenMs, setSeenMs] = useState<number>(() => {
    const v = Number(localStorage.getItem(SEEN_KEY) || '0');
    return Number.isFinite(v) ? v : 0;
  });
  // Aynı iş için mükerrer toast atmamak adına bildirilen id'ler.
  const notifiedRef = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      setJobs(await listResearchJobs());
    } catch (err) {
      console.error('Araştırma işleri alınamadı:', err);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Submit sonrası tetiklenen yerel yenileme.
  useEffect(() => {
    const onRefresh = () => void refresh();
    window.addEventListener('fraude-research-refresh', onRefresh);
    return () => window.removeEventListener('fraude-research-refresh', onRefresh);
  }, [refresh]);

  // Backend canlı olayı (yalnız masaüstünde köprü vardır).
  useEffect(() => {
    if (!isDesktopRuntime()) return;
    const unlistenPromise = listen<{ job: ResearchJob }>('fraude-research-update', (e) => {
      const job = e.payload?.job;
      if (!job) {
        void refresh();
        return;
      }
      setJobs((cur) => {
        const idx = cur.findIndex((j) => j.id === job.id);
        if (idx === -1) return [job, ...cur];
        const next = cur.slice();
        next[idx] = job;
        return next;
      });
      if ((job.status === 'done' || job.status === 'error') && !notifiedRef.current.has(job.id)) {
        notifiedRef.current.add(job.id);
        void notify({
          title: job.status === 'done' ? '✅ Araştırma tamamlandı' : '⚠️ Araştırma başarısız',
          body: job.title,
          kind: job.status === 'done' ? 'success' : 'warning',
          toastOnly: true,
        });
      }
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [refresh]);

  const unread = jobs.filter(
    (j) => (j.status === 'done' || j.status === 'error') && j.updated_at_ms > seenMs,
  ).length;

  const markSeen = useCallback(() => {
    const now = Date.now();
    localStorage.setItem(SEEN_KEY, String(now));
    setSeenMs(now);
  }, []);

  return { jobs, unread, refresh, markSeen };
}
