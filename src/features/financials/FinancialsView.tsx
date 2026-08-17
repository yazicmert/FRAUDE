import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from '../../api/i18n';
import { getFinancialStatements, getDashboardSnapshot, type StatementCurrency } from '../../api/tauriClient';
import type { FinancialStatement, FinancialPeriod, DashboardSnapshot, EquityRow } from '../../types';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  Search,
  Building2,
  TrendingUp,
  DollarSign,
  PieChart,
  ArrowRight,
  Sparkles,
  BarChart3,
  AlertCircle,
  FileSpreadsheet,
  ArrowLeft,
  ShieldCheck,
  Calendar,
  Filter,
  Layers,
} from 'lucide-react';
import './FinancialsView.css';

interface FinancialsViewProps {
  onSelectTicker: (ticker: string) => void;
  initialTicker?: string;
}

const DEFAULT_POPULAR_TICKERS = ['THYAO', 'EREGL', 'FROTO', 'BIMAS', 'ASELS', 'KCHOL', 'TUPRS', 'SISE', 'SAHOL', 'AKBNK'];

type ViewMode = 'list' | 'detail';
type DetailTab = 'summary' | 'income' | 'balance' | 'cash' | 'ratios' | 'peers';
type SortField = 'period' | 'profit_growth' | 'sales_growth' | 'roe' | 'pe' | 'volume' | 'ticker';

