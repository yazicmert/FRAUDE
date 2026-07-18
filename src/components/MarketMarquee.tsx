import { useEffect, useMemo, useState } from 'react';
import { getDashboardSnapshot } from '../api/tauriClient';
import { useLiveQuotes } from '../hooks/useLiveQuotes';
import { isBistEquity } from '../lib/equityGroups';
import { useTranslation } from '../api/i18n';
import type { DashboardSnapshot, MarketMetric } from '../types';

/**
 * Üst şerit: sürekli akan piyasa özeti.
 *
 * Panoda endeksler akar. Pano dışındaki sayfalarda pano panelleri görünmediği
 * için şerit BIST'in gün içi yükselen/düşenlerine döner; böylece hangi sayfada
 * olursan ol günün hareketi görünür kalır.
 */
export type MarqueeMode = 'indices' | 'movers';

/** Şeritte gösterilen tek kalem. */
interface MarqueeItem {
  /** Tıklanınca açılacak sembol (Yahoo/backend formatı). */
  symbol: string;
  /** Şeritte görünen etiket. */
  label: string;
  value: string;
  change: string;
  positive: boolean;
}

interface MarketMarqueeProps {
  /** Şeridin ne göstereceği. */
  mode: MarqueeMode;
  onOpenTicker?: (ticker: string) => void;
}

/** Her yönde kaç hisse akacağı (yükselen ve düşen ayrı ayrı). */
const MOVERS_PER_SIDE = 10;

const LABEL_TO_TICKER: Record<string, string> = {
  'BIST 100': 'XU100.IS',
  'BIST 30': 'XU030.IS',
  'BIST BANKA': 'XBANK.IS',
  'BIST SINAI': 'XUSIN.IS',
  'USD/TRY': 'USDTRY=X',
  'EUR/TRY': 'EURTRY=X',
  'S&P 500': '^GSPC',
  NASDAQ: '^IXIC',
  'DOW JONES': '^DJI',
  DAX: '^GDAXI',
  'FTSE 100': '^FTSE',
  'Altın Ons ($)': 'GC=F',
  'Brent Petrol ($)': 'BZ=F',
  'Bitcoin ($)': 'BTC-USD',
};

function fromMetric(metric: MarketMetric): MarqueeItem {
  return {
    symbol: LABEL_TO_TICKER[metric.symbol] ?? metric.symbol,
    label: metric.symbol,
    value: metric.value,
    change: metric.change,
    positive: metric.positive,
  };
}

/**
 * BIST'in gün içi en çok yükselen ve düşen hisseleri.
 *
 * Evren global hisseleri ve emtiaları da içerdiğinden, BIST dışı gruplar elenir.
 * Fiyatı olmayan (Yahoo'dan veri gelmemiş) satırlar da listeye girmez.
 */
function toMovers(snapshot: DashboardSnapshot): MarqueeItem[] {
  const bist = (snapshot.equities ?? []).filter(
    (row) => row.price > 0 && Number.isFinite(row.change_pct) && isBistEquity(row),
  );
  if (bist.length === 0) return [];

  const sorted = [...bist].sort((a, b) => b.change_pct - a.change_pct);
  const gainers = sorted.filter((row) => row.change_pct > 0).slice(0, MOVERS_PER_SIDE);
  const losers = sorted
    .filter((row) => row.change_pct < 0)
    .slice(-MOVERS_PER_SIDE)
    .reverse();

  return [...gainers, ...losers].map((row) => ({
    symbol: row.ticker,
    label: row.ticker,
    value: row.price.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    change: `${row.change_pct > 0 ? '+' : ''}${row.change_pct.toFixed(2)}%`,
    positive: row.change_pct > 0,
  }));
}

