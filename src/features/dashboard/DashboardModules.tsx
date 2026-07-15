import { useMemo, useState } from 'react';
import type React from 'react';
import { useTranslation } from '../../api/i18n';
import { syncData, updateBistIndices, getBistIndices } from '../../api/tauriClient';
import { useEffect } from 'react';
import type { DashboardSnapshot, IndexConstituent } from '../../types';
import { useWatchlist } from '../../hooks/useWatchlist';
import MarketHeatmap from './MarketHeatmap';

interface ModuleProps {
  snapshot: DashboardSnapshot;
  onSelectTicker: (ticker: string) => void;
  isEditing: boolean;
  onClose: () => void;
}

function ModuleFrame({
  title,
  subtitle,
  isEditing,
  onClose,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  isEditing: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel dashboard-module ${className}`}>
      {isEditing && <button type="button" className="module-close" onClick={onClose}>×</button>}
      <div className="module-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <span>{subtitle}</span>}
        </div>
      </div>
      {children}
    </section>
  );
}

function metric(snapshot: DashboardSnapshot, symbol: string) {
  return (snapshot.market_metrics || []).find(item => item.symbol === symbol);
}

function generatedDate(value: string, locale: string) {
  const timestamp = value.startsWith('unix:') ? Number(value.slice(5)) * 1000 : Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp));
}

export function MarketBulletin({ snapshot, onSelectTicker, isEditing, onClose }: ModuleProps) {
  const { t, lang } = useTranslation();
  const [filter, setFilter] = useState<'ALL' | 'BIST30' | 'BIST50' | 'BIST100' | 'IPO' | 'COMMODITIES'>('ALL');
  const [dynamicIndices, setDynamicIndices] = useState<Record<string, IndexConstituent[]>>({});

  useEffect(() => {
    getBistIndices().then(([indices]) => setDynamicIndices(indices)).catch(console.error);
  }, []);

  const filteredEquities = useMemo(() => {
    let allowedTickers: Set<string> | null = null;
    if (filter === 'BIST30' && dynamicIndices['XU030']) {
      allowedTickers = new Set(dynamicIndices['XU030'].map(c => c.ticker));
    } else if (filter === 'BIST50' && dynamicIndices['XU050']) {
      allowedTickers = new Set(dynamicIndices['XU050'].map(c => c.ticker));
    } else if (filter === 'BIST100' && dynamicIndices['XU100']) {
      allowedTickers = new Set(dynamicIndices['XU100'].map(c => c.ticker));
    }

    if (allowedTickers) {
      return (snapshot.equities || []).filter(row => allowedTickers!.has(row.ticker));
    }
    
    // Fallbacks to index_memberships string
    if (filter === 'BIST30') {
      return (snapshot.equities || []).filter(row => row.index_memberships && row.index_memberships.includes('BIST 30'));
    }
    if (filter === 'BIST50') {
      return (snapshot.equities || []).filter(row => row.index_memberships && row.index_memberships.includes('BIST 50'));
    }
    if (filter === 'BIST100') {
      return (snapshot.equities || []).filter(row => row.index_memberships && row.index_memberships.includes('BIST 100'));
    }
    if (filter === 'IPO') {
      return (snapshot.equities || []).filter(row => row.index_memberships && row.index_memberships.includes('BIST HALKA ARZ'));
    }
    if (filter === 'COMMODITIES') {
      return (snapshot.equities || []).filter(row => row.index_memberships && row.index_memberships.includes('Emtialar'));
    }
    return snapshot.equities || [];
  }, [snapshot.equities, filter, dynamicIndices]);

  const gainers = useMemo(() => [...filteredEquities].sort((a, b) => b.change_pct - a.change_pct), [filteredEquities]);
  const top = gainers[0];
  const bottom = gainers[gainers.length - 1];
  const positive = useMemo(() => filteredEquities.filter(row => row.change_pct > 0).length, [filteredEquities]);
  const negative = useMemo(() => filteredEquities.filter(row => row.change_pct < 0).length, [filteredEquities]);
  const oversold = useMemo(() => filteredEquities.filter(row => row.rsi < 30).length, [filteredEquities]);
  const breadth = filteredEquities.length ? positive / filteredEquities.length : 0;
  const tone = breadth >= 0.62 ? t('bulletinPositive') : breadth <= 0.38 ? t('bulletinNegative') : t('bulletinMixed');
  const bist100 = metric(snapshot, 'BIST 100');
  const ipo = metric(snapshot, 'BIST HALKA ARZ');

  return (
    <ModuleFrame
      title={t('marketBulletin')}
      subtitle={`${generatedDate(snapshot.generated_at, lang === 'tr' ? 'tr-TR' : 'en-US')} · ${tone}`}
      isEditing={isEditing}
      onClose={onClose}
      className="bulletin-module"
    >
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
        {(['ALL', 'BIST30', 'BIST50', 'BIST100', 'IPO', 'COMMODITIES'] as const).map(f => {
          const active = filter === f;
          const labelMap = {
            ALL: t('allBist'),
            BIST30: 'BIST 30',
            BIST50: 'BIST 50',
            BIST100: 'BIST 100',
            IPO: t('ipoIndex'),
            COMMODITIES: t('filter_commodities') || 'Emtialar'
          };
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              style={{
                padding: '4px 8px',
                fontSize: '0.72rem',
                background: active ? 'var(--accent-primary)' : 'var(--bg-panel)',
                color: active ? '#000000' : 'var(--text-muted)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: active ? 'bold' : 'normal',
                transition: 'all 0.15s ease'
              }}
            >
              {labelMap[f]}
            </button>
          );
        })}
        <button
          type="button"
          onClick={async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.innerText = "Güncelleniyor...";
            try {
              await updateBistIndices();
              await syncData('BIST_INDICES');
              
              const [indices] = await getBistIndices();
              setDynamicIndices(indices);
              window.dispatchEvent(new Event('fraude-sync-completed'));
              
              btn.innerText = "Güncellendi!";
              setTimeout(() => { btn.innerText = t('refreshIndices') || "Endeksleri Güncelle"; btn.disabled = false; }, 2000);
            } catch (err) {
              btn.innerText = "Hata!";
              setTimeout(() => { btn.innerText = t('refreshIndices') || "Endeksleri Güncelle"; btn.disabled = false; }, 2000);
            }
          }}
          style={{
            padding: '4px 8px',
            fontSize: '0.72rem',
            background: 'var(--bg-panel)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            cursor: 'pointer',
            marginLeft: 'auto'
          }}
        >
          {t('refreshIndices') || "Endeksleri Güncelle"}
        </button>
      </div>
      <div className="bulletin-grid">
        <div className="bulletin-hero">
          <span>{t('marketBreadth')}</span>
          <strong>{positive} / {filteredEquities.length}</strong>
          <em>{t('advancers')} {positive} · {t('decliners')} {negative}</em>
        </div>
        <div className="bulletin-stat">
          <span>BIST 100</span>
          <strong>{bist100?.value ?? '—'}</strong>
          <em className={bist100?.positive ? 'positive' : 'negative'}>{bist100?.change ?? '—'}</em>
        </div>
        <div className="bulletin-stat">
          <span>{t('ipoIndex')}</span>
          <strong>{ipo?.value ?? '—'}</strong>
          <em className={ipo?.positive ? 'positive' : 'negative'}>{ipo?.change ?? '—'}</em>
        </div>
        <button type="button" className="bulletin-ticker" onClick={() => top && onSelectTicker(top.ticker)}>
          <span>{t('leader')}</span>
          <strong>{top?.ticker ?? '—'}</strong>
          <em className="positive">{top ? `+${top.change_pct.toFixed(2)}%` : '—'}</em>
        </button>
        <button type="button" className="bulletin-ticker" onClick={() => bottom && onSelectTicker(bottom.ticker)}>
          <span>{t('laggard')}</span>
          <strong>{bottom?.ticker ?? '—'}</strong>
          <em className="negative">{bottom ? `${bottom.change_pct.toFixed(2)}%` : '—'}</em>
        </button>
        <div className="bulletin-stat">
          <span>{t('oversoldCount')}</span>
          <strong>{oversold}</strong>
          <em style={{ textTransform: 'none' }}>RSI &lt; 30</em>
        </div>
      </div>
      <div style={{ marginTop: '16px' }}>
        <h3 style={{ fontSize: '0.85rem', marginBottom: '8px', color: 'var(--text-muted)' }}>{t('marketHeatmap') || 'Piyasa Isı Haritası'}</h3>
        <MarketHeatmap data={filteredEquities} onSelect={onSelectTicker} height={260} />
      </div>
    </ModuleFrame>
  );
}

export function AbnormalMovements({ snapshot, onSelectTicker, isEditing, onClose }: ModuleProps) {
  const { t } = useTranslation();
  
  const rows = useMemo(() => {
    return (snapshot.equities || [])
      .filter(row => Math.abs(row.change_pct) >= 11.0)
      .sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct));
  }, [snapshot.equities]);

  return (
    <ModuleFrame 
      title="Olağandışı Fiyat Hareketleri" 
      subtitle="BIST günlük limitlerinin (±%10) üzerindeki potansiyel bedelsiz, temettü, yeni halka arz veya veri kayması durumları" 
      isEditing={isEditing} 
      onClose={onClose}
    >
      <div className="table-scroll">
        {rows.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px 0', textAlign: 'center', opacity: 0.7 }}>
            Şu an için olağandışı bir fiyat hareketi (±%11 üzeri) tespit edilmedi.
          </div>
        ) : (
          <table>
            <thead><tr><th>{t('ticker')}</th><th>Fiyat</th><th>Değişim</th><th>RSI</th><th>Durum İhtimali</th></tr></thead>
            <tbody>{rows.map(row => {
              let situation = '';
              let isHalkaArz = row.index_memberships && row.index_memberships.includes('BIST HALKA ARZ');
            if (isHalkaArz) {
                situation = 'Yeni Halka Arz / Tavan Serisi';
              } else if (row.price < 50 && row.change_pct < -20) {
                situation = 'Bedelli / Bedelsiz Bölünme (veya Temettü)';
              } else if (row.change_pct > 20) {
                situation = 'Bölünme (Veri Gecikmesi) / Özel Emir';
              } else {
                situation = 'Serbest Marj / Otorite Kararı / Hatalı Veri';
              }
              return (
                <tr key={row.ticker} className="clickable-row" onClick={() => onSelectTicker(row.ticker)}>
                  <td>
                    <strong>{row.ticker}</strong> 
                    {row.index_memberships && row.index_memberships.includes('BIST HALKA ARZ') && <span className="tag">IPO</span>}
                    {row.index_changes && (row.index_changes.added.length > 0 || row.index_changes.removed.length > 0) && (
                      <span 
                        title={`Değişiklik Tarihi: ${new Date(row.index_changes.timestamp * 1000).toLocaleDateString()}\nEklendiği Endeksler: ${row.index_changes.added.join(', ')}\nÇıkarıldığı Endeksler: ${row.index_changes.removed.join(', ')}`}
                        style={{ marginLeft: '4px', color: 'var(--accent-primary)', fontWeight: 'bold', cursor: 'help' }}
                      >
                        !
                      </span>
                    )}
                  </td>
                  <td>{row.price.toFixed(2)}</td>
                  <td className={row.change_pct >= 0 ? 'positive' : 'negative'}>
                    {row.change_pct >= 0 ? '+' : ''}{row.change_pct.toFixed(2)}%
                  </td>
                  <td>{row.rsi.toFixed(1)}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{situation}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>
    </ModuleFrame>
  );
}

export function ModelPortfolio({ snapshot, onSelectTicker, isEditing, onClose }: ModuleProps) {
  const { t } = useTranslation();
  const { watchlist, toggleWatchlist, updateWatchlistItem } = useWatchlist();

  const rows = useMemo(() => {
    return (snapshot.equities || [])
      .filter(row => watchlist.some(item => item.ticker === row.ticker))
      .sort((a, b) => a.ticker.localeCompare(b.ticker))
      .map(row => {
        const item = watchlist.find(w => w.ticker === row.ticker);
        const addedPrice = item?.addedPrice || 0;
        const quantity = item?.quantity && item.quantity > 0 ? item.quantity : null;
        const totalReturn = addedPrice > 0 ? ((row.price - addedPrice) / addedPrice) * 100 : 0;
        const marketValue = quantity !== null ? quantity * row.price : null;
        const costValue = quantity !== null && addedPrice > 0 ? quantity * addedPrice : null;
        return { ...row, addedPrice, quantity, totalReturn, marketValue, costValue };
      });
  }, [snapshot.equities, watchlist]);

  const totals = useMemo(() => {
    const positioned = rows.filter(r => r.marketValue !== null);
    const marketValue = positioned.reduce((sum, r) => sum + (r.marketValue ?? 0), 0);
    const costValue = positioned.reduce((sum, r) => sum + (r.costValue ?? 0), 0);
    const validRows = rows.filter(r => r.addedPrice > 0);
    const equalWeightReturn = validRows.length > 0
      ? validRows.reduce((sum, r) => sum + r.totalReturn, 0) / validRows.length
      : 0;
    return {
      marketValue,
      profit: marketValue - costValue,
      weightedReturn: costValue > 0 ? ((marketValue - costValue) / costValue) * 100 : null,
      equalWeightReturn,
      hasPositions: positioned.length > 0 && costValue > 0,
    };
  }, [rows]);

  const formatLira = (value: number) =>
    new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(value);

  const numberInputStyle: React.CSSProperties = {
    width: '72px', padding: '2px 4px', fontSize: '0.75rem', textAlign: 'right',
    fontFamily: 'var(--font-mono)', background: 'var(--bg-main)', color: 'var(--text-primary)',
    border: '1px solid var(--border-color)', borderRadius: '4px',
  };

  return (
    <ModuleFrame title={t('modelPortfolio') || "Takip Listem"} subtitle={t('modelPortfolioSubtitle') || "Kişisel portföyünüzdeki hisseler"} isEditing={isEditing} onClose={onClose}>
      <div className="table-scroll">
        {rows.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px 0', textAlign: 'center', opacity: 0.7 }}>
            Listenizde hisse bulunmuyor. Bir hisse sayfasına gidip "⭐ Portföye Ekle" tuşuna basabilirsiniz.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', padding: '0 8px 12px 8px', borderBottom: '1px solid var(--border-color)', marginBottom: '8px' }}>
              {totals.hasPositions ? (
                <>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    Portföy Değeri: <strong style={{ color: 'var(--text-primary)' }}>₺{formatLira(totals.marketValue)}</strong>
                  </span>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    K/Z:{' '}
                    <strong className={totals.profit >= 0 ? 'positive' : 'negative'}>
                      {totals.profit >= 0 ? '+' : '−'}₺{formatLira(Math.abs(totals.profit))}
                      {totals.weightedReturn !== null && ` (${totals.weightedReturn >= 0 ? '+' : ''}${totals.weightedReturn.toFixed(2)}%)`}
                    </strong>
                  </span>
                </>
              ) : (
                <>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Toplam Portföy Getirisi (Eşit Ağırlıklı):</span>
                  <strong className={totals.equalWeightReturn >= 0 ? 'positive' : 'negative'} style={{ fontSize: '1rem' }}>
                    {totals.equalWeightReturn >= 0 ? '+' : ''}{totals.equalWeightReturn.toFixed(2)}%
                  </strong>
                </>
              )}
            </div>
            <table>
              <thead><tr><th>{t('ticker')}</th><th>Adet</th><th>Maliyet</th><th>Fiyat</th><th>Fark</th><th>Getiri</th><th>Değer</th><th>Ağırlık</th><th>İşlem</th></tr></thead>
              <tbody>{rows.map(row => {
                const weight = totals.marketValue > 0 && row.marketValue !== null
                  ? (row.marketValue / totals.marketValue) * 100
                  : null;
                return (
                <tr key={row.ticker} className="clickable-row">
                  <td onClick={() => onSelectTicker(row.ticker)}>
                    <strong>{row.ticker}</strong>
                    {row.index_changes && (row.index_changes.added.length > 0 || row.index_changes.removed.length > 0) && (
                      <span
                        title={`Değişiklik Tarihi: ${new Date(row.index_changes.timestamp * 1000).toLocaleDateString()}\nEklendiği Endeksler: ${row.index_changes.added.join(', ')}\nÇıkarıldığı Endeksler: ${row.index_changes.removed.join(', ')}`}
                        style={{ marginLeft: '4px', color: 'var(--accent-primary)', fontWeight: 'bold', cursor: 'help' }}
                      >
                        !
                      </span>
                    )}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="number"
                      min="0"
                      style={numberInputStyle}
                      value={row.quantity ?? ''}
                      placeholder="—"
                      title="Adet (pozisyon büyüklüğü)"
                      onChange={(e) => {
                        const parsed = Number(e.target.value);
                        updateWatchlistItem(row.ticker, { quantity: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined });
                      }}
                    />
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      style={numberInputStyle}
                      value={row.addedPrice > 0 ? row.addedPrice : ''}
                      placeholder="—"
                      title="Hisse başına maliyet"
                      onChange={(e) => {
                        const parsed = Number(e.target.value);
                        updateWatchlistItem(row.ticker, { addedPrice: Number.isFinite(parsed) && parsed > 0 ? parsed : 0 });
                      }}
                    />
                  </td>
                  <td onClick={() => onSelectTicker(row.ticker)}>{row.price.toFixed(2)}</td>
                  <td onClick={() => onSelectTicker(row.ticker)} className={row.change_pct >= 0 ? 'positive' : 'negative'}>
                    {row.change_pct >= 0 ? '+' : ''}{row.change_pct.toFixed(2)}%
                  </td>
                  <td onClick={() => onSelectTicker(row.ticker)} className={row.totalReturn >= 0 ? 'positive' : 'negative'} style={{ fontWeight: 'bold' }}>
                    {row.addedPrice > 0 ? `${row.totalReturn >= 0 ? '+' : ''}${row.totalReturn.toFixed(2)}%` : '—'}
                  </td>
                  <td onClick={() => onSelectTicker(row.ticker)}>
                    {row.marketValue !== null ? `₺${formatLira(row.marketValue)}` : '—'}
                  </td>
                  <td onClick={() => onSelectTicker(row.ticker)}>
                    {weight !== null ? `%${weight.toFixed(1)}` : '—'}
                  </td>
                  <td>
                    <button
                      className="small-button"
                      onClick={(e) => { e.stopPropagation(); toggleWatchlist(row.ticker); }}
                      style={{ padding: '2px 6px', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
                    >
                      Çıkar
                    </button>
                  </td>
                </tr>
                );
              })}</tbody>
            </table>
          </>
        )}
      </div>
      <p className="module-disclaimer">Adet ve maliyet girdiğiniz hisselerde portföy değeri, K/Z ve ağırlık gerçek pozisyona göre; girmediklerinizde getiri eklenme fiyatına göre eşit ağırlıklı hesaplanır.</p>
    </ModuleFrame>
  );
}

type BalanceMetric = 'roe' | 'roa' | 'net_margin' | 'sales_growth' | 'profit_growth' | 'pe' | 'pb';

export function BalanceAnalysis({ snapshot, onSelectTicker, isEditing, onClose }: ModuleProps) {
  const { t } = useTranslation();
  const [sortBy, setSortBy] = useState<BalanceMetric>('roe');
  const ascending = sortBy === 'pe' || sortBy === 'pb';
  const rows = useMemo(() => (snapshot.equities || [])
    .filter(row => row.fundamentals_available && row[sortBy] !== null)
    .sort((a, b) => {
      const left = a[sortBy] ?? 0;
      const right = b[sortBy] ?? 0;
      return ascending ? left - right : right - left;
    }).slice(0, 10), [snapshot.equities, sortBy, ascending]);

  return (
    <ModuleFrame title={t('balanceAnalysis')} subtitle={t('balanceAnalysisSubtitle')} isEditing={isEditing} onClose={onClose}>
      <div className="module-toolbar">
        <label>{t('rankBy')}</label>
        <select value={sortBy} onChange={event => setSortBy(event.target.value as BalanceMetric)}>
          <option value="roe">ROE</option><option value="roa">ROA</option>
          <option value="net_margin">{t('netMargin')}</option>
          <option value="sales_growth">{t('salesGrowth')}</option>
          <option value="profit_growth">{t('profitGrowth')}</option>
          <option value="pe">F/K</option><option value="pb">PD/DD</option>
        </select>
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr><th>{t('ticker')}</th><th>F/K</th><th>PD/DD</th><th>ROE</th><th>ROA</th><th>{t('netMargin')}</th><th>{t('salesGrowth')}</th></tr></thead>
          <tbody>{rows.map(row => (
            <tr key={row.ticker} className="clickable-row" onClick={() => onSelectTicker(row.ticker)}>
              <td>{row.ticker}</td><td>{row.pe?.toFixed(1) ?? '—'}</td><td>{row.pb?.toFixed(1) ?? '—'}</td>
              <td>{row.roe !== null ? `${row.roe.toFixed(1)}%` : '—'}</td><td>{row.roa !== null ? `${row.roa.toFixed(1)}%` : '—'}</td>
              <td>{row.net_margin !== null ? `${row.net_margin.toFixed(1)}%` : '—'}</td>
              <td>{row.sales_growth !== null ? `${row.sales_growth >= 0 ? '+' : ''}${row.sales_growth.toFixed(1)}%` : '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </ModuleFrame>
  );
}

interface Filters {
  universe: 'all' | 'ipo' | 'fundamentals';
  maxPe: string;
  maxPb: string;
  minRoe: string;
  minRsi: string;
  maxRsi: string;
  minChange: string;
}

const initialFilters: Filters = { universe: 'all', maxPe: '', maxPb: '', minRoe: '', minRsi: '', maxRsi: '', minChange: '' };
const parsed = (value: string) => value.trim() === '' ? null : Number(value);

export function CustomAnalysis({ snapshot, onSelectTicker, isEditing, onClose }: ModuleProps) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [sortBy, setSortBy] = useState<'change_pct' | 'roe' | 'pe' | 'rsi'>('change_pct');
  const set = (key: keyof Filters, value: string) => setFilters(current => ({ ...current, [key]: value }));
  const rows = useMemo(() => (snapshot.equities || []).filter(row => {
    if (filters.universe === 'ipo' && !(row.index_memberships && row.index_memberships.includes('BIST HALKA ARZ'))) return false;
    if (filters.universe === 'fundamentals' && !row.fundamentals_available) return false;
    const maxPe = parsed(filters.maxPe); if (maxPe !== null && (row.pe === null || row.pe > maxPe)) return false;
    const maxPb = parsed(filters.maxPb); if (maxPb !== null && (row.pb === null || row.pb > maxPb)) return false;
    const minRoe = parsed(filters.minRoe); if (minRoe !== null && (row.roe === null || row.roe < minRoe)) return false;
    const minRsi = parsed(filters.minRsi); if (minRsi !== null && row.rsi < minRsi) return false;
    const maxRsi = parsed(filters.maxRsi); if (maxRsi !== null && row.rsi > maxRsi) return false;
    const minChange = parsed(filters.minChange); if (minChange !== null && row.change_pct < minChange) return false;
    return true;
  }).sort((a, b) => {
    const left = a[sortBy];
    const right = b[sortBy];
    if (left === null) return 1;
    if (right === null) return -1;
    return sortBy === 'pe' ? left - right : right - left;
  }), [snapshot.equities, filters, sortBy]);

  return (
    <ModuleFrame title={t('customAnalysis')} subtitle={`${rows.length} ${t('matchingStocks')}`} isEditing={isEditing} onClose={onClose}>
      <div className="analysis-filters">
        <label>{t('universe')}<select value={filters.universe} onChange={event => set('universe', event.target.value)}>
          <option value="all">{t('allBist')}</option><option value="ipo">{t('ipoIndex')}</option><option value="fundamentals">{t('fundamentalCoverage')}</option>
        </select></label>
        <label>F/K ≤<input type="number" value={filters.maxPe} onChange={event => set('maxPe', event.target.value)} /></label>
        <label>PD/DD ≤<input type="number" value={filters.maxPb} onChange={event => set('maxPb', event.target.value)} /></label>
        <label>ROE ≥<input type="number" value={filters.minRoe} onChange={event => set('minRoe', event.target.value)} /></label>
        <label>RSI ≥<input type="number" value={filters.minRsi} onChange={event => set('minRsi', event.target.value)} /></label>
        <label>RSI ≤<input type="number" value={filters.maxRsi} onChange={event => set('maxRsi', event.target.value)} /></label>
        <label>{t('change')} ≥<input type="number" value={filters.minChange} onChange={event => set('minChange', event.target.value)} /></label>
        <label>{t('sortBy')}<select value={sortBy} onChange={event => setSortBy(event.target.value as typeof sortBy)}>
          <option value="change_pct">{t('change')}</option><option value="roe">ROE</option><option value="pe">F/K</option><option value="rsi">RSI</option>
        </select></label>
        <button type="button" className="secondary-button" onClick={() => setFilters(initialFilters)}>{t('clearFilters')}</button>
      </div>
      <div className="table-scroll analysis-results">
        <table>
          <thead><tr><th>{t('ticker')}</th><th>{t('price')}</th><th>{t('change')}</th><th>F/K</th><th>PD/DD</th><th>Temettü</th><th>ROE</th><th>RSI</th></tr></thead>
          <tbody>{rows.slice(0, 20).map(row => (
            <tr key={row.ticker} className="clickable-row" onClick={() => onSelectTicker(row.ticker)}>
              <td>{row.ticker}</td><td>{row.price.toFixed(2)}</td>
              <td className={row.change_pct >= 0 ? 'positive' : 'negative'}>{row.change_pct >= 0 ? '+' : ''}{row.change_pct.toFixed(2)}%</td>
              <td>{row.pe?.toFixed(1) ?? '—'}</td><td>{row.pb?.toFixed(1) ?? '—'}</td>
              <td>{row.dividend_yield !== null ? `${row.dividend_yield.toFixed(1)}%` : '—'}</td>
              <td>{row.roe !== null ? `${row.roe.toFixed(1)}%` : '—'}</td><td>{row.rsi.toFixed(1)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </ModuleFrame>
  );
}

export function NewsAndAnnouncements({ snapshot, onSelectTicker, isEditing, onClose }: ModuleProps) {
  const [tab, setTab] = useState<'news' | 'spk'>('news');

  const categoryColor = (cat: string) => {
    if (cat.includes('Finans')) return '#00ff9d';
    if (cat.includes('Ekonomi')) return '#3b82f6';
    return 'var(--text-muted)';
  };

  return (
    <ModuleFrame 
      title="Piyasa Haberleri & SPK Bültenleri" 
      subtitle="BloombergHT ve Dünya Gazetesi'nden son finans haberleri" 
      isEditing={isEditing} 
      onClose={onClose}
    >
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button 
          type="button"
          className={tab === 'news' ? 'primary-button' : 'secondary-button'} 
          onClick={() => setTab('news')}
          style={{ fontSize: '0.8rem', padding: '6px 14px' }}
        >
          📰 Finans Haberleri
        </button>
        <button 
          type="button"
          className={tab === 'spk' ? 'primary-button' : 'secondary-button'} 
          onClick={() => setTab('spk')}
          style={{ fontSize: '0.8rem', padding: '6px 14px' }}
        >
          📋 SPK Bültenleri
        </button>
      </div>

      <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
        {tab === 'news' ? (
          snapshot.kap_announcements && snapshot.kap_announcements.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {snapshot.kap_announcements.map((item) => (
                <div 
                  key={item.id} 
                  style={{ 
                    padding: '14px 16px', 
                    background: 'var(--bg-secondary)', 
                    borderRadius: '8px', 
                    border: '1px solid var(--border-color)',
                    transition: 'border-color 0.2s ease',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-color)')}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', gap: '8px' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      {item.ticker !== 'BIST' && (
                        <span 
                          style={{ 
                            fontWeight: 'bold', 
                            color: 'var(--accent-primary)', 
                            cursor: 'pointer',
                            background: 'rgba(0, 255, 157, 0.1)',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                          }} 
                          onClick={() => onSelectTicker(item.ticker)}
                        >
                          {item.ticker}
                        </span>
                      )}
                      <span style={{ 
                        fontSize: '0.7rem', 
                        color: categoryColor(item.category),
                        background: `${categoryColor(item.category)}15`,
                        padding: '2px 6px',
                        borderRadius: '3px',
                        fontWeight: 500,
                      }}>
                        {item.category}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {item.date}
                    </span>
                  </div>
                  <div style={{ fontWeight: 600, marginBottom: '6px', fontSize: '0.9rem', lineHeight: 1.4 }}>
                    {item.title}
                  </div>
                  {item.summary && (
                    <div style={{ 
                      fontSize: '0.82rem', 
                      color: 'var(--text-muted)', 
                      marginBottom: '8px',
                      lineHeight: 1.5,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical' as const,
                      overflow: 'hidden',
                    }}>
                      {item.summary}
                    </div>
                  )}
                  <a 
                    href={item.url} 
                    target="_blank" 
                    rel="noreferrer" 
                    style={{ 
                      fontSize: '0.78rem', 
                      color: 'var(--accent-secondary)',
                      textDecoration: 'none',
                      fontWeight: 500,
                    }}
                  >
                    Haberi Oku →
                  </a>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state" style={{ padding: '24px 0', textAlign: 'center', opacity: 0.7 }}>
              Finans haberleri yükleniyor... Senkronizasyon yapınız.
            </div>
          )
        ) : (
          snapshot.spk_bulletins && snapshot.spk_bulletins.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {snapshot.spk_bulletins.map((spk) => (
                <div 
                  key={spk.url} 
                  style={{ 
                    padding: '14px 16px', 
                    background: 'var(--bg-secondary)', 
                    borderRadius: '8px', 
                    border: '1px solid var(--border-color)',
                    transition: 'border-color 0.2s ease',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#f59e0b')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-color)')}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ 
                      fontSize: '0.7rem', 
                      color: '#f59e0b',
                      background: 'rgba(245, 158, 11, 0.1)',
                      padding: '2px 8px',
                      borderRadius: '3px',
                      fontWeight: 600,
                    }}>
                      SPK Resmi Bülten
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{spk.date}</span>
                  </div>
                  <div style={{ fontWeight: 600, marginBottom: '8px', fontSize: '0.9rem' }}>
                    {spk.title}
                  </div>
                  <a 
                    href={spk.url} 
                    target="_blank" 
                    rel="noreferrer" 
                    style={{ 
                      fontSize: '0.78rem', 
                      color: '#f59e0b',
                      textDecoration: 'none',
                      fontWeight: 500,
                    }}
                  >
                    📄 PDF İndir →
                  </a>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state" style={{ padding: '24px 0', textAlign: 'center', opacity: 0.7 }}>
              SPK bültenleri yükleniyor... Senkronizasyon yapınız.
            </div>
          )
        )}
      </div>
    </ModuleFrame>
  );
}
