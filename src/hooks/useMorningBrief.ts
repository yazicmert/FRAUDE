import { useCallback, useEffect, useState } from 'react';
import { getDashboardSnapshot } from '../api/tauriClient';
import { isDataRuntimeConfigured } from '../api/platformClient';
import { isBistEquity } from '../lib/equityGroups';
// Bülten metinleri React dışında (derleme anında) kurulduğu için hook yerine
// i18next örneği kullanılır; seçili dile göre üretilir.
import i18n from '../i18n';
import type { DashboardSnapshot, EquityRow } from '../types';
import type { WatchlistItem } from './useWatchlist';
import { notify } from '../lib/notify';

const BRIEF_DATE_KEY = 'fraude-brief-date';
const BRIEF_DISMISS_KEY = 'fraude-brief-dismissed';

/**
 * Bülten satırının götürdüğü yer. Satır metni zaten bir yeri işaret ediyor
 * ("Günün lideri: EMPAE"), tıklanabilir olmaması tek başına bir eksiklikti:
 * banner'ın tek eylemi "Panele git"ti ve bülten açılışta göründüğü için aktif
 * sekme zaten panoydu — düğme hiçbir şey yapmıyordu.
 */
export type BriefTarget =
  | { kind: 'index'; name: string }
  | { kind: 'ticker'; ticker: string }
  | { kind: 'module'; module: string; data?: Record<string, unknown> };

export interface MorningBriefLine {
  text: string;
  target?: BriefTarget;
}

export interface MorningBrief {
  date: string;
  headline: string;
  lines: MorningBriefLine[];
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
// Banner ve günlük özet popup'ı (MorningBriefModal) aynı satırı paylaşır.
export function watchlistSummary(snapshot: DashboardSnapshot): string | null {
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
  const parts: string[] = [i18n.t('wlSummary', { n: items.length })];
  if (dayAvg !== null) parts.push(i18n.t('wlDayAvg', { v: `${dayAvg >= 0 ? '+' : ''}${dayAvg.toFixed(2)}%` }));
  if (priced > 0 && cost > 0) {
    const ret = ((value - cost) / cost) * 100;
    parts.push(i18n.t('wlVsCost', { v: `${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%` }));
  }
  return parts.join(' · ');
}

import { getMarketStatus } from '../lib/marketHours';

function composeBrief(snapshot: DashboardSnapshot): MorningBrief {
  const status = getMarketStatus();
  const day = new Date().getDay();
  const isWeekend = day === 0 || day === 6;
  const isHoliday = Boolean(status.holidayName);

  // Eğer haftasonu veya tatil ise, sadece bilgilendirme yapıp fiyatları göstermiyoruz.
  if (isWeekend || isHoliday) {
    const reason = isWeekend ? i18n.t('briefWeekend') : status.holidayName ?? '';
    return {
      date: todayKey(),
      headline: i18n.t('briefMarketClosedReason', { reason }),
      lines: [{ text: i18n.t('briefClosedLine') }]
    };
  }

  // Sabah özeti BIST'e özeldir: genişlik ve aşırı satım sayıları ABD hisseleri
  // ile emtiaları kapsamaz (günün lideri zaten backend'de BIST'le sınırlı).
  const equities = (snapshot.equities ?? []).filter(isBistEquity);
  let up = 0;
  let down = 0;
  for (const e of equities) {
    if (!Number.isFinite(e.change_pct)) continue;
    if (e.change_pct > 0) up += 1;
    else if (e.change_pct < 0) down += 1;
  }
  // Aşırı satım satırı tarayıcıya kendi satırlarını taşır: sayıyı okuyup
  // "hangi 59 hisse?" diye yeniden taramak zorunda kalmazsın.
  const oversoldRows = equities
    .filter((e) => Number.isFinite(e.rsi) && e.rsi > 0 && e.rsi < 30)
    .sort((a, b) => a.rsi - b.rsi);
  const oversold = oversoldRows.length;

  const lines: MorningBriefLine[] = [];
  const bist = snapshot.market_metrics.find((m) => /100|xu100|bist/i.test(m.symbol));
  if (bist) {
    lines.push({
      text: `${bist.symbol}: ${bist.value} (${bist.change})`,
      target: { kind: 'index', name: bist.symbol },
    });
  }
  if (up + down > 0) {
    lines.push({ text: i18n.t('briefBreadthLine', { up, down }), target: { kind: 'module', module: 'dashboard' } });
  }

  const topGainer = snapshot.top_gainers?.[0];
  if (topGainer) {
    lines.push({
      text: i18n.t('briefLeaderLine', { ticker: topGainer.ticker, change: `${topGainer.change_pct >= 0 ? '+' : ''}${topGainer.change_pct.toFixed(2)}%` }),
      target: { kind: 'ticker', ticker: topGainer.ticker },
    });
  }
  if (oversold > 0) {
    lines.push({
      text: i18n.t('briefOversoldLine', { n: oversold }),
      target: { kind: 'module', module: 'screener', data: { rows: oversoldRows } },
    });
  }

  const wl = watchlistSummary(snapshot);
  if (wl) lines.push({ text: wl, target: { kind: 'module', module: 'dashboard' } });

  const kapAnnouncements = snapshot.kap_announcements ?? [];
  const kapCount = kapAnnouncements.length;
  if (kapCount > 0) {
    lines.push({
      text: i18n.t('briefKapLine', { n: kapCount }),
      target: { kind: 'module', module: 'kap', data: { rows: kapAnnouncements } },
    });
  }

  const headline = up + down > 0
    ? (up >= down ? i18n.t('briefReadyPositive', { up, down }) : i18n.t('briefUnderPressure', { up, down }))
    : i18n.t('briefReady');

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
            title: i18n.t('briefGoodMorning'),
            body: [composed.headline, ...composed.lines.slice(0, 3).map((line) => line.text)].join('\n'),
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
