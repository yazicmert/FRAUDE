import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getEconomicCalendar, getMarketHolidays, type EconomicEvent, type EconomicImpact } from '../api/tauriClient';
import { useTranslation } from '../api/i18n';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/* ── Sabitler ─────────────────────────────────────────────────────────────── */

/** Yerel önbellek anahtarı; çevrimdışı açılışta takvim buradan gelir. */
const CACHE_KEY = 'fraude-eco-calendar';

/** Yenileme aralığı. Backend de aynı süreyle önbelleklediği için daha sık
 *  sormanın karşılığı yok. */
const REFRESH_MS = 6 * 60 * 60 * 1000;

const IMPACT_META: Record<EconomicImpact, { color: string; rank: number }> = {
  high: { color: '#f85149', rank: 3 },
  medium: { color: '#d29922', rank: 2 },
  low: { color: '#8b949e', rank: 1 },
  holiday: { color: '#ab7df8', rank: 0 },
};

/** Etki düzeyinin i18n anahtarı (rozet ve açıklama başlıkları). */
const IMPACT_KEY: Record<EconomicImpact, string> = {
  high: 'ecoCalImpactHigh',
  medium: 'ecoCalImpactMedium',
  low: 'ecoCalImpactLow',
  holiday: 'ecoCalImpactHoliday',
};

type ImpactFilter = 'all' | 'high' | 'medium';

/* ── Yardımcılar ──────────────────────────────────────────────────────────── */

/** Bugünün Türkiye tarihi (YYYY-MM-DD). */
function todayISO(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(new Date());
}