export default function MarketMarquee({ mode, onOpenTicker }: MarketMarqueeProps) {
  const { t, lang } = useTranslation();
  const locale = lang === 'tr' ? 'tr-TR' : 'en-US';
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);

  // Mod değişimi (endeksler ↔ yükselen/düşen) içerik listesini ve şerit
  // genişliğini bir anda değiştirdiğinden akış ortasında sert bir sıçrama
  // yaratıyordu. Görünen mod istenen modu kısa bir karartmayla takip eder:
  // şerit önce söner, içerik görünmezken takas edilir, sonra geri yanar.
  const [shownMode, setShownMode] = useState<MarqueeMode>(mode);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (mode === shownMode) {
      setFading(false);
      return;
    }
    setFading(true);
    const timer = setTimeout(() => {
      setShownMode(mode);
      setFading(false);
    }, 170); // App.css'teki .market-marquee opacity geçişiyle uyumlu
    return () => clearTimeout(timer);
  }, [mode, shownMode]);

  useEffect(() => {
    let cancelled = false;

    const fetchSnapshot = async () => {
      try {
        const snap = await getDashboardSnapshot();
        if (!cancelled) setSnapshot(snap);
      } catch {
        // Ağ yok: eldeki veri korunur, şerit boşalmaz.
      }
    };

    void fetchSnapshot();
    const timer = setInterval(() => void fetchSnapshot(), 30000);
    // Senkron bitince yükselen/düşen listesi hemen tazelensin.
    window.addEventListener('fraude-sync-completed', fetchSnapshot);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('fraude-sync-completed', fetchSnapshot);
    };
  }, []);

  // Sıralama ağır senkrondan gelir (tüm evren gerekir); şeritte görünen az
  // sayıda sembolün fiyatı ise gecikmeli canlı uçtan sürekli tazelenir.
  const ranked = useMemo<MarqueeItem[]>(() => {
    if (!snapshot) return [];
    const indices = (snapshot.market_metrics ?? []).map(fromMetric);
    if (shownMode !== 'movers') return indices;
    // Hisse evreni henüz dolmadıysa (ilk senkron, sağlayıcı hız sınırı) şeridi
    // boş bırakmak yerine endekslere düş: şerit için 32px'lik satır her hâlükârda
    // ayrılmıştır, boş kalırsa yerinde siyah bir bant görünür.
    const movers = toMovers(snapshot);
    return movers.length > 0 ? movers : indices;
  }, [snapshot, shownMode]);

  const liveSymbols = useMemo(
    () => (shownMode === 'movers' ? ranked.map((item) => item.symbol) : []),
    [shownMode, ranked],
  );
  const live = useLiveQuotes(liveSymbols);

  const items = useMemo<MarqueeItem[]>(
    () =>
      ranked.map((item) => {
        const quote = live.get(item.symbol);
        if (!quote) return item;
        return {
          ...item,
          value: quote.price.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          change: `${quote.change_pct > 0 ? '+' : ''}${quote.change_pct.toFixed(2)}%`,
          positive: quote.change_pct > 0,
        };
      }),
    [ranked, live],
  );

  /** BIST verisinin tazeliği; şeridin tamamına tooltip olarak asılır. */
  const freshness = useMemo(() => {
    const stamps = (snapshot?.market_metrics ?? [])
      .filter((m) => m.symbol.startsWith('BIST'))
      .map((m) => m.as_of_ts ?? 0);
    const latest = Math.max(0, ...stamps);
    if (!latest) return t('marqueeSource');
    const asOf = new Date(latest * 1000);
    const lagMin = Math.round((Date.now() - asOf.getTime()) / 60000);
    const time = asOf.toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const lag = lagMin <= 90 ? t('marqueeLag', { n: Math.max(lagMin, 15) }) : t('marqueeClosedLag');
    return t('marqueeFreshness', { time, lag });
  }, [snapshot, t, locale]);

  // Şerit satırı düzende sabit yer kapladığı için hiçbir durumda boşa düşmez.
  if (items.length === 0) {
    return (
      <div className="market-marquee-container" title={freshness}>
        <span className="marquee-placeholder">
          {snapshot ? t('marqueeWaiting') : t('marqueeLoading')}
        </span>
      </div>
    );
  }

  // Sonsuz akışın kesintisiz görünmesi için aynı liste iki kez basılır.
  const track = (copy: string) => (
    <div className="market-marquee-content">
      {items.map((item, index) => (
        <div
          key={`${copy}-${item.label}-${index}`}
          className={`marquee-item ${onOpenTicker ? 'clickable' : ''}`}
          onClick={() => onOpenTicker?.(item.symbol)}
        >
          <span className="marquee-symbol">{item.label}</span>
          <span className="marquee-value">{item.value}</span>
          <span className={`marquee-change ${item.positive ? 'positive' : 'negative'}`}>{item.change}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="market-marquee-container" title={freshness}>
      <div className={`market-marquee${fading ? ' marquee-fading' : ''}`}>
        {track('a')}
        {track('b')}
      </div>
    </div>
  );
}
