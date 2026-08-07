import { useEffect, useMemo, useState } from 'react';
import { getDashboardSnapshot, getNewsFeed } from '../../api/tauriClient';
import type { EquityRow, NewsItem } from '../../types';
import FlashValue from '../../components/FlashValue';
import { useLiveQuotes } from '../../hooks/useLiveQuotes';
import { NewsList } from '../news/NewsFeedView';

interface CryptoViewProps {
  onSelectTicker: (ticker: string) => void;
}

const CRYPTO_PRESETS = [
  { symbol: 'BTC-USD', name: 'Bitcoin', code: 'BTC', share: 55 },
  { symbol: 'ETH-USD', name: 'Ethereum', code: 'ETH', share: 20 },
  { symbol: 'SOL-USD', name: 'Solana', code: 'SOL', share: 8 },
  { symbol: 'XRP-USD', name: 'Ripple', code: 'XRP', share: 5 },
  { symbol: 'AVAX-USD', name: 'Avalanche', code: 'AVAX', share: 4 },
  { symbol: 'ADA-USD', name: 'Cardano', code: 'ADA', share: 3 },
  { symbol: 'LINK-USD', name: 'Chainlink', code: 'LINK', share: 3 },
  { symbol: 'DOT-USD', name: 'Polkadot', code: 'DOT', share: 2 },
];