/** ISO tarihe gün ekleyip yine ISO döndürür (saat dilimi kaymasına kapalı). */
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** "2026-07-18" → "Cumartesi, 18 Tem" (yerel dilde) / "Bugün" / "Yarın" */
function dayLabel(iso: string, locale: string, t: Translate): string {
  const today = todayISO();
  if (iso === today) return t('today');
  if (iso === addDays(today, 1)) return t('tomorrow');
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * "$-1.459B" / "%38.5" / "2.5%" gibi biçimlerden sayısal değer çıkarır.
 * Sapma hesabı için kullanılır; ayrıştırılamayan değerlerde null döner.
 */
function parseValue(raw: string): number | null {
  if (!raw) return null;
  const match = raw.replace(/\s/g, '').match(/(-?\d+(?:[.,]\d+)?)([KMBT])?/i);
  if (!match) return null;
  const base = parseFloat(match[1].replace(',', '.'));
  if (!Number.isFinite(base)) return null;
  const scale: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
  return match[2] ? base * (scale[match[2].toUpperCase()] ?? 1) : base;
}

/**
 * Açıklanan değerin beklentiye göre yönü.
 *
 * Yalnızca yön bildirilir, "iyi/kötü" yorumu yapılmaz: enflasyon ve işsizlikte
 * beklenti üstü gelmek olumsuzdur, büyümede olumludur. Bu ayrımı göstergeye
 * bakmadan renklendirmek yanıltıcı olurdu.
 */
function surprise(event: EconomicEvent): 'above' | 'below' | 'inline' | null {
  const actual = parseValue(event.actual);
  const expected = parseValue(event.consensus || event.forecast);
  if (actual === null || expected === null) return null;
  const tolerance = Math.abs(expected) * 0.001;
  if (Math.abs(actual - expected) <= tolerance) return 'inline';
  return actual > expected ? 'above' : 'below';
}

/** Önbellekten okunan takvim; bozuk kayıtta boş döner. */
function readCache(): { savedAt: number; events: EconomicEvent[] } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.events)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Son güncelleme zamanını insan diline çevirir. */
function freshnessLabel(savedAt: number | null, t: Translate): string {
  if (!savedAt) return t('ecoCalUpdatingNow');
  const minutes = Math.floor((Date.now() - savedAt) / 60000);
  if (minutes < 1) return t('ecoCalUpdatedJustNow');
  if (minutes < 60) return t('ecoCalUpdatedMinAgo', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('ecoCalUpdatedHoursAgo', { n: hours });
  return t('ecoCalUpdatedDaysAgo', { n: Math.floor(hours / 24) });
}

/* ── Bileşen ──────────────────────────────────────────────────────────────── */

interface Props {
  /** Dropdown açık mı. */
  open: boolean;
  /** Kapatma geri çağrımı. */
  onClose: () => void;
  /** Etkinlik sayısı güncellendiğinde üst bileşene bildirir. */
  onCount?: (total: number, highToday: number) => void;
}

export default function EconomicCalendar({ open, onClose, onCount }: Props) {
  const { t, lang } = useTranslation();
  const locale = lang === 'tr' ? 'tr-TR' : 'en-US';
  const cached = useRef(readCache()).current;
  const [events, setEvents] = useState<EconomicEvent[]>(cached?.events ?? []);
  const [savedAt, setSavedAt] = useState<number | null>(cached?.savedAt ?? null);
  const [loading, setLoading] = useState(!cached);
  const [offline, setOffline] = useState(false);
  const [filter, setFilter] = useState<ImpactFilter>('all');
  const ref = useRef<HTMLDivElement>(null);
  const onCountRef = useRef(onCount);
  onCountRef.current = onCount;

  /* Veri çekimi: tatiller + makro takvim birleştirilir, sonuç önbelleğe yazılır. */
  const load = useCallback(async (signal: { cancelled: boolean }) => {
    setLoading(true);
    const [calRes, holRes] = await Promise.allSettled([getEconomicCalendar(), getMarketHolidays()]);
    if (signal.cancelled) return;

    const macro = calRes.status === 'fulfilled' ? calRes.value : [];
    const holidays =
      holRes.status === 'fulfilled'
        // time boş bırakılır; ekranda dile göre "Tüm Gün"/"All Day" yazılır
        // (load, t'ye bağımlı olsaydı her render'da yeniden kurulurdu).
        ? holRes.value.map((h) => ({
            date: h.date,
            time: '',
            event: h.name,
            category: 'Tatil',
            actual: '',
            previous: '',
            consensus: '',
            forecast: '',
            impact: 'holiday' as EconomicImpact,
          }))
        : [];

    // İki uç da boşsa ağ yok demektir: önbellekteki veriyi koru, uyarı göster.
    if (macro.length === 0 && holidays.length === 0) {
      setOffline(true);
      setLoading(false);
      return;
    }

    const merged = [...macro, ...holidays].sort(
      (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time),
    );
    const now = Date.now();
    setEvents(merged);
    setSavedAt(now);
    setOffline(false);
    setLoading(false);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: now, events: merged }));
    } catch {
      /* kota dolu: önbelleksiz devam */
    }
  }, []);

  /* İlk yükleme + periyodik yenileme. Önbellek tazeyse ağ beklenmez. */
  useEffect(() => {
    const signal = { cancelled: false };
    const stale = !cached || Date.now() - cached.savedAt > REFRESH_MS;
    if (stale) void load(signal);
    const timer = setInterval(() => void load(signal), REFRESH_MS);
    return () => {
      signal.cancelled = true;
      clearInterval(timer);
    };
  }, [load, cached]);

  /* Rozet sayacı: bugünün yüksek etkili etkinlik sayısı. */
  useEffect(() => {
    const today = todayISO();
    const highToday = events.filter((e) => e.date === today && e.impact === 'high').length;
    onCountRef.current?.(events.length, highToday);
  }, [events]);

  /* Dışarı tıklayınca kapat */
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  /* Bugünden itibaren, filtreye uyan etkinlikler; tarihe göre gruplanır. */
  const grouped = useMemo(() => {
    const today = todayISO();
    const minRank = filter === 'high' ? 3 : filter === 'medium' ? 2 : 0;
    const groups = new Map<string, EconomicEvent[]>();
    for (const event of events) {
      if (event.date < today) continue;
      // Tatiller etki filtresinden bağımsız olarak her zaman görünür.
      if (event.impact !== 'holiday' && IMPACT_META[event.impact].rank < minRank) continue;
      const list = groups.get(event.date) ?? [];
      list.push(event);
      groups.set(event.date, list);
    }
    return [...groups.entries()];
  }, [events, filter]);

  const visibleCount = useMemo(
    () => grouped.reduce((sum, [, items]) => sum + items.length, 0),
    [grouped],
  );

  if (!open) return null;

  const today = todayISO();

  return (
    <div ref={ref} className="eco-cal-dropdown">
      {/* Başlık */}
      <div className="eco-cal-header">
        <span className="eco-cal-title">{t('economicCalendar')}</span>
        <span className="eco-cal-help" title={t('ecoCalHelp')}>
          ?
        </span>
        <button
          type="button"
          className="eco-cal-refresh"
          disabled={loading}
          title={t('ecoCalRefreshNow')}
          onClick={() => void load({ cancelled: false })}
        >
          {loading ? '⏳' : '⟳'}
        </button>
      </div>

      {/* Etki filtresi */}
      <div className="eco-cal-filters">
        {([
          ['all', t('ecoCalFilterAll')],
          ['medium', t('ecoCalFilterMedium')],
          ['high', t('ecoCalFilterHigh')],
        ] as [ImpactFilter, string][]).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`eco-cal-chip ${filter === value ? 'active' : ''}`}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
        <span className="eco-cal-legend">
          {(['high', 'medium', 'low'] as EconomicImpact[]).map((impact) => (
            <span key={impact} className="eco-cal-legend-item" title={t(IMPACT_KEY[impact])}>
              <span className="eco-cal-dot" style={{ background: IMPACT_META[impact].color }} />
            </span>
          ))}
        </span>
      </div>

      {offline && (
        <div className="eco-cal-notice">
          {t('ecoCalOffline')} — {savedAt ? freshnessLabel(savedAt, t) : t('ecoCalNoSavedData')}
        </div>
      )}

      {/* İçerik */}
      <div className="eco-cal-body">
        {loading && events.length === 0 && <div className="eco-cal-empty">{t('ecoCalLoading')}</div>}
        {!loading && events.length === 0 && (
          <div className="eco-cal-empty">{t('ecoCalNoData')}</div>
        )}
        {events.length > 0 && visibleCount === 0 && (
          <div className="eco-cal-empty">{t('ecoCalNoMatch')}</div>
        )}

        {grouped.map(([date, items]) => (
          <div key={date} className="eco-cal-day-group">
            <div className={`eco-cal-day-label ${date === today ? 'is-today' : ''}`}>
              {dayLabel(date, locale, t)}
            </div>
            {items.map((event, index) => {
              const direction = surprise(event);
              const expected = event.consensus || event.forecast;
              return (
                <div key={`${date}-${index}`} className="eco-cal-row">
                  <span
                    className="eco-cal-dot"
                    style={{ background: IMPACT_META[event.impact].color }}
                    title={t(IMPACT_KEY[event.impact])}
                  />
                  <span className="eco-cal-time">
                    {event.time || (event.impact === 'holiday' ? t('ecoCalAllDay') : '—')}
                  </span>
                  <span className="eco-cal-event" title={event.event}>
                    {event.event}
                  </span>

                  <span className="eco-cal-values">
                    {event.actual ? (
                      <>
                        <span className="eco-cal-val eco-cal-actual" title={t('ecoCalActual')}>
                          {event.actual}
                        </span>
                        {direction && direction !== 'inline' && (
                          <span
                            className={`eco-cal-surprise ${direction}`}
                            title={
                              direction === 'above'
                                ? t('ecoCalAbove', { value: expected })
                                : t('ecoCalBelow', { value: expected })
                            }
                          >
                            {direction === 'above' ? '▲' : '▼'}
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        {expected && (
                          <span className="eco-cal-val eco-cal-cons" title={t('ecoCalConsensus')}>
                            {expected}
                          </span>
                        )}
                        {event.previous && (
                          <span className="eco-cal-val eco-cal-prev" title={t('ecoCalPrevious')}>
                            {event.previous}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Altbilgi */}
      <div className="eco-cal-footer">
        <span>{t('ecoCalUpcoming', { n: visibleCount })}</span>
        <span>{offline ? t('ecoCalOfflineShort') : freshnessLabel(savedAt, t)}</span>
      </div>
    </div>
  );
}
