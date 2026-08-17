import { useEffect, useMemo, useState } from 'react';
import { getDashboardSnapshot, getNewsFeed, getPriceHistory } from '../../api/tauriClient';
import type { EquityRow, HistoricalQuote, NewsItem } from '../../types';
import FlashValue from '../../components/FlashValue';
import { useLiveQuotes } from '../../hooks/useLiveQuotes';
import { NewsList } from '../news/NewsFeedView';
import PriceChart from '../ticker/PriceChart';
import './CryptoView.css';

interface CryptoViewProps {
  onSelectTicker: (ticker: string) => void;
}

export type CryptoCategory = 'Tümü' | 'Katman 1' | 'DeFi' | 'AI & Data' | 'Meme' | 'Payments';
export type FiatCurrency = 'USD' | 'TRY' | 'EUR';

export interface CryptoPreset {
  symbol: string;
  name: string;
  code: string;
  category: 'Katman 1' | 'DeFi' | 'AI & Data' | 'Meme' | 'Payments';
  share: number;
  marketCapB: number;
}

export const CRYPTO_PRESETS: CryptoPreset[] = [
  { symbol: 'BTC-USD', name: 'Bitcoin', code: 'BTC', category: 'Katman 1', share: 56.4, marketCapB: 1920 },
  { symbol: 'ETH-USD', name: 'Ethereum', code: 'ETH', category: 'Katman 1', share: 16.8, marketCapB: 415 },
  { symbol: 'SOL-USD', name: 'Solana', code: 'SOL', category: 'Katman 1', share: 4.9, marketCapB: 98 },
  { symbol: 'BNB-USD', name: 'BNB', code: 'BNB', category: 'Katman 1', share: 3.8, marketCapB: 88 },
  { symbol: 'XRP-USD', name: 'Ripple', code: 'XRP', category: 'Payments', share: 2.8, marketCapB: 36 },
  { symbol: 'DOGE-USD', name: 'Dogecoin', code: 'DOGE', category: 'Meme', share: 1.7, marketCapB: 24 },
  { symbol: 'ADA-USD', name: 'Cardano', code: 'ADA', category: 'Katman 1', share: 1.2, marketCapB: 18 },
  { symbol: 'AVAX-USD', name: 'Avalanche', code: 'AVAX', category: 'Katman 1', share: 1.0, marketCapB: 13 },
  { symbol: 'LINK-USD', name: 'Chainlink', code: 'LINK', category: 'AI & Data', share: 0.9, marketCapB: 11 },
  { symbol: 'NEAR-USD', name: 'NEAR Protocol', code: 'NEAR', category: 'AI & Data', share: 0.7, marketCapB: 6.8 },
  { symbol: 'DOT-USD', name: 'Polkadot', code: 'DOT', category: 'Katman 1', share: 0.6, marketCapB: 6.2 },
  { symbol: 'TRX-USD', name: 'TRON', code: 'TRX', category: 'Payments', share: 0.8, marketCapB: 15 },
  { symbol: 'LTC-USD', name: 'Litecoin', code: 'LTC', category: 'Payments', share: 0.5, marketCapB: 5.4 },
  { symbol: 'SHIB-USD', name: 'Shiba Inu', code: 'SHIB', category: 'Meme', share: 0.6, marketCapB: 8.8 },
];

