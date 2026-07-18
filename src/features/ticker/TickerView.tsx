import { useEffect, useMemo, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip as ChartTooltip, ResponsiveContainer } from 'recharts';
import { openUrl } from '../../lib/openExternal';
import { getTickerSnapshot, getPriceHistory, getNewsFeed, getKapForTicker, getDividends, getCapitalIncreases, getShareholders, getSubsidiaries, researchEntityNews, getTickerFunds, type PriceSource, type TickerFundsPayload } from '../../api/tauriClient';
import { useTranslation } from '../../api/i18n';
import type { TickerSnapshot, HistoricalQuote, NewsItem, KapAnnouncement, DividendRecord, CapitalIncrease, ShareholderSnapshot, SubsidiarySnapshot } from '../../types';
import PriceChart from './PriceChart';
import { NewsList } from '../news/NewsFeedView';
import { useWatchlist } from '../../hooks/useWatchlist';
import { dispatchAiAsk, dispatchOpenAlerts } from '../../lib/actions';
import FinancialsTab from './FinancialsTab';
import WatchlistJournal from './WatchlistJournal';
import FlashValue from '../../components/FlashValue';
import { useLiveQuotes } from '../../hooks/useLiveQuotes';
import { hasCorporateData } from '../../lib/instrumentKind';
import { BellIcon, SparklesIcon, StarIcon } from '../../components/icons';

const OWNER_COLORS = ['#58a6ff', '#3fb950', '#d29922', '#a371f7', '#ff7b72', '#00ced1', '#f0883e', '#7ee787'];

// Ortaklık yapısını etkileyebilecek KAP bildirimi başlık kalıpları
const OWNERSHIP_KAP_KEYWORDS = ['pay alım', 'pay satış', 'payların', 'pay devri', 'hisse devri', 'ortaklık yapısı', 'geri alım', 'çağrı', 'blok satış'];

// Ortak adı sınıflandırması: tüzel kişi (şirket/holding/vakıf/fon) etiketleri
// haber araştırmasına, gerçek kişiler (patronlar) geçmiş araştırmasına gider;
// "Diğer" / "Halka Açık" gibi jenerik kalemler araştırılmaz.
type HolderKind = 'company' | 'person' | 'generic';

const GENERIC_HOLDER_PATTERNS = ['DİĞER', 'DIGER', 'HALKA AÇIK', 'HALKA ACIK', 'FREE FLOAT', 'OTHER', 'BİLİNMİYOR'];
const CORPORATE_HOLDER_KEYWORDS = [
  'A.Ş', 'A.S.', ' AŞ', 'ANONİM', 'HOLDİNG', 'HOLDING', 'VAKFI', 'VAKIF', 'LTD', 'ŞTİ', 'LİMİTED',
  'GMBH', 'B.V', 'N.V', 'S.A', 'INC', 'LLC', 'CORP', 'GROUP', 'GRUP', 'YATIRIM', 'PORTFÖY',
  'FONU', 'BANKASI', 'SİGORTA', 'GİRİŞİM', 'ŞİRKETİ', 'SANAYİ', 'TİCARET', 'MENKUL', 'GYO', 'AİLESİ',
];

function classifyHolder(name: string): HolderKind {
  const upper = name.toLocaleUpperCase('tr-TR');
  if (GENERIC_HOLDER_PATTERNS.some((pattern) => upper.includes(pattern))) return 'generic';
  if (CORPORATE_HOLDER_KEYWORDS.some((keyword) => upper.includes(keyword))) return 'company';
  return 'person';
}

// Uzun ticari ünvanları arama sorgusu için kısaltır: hukuki/jenerik ek
// başlayınca keser (örn. "ASELSAN GLOBAL DIŞ TİCARET VE PAZARLAMA A.Ş."
// → "ASELSAN GLOBAL DIŞ"), en fazla 3 kelime tutar.
const COMPANY_NAME_STOPWORDS = new Set([
  'SANAYİ', 'SANAYİİ', 'SAN.', 'SAN', 'TİCARET', 'TİC.', 'TİC', 'VE', 'A.Ş.', 'A.Ş', 'AŞ', 'A.S.',
  'A.O.', 'T.A.Ş.', 'LTD.', 'LTD', 'ŞTİ.', 'ŞTİ', 'LİMİTED', 'ANONİM', 'ŞİRKETİ', 'İNŞAAT', 'TAAHHÜT',
]);

