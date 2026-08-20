import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from '../../api/i18n';
import { getDashboardSnapshot } from '../../api/tauriClient';
import { usePortfolio, type PortfolioItem } from '../../hooks/usePortfolio';
import type { EquityRow } from '../../types';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip as ChartTooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Plus,
  Wallet,
  TrendingUp,
  BarChart3,
  PieChart as PieChartIcon,
  Trash2,
  Info,
} from 'lucide-react';
import './PortfolioView.css';

interface PortfolioViewProps {
  onSelectTicker: (ticker: string) => void;
}

const PIE_COLORS = [
  '#58a6ff', '#3fb950', '#d29922', '#f85149', '#a371f7',
  '#ff7b72', '#2f81f7', '#7ee787', '#ffa657', '#79c0ff',
  '#d2a8ff', '#f0883e', '#56d364', '#8b949e',
];

type SortKey = 'ticker' | 'shares' | 'costBasis' | 'currentPrice' | 'dailyChangePct' | 'profitLossPct' | 'marketValue' | 'weight';

export default function PortfolioView({ onSelectTicker }: PortfolioViewProps) {
  const { t } = useTranslation();
  const {
    items,
    totals,
    loading,
    hasSession,
    addPosition,
    updatePosition,
    removePosition,
  } = usePortfolio();

  const [sortKey, setSortKey] = useState<SortKey>('weight');
  const [sortAsc, setSortAsc] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [allEquities, setAllEquities] = useState<EquityRow[]>([]);

  // Load all equities for the ticker search in modal
  useEffect(() => {
    getDashboardSnapshot()
      .then(snap => { if (snap?.equities) setAllEquities(snap.equities); })
      .catch(() => {});
  }, []);

  // ── Sorted & filtered items ────────────────────────────────────────────
  const sortedItems = useMemo(() => {
    let result = [...items];
    if (filterText) {
      const q = filterText.toUpperCase();
      result = result.filter(i =>
        i.ticker.includes(q) || (i.name && i.name.toUpperCase().includes(q)),
      );
    }
    result.sort((a, b) => {
      let av: number | string = 0;
      let bv: number | string = 0;
      switch (sortKey) {
        case 'ticker': av = a.ticker; bv = b.ticker; break;
        case 'shares': av = a.shares; bv = b.shares; break;
        case 'costBasis': av = a.costBasis; bv = b.costBasis; break;
        case 'currentPrice': av = a.currentPrice ?? 0; bv = b.currentPrice ?? 0; break;
        case 'dailyChangePct': av = a.dailyChangePct ?? 0; bv = b.dailyChangePct ?? 0; break;
        case 'profitLossPct': av = a.profitLossPct ?? 0; bv = b.profitLossPct ?? 0; break;
        case 'marketValue': av = a.marketValue ?? 0; bv = b.marketValue ?? 0; break;
        case 'weight': av = a.weight ?? 0; bv = b.weight ?? 0; break;
      }
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortAsc ? cmp : -cmp;
    });
    return result;
  }, [items, sortKey, sortAsc, filterText]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === 'ticker');
    }
  };

  const sortArrow = (key: SortKey) =>
    sortKey === key ? (sortAsc ? '▲' : '▼') : '';

  // ── Pie chart data ─────────────────────────────────────────────────────
  const pieData = useMemo(() => {
    return items
      .filter(i => (i.weight ?? 0) > 0)
      .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
      .map(i => ({ name: i.ticker, value: Number((i.weight ?? 0).toFixed(1)) }));
  }, [items]);

  // ── Formatters ─────────────────────────────────────────────────────────
  const fmtLira = (v: number) =>
    new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(v);

  const fmtPrice = (v: number) =>
    new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

  const fmtPct = (v: number) =>
    `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

  if (loading) {
    return (
      <div className="portfolio-view">
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
          {t('loadingData')}
        </div>
      </div>
    );
  }

  return (
    <div className="portfolio-view">
      {/* ── Login hint ─────────────────────────────────────────────── */}
      {!hasSession && (
        <div className="portfolio-login-hint">
          <Info size={16} />
          {t('portfolioLoginHint')}
        </div>
      )}

      {/* ── Summary Cards ──────────────────────────────────────────── */}
      {items.length > 0 && (
        <div className="portfolio-summary-cards">
          <div className="portfolio-summary-card">
            <span className="card-label"><Wallet size={14} /> {t('portfolioTotalValue')}</span>
            <span className="card-value">₺{fmtLira(totals.totalValue)}</span>
          </div>
          <div className="portfolio-summary-card">
            <span className="card-label"><TrendingUp size={14} /> {t('profitLoss')}</span>
            <span className={`card-value ${totals.totalPL >= 0 ? 'positive' : 'negative'}`}>
              {totals.totalPL >= 0 ? '+' : '−'}₺{fmtLira(Math.abs(totals.totalPL))}
            </span>
            <span className={`card-sub ${totals.totalPLPct >= 0 ? 'positive' : 'negative'}`}>
              {fmtPct(totals.totalPLPct)}
            </span>
          </div>
          <div className="portfolio-summary-card">
            <span className="card-label"><BarChart3 size={14} /> {t('portfolioDailyChange')}</span>
            <span className={`card-value ${totals.dailyPL >= 0 ? 'positive' : 'negative'}`}>
              {totals.dailyPL >= 0 ? '+' : '−'}₺{fmtLira(Math.abs(totals.dailyPL))}
            </span>
            <span className={`card-sub ${totals.dailyPLPct >= 0 ? 'positive' : 'negative'}`}>
              {fmtPct(totals.dailyPLPct)}
            </span>
          </div>
          <div className="portfolio-summary-card">
            <span className="card-label"><PieChartIcon size={14} /> {t('portfolioPositionCount')}</span>
            <span className="card-value">{totals.positionCount}</span>
            <span className="card-sub" style={{ color: 'var(--text-muted)' }}>{t('portfolioPositionUnit')}</span>
          </div>
        </div>
      )}

      {/* ── Toolbar ────────────────────────────────────────────────── */}
      <div className="portfolio-toolbar">
        <input
          className="portfolio-search"
          type="text"
          placeholder={t('portfolioSearchPlaceholder')}
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
        />
        <button className="portfolio-add-btn" onClick={() => setShowAddModal(true)}>
          <Plus size={16} />
          {t('portfolioAddPosition')}
        </button>
      </div>

      {/* ── Empty state ────────────────────────────────────────────── */}
      {items.length === 0 ? (
        <div className="portfolio-empty-state">
          <div className="empty-icon">💼</div>
          <div className="empty-title">{t('portfolioNoPositionsTitle')}</div>
          <div className="empty-desc">{t('portfolioNoPositions')}</div>
          <button className="portfolio-add-btn" onClick={() => setShowAddModal(true)}>
            <Plus size={16} />
            {t('portfolioAddPosition')}
          </button>
        </div>
      ) : (
        <>
          {/* ── Holdings Table ──────────────────────────────────────── */}
          <div className="portfolio-table-wrap">
            <table className="portfolio-table">
              <thead>
                <tr>
                  <th className={sortKey === 'ticker' ? 'sorted' : ''} onClick={() => handleSort('ticker')}>
                    {t('ticker')} <span className="sort-arrow">{sortArrow('ticker')}</span>
                  </th>
                  <th className={sortKey === 'shares' ? 'sorted' : ''} onClick={() => handleSort('shares')}>
                    {t('qty')} <span className="sort-arrow">{sortArrow('shares')}</span>
                  </th>
                  <th className={sortKey === 'costBasis' ? 'sorted' : ''} onClick={() => handleSort('costBasis')}>
                    {t('cost')} <span className="sort-arrow">{sortArrow('costBasis')}</span>
                  </th>
                  <th className={sortKey === 'currentPrice' ? 'sorted' : ''} onClick={() => handleSort('currentPrice')}>
                    {t('price')} <span className="sort-arrow">{sortArrow('currentPrice')}</span>
                  </th>
                  <th className={sortKey === 'dailyChangePct' ? 'sorted' : ''} onClick={() => handleSort('dailyChangePct')}>
                    {t('portfolioDailyReturn')} <span className="sort-arrow">{sortArrow('dailyChangePct')}</span>
                  </th>
                  <th className={sortKey === 'profitLossPct' ? 'sorted' : ''} onClick={() => handleSort('profitLossPct')}>
                    {t('portfolioReturn')} <span className="sort-arrow">{sortArrow('profitLossPct')}</span>
                  </th>
                  <th className={sortKey === 'marketValue' ? 'sorted' : ''} onClick={() => handleSort('marketValue')}>
                    {t('portfolioMarketValue')} <span className="sort-arrow">{sortArrow('marketValue')}</span>
                  </th>
                  <th className={sortKey === 'weight' ? 'sorted' : ''} onClick={() => handleSort('weight')}>
                    {t('portfolioWeight')} <span className="sort-arrow">{sortArrow('weight')}</span>
                  </th>
                  <th>{t('actionLabel')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedItems.map(item => (
                  <PortfolioRow
                    key={item.id}
                    item={item}
                    onSelect={() => onSelectTicker(item.ticker)}
                    onUpdate={updatePosition}
                    onRemove={removePosition}
                    fmtPrice={fmtPrice}
                    fmtLira={fmtLira}
                    fmtPct={fmtPct}
                    t={t}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Bottom Panels: Pie + Performance ────────────────────── */}
          <div className="portfolio-bottom-panels">
            {/* Pie Chart */}
            <div className="portfolio-panel">
              <h3><PieChartIcon size={16} /> {t('portfolioAllocation')}</h3>
              {pieData.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={85}
                        innerRadius={45}
                        paddingAngle={2}
                        stroke="none"
                      >
                        {pieData.map((_, idx) => (
                          <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <ChartTooltip
                        formatter={(val: any) => [`%${Number(val ?? 0).toFixed(1)}`, '']}
                        contentStyle={{
                          background: 'var(--bg-panel)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '6px',
                          fontSize: '0.8rem',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="allocation-legend">
                    {pieData.slice(0, 8).map((d, i) => (
                      <div key={d.name} className="allocation-legend-item">
                        <div className="legend-dot" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span className="legend-ticker">{d.name}</span>
                        <span className="legend-pct">%{d.value.toFixed(1)}</span>
                      </div>
                    ))}
                    {pieData.length > 8 && (
                      <div className="allocation-legend-item" style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                        +{pieData.length - 8} {t('portfolioMorePositions')}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '24px 0', fontSize: '0.85rem' }}>
                  {t('portfolioNoPieData')}
                </div>
              )}
            </div>

            {/* Performance Summary */}
            <div className="portfolio-panel">
              <h3><TrendingUp size={16} /> {t('portfolioPerformance')}</h3>
              <PerformanceSummaryTable items={items} fmtLira={fmtLira} fmtPct={fmtPct} t={t} />
            </div>
          </div>
        </>
      )}

      <p className="portfolio-disclaimer">{t('portfolioDisclaimer')}</p>

      {/* ── Add Position Modal ──────────────────────────────────────── */}
      {showAddModal && (
        <AddPositionModal
          equities={allEquities}
          existingTickers={items.map(i => i.ticker)}
          onAdd={async (ticker, shares, cost) => {
            await addPosition(ticker, shares, cost);
            setShowAddModal(false);
          }}
          onClose={() => setShowAddModal(false)}
          t={t}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-Components
// ═══════════════════════════════════════════════════════════════════════════════

interface PortfolioRowProps {
  item: PortfolioItem;
  onSelect: () => void;
  onUpdate: (ticker: string, shares: number, costBasis: number) => Promise<void>;
  onRemove: (ticker: string) => Promise<void>;
  fmtPrice: (v: number) => string;
  fmtLira: (v: number) => string;
  fmtPct: (v: number) => string;
  t: (key: string) => string;
}

function PortfolioRow({ item, onSelect, onUpdate, onRemove, fmtPrice, fmtLira, fmtPct, t }: PortfolioRowProps) {
  const [editingShares, setEditingShares] = useState(false);
  const [editingCost, setEditingCost] = useState(false);
  const [tempShares, setTempShares] = useState(String(item.shares));
  const [tempCost, setTempCost] = useState(String(item.costBasis));

  const commitShares = () => {
    const v = parseFloat(tempShares.replace(',', '.'));
    if (Number.isFinite(v) && v > 0 && v !== item.shares) {
      void onUpdate(item.ticker, v, item.costBasis);
    }
    setEditingShares(false);
  };

  const commitCost = () => {
    const v = parseFloat(tempCost.replace(',', '.'));
    if (Number.isFinite(v) && v > 0 && v !== item.costBasis) {
      void onUpdate(item.ticker, item.shares, v);
    }
    setEditingCost(false);
  };

  return (
    <tr>
      <td className="ticker-cell" onClick={onSelect}>
        {item.ticker}
        {item.name && item.name !== item.ticker && (
          <span className="ticker-name">{item.name}</span>
        )}
      </td>
      <td className="mono" onClick={e => { e.stopPropagation(); setEditingShares(true); setTempShares(String(item.shares)); }}>
        {editingShares ? (
          <input
            className="inline-input"
            type="number"
            min="0"
            value={tempShares}
            autoFocus
            onChange={e => setTempShares(e.target.value)}
            onBlur={commitShares}
            onKeyDown={e => { if (e.key === 'Enter') commitShares(); if (e.key === 'Escape') setEditingShares(false); }}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          item.shares.toLocaleString('tr-TR')
        )}
      </td>
      <td className="mono" onClick={e => { e.stopPropagation(); setEditingCost(true); setTempCost(String(item.costBasis)); }}>
        {editingCost ? (
          <input
            className="inline-input"
            type="number"
            min="0"
            step="0.01"
            value={tempCost}
            autoFocus
            onChange={e => setTempCost(e.target.value)}
            onBlur={commitCost}
            onKeyDown={e => { if (e.key === 'Enter') commitCost(); if (e.key === 'Escape') setEditingCost(false); }}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          fmtPrice(item.costBasis)
        )}
      </td>
      <td className="mono" onClick={onSelect}>{fmtPrice(item.currentPrice ?? 0)}</td>
      <td className={`mono ${(item.dailyChangePct ?? 0) >= 0 ? 'positive' : 'negative'}`} onClick={onSelect}>
        {fmtPct(item.dailyChangePct ?? 0)}
      </td>
      <td className={`mono ${(item.profitLossPct ?? 0) >= 0 ? 'positive' : 'negative'}`} onClick={onSelect} style={{ fontWeight: 600 }}>
        {fmtPct(item.profitLossPct ?? 0)}
      </td>
      <td className="mono" onClick={onSelect}>₺{fmtLira(item.marketValue ?? 0)}</td>
      <td className="mono" onClick={onSelect}>%{(item.weight ?? 0).toFixed(1)}</td>
      <td>
        <button className="action-btn" onClick={e => { e.stopPropagation(); void onRemove(item.ticker); }} title={t('portfolioRemovePosition')}>
          <Trash2 size={13} />
        </button>
      </td>
    </tr>
  );
}

// ── Performance Summary Table ────────────────────────────────────────────────

interface PerformanceSummaryTableProps {
  items: PortfolioItem[];
  fmtLira: (v: number) => string;
  fmtPct: (v: number) => string;
  t: (key: string) => string;
}

function PerformanceSummaryTable({ items, fmtLira, fmtPct, t }: PerformanceSummaryTableProps) {
  // Top gainers/losers
  const gainers = [...items].sort((a, b) => (b.profitLossPct ?? 0) - (a.profitLossPct ?? 0)).slice(0, 3);
  const losers = [...items].sort((a, b) => (a.profitLossPct ?? 0) - (b.profitLossPct ?? 0)).slice(0, 3);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Best performers */}
      <div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '8px' }}>
          🏆 {t('portfolioBestPerformers')}
        </div>
        {gainers.map(item => (
          <div key={item.ticker} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <div>
              <span style={{ fontWeight: 700, color: 'var(--accent-primary)', marginRight: '8px' }}>{item.ticker}</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>({item.shares} lot)</span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span className="positive" style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                {fmtPct(item.profitLossPct ?? 0)}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '8px', fontFamily: 'var(--font-mono)' }}>
                {(item.profitLoss ?? 0) >= 0 ? '+' : ''}₺{fmtLira(item.profitLoss ?? 0)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Worst performers */}
      {losers.some(l => (l.profitLossPct ?? 0) < 0) && (
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '8px' }}>
            ⚠️ {t('portfolioWorstPerformers')}
          </div>
          {losers.filter(l => (l.profitLossPct ?? 0) < 0).map(item => (
            <div key={item.ticker} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <div>
                <span style={{ fontWeight: 700, color: 'var(--accent-primary)', marginRight: '8px' }}>{item.ticker}</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>({item.shares} lot)</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span className="negative" style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                  {fmtPct(item.profitLossPct ?? 0)}
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '8px', fontFamily: 'var(--font-mono)' }}>
                  ₺{fmtLira(Math.abs(item.profitLoss ?? 0))}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Portfolio stats */}
      <div style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('portfolioAvgReturn')}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
            {items.length > 0 ? fmtPct(items.reduce((s, i) => s + (i.profitLossPct ?? 0), 0) / items.length) : '—'}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('portfolioWinRate')}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
            {items.length > 0 ? `%${((items.filter(i => (i.profitLossPct ?? 0) > 0).length / items.length) * 100).toFixed(0)}` : '—'}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('portfolioLargestPosition')}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
            {items.length > 0 ? items.reduce((max, i) => (i.weight ?? 0) > (max.weight ?? 0) ? i : max, items[0]).ticker : '—'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Add Position Modal ───────────────────────────────────────────────────────

interface AddPositionModalProps {
  equities: EquityRow[];
  existingTickers: string[];
  onAdd: (ticker: string, shares: number, cost: number) => Promise<void>;
  onClose: () => void;
  t: (key: string) => string;
}

function AddPositionModal({ equities, existingTickers, onAdd, onClose, t }: AddPositionModalProps) {
  const [ticker, setTicker] = useState('');
  const [shares, setShares] = useState('');
  const [cost, setCost] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [saving, setSaving] = useState(false);

  const suggestions = useMemo(() => {
    if (!ticker || ticker.length < 1) return [];
    const q = ticker.toUpperCase();
    return equities
      .filter(e =>
        (e.ticker.toUpperCase().includes(q) || e.name?.toUpperCase().includes(q)) &&
        !existingTickers.includes(e.ticker),
      )
      .slice(0, 8);
  }, [ticker, equities, existingTickers]);

  const selectSuggestion = (eq: EquityRow) => {
    setTicker(eq.ticker);
    if (!cost) setCost(eq.price.toFixed(2));
    setShowSuggestions(false);
  };

  const canSave = ticker.length >= 2 &&
    parseFloat(shares.replace(',', '.')) > 0 &&
    parseFloat(cost.replace(',', '.')) > 0;

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    await onAdd(
      ticker.toUpperCase(),
      parseFloat(shares.replace(',', '.')),
      parseFloat(cost.replace(',', '.')),
    );
    setSaving(false);
  };

  return (
    <div className="portfolio-modal-overlay" onClick={onClose}>
      <div className="portfolio-modal" onClick={e => e.stopPropagation()}>
        <h3>{t('portfolioAddPosition')}</h3>

        <div className="form-group">
          <label>{t('ticker')}</label>
          <input
            type="text"
            value={ticker}
            placeholder="THYAO"
            autoFocus
            onChange={e => { setTicker(e.target.value.toUpperCase()); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="ticker-suggestions">
              {suggestions.map(eq => (
                <div
                  key={eq.ticker}
                  className="ticker-suggestion"
                  onMouseDown={e => { e.preventDefault(); selectSuggestion(eq); }}
                >
                  <span className="ts-ticker">{eq.ticker}</span>
                  <span className="ts-name">{eq.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="form-group">
          <label>{t('portfolioShares')}</label>
          <input
            type="number"
            min="1"
            value={shares}
            placeholder="100"
            onChange={e => setShares(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label>{t('portfolioCostBasis')}</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={cost}
            placeholder="310.50"
            onChange={e => setCost(e.target.value)}
          />
        </div>

        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>{t('cancelBtn')}</button>
          <button className="btn-save" disabled={!canSave || saving} onClick={handleSave}>
            {saving ? '...' : t('portfolioAddBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}