export default function CryptoView({ onSelectTicker }: CryptoViewProps) {
  const [equities, setEquities] = useState<EquityRow[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);

  const symbols = useMemo(() => CRYPTO_PRESETS.map((p) => p.symbol), []);
  const live = useLiveQuotes(symbols);

  useEffect(() => {
    let cancelled = false;
    getDashboardSnapshot()
      .then((snap) => {
        if (!cancelled) {
          const matched = (snap.equities ?? []).filter((e) =>
            symbols.includes(e.ticker.toUpperCase()) || e.ticker.endsWith('-USD') || e.ticker.endsWith('-TRY')
          );
          setEquities(matched);
        }
      })
      .catch(() => {});

    getNewsFeed('BTC-USD')
      .then((items) => { if (!cancelled) setNews(items.slice(0, 8)); })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [symbols]);

  const cryptoList = useMemo(() => {
    return CRYPTO_PRESETS.map((preset) => {
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
      };
    });
  }, [live, equities]);

  const gainers = useMemo(() => [...cryptoList].sort((a, b) => b.changePct - a.changePct), [cryptoList]);
  const losers = useMemo(() => [...cryptoList].sort((a, b) => a.changePct - b.changePct), [cryptoList]);

  return (
    <div className="view crypto-view" style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '20px' }}>
      {/* Header Banner */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px',
        padding: '24px', background: 'linear-gradient(135deg, rgba(0,195,255,0.15) 0%, rgba(163,113,247,0.08) 100%)',
        border: '1px solid rgba(0,195,255,0.3)', borderRadius: '14px', backdropFilter: 'blur(10px)'
      }}>
        <div>
          <span style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '2px', color: '#00c3ff', fontWeight: 'bold' }}>
            🪙 7/24 Kesintisiz Piyasalar
          </span>
          <h1 style={{ margin: '4px 0 0', fontSize: '1.8rem', fontWeight: 800 }}>Kripto Para Piyasası</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
            Bitcoin, Ethereum, Solana ve Altcoinler canlı ısı haritası, sıralama & teknik analiz paneli.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <span className="status-dot" style={{ background: '#3fb950', animation: 'pulse-dot 1.6s ease-in-out infinite' }} />
          <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#3fb950' }}>7/24 Canlı Piyasa Açık</span>
        </div>
      </div>

      {/* Heatmap Section */}
      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1.1rem', margin: 0 }}>📊 Kripto Piyasa Değeri Isı Haritası (Dominasyon & 24s Değişim)</h2>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>24s Fiyat Değişimi %</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
          {cryptoList.map((item) => {
            const isGain = item.changePct >= 0;
            const intensity = Math.min(Math.abs(item.changePct) / 5, 1);
            const bg = isGain
              ? `rgba(63, 185, 80, ${0.18 + intensity * 0.45})`
              : `rgba(248, 81, 73, ${0.18 + intensity * 0.45})`;
            const border = isGain ? '#3fb950' : '#f85149';

            return (
              <div
                key={item.symbol}
                onClick={() => onSelectTicker(item.symbol)}
                style={{
                  background: bg,
                  border: `1px solid ${border}`,
                  borderRadius: '12px',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  minHeight: '120px',
                  transition: 'transform 0.15s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.03)')}
                onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '1.1rem', fontWeight: 800 }}>{item.code}</span>
                  <span style={{ fontSize: '0.7rem', opacity: 0.8, color: 'var(--text-muted)' }}>Piyasa Payı ~%{item.share}</span>
                </div>

                <div style={{ marginTop: '12px' }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800 }}>
                    $<FlashValue value={item.price} format={(v) => v.toLocaleString('en-US', { maximumFractionDigits: 2 })} />
                  </div>
                  <div style={{ fontSize: '0.88rem', fontWeight: 'bold', color: isGain ? '#3fb950' : '#f85149', marginTop: '2px' }}>
                    {isGain ? '▲ +' : '▼ '}{item.changePct.toFixed(2)}%
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Main Ranking Table */}
      <section className="panel">
        <h2 style={{ fontSize: '1.1rem', marginBottom: '14px' }}>🏆 Kripto Varlık Sıralaması & Teknik Görünüm</h2>
        <table className="data-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>#</th>
              <th>Varlık</th>
              <th>Sembol</th>
              <th style={{ textAlign: 'right' }}>Fiyat ($)</th>
              <th style={{ textAlign: 'right' }}>24s Değişim</th>
              <th style={{ textAlign: 'right' }}>RSI (14)</th>
              <th style={{ textAlign: 'right' }}>MACD</th>
            </tr>
          </thead>
          <tbody>
            {cryptoList.map((row, idx) => (
              <tr key={row.symbol} onClick={() => onSelectTicker(row.symbol)} style={{ cursor: 'pointer' }}>
                <td><strong>{idx + 1}</strong></td>
                <td><strong>{row.name}</strong></td>
                <td><span className="badge" style={{ background: 'rgba(0,195,255,0.15)', color: '#00c3ff' }}>{row.symbol}</span></td>
                <td style={{ textAlign: 'right', fontWeight: 'bold' }}>
                  $<FlashValue value={row.price} format={(v) => v.toLocaleString('en-US', { maximumFractionDigits: 2 })} />
                </td>
                <td style={{ textAlign: 'right', color: row.changePct >= 0 ? '#3fb950' : '#f85149', fontWeight: 800 }}>
                  {row.changePct >= 0 ? '+' : ''}{row.changePct.toFixed(2)}%
                </td>
                <td style={{ textAlign: 'right', color: row.rsi < 30 ? '#3fb950' : row.rsi > 70 ? '#f85149' : 'inherit' }}>
                  {row.rsi.toFixed(1)}
                </td>
                <td style={{ textAlign: 'right', color: row.macd >= 0 ? '#3fb950' : '#f85149' }}>
                  {row.macd.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Top Gainers & Losers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '20px' }}>
        <section className="panel">
          <h3 style={{ fontSize: '1rem', color: '#3fb950', marginBottom: '12px' }}>🚀 Günün En Çok Kazandıran Kriptoları</h3>
          {gainers.slice(0, 4).map((g) => (
            <div
              key={g.symbol}
              onClick={() => onSelectTicker(g.symbol)}
              style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}
            >
              <div>
                <strong>{g.name} ({g.code})</strong>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>RSI: {g.rsi.toFixed(1)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 'bold' }}>${g.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}</div>
                <div style={{ color: '#3fb950', fontWeight: 'bold', fontSize: '0.85rem' }}>+{g.changePct.toFixed(2)}%</div>
              </div>
            </div>
          ))}
        </section>

        <section className="panel">
          <h3 style={{ fontSize: '1rem', color: '#f85149', marginBottom: '12px' }}>🔻 Günün En Çok Gerileyen Kriptoları</h3>
          {losers.slice(0, 4).map((l) => (
            <div
              key={l.symbol}
              onClick={() => onSelectTicker(l.symbol)}
              style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}
            >
              <div>
                <strong>{l.name} ({l.code})</strong>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>RSI: {l.rsi.toFixed(1)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 'bold' }}>${l.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}</div>
                <div style={{ color: '#f85149', fontWeight: 'bold', fontSize: '0.85rem' }}>{l.changePct.toFixed(2)}%</div>
              </div>
            </div>
          ))}
        </section>
      </div>

      {/* Crypto News */}
      {news.length > 0 && (
        <section className="panel">
          <h2 style={{ fontSize: '1.1rem', marginBottom: '14px' }}>📰 24/7 Kripto Para Haber Akışı</h2>
          <NewsList news={news} />
        </section>
      )}
    </div>
  );
}
