import { useEffect, useState, useMemo } from 'react';
import { getDashboardSnapshot, syncData } from '../../api/tauriClient';
import { useTranslation } from '../../api/i18n';
import type { DashboardSnapshot, EquityRow } from '../../types';
import { BalanceAnalysis, CustomAnalysis, MarketBulletin, ModelPortfolio, AbnormalMovements, NewsAndAnnouncements } from './DashboardModules';
import ComparativeChart from './ComparativeChart';

interface DashboardViewProps {
  onSelectTicker: (ticker: string) => void;
  onSelectIndex: (symbol: string) => void;
}

const ALL_INDICES = [
  'BIST 100',
  'BIST 30',
  'BIST 50',
  'BIST BANKA',
  'BIST SINAI',
  'BIST TEKNOLOJI',
  'BIST HIZMETLER',
  'BIST HALKA ARZ',
  'USD/TRY',
  'EUR/TRY'
];

const DASHBOARD_MODULES = [
  'metrics', 'comparative_chart', 'bulletin', 'gainers', 'losers', 'risk_watch',
  'model_portfolio', 'balance_analysis', 'custom_analysis', 'abnormal_movements', 'news_panel'
];

const NEW_DEFAULT_MODULES = ['comparative_chart', 'bulletin', 'model_portfolio', 'abnormal_movements', 'balance_analysis', 'custom_analysis', 'news_panel'];

