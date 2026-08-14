import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getCalendarEventImpact,
  getCalendarEventNews,
  getEconomicCalendar,
  getMarketHolidays,
  type CalendarImpact,
  type EconomicEvent,
  type EconomicImpact,
  type ImpactLink,
} from '../api/tauriClient';
import type { NewsItem } from '../types';
import { useTranslation } from '../api/i18n';
import {
  documentFromNews,
  documentFromReport,
  requestArticleReader,
  type ViewerDocument,
} from '../features/reports/ReportDocumentModal';
import { dispatchOpenSymbol } from '../lib/actions';
import { classifyInstrument } from '../lib/instrumentKind';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/* ── Sabitler ─────────────────────────────────────────────────────────────── */

/** Yerel önbellek anahtarı; çevrimdışı açılışta takvim buradan gelir. */
const CACHE_KEY = 'fraude-eco-calendar';

/**
 * Önbellek şeması sürümü. Olaya YENİ BİR ALAN eklendiğinde artırılır.
 *
 * Gerekçe: bu önbellek 6 saat boyunca arka uca hiç sormaz. Sürüm damgası
 * olmadan, yükseltme yapan kullanıcı eski şemayla yazılmış kaydı görmeye
 * devam eder — `source_url` eklendiğinde takvim satırları tam olarak bu
 * yüzden gösterge sayfasına değil genel takvime gidiyordu. Sürümü eski olan
 * kayıt artık yok sayılır ve veri anında yeniden çekilir.
 */
const CACHE_VERSION = 1;

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

/* ── Kaynaklar ────────────────────────────────────────────────────────────── */

/** Makro satırların kaynağı; backend her satıra kendi gösterge sayfasını
 *  koyar, koyamazsa (ve alan eklenmeden önceki önbellekte) buraya düşülür. */
const MACRO_SOURCE_URL = 'https://tradingeconomics.com/turkey/calendar';

/** Resmi tatiller Nager.Date'ten gelir; ülke sayfası tüm listeyi gösterir. */
const HOLIDAY_SOURCE_URL = 'https://date.nager.at/PublicHoliday/Country/TR';

/** Tıklamanın gideceği adres. Önbellekten okunan eski kayıtlarda alan
 *  bulunmadığı için satır yine de bir yere gitsin diye yedek verilir. */
function sourceUrlOf(event: EconomicEvent): string {
  if (event.source_url) return event.source_url;
  return event.impact === 'holiday' ? HOLIDAY_SOURCE_URL : MACRO_SOURCE_URL;
}

/** Bağlantının hangi siteye gittiğini ipucunda göstermek için alan adı. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

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

/**
 * Önbellekten okunan takvim; bozuk ya da eski şemayla yazılmış kayıtta boş
 * döner. Boş dönmesi "hemen yeniden çek" demektir.
 */