function shortenCompanyName(name: string): string {
  const words = name.trim().split(/\s+/);
  const kept: string[] = [];
  for (const word of words) {
    const upper = word.toLocaleUpperCase('tr-TR').replace(/[()"]/g, '');
    if (COMPANY_NAME_STOPWORDS.has(upper)) break;
    kept.push(word);
    if (kept.length >= 3) break;
  }
  return kept.length > 0 ? kept.join(' ') : name;
}

// Patron aramasında X sorgusu sadece isimle değil, şirket bağlamıyla
// (hisse kodu, #hashtag, şirket adı) daraltılır.
const xSearchUrl = (name: string, companyContext?: { ticker: string; company: string }) => {
  const query = companyContext
    ? `"${name}" (${companyContext.ticker} OR #${companyContext.ticker} OR "${companyContext.company}")`
    : `"${name}"`;
  return `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=top`;
};
const linkedInSearchUrl = (name: string, kind: 'company' | 'person') =>
  kind === 'person'
    ? `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(name)}`
    : `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(name)}`;
const googleSearchUrl = (name: string) =>
  `https://www.google.com/search?q=${encodeURIComponent(`"${name}"`)}`;

export default function TickerView({ ticker }: { ticker: string }) {
  const { t } = useTranslation();
  const { isInWatchlist, toggleWatchlist } = useWatchlist();
  // Fiyat, ağır anlık görüntüden bağımsız olarak gecikmeli canlı uçtan tazelenir;
  // yalnızca fiyat bloğu yeniden çizilir, sayfanın geri kalanı yerinde kalır.
  const liveSymbols = useMemo(() => [ticker], [ticker]);
  const live = useLiveQuotes(liveSymbols);
  const [snapshot, setSnapshot] = useState<TickerSnapshot | null>(null);
  const [history, setHistory] = useState<HistoricalQuote[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [kapItems, setKapItems] = useState<KapAnnouncement[]>([]);
  const [kapLoading, setKapLoading] = useState(true);
  const [dividends, setDividends] = useState<DividendRecord[]>([]);
  const [capitalIncreases, setCapitalIncreases] = useState<CapitalIncrease[]>([]);
  const [shareholders, setShareholders] = useState<ShareholderSnapshot | null>(null);
  const [shareholdersLoading, setShareholdersLoading] = useState(true);
  const [shareholdersError, setShareholdersError] = useState<string | null>(null);
  const [subsidiaries, setSubsidiaries] = useState<SubsidiarySnapshot | null>(null);
  const [subsidiariesLoading, setSubsidiariesLoading] = useState(true);
  const [subsidiariesError, setSubsidiariesError] = useState<string | null>(null);
  const [tickerFunds, setTickerFunds] = useState<TickerFundsPayload | null>(null);
  const [research, setResearch] = useState<{ name: string; kind: 'company' | 'person' } | null>(null);
  const [researchNews, setResearchNews] = useState<NewsItem[]>([]);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState('6mo');
  // Fiyat kaynağı: Yahoo (mum + hacim) veya İş Yatırım (düzeltilmiş kapanış-only).
  // Yalnız BIST hisseleri için anlamlı; endeks/emtia/yabancı sembollerde gizlenir.
  const [priceSource, setPriceSource] = useState<PriceSource>('yahoo');
  // Kurumsal bölümler (KAP, ortaklık, temettü/bedelsiz, mali tablolar, İş
  // Yatırım kaynağı) tek merkezden açılıp kapanır: emtia/endeks/döviz/kripto
  // sayfalarında bu veriler ne çekilir ne gösterilir. Anlık görüntü gelince
  // backend etiketi (ör. AAPL → "Global") sınıflandırmayı keskinleştirir.
  const corporate = hasCorporateData(ticker, snapshot?.equity.index_memberships ?? null);
  const [activeTab, setActiveTab] = useState<'overview' | 'financials'>('overview');

  useEffect(() => {
    setSnapshot(null);
    setError(null);
    setActiveTab('overview');

    getTickerSnapshot(ticker)
      .then(setSnapshot)
      .catch((err: unknown) => setError(String(err)));
  }, [ticker]);

  // Hisse değişince kaynak Yahoo'ya döner: İş Yatırım yalnız BIST hisselerinde
  // veri döndürür, yeni sembol BIST dışıysa seçili İş Yatırım isteği boşa gider.
  useEffect(() => {
    setPriceSource('yahoo');
  }, [ticker]);

  // Tüm geçmiş bir kez çekilir; aralık butonları yalnızca görünümü değiştirir,
  // böylece MAX dahil her aralıkta yeniden istek atılmaz. Kaynak değişince
  // (Yahoo ↔ İş Yatırım) seri yeniden çekilir.
  useEffect(() => {
    setHistory([]);
    getPriceHistory(ticker, 'max', priceSource)
      .then(setHistory)
      .catch((err: unknown) => console.error('Failed to load history:', err));
  }, [ticker, priceSource]);

  useEffect(() => {
    setNews([]);
    setNewsLoading(true);
    getNewsFeed(ticker)
      .then(setNews)
      .catch((err: unknown) => console.error('Failed to load company news:', err))
      .finally(() => setNewsLoading(false));
  }, [ticker]);

  // Gerçek KAP bildirimleri (resmi KAP API'si; yoksa haber araması) + temettü
  // ve bölünme geçmişi
  useEffect(() => {
    setKapItems([]);
    setDividends([]);
    setCapitalIncreases([]);
    // Kurumsal olmayan enstrümanlarda (emtia/endeks/döviz/kripto) KAP,
    // temettü ve bedelsiz kavramları yoktur; istek hiç atılmaz.
    if (!corporate) {
      setKapLoading(false);
      setHistoryLoading(false);
      return;
    }
    setKapLoading(true);
    getKapForTicker(ticker)
      .then(setKapItems)
      .catch((err: unknown) => console.error('Failed to load KAP disclosures:', err))
      .finally(() => setKapLoading(false));

    setHistoryLoading(true);
    Promise.allSettled([getDividends(ticker), getCapitalIncreases(ticker)])
      .then(([div, cap]) => {
        if (div.status === 'fulfilled') setDividends(div.value);
        if (cap.status === 'fulfilled') setCapitalIncreases(cap.value);
      })
      .finally(() => setHistoryLoading(false));
  }, [ticker, corporate]);

  // Hisseyi tutan fonlar: yerelde biriken PDR dizininden okunur, ağa çıkmaz.
  // Dizin arka plan taramasıyla dolar; kurumsal olmayan enstrümanlarda anlamsız.
  useEffect(() => {
    setTickerFunds(null);
    if (!corporate) return;
    getTickerFunds(ticker)
      .then(setTickerFunds)
      .catch((err: unknown) => console.error('Failed to load ticker funds:', err));
  }, [ticker, corporate]);

  // Ortaklık yapısı ilk açılışta bir kez çekilip diske yazılır; sonraki
  // açılışlar önbellekten gelir, değişiklik takibi KAP bildirimlerindedir.
  const loadShareholders = (forceRefresh = false) => {
    setShareholdersLoading(true);
    setShareholdersError(null);
    getShareholders(ticker, forceRefresh)
      .then(setShareholders)
      .catch((err: unknown) => setShareholdersError(String(err)))
      .finally(() => setShareholdersLoading(false));
  };

  useEffect(() => {
    setShareholders(null);
    setShareholdersError(null);
    if (!corporate) {
      setShareholdersLoading(false);
      return;
    }
    loadShareholders();
  }, [ticker, corporate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bağlı ortaklık / iştirak tablosu KAP Genel Bilgiler sayfasından bir kez
  // çekilip diske yazılır; "Yenile" ile tazelenir.
  const loadSubsidiaries = (forceRefresh = false) => {
    setSubsidiariesLoading(true);
    setSubsidiariesError(null);
    getSubsidiaries(ticker, forceRefresh)
      .then(setSubsidiaries)
      .catch((err: unknown) => setSubsidiariesError(String(err)))
      .finally(() => setSubsidiariesLoading(false));
  };

  useEffect(() => {
    setSubsidiaries(null);
    setSubsidiariesError(null);
    if (!corporate) {
      setSubsidiariesLoading(false);
      return;
    }
    loadSubsidiaries();
  }, [ticker, corporate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ortak etiketine tıklanınca haber araştırması: şirketlerde son dönem,
  // patronlarda geniş pencereli geçmiş araması yapılır.
  const openResearch = (name: string, kind: 'company' | 'person') => {
    setResearch({ name, kind });
    setResearchNews([]);
    setResearchError(null);
    setResearchLoading(true);
    researchEntityNews(name, kind)
      .then(setResearchNews)
      .catch((err: unknown) => setResearchError(String(err)))
      .finally(() => setResearchLoading(false));
  };

  useEffect(() => {
    const handleSync = () => {
      getTickerSnapshot(ticker).then(setSnapshot).catch(console.error);
      getPriceHistory(ticker, 'max', priceSource).then(setHistory).catch(console.error);
    };

    window.addEventListener('fraude-sync-completed', handleSync);
    return () => window.removeEventListener('fraude-sync-completed', handleSync);
  }, [ticker, priceSource]);

  if (error) return <div className="empty-state error">{error}</div>;
  if (!snapshot) return <div className="empty-state">{t('loadingChart')} {ticker}...</div>;

  const { equity } = snapshot;

  // Gecikmeli canlı fiyat varsa onu göster; yoksa (global hisse, seans kapalı,
  // sağlayıcı erişilemedi) anlık görüntüdeki değer korunur.
  const quote = live.get(ticker.trim().replace(/\.IS$/i, '').toUpperCase());
  const price = quote?.price ?? equity.price;
  const changePct = quote?.change_pct ?? equity.change_pct;

  // Labeled zones for RSI
  const getRsiZone = (val: number) => {
    if (val < 30) return t('rsiOversold');
    if (val > 70) return t('rsiOverbought');
    return t('rsiNeutral');
  };

  const ownershipKapItems = kapItems.filter((item) => {
    const title = item.title.toLowerCase();
    return OWNERSHIP_KAP_KEYWORDS.some((keyword) => title.includes(keyword));
  });

  const holderList = shareholders?.holders ?? [];
  const corporateHolders = holderList.filter((holder) => classifyHolder(holder.name) === 'company');
  const personHolders = holderList.filter((holder) => classifyHolder(holder.name) === 'person');

  const metric = (value: number | null, suffix = '') => value === null ? '—' : `${value.toFixed(1)}${suffix}`;
  const signedMetric = (value: number | null, suffix = '') => value === null
    ? '—'
    : `${value >= 0 ? '+' : ''}${value.toFixed(1)}${suffix}`;

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <p className="eyebrow">{t('tickerDetail')}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <h1>{equity.ticker}</h1>
            <button
              type="button"
              className={`ticker-action-btn${isInWatchlist(ticker) ? ' active' : ''}`}
              onClick={() => toggleWatchlist(ticker, equity.price)}
              title={isInWatchlist(ticker) ? t('removeFromWatchlist') : t('addToWatchlist')}
            >
              <StarIcon filled={isInWatchlist(ticker)} />
              {isInWatchlist(ticker) ? t('inWatchlist') : t('addToWatchlist')}
            </button>
            <button
              type="button"
              className="ticker-action-btn"
              onClick={() => dispatchAiAsk(
                `${equity.ticker} (${equity.name}) ${corporate ? 'hissesinde' : 'enstrümanında'} bugünkü %${equity.change_pct.toFixed(2)} hareketin olası nedenlerini ve teknik görünümü (fiyat ${equity.price.toFixed(2)}, RSI ${equity.rsi.toFixed(1)}${corporate ? `, F/K ${equity.pe?.toFixed(2) ?? 'yok'}` : ''}) kısaca yorumla. Yatırım tavsiyesi verme.`,
              )}
              title={t('explainMoveHint')}
            >
              <SparklesIcon />
              {t('explainMove')}
            </button>
            <button
              type="button"
              className="ticker-action-btn"
              onClick={() => dispatchOpenAlerts(equity.ticker)}
              title={t('setAlertHint')}
            >
              <BellIcon />
              {t('setAlert')}
            </button>
          </div>
          <p>{equity.name}</p>
        </div>
        <div className="price-block" title={quote ? t('liveDelayedHint') : undefined}>
          <strong><FlashValue value={price} format={(v) => v.toFixed(2)} style={{ borderRadius: '4px', padding: '0 4px' }} /></strong>
          <span className={changePct >= 0 ? 'positive' : 'negative'}>
            {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
          </span>
        </div>
      </div>

      <section className="panel" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <strong>{t('priceHistory')}</strong>
            {corporate && (
              <div className="source-selector" style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{t('chartSource')}:</span>
                {(['yahoo', 'isyatirim'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setPriceSource(s)}
                    title={s === 'yahoo' ? t('sourceYahooHint') : t('sourceIsyatirimHint')}
                    style={{
                      padding: '3px 8px',
                      fontSize: '0.72rem',
                      background: priceSource === s ? 'var(--accent-primary)' : 'var(--bg-panel)',
                      color: priceSource === s ? '#000000' : 'var(--text-muted)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    {s === 'yahoo' ? 'Yahoo' : 'İş Yatırım'}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="range-selector" style={{ display: 'flex', gap: '6px' }}>
            {['1mo', '3mo', '6mo', '1y', '5y', 'max'].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`small-button ${range === r ? 'active' : ''}`}
                style={{
                  padding: '4px 8px',
                  fontSize: '0.8rem',
                  background: range === r ? 'var(--accent-primary)' : 'var(--bg-panel)',
                  color: range === r ? '#000000' : 'var(--text-muted)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                {r.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        {history.length > 0 ? (
          <PriceChart ticker={ticker} data={history} range={range} livePrice={quote?.price ?? null} />
        ) : (
          <div className="empty-state" style={{ height: '350px' }}>{t('loadingChart')} {ticker}...</div>
        )}
      </section>

      <WatchlistJournal ticker={ticker} price={equity.price} />

      <div className="tabs" style={{ marginBottom: '16px', display: 'flex', gap: '16px', borderBottom: '1px solid var(--border-color)' }}>
        <button
          className={activeTab === 'overview' ? 'active' : ''}
          onClick={() => setActiveTab('overview')}
          style={{ padding: '8px 16px', background: 'none', border: 'none', borderBottom: activeTab === 'overview' ? '2px solid var(--accent-primary)' : '2px solid transparent', color: activeTab === 'overview' ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer', fontWeight: activeTab === 'overview' ? 'bold' : 'normal' }}
        >
          {t('overview') || 'Genel Bakış'}
        </button>
        {corporate && (
          <button
            className={activeTab === 'financials' ? 'active' : ''}
            onClick={() => setActiveTab('financials')}
            style={{ padding: '8px 16px', background: 'none', border: 'none', borderBottom: activeTab === 'financials' ? '2px solid var(--accent-primary)' : '2px solid transparent', color: activeTab === 'financials' ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer', fontWeight: activeTab === 'financials' ? 'bold' : 'normal' }}
          >
            {t('financialsDetail') || 'Mali Tablolar'}
          </button>
        )}
      </div>

      {activeTab === 'financials' && corporate ? (
        <FinancialsTab ticker={equity.ticker} />
      ) : (
      <>
      <div className="split-grid" style={{ display: 'grid', gridTemplateColumns: corporate ? '1fr 1fr' : '1fr', gap: '16px' }}>
        <section className="panel">
          <h2>{t('technicals')}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px', marginTop: '12px' }}>
            <div style={{ background: '#0d1117', padding: '12px', borderRadius: '4px', border: '1px solid #21262d' }}>
              <span style={{ fontSize: '0.75rem', color: '#8b949e' }}>RSI (14)</span>
              <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: equity.rsi < 30 ? '#3fb950' : equity.rsi > 70 ? '#f85149' : '#ffffff', marginTop: '4px' }}>
                {equity.rsi.toFixed(1)}
              </div>
              <span style={{ fontSize: '0.65rem', color: '#8b949e' }}>{getRsiZone(equity.rsi)}</span>
            </div>
            <div style={{ background: '#0d1117', padding: '12px', borderRadius: '4px', border: '1px solid #21262d' }}>
              <span style={{ fontSize: '0.75rem', color: '#8b949e' }}>MACD (12, 26)</span>
              <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: equity.macd >= 0 ? '#3fb950' : '#f85149', marginTop: '4px' }}>
                {equity.macd.toFixed(2)}
              </div>
            </div>
            <div style={{ background: '#0d1117', padding: '12px', borderRadius: '4px', border: '1px solid #21262d' }}>
              <span style={{ fontSize: '0.75rem', color: '#8b949e' }}>EMA (20)</span>
              <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#ffffff', marginTop: '4px' }}>
                {equity.ema_20.toFixed(2)}
              </div>
            </div>
            <div style={{ background: '#0d1117', padding: '12px', borderRadius: '4px', border: '1px solid #21262d' }}>
              <span style={{ fontSize: '0.75rem', color: '#8b949e' }}>SMA (50)</span>
              <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#ffffff', marginTop: '4px' }}>
                {equity.sma_50.toFixed(2)}
              </div>
            </div>
            <div style={{ background: '#0d1117', padding: '12px', borderRadius: '4px', border: '1px solid #21262d' }}>
              <span style={{ fontSize: '0.75rem', color: '#8b949e' }}>ATR (14)</span>
              <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#ffffff', marginTop: '4px' }}>
                {equity.atr.toFixed(2)}
              </div>
            </div>
            <div style={{ background: '#0d1117', padding: '12px', borderRadius: '4px', border: '1px solid #21262d', gridColumn: 'span 2' }}>
              <span style={{ fontSize: '0.75rem', color: '#8b949e' }}>Bollinger Band</span>
              <div style={{ fontSize: '1rem', fontWeight: 'bold', color: '#58a6ff', marginTop: '4px' }}>
                {equity.bollinger_position}
              </div>
            </div>
          </div>
        </section>

        {corporate && (
        <section className="panel">
          <h2>{t('fundamentals')}</h2>
          {!equity.fundamentals_available ? (
            <div className="empty-state" style={{ minHeight: '180px' }}>
              {t('fundamentalsUnavailable')}
            </div>
          ) : (
          <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px', marginTop: '12px' }}>
            <div style={{ background: '#0d1117', padding: '12px', borderRadius: '4px', border: '1px solid #21262d' }}>
              <span style={{ fontSize: '0.75rem', color: '#8b949e' }}>F/K (P/E)</span>
              <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#ffffff', marginTop: '4px' }}>
                {metric(equity.pe)}
              </div>
            </div>
            <div style={{ background: '#0d1117', padding: '12px', borderRadius: '4px', border: '1px solid #21262d' }}>
              <span style={{ fontSize: '0.75rem', color: '#8b949e' }}>PD/DD (P/B)</span>
              <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#ffffff', marginTop: '4px' }}>
                {metric(equity.pb)}
              </div>
            </div>
            <div style={{ background: '#0d1117', padding: '12px', borderRadius: '4px', border: '1px solid #21262d' }}>
              <span style={{ fontSize: '0.75rem', color: '#8b949e' }}>ROE</span>
              <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#3fb950', marginTop: '4px' }}>
                {metric(equity.roe, '%')}
              </div>
            </div>
            <div style={{ background: '#0d1117', padding: '12px', borderRadius: '4px', border: '1px solid #21262d' }}>
              <span style={{ fontSize: '0.75rem', color: '#8b949e' }}>ROA</span>
              <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#3fb950', marginTop: '4px' }}>
                {metric(equity.roa, '%')}
              </div>
            </div>
            <div style={{ background: '#0d1117', padding: '12px', borderRadius: '4px', border: '1px solid #21262d' }}>
              <span style={{ fontSize: '0.75rem', color: '#8b949e' }}>Net Margin</span>
              <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#ffffff', marginTop: '4px' }}>
                {metric(equity.net_margin, '%')}
              </div>
            </div>
            <div style={{ background: '#0d1117', padding: '12px', borderRadius: '4px', border: '1px solid #21262d' }}>
              <span style={{ fontSize: '0.75rem', color: '#8b949e' }}>Gross Margin</span>
              <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#ffffff', marginTop: '4px' }}>
                {metric(equity.gross_margin, '%')}
              </div>
            </div>
            <div style={{ background: '#0d1117', padding: '12px', borderRadius: '4px', border: '1px solid #21262d' }}>
              <span style={{ fontSize: '0.75rem', color: '#8b949e' }}>Sales Growth</span>
              <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#3fb950', marginTop: '4px' }}>
                {signedMetric(equity.sales_growth, '%')}
              </div>
            </div>
            <div style={{ background: '#0d1117', padding: '12px', borderRadius: '4px', border: '1px solid #21262d' }}>
              <span style={{ fontSize: '0.75rem', color: '#8b949e' }}>Profit Growth</span>
              <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: (equity.profit_growth ?? 0) >= 0 ? '#3fb950' : '#f85149', marginTop: '4px' }}>
                {signedMetric(equity.profit_growth, '%')}
              </div>
            </div>
            <div style={{ background: '#0d1117', padding: '12px', borderRadius: '4px', border: '1px solid #21262d' }}>
              <span style={{ fontSize: '0.75rem', color: '#8b949e' }} title={t('foreignRatioHint')}>{t('foreignRatio')}</span>
              <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#58a6ff', marginTop: '4px' }}>
                {metric(equity.foreign_ratio ?? null, '%')}
              </div>
            </div>
            <div style={{ background: '#0d1117', padding: '12px', borderRadius: '4px', border: '1px solid #21262d', gridColumn: 'span 2' }}>
              <span style={{ fontSize: '0.75rem', color: '#8b949e' }}>Net Debt / EBITDA</span>
              <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: equity.net_debt_ebitda !== null && equity.net_debt_ebitda <= 1.5 ? '#3fb950' : '#f85149', marginTop: '4px' }}>
                {metric(equity.net_debt_ebitda)}
              </div>
            </div>
          </div>
          <div style={{ marginTop: '10px', fontSize: '0.68rem', color: '#8b949e', lineHeight: 1.5 }}>
            {t('fundamentalsSource')}: {equity.fundamentals_source ?? '—'}
            {equity.fundamentals_as_of ? ` · ${t('dataPeriod')}: ${equity.fundamentals_as_of}` : ''}
            {equity.fundamentals_currency ? ` · ${equity.fundamentals_currency}` : ''}
          </div>
          </>
          )}
        </section>
        )}
      </div>

      {corporate && (
      <section className="panel" style={{ marginTop: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <h2>{t('ownershipStructure')}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {shareholders && (
              <span style={{ fontSize: '0.72rem', color: '#8b949e' }}>
                {t('shFetchedAt', { date: shareholders.as_of })}
              </span>
            )}
            <button
              type="button"
              className="small-button"
              disabled={shareholdersLoading}
              onClick={() => loadShareholders(true)}
            >
              {shareholdersLoading ? t('loadingData') : t('kapRefresh')}
            </button>
          </div>
        </div>
        {shareholdersLoading && !shareholders ? (
          <div className="empty-state" style={{ padding: '20px' }}>{t('loadingOwnership')}</div>
        ) : shareholdersError ? (
          <div className="empty-state error" style={{ padding: '20px', fontSize: '0.82rem' }}>{shareholdersError}</div>
        ) : shareholders && shareholders.holders.length > 0 ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '230px 1fr', gap: '20px', alignItems: 'center', marginTop: '8px' }}>
              <div style={{ height: '190px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={shareholders.holders}
                      dataKey="pct"
                      nameKey="name"
                      innerRadius={52}
                      outerRadius={85}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {shareholders.holders.map((_, index) => (
                        <Cell key={index} fill={OWNER_COLORS[index % OWNER_COLORS.length]} />
                      ))}
                    </Pie>
                    <ChartTooltip
                      formatter={(value) => `%${Number(value ?? 0).toFixed(2)}`}
                      contentStyle={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '6px', fontSize: '0.8rem' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {shareholders.holders.map((holder, index) => (
                  <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ width: '10px', height: '10px', borderRadius: '3px', flexShrink: 0, background: OWNER_COLORS[index % OWNER_COLORS.length] }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: '0.88rem', color: '#c9d1d9' }}>{holder.name}</span>
                    <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '0.88rem' }}>%{holder.pct.toFixed(2)}</strong>
                  </div>
                ))}
              </div>
            </div>
            {(corporateHolders.length > 0 || personHolders.length > 0) && (
              <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid #21262d', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {corporateHolders.length > 0 && (
                  <div>
                    <span style={{ fontSize: '0.72rem', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                      {t('corporateHoldersLabel')}
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                      {corporateHolders.map((holder) => (
                        <button
                          key={holder.name}
                          type="button"
                          onClick={() => openResearch(shortenCompanyName(holder.name), 'company')}
                          title={t('researchNewsTitle', { name: holder.name })}
                          style={{
                            padding: '4px 10px', fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer',
                            background: 'rgba(88,166,255,0.08)', border: '1px solid rgba(88,166,255,0.35)',
                            borderRadius: '12px', color: '#58a6ff',
                          }}
                        >
                          🔎 {holder.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {personHolders.length > 0 && (
                  <div>
                    <span style={{ fontSize: '0.72rem', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                      {t('personHoldersLabel')}
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                      {personHolders.map((holder) => (
                        <button
                          key={holder.name}
                          type="button"
                          onClick={() => openResearch(holder.name, 'person')}
                          title={t('researchHistoryTitle', { name: holder.name })}
                          style={{
                            padding: '4px 10px', fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer',
                            background: 'rgba(210,153,34,0.08)', border: '1px solid rgba(210,153,34,0.4)',
                            borderRadius: '12px', color: '#d29922',
                          }}
                        >
                          🔎 {holder.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {ownershipKapItems.length > 0 && (
              <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid #21262d' }}>
                <span style={{ fontSize: '0.75rem', color: '#d29922', fontWeight: 'bold' }}>
                  {t('ownershipKapWarning')}
                </span>
                <ul style={{ margin: '8px 0 0', paddingLeft: '18px' }}>
                  {ownershipKapItems.slice(0, 4).map((item) => (
                    <li key={item.id} style={{ fontSize: '0.78rem', marginBottom: '4px' }}>
                      {item.url ? (
                        <a href={item.url} target="_blank" rel="noreferrer" style={{ color: '#58a6ff', textDecoration: 'none' }}>
                          {item.title}
                        </a>
                      ) : item.title}
                      <span style={{ color: '#8b949e' }}> · {item.date}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p style={{ margin: '12px 0 0', fontSize: '0.68rem', color: '#8b949e' }}>
              {t('ownershipCacheNote')}
            </p>
          </>
        ) : (
          <div className="empty-state" style={{ padding: '20px', fontSize: '0.82rem' }}>{t('ownershipNotFound')}</div>
        )}

        <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid #21262d' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <span style={{ fontSize: '0.72rem', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              {t('subsidiariesLabel')}{subsidiaries ? ` (${subsidiaries.items.length})` : ''} — {t('clickTagToResearch')}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {subsidiaries && (
                <span style={{ fontSize: '0.7rem', color: '#8b949e' }}>{t('subFetchedAt', { date: subsidiaries.as_of })}</span>
              )}
              <button
                type="button"
                className="small-button"
                disabled={subsidiariesLoading}
                onClick={() => loadSubsidiaries(true)}
              >
                {subsidiariesLoading ? t('loadingData') : t('kapRefresh')}
              </button>
            </div>
          </div>
          {subsidiariesLoading && !subsidiaries ? (
            <div style={{ padding: '12px 0', fontSize: '0.8rem', color: '#8b949e' }}>{t('loadingSubsidiaries')}</div>
          ) : subsidiariesError ? (
            <div style={{ padding: '12px 0', fontSize: '0.78rem', color: '#f85149' }}>{subsidiariesError}</div>
          ) : subsidiaries && subsidiaries.items.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
              {subsidiaries.items.map((sub) => (
                <button
                  key={sub.name}
                  type="button"
                  onClick={() => openResearch(shortenCompanyName(sub.name), 'company')}
                  title={`${sub.name}${sub.relation ? ` · ${sub.relation}` : ''}${sub.activity ? ` · ${sub.activity}` : ''}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '6px', maxWidth: '300px',
                    padding: '4px 10px', fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer',
                    background: 'rgba(163,113,247,0.08)', border: '1px solid rgba(163,113,247,0.4)',
                    borderRadius: '12px', color: '#a371f7',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    🔎 {sub.name}
                  </span>
                  {sub.pct !== null && (
                    <span style={{ flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: '#c9d1d9' }}>
                      %{sub.pct % 1 === 0 ? sub.pct.toFixed(0) : sub.pct.toFixed(2)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div style={{ padding: '12px 0', fontSize: '0.78rem', color: '#8b949e' }}>
              {t('subsidiariesNotFound')}
            </div>
          )}
        </div>
      </section>
      )}

      {corporate && (
      <section className="panel" style={{ marginTop: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2>{t('kapDisclosures')}</h2>
          <span style={{ fontSize: '0.72rem', color: '#8b949e' }}>{t('kapDisclosuresSubtitle')}</span>
        </div>
        {kapLoading ? (
          <div className="empty-state" style={{ padding: '20px' }}>{t('kapSearching')}</div>
        ) : kapItems.length === 0 ? (
          <div className="empty-state" style={{ padding: '20px', fontSize: '0.82rem' }}>
            {t('kapNoneFound', { ticker: equity.ticker })}
          </div>
        ) : (
          <div className="kap-list">
            {kapItems.map((item) => (
              <article className="kap-item" key={item.id}>
                <div>
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noreferrer" style={{ color: '#58a6ff', textDecoration: 'none' }}>
                      <strong>{item.title}</strong>
                    </a>
                  ) : (
                    <strong>{item.title}</strong>
                  )}
                  <span>{item.date} / {item.category}</span>
                </div>
                {item.summary && <p>{item.summary}</p>}
              </article>
            ))}
          </div>
        )}
      </section>
      )}

      {corporate && tickerFunds && (
      <section className="panel" style={{ marginTop: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
          <h2>{t('tfTitle')}{tickerFunds.entries.length > 0 ? ` (${tickerFunds.entries.length})` : ''}</h2>
          <span style={{ fontSize: '0.72rem', color: '#8b949e' }}>
            {t('tfSubtitle')} · {t('tfCoverage', { n: tickerFunds.scanned_funds })}
          </span>
        </div>
        {tickerFunds.entries.length === 0 ? (
          <div className="empty-state" style={{ padding: '20px', fontSize: '0.82rem' }}>
            {tickerFunds.scanned_funds === 0
              ? t('tfNoneYet')
              : t('tfNone', { n: tickerFunds.scanned_funds })}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: '#8b949e', fontSize: '0.72rem', borderBottom: '1px solid #30363d' }}>{t('tfFundCol')}</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', color: '#8b949e', fontSize: '0.72rem', borderBottom: '1px solid #30363d' }}>{t('tfWeightCol')}</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', color: '#8b949e', fontSize: '0.72rem', borderBottom: '1px solid #30363d' }}>{t('tfPeriodCol')}</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', color: '#8b949e', fontSize: '0.72rem', borderBottom: '1px solid #30363d' }} />
              </tr>
            </thead>
            <tbody>
              {tickerFunds.entries.slice(0, 20).map((fund) => (
                <tr key={fund.fund_code}>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #21262d', maxWidth: '420px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <strong style={{ fontFamily: 'var(--font-mono)' }}>{fund.fund_code}</strong>
                    {fund.fund_kind && (
                      <span style={{ marginLeft: '8px', padding: '1px 7px', borderRadius: '9px', fontSize: '0.64rem', background: '#30363d', color: '#8b949e', fontFamily: 'var(--font-mono)' }}>
                        {fund.fund_kind}
                      </span>
                    )}
                    <span style={{ marginLeft: '8px', color: '#8b949e' }} title={fund.fund_name}>{fund.fund_name}</span>
                  </td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #21262d', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                    %{fund.weight_pct.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #21262d', textAlign: 'right', color: '#8b949e', fontFamily: 'var(--font-mono)', fontSize: '0.74rem' }}>
                    {fund.period}
                  </td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #21262d', textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={() => void openUrl(fund.url)}
                      style={{ background: 'none', border: 'none', color: '#58a6ff', cursor: 'pointer', padding: 0, fontSize: '0.74rem' }}
                    >
                      {t('tfKapLink')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      )}

      {corporate && (
      <div className="split-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '16px' }}>
        <section className="panel">
          <h2>{t('dividendHistory')}</h2>
          {historyLoading ? (
            <div className="empty-state" style={{ padding: '20px' }}>{t('loadingData')}</div>
          ) : dividends.length === 0 ? (
            <div className="empty-state" style={{ padding: '20px', fontSize: '0.82rem' }}>{t('dividendsNotFound')}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '8px' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '6px 8px', color: '#8b949e', fontSize: '0.72rem', borderBottom: '1px solid #30363d' }}>{t('exDate')}</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', color: '#8b949e', fontSize: '0.72rem', borderBottom: '1px solid #30363d' }}>{t('perShare')}</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', color: '#8b949e', fontSize: '0.72rem', borderBottom: '1px solid #30363d' }}>{t('yieldLabel')}</th>
                </tr>
              </thead>
              <tbody>
                {dividends.slice(0, 8).map((d, i) => (
                  <tr key={i}>
                    <td style={{ padding: '6px 8px', fontSize: '0.78rem', fontFamily: 'var(--font-mono)', borderBottom: '1px solid #21262d', whiteSpace: 'nowrap' }}>
                      {d.ex_date}
                      {d.installment >= 2 && (
                        <span style={{ marginLeft: '6px', padding: '1px 6px', borderRadius: '8px', fontSize: '0.6rem', fontWeight: 'bold', background: '#58a6ff22', color: '#58a6ff' }}>
                          {t('installmentN', { n: d.installment })}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '6px 8px', fontSize: '0.78rem', fontFamily: 'var(--font-mono)', textAlign: 'right', color: '#3fb950', fontWeight: 'bold', borderBottom: '1px solid #21262d' }}>₺{d.amount_per_share.toFixed(4)}</td>
                    <td style={{ padding: '6px 8px', fontSize: '0.78rem', fontFamily: 'var(--font-mono)', textAlign: 'right', borderBottom: '1px solid #21262d' }}>{d.yield_pct > 0 ? `%${d.yield_pct.toFixed(2)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel">
          <h2>{t('splitHistory')}</h2>
          {historyLoading ? (
            <div className="empty-state" style={{ padding: '20px' }}>{t('loadingData')}</div>
          ) : capitalIncreases.length === 0 ? (
            <div className="empty-state" style={{ padding: '20px', fontSize: '0.82rem' }}>{t('splitsNotFound')}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '8px' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '6px 8px', color: '#8b949e', fontSize: '0.72rem', borderBottom: '1px solid #30363d' }}>{t('dateLabel')}</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', color: '#8b949e', fontSize: '0.72rem', borderBottom: '1px solid #30363d' }}>{t('typeLabel')}</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', color: '#8b949e', fontSize: '0.72rem', borderBottom: '1px solid #30363d' }}>{t('ratioLabel')}</th>
                </tr>
              </thead>
              <tbody>
                {capitalIncreases.map((c, i) => {
                  const typeColor = c.increase_type === 'BEDELSİZ' ? '#3fb950' : c.increase_type === 'BİRLEŞTİRME' ? '#f0883e' : '#58a6ff';
                  return (
                    <tr key={i}>
                      <td style={{ padding: '6px 8px', fontSize: '0.78rem', fontFamily: 'var(--font-mono)', borderBottom: '1px solid #21262d' }}>{c.date}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #21262d' }}>
                        <span style={{ padding: '2px 8px', borderRadius: '10px', fontSize: '0.68rem', fontWeight: 'bold', background: `${typeColor}22`, color: typeColor }}>
                          {c.increase_type}
                        </span>
                      </td>
                      <td style={{ padding: '6px 8px', fontSize: '0.78rem', fontFamily: 'var(--font-mono)', textAlign: 'right', fontWeight: 'bold', borderBottom: '1px solid #21262d' }}>{c.ratio}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
      )}

      <section className="panel" style={{ marginTop: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div>
            <h2 style={{ marginBottom: '4px' }}>{corporate ? t('companyNews') : t('relatedNews')}</h2>
            <span style={{ fontSize: '0.75rem', color: '#8b949e' }}>{corporate ? t('newsSourcesCorporate') : t('newsSources')}</span>
          </div>
          <button
            type="button"
            className="small-button"
            onClick={() => {
              setNewsLoading(true);
              getNewsFeed(ticker).then(setNews).finally(() => setNewsLoading(false));
            }}
          >
            {t('kapRefresh')}
          </button>
        </div>
        {newsLoading && <div className="empty-state">{t('newsLoadingFor', { ticker })}</div>}
        {!newsLoading && news.length === 0 && <div className="empty-state">{t('newsNotFound')}</div>}
        {!newsLoading && news.length > 0 && <NewsList news={news} />}
      </section>
      </>
      )}

      {/* ORTAK / PATRON ARAŞTIRMA MODALI */}
      {research && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}
          onClick={() => setResearch(null)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{ background: '#161b22', padding: '24px', borderRadius: '12px', width: '780px', maxWidth: '94vw', maxHeight: '85vh', border: '1px solid #30363d', display: 'flex', flexDirection: 'column' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
              <div>
                <h2 style={{ margin: '0 0 4px' }}>{research.name}</h2>
                <span style={{
                  fontSize: '0.7rem', fontWeight: 'bold', padding: '2px 10px', borderRadius: '10px',
                  background: research.kind === 'company' ? '#58a6ff22' : '#d2992222',
                  color: research.kind === 'company' ? '#58a6ff' : '#d29922',
                }}>
                  {research.kind === 'company' ? t('researchCompanyBadge') : t('researchPersonBadge')}
                </span>
              </div>
              <button type="button" onClick={() => setResearch(null)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.4rem', lineHeight: 1 }}>×</button>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', margin: '14px 0' }}>
              <button
                type="button"
                className="small-button"
                onClick={() => void openUrl(xSearchUrl(
                  research.name,
                  research.kind === 'person'
                    ? { ticker: equity.ticker, company: shortenCompanyName(equity.name) }
                    : undefined,
                ))}
                style={{ cursor: 'pointer' }}
              >
                {research.kind === 'person' ? t('searchOnXContext', { ticker: equity.ticker }) : t('searchOnX')}
              </button>
              <button type="button" className="small-button" onClick={() => void openUrl(linkedInSearchUrl(research.name, research.kind))} style={{ cursor: 'pointer' }}>
                {t('searchOnLinkedIn')}
              </button>
              <button type="button" className="small-button" onClick={() => void openUrl(googleSearchUrl(research.name))} style={{ cursor: 'pointer' }}>
                {t('searchOnGoogle')}
              </button>
            </div>
            <p style={{ margin: '0 0 12px', fontSize: '0.7rem', color: '#8b949e' }}>
              {t('researchModalNote', { window: research.kind === 'person' ? t('researchWindowPerson') : t('researchWindowCompany') })}
              {research.kind === 'person' && ` ${t('researchXNote', { context: `${equity.ticker} / #${equity.ticker} / "${shortenCompanyName(equity.name)}"` })}`}
            </p>

            <div style={{ flex: 1, overflowY: 'auto', minHeight: '120px' }}>
              {researchLoading ? (
                <div className="empty-state" style={{ padding: '24px' }}>{t('researchSearching', { name: research.name })}</div>
              ) : researchError ? (
                <div className="empty-state error" style={{ padding: '24px', fontSize: '0.82rem' }}>{researchError}</div>
              ) : researchNews.length === 0 ? (
                <div className="empty-state" style={{ padding: '24px', fontSize: '0.82rem' }}>
                  {t('researchEmpty')}
                </div>
              ) : (
                <NewsList news={researchNews} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
