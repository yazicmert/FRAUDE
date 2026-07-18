import { useEffect, useRef, useState } from 'react';
import { createChart, LineSeries, PriceScaleMode, type Time, ColorType, ISeriesApi } from 'lightweight-charts';
import { getPriceHistory } from '../../api/tauriClient';
import { useWatchlist } from '../../hooks/useWatchlist';
import { useTranslation } from '../../api/i18n';
import type { HistoricalQuote } from '../../types';
import { PRESET_SYMBOLS, normalizeSearch as normalize, presetMatchesQuery } from '../../components/symbolCatalog';

interface ComparativeChartProps {
  isEditing: boolean;
  onClose: () => void;
  equities?: import('../../types').EquityRow[];
}

const COLORS = ['#58a6ff', '#3fb950', '#d29922', '#f85149', '#a371f7', '#ff7b72', '#2f81f7', '#7ee787', '#ffa657'];

const presetBySymbol = new Map(PRESET_SYMBOLS.map((p) => [p.symbol, p]));

export default function ComparativeChart({ isEditing, onClose, equities }: ComparativeChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRefs = useRef<Record<string, ISeriesApi<'Line'>>>({});
  const dataCache = useRef<Record<string, HistoricalQuote[]>>({});
  // Üst üste binen yüklemelerde yalnızca en son başlatılan seri çizebilir;
  // aksi halde seriler mükerrer eklenir (lejantta çift USDTRY/XU100 hatası).
  const loadIdRef = useRef(0);

  const { t } = useTranslation();
  const { watchlist } = useWatchlist();
  const [symbols, setSymbols] = useState<string[]>(['PORTFOLIO', 'XU100.IS', 'USDTRY=X']);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [range, setRange] = useState('6mo');
  const [loading, setLoading] = useState(false);

  const displayName = (sym: string) =>
    sym === 'PORTFOLIO' ? t('modelPortfolioLabel') : (presetBySymbol.get(sym)?.label ?? sym.replace('.IS', ''));

  useEffect(() => {
    if (!chartContainerRef.current) return;
    const chart = createChart(chartContainerRef.current, {
      layout: { background: { type: ColorType.Solid, color: '#161b22' }, textColor: '#c9d1d9' },
      grid: { vertLines: { color: '#30363d' }, horzLines: { color: '#30363d' } },
      width: chartContainerRef.current.clientWidth,
      height: 350,
      timeScale: { borderColor: '#30363d', timeVisible: false, minBarSpacing: 0.02 },
      rightPriceScale: {
        mode: PriceScaleMode.Percentage,
      },
    });
    chartRef.current = chart;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
      seriesRefs.current = {};
    };
  }, []);

  // Liste veya adetler değişince portföy serisi yeniden hesaplanmalı
  const watchlistKey = JSON.stringify(watchlist.map(w => [w.ticker, w.quantity ?? 0]));
  useEffect(() => {
    delete dataCache.current['PORTFOLIO'];
  }, [watchlistKey]);

  useEffect(() => {
    const loadData = async () => {
      if (!chartRef.current) return;
      const loadId = ++loadIdRef.current;
      setLoading(true);

      try {
        // Tüm geçmiş bir kez indirilir ('max'); aralık butonları yalnızca
        // görünür pencereyi değiştirir, yeniden istek atılmaz.
        const fetchPromises = symbols.map(async (sym) => {
          let rawData: HistoricalQuote[] = [];

          if (dataCache.current[sym]) {
            rawData = dataCache.current[sym];
          } else if (sym === 'PORTFOLIO') {
            if (watchlist.length > 0) {
              const promises = watchlist.map(w => {
                  if (dataCache.current[w.ticker]) return Promise.resolve(dataCache.current[w.ticker]);
                  return getPriceHistory(w.ticker, 'max').then(res => {
                      if (res.length > 0) dataCache.current[w.ticker] = res;
                      return res;
                  }).catch(() => [] as HistoricalQuote[]);
              });
              const results = await Promise.all(promises);

              // Portföy bir endeks gibi simüle edilir: adet girilmişse gerçek
              // pozisyon büyüklükleri, girilmemişse eşit tutarlı sanal pozisyonlar
              // kullanılır; veri olmayan günlerde son bilinen fiyat taşınır.
              const holdings = watchlist
                .map((w, i) => {
                  const hist = results[i];
                  if (!hist || hist.length === 0) return null;
                  return {
                    priceByTime: new Map(hist.map(h => [h.time as number, h.close])),
                    firstTime: hist[0].time as number,
                    firstPrice: hist[0].close,
                    quantity: w.quantity && w.quantity > 0 ? w.quantity : null,
                  };
                })
                .filter((h): h is NonNullable<typeof h> => h !== null);

              if (holdings.length > 0) {
                // Ortak başlangıç: tüm hisselerin işlem gördüğü ilk gün
                const start = Math.max(...holdings.map(h => h.firstTime));
                const allTimes = new Set<number>();
                holdings.forEach(h => h.priceByTime.forEach((_, time) => { if (time >= start) allTimes.add(time); }));
                const times = [...allTimes].sort((a, b) => a - b);

                const useQuantities = holdings.every(h => h.quantity !== null);
                const lastPrice = holdings.map(h => h.priceByTime.get(start) ?? h.firstPrice);
                const shares = holdings.map((h, i) => useQuantities ? (h.quantity as number) : 10000 / lastPrice[i]);

                let baseValue: number | null = null;
                times.forEach(time => {
                  holdings.forEach((h, i) => {
                    const price = h.priceByTime.get(time);
                    if (price !== undefined) lastPrice[i] = price;
                  });
                  const value = shares.reduce((sum, count, i) => sum + count * lastPrice[i], 0);
                  if (baseValue === null) baseValue = value;
                  const indexed = baseValue > 0 ? (value / baseValue) * 100 : 100;
                  rawData.push({ time, open: indexed, high: indexed, low: indexed, close: indexed, volume: 0 });
                });
                if (rawData.length > 0) dataCache.current[sym] = rawData;
              }
            }
          } else {
            rawData = await getPriceHistory(sym, 'max').catch(() => []);
            if (rawData.length > 0) dataCache.current[sym] = rawData;
          }
          return { sym, rawData };
        });

        const results = await Promise.all(fetchPromises);

        // Bu yükleme eskidiyse (yeni bir yükleme başladıysa) çizim yapılmaz.
        if (loadId !== loadIdRef.current || !chartRef.current) return;

        // Eski seriler ancak yeni veri hazırken temizlenir; böylece temizleme
        // ve çizim tek senkron blokta kalır ve mükerrer seri oluşmaz.
        for (const key in seriesRefs.current) {
          chartRef.current.removeSeries(seriesRefs.current[key]);
        }
        seriesRefs.current = {};

        let colorIndex = 0;
        for (const { sym, rawData } of results) {
          const color = COLORS[colorIndex % COLORS.length];
          colorIndex++;

          if (rawData.length > 0) {
            const series = chartRef.current.addSeries(LineSeries, {
              color,
              lineWidth: 2,
              title: displayName(sym),
              priceLineVisible: false,
            });
            series.setData(rawData.map(d => ({ time: d.time as Time, value: d.close })));
            seriesRefs.current[sym] = series;
          }
        }

        // Aralık: 'max' tüm geçmişi sığdırır, diğerleri son N barı gösterir
        const drawn = Object.values(seriesRefs.current);
        if (drawn.length > 0) {
          if (range === 'max') {
            chartRef.current.timeScale().fitContent();
          } else {
            const longest = drawn.reduce((best, s) => (s.data().length > best.data().length ? s : best), drawn[0]);
            const data = longest.data();
            if (data && data.length > 0) {
              const barsByRange: Record<string, number> = { '1mo': 22, '3mo': 65, '6mo': 130, '1y': 250, '5y': 1250 };
              const barsToShow = Math.min(data.length, barsByRange[range] ?? data.length);
              chartRef.current.timeScale().setVisibleLogicalRange({
                from: Math.max(0, data.length - barsToShow),
                to: Math.max(0, data.length - 1),
              });
            }
          }
        }

      } finally {
        if (loadId === loadIdRef.current) setLoading(false);
      }
    };

    loadData();
  }, [symbols, range, watchlistKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const addSymbol = (sym: string) => {
    if (!symbols.includes(sym)) setSymbols([...symbols, sym]);
    setSearch('');
    setSearchOpen(false);
  };

  const removeSymbol = (sym: string) => {
    setSymbols(symbols.filter(s => s !== sym));
  };

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    let sym = search.trim().toUpperCase();
    if (!sym) return;
    if (/^[A-Z0-9]{4,6}$/.test(sym) && !sym.includes('.')) sym += '.IS';
    addSymbol(sym);
  };

  const query = normalize(search);
  const presetMatches = query.length === 0
    ? PRESET_SYMBOLS.filter(p => !symbols.includes(p.symbol))
    : PRESET_SYMBOLS.filter(p => !symbols.includes(p.symbol) && presetMatchesQuery(p, query));
  const equityMatches = query.length === 0 ? [] : (equities ?? [])
    .filter(eq => normalize(eq.ticker).includes(query) || normalize(eq.name).includes(query))
    .slice(0, 10);

  return (
    <section className="panel dashboard-module">
      {isEditing && <button type="button" className="module-close" onClick={onClose}>×</button>}
      <div className="module-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <h2>{t('comparativePerformance')}</h2>
          <span>{t('percentageReturn')}</span>
        </div>
        <div className="tabs" style={{ background: 'var(--bg-panel)' }}>
          {['1mo', '3mo', '6mo', '1y', '5y', 'max'].map(r => (
            <button key={r} className={`tab-button ${range === r ? 'active' : ''}`} onClick={() => setRange(r)}>
              {r === '1mo' ? '1A' : r === '3mo' ? '3A' : r === '6mo' ? '6A' : r === '1y' ? '1Y' : r === '5y' ? '5Y' : 'MAX'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '0 8px 12px 8px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          className="small-button"
          onClick={() => symbols.includes('PORTFOLIO') ? removeSymbol('PORTFOLIO') : setSymbols(['PORTFOLIO', ...symbols])}
          style={{
            background: symbols.includes('PORTFOLIO') ? COLORS[symbols.indexOf('PORTFOLIO') % COLORS.length] : 'transparent',
            color: symbols.includes('PORTFOLIO') ? '#000' : 'inherit',
            fontWeight: symbols.includes('PORTFOLIO') ? 'bold' : 'normal',
          }}
        >
          {t('modelPortfolioLabel')}
        </button>
        {symbols.filter(s => s !== 'PORTFOLIO').map(sym => (
          <button
            key={sym}
            className="small-button active"
            onClick={() => removeSymbol(sym)}
            title={t('removeFromChart')}
            style={{ background: COLORS[symbols.indexOf(sym) % COLORS.length], color: '#000', fontWeight: 'bold' }}
          >
            {displayName(sym)} ×
          </button>
        ))}

        <form onSubmit={submitSearch} style={{ display: 'flex', gap: '4px' }}>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              placeholder={t('compareSearchPlaceholder')}
              value={search}
              autoComplete="off"
              onChange={e => { setSearch(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              style={{ padding: '3px 8px', fontSize: '0.8rem', width: '190px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: 'var(--text-primary)' }}
            />
            {searchOpen && (presetMatches.length > 0 || equityMatches.length > 0 || query.length > 0) && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, zIndex: 50,
                background: 'var(--bg-panel)', border: '1px solid var(--border-color)',
                borderRadius: '4px', padding: 0, margin: '4px 0 0 0',
                maxHeight: '260px', overflowY: 'auto', width: '270px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                display: 'flex', flexDirection: 'column'
              }}>
                {equityMatches.map(eq => (
                  <div
                    key={eq.ticker}
                    style={{ padding: '6px 10px', fontSize: '0.8rem', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                    onMouseDown={(e) => { e.preventDefault(); addSymbol(eq.ticker.includes('.') ? eq.ticker : `${eq.ticker}.IS`); }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <span style={{ fontWeight: 'bold', color: 'var(--accent-primary)', marginRight: '8px' }}>{eq.ticker.replace('.IS', '')}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{eq.name}</span>
                  </div>
                ))}
                {presetMatches.length === 0 && equityMatches.length === 0 && (
                  <div style={{ padding: '8px 10px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {t('compareNoResults')}
                  </div>
                )}
                {presetMatches.map((p, index) => {
                  const isNewGroup = index === 0 || presetMatches[index - 1].group !== p.group;
                  return (
                    <div key={p.symbol}>
                      {isNewGroup && (
                        <div style={{ padding: '5px 10px 2px', fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          {p.group}
                        </div>
                      )}
                      <div
                        style={{ padding: '5px 10px', fontSize: '0.8rem', cursor: 'pointer' }}
                        onMouseDown={(e) => { e.preventDefault(); addSymbol(p.symbol); }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <span style={{ fontWeight: 'bold', color: 'var(--text-primary)', marginRight: '8px' }}>{p.label}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', fontFamily: 'var(--font-mono)' }}>{p.symbol}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <button type="submit" className="small-button">{t('addSymbol')}</button>
        </form>

        {loading && <span style={{ fontSize: '0.8rem', color: 'var(--accent-primary)' }}>{t('loadingData')}</span>}
      </div>

      <div ref={chartContainerRef} style={{ width: '100%' }} />
    </section>
  );
}
