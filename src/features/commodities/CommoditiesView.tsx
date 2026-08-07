import { useEffect, useMemo, useState } from 'react';
import { getDashboardSnapshot, getNewsFeed } from '../../api/tauriClient';
import type { EquityRow, NewsItem } from '../../types';
import FlashValue from '../../components/FlashValue';
import { useLiveQuotes } from '../../hooks/useLiveQuotes';
import { NewsList } from '../news/NewsFeedView';

interface CommoditiesViewProps {
  onSelectTicker: (ticker: string) => void;
}

const COMMODITY_PRESETS = [
  { symbol: 'GRAM ALTIN', name: 'Gram Altın (TL)', category: 'Değerli Metal', unit: '₺/gr' },
  { symbol: 'GRAM GÜMÜŞ', name: 'Gram Gümüş (TL)', category: 'Değerli Metal', unit: '₺/gr' },
  { symbol: 'GC=F', name: 'Altın Ons ($)', category: 'Değerli Metal', unit: '$/ons' },
  { symbol: 'SI=F', name: 'Gümüş Ons ($)', category: 'Değerli Metal', unit: '$/ons' },
  { symbol: 'BZ=F', name: 'Brent Petrol ($)', category: 'Enerji', unit: '$/bbl' },
  { symbol: 'CL=F', name: 'WTI Petrol ($)', category: 'Enerji', unit: '$/bbl' },
  { symbol: 'NG=F', name: 'Doğalgaz ($)', category: 'Enerji', unit: '$/MMBtu' },
  { symbol: 'HG=F', name: 'Bakır ($)', category: 'Sanayi Metali', unit: '$/lb' },
];

