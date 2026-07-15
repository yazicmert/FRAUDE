import { useEffect, useState } from 'react';
import { getDashboardSnapshot, getPriceHistory, getBistIndices, updateBistIndices } from '../../api/tauriClient';
import { useTranslation } from '../../api/i18n';
import type { DashboardSnapshot, HistoricalQuote, EquityRow, IndexConstituent, IndexChange } from '../../types';
import PriceChart from '../ticker/PriceChart';
import IndexHeatmap from './IndexHeatmap';

const FALLBACK_INDEX_CONSTITUENTS: Record<string, string[]> = {
  'BIST 100': ["ASELS", "THYAO", "SISE", "EREGL", "GARAN", "AKBNK", "YKBNK", "KCHOL", "SAHOL", "TUPRS", "BIMAS"],
  'BIST 30': ["ASELS", "THYAO", "SISE", "EREGL", "GARAN", "AKBNK", "YKBNK", "KCHOL", "SAHOL", "TUPRS", "BIMAS"],
};

const SYMBOL_MAP: Record<string, string> = {
  'BIST 100': 'XU100.IS',
  'BIST 30': 'XU030.IS',
  'BIST 50': 'XU050.IS',
  'BIST BANKA': 'XBANK.IS',
  'BIST SINAI': 'XUSIN.IS',
  'BIST TEKNOLOJI': 'XUTEK.IS',
  'BIST HIZMETLER': 'XUHIZ.IS',
  'BIST HALKA ARZ': 'XHARZ.IS',
  'USD/TRY': 'USDTRY=X',
  'EUR/TRY': 'EURTRY=X'
};

interface IndexViewProps {
  symbol: string;
  onSelectTicker: (ticker: string) => void;
}