export default function FinancialsView({ onSelectTicker, initialTicker }: FinancialsViewProps) {
  const { t, lang } = useTranslation();
  const [viewMode, setViewMode] = useState<ViewMode>(initialTicker ? 'detail' : 'list');
  const [selectedTicker, setSelectedTicker] = useState<string>(initialTicker || 'THYAO');
  const [searchInput, setSearchInput] = useState('');
  const [listSearchInput, setListSearchInput] = useState('');
  const [currency, setCurrency] = useState<StatementCurrency>('TRY');
  const [periodType, setPeriodType] = useState<'quarterly' | 'annual'>('quarterly');
  const [detailTab, setDetailTab] = useState<DetailTab>('summary');

  // List filter & sorting
  const [indexFilter, setIndexFilter] = useState<string>('all');
  const [periodFilter, setPeriodFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('period');
  const [sortAsc, setSortAsc] = useState(false);

  const [statement, setStatement] = useState<FinancialStatement | null>(null);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loadingStatement, setLoadingStatement] = useState(false);
  const [statementError, setStatementError] = useState<string | null>(null);

  // Load Dashboard Snapshot
  useEffect(() => {
    getDashboardSnapshot().then(setSnapshot).catch(console.error);
  }, []);

  // Load Financial Statements for Selected Ticker
  useEffect(() => {
    if (!selectedTicker || viewMode !== 'detail') return;
    setLoadingStatement(true);
    setStatementError(null);
    let cancelled = false;

    getFinancialStatements(selectedTicker, currency)
      .then((res) => {
        if (!cancelled) {
          setStatement(res);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setStatementError(String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingStatement(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTicker, currency, viewMode]);

  // Current equity info
  const currentEquity = useMemo(() => {
    return snapshot?.equities?.find((e) => e.ticker.toUpperCase() === selectedTicker.toUpperCase());
  }, [snapshot, selectedTicker]);

  // Autocomplete search suggestions
  const searchSuggestions = useMemo(() => {
    if (!searchInput.trim()) return [];
    const q = searchInput.trim().toUpperCase();
    return (snapshot?.equities || [])
      .filter((e) => e.ticker.toUpperCase().includes(q) || (e.name && e.name.toUpperCase().includes(q)))
      .slice(0, 8);
  }, [searchInput, snapshot]);

  // Unique list of periods available in universe
  const availablePeriods = useMemo(() => {
    if (!snapshot?.equities) return [];
    const set = new Set<string>();
    for (const eq of snapshot.equities) {
      if (eq.fundamentals_as_of) {
        set.add(eq.fundamentals_as_of);
      }
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [snapshot]);

  // Filtered and Sorted Equities List for Bilanço Listesi
  const filteredList = useMemo(() => {
    if (!snapshot?.equities) return [];
    let list = [...snapshot.equities];

    // Filter by search query
    if (listSearchInput.trim()) {
      const q = listSearchInput.trim().toUpperCase();
      list = list.filter((e) => e.ticker.toUpperCase().includes(q) || (e.name && e.name.toUpperCase().includes(q)));
    }

    // Filter by index
    if (indexFilter !== 'all') {
      list = list.filter((e) => e.index_memberships && e.index_memberships.includes(indexFilter));
    }

    // Filter by period
    if (periodFilter !== 'all') {
      list = list.filter((e) => e.fundamentals_as_of === periodFilter);
    }

    // Sort list
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'period':
          // Sort newest period first
          cmp = (b.fundamentals_as_of || '').localeCompare(a.fundamentals_as_of || '');
          if (cmp === 0) {
            // secondary sort by profit growth
            cmp = (b.profit_growth ?? -9999) - (a.profit_growth ?? -9999);
          }
          break;
        case 'profit_growth':
          cmp = (b.profit_growth ?? -9999) - (a.profit_growth ?? -9999);
          break;
        case 'sales_growth':
          cmp = (b.sales_growth ?? -9999) - (a.sales_growth ?? -9999);
          break;
        case 'roe':
          cmp = (b.roe ?? -9999) - (a.roe ?? -9999);
          break;
        case 'pe':
          cmp = (a.pe ?? 9999) - (b.pe ?? 9999);
          break;
        case 'volume':
          cmp = (b.volume ?? 0) - (a.volume ?? 0);
          break;
        case 'ticker':
          cmp = a.ticker.localeCompare(b.ticker);
          break;
      }
      return sortAsc ? -cmp : cmp;
    });

    return list;
  }, [snapshot, listSearchInput, indexFilter, periodFilter, sortField, sortAsc]);

  // Processed periods (Annual or Quarterly)
  const periods = useMemo<FinancialPeriod[]>(() => {
    if (!statement) return [];
    const raw = periodType === 'quarterly' ? statement.quarterlies : statement.annuals;
    if (!raw || raw.length === 0) return [];
    return [...raw].sort((a, b) => a.period.localeCompare(b.period));
  }, [statement, periodType]);

  const latestPeriod = periods[periods.length - 1];

  // DuPont Analysis Calculations
  const dupont = useMemo(() => {
    if (!latestPeriod) return null;
    const netIncome = latestPeriod.net_income || 0;
    const revenue = latestPeriod.revenue || 1;
    const assets = latestPeriod.total_assets || 1;
    const equity = latestPeriod.total_equity || 1;

    const netMargin = (netIncome / revenue) * 100;
    const assetTurnover = revenue / assets;
    const financialLeverage = assets / equity;
    const roe = (netIncome / equity) * 100;

    return {
      netMargin,
      assetTurnover,
      financialLeverage,
      roe,
    };
  }, [latestPeriod]);

  // Peer companies
  const peers = useMemo<EquityRow[]>(() => {
    if (!currentEquity || !snapshot?.equities) return [];
    const primaryIndex = currentEquity.index_memberships?.[0];
    return snapshot.equities
      .filter((e) => e.ticker !== selectedTicker && (!primaryIndex || (e.index_memberships && e.index_memberships.includes(primaryIndex))))
      .slice(0, 10);
  }, [currentEquity, snapshot, selectedTicker]);

  // Chart data for Revenue & Net Profit
  const chartData = useMemo(() => {
    return periods.map((p) => ({
      period: p.period,
      Ciro: p.revenue ? Math.round(p.revenue / 1_000_000) : 0,
      NetKar: p.net_income ? Math.round(p.net_income / 1_000_000) : 0,
      FAVOK: p.operating_income ? Math.round(p.operating_income / 1_000_000) : 0,
      NetMarj: p.revenue && p.net_income ? Number(((p.net_income / p.revenue) * 100).toFixed(1)) : 0,
    }));
  }, [periods]);

  const handleOpenDetail = (sym: string) => {
    setSelectedTicker(sym.toUpperCase());
    setViewMode('detail');
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const formatMoney = (val?: number | null) => {
    if (val === null || val === undefined) return '-';
    if (Math.abs(val) >= 1_000_000_000) {
      return `${(val / 1_000_000_000).toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Mr`;
    }
    if (Math.abs(val) >= 1_000_000) {
      return `${(val / 1_000_000).toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Mn`;
    }
    return val.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US');
  };

  const formatPercent = (val?: number | null) => {
    if (val === null || val === undefined || isNaN(val)) return '-';
    const sign = val > 0 ? '+' : '';
    return `${sign}${val.toFixed(2)}%`;
  };

  return (
    <div className="financials-view">
      {/* Top Header Navigation */}
      <div className="fin-header-bar">
        <div className="fin-header-left">
          <div className="fin-title-group">
            <h1 className="fin-page-title">
              <FileSpreadsheet size={22} className="fin-title-icon" />
              <span>{t('financials')} &amp; Mali Tablolar</span>
            </h1>
            <p className="fin-page-subtitle">
              Borsa İstanbul şirketlerinin bilanço takvimi, finansal performansları, DuPont analizi ve sektörel rasyoları
            </p>
          </div>
        </div>

        {/* View Mode Switcher (List vs Detail) */}
        <div className="fin-mode-switcher">
          <button
            type="button"
            className={`fin-mode-tab ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => setViewMode('list')}
          >
            <Calendar size={15} /> Bilanço Listesi (Son Açıklananlar)
          </button>
          <button
            type="button"
            className={`fin-mode-tab ${viewMode === 'detail' ? 'active' : ''}`}
            onClick={() => setViewMode('detail')}
          >
            <Sparkles size={15} /> Şirket Detay Analizi ({selectedTicker})
          </button>
        </div>
      </div>

      {/* Robust Data Source Banner */}
      <div className="fin-data-source-badge">
        <div className="fin-badge-icon-wrap">
          <ShieldCheck size={16} color="#3fb950" />
        </div>
        <div className="fin-badge-text">
          <strong>Doğrulanmış Veri Sağlayıcı:</strong> Bilanço ve mali tablo verileri doğrudan <strong>İş Yatırım (UFRS / XI_29 Mali Tablo Motoru)</strong> üzerinden çekilir.
          Kümülatif çeyrekler matematiksel kesinlikle saf çeyreğe indirgenir (4 çeyrek toplamı yıllık rakama %100 eşittir). UMS 21 standartlarında TRY ve USD para birimleri desteklenir.
        </div>
      </div>

      {/* ========================================================= */}
      {/* VIEW 1: BİLANÇO LİSTESİ (LATEST EARNINGS DISCLOSURES RADAR) */}
      {/* ========================================================= */}
      {viewMode === 'list' && (
        <div className="fin-list-view-section">
          {/* List Controls & Filters */}
          <div className="fin-list-filter-bar">
            <div className="fin-search-container list-search">
              <Search size={15} className="fin-search-icon" />
              <input
                type="text"
                placeholder="Şirket veya hisse kodu ara..."
                value={listSearchInput}
                onChange={(e) => setListSearchInput(e.target.value)}
                className="fin-search-input"
              />
            </div>

            {/* Index Filter */}
            <div className="fin-filter-select-group">
              <Filter size={14} className="filter-icon" />
              <select
                value={indexFilter}
                onChange={(e) => setIndexFilter(e.target.value)}
                className="fin-select"
              >
                <option value="all">Tüm Endeksler ({snapshot?.equities?.length || 0})</option>
                <option value="XU030">BIST 30</option>
                <option value="XU100">BIST 100</option>
                <option value="XUSIN">BIST Sınai</option>
                <option value="XBANK">BIST Banka</option>
                <option value="XGMDL">BIST GYO</option>
              </select>
            </div>

            {/* Period Filter */}
            <div className="fin-filter-select-group">
              <Layers size={14} className="filter-icon" />
              <select
                value={periodFilter}
                onChange={(e) => setPeriodFilter(e.target.value)}
                className="fin-select"
              >
                <option value="all">Tüm Dönemler</option>
                {availablePeriods.map((p) => (
                  <option key={p} value={p}>{p} Dönemi</option>
                ))}
              </select>
            </div>

            <div className="fin-list-count">
              <span>{filteredList.length} şirket listelendi</span>
            </div>
          </div>

          {/* Table of Disclosed Financials */}
          <div className="fin-card full-width">
            <div className="fin-table-scroll">
              <table className="fin-data-table radar-table">
                <thead>
                  <tr>
                    <th onClick={() => handleSort('ticker')} className="sortable">
                      Şirket {sortField === 'ticker' && (sortAsc ? '▲' : '▼')}
                    </th>
                    <th onClick={() => handleSort('period')} className="sortable">
                      Son Bilanço {sortField === 'period' && (sortAsc ? '▲' : '▼')}
                    </th>
                    <th className="num-col">Fiyat</th>
                    <th className="num-col">Günlük %</th>
                    <th onClick={() => handleSort('profit_growth')} className="num-col sortable">
                      Net Kar Büyümesi {sortField === 'profit_growth' && (sortAsc ? '▲' : '▼')}
                    </th>
                    <th onClick={() => handleSort('sales_growth')} className="num-col sortable">
                      Ciro Büyümesi {sortField === 'sales_growth' && (sortAsc ? '▲' : '▼')}
                    </th>
                    <th onClick={() => handleSort('roe')} className="num-col sortable">
                      ROE (Özkaynak Kar.) {sortField === 'roe' && (sortAsc ? '▲' : '▼')}
                    </th>
                    <th onClick={() => handleSort('pe')} className="num-col sortable">
                      F/K {sortField === 'pe' && (sortAsc ? '▲' : '▼')}
                    </th>
                    <th className="num-col">PD/DD</th>
                    <th className="num-col">Net Borç/FAVÖK</th>
                    <th onClick={() => handleSort('volume')} className="num-col sortable">
                      Hacim {sortField === 'volume' && (sortAsc ? '▲' : '▼')}
                    </th>
                    <th style={{ textAlign: 'center' }}>Mali Tablo</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredList.length === 0 ? (
                    <tr>
                      <td colSpan={12} style={{ textAlign: 'center', padding: '36px', color: '#8b949e' }}>
                        Filtrelere uygun bilanço kaydı bulunamadı.
                      </td>
                    </tr>
                  ) : (
                    filteredList.map((e) => {
                      const isNewest = e.fundamentals_as_of === availablePeriods[0];
                      return (
                        <tr
                          key={e.ticker}
                          className={`fin-radar-row ${selectedTicker === e.ticker ? 'selected-row' : ''}`}
                          onClick={() => handleOpenDetail(e.ticker)}
                        >
                          <td>
                            <div className="fin-row-name-group">
                              <span className="bold fin-ticker-code">{e.ticker}</span>
                              <span className="fin-row-subname">{e.name}</span>
                            </div>
                          </td>
                          <td>
                            <span className={`fin-period-pill ${isNewest ? 'newest' : ''}`}>
                              {e.fundamentals_as_of || '-'}
                            </span>
                          </td>
                          <td className="num-col">₺{e.price?.toFixed(2) ?? '-'}</td>
                          <td className={`num-col ${((e.change_pct ?? 0) >= 0) ? 'pos' : 'neg'}`}>
                            {formatPercent(e.change_pct)}
                          </td>
                          <td className={`num-col bold ${((e.profit_growth ?? 0) >= 0) ? 'pos' : 'neg'}`}>
                            {formatPercent(e.profit_growth)}
                          </td>
                          <td className={`num-col ${((e.sales_growth ?? 0) >= 0) ? 'pos' : 'neg'}`}>
                            {formatPercent(e.sales_growth)}
                          </td>
                          <td className="num-col bold">
                            {e.roe ? `${e.roe.toFixed(1)}%` : '-'}
                          </td>
                          <td className="num-col bold">{e.pe ? e.pe.toFixed(2) : '-'}</td>
                          <td className="num-col">{e.pb ? e.pb.toFixed(2) : '-'}</td>
                          <td className="num-col">{e.net_debt_ebitda ? e.net_debt_ebitda.toFixed(2) : '-'}</td>
                          <td className="num-col">{e.volume ? (e.volume / 1_000_000).toFixed(1) + 'M' : '-'}</td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              type="button"
                              className="fin-table-open-btn"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                handleOpenDetail(e.ticker);
                              }}
                            >
                              İncele <ArrowRight size={12} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* VIEW 2: ŞİRKET DETAY ANALİZİ (FINANCIAL STATEMENTS DETAIL) */}
      {/* ========================================================= */}
      {viewMode === 'detail' && (
        <div className="fin-detail-view-section">
          {/* Back button & Ticker Selection Header */}
          <div className="fin-detail-top-controls">
            <button
              type="button"
              className="fin-back-btn"
              onClick={() => setViewMode('list')}
            >
              <ArrowLeft size={15} /> Bilanço Listesine Dön
            </button>

            {/* Quick search input */}
            <div className="fin-search-container">
              <Search size={15} className="fin-search-icon" />
              <input
                type="text"
                placeholder="Şirket Değiştir (örn: THYAO, EREGL)..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="fin-search-input"
              />
              {searchSuggestions.length > 0 && (
                <div className="fin-search-dropdown">
                  {searchSuggestions.map((s) => (
                    <button
                      key={s.ticker}
                      type="button"
                      onClick={() => {
                        setSelectedTicker(s.ticker);
                        setSearchInput('');
                      }}
                      className="fin-search-dropdown-item"
                    >
                      <span className="fin-dropdown-ticker">{s.ticker}</span>
                      <span className="fin-dropdown-name">{s.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Period & Currency Toggles */}
            <div className="fin-toggle-group">
              <button
                type="button"
                className={`fin-toggle-btn ${periodType === 'quarterly' ? 'active' : ''}`}
                onClick={() => setPeriodType('quarterly')}
              >
                Çeyreklik
              </button>
              <button
                type="button"
                className={`fin-toggle-btn ${periodType === 'annual' ? 'active' : ''}`}
                onClick={() => setPeriodType('annual')}
              >
                Yıllık
              </button>
            </div>

            <div className="fin-toggle-group">
              {(['TRY', 'USD', 'EUR'] as StatementCurrency[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`fin-toggle-btn ${currency === c ? 'active' : ''}`}
                  onClick={() => setCurrency(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Active Ticker Hero Banner */}
          <div className="fin-hero-card">
            <div className="fin-hero-left">
              <div className="fin-hero-badge">{selectedTicker}</div>
              <div>
                <div className="fin-hero-name">
                  {currentEquity?.name || `${selectedTicker} A.Ş.`}
                </div>
                <div className="fin-hero-sector">
                  <span>{currentEquity?.index_memberships?.join(', ') || 'BIST Şirketi'}</span>
                </div>
              </div>
            </div>

            <div className="fin-hero-metrics">
              <div className="fin-hero-kpi">
                <span className="fin-kpi-label">Fiyat</span>
                <span className="fin-kpi-val">₺{currentEquity?.price?.toFixed(2) ?? '-'}</span>
                <span className={`fin-kpi-change ${((currentEquity?.change_pct ?? 0) >= 0) ? 'up' : 'down'}`}>
                  {formatPercent(currentEquity?.change_pct)}
                </span>
              </div>

              <div className="fin-hero-kpi">
                <span className="fin-kpi-label">F/K</span>
                <span className="fin-kpi-val">{currentEquity?.pe?.toFixed(2) ?? '-'}</span>
              </div>

              <div className="fin-hero-kpi">
                <span className="fin-kpi-label">PD/DD</span>
                <span className="fin-kpi-val">{currentEquity?.pb?.toFixed(2) ?? '-'}</span>
              </div>

              <div className="fin-hero-kpi">
                <span className="fin-kpi-label">Net Borç/FAVÖK</span>
                <span className="fin-kpi-val">{currentEquity?.net_debt_ebitda?.toFixed(2) ?? '-'}</span>
              </div>

              <button
                type="button"
                className="fin-hero-action-btn"
                onClick={() => onSelectTicker(selectedTicker)}
              >
                Hisse Detayı <ArrowRight size={14} />
              </button>
            </div>
          </div>

          {/* Popular Fast Select Chips */}
          <div className="fin-quick-chips">
            <span className="fin-chips-label">Hızlı Seçim:</span>
            {DEFAULT_POPULAR_TICKERS.map((sym) => (
              <button
                key={sym}
                type="button"
                className={`fin-chip-btn ${selectedTicker === sym ? 'active' : ''}`}
                onClick={() => setSelectedTicker(sym)}
              >
                {sym}
              </button>
            ))}
          </div>

          {/* Navigation Detail Tabs */}
          <div className="fin-nav-tabs">
            <button
              type="button"
              className={`fin-nav-tab ${detailTab === 'summary' ? 'active' : ''}`}
              onClick={() => setDetailTab('summary')}
            >
              <Sparkles size={15} /> Finansal Özet &amp; DuPont
            </button>
            <button
              type="button"
              className={`fin-nav-tab ${detailTab === 'income' ? 'active' : ''}`}
              onClick={() => setDetailTab('income')}
            >
              <TrendingUp size={15} /> Gelir Tablosu
            </button>
            <button
              type="button"
              className={`fin-nav-tab ${detailTab === 'balance' ? 'active' : ''}`}
              onClick={() => setDetailTab('balance')}
            >
              <Building2 size={15} /> Bilanço
            </button>
            <button
              type="button"
              className={`fin-nav-tab ${detailTab === 'cash' ? 'active' : ''}`}
              onClick={() => setDetailTab('cash')}
            >
              <DollarSign size={15} /> Nakit Akımı
            </button>
            <button
              type="button"
              className={`fin-nav-tab ${detailTab === 'ratios' ? 'active' : ''}`}
              onClick={() => setDetailTab('ratios')}
            >
              <BarChart3 size={15} /> Rasyolar &amp; Çarpanlar
            </button>
            <button
              type="button"
              className={`fin-nav-tab ${detailTab === 'peers' ? 'active' : ''}`}
              onClick={() => setDetailTab('peers')}
            >
              <PieChart size={15} /> Sektörel Kıyaslama ({peers.length})
            </button>
          </div>

          {/* Tab Content Loading & Error States */}
          {loadingStatement ? (
            <div className="fin-loading-state">
              <div className="fin-spinner" />
              <span>İş Yatırım UFRS mali tabloları yükleniyor ({selectedTicker})...</span>
            </div>
          ) : statementError ? (
            <div className="fin-error-state">
              <AlertCircle size={20} color="#f85149" />
              <span>{statementError}</span>
            </div>
          ) : (
            <div className="fin-tab-content">
              {/* TAB 1: SUMMARY & DUPONT */}
              {detailTab === 'summary' && (
                <div className="fin-summary-grid">
                  {/* Chart */}
                  <div className="fin-card full-width">
                    <div className="fin-card-header">
                      <h3>Çeyreklik Gelir ve Net Kar Trendi (Milyon {currency})</h3>
                    </div>
                    <div style={{ width: '100%', height: 260 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                          <XAxis dataKey="period" stroke="#8b949e" tick={{ fontSize: 11 }} />
                          <YAxis stroke="#8b949e" tick={{ fontSize: 11 }} />
                          <Tooltip
                            contentStyle={{ background: '#161b22', borderColor: '#30363d', color: '#fff', fontSize: '0.78rem' }}
                          />
                          <Legend wrapperStyle={{ fontSize: '0.75rem', paddingTop: '10px' }} />
                          <Bar dataKey="Ciro" fill="#58a6ff" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="FAVOK" fill="#e3b341" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="NetKar" fill="#3fb950" radius={[4, 4, 0, 0]} />
                          <Line type="monotone" dataKey="NetMarj" stroke="#ff7b72" strokeWidth={2} dot={{ r: 3 }} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* DuPont Breakdown */}
                  {dupont && (
                    <div className="fin-card full-width">
                      <div className="fin-card-header">
                        <h3>DuPont Karlılık Ayrıştırması ({latestPeriod?.period})</h3>
                      </div>
                      <div className="fin-dupont-container">
                        <div className="fin-dupont-box highlight">
                          <span className="fin-dupont-label">Özkaynak Karlılığı (ROE)</span>
                          <span className="fin-dupont-val">{formatPercent(dupont.roe)}</span>
                          <span className="fin-dupont-sub">Net Kar / Özkaynaklar</span>
                        </div>

                        <span className="fin-dupont-sign">=</span>

                        <div className="fin-dupont-box">
                          <span className="fin-dupont-label">Net Kar Marjı</span>
                          <span className="fin-dupont-val">{formatPercent(dupont.netMargin)}</span>
                          <span className="fin-dupont-sub">Net Kar / Ciro</span>
                        </div>

                        <span className="fin-dupont-sign">×</span>

                        <div className="fin-dupont-box">
                          <span className="fin-dupont-label">Aktif Devir Hızı</span>
                          <span className="fin-dupont-val">{dupont.assetTurnover.toFixed(2)}x</span>
                          <span className="fin-dupont-sub">Ciro / Toplam Aktif</span>
                        </div>

                        <span className="fin-dupont-sign">×</span>

                        <div className="fin-dupont-box">
                          <span className="fin-dupont-label">Finansal Kaldıraç</span>
                          <span className="fin-dupont-val">{dupont.financialLeverage.toFixed(2)}x</span>
                          <span className="fin-dupont-sub">Toplam Aktif / Özkaynak</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Key Indicators */}
                  <div className="fin-card half-width">
                    <div className="fin-card-header">
                      <h3>Finansal Büyüme &amp; Marjlar</h3>
                    </div>
                    <div className="fin-metrics-list">
                      <div className="fin-metric-row">
                        <span>Son Dönem Ciro</span>
                        <strong>{formatMoney(latestPeriod?.revenue)} {currency}</strong>
                      </div>
                      <div className="fin-metric-row">
                        <span>Brüt Kar</span>
                        <strong>{formatMoney(latestPeriod?.gross_profit)} {currency}</strong>
                      </div>
                      <div className="fin-metric-row">
                        <span>Faaliyet Karı (EBIT)</span>
                        <strong>{formatMoney(latestPeriod?.operating_income)} {currency}</strong>
                      </div>
                      <div className="fin-metric-row">
                        <span>Net Dönem Karı</span>
                        <strong style={{ color: (latestPeriod?.net_income ?? 0) >= 0 ? '#3fb950' : '#f85149' }}>
                          {formatMoney(latestPeriod?.net_income)} {currency}
                        </strong>
                      </div>
                      <div className="fin-metric-row">
                        <span>Serbest Nakit Akımı</span>
                        <strong>{formatMoney(latestPeriod?.free_cash_flow)} {currency}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="fin-card half-width">
                    <div className="fin-card-header">
                      <h3>Sermaye &amp; Borçluluk Yapısı</h3>
                    </div>
                    <div className="fin-metrics-list">
                      <div className="fin-metric-row">
                        <span>Toplam Varlıklar</span>
                        <strong>{formatMoney(latestPeriod?.total_assets)} {currency}</strong>
                      </div>
                      <div className="fin-metric-row">
                        <span>Toplam Özkaynaklar</span>
                        <strong>{formatMoney(latestPeriod?.total_equity)} {currency}</strong>
                      </div>
                      <div className="fin-metric-row">
                        <span>Toplam Finansal Borç</span>
                        <strong>{formatMoney(latestPeriod?.total_debt)} {currency}</strong>
                      </div>
                      <div className="fin-metric-row">
                        <span>Özkaynak / Toplam Varlık</span>
                        <strong>
                          {latestPeriod?.total_equity && latestPeriod?.total_assets
                            ? `${((latestPeriod.total_equity / latestPeriod.total_assets) * 100).toFixed(1)}%`
                            : '-'}
                        </strong>
                      </div>
                      <div className="fin-metric-row">
                        <span>Borç / Özkaynak Oranı</span>
                        <strong>
                          {latestPeriod?.total_debt && latestPeriod?.total_equity
                            ? `${((latestPeriod.total_debt / latestPeriod.total_equity) * 100).toFixed(1)}%`
                            : '-'}
                        </strong>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: INCOME STATEMENT TABLE */}
              {detailTab === 'income' && (
                <div className="fin-card full-width">
                  <div className="fin-card-header">
                    <h3>Gelir Tablosu ({currency})</h3>
                  </div>
                  <div className="fin-table-scroll">
                    <table className="fin-data-table">
                      <thead>
                        <tr>
                          <th style={{ minWidth: '220px' }}>Kalem</th>
                          {periods.map((p) => (
                            <th key={p.period} className="num-col">{p.period}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="highlight-row">
                          <td>Satış Gelirleri (Hasılat)</td>
                          {periods.map((p) => (
                            <td key={p.period} className="num-col">{formatMoney(p.revenue)}</td>
                          ))}
                        </tr>
                        <tr>
                          <td>Brüt Kar</td>
                          {periods.map((p) => (
                            <td key={p.period} className="num-col">{formatMoney(p.gross_profit)}</td>
                          ))}
                        </tr>
                        <tr className="highlight-row">
                          <td>Faaliyet Karı (EBIT)</td>
                          {periods.map((p) => (
                            <td key={p.period} className="num-col">{formatMoney(p.operating_income)}</td>
                          ))}
                        </tr>
                        <tr className="bold-row">
                          <td>Net Dönem Karı</td>
                          {periods.map((p) => (
                            <td key={p.period} className={`num-col ${((p.net_income ?? 0) >= 0) ? 'pos' : 'neg'}`}>
                              {formatMoney(p.net_income)}
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <td>Net Kar Marjı (%)</td>
                          {periods.map((p) => (
                            <td key={p.period} className="num-col">
                              {p.revenue && p.net_income ? formatPercent((p.net_income / p.revenue) * 100) : '-'}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 3: BALANCE SHEET */}
              {detailTab === 'balance' && (
                <div className="fin-card full-width">
                  <div className="fin-card-header">
                    <h3>Bilanço ({currency})</h3>
                  </div>
                  <div className="fin-table-scroll">
                    <table className="fin-data-table">
                      <thead>
                        <tr>
                          <th style={{ minWidth: '220px' }}>Kalem</th>
                          {periods.map((p) => (
                            <th key={p.period} className="num-col">{p.period}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="highlight-row">
                          <td>Toplam Varlıklar (Aktifler)</td>
                          {periods.map((p) => (
                            <td key={p.period} className="num-col">{formatMoney(p.total_assets)}</td>
                          ))}
                        </tr>
                        <tr className="bold-row">
                          <td>Toplam Özkaynaklar (Pasifler)</td>
                          {periods.map((p) => (
                            <td key={p.period} className="num-col">{formatMoney(p.total_equity)}</td>
                          ))}
                        </tr>
                        <tr>
                          <td>Toplam Finansal Borç</td>
                          {periods.map((p) => (
                            <td key={p.period} className="num-col">{formatMoney(p.total_debt)}</td>
                          ))}
                        </tr>
                        <tr>
                          <td>Özkaynak Oranı (%)</td>
                          {periods.map((p) => (
                            <td key={p.period} className="num-col">
                              {p.total_equity && p.total_assets ? `${((p.total_equity / p.total_assets) * 100).toFixed(1)}%` : '-'}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 4: CASH FLOW */}
              {detailTab === 'cash' && (
                <div className="fin-card full-width">
                  <div className="fin-card-header">
                    <h3>Nakit Akım Tablosu ({currency})</h3>
                  </div>
                  <div className="fin-table-scroll">
                    <table className="fin-data-table">
                      <thead>
                        <tr>
                          <th style={{ minWidth: '220px' }}>Kalem</th>
                          {periods.map((p) => (
                            <th key={p.period} className="num-col">{p.period}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="highlight-row">
                          <td>İşletme Faaliyetlerinden Nakit Akışı</td>
                          {periods.map((p) => (
                            <td key={p.period} className="num-col">{formatMoney(p.operating_cash_flow)}</td>
                          ))}
                        </tr>
                        <tr className="bold-row">
                          <td>Serbest Nakit Akımı (FCF)</td>
                          {periods.map((p) => (
                            <td key={p.period} className={`num-col ${((p.free_cash_flow ?? 0) >= 0) ? 'pos' : 'neg'}`}>
                              {formatMoney(p.free_cash_flow)}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 5: RATIOS */}
              {detailTab === 'ratios' && (
                <div className="fin-card full-width">
                  <div className="fin-card-header">
                    <h3>Finansal Oranlar &amp; Çarpan Analizi</h3>
                  </div>
                  <div className="fin-table-scroll">
                    <table className="fin-data-table">
                      <thead>
                        <tr>
                          <th>Oran</th>
                          <th>Açıklama</th>
                          <th className="num-col">Değer</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Fiyat / Kazanç (F/K)</td>
                          <td>Piyasa Değeri / Yıllıklandırılmış Net Kar</td>
                          <td className="num-col bold">{currentEquity?.pe?.toFixed(2) ?? '-'}</td>
                        </tr>
                        <tr>
                          <td>Piyasa Değeri / Defter Değeri (PD/DD)</td>
                          <td>Piyasa Değeri / Özkaynaklar</td>
                          <td className="num-col bold">{currentEquity?.pb?.toFixed(2) ?? '-'}</td>
                        </tr>
                        <tr>
                          <td>Net Borç / FAVÖK</td>
                          <td>Net Borç / Yıllık FAVÖK</td>
                          <td className="num-col bold">{currentEquity?.net_debt_ebitda?.toFixed(2) ?? '-'}</td>
                        </tr>
                        <tr>
                          <td>Özkaynak Karlılığı (ROE)</td>
                          <td>Net Kar / Özkaynaklar</td>
                          <td className="num-col bold">{formatPercent(dupont?.roe)}</td>
                        </tr>
                        <tr>
                          <td>Aktif Karlılığı (ROA)</td>
                          <td>Net Kar / Toplam Aktif</td>
                          <td className="num-col bold">
                            {latestPeriod?.net_income && latestPeriod?.total_assets
                              ? formatPercent((latestPeriod.net_income / latestPeriod.total_assets) * 100)
                              : '-'}
                          </td>
                        </tr>
                        <tr>
                          <td>Net Kar Marjı</td>
                          <td>Net Kar / Hasılat</td>
                          <td className="num-col bold">{formatPercent(dupont?.netMargin)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 6: PEER COMPARISON */}
              {detailTab === 'peers' && (
                <div className="fin-card full-width">
                  <div className="fin-card-header">
                    <h3>Sektörel Akran Karşılaştırması</h3>
                  </div>
                  <div className="fin-table-scroll">
                    <table className="fin-data-table">
                      <thead>
                        <tr>
                          <th>Kod</th>
                          <th>Şirket</th>
                          <th className="num-col">Fiyat</th>
                          <th className="num-col">Günlük %</th>
                          <th className="num-col">F/K</th>
                          <th className="num-col">PD/DD</th>
                          <th className="num-col">Net Borç/FAVÖK</th>
                          <th className="num-col">Hacim</th>
                          <th>İşlem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Selected Ticker First */}
                        <tr className="highlight-row">
                          <td className="bold">{selectedTicker} ★</td>
                          <td>{currentEquity?.name || selectedTicker}</td>
                          <td className="num-col">₺{currentEquity?.price?.toFixed(2) ?? '-'}</td>
                          <td className={`num-col ${((currentEquity?.change_pct ?? 0) >= 0) ? 'pos' : 'neg'}`}>
                            {formatPercent(currentEquity?.change_pct)}
                          </td>
                          <td className="num-col bold">{currentEquity?.pe?.toFixed(2) ?? '-'}</td>
                          <td className="num-col bold">{currentEquity?.pb?.toFixed(2) ?? '-'}</td>
                          <td className="num-col bold">{currentEquity?.net_debt_ebitda?.toFixed(2) ?? '-'}</td>
                          <td className="num-col">{currentEquity?.volume ? (currentEquity.volume / 1_000_000).toFixed(1) + 'M' : '-'}</td>
                          <td>
                            <span style={{ fontSize: '0.72rem', color: '#58a6ff' }}>Seçili</span>
                          </td>
                        </tr>

                        {/* Sector Peers */}
                        {peers.map((p) => (
                          <tr key={p.ticker}>
                            <td className="bold">{p.ticker}</td>
                            <td>{p.name}</td>
                            <td className="num-col">₺{p.price?.toFixed(2) ?? '-'}</td>
                            <td className={`num-col ${((p.change_pct ?? 0) >= 0) ? 'pos' : 'neg'}`}>
                              {formatPercent(p.change_pct)}
                            </td>
                            <td className="num-col">{p.pe ? p.pe.toFixed(2) : '-'}</td>
                            <td className="num-col">{p.pb ? p.pb.toFixed(2) : '-'}</td>
                            <td className="num-col">{p.net_debt_ebitda ? p.net_debt_ebitda.toFixed(2) : '-'}</td>
                            <td className="num-col">{p.volume ? (p.volume / 1_000_000).toFixed(1) + 'M' : '-'}</td>
                            <td>
                              <button
                                type="button"
                                className="fin-peer-select-btn"
                                onClick={() => setSelectedTicker(p.ticker)}
                              >
                                İncele
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