export default function CryptoView({ onSelectTicker }: CryptoViewProps) {
  const [equities, setEquities] = useState<EquityRow[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('BTC-USD');
  const [activeCategory, setActiveCategory] = useState<CryptoCategory>('Tümü');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currency, setCurrency] = useState<FiatCurrency>('USD');
  const [chartRange, setChartRange] = useState<string>('6mo');
  const [chartData, setChartData] = useState<HistoricalQuote[]>([]);
  const [chartLoading, setChartLoading] = useState<boolean>(false);
  const [sortField, setSortField] = useState<'marketCap' | 'price' | 'changePct' | 'rsi'>('marketCap');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [moverTab, setMoverTab] = useState<'gainers' | 'losers' | 'oversold'>('gainers');

  // Converter state
  const [convAmount, setConvAmount] = useState<string>('1');
  const [convCrypto, setConvCrypto] = useState<string>('BTC-USD');
  const [convFiat, setConvFiat] = useState<FiatCurrency>('USD');

  const symbols = useMemo(() => [
    ...CRYPTO_PRESETS.map((p) => p.symbol),
    'USDTRY=X',
    'EURTRY=X',
  ], []);

  const live = useLiveQuotes(symbols);

  // Load Dashboard equities snapshot and initial news
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

    return () => { cancelled = true; };
  }, [symbols]);

  // Load news for selected crypto
  useEffect(() => {
    let cancelled = false;
    getNewsFeed(selectedSymbol)
      .then((items) => {
        if (!cancelled) setNews(items.slice(0, 10));
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [selectedSymbol]);

  // Load historical price chart data when selected crypto or range changes
  useEffect(() => {
    let cancelled = false;
    setChartLoading(true);
    getPriceHistory(selectedSymbol, chartRange, 'yahoo')
      .then((data) => {
        if (!cancelled) {
          setChartData(data);
          setChartLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setChartData([]);
          setChartLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [selectedSymbol, chartRange]);

  // Currency multiplier calculation
  const usdTry = live.get('USDTRY=X')?.price ?? equities.find((e) => e.ticker.toUpperCase() === 'USDTRY=X')?.price ?? 38.5;
  const eurTry = live.get('EURTRY=X')?.price ?? equities.find((e) => e.ticker.toUpperCase() === 'EURTRY=X')?.price ?? 41.2;
  const eurUsd = usdTry > 0 && eurTry > 0 ? eurTry / usdTry : 1.08;

  const currencyMultiplier = useMemo(() => {
    if (currency === 'TRY') return usdTry;
    if (currency === 'EUR') return 1 / eurUsd;
    return 1;
  }, [currency, usdTry, eurUsd]);

  const currencySymbol = useMemo(() => {
    if (currency === 'TRY') return '₺';
    if (currency === 'EUR') return '€';
    return '$';
  }, [currency]);

  // Build combined crypto list with live data and technicals
  const cryptoList = useMemo(() => {
    return CRYPTO_PRESETS.map((preset) => {
      const liveQuote = live.get(preset.symbol);
      const eq = equities.find((e) => e.ticker.toUpperCase() === preset.symbol);
      const rawPriceUsd = liveQuote?.price ?? eq?.price ?? 0;
      const price = rawPriceUsd * currencyMultiplier;
      const changePct = liveQuote?.change_pct ?? eq?.change_pct ?? 0;
      const rsi = eq?.rsi ?? 50;
      const macd = eq?.macd ?? 0;
      const high52 = (eq?.week_52_high ?? rawPriceUsd * 1.2) * currencyMultiplier;
      const low52 = (eq?.week_52_low ?? rawPriceUsd * 0.8) * currencyMultiplier;
      const volume24 = (eq?.volume ?? 1500000) * currencyMultiplier;
      const marketCap = preset.marketCapB * 1_000_000_000 * currencyMultiplier;

      // Technical Signal
      let signal: 'Güçlü Al' | 'Al' | 'Nötr' | 'Sat' = 'Nötr';
      if (rsi < 32 && macd >= 0) signal = 'Güçlü Al';
      else if (rsi < 45 && macd > 0) signal = 'Al';
      else if (rsi > 70) signal = 'Sat';
      else if (rsi > 60 && macd < 0) signal = 'Sat';

      return {
        ...preset,
        rawPriceUsd,
        price,
        changePct,
        rsi,
        macd,
        high52,
        low52,
        volume24,
        marketCap,
        signal,
      };
    });
  }, [live, equities, currencyMultiplier]);

  // Selected crypto detailed item
  const selectedItem = useMemo(() => {
    return cryptoList.find((c) => c.symbol === selectedSymbol) ?? cryptoList[0];
  }, [cryptoList, selectedSymbol]);

  // Global Market Stats & Fear and Greed Index Estimation
  const marketStats = useMemo(() => {
    const totalCap = cryptoList.reduce((acc, c) => acc + c.marketCap, 0);
    const btcItem = cryptoList.find((c) => c.code === 'BTC');
    const ethItem = cryptoList.find((c) => c.code === 'ETH');
    const btcDominance = btcItem ? btcItem.share : 56.4;
    const ethDominance = ethItem ? ethItem.share : 16.8;
    const avgChange = cryptoList.reduce((acc, c) => acc + c.changePct, 0) / (cryptoList.length || 1);
    const avgRsi = cryptoList.reduce((acc, c) => acc + c.rsi, 0) / (cryptoList.length || 1);

    // Calculate synthetic sentiment score 0-100
    const rawScore = Math.round(50 + (avgChange * 4) + ((avgRsi - 50) * 0.7));
    const score = Math.max(10, Math.min(95, rawScore));

    let label = 'Nötr';
    let labelClass = 'neutral';
    if (score <= 25) { label = 'Aşırı Korku'; labelClass = 'extreme-fear'; }
    else if (score <= 45) { label = 'Korku'; labelClass = 'fear'; }
    else if (score <= 55) { label = 'Nötr'; labelClass = 'neutral'; }
    else if (score <= 75) { label = 'Açgözlülük'; labelClass = 'greed'; }
    else { label = 'Aşırı Açgözlülük'; labelClass = 'extreme-greed'; }

    return {
      totalCap,
      btcDominance,
      ethDominance,
      avgChange,
      score,
      label,
      labelClass,
    };
  }, [cryptoList]);

  // Filtered and Sorted Table List
  const filteredList = useMemo(() => {
    return cryptoList
      .filter((item) => {
        const matchesCategory = activeCategory === 'Tümü' || item.category === activeCategory;
        const q = searchQuery.trim().toLowerCase();
        const matchesQuery = !q || item.name.toLowerCase().includes(q) || item.code.toLowerCase().includes(q) || item.symbol.toLowerCase().includes(q);
        return matchesCategory && matchesQuery;
      })
      .sort((a, b) => {
        let valA = a[sortField];
        let valB = b[sortField];
        if (sortOrder === 'asc') return valA > valB ? 1 : -1;
        return valA < valB ? 1 : -1;
      });
  }, [cryptoList, activeCategory, searchQuery, sortField, sortOrder]);

  // Top Movers
  const gainers = useMemo(() => [...cryptoList].sort((a, b) => b.changePct - a.changePct).slice(0, 5), [cryptoList]);
  const losers = useMemo(() => [...cryptoList].sort((a, b) => a.changePct - b.changePct).slice(0, 5), [cryptoList]);
  const oversold = useMemo(() => [...cryptoList].sort((a, b) => a.rsi - b.rsi).slice(0, 5), [cryptoList]);

  // Converter calculation
  const calculatedConversion = useMemo(() => {
    const amountNum = parseFloat(convAmount) || 0;
    const targetCrypto = cryptoList.find((c) => c.symbol === convCrypto);
    if (!targetCrypto || targetCrypto.rawPriceUsd <= 0) return '0.00';

    let fiatRate = 1;
    if (convFiat === 'TRY') fiatRate = usdTry;
    else if (convFiat === 'EUR') fiatRate = 1 / eurUsd;

    const result = amountNum * targetCrypto.rawPriceUsd * fiatRate;
    return result.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }, [convAmount, convCrypto, convFiat, cryptoList, usdTry, eurUsd]);

  const handleSort = (field: 'marketCap' | 'price' | 'changePct' | 'rsi') => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  return (
    <div className="view crypto-view crypto-container">
      {/* 1. Header & Pulse Bar */}
      <div className="crypto-header-card">
        <div className="crypto-header-top">
          <div className="crypto-title-area">
            <h1>
              <span>🪙</span> Kripto Para Piyasası
            </h1>
            <p>
              Bitcoin, Ethereum ve Altcoinler canlı derinlikli analiz, interaktif grafikler, ısı haritası ve küresel duyarlılık paneli.
            </p>
          </div>

          <div className="crypto-header-controls">
            {/* Currency Selector */}
            <div className="crypto-currency-selector">
              <button
                type="button"
                className={`crypto-currency-btn ${currency === 'USD' ? 'active' : ''}`}
                onClick={() => setCurrency('USD')}
              >
                USD ($)
              </button>
              <button
                type="button"
                className={`crypto-currency-btn ${currency === 'TRY' ? 'active' : ''}`}
                onClick={() => setCurrency('TRY')}
              >
                TRY (₺)
              </button>
              <button
                type="button"
                className={`crypto-currency-btn ${currency === 'EUR' ? 'active' : ''}`}
                onClick={() => setCurrency('EUR')}
              >
                EUR (€)
              </button>
            </div>

            {/* Live 7/24 Badge */}
            <div className="crypto-live-badge">
              <span className="crypto-pulse-dot" />
              <span>7/24 Kesintisiz Piyasa</span>
            </div>
          </div>
        </div>

        {/* Global Market Stats Bar */}
        <div className="crypto-market-stats-grid">
          <div className="crypto-stat-item">
            <span className="crypto-stat-label">Toplam Kripto Değeri</span>
            <div className="crypto-stat-value">
              {currencySymbol}{((marketStats.totalCap / 1_000_000_000_000) * (currency === 'TRY' ? usdTry : 1)).toFixed(2)}T
              <span className={`crypto-stat-change ${marketStats.avgChange >= 0 ? 'up' : 'down'}`}>
                {marketStats.avgChange >= 0 ? '+' : ''}{marketStats.avgChange.toFixed(2)}%
              </span>
            </div>
          </div>

          <div className="crypto-stat-item">
            <span className="crypto-stat-label">BTC Dominasyonu</span>
            <div className="crypto-stat-value">
              %{marketStats.btcDominance.toFixed(1)}
              <span style={{ fontSize: '0.75rem', color: '#8b949e', fontWeight: 500 }}>Piyasa Payı</span>
            </div>
          </div>

          <div className="crypto-stat-item">
            <span className="crypto-stat-label">ETH Dominasyonu</span>
            <div className="crypto-stat-value">
              %{marketStats.ethDominance.toFixed(1)}
              <span style={{ fontSize: '0.75rem', color: '#8b949e', fontWeight: 500 }}>Piyasa Payı</span>
            </div>
          </div>

          <div className="crypto-stat-item">
            <span className="crypto-stat-label">Korku & Açgözlülük Endeksi</span>
            <div className="crypto-stat-value fear-greed-meter">
              <span>{marketStats.score}/100</span>
              <span className={`fear-greed-badge ${marketStats.labelClass}`}>
                {marketStats.label}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Category Tabs & Search Navigation Bar */}
      <div className="crypto-nav-bar">
        <div className="crypto-category-tabs">
          {(['Tümü', 'Katman 1', 'DeFi', 'AI & Data', 'Meme', 'Payments'] as CryptoCategory[]).map((cat) => (
            <button
              key={cat}
              type="button"
              className={`crypto-tab-btn ${activeCategory === cat ? 'active' : ''}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="crypto-search-box">
          <span className="crypto-search-icon">🔍</span>
          <input
            type="text"
            className="crypto-search-input"
            placeholder="Kripto ara (Bitcoin, SOL, DOGE)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* 3. Interactive Dominance Heatmap */}
      <section className="crypto-heatmap-section">
        <div className="crypto-section-header">
          <h2 className="crypto-section-title">
            <span>📊</span> Piyasa Payı & 24s Değişim Isı Haritası
          </h2>
          <span style={{ fontSize: '0.78rem', color: '#8b949e' }}>
            Grafiği ve detayları incelemek için bir varlığa tıklayın
          </span>
        </div>

        <div className="crypto-heatmap-grid">
          {filteredList.map((item) => {
            const isGain = item.changePct >= 0;
            const intensity = Math.min(Math.abs(item.changePct) / 6, 1);
            const isSelected = item.symbol === selectedSymbol;

            const bg = isGain
              ? `rgba(63, 185, 80, ${0.14 + intensity * 0.42})`
              : `rgba(248, 81, 73, ${0.14 + intensity * 0.42})`;
            const border = isGain ? '#3fb950' : '#f85149';

            return (
              <div
                key={item.symbol}
                className={`crypto-heat-tile ${isSelected ? 'active-selected' : ''}`}
                style={{
                  background: bg,
                  border: `1px solid ${isSelected ? '#00c3ff' : border}`,
                }}
                onClick={() => setSelectedSymbol(item.symbol)}
              >
                <div className="crypto-tile-header">
                  <div className="crypto-tile-symbol-wrap">
                    <span className="crypto-tile-code">{item.code}</span>
                    <span className="crypto-tile-category">{item.category}</span>
                  </div>
                  <span className="crypto-tile-share">~%{item.share}</span>
                </div>

                <div className="crypto-tile-body">
                  <div className="crypto-tile-price">
                    {currencySymbol}
                    <FlashValue
                      value={item.price}
                      format={(v) => v >= 1
                        ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        : v.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })}
                    />
                  </div>
                  <div className="crypto-tile-footer">
                    <span className="crypto-tile-change" style={{ color: isGain ? '#3fb950' : '#f85149' }}>
                      {isGain ? '▲ +' : '▼ '}{item.changePct.toFixed(2)}%
                    </span>
                    <span className="crypto-tile-rsi">RSI: {item.rsi.toFixed(0)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 4. Selected Asset Deep Dive & Interactive Charting */}
      {selectedItem && (
        <section className="crypto-deep-dive-panel">
          <div className="crypto-deep-dive-header">
            <div className="crypto-deep-dive-identity">
              <div className="crypto-coin-avatar">
                {selectedItem.code.slice(0, 3)}
              </div>
              <div className="crypto-deep-dive-title-group">
                <h2>
                  {selectedItem.name} ({selectedItem.code})
                  <span className="crypto-badge" style={{ background: 'rgba(0, 195, 255, 0.12)', color: '#00c3ff' }}>
                    {selectedItem.symbol}
                  </span>
                  <span className={`crypto-signal-badge ${
                    selectedItem.signal === 'Güçlü Al' ? 'strong-buy' :
                    selectedItem.signal === 'Al' ? 'buy' :
                    selectedItem.signal === 'Sat' ? 'sell' : 'neutral'
                  }`}>
                    {selectedItem.signal}
                  </span>
                </h2>
                <p>Kategori: {selectedItem.category} • Küresel Piyasa Payı: ~%{selectedItem.share}</p>
              </div>
            </div>

            <div className="crypto-deep-dive-actions">
              {/* Range Selector */}
              <div className="crypto-currency-selector">
                {['1mo', '3mo', '6mo', '1y', 'max'].map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={`crypto-currency-btn ${chartRange === r ? 'active' : ''}`}
                    onClick={() => setChartRange(r)}
                  >
                    {r === '1mo' ? '1A' : r === '3mo' ? '3A' : r === '6mo' ? '6A' : r === '1y' ? '1Y' : 'TÜMÜ'}
                  </button>
                ))}
              </div>

              {/* Action Buttons */}
              <button
                type="button"
                className="crypto-action-btn primary"
                onClick={() => onSelectTicker(selectedItem.symbol)}
              >
                <span>🔍</span> Varlık Detayı
              </button>
            </div>
          </div>

          {/* Key Statistics & 24h Range Bar */}
          <div className="crypto-deep-dive-stats-bar">
            <div className="crypto-stat-item">
              <span className="crypto-stat-label">Canlı Fiyat</span>
              <div className="crypto-stat-value" style={{ fontSize: '1.25rem' }}>
                {currencySymbol}
                <FlashValue
                  value={selectedItem.price}
                  format={(v) => v >= 1
                    ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : v.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })}
                />
                <span className={`crypto-stat-change ${selectedItem.changePct >= 0 ? 'up' : 'down'}`}>
                  {selectedItem.changePct >= 0 ? '+' : ''}{selectedItem.changePct.toFixed(2)}%
                </span>
              </div>
            </div>

            <div className="crypto-stat-item">
              <span className="crypto-stat-label">RSI (14)</span>
              <div className="crypto-stat-value" style={{
                color: selectedItem.rsi < 30 ? '#00ff9d' : selectedItem.rsi > 70 ? '#f85149' : '#e6edf3'
              }}>
                {selectedItem.rsi.toFixed(1)}
                <span style={{ fontSize: '0.75rem', color: '#8b949e' }}>
                  {selectedItem.rsi < 30 ? 'Aşırı Satım' : selectedItem.rsi > 70 ? 'Aşırı Alım' : 'Dengeli'}
                </span>
              </div>
            </div>

            <div className="crypto-stat-item">
              <span className="crypto-stat-label">MACD Göstergesi</span>
              <div className="crypto-stat-value" style={{
                color: selectedItem.macd >= 0 ? '#3fb950' : '#f85149'
              }}>
                {selectedItem.macd.toFixed(2)}
              </div>
            </div>

            <div className="crypto-stat-item">
              <span className="crypto-stat-label">Piyasa Değeri</span>
              <div className="crypto-stat-value">
                {currencySymbol}{(selectedItem.marketCap / 1_000_000_000).toFixed(1)}B
              </div>
            </div>

            {/* 52-Week / 24h Range Bar */}
            <div className="crypto-range-bar-container">
              <div className="crypto-range-labels">
                <span>52H En Düşük: {currencySymbol}{selectedItem.low52.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                <span>52H En Yüksek: {currencySymbol}{selectedItem.high52.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
              </div>
              <div className="crypto-range-track">
                {(() => {
                  const range = selectedItem.high52 - selectedItem.low52;
                  const pos = range > 0
                    ? Math.max(0, Math.min(100, ((selectedItem.price - selectedItem.low52) / range) * 100))
                    : 50;
                  return (
                    <>
                      <div className="crypto-range-fill" style={{ width: `${pos}%` }} />
                      <div className="crypto-range-pointer" style={{ left: `${pos}%` }} />
                    </>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* Interactive Chart */}
          <div className="crypto-chart-container">
            {chartLoading ? (
              <div className="empty-state" style={{ minHeight: '380px' }}>Grafik yükleniyor...</div>
            ) : chartData.length > 0 ? (
              <PriceChart
                ticker={selectedItem.symbol}
                data={chartData}
                range={chartRange}
                livePrice={selectedItem.rawPriceUsd}
              />
            ) : (
              <div className="empty-state" style={{ minHeight: '380px' }}>Geçmiş fiyat verisi bulunamadı.</div>
            )}
          </div>
        </section>
      )}

      {/* 5. Two-Column Tools: Live Converter & Movers List */}
      <div className="crypto-tools-grid">
        {/* Live Multi-Currency Converter */}
        <div className="crypto-converter-card">
          <div className="crypto-section-header">
            <h3 className="crypto-section-title">
              <span>💱</span> Canlı Kripto & Kur Dönüştürücü
            </h3>
          </div>

          <div className="crypto-converter-row">
            <input
              type="number"
              className="crypto-converter-input"
              value={convAmount}
              onChange={(e) => setConvAmount(e.target.value)}
              min="0"
              step="any"
            />
            <select
              className="crypto-converter-select"
              value={convCrypto}
              onChange={(e) => setConvCrypto(e.target.value)}
            >
              {cryptoList.map((c) => (
                <option key={c.symbol} value={c.symbol}>
                  {c.code} ({c.name})
                </option>
              ))}
            </select>
          </div>

          <div className="crypto-swap-btn" onClick={() => {
            // Swap converter fiat
            setConvFiat((prev) => prev === 'TRY' ? 'USD' : 'TRY');
          }}>
            ⇅
          </div>

          <div className="crypto-converter-row" style={{ background: 'rgba(0, 195, 255, 0.04)', borderColor: 'rgba(0, 195, 255, 0.2)' }}>
            <div style={{ flex: 1, fontSize: '1.25rem', fontWeight: 800, color: '#00c3ff' }}>
              {convFiat === 'TRY' ? '₺' : convFiat === 'EUR' ? '€' : '$'} {calculatedConversion}
            </div>
            <select
              className="crypto-converter-select"
              value={convFiat}
              onChange={(e) => setConvFiat(e.target.value as FiatCurrency)}
            >
              <option value="USD">USD ($)</option>
              <option value="TRY">TRY (₺)</option>
              <option value="EUR">EUR (€)</option>
            </select>
          </div>

          <div className="crypto-quick-chips">
            {['1', '0.1', '0.5', '5', '10'].map((val) => (
              <button
                key={val}
                type="button"
                className="crypto-quick-chip"
                onClick={() => setConvAmount(val)}
              >
                {val} Adet
              </button>
            ))}
            <button
              type="button"
              className="crypto-quick-chip"
              style={{ color: '#00c3ff', borderColor: 'rgba(0, 195, 255, 0.3)' }}
              onClick={() => {
                setConvCrypto(selectedItem.symbol);
              }}
            >
              Seçiliyi Yükle ({selectedItem.code})
            </button>
          </div>
        </div>

        {/* Market Movers Card */}
        <div className="crypto-movers-card">
          <div className="crypto-movers-tabs">
            <button
              type="button"
              className={`crypto-mover-tab ${moverTab === 'gainers' ? 'active' : ''}`}
              onClick={() => setMoverTab('gainers')}
            >
              🚀 En Çok Yükselenler
            </button>
            <button
              type="button"
              className={`crypto-mover-tab ${moverTab === 'losers' ? 'active' : ''}`}
              onClick={() => setMoverTab('losers')}
            >
              🔻 En Çok Gerileyenler
            </button>
            <button
              type="button"
              className={`crypto-mover-tab ${moverTab === 'oversold' ? 'active' : ''}`}
              onClick={() => setMoverTab('oversold')}
            >
              ⚡ Aşırı Satım (Fırsat)
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {(moverTab === 'gainers' ? gainers : moverTab === 'losers' ? losers : oversold).map((item) => (
              <div
                key={item.symbol}
                className="crypto-mover-row"
                onClick={() => setSelectedSymbol(item.symbol)}
              >
                <div className="crypto-mover-info">
                  <div>
                    <div className="crypto-mover-code">{item.code}</div>
                    <div className="crypto-mover-name">{item.name}</div>
                  </div>
                </div>

                <div className="crypto-mover-right">
                  <div className="crypto-mover-price">
                    {currencySymbol}{item.price >= 1
                      ? item.price.toLocaleString('en-US', { maximumFractionDigits: 2 })
                      : item.price.toLocaleString('en-US', { maximumFractionDigits: 4 })}
                  </div>
                  <div className="crypto-mover-change" style={{
                    color: moverTab === 'oversold'
                      ? (item.rsi < 30 ? '#00ff9d' : '#e6edf3')
                      : (item.changePct >= 0 ? '#3fb950' : '#f85149')
                  }}>
                    {moverTab === 'oversold'
                      ? `RSI: ${item.rsi.toFixed(1)}`
                      : `${item.changePct >= 0 ? '+' : ''}${item.changePct.toFixed(2)}%`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 6. Advanced Sortable Data Table */}
      <section className="crypto-table-card">
        <div className="crypto-section-header">
          <h2 className="crypto-section-title">
            <span>📋</span> Kripto Varlık Sıralaması & Teknik Göstergeler
          </h2>
          <span style={{ fontSize: '0.78rem', color: '#8b949e' }}>
            {filteredList.length} varlık listeleniyor • Sütun başlıklarına tıklayarak sıralayabilirsiniz
          </span>
        </div>

        <div className="crypto-table-wrapper">
          <table className="crypto-data-table">
            <thead>
              <tr>
                <th style={{ width: '40px' }}>#</th>
                <th>Varlık</th>
                <th style={{ textAlign: 'right' }} onClick={() => handleSort('price')}>
                  Fiyat ({currencySymbol}) {sortField === 'price' && (sortOrder === 'asc' ? '▲' : '▼')}
                </th>
                <th style={{ textAlign: 'right' }} onClick={() => handleSort('changePct')}>
                  24s Değişim {sortField === 'changePct' && (sortOrder === 'asc' ? '▲' : '▼')}
                </th>
                <th style={{ textAlign: 'right' }} onClick={() => handleSort('marketCap')}>
                  Piyasa Değeri {sortField === 'marketCap' && (sortOrder === 'asc' ? '▲' : '▼')}
                </th>
                <th style={{ textAlign: 'right' }} onClick={() => handleSort('rsi')}>
                  RSI (14) {sortField === 'rsi' && (sortOrder === 'asc' ? '▲' : '▼')}
                </th>
                <th style={{ textAlign: 'right' }}>MACD</th>
                <th style={{ textAlign: 'center' }}>Teknik Sinyal</th>
                <th style={{ textAlign: 'center' }}>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {filteredList.map((row, idx) => (
                <tr
                  key={row.symbol}
                  onClick={() => setSelectedSymbol(row.symbol)}
                  style={{
                    background: row.symbol === selectedSymbol ? 'rgba(0, 195, 255, 0.06)' : undefined,
                  }}
                >
                  <td style={{ color: '#8b949e', fontWeight: 600 }}>{idx + 1}</td>
                  <td>
                    <div className="crypto-asset-cell">
                      <div>
                        <div className="crypto-asset-code">{row.code}</div>
                        <div className="crypto-asset-name">{row.name}</div>
                      </div>
                      <span className="crypto-badge" style={{ background: 'rgba(255, 255, 255, 0.05)', color: '#8b949e' }}>
                        {row.category}
                      </span>
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: '#ffffff' }}>
                    {currencySymbol}
                    <FlashValue
                      value={row.price}
                      format={(v) => v >= 1
                        ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        : v.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })}
                    />
                  </td>
                  <td style={{
                    textAlign: 'right',
                    fontWeight: 800,
                    color: row.changePct >= 0 ? '#3fb950' : '#f85149'
                  }}>
                    {row.changePct >= 0 ? '+' : ''}{row.changePct.toFixed(2)}%
                  </td>
                  <td style={{ textAlign: 'right', color: '#c9d1d9' }}>
                    {currencySymbol}{(row.marketCap / 1_000_000_000).toFixed(1)}B
                  </td>
                  <td style={{
                    textAlign: 'right',
                    fontWeight: 600,
                    color: row.rsi < 30 ? '#00ff9d' : row.rsi > 70 ? '#f85149' : 'inherit'
                  }}>
                    {row.rsi.toFixed(1)}
                  </td>
                  <td style={{
                    textAlign: 'right',
                    color: row.macd >= 0 ? '#3fb950' : '#f85149'
                  }}>
                    {row.macd.toFixed(2)}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span className={`crypto-signal-badge ${
                      row.signal === 'Güçlü Al' ? 'strong-buy' :
                      row.signal === 'Al' ? 'buy' :
                      row.signal === 'Sat' ? 'sell' : 'neutral'
                    }`}>
                      {row.signal}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      type="button"
                      className="crypto-action-btn"
                      style={{ padding: '4px 8px', fontSize: '0.74rem' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectTicker(row.symbol);
                      }}
                    >
                      Grafik
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 7. 24/7 Filterable Crypto News Section with In-App Reader */}
      {news.length > 0 && (
        <section className="crypto-news-card">
          <div className="crypto-section-header">
            <h2 className="crypto-section-title">
              <span>📰</span> 24/7 Canlı Kripto Haber Akışı ({selectedItem.name})
            </h2>
            <button
              type="button"
              className="crypto-action-btn"
              onClick={() => setSelectedSymbol('BTC-USD')}
            >
              Tüm Kripto Gündemi
            </button>
          </div>
          <NewsList news={news} />
        </section>
      )}
    </div>
  );
}