function readCache(): { savedAt: number; events: EconomicEvent[] } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.events)) return null;
    // Sürümsüz kayıt, alan damgası eklenmeden önce yazılmıştır.
    if (parsed?.version !== CACHE_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Haberin yayın tarihini kısa biçime çevirir; okunamıyorsa boş döner.
 *
 * Tarih listede gösteriliyor çünkü aynı gösterge için farklı dönemlerin
 * yorumları dolaşımda olabiliyor — okuyucu hangisine baktığını görmeli.
 */
function newsDate(raw: string | undefined, locale: string): string {
  if (!raw) return '';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Uygulama bu sembolü kendi sayfasında açabiliyor mu?
 *
 * Katalogdaki döviz/emtia/endeks kodları ve bilinen küresel devler açılabilir;
 * geri kalan her sembol BIST hissesi varsayılır. "F" (Ford) ya da "STLA"
 * (Stellantis) böyle bir kod DEĞİL — tıklanabilir yapılsa İş Yatırım'da
 * karşılığı olmayan boş bir hisse sayfası açılırdı. Bu yüzden dünya
 * etiketlerinin bir kısmı bilgi amaçlı düz etiket olarak durur.
 */
function canOpenSymbol(symbol: string): boolean {
  return classifyInstrument(symbol) !== 'bist-equity';
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

/* ── Etiket satırı ────────────────────────────────────────────────────────── */

interface TagRowProps {
  label: string;
  links: ImpactLink[];
  /** İpucunda gösterilen "sayfasını aç" metni. */
  openLabel: string;
  onOpen: (symbol: string) => void;
  /** Sembolün uygulama içinde bir sayfası var mı? */
  canOpen: (symbol: string) => boolean;
}

/**
 * Etiketlenen payların tek satırlık listesi.
 *
 * Gerekçe ipucunda durur: rozetin üstünde altı kelimeyle "neden bu pay?"
 * sorusuna cevap veren bir cümle var. Ekranda göstermek 420 piksellik paneli
 * duvar yazısına çevirirdi.
 */
function TagRow({ label, links, openLabel, onOpen, canOpen }: TagRowProps) {
  if (links.length === 0) return null;
  return (
    <div className="eco-cal-tag-row">
      <span className="eco-cal-tag-label">{label}</span>
      {links.map((link) =>
        canOpen(link.symbol) ? (
          <button
            key={link.symbol}
            type="button"
            className="eco-cal-tag is-open"
            title={`${link.name} — ${link.why}\n${openLabel}`}
            onClick={() => onOpen(link.symbol)}
          >
            {link.symbol}
          </button>
        ) : (
          // Uygulamada sayfası olmayan sembol düğme DEĞİL: tıklanabilir
          // görünüp boş ekran açmaktansa bilgi etiketi olarak durur.
          <span key={link.symbol} className="eco-cal-tag" title={`${link.name} — ${link.why}`}>
            {link.symbol}
          </span>
        ),
      )}
    </div>
  );
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

/** Açılmış bir satırın toplanan içeriği. */
interface RowDetail {
  /** Haber araması sürüyor mu — etki tablosu yerelden anında geldiği için
   *  ayrı izlenir, ağ yavaşken etiketler beklemez. */
  newsLoading: boolean;
  news: NewsItem[];
  impact: CalendarImpact | null;
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
  /** Açık duran satırın anahtarı; aynı anda tek satır açılır. */
  const [openRow, setOpenRow] = useState<string | null>(null);
  /** Satır anahtarı → o maddenin etiketleri, raporları ve haberleri. */
  const [detailByRow, setDetailByRow] = useState<Record<string, RowDetail>>({});
  const ref = useRef<HTMLDivElement>(null);
  const onCountRef = useRef(onCount);
  onCountRef.current = onCount;

  /**
   * Okuyucuyu açar ve takvimi kapatır.
   *
   * Panel açık kalırsa okunacak sayfanın tam üstünde durur — gösterge sayfası
   * arkada görünmez hâle geliyordu. Takvim düğmesi yerinde: kullanıcı okumayı
   * bitirince paneli yeniden açar.
   */
  const openInReader = useCallback(
    (document: ViewerDocument) => {
      requestArticleReader(document);
      onClose();
    },
    [onClose],
  );

  /** Etiketlenen payın sayfasını açar; takvim yine kapanır. */
  const openSymbol = useCallback(
    (symbol: string) => {
      dispatchOpenSymbol(symbol);
      onClose();
    },
    [onClose],
  );

  /**
   * Satırı açar/kapatır; ilk açılışta etkilenen payları ve haberleri toplar.
   *
   * Sonuç satır anahtarında saklanır: kullanıcı satırı kapatıp yeniden açınca
   * arama tekrarlanmasın. Arka uç ayrıca kendi içinde önbellekliyor, bu yüzden
   * burada süre takibi yapılmaz.
   */
  const toggleRow = useCallback(
    (key: string, event: EconomicEvent) => {
      // İki istek ayrı ayrı yerleşiyor; her biri yalnız kendi alanını yazsın.
      const patch = (changes: Partial<RowDetail>) =>
        setDetailByRow((rows) => ({
          ...rows,
          [key]: { ...(rows[key] ?? { newsLoading: false, news: [], impact: null }), ...changes },
        }));

      setOpenRow((current) => (current === key ? null : key));
      setDetailByRow((current) => {
        if (current[key]) return current;
        // Etki tablosu yereldir ve anında gelir, haber araması ağa çıkar.
        // Biri diğerini bekletmemeli.
        void getCalendarEventNews(event, lang)
          .then((news) => patch({ newsLoading: false, news }))
          // Haber gelmemesi satırın açılmasını engellememeli: liste boş görünür.
          .catch(() => patch({ newsLoading: false, news: [] }));
        void getCalendarEventImpact(event, lang)
          .then((impact) => patch({ impact }))
          // Etki tablosu yoksa bölüm hiç çizilmez; satırın kalanı çalışır.
          .catch(() => undefined);
        return { ...current, [key]: { newsLoading: true, news: [], impact: null } };
      });
    },
    [lang],
  );

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
            source_url: HOLIDAY_SOURCE_URL,
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
      localStorage.setItem(CACHE_KEY, JSON.stringify({ version: CACHE_VERSION, savedAt: now, events: merged }));
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
              const source = sourceUrlOf(event);
              const rowKey = `${date}-${index}`;
              // Resmi tatilin açıklanan verisi ve haber gündemi yok; eski
              // davranış korunur, satır doğrudan tatil listesine çıkar.
              const isHoliday = event.impact === 'holiday';
              const expanded = openRow === rowKey;
              const detail = detailByRow[rowKey];
              return (
                <div key={rowKey} className={`eco-cal-item${expanded ? ' is-open' : ''}`}>
                <button
                  type="button"
                  className="eco-cal-row"
                  aria-expanded={isHoliday ? undefined : expanded}
                  title={isHoliday ? t('ecoCalOpenSource', { source: hostOf(source) }) : t('ecoCalDetails')}
                  onClick={() =>
                    isHoliday
                      ? // Tatilin açıklanan verisi ve haber gündemi yok; kaynak
                        // sayfası doğrudan açılır — ama o da uygulama içinde.
                        openInReader({
                          id: source,
                          title: event.event,
                          source: hostOf(source),
                          kindLabel: t('ecoCalOpenIndicator'),
                          published: event.date,
                          url: source,
                          sourceKind: 'article',
                        })
                      : toggleRow(rowKey, event)
                  }
                >
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

                  {/* Tıklanabilirlik göstergesi; yeri hep ayrılır ki
                      imleç satıra girince düzen kaymasın. */}
                  <span className="eco-cal-open" aria-hidden="true">
                    {isHoliday ? '↗' : expanded ? '▾' : '▸'}
                  </span>
                </button>

                {expanded && !isHoliday && (
                  <div className="eco-cal-detail">
                    <div className="eco-cal-detail-actions">
                      {/* Gösterge sayfası uygulama içinde, kaynağın KENDİ
                          düzeniyle açılır: grafiği ve tablosu görünsün diye
                          sade metne indirgenmez (bkz. `indicator` türü). */}
                      <button
                        type="button"
                        onClick={() =>
                          openInReader({
                            id: source,
                            title: event.event,
                            source: hostOf(source),
                            kindLabel: t('ecoCalOpenIndicator'),
                            published: event.date,
                            url: source,
                            sourceKind: 'indicator',
                          })
                        }
                      >
                        {t('ecoCalOpenIndicator')}
                      </button>
                      {/* Dış tarayıcı düğmesi burada YOK: her şey uygulama
                          içinde okunur. Çıkmak isteyen için okuyucunun kendi
                          araç çubuğunda "↗ Dışarıda aç" duruyor. */}
                    </div>

                    {/* Etkilenebilecek paylar. Kanal cümlesi boşsa kategori
                        sözlükte yok demektir; uydurma etiket göstermektense
                        bölüm hiç çizilmez. */}
                    {detail?.impact?.channel && (
                      <div className="eco-cal-impact">
                        <div className="eco-cal-news-title">{t('ecoCalImpactTitle')}</div>
                        <p className="eco-cal-impact-channel">{detail.impact.channel}</p>
                        <TagRow
                          label={t('ecoCalImpactBist')}
                          links={detail.impact.bist}
                          openLabel={t('ecoCalOpenSymbol')}
                          onOpen={openSymbol}
                          // BIST kodunun karşılığı her zaman bir hisse sayfası.
                          canOpen={() => true}
                        />
                        <TagRow
                          label={t('ecoCalImpactGlobal')}
                          links={detail.impact.global}
                          openLabel={t('ecoCalOpenSymbol')}
                          onOpen={openSymbol}
                          canOpen={canOpenSymbol}
                        />
                        <p className="eco-cal-impact-note">{t('ecoCalImpactDisclaimer')}</p>
                      </div>
                    )}

                    {/* İlgili analiz raporları: kurum arşivinde bu konuya ya da
                        etiketlenen paylara ayrılmış yakın tarihli kayıtlar. */}
                    {detail?.impact && (
                      <>
                        <div className="eco-cal-news-title">{t('ecoCalRelatedReports')}</div>
                        {detail.impact.reports.length === 0 && (
                          <div className="eco-cal-news-note">
                            {detail.impact.archive_ready
                              ? t('ecoCalReportsEmpty')
                              : t('ecoCalReportsArchiveEmpty')}
                          </div>
                        )}
                        <ul className="eco-cal-news">
                          {detail.impact.reports.map((report) => (
                            <li key={report.id}>
                              <button
                                type="button"
                                // Rapor, Analiz modülündekiyle aynı okuyucuda
                                // açılır: PDF indirilip uygulama içinde çizilir.
                                onClick={() =>
                                  openInReader(documentFromReport(report, t('ecoCalReportKind')))
                                }
                              >
                                <span className="eco-cal-news-headline">{report.title}</span>
                                <span className="eco-cal-news-source">
                                  {report.broker}
                                  {newsDate(report.published, locale) && (
                                    <> · {newsDate(report.published, locale)}</>
                                  )}
                                  {report.tickers.length > 0 && <> · {report.tickers.join(', ')}</>}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}

                    <div className="eco-cal-news-title">{t('ecoCalRelatedNews')}</div>
                    {detail?.newsLoading && (
                      <div className="eco-cal-news-note">{t('ecoCalNewsLoading')}</div>
                    )}
                    {detail && !detail.newsLoading && detail.news.length === 0 && (
                      <div className="eco-cal-news-note">{t('ecoCalNewsEmpty')}</div>
                    )}
                    <ul className="eco-cal-news">
                      {(detail?.news ?? []).slice(0, 8).map((item) => (
                        <li key={item.link}>
                          <button
                            type="button"
                            // Haber uygulama içindeki okuyucuda açılır; dış
                            // tarayıcıya çıkmak için okuyucunun araç çubuğu var.
                            onClick={() =>
                              openInReader(
                                documentFromNews(item, t('ecoCalNewsKind'), item.pub_date ?? ''),
                              )
                            }
                          >
                            <span className="eco-cal-news-headline">{item.title}</span>
                            <span className="eco-cal-news-source">
                              {item.source}
                              {/* Tarih bağlamın parçası: aynı göstergenin
                                  farklı dönemlere ait yorumları karışmasın. */}
                              {newsDate(item.pub_date, locale) && (
                                <> · {newsDate(item.pub_date, locale)}</>
                              )}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
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