export default function DashboardView({ onSelectTicker, onSelectIndex }: DashboardViewProps) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showAllType, setShowAllType] = useState<{ type: 'gainers' | 'losers' | 'risk_watch', timeframe?: '1d' | '1w' | '1m' | '6m' | '1y' } | null>(null);
  const [showDataSourcesModal, setShowDataSourcesModal] = useState(false);

  const [universeFilter, setUniverseFilter] = useState<string>('all');

  // Active indices toggled visible
  const [visibleIndices, setVisibleIndices] = useState<string[]>(() => {
    const saved = localStorage.getItem('fraude-visible-indices');
    if (!saved) return ALL_INDICES;
    const parsed = JSON.parse(saved) as string[];
    return parsed.includes('BIST HALKA ARZ') ? parsed : [...parsed, 'BIST HALKA ARZ'];
  });

  // Closeable panels/modules toggled visible
  const [visibleModules, setVisibleModules] = useState<string[]>(() => {
    const saved = localStorage.getItem('fraude-visible-modules');
    if (!saved) return DASHBOARD_MODULES;
    const parsed = JSON.parse(saved) as string[];
    return [...parsed, ...NEW_DEFAULT_MODULES.filter(module => !parsed.includes(module))];
  });

  const load = async () => {
    if (!snapshot) setLoading(true);
    setError(null);
    try {
      setSnapshot(await getDashboardSnapshot());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();

    const handleSync = () => void load();
    window.addEventListener('fraude-sync-completed', handleSync);
    return () => window.removeEventListener('fraude-sync-completed', handleSync);
  }, []);

  const toggleIndex = (indexName: string) => {
    const next = visibleIndices.includes(indexName)
      ? visibleIndices.filter(x => x !== indexName)
      : [...visibleIndices, indexName];
    setVisibleIndices(next);
    localStorage.setItem('fraude-visible-indices', JSON.stringify(next));
  };

  const closeModule = (moduleName: string) => {
    const next = visibleModules.filter(m => m !== moduleName);
    setVisibleModules(next);
    localStorage.setItem('fraude-visible-modules', JSON.stringify(next));
  };

  const toggleModule = (moduleName: string) => {
    const next = visibleModules.includes(moduleName)
      ? visibleModules.filter(m => m !== moduleName)
      : [...visibleModules, moduleName];
    setVisibleModules(next);
    localStorage.setItem('fraude-visible-modules', JSON.stringify(next));
  };

  const allEquities = universeFilter === 'all' 
    ? (snapshot?.equities || []) 
    : (snapshot?.equities || []).filter(eq => eq.index_memberships && eq.index_memberships.includes(universeFilter));

  // Filter snapshot itself for the child modules
  const filteredSnapshot = snapshot ? { ...snapshot, equities: allEquities } : null;

  const availableIndices = useMemo(() => {
    if (!snapshot || !snapshot.equities) return [];
    const set = new Set<string>();
    snapshot.equities.forEach(e => {
      if (e.index_memberships) {
        e.index_memberships.forEach(m => set.add(m));
      }
    });
    return Array.from(set).sort();
  }, [snapshot]);

  if (loading) return <div className="empty-state">{t('loadingDashboard')}</div>;
  if (error) return <div className="empty-state error">{error}</div>;
  if (!snapshot || !filteredSnapshot) return <div className="empty-state">{t('noDashboardData')}</div>;

  // Grid metrics filter
  const renderedMetrics = isEditing 
    ? (snapshot.market_metrics || []).filter(m => ALL_INDICES.includes(m.symbol))
    : (snapshot.market_metrics || []).filter(m => visibleIndices.includes(m.symbol));

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <p className="eyebrow">{t('marketWorkspace')}</p>
          <h1>{t('dashboard')}</h1>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select 
            value={universeFilter}
            onChange={(e) => setUniverseFilter(e.target.value)}
            style={{
              padding: '6px 12px',
              borderRadius: '4px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-panel)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.8rem',
              cursor: 'pointer'
            }}
          >
            <option value="all">{t('filterAll')}</option>
            {availableIndices.map(idx => (
              <option key={idx} value={idx}>{idx}</option>
            ))}
          </select>
          <button
            type="button"
            className={`secondary-button ${isEditing ? 'active' : ''}`}
            onClick={() => setIsEditing(!isEditing)}
            style={isEditing ? { borderColor: 'var(--accent-primary)', color: 'var(--accent-primary)' } : undefined}
          >
            {isEditing ? t('exitCustomize') : t('customizeDashboard')}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={isSyncing}
            onClick={async () => {
              setIsSyncing(true);
              try {
                await syncData();
                await load();
              } finally {
                setIsSyncing(false);
              }
            }}
            style={isSyncing ? { opacity: 0.7, cursor: 'wait' } : undefined}
          >
            {isSyncing ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '12px', height: '12px', border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid white', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                {t('syncingData')}
              </span>
            ) : t('syncData')}
          </button>
        </div>
      </div>

      {isEditing && (
        <div style={{
          background: 'rgba(0, 255, 157, 0.05)',
          border: '1px dashed var(--accent-primary)',
          borderRadius: '6px',
          padding: '12px 14px',
          marginBottom: '14px',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.8rem',
          color: 'var(--accent-primary)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          <div>{t('editModeMessage')}</div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginTop: '6px' }}>
            <span style={{ fontWeight: 'bold' }}>{t('workspacePanels')}:</span>
            {DASHBOARD_MODULES.map(m => {
              const active = visibleModules.includes(m);
              const labelMap: Record<string, string> = {
                metrics: 'Endeksler',
                comparative_chart: t('comparativeChart'),
                gainers: t('topGainers'),
                losers: t('topLosers'),
                risk_watch: t('riskWatch'),
                bulletin: t('marketBulletin'),
                model_portfolio: t('modelPortfolio'),
                balance_analysis: t('balanceAnalysis'),
                custom_analysis: t('customAnalysis'),
                abnormal_movements: t('specialCases'),
                news_panel: t('kapSpkBulletins')
              };
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggleModule(m)}
                  style={{
                    padding: '4px 8px',
                    fontSize: '0.75rem',
                    background: active ? 'var(--accent-primary)' : 'var(--bg-panel)',
                    color: active ? '#000000' : 'var(--text-muted)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: active ? 'bold' : 'normal'
                  }}
                >
                  {labelMap[m] || m} {active ? '[ON]' : '[OFF]'}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {visibleModules.includes('comparative_chart') && (
        <ComparativeChart isEditing={isEditing} onClose={() => closeModule('comparative_chart')} equities={snapshot?.equities} />
      )}

      {/* 1. Market Metrics Panel */}
      {visibleModules.includes('metrics') && (
        <div style={{ position: 'relative', marginTop: '20px', marginBottom: '16px' }}>
          {isEditing && (
            <button
              type="button"
              onClick={() => closeModule('metrics')}
              style={{
                position: 'absolute',
                top: '-10px',
                right: '-10px',
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                background: '#ff3e3e',
                color: '#ffffff',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.75rem',
                zIndex: 10
              }}
            >
              ×
            </button>
          )}
          <div className="metric-grid">
            {renderedMetrics.map((metric) => {
              const isVisible = visibleIndices.includes(metric.symbol);
              const changeNum = parseFloat(metric.change.replace(/[^\d.+-]/g, ''));
              const isZeroChange = metric.change === '+0.00%' || metric.change === '0.00%' || changeNum === 0;
              return (
                <div
                  className="metric-card index-card"
                  key={metric.symbol}
                  onClick={() => {
                    if (isEditing) {
                      toggleIndex(metric.symbol);
                    } else {
                      onSelectIndex(metric.symbol);
                    }
                  }}
                  style={{
                    cursor: 'pointer',
                    position: 'relative',
                    opacity: !isVisible && isEditing ? 0.4 : 1.0,
                    transition: 'all 0.2s ease',
                    borderColor: !isVisible && isEditing ? '#21262d' : undefined,
                  }}
                >
                  {isEditing && (
                    <div style={{
                      position: 'absolute',
                      top: '8px',
                      right: '8px',
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.9rem',
                      fontWeight: 'bold',
                      color: '#000000',
                      background: isVisible ? '#ff3e3e' : 'var(--accent-primary)',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.5)',
                      zIndex: 10
                    }}>
                      {isVisible ? '−' : '+'}
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="index-card-label">{metric.symbol}</span>
                    {!isEditing && <span className="index-card-arrow">→</span>}
                  </div>
                  <strong className="index-card-value">{metric.value}</strong>
                  <em className={`index-card-change ${isZeroChange ? 'neutral' : metric.positive ? 'positive' : 'negative'}`}>
                    {isZeroChange ? '—' : metric.change}
                  </em>
                </div>
              );
            })}
          </div>
          {(() => {
            const bistTs = Math.max(0, ...renderedMetrics.filter(m => m.symbol.startsWith('BIST')).map(m => m.as_of_ts ?? 0));
            if (!bistTs) return null;
            const asOf = new Date(bistTs * 1000);
            const lagMin = Math.round((Date.now() - asOf.getTime()) / 60000);
            const timeStr = asOf.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            const lagStr = lagMin <= 90
              ? `Gecikme: ~${Math.max(lagMin, 15)} dk`
              : `Piyasa kapalı — son kapanış verisi`;
            return (
              <div style={{ marginTop: '8px', fontSize: '0.7rem', color: '#8b949e', fontFamily: 'var(--font-mono)' }}>
                Kaynak: Yahoo Finance · Son veri: {timeStr} · {lagStr} · BIST endeks verileri ~15 dk gecikmeli yayınlanır
              </div>
            );
          })()}
        </div>
      )}

      {/* 2. Split Grid for Gainers, Losers, and Risk Watch */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px', marginBottom: '16px' }}>
        {visibleModules.includes('gainers') && (
          <EquityTable 
            title={t('topGainers')} 
            type="gainers"
            equities={filteredSnapshot.equities} 
            onSelectTicker={onSelectTicker} 
            isEditing={isEditing}
            onClose={() => closeModule('gainers')}
            onShowAll={(timeframe) => setShowAllType({ type: 'gainers', timeframe })}
          />
        )}
        {visibleModules.includes('losers') && (
          <EquityTable 
            title={t('topLosers')} 
            type="losers"
            equities={filteredSnapshot.equities} 
            onSelectTicker={onSelectTicker} 
            isEditing={isEditing}
            onClose={() => closeModule('losers')}
            onShowAll={(timeframe) => setShowAllType({ type: 'losers', timeframe })}
          />
        )}
        {visibleModules.includes('risk_watch') && (
          <EquityTable 
            title={t('riskWatch')} 
            type="risk_watch"
            equities={filteredSnapshot.equities} 
            onSelectTicker={onSelectTicker} 
            isEditing={isEditing}
            onClose={() => closeModule('risk_watch')}
            onShowAll={(timeframe) => setShowAllType({ type: 'risk_watch', timeframe })}
          />
        )}
      </div>

      {visibleModules.includes('bulletin') && (
        <div style={{ marginBottom: '16px' }}>
          <MarketBulletin snapshot={filteredSnapshot} onSelectTicker={onSelectTicker} isEditing={isEditing} onClose={() => closeModule('bulletin')} />
        </div>
      )}

      <div className="dashboard-module-grid">
        {visibleModules.includes('model_portfolio') && (
          <ModelPortfolio snapshot={filteredSnapshot} onSelectTicker={onSelectTicker} isEditing={isEditing} onClose={() => closeModule('model_portfolio')} />
        )}
        {visibleModules.includes('balance_analysis') && (
          <BalanceAnalysis snapshot={filteredSnapshot} onSelectTicker={onSelectTicker} isEditing={isEditing} onClose={() => closeModule('balance_analysis')} />
        )}
      </div>

      {visibleModules.includes('custom_analysis') && (
        <div style={{ marginBottom: '16px' }}>
          <CustomAnalysis snapshot={filteredSnapshot} onSelectTicker={onSelectTicker} isEditing={isEditing} onClose={() => closeModule('custom_analysis')} />
        </div>
      )}

      {visibleModules.includes('abnormal_movements') && (
        <div style={{ marginBottom: '16px' }}>
          <AbnormalMovements snapshot={filteredSnapshot} onSelectTicker={onSelectTicker} isEditing={isEditing} onClose={() => closeModule('abnormal_movements')} />
        </div>
      )}

      {visibleModules.includes('news_panel') && (
        <div style={{ marginBottom: '16px' }}>
          <NewsAndAnnouncements snapshot={filteredSnapshot} onSelectTicker={onSelectTicker} isEditing={isEditing} onClose={() => closeModule('news_panel')} />
        </div>
      )}

      <div style={{ textAlign: 'center', marginTop: '32px', opacity: 0.5, fontSize: '0.8rem' }}>
        <span 
          style={{ cursor: 'pointer', textDecoration: 'underline' }} 
          onClick={() => setShowDataSourcesModal(true)}
        >
          {t('dataSources')}
        </span>
      </div>

      {/* Full Ticker List Modal (Show All) */}
      {showAllType && (
        <div 
          className="modal-overlay" 
          onClick={() => setShowAllType(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div 
            className="panel" 
            onClick={e => e.stopPropagation()}
            style={{
              width: '90%',
              maxWidth: '650px',
              maxHeight: '80vh',
              overflowY: 'auto',
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              padding: '20px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0 }}>
                {showAllType.type === 'gainers' ? t('allGainers') : showAllType.type === 'losers' ? t('allLosers') : t('allRiskWatch')} ({t('bistUniverse')})
                {showAllType.timeframe && showAllType.timeframe !== '1d' && <span style={{ fontSize: '0.8rem', marginLeft: '8px', color: 'var(--text-muted)' }}>({showAllType.timeframe})</span>}
              </h2>
              <button 
                type="button" 
                className="secondary-button" 
                onClick={() => setShowAllType(null)}
                style={{ padding: '4px 8px', fontSize: '0.8rem' }}
              >
                {t('close')}
              </button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>{t('ticker')}</th>
                  <th>{t('name')}</th>
                  <th>{t('price')}</th>
                  <th>{t('change')}</th>
                  <th>{t('rsi')}</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let list = [...filteredSnapshot.equities];
                  const timeframe = showAllType.timeframe || '1d';
                  const getChange = (row: EquityRow) => {
                    switch (timeframe) {
                      case '1w': return row.change_1w ?? 0;
                      case '1m': return row.change_1m ?? 0;
                      case '6m': return row.change_6m ?? 0;
                      case '1y': return row.change_1y ?? 0;
                      default: return row.change_pct;
                    }
                  };

                  if (showAllType.type === 'gainers') {
                    list = list.filter(row => getChange(row) > 0).sort((a, b) => getChange(b) - getChange(a));
                  } else if (showAllType.type === 'losers') {
                    list = list.filter(row => getChange(row) < 0).sort((a, b) => getChange(a) - getChange(b));
                  } else if (showAllType.type === 'risk_watch') {
                    list = list.filter(row => row.rsi > 70 || row.rsi < 30).sort((a, b) => b.rsi - a.rsi);
                  }

                  return list.map(row => {
                    const changeVal = getChange(row);
                    return (
                      <tr 
                        key={row.ticker} 
                        onClick={() => {
                          onSelectTicker(row.ticker);
                          setShowAllType(null);
                        }}
                        className="clickable-row"
                        style={{ cursor: 'pointer' }}
                      >
                        <td style={{ color: 'var(--accent-primary)', fontWeight: 'bold' }}>
                          {row.ticker}{row.index_memberships.includes('BIST HALKA ARZ') && <span style={{ marginLeft: '6px', fontSize: '0.58rem', color: '#d2a8ff' }}>IPO</span>}
                        </td>
                        <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{row.name}</td>
                        <td>{row.price.toFixed(2)}</td>
                        <td className={changeVal >= 0 ? 'positive' : 'negative'}>
                          {changeVal >= 0 ? '+' : ''}{changeVal.toFixed(2)}%
                        </td>
                        <td>{row.rsi.toFixed(1)}</td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Data Sources Modal */}
      {showDataSourcesModal && (
        <div 
          className="modal-overlay" 
          onClick={() => setShowDataSourcesModal(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div 
            className="panel" 
            onClick={e => e.stopPropagation()}
            style={{
              width: '80%',
              maxWidth: '600px',
              maxHeight: '80vh',
              overflowY: 'auto',
              position: 'relative'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0 }}>{t('dataSources')}</h2>
              <button className="secondary-button" onClick={() => setShowDataSourcesModal(false)}>{t('close')}</button>
            </div>
            <div className="source-list">
              {(snapshot.data_sources || []).map((source) => (
                <div className="source-row" key={source.name}>
                  <div>
                    <strong>{source.name}</strong>
                    <span>{source.provider}</span>
                  </div>
                  <span>{source.status === 'ready' ? t('ready') : source.status === 'not synced' ? t('notSynced') : source.status}</span>
                  <span>{source.records} {t('records')}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface EquityTableProps {
  title: string;
  type: 'gainers' | 'losers' | 'risk_watch';
  equities: EquityRow[];
  onSelectTicker: (ticker: string) => void;
  isEditing: boolean;
  onClose: () => void;
  onShowAll: (timeframe: Timeframe) => void;
}

type Timeframe = '1d' | '1w' | '1m' | '6m' | '1y';

function EquityTable({ title, type, equities, onSelectTicker, isEditing, onClose, onShowAll }: EquityTableProps) {
  const { t } = useTranslation();
  const [timeframe, setTimeframe] = useState<Timeframe>('1d');

  const rows = useMemo(() => {
    let list = [...equities];
    
    const getChange = (row: EquityRow) => {
      switch (timeframe) {
        case '1w': return row.change_1w ?? 0;
        case '1m': return row.change_1m ?? 0;
        case '6m': return row.change_6m ?? 0;
        case '1y': return row.change_1y ?? 0;
        default: return row.change_pct;
      }
    };

    if (type === 'gainers') {
      list = list.filter(row => getChange(row) > 0).sort((a, b) => getChange(b) - getChange(a));
    } else if (type === 'losers') {
      list = list.filter(row => getChange(row) < 0).sort((a, b) => getChange(a) - getChange(b));
    } else if (type === 'risk_watch') {
      list = list.filter(row => row.rsi > 70 || row.rsi < 30).sort((a, b) => b.rsi - a.rsi);
    }
    
    return list.slice(0, 5);
  }, [equities, type, timeframe]);

  return (
    <section className="panel" style={{ position: 'relative' }}>
      {isEditing && (
        <button
          type="button"
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            width: '20px',
            height: '20px',
            borderRadius: '50%',
            background: '#ff3e3e',
            color: '#ffffff',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.75rem',
            zIndex: 10
          }}
        >
          ×
        </button>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <div style={{ display: 'flex', gap: '6px' }}>
          {(type === 'gainers' || type === 'losers') && (
            <div style={{ display: 'flex', background: 'var(--bg-secondary)', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
              {([['1d', 'G'], ['1w', 'H'], ['1m', 'A'], ['6m', '6A'], ['1y', 'Y']] as const).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setTimeframe(val as Timeframe)}
                  style={{
                    background: timeframe === val ? 'var(--accent-primary)' : 'transparent',
                    color: timeframe === val ? '#000000' : 'var(--text-muted)',
                    border: 'none',
                    padding: '2px 8px',
                    fontSize: '0.7rem',
                    fontWeight: timeframe === val ? 'bold' : 'normal',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  title={val === '1d' ? 'Günlük' : val === '1w' ? 'Haftalık' : val === '1m' ? 'Aylık' : val === '6m' ? '6 Aylık' : 'Yıllık'}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <button 
            type="button" 
            className="secondary-button" 
            onClick={() => onShowAll(timeframe)}
            style={{ padding: '2px 6px', fontSize: '0.75rem', height: '24px' }}
          >
            {t('tamListe')}
          </button>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>{t('ticker')}</th>
            <th>{t('price')}</th>
            <th>{t('change')}</th>
            <th>{t('rsi')}</th>
            <th>{t('roe')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row: EquityRow) => {
            let changeVal = row.change_pct;
            if (timeframe === '1w') changeVal = row.change_1w ?? 0;
            if (timeframe === '1m') changeVal = row.change_1m ?? 0;
            if (timeframe === '6m') changeVal = row.change_6m ?? 0;
            if (timeframe === '1y') changeVal = row.change_1y ?? 0;

            return (
              <tr 
                key={row.ticker} 
                onClick={() => onSelectTicker(row.ticker)}
                style={{ cursor: 'pointer' }}
                className="clickable-row"
              >
                <td style={{ color: 'var(--accent-primary)', fontWeight: 'bold' }}>
                  {row.ticker}{row.index_memberships.includes('BIST HALKA ARZ') && <span style={{ marginLeft: '5px', fontSize: '0.55rem', color: '#d2a8ff' }}>IPO</span>}
                </td>
                <td>{row.price.toFixed(2)}</td>
                <td className={changeVal >= 0 ? 'positive' : 'negative'}>
                  {changeVal >= 0 ? '+' : ''}{changeVal.toFixed(2)}%
                </td>
                <td>{row.rsi.toFixed(1)}</td>
                <td>{row.roe !== null ? `${row.roe.toFixed(1)}%` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
