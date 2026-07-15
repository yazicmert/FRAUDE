import { useCallback, useEffect, useState } from 'react';
import { getDashboardSnapshot } from '../api/tauriClient';
import { isDataRuntimeConfigured } from '../api/platformClient';
import type { DashboardSnapshot, EquityRow } from '../types';
import type { WatchlistItem } from './useWatchlist';
import { notify } from '../lib/notify';

const BRIEF_DATE_KEY = 'fraude-brief-date';
const BRIEF_DISMISS_KEY = 'fraude-brief-dismissed';

export interface MorningBrief {
  date: string;
  headline: string;
  lines: string[];
}

function todayKey(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date()); // YYYY-MM-DD
}

function readWatchlist(): WatchlistItem[] {
  try {
    const raw = localStorage.getItem('fraude-watchlist');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((it: WatchlistItem | string) => (typeof it === 'string' ? { ticker: it, addedAt: '', addedPrice: 0 } : it))
      .filter((it) => it && it.ticker);
  } catch {
    return [];
  }
}

// Watchlist toplam getirisi: maliyet girilmiş kalemler adet ağırlıklı hesaplanır.
function watchlistSummary(snapshot: DashboardSnapshot): string | null {
  const items = readWatchlist();
  if (items.length === 0) return null;
  const byTicker = new Map<string, EquityRow>();
  for (const row of [...snapshot.equities, ...snapshot.top_gainers, ...snapshot.risk_watch]) {
    if (!byTicker.has(row.ticker)) byTicker.set(row.ticker, row);
  }
  let cost = 0;
  let value = 0;
  let priced = 0;
  let dayChangeWeighted = 0;
  let dayWeight = 0;
  for (const item of items) {
    const eq = byTicker.get(item.ticker);
    if (!eq || !Number.isFinite(eq.price)) continue;
    const qty = item.quantity && item.quantity > 0 ? item.quantity : 1;
    if (item.addedPrice > 0) {
      cost += item.addedPrice * qty;
      value += eq.price * qty;
      priced += 1;
    }
    if (Number.isFinite(eq.change_pct)) {
      dayChangeWeighted += eq.change_pct * (eq.price * qty);
      dayWeight += eq.price * qty;
    }
  }
  const dayAvg = dayWeight > 0 ? dayChangeWeighted / dayWeight : null;
  const parts: string[] = [`Takip listesi: ${items.length} hisse`];
  if (dayAvg !== null) parts.push(`bugün ort. ${dayAvg >= 0 ? '+' : ''}${dayAvg.toFixed(2)}%`);
  if (priced > 0 && cost > 0) {
    const ret = ((value - cost) / cost) * 100;
    parts.push(`maliyete göre ${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%`);
  }
  return parts.join(' · ');
}

function composeBrief(snapshot: DashboardSnapshot): MorningBrief {
  const equities = snapshot.equities ?? [];
  let up = 0;
  let down = 0;
  for (const e of equities) {
    if (!Number.isFinite(e.change_pct)) continue;
    if (e.change_pct > 0) up += 1;
    else if (e.change_pct < 0) down += 1;
  }
  const oversold = equities.filter((e) => Number.isFinite(e.rsi) && e.rsi > 0 && e.rsi < 30).length;

  const lines: string[] = [];
  const bist = snapshot.market_metrics.find((m) => /100|xu100|bist/i.test(m.symbol));
  if (bist) lines.push(`${bist.symbol}: ${bist.value} (${bist.change})`);
  if (up + down > 0) lines.push(`Piyasa genişliği: ${up} artan · ${down} düşen`);

  const topGainer = snapshot.top_gainers?.[0];
  if (topGainer) lines.push(`Günün lideri: ${topGainer.ticker} ${topGainer.change_pct >= 0 ? '+' : ''}${topGainer.change_pct.toFixed(2)}%`);
  if (oversold > 0) lines.push(`Aşırı satım (RSI<30): ${oversold} hisse`);

  const wl = watchlistSummary(snapshot);
  if (wl) lines.push(wl);

  const kapCount = snapshot.kap_announcements?.length ?? 0;
  if (kapCount > 0) lines.push(`Bekleyen KAP bildirimi: ${kapCount}`);

  const headline = up + down > 0
    ? (up >= down ? `Piyasa pozitif açılışa hazır (${up}/${down})` : `Piyasa baskı altında (${up}/${down})`)
    : 'Günlük piyasa özeti hazır';

  return { date: todayKey(), headline, lines };
}

/**
 * Günde bir kez (İstanbul takvim gününe göre, uygulamanın ilk açılışında)
 * dashboard + takip listesinden bir "Günaydın Bülteni" derler; OS bildirimi +
 * uygulama içi toast gönderir ve kapatılabilir bir banner için brief döndürür.
 */
export function useMorningBrief() {
  const [brief, setBrief] = useState<MorningBrief | null>(null);

  const dismiss = useCallback(() => {
    setBrief(null);
    try {
      localStorage.setItem(BRIEF_DISMISS_KEY, todayKey());
    } catch {
      /* yok say */
    }
  }, []);

  useEffect(() => {
    if (!isDataRuntimeConfigured()) return;
    let cancelled = false;
    const key = todayKey();

    // Zaten bugün gösterildiyse yalnızca banner'ı (kapatılmadıysa) geri getirmeyiz;
    // bildirim tekrarını önlemek için tarih anahtarı kullanılır.
    const alreadyNotified = (() => {
      try { return localStorage.getItem(BRIEF_DATE_KEY) === key; } catch { return false; }
    })();
    const dismissed = (() => {
      try { return localStorage.getItem(BRIEF_DISMISS_KEY) === key; } catch { return false; }
    })();

    // Veri senkronunun tamamlanmasını beklemek için kısa gecikme.
    const timer = setTimeout(async () => {
      try {
        const snap = await getDashboardSnapshot();
        if (cancelled) return;
        const composed = composeBrief(snap);

        if (!alreadyNotified) {
          try { localStorage.setItem(BRIEF_DATE_KEY, key); } catch { /* yok say */ }
          void notify({
            title: '☀️ Günaydın · FRAUDE',
            body: [composed.headline, ...composed.lines.slice(0, 3)].join('\n'),
            kind: 'info',
          });
        }
        if (!dismissed) setBrief(composed);
      } catch {
        /* dashboard alınamazsa bülten atlanır */
      }
    }, alreadyNotified ? 300 : 4000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return { brief, dismiss };
}