export default function CommoditiesView({ onSelectTicker }: CommoditiesViewProps) {
  const [equities, setEquities] = useState<EquityRow[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [filterCat, setFilterCat] = useState<'Tümü' | 'Değerli Metal' | 'Enerji' | 'Sanayi Metali'>('Tümü');

  const symbols = useMemo(() => [...COMMODITY_PRESETS.map((p) => p.symbol), 'USDTRY=X'], []);
  const live = useLiveQuotes(symbols);

  useEffect(() => {
    let cancelled = false;
    getDashboardSnapshot()
      .then((snap) => {
        if (!cancelled) {
          const matched = (snap.equities ?? []).filter((e) =>
            symbols.includes(e.ticker.toUpperCase()) || e.ticker.endsWith('=F') || e.ticker.startsWith('GRAM') || e.ticker.toUpperCase() === 'USDTRY=X'
          );
          setEquities(matched);
        }
      })
      .catch(() => {});

    getNewsFeed('GC=F')
      .then((items) => { if (!cancelled) setNews(items.slice(0, 8)); })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [symbols]);

  // Combine static presets with live quotes & dashboard equity rows
  const commodityList = useMemo(() => {
    return COMMODITY_PRESETS.map((preset) => {
      const liveQuote = live.get(preset.symbol);
      const eq = equities.find((e) => e.ticker.toUpperCase() === preset.symbol);
      const price = liveQuote?.price ?? eq?.price ?? 0;
      const changePct = liveQuote?.change_pct ?? eq?.change_pct ?? 0;
      const rsi = eq?.rsi ?? 50;
      const macd = eq?.macd ?? 0;
      return {
        ...preset,
        price,
        changePct,
        rsi,
        macd,
        high: eq?.week_52_high ?? price * 1.1,
        low: eq?.week_52_low ?? price * 0.9,
      };
    }).filter((item) => filterCat === 'Tümü' || item.category === filterCat);
  }, [live, equities, filterCat]);

  const gainers = useMemo(() => [...commodityList].sort((a, b) => b.changePct - a.changePct), [commodityList]);
  const losers = useMemo(() => [...commodityList].sort((a, b) => a.changePct - b.changePct), [commodityList]);

  // Custom Ons-Gram Live Converter calculator state
  const liveUsdQuote = live.get('USDTRY=X');
  const usdEquity = equities.find((e) => e.ticker.toUpperCase() === 'USDTRY=X');
  const liveUsdTry = liveUsdQuote?.price ?? usdEquity?.price ?? 0;

  const goldOns = commodityList.find((c) => c.symbol === 'GC=F')?.price || 0;
  const [calcOns, setCalcOns] = useState<number>(0);
  const [calcUsd, setCalcUsd] = useState<number>(0);
  const calculatedGram = calcOns > 0 && calcUsd > 0
    ? ((calcOns / 31.1034768) * calcUsd).toFixed(2)
    : '0.00';

  useEffect(() => {
    if (goldOns > 0 && calcOns === 0) setCalcOns(Number(goldOns.toFixed(2)));
  }, [goldOns, calcOns]);

  useEffect(() => {
    if (liveUsdTry > 0 && calcUsd === 0) setCalcUsd(Number(liveUsdTry.toFixed(2)));
  }, [liveUsdTry, calcUsd]);

  return (
    <div className="view commodities-view" style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '20px' }}>
      {/* Header Banner */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px',
        padding: '24px', background: 'linear-gradient(135deg, rgba(218,165,32,0.15) 0%, rgba(255,215,0,0.05) 100%)',
        border: '1px solid rgba(218,165,32,0.3)', borderRadius: '14px', backdropFilter: 'blur(10px)'
      }}>
        <div>
          <span style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '2px', color: '#ffd700', fontWeight: 'bold' }}>
            🛢️ Canlı Piyasalar
          </span>
          <h1 style={{ margin: '4px 0 0', fontSize: '1.8rem', fontWeight: 800 }}>Emtia & Kıymetli Madenler</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
            Ons Altın, Gram Altın, Gümüş, Brent Petrol ve Sanayi Metalleri canlı takip & analiz paneli.
          </p>
        </div>

        {/* Category Filters */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['Tümü', 'Değerli Metal', 'Enerji', 'Sanayi Metali'] as const).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setFilterCat(cat)}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                fontSize: '0.83rem',
                fontWeight: filterCat === cat ? 'bold' : 'normal',
                background: filterCat === cat ? '#ffd700' : 'rgba(255,255,255,0.04)',
                color: filterCat === cat ? '#000000' : 'var(--text-secondary)',
                border: '1px solid var(--border-color)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Grid: Heatmap + Live Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
        {/* Heatmap Panel */}
        <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: '1.1rem', margin: 0 }}>📊 Emtia Isı Haritası (Günlük Performans)</h2>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Canlı Fiyat Değişimi %</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', minHeight: '220px' }}>
            {commodityList.map((item) => {
              const isGain = item.changePct >= 0;
              const intensity = Math.min(Math.abs(item.changePct) / 3, 1);
              const bg = isGain
                ? `rgba(63, 185, 80, ${0.15 + intensity * 0.45})`
                : `rgba(248, 81, 73, ${0.15 + intensity * 0.45})`;
              const border = isGain ? '#3fb950' : '#f85149';

              return (
                <div
                  key={item.symbol}
                  onClick={() => onSelectTicker(item.symbol)}
                  style={{
                    background: bg,
                    border: `1px solid ${border}`,
                    borderRadius: '10px',
                    padding: '14px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    transition: 'transform 0.15s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.03)')}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                >
                  <div style={{ fontSize: '0.85rem', fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.name}
                  </div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 800, marginTop: '8px' }}>
                    <FlashValue value={item.price} format={(v) => v.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} />
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '4px' }}>{item.unit}</span>
                  </div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: isGain ? '#3fb950' : '#f85149', marginTop: '4px' }}>
                    {isGain ? '▲ +' : '▼ '}{item.changePct.toFixed(2)}%
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Live Ons/Gram Gold Converter Panel */}
        <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h2 style={{ fontSize: '1.1rem', margin: 0 }}>⚖️ Ons & Gram Altın Canlı Matris Dönüştürücü</h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
            Ons Altın ($) ve USD/TRY kurunu kullanarak anlık Gram Altın (TL) değerini hesaplayın:
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'var(--bg-main)', padding: '16px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Ons Altın Fiyatı ($):</span>
              <input
                type="number"
                value={calcOns}
                onChange={(e) => setCalcOns(Number(e.target.value))}
                style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', color: '#ffd700', padding: '6px 12px', borderRadius: '6px', width: '130px', fontWeight: 'bold', textAlign: 'right' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>USD / TRY Kuru:</span>
              <input
                type="number"
                value={calcUsd}
                onChange={(e) => setCalcUsd(Number(e.target.value))}
                style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '6px 12px', borderRadius: '6px', width: '130px', fontWeight: 'bold', textAlign: 'right' }}
              />
            </div>
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>Hesaplanan Gram Altın (TL):</span>
              <span style={{ fontSize: '1.4rem', fontWeight: 800, color: '#3fb950' }}>{calculatedGram} ₺</span>
            </div>
          </div>
        </section>
      </div>

      {/* Tables: Top Gainers vs Top Losers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px' }}>
        {/* Top Gainers Table */}
        <section className="panel">
          <h3 style={{ fontSize: '1rem', color: '#3fb950', marginBottom: '12px' }}>🚀 Günün En Çok Yükselen Emtiaları</h3>
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Varlık</th>
                <th>Kategori</th>
                <th style={{ textAlign: 'right' }}>Fiyat</th>
                <th style={{ textAlign: 'right' }}>Değişim</th>
              </tr>
            </thead>
            <tbody>
              {gainers.slice(0, 5).map((row) => (
                <tr key={row.symbol} onClick={() => onSelectTicker(row.symbol)} style={{ cursor: 'pointer' }}>
                  <td><strong>{row.name}</strong></td>
                  <td><span className="badge">{row.category}</span></td>
                  <td style={{ textAlign: 'right' }}>{row.price.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} {row.unit}</td>
                  <td style={{ textAlign: 'right', color: row.changePct >= 0 ? '#3fb950' : '#f85149', fontWeight: 'bold' }}>
                    +{row.changePct.toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Top Losers Table */}
        <section className="panel">
          <h3 style={{ fontSize: '1rem', color: '#f85149', marginBottom: '12px' }}>🔻 Günün En Çok Düşen Emtiaları</h3>
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Varlık</th>
                <th>Kategori</th>
                <th style={{ textAlign: 'right' }}>Fiyat</th>
                <th style={{ textAlign: 'right' }}>Değişim</th>
              </tr>
            </thead>
            <tbody>
              {losers.slice(0, 5).map((row) => (
                <tr key={row.symbol} onClick={() => onSelectTicker(row.symbol)} style={{ cursor: 'pointer' }}>
                  <td><strong>{row.name}</strong></td>
                  <td><span className="badge">{row.category}</span></td>
                  <td style={{ textAlign: 'right' }}>{row.price.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} {row.unit}</td>
                  <td style={{ textAlign: 'right', color: row.changePct >= 0 ? '#3fb950' : '#f85149', fontWeight: 'bold' }}>
                    {row.changePct.toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      {/* Commodity News Feed */}
      {news.length > 0 && (
        <section className="panel">
          <h2 style={{ fontSize: '1.1rem', marginBottom: '14px' }}>📰 Emtia & Küresel Piyasa Haberleri</h2>
          <NewsList news={news} />
        </section>
      )}
    </div>
  );
}