export default function IndexView({ symbol, onSelectTicker }: IndexViewProps) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [history, setHistory] = useState<HistoricalQuote[]>([]);
  
  const [dynamicIndices, setDynamicIndices] = useState<Record<string, IndexConstituent[]>>({});
  const [indexChanges, setIndexChanges] = useState<IndexChange[]>([]);
  const [isUpdatingIndices, setIsUpdatingIndices] = useState(false);
  
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [range, setRange] = useState('6mo');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'heatmap'>('list');

  const yahooSymbol = SYMBOL_MAP[symbol] || symbol;
  
  // Transform symbol to BIST code if possible
  const bistCode = symbol === 'BIST 100' ? 'XU100' :
                   symbol === 'BIST 30' ? 'XU030' :
                   symbol === 'BIST 50' ? 'XU050' : 
                   symbol === 'BIST BANKA' ? 'XBANK' : 
                   symbol === 'BIST SINAI' ? 'XUSIN' :
                   symbol === 'BIST TEKNOLOJI' ? 'XUTEK' : symbol;

  const loadData = async () => {
    try {
      const snap = await getDashboardSnapshot();
      setSnapshot(snap);
      
      const [indices, changes] = await getBistIndices();
      setDynamicIndices(indices);
      setIndexChanges(changes);
      
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateIndices = async () => {
    setIsUpdatingIndices(true);
    try {
      await updateBistIndices();
      const [indices, changes] = await getBistIndices();
      setDynamicIndices(indices);
      setIndexChanges(changes);
    } catch (err) {
      console.error("Failed to update indices from BIST:", err);
      alert("Endeks güncellemesi başarısız oldu: " + err);
    } finally {
      setIsUpdatingIndices(false);
    }
  };

  useEffect(() => {
    if (!snapshot) setLoading(true);
    setError(null);
    void loadData();
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);
    getPriceHistory(yahooSymbol, range)
      .then(rows => {
        if (!cancelled) setHistory(rows);
      })
      .catch(err => {
        if (!cancelled) {
          setHistory([]);
          setHistoryError(String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => { cancelled = true; };
  }, [yahooSymbol, range]);

  if (loading) return <div className="empty-state">{t('loadingIndex')}</div>;
  if (error) return <div className="empty-state error">{error}</div>;
  if (!snapshot) return <div className="empty-state">{t('noIndexData')}</div>;

  const metric = snapshot.market_metrics.find(m => m.symbol === symbol) || {
    symbol,
    value: '—',
    change: '—',
    positive: true
  };

  const currentConstituents = dynamicIndices[bistCode] || 
    (FALLBACK_INDEX_CONSTITUENTS[symbol] ? FALLBACK_INDEX_CONSTITUENTS[symbol].map(t => ({ ticker: t, name: t })) : []);
    
  const equities = symbol === 'BIST HALKA ARZ'
    ? snapshot.equities.filter(e => e.index_memberships && e.index_memberships.includes('BIST HALKA ARZ'))
    : currentConstituents
        .map(c => snapshot.equities.find(e => e.ticker === c.ticker || e.ticker === c.ticker + '.IS'))
        .filter((e): e is EquityRow => !!e);

  return (
    <div className="view">
      <div className="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p className="eyebrow">{t('indexWorkspace')}</p>
          <h1>{symbol}</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <button 
            onClick={handleUpdateIndices}
            disabled={isUpdatingIndices}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-primary)',
              cursor: isUpdatingIndices ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.85rem'
            }}
          >
            {isUpdatingIndices ? '⏳ Güncelleniyor...' : '📥 BIST CSV Güncelle'}
          </button>
          
          <div className="price-block">
            <strong>{metric.value}</strong>
            <span className={metric.change.startsWith('+') || metric.positive ? 'positive' : 'negative'}>
              {metric.change}
            </span>
          </div>
        </div>
      </div>

      <div className="split-grid">
        <section className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ margin: 0 }}>{t('constituentStocks')} ({equities.length})</h2>
            <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-default)', padding: '2px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
              <button 
                onClick={() => setViewMode('list')}
                style={{
                  padding: '4px 12px',
                  background: viewMode === 'list' ? 'var(--accent-primary)' : 'transparent',
                  color: viewMode === 'list' ? '#000' : 'var(--text-muted)',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  fontWeight: viewMode === 'list' ? 'bold' : 'normal',
                  cursor: 'pointer'
                }}
              >Liste</button>
              <button 
                onClick={() => setViewMode('heatmap')}
                style={{
                  padding: '4px 12px',
                  background: viewMode === 'heatmap' ? 'var(--accent-primary)' : 'transparent',
                  color: viewMode === 'heatmap' ? '#000' : 'var(--text-muted)',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  fontWeight: viewMode === 'heatmap' ? 'bold' : 'normal',
                  cursor: 'pointer'
                }}
              >Isı Haritası</button>
            </div>
          </div>
          
          <div style={{ flex: 1, overflowY: 'auto', minHeight: '400px' }}>
            {viewMode === 'heatmap' ? (
              <IndexHeatmap 
                constituents={currentConstituents}
                snapshot={snapshot}
                onSelectTicker={onSelectTicker}
                width={500}
                height={500}
              />
            ) : equities.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th>{t('ticker')}</th>
                    <th>{t('price')}</th>
                    <th>{t('change')}</th>
                    <th>{t('rsi')}</th>
                  </tr>
                </thead>
                <tbody>
                  {equities.map(row => {
                    // Check if ticker changed recently in this index
                    const recentChange = indexChanges.find(c => c.ticker === row.ticker && c.index_code === bistCode);
                    
                    return (
                      <tr 
                        key={row.ticker} 
                        onClick={() => onSelectTicker(row.ticker)}
                        className="clickable-row"
                        style={{ cursor: 'pointer' }}
                      >
                        <td style={{ color: 'var(--accent-primary)', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {row.ticker}
                          {recentChange && (
                            <span 
                              title={`${recentChange.date} tarihinde ${recentChange.action === 'ADDED' ? 'eklendi' : 'çıkarıldı'}`}
                              style={{ 
                                cursor: 'help', 
                                background: recentChange.action === 'ADDED' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)', 
                                padding: '2px 4px', 
                                borderRadius: '4px',
                                fontSize: '0.8rem'
                              }}
                            >
                              ⚠️
                            </span>
                          )}
                        </td>
                        <td>{row.price.toFixed(2)}</td>
                        <td className={row.change_pct >= 0 ? 'positive' : 'negative'}>
                          {row.change_pct >= 0 ? '+' : ''}{row.change_pct.toFixed(2)}%
                        </td>
                        <td>{row.rsi.toFixed(1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="empty-state" style={{ height: '200px' }}>
                {Object.keys(dynamicIndices).length === 0 ? "Lütfen 'BIST CSV Güncelle' butonuna basarak endeksleri yükleyin." : "No constituent details loaded."}
              </div>
            )}
          </div>
        </section>

        <section className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h2>{t('indexDynamics')}</h2>
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
          {historyLoading ? (
            <div className="empty-state" style={{ height: '350px' }}>{t('loadingChart')} {symbol}...</div>
          ) : historyError ? (
            <div className="empty-state error" style={{ height: '350px' }}>{historyError}</div>
          ) : history.length > 0 ? (
            <PriceChart ticker={symbol} data={history} range={range} />
          ) : (
            <div className="empty-state" style={{ height: '350px' }}>Loading chart dynamics for {symbol}...</div>
          )}
        </section>
      </div>
    </div>
  );
}
