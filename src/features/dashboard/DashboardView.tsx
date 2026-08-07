import { useEffect, useState, useMemo } from 'react';
import { getDashboardSnapshot, syncData } from '../../api/tauriClient';
import { useTranslation } from '../../api/i18n';
import { isBistEquity } from '../../lib/equityGroups';
import type { DashboardSnapshot, EquityRow } from '../../types';
import { BalanceAnalysis, CustomAnalysis, MarketBulletin, ModelPortfolio, AbnormalMovements, NewsAndAnnouncements, CommoditiesMiniWidget, CryptoMiniWidget, FundsMiniWidget } from './DashboardModules';
import ComparativeChart from './ComparativeChart';

interface DashboardViewProps {
  onSelectTicker: (ticker: string) => void;
}

const ALL_DASHBOARD_MODULES = [
  'crypto_panel',
  'commodities_panel',
  'funds_panel',
  'comparative_chart',
  'gainers',
  'losers',
  'risk_watch',
  'bulletin',
  'model_portfolio',
  'balance_analysis',
  'custom_analysis',
  'abnormal_movements',
  'news_panel',
];

export default function DashboardView({ onSelectTicker }: DashboardViewProps) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showAllType, setShowAllType] = useState<{ type: 'gainers' | 'losers' | 'risk_watch', timeframe?: '1d' | '1w' | '1m' | '6m' | '1y' } | null>(null);
  const [showDataSourcesModal, setShowDataSourcesModal] = useState(false);
  const [showAddModuleModal, setShowAddModuleModal] = useState(false);
  const [customTickerInput, setCustomTickerInput] = useState('');
  const [moduleSearchQuery, setModuleSearchQuery] = useState('');

  const symbolSuggestions = useMemo(() => {
    if (!customTickerInput || customTickerInput.trim().length < 1) return [];
    const q = customTickerInput.trim().toUpperCase();
    const equities = snapshot?.equities || [];
    return equities.filter((e) => {
      if (!e || !e.ticker) return false;
      const tickerMatch = e.ticker.toUpperCase().includes(q);
      const nameMatch = Boolean(e.name && e.name.toUpperCase().includes(q));
      return tickerMatch || nameMatch;
    }).slice(0, 8);
  }, [customTickerInput, snapshot]);

  const [universeFilter, setUniverseFilter] = useState<string>('all');

  const [hoveredModule, setHoveredModule] = useState<string | null>(null);

  const DEFAULT_MODULE_WIDTHS: Record<string, 'full' | 'half'> = {
    crypto_panel: 'half',
    commodities_panel: 'half',
    funds_panel: 'half',
    gainers: 'half',
    losers: 'half',
    risk_watch: 'half',
    comparative_chart: 'full',
    bulletin: 'full',
    model_portfolio: 'half',
    balance_analysis: 'half',
    custom_analysis: 'full',
    abnormal_movements: 'full',
    news_panel: 'full',
  };

  const [moduleWidths, setModuleWidths] = useState<Record<string, 'full' | 'half'>>(() => {
    const saved = localStorage.getItem('fraude-module-widths');
    if (!saved) return DEFAULT_MODULE_WIDTHS;
    try {
      const parsed = JSON.parse(saved);
      return { ...DEFAULT_MODULE_WIDTHS, ...parsed };
    } catch {
      return DEFAULT_MODULE_WIDTHS;
    }
  });

  const toggleModuleWidth = (moduleName: string) => {
    const curr = moduleWidths[moduleName] || 'full';
    const nextWidth: 'full' | 'half' = curr === 'full' ? 'half' : 'full';
    const nextMap: Record<string, 'full' | 'half'> = { ...moduleWidths, [moduleName]: nextWidth };
    setModuleWidths(nextMap);
    localStorage.setItem('fraude-module-widths', JSON.stringify(nextMap));
  };

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }
    const newOrder = [...moduleOrder];
    const [draggedItem] = newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, draggedItem);
    setModuleOrder(newOrder);
    localStorage.setItem('fraude-module-order', JSON.stringify(newOrder));
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const [moduleOrder, setModuleOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem('fraude-module-order');
    if (!saved) return ALL_DASHBOARD_MODULES;
    const parsed = JSON.parse(saved) as string[];
    return [...parsed, ...ALL_DASHBOARD_MODULES.filter(m => !parsed.includes(m))];
  });

  // Closeable panels/modules toggled visible
  const [visibleModules, setVisibleModules] = useState<string[]>(() => {
    const saved = localStorage.getItem('fraude-visible-modules');
    if (!saved) return ALL_DASHBOARD_MODULES;
    const parsed = JSON.parse(saved) as string[];
    return [...parsed, ...ALL_DASHBOARD_MODULES.filter(module => !parsed.includes(module))];
  });

  const load = async () => {
    try {
      const next = await getDashboardSnapshot();
      setSnapshot(next);
      setError(null);
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

  const moveModuleUp = (moduleName: string) => {
    const idx = moduleOrder.indexOf(moduleName);
    if (idx <= 0) return;
    const next = [...moduleOrder];
    const temp = next[idx - 1];
    next[idx - 1] = next[idx];
    next[idx] = temp;
    setModuleOrder(next);
    localStorage.setItem('fraude-module-order', JSON.stringify(next));
  };

  const moveModuleDown = (moduleName: string) => {
    const idx = moduleOrder.indexOf(moduleName);
    if (idx === -1 || idx >= moduleOrder.length - 1) return;
    const next = [...moduleOrder];
    const temp = next[idx + 1];
    next[idx + 1] = next[idx];
    next[idx] = temp;
    setModuleOrder(next);
    localStorage.setItem('fraude-module-order', JSON.stringify(next));
  };

  const applyPreset = (preset: 'default' | 'crypto_commodities' | 'funds_equities' | 'charts') => {
    let order: string[];
    if (preset === 'crypto_commodities') {
      order = ['crypto_panel', 'commodities_panel', 'gainers', 'losers', 'funds_panel', 'comparative_chart', 'bulletin', 'model_portfolio', 'balance_analysis', 'custom_analysis', 'abnormal_movements', 'news_panel', 'risk_watch'];
    } else if (preset === 'funds_equities') {
      order = ['funds_panel', 'gainers', 'losers', 'commodities_panel', 'crypto_panel', 'comparative_chart', 'bulletin', 'model_portfolio', 'balance_analysis', 'custom_analysis', 'abnormal_movements', 'news_panel', 'risk_watch'];
    } else if (preset === 'charts') {
      order = ['comparative_chart', 'crypto_panel', 'commodities_panel', 'gainers', 'losers', 'funds_panel', 'bulletin', 'model_portfolio', 'balance_analysis', 'custom_analysis', 'abnormal_movements', 'news_panel', 'risk_watch'];
    } else {
      order = ALL_DASHBOARD_MODULES;
    }
    setModuleOrder(order);
    setVisibleModules(order);
    localStorage.setItem('fraude-module-order', JSON.stringify(order));
    localStorage.setItem('fraude-visible-modules', JSON.stringify(order));
  };

  const allEquities = universeFilter === 'all'
    ? (snapshot?.equities || [])
    : (snapshot?.equities || []).filter(eq => eq.index_memberships && eq.index_memberships.includes(universeFilter));

  // Filter snapshot itself for the child modules
  const filteredSnapshot = snapshot ? { ...snapshot, equities: allEquities } : null;

  // Yükselen/düşen/risk listeleri BIST'e özeldir: 'Tüm BIST' seçiliyken ABD
  // hisseleri (Global) ve emtia/döviz satırları elenir. Kullanıcı açıkça bir
  // grup seçtiyse (Global dahil) o grubun satırları olduğu gibi gösterilir.
  const moverEquities = universeFilter === 'all' ? allEquities.filter(isBistEquity) : allEquities;

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

  // Tam ekran yükleme/hata yalnızca elde gösterilecek veri yokken; veri varken
  // arka plan yenilemesinin hatası panoyu silmez (üst çubuk durumu zaten gösterir).
  if (loading && !snapshot) return <div className="empty-state">{t('loadingDashboard')}</div>;
  if (error && !snapshot) return <div className="empty-state error">{error}</div>;
  if (!snapshot || !filteredSnapshot) return <div className="empty-state">{t('noDashboardData')}</div>;

  return (
    <div
      className="view"
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (
          target.classList.contains('view') || 
          target.classList.contains('dashboard-grid') || 
          target.classList.contains('empty-slot-card') ||
          (target.tagName === 'DIV' && !target.closest('.panel') && !target.closest('button') && !target.closest('select') && !target.closest('input'))
        ) {
          setShowAddModuleModal(true);
        }
      }}
    >
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
          background: 'rgba(0, 195, 255, 0.05)',
          border: '1px dashed var(--accent-primary)',
          borderRadius: '10px',
          padding: '14px 16px',
          marginBottom: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <span style={{ fontWeight: 'bold', color: 'var(--accent-primary)', fontSize: '0.88rem' }}>
              ⚙️ Modüler Pano Düzenleyici (Bileşen Sırasını & Görünürlüğünü Özelleştirin)
            </span>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Her kart üzerindeki ⬆️ ⬇️ ve ❌ butonları ile düzeni anında değiştirebilirsiniz.
            </span>
          </div>

          {/* Quick Presets */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>⚡ Şablon Düzenler:</span>
            <button type="button" className="secondary-button" style={{ padding: '3px 10px', fontSize: '0.75rem' }} onClick={() => applyPreset('default')}> Standart </button>
            <button type="button" className="secondary-button" style={{ padding: '3px 10px', fontSize: '0.75rem' }} onClick={() => applyPreset('crypto_commodities')}> 🪙 Kripto & 🛢️ Emtia Üstte </button>
            <button type="button" className="secondary-button" style={{ padding: '3px 10px', fontSize: '0.75rem' }} onClick={() => applyPreset('funds_equities')}> 🧺 Fonlar & 📈 Hisseler Üstte </button>
            <button type="button" className="secondary-button" style={{ padding: '3px 10px', fontSize: '0.75rem' }} onClick={() => applyPreset('charts')}> 📉 Grafikler Üstte </button>
          </div>

          {/* Visibility Toggle Buttons */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '4px' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>👁️ Modül Görünürlüğü:</span>
            {ALL_DASHBOARD_MODULES.map(m => {
              const active = visibleModules.includes(m);
              const labelMap: Record<string, string> = {
                crypto_panel: '🪙 Kripto Piyasaları',
                commodities_panel: '🛢️ Emtia & Metaller',
                funds_panel: '🧺 TEFAS Fonları',
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
                    padding: '4px 10px',
                    fontSize: '0.75rem',
                    background: active ? 'rgba(0, 195, 255, 0.15)' : 'var(--bg-panel)',
                    color: active ? '#00c3ff' : 'var(--text-muted)',
                    border: active ? '1px solid #00c3ff' : '1px solid var(--border-color)',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: active ? 'bold' : 'normal'
                  }}
                >
                  {labelMap[m] || m} {active ? '✓' : '✗'}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Dynamic Module Rendering loop according to moduleOrder */}
      <div className="dashboard-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px', alignItems: 'stretch' }}>
        {moduleOrder.map((modKey, idx) => {
          if (!visibleModules.includes(modKey)) return null;

          const isDragging = draggedIndex === idx;
          const isDragOver = dragOverIndex === idx;
          const width = moduleWidths[modKey] || 'full';
          const isHalf = width === 'half';
          const isHovered = hoveredModule === modKey;

          let content: React.ReactNode = null;
          switch (modKey) {
            case 'crypto_panel':
              content = (
                <CryptoMiniWidget
                  snapshot={filteredSnapshot}
                  onSelectTicker={onSelectTicker}
                  isEditing={isEditing}
                  onClose={() => closeModule('crypto_panel')}
                />
              );
              break;
            case 'commodities_panel':
              content = (
                <CommoditiesMiniWidget
                  snapshot={filteredSnapshot}
                  onSelectTicker={onSelectTicker}
                  isEditing={isEditing}
                  onClose={() => closeModule('commodities_panel')}
                />
              );
              break;
            case 'funds_panel':
              content = (
                <FundsMiniWidget
                  onSelectTicker={onSelectTicker}
                  isEditing={isEditing}
                  onClose={() => closeModule('funds_panel')}
                />
              );
              break;
            case 'comparative_chart':
              content = (
                <ComparativeChart isEditing={isEditing} onClose={() => closeModule('comparative_chart')} equities={snapshot?.equities} />
              );
              break;
            case 'gainers':
              content = (
                <EquityTable
                  title={t('topGainers')}
                  type="gainers"
                  equities={moverEquities}
                  onSelectTicker={onSelectTicker}
                  isEditing={isEditing}
                  onClose={() => closeModule('gainers')}
                  onShowAll={(timeframe) => setShowAllType({ type: 'gainers', timeframe })}
                />
              );
              break;
            case 'losers':
              content = (
                <EquityTable
                  title={t('topLosers')}
                  type="losers"
                  equities={moverEquities}
                  onSelectTicker={onSelectTicker}
                  isEditing={isEditing}
                  onClose={() => closeModule('losers')}
                  onShowAll={(timeframe) => setShowAllType({ type: 'losers', timeframe })}
                />
              );
              break;
            case 'risk_watch':
              content = (
                <EquityTable
                  title={t('riskWatch')}
                  type="risk_watch"
                  equities={moverEquities}
                  onSelectTicker={onSelectTicker}
                  isEditing={isEditing}
                  onClose={() => closeModule('risk_watch')}
                  onShowAll={(timeframe) => setShowAllType({ type: 'risk_watch', timeframe })}
                />
              );
              break;
            case 'bulletin':
              content = (
                <MarketBulletin
                  snapshot={filteredSnapshot}
                  onSelectTicker={onSelectTicker}
                  isEditing={isEditing}
                  onClose={() => closeModule('bulletin')}
                />
              );
              break;
            case 'model_portfolio':
              content = (
                <ModelPortfolio
                  snapshot={filteredSnapshot}
                  onSelectTicker={onSelectTicker}
                  isEditing={isEditing}
                  onClose={() => closeModule('model_portfolio')}
                />
              );
              break;
            case 'balance_analysis':
              content = (
                <BalanceAnalysis
                  snapshot={filteredSnapshot}
                  onSelectTicker={onSelectTicker}
                  isEditing={isEditing}
                  onClose={() => closeModule('balance_analysis')}
                />
              );
              break;
            case 'custom_analysis':
              content = (
                <CustomAnalysis
                  snapshot={filteredSnapshot}
                  onSelectTicker={onSelectTicker}
                  isEditing={isEditing}
                  onClose={() => closeModule('custom_analysis')}
                />
              );
              break;
            case 'abnormal_movements':
              content = (
                <AbnormalMovements
                  snapshot={filteredSnapshot}
                  onSelectTicker={onSelectTicker}
                  isEditing={isEditing}
                  onClose={() => closeModule('abnormal_movements')}
                />
              );
              break;
            case 'news_panel':
              content = (
                <NewsAndAnnouncements
                  snapshot={filteredSnapshot}
                  onSelectTicker={onSelectTicker}
                  isEditing={isEditing}
                  onClose={() => closeModule('news_panel')}
                />
              );
              break;
            default:
              content = null;
          }

          return (
            <div
              key={modKey}
              draggable={true}
              onDragStart={(e) => handleDragStart(e, idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={(e) => handleDrop(e, idx)}
              onDragEnd={handleDragEnd}
              onMouseEnter={() => setHoveredModule(modKey)}
              onMouseLeave={() => setHoveredModule(null)}
              style={{
                gridColumn: isHalf ? 'span 1' : '1 / -1',
                position: 'relative',
                borderRadius: '12px',
                transition: 'transform 0.2s ease, opacity 0.2s ease, box-shadow 0.2s ease',
                opacity: isDragging ? 0.45 : 1,
                border: isDragging
                  ? '2px dashed #00c3ff'
                  : isDragOver
                  ? '2px solid #3fb950'
                  : isEditing || isHovered
                  ? '1px dashed rgba(0, 195, 255, 0.4)'
                  : '1px solid transparent',
                boxShadow: isDragOver
                  ? '0 0 24px rgba(63, 185, 80, 0.35)'
                  : isEditing || isHovered
                  ? '0 0 16px rgba(0, 195, 255, 0.12)'
                  : 'none',
                transform: isDragOver ? 'scale(1.01)' : 'none',
                cursor: 'grab',
              }}
            >
              {(isEditing || isHovered) && (
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 14px', background: 'rgba(13, 17, 23, 0.94)', backdropFilter: 'blur(12px)',
                  border: '1px solid rgba(0, 195, 255, 0.35)', borderBottom: 'none',
                  borderRadius: '10px 10px 0 0', fontSize: '0.8rem', color: '#00c3ff', fontWeight: 'bold',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.4)', zIndex: 12
                }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'grab' }}>
                    ⋮⋮ Basılı Tut & Sürükle (Drag & Drop)
                  </span>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={() => toggleModuleWidth(modKey)}
                      title="Genişlik Değiştir (Yan Yana / Tam Boyut)"
                      style={{
                        padding: '3px 8px', fontSize: '0.74rem', background: 'rgba(0,195,255,0.15)',
                        border: '1px solid rgba(0,195,255,0.4)', borderRadius: '6px', color: '#00c3ff', cursor: 'pointer', fontWeight: 'bold'
                      }}
                    >
                      ⇄ {isHalf ? 'Tam Genişlik' : 'Yan Yana (Sağa Taşı)'}
                    </button>
                    <button type="button" onClick={() => moveModuleUp(modKey)} style={{ padding: '3px 6px', fontSize: '0.72rem', background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', cursor: 'pointer' }}>⬆️ Üste</button>
                    <button type="button" onClick={() => moveModuleDown(modKey)} style={{ padding: '3px 6px', fontSize: '0.72rem', background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', cursor: 'pointer' }}>⬇️ Alta</button>
                    <button
                      type="button"
                      onClick={() => closeModule(modKey)}
                      style={{
                        background: 'rgba(248, 81, 73, 0.2)', border: '1px solid #f85149',
                        borderRadius: '6px', color: '#f85149', padding: '3px 8px', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 'bold'
                      }}
                    >
                      ❌ Kaldır
                    </button>
                  </div>
                </div>
              )}
              {content}
            </div>
          );
        })}

        {/* Interactive Empty Slot Card - ALWAYS rendered in grid for immediate clicking */}
        <div
          key="empty-slot-card"
          onClick={(e) => {
            e.stopPropagation();
            setShowAddModuleModal(true);
          }}
          style={{
            gridColumn: 'span 1',
            alignSelf: 'stretch',
            minHeight: '220px',
            border: '2px dashed rgba(0, 195, 255, 0.45)',
            borderRadius: '14px',
            background: 'rgba(0, 195, 255, 0.04)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            gap: '12px',
            transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
            padding: '24px',
            textAlign: 'center',
            boxShadow: '0 0 15px rgba(0, 195, 255, 0.08)',
          }}
          className="empty-slot-card"
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#00c3ff';
            e.currentTarget.style.background = 'rgba(0, 195, 255, 0.09)';
            e.currentTarget.style.boxShadow = '0 0 25px rgba(0, 195, 255, 0.3)';
            e.currentTarget.style.transform = 'scale(1.01)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'rgba(0, 195, 255, 0.45)';
            e.currentTarget.style.background = 'rgba(0, 195, 255, 0.04)';
            e.currentTarget.style.boxShadow = '0 0 15px rgba(0, 195, 255, 0.08)';
            e.currentTarget.style.transform = 'none';
          }}
        >
          <div style={{
            width: '50px',
            height: '50px',
            borderRadius: '50%',
            background: 'rgba(0, 195, 255, 0.2)',
            border: '2px solid #00c3ff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.5rem',
            color: '#00c3ff',
            fontWeight: 800,
            boxShadow: '0 0 12px rgba(0, 195, 255, 0.3)'
          }}>
            +
          </div>
          <div style={{ fontSize: '0.96rem', fontWeight: 800, color: '#00c3ff' }}>
            Boşluğa Tıkla: Modül veya Ekran Ekle
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', maxWidth: '280px' }}>
            Bu alana tıklayarak yeni gösterge paneli, canlı fiyat kartı veya teknik ekran ekleyin
          </div>
        </div>
      </div>

      {/* Hidden Modules Gallery Drawer */}
      {ALL_DASHBOARD_MODULES.filter((m) => !visibleModules.includes(m)).length > 0 && (
        <div className="panel" style={{
          marginTop: '24px', padding: '20px', background: 'rgba(63, 185, 80, 0.04)',
          border: '1px dashed rgba(63, 185, 80, 0.3)', borderRadius: '14px'
        }}>
          <h3 style={{ margin: '0 0 10px', fontSize: '1.05rem', color: '#3fb950', display: 'flex', alignItems: 'center', gap: '8px' }}>
            ➕ Panoya Yeni Modül Ekle
          </h3>
          <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', margin: '0 0 16px' }}>
            Gizli durumdaki aşağıdaki modülleri panonuza eklemek için tıklayın:
          </p>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {ALL_DASHBOARD_MODULES.filter((m) => !visibleModules.includes(m)).map((m) => {
              const labelMap: Record<string, string> = {
                crypto_panel: '🪙 Kripto Piyasaları',
                commodities_panel: '🛢️ Emtia & Metaller',
                funds_panel: '🧺 TEFAS Fonları',
                comparative_chart: t('comparativeChart'),
                gainers: t('topGainers'),
                losers: t('topLosers'),
                risk_watch: t('riskWatch'),
                bulletin: t('marketBulletin'),
                model_portfolio: t('modelPortfolio'),
                balance_analysis: t('balanceAnalysis'),
                custom_analysis: t('customAnalysis'),
                abnormal_movements: t('specialCases'),
                news_panel: t('kapSpkBulletins'),
              };
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggleModule(m)}
                  style={{
                    padding: '8px 16px',
                    fontSize: '0.83rem',
                    fontWeight: 'bold',
                    background: 'rgba(63, 185, 80, 0.15)',
                    color: '#3fb950',
                    border: '1px solid rgba(63, 185, 80, 0.4)',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span style={{ fontSize: '1rem', fontWeight: 800 }}>+</span> {labelMap[m] || m}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Add Module Modal - Ultra Premium Studio UI */}
      {showAddModuleModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(4, 7, 13, 0.85)',
            backdropFilter: 'blur(16px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px',
          }}
          onClick={() => setShowAddModuleModal(false)}
        >
          <div
            style={{
              background: 'rgba(13, 17, 23, 0.96)',
              backdropFilter: 'blur(24px)',
              border: '1px solid rgba(0, 195, 255, 0.35)',
              borderRadius: '20px',
              maxWidth: '720px',
              width: '100%',
              maxHeight: '88vh',
              overflowY: 'auto',
              padding: '28px',
              boxShadow: '0 25px 60px rgba(0, 0, 0, 0.85), 0 0 35px rgba(0, 195, 255, 0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#00c3ff', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  ⚡ MODÜLER PANO STÜDYOSU
                </span>
                <h2 style={{ margin: '4px 0 0', fontSize: '1.4rem', fontWeight: 800, background: 'linear-gradient(135deg, #ffffff 0%, #00c3ff 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                  Panoya Modül veya Ekran Ekle
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModuleModal(false)}
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-muted)',
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  fontSize: '1.2rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease',
                }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)', margin: '-10px 0 20px', lineHeight: 1.5 }}>
              Pano çalışma alanınızı kişiselleştirin. Aşağıdaki kategorilerden modülleri panonuza tek tıkla ekleyebilir veya özel sembol izleme kartı oluşturabilirsiniz.
            </p>

            {/* Global Live Module Search Input Bar */}
            <div style={{ position: 'relative', marginBottom: '22px' }}>
              <input
                type="text"
                placeholder="🔍 Modüllerde veya Göstergelerde Canlı Ara... (Örn: Kripto, Altın, THY, Bilanço, RSI, KAP, Fon)"
                value={moduleSearchQuery}
                onChange={(e) => setModuleSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px 16px 12px 42px',
                  borderRadius: '12px',
                  background: 'rgba(0, 0, 0, 0.45)',
                  border: '1px solid rgba(0, 195, 255, 0.35)',
                  color: '#ffffff',
                  fontSize: '0.88rem',
                  outline: 'none',
                  boxShadow: '0 0 15px rgba(0, 195, 255, 0.1)',
                  transition: 'all 0.2s ease',
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = '#00c3ff';
                  e.target.style.boxShadow = '0 0 25px rgba(0, 195, 255, 0.25)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'rgba(0, 195, 255, 0.35)';
                  e.target.style.boxShadow = '0 0 15px rgba(0, 195, 255, 0.1)';
                }}
              />
              <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '1.1rem', color: '#00c3ff' }}>
                🔍
              </span>
              {moduleSearchQuery && (
                <button
                  type="button"
                  onClick={() => setModuleSearchQuery('')}
                  style={{
                    position: 'absolute',
                    right: '14px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    fontSize: '0.85rem'
                  }}
                >
                  ✕ Temizle
                </button>
              )}
            </div>

            {/* Category Groups */}
            {[
              {
                title: '🪙 Canlı Piyasa & Makro Göstergeler',
                badgeColor: '#f59e0b',
                modules: ['crypto_panel', 'commodities_panel', 'funds_panel', 'bulletin'],
              },
              {
                title: '📈 Hisse & Performans Analizi',
                badgeColor: '#10b981',
                modules: ['gainers', 'losers', 'comparative_chart', 'model_portfolio'],
              },
              {
                title: '🔬 Teknik, Bilanço & Duyuru Taramaları',
                badgeColor: '#00c3ff',
                modules: ['risk_watch', 'balance_analysis', 'custom_analysis', 'abnormal_movements', 'news_panel'],
              },
            ].map((group) => {
              const labelMap: Record<string, string> = {
                crypto_panel: '7/24 Kripto Piyasaları',
                commodities_panel: 'Emtia & Değerli Metaller',
                funds_panel: 'TEFAS Öne Çıkan Fonlar',
                comparative_chart: t('comparativeChart'),
                gainers: t('topGainers'),
                losers: t('topLosers'),
                risk_watch: t('riskWatch'),
                bulletin: t('marketBulletin'),
                model_portfolio: t('modelPortfolio'),
                balance_analysis: t('balanceAnalysis'),
                custom_analysis: t('customAnalysis'),
                abnormal_movements: t('specialCases'),
                news_panel: t('kapSpkBulletins'),
              };
              const MODULE_METADATA: Record<string, { icon: string; desc: string; color: string }> = {
                crypto_panel: { icon: '🪙', desc: 'Bitcoin, Ethereum 7/24 canlı kurlar', color: '#f59e0b' },
                commodities_panel: { icon: '🛢️', desc: 'Gram & Ons Altın, Petrol, Gümüş', color: '#d97706' },
                funds_panel: { icon: '🧺', desc: 'TEFAS Yıllık performans fonları', color: '#10b981' },
                bulletin: { icon: '📰', desc: 'Günün piyasa özeti ve lider hisseleri', color: '#00c3ff' },
                gainers: { icon: '🚀', desc: 'BİST en çok kazandıran hisseleri', color: '#3fb950' },
                losers: { icon: '📉', desc: 'BİST en çok kaybettiren hisseleri', color: '#f85149' },
                comparative_chart: { icon: '📊', desc: 'BİST100 & Emtia kıyaslama grafiği', color: '#8b5cf6' },
                model_portfolio: { icon: '💼', desc: 'Takip listeniz ve kar/zarar hesabı', color: '#3b82f6' },
                risk_watch: { icon: '🛡️', desc: 'Aşırı satım (RSI < 30) risk izleme', color: '#f97316' },
                balance_analysis: { icon: '⚖️', desc: 'ROE, ROA, F/K temel rasyo taraması', color: '#6366f1' },
                custom_analysis: { icon: '🔍', desc: 'Kombine teknik gösterge filtreleri', color: '#06b6d4' },
                abnormal_movements: { icon: '⚡', desc: 'Tavan/taban ve sıra dışı hacimler', color: '#eab308' },
                news_panel: { icon: '📡', desc: 'KAP duyuruları ve SPK bültenleri', color: '#a855f7' },
              };

              const filteredModules = group.modules.filter((m) => {
                if (!moduleSearchQuery.trim()) return true;
                const q = moduleSearchQuery.toLowerCase().trim();
                const label = (labelMap[m] || m).toLowerCase();
                const meta = MODULE_METADATA[m];
                const desc = meta ? meta.desc.toLowerCase() : '';
                return label.includes(q) || desc.includes(q) || m.toLowerCase().includes(q);
              });

              if (filteredModules.length === 0) return null;

              return (
                <div key={group.title} style={{ marginBottom: '26px' }}>
                  <h4 style={{ margin: '0 0 14px', fontSize: '0.95rem', fontWeight: 800, color: group.badgeColor, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {group.title}
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: '12px' }}>
                    {filteredModules.map((m) => {
                      const active = (visibleModules || []).includes(m);
                      const meta = MODULE_METADATA[m] || { icon: '📦', desc: 'Görüntüleme modülü', color: '#00c3ff' };

                      return (
                        <div
                          key={m}
                          className="studio-module-card"
                          style={{
                            padding: '14px 16px',
                            borderRadius: '14px',
                            background: active ? 'rgba(0, 195, 255, 0.07)' : 'rgba(255, 255, 255, 0.025)',
                            border: active ? '1px solid rgba(0, 195, 255, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                            cursor: 'pointer',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'translateY(-4px) scale(1.015)';
                            e.currentTarget.style.borderColor = active ? '#00c3ff' : meta.color;
                            e.currentTarget.style.boxShadow = `0 10px 30px rgba(0, 0, 0, 0.4), 0 0 20px ${meta.color}40`;
                            e.currentTarget.style.background = active ? 'rgba(0, 195, 255, 0.12)' : 'rgba(255, 255, 255, 0.05)';
                            const iconEl = e.currentTarget.querySelector('.module-icon-badge') as HTMLElement;
                            if (iconEl) {
                              iconEl.style.transform = 'scale(1.15) rotate(6deg)';
                              iconEl.style.boxShadow = `0 0 16px ${meta.color}80`;
                            }
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'none';
                            e.currentTarget.style.borderColor = active ? 'rgba(0, 195, 255, 0.4)' : 'rgba(255, 255, 255, 0.08)';
                            e.currentTarget.style.boxShadow = 'none';
                            e.currentTarget.style.background = active ? 'rgba(0, 195, 255, 0.07)' : 'rgba(255, 255, 255, 0.025)';
                            const iconEl = e.currentTarget.querySelector('.module-icon-badge') as HTMLElement;
                            if (iconEl) {
                              iconEl.style.transform = 'none';
                              iconEl.style.boxShadow = 'none';
                            }
                          }}
                          onClick={() => {
                            toggleModule(m);
                            if (!active) setShowAddModuleModal(false);
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            {/* Glassmorphic Icon Badge */}
                            <div
                              className="module-icon-badge"
                              style={{
                                width: '42px',
                                height: '42px',
                                borderRadius: '10px',
                                background: `${meta.color}18`,
                                border: `1px solid ${meta.color}45`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '1.25rem',
                                transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                                flexShrink: 0,
                              }}
                            >
                              {meta.icon}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <span style={{ fontSize: '0.9rem', fontWeight: 800, color: active ? '#00c3ff' : '#ffffff' }}>
                                {labelMap[m] || m}
                              </span>
                              <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                                {meta.desc}
                              </span>
                              <span style={{ fontSize: '0.7rem', color: active ? '#3fb950' : 'var(--text-muted)', fontWeight: 'bold', marginTop: '2px' }}>
                                {active ? '✓ Panoda Aktif' : '• Panoya Eklenebilir'}
                              </span>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleModule(m);
                              if (!active) setShowAddModuleModal(false);
                            }}
                            style={{
                              padding: '7px 14px',
                              fontSize: '0.78rem',
                              fontWeight: 800,
                              background: active ? 'rgba(248, 81, 73, 0.18)' : `linear-gradient(135deg, ${meta.color} 0%, #00c3ff 100%)`,
                              color: active ? '#f85149' : '#0d1117',
                              border: active ? '1px solid rgba(248, 81, 73, 0.4)' : 'none',
                              borderRadius: '8px',
                              cursor: 'pointer',
                              transition: 'all 0.18s ease',
                              boxShadow: active ? 'none' : `0 0 14px ${meta.color}50`,
                              flexShrink: 0,
                              marginLeft: '12px',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.transform = 'scale(1.05)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.transform = 'none';
                            }}
                          >
                            {active ? 'Kaldır' : '+ Ekle'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Custom Ticker Widget Inserter */}
            <div style={{ padding: '20px', background: 'rgba(0, 195, 255, 0.04)', border: '1px dashed rgba(0, 195, 255, 0.4)', borderRadius: '16px', marginTop: '10px' }}>
              <h4 style={{ margin: '0 0 6px', fontSize: '0.95rem', fontWeight: 800, color: '#00c3ff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                🎯 Özel Sembol Canlı Kartı Ekle
              </h4>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 14px' }}>
                İstediğiniz hisse senedi (THYAO, GARAN), kripto (BTC-USD, ETH-USD) veya emtia sembolünü yazarak özel canlı fiyat takip kartı açın:
              </p>

              {/* Quick Chip Suggestions */}
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', alignSelf: 'center' }}>Hızlı Seç:</span>
                {['THYAO', 'GARAN', 'BTC-USD', 'ETH-USD', 'GRAM ALTIN', 'GC=F'].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => setCustomTickerInput(chip)}
                    style={{
                      padding: '2px 8px',
                      fontSize: '0.72rem',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      color: '#00c3ff',
                      cursor: 'pointer',
                    }}
                  >
                    {chip}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <input
                    type="text"
                    placeholder="Sembol veya Şirket Adı (Örn: THY, GARAN, BTC)"
                    value={customTickerInput}
                    onChange={(e) => setCustomTickerInput(e.target.value.toUpperCase())}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(0, 195, 255, 0.3)',
                      color: '#ffffff',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.88rem',
                    }}
                  />

                  {/* Auto-Complete Live Search Dropdown */}
                  {symbolSuggestions.length > 0 && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 'calc(100% + 4px)',
                        left: 0,
                        right: 0,
                        background: 'rgba(13, 17, 23, 0.98)',
                        backdropFilter: 'blur(20px)',
                        border: '1px solid #00c3ff',
                        borderRadius: '10px',
                        maxHeight: '230px',
                        overflowY: 'auto',
                        zIndex: 100,
                        boxShadow: '0 12px 35px rgba(0,0,0,0.85), 0 0 25px rgba(0,195,255,0.3)',
                      }}
                    >
                      <div style={{ padding: '6px 12px', fontSize: '0.72rem', color: '#00c3ff', fontWeight: 800, borderBottom: '1px solid rgba(0,195,255,0.2)', background: 'rgba(0,195,255,0.08)' }}>
                        🔍 ARAMA SONUÇLARI ({symbolSuggestions.length})
                      </div>
                      {symbolSuggestions.map((item) => (
                        <div
                          key={item.ticker}
                          onClick={() => {
                            onSelectTicker(item.ticker);
                            setCustomTickerInput('');
                            setShowAddModuleModal(false);
                          }}
                          style={{
                            padding: '10px 14px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            cursor: 'pointer',
                            borderBottom: '1px solid rgba(255,255,255,0.05)',
                            transition: 'all 0.15s ease',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0, 195, 255, 0.18)')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <strong style={{ color: '#00c3ff', fontFamily: 'var(--font-mono)', fontSize: '0.92rem' }}>{item.ticker}</strong>
                            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{item.name}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#ffffff' }}>
                              ₺{(item.price ?? 0).toFixed(2)}
                            </span>
                            <span style={{ fontSize: '0.78rem', color: (item.change_pct ?? 0) >= 0 ? '#3fb950' : '#f85149', fontWeight: 'bold' }}>
                              {(item.change_pct ?? 0) >= 0 ? '+' : ''}{(item.change_pct ?? 0).toFixed(2)}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (customTickerInput.trim()) {
                      onSelectTicker(customTickerInput.trim());
                      setCustomTickerInput('');
                      setShowAddModuleModal(false);
                    }
                  }}
                  style={{
                    padding: '10px 20px',
                    fontSize: '0.85rem',
                    fontWeight: 800,
                    background: 'linear-gradient(135deg, #00c3ff 0%, #0077ff 100%)',
                    color: '#0d1117',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    boxShadow: '0 0 15px rgba(0, 195, 255, 0.4)',
                  }}
                >
                  + Canlı Karta Git
                </button>
              </div>
            </div>
          </div>
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
                  let list = [...moverEquities];
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
                          {row.ticker}{row.index_memberships && row.index_memberships.includes('BIST HALKA ARZ') && <span style={{ marginLeft: '6px', fontSize: '0.58rem', color: '#d2a8ff' }}>IPO</span>}
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
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onShowAll: (timeframe: Timeframe) => void;
}

type Timeframe = '1d' | '1w' | '1m' | '6m' | '1y';

function EquityTable({ title, type, equities, onSelectTicker, isEditing, onClose, onMoveUp, onMoveDown, onShowAll }: EquityTableProps) {
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
        <div style={{ position: 'absolute', top: '10px', right: '10px', display: 'flex', gap: '4px', zIndex: 10 }}>
          {onMoveUp && <button type="button" onClick={onMoveUp} title="Yukarı Taşı" style={{ padding: '2px 6px', fontSize: '0.72rem', background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', cursor: 'pointer' }}>⬆️</button>}
          {onMoveDown && <button type="button" onClick={onMoveDown} title="Aşağı Taşı" style={{ padding: '2px 6px', fontSize: '0.72rem', background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', cursor: 'pointer' }}>⬇️</button>}
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '2px 6px',
              fontSize: '0.75rem',
              background: 'rgba(248,81,73,0.2)',
              border: '1px solid #f85149',
              borderRadius: '4px',
              color: '#f85149',
              cursor: 'pointer'
            }}
          >
            ×
          </button>
        </div>
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
                  title={val === '1d' ? t('periodDaily') : val === '1w' ? t('periodWeekly') : val === '1m' ? t('periodMonthly') : val === '6m' ? t('period6m') : t('periodYearly')}
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
