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
} from 'lucide-react';
import './FinancialsView.css';

interface FinancialsViewProps {
  onSelectTicker: (ticker: string) => void;
  initialTicker?: string;
}

const DEFAULT_POPULAR_TICKERS = ['THYAO', 'EREGL', 'FROTO', 'BIMAS', 'ASELS', 'KCHOL', 'TUPRS', 'SISE', 'SAHOL', 'AKBNK'];

type ViewTab = 'summary' | 'income' | 'balance' | 'cash' | 'ratios' | 'peers' | 'radar';

export default function FinancialsView({ onSelectTicker, initialTicker = 'THYAO' }: FinancialsViewProps) {
  const { t, lang } = useTranslation();
  const [ticker, setTicker] = useState<string>(initialTicker);
  const [searchInput, setSearchInput] = useState('');
  const [currency, setCurrency] = useState<StatementCurrency>('TRY');
  const [periodType, setPeriodType] = useState<'quarterly' | 'annual'>('quarterly');
  const [activeTab, setActiveTab] = useState<ViewTab>('summary');

  const [statement, setStatement] = useState<FinancialStatement | null>(null);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load Dashboard Snapshot for Universe / Sector matching & suggestions
  useEffect(() => {
    getDashboardSnapshot().then(setSnapshot).catch(console.error);
  }, []);

  // Load Financial Statements
  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    let cancelled = false;

    getFinancialStatements(ticker, currency)
      .then((res) => {
        if (!cancelled) {
          setStatement(res);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ticker, currency]);

  // Current equity row info from snapshot
  const currentEquity = useMemo(() => {
    return snapshot?.equities?.find((e) => e.ticker.toUpperCase() === ticker.toUpperCase());
  }, [snapshot, ticker]);

  // Symbol suggestions for search input
  const suggestions = useMemo(() => {
    if (!searchInput.trim()) return [];
    const q = searchInput.trim().toUpperCase();
    return (snapshot?.equities || [])
      .filter((e) => e.ticker.toUpperCase().includes(q) || (e.name && e.name.toUpperCase().includes(q)))
      .slice(0, 8);
  }, [searchInput, snapshot]);

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

  // Peer companies in the same index or universe
  const peers = useMemo<EquityRow[]>(() => {
    if (!currentEquity || !snapshot?.equities) return [];
    const primaryIndex = currentEquity.index_memberships?.[0];
    return snapshot.equities
      .filter((e) => e.ticker !== ticker && (!primaryIndex || (e.index_memberships && e.index_memberships.includes(primaryIndex))))
      .slice(0, 10);
  }, [currentEquity, snapshot, ticker]);

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

  const handleSelectSuggestion = (sym: string) => {
    setTicker(sym.toUpperCase());
    setSearchInput('');
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
      {/* Top Header & Search Bar */}
      <div className="fin-header-bar">
        <div className="fin-header-left">
          <div className="fin-title-group">
            <h1 className="fin-page-title">
              <FileSpreadsheet size={22} className="fin-title-icon" />
              <span>{t('financials')} &amp; {t('financialsDetail')}</span>
            </h1>
            <p className="fin-page-subtitle">
              Borsa İstanbul şirketlerinin bilanço, gelir tablosu, rasyoları ve sektörel akran karşılaştırması
            </p>
          </div>
        </div>

        {/* Search Input & Currency/Period Controls */}
        <div className="fin-controls-row">
          <div className="fin-search-container">
            <Search size={15} className="fin-search-icon" />
            <input
              type="text"
              placeholder="Şirket Kodu Ara (örn: THYAO, EREGL)..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="fin-search-input"
            />
            {suggestions.length > 0 && (
              <div className="fin-search-dropdown">
                {suggestions.map((s) => (
                  <button
                    key={s.ticker}
                    type="button"
                    onClick={() => handleSelectSuggestion(s.ticker)}
                    className="fin-search-dropdown-item"
                  >
                    <span className="fin-dropdown-ticker">{s.ticker}</span>
                    <span className="fin-dropdown-name">{s.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

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
      </div>

      {/* Active Ticker Hero Banner */}
      <div className="fin-hero-card">
        <div className="fin-hero-left">
          <div className="fin-hero-badge">{ticker}</div>
          <div>
            <div className="fin-hero-name">
              {currentEquity?.name || `${ticker} A.Ş.`}
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
            onClick={() => onSelectTicker(ticker)}
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
            className={`fin-chip-btn ${ticker === sym ? 'active' : ''}`}
            onClick={() => setTicker(sym)}
          >
            {sym}
          </button>
        ))}
      </div>

      {/* Navigation Tabs */}
      <div className="fin-nav-tabs">
        <button
          type="button"
          className={`fin-nav-tab ${activeTab === 'summary' ? 'active' : ''}`}
          onClick={() => setActiveTab('summary')}
        >
          <Sparkles size={15} /> Finansal Özet &amp; DuPont
        </button>
        <button
          type="button"
          className={`fin-nav-tab ${activeTab === 'income' ? 'active' : ''}`}
          onClick={() => setActiveTab('income')}
        >
          <TrendingUp size={15} /> Gelir Tablosu
        </button>
        <button
          type="button"
          className={`fin-nav-tab ${activeTab === 'balance' ? 'active' : ''}`}
          onClick={() => setActiveTab('balance')}
        >
          <Building2 size={15} /> Bilanço
        </button>
        <button
          type="button"
          className={`fin-nav-tab ${activeTab === 'cash' ? 'active' : ''}`}
          onClick={() => setActiveTab('cash')}
        >
          <DollarSign size={15} /> Nakit Akımı
        </button>
        <button
          type="button"
          className={`fin-nav-tab ${activeTab === 'ratios' ? 'active' : ''}`}
          onClick={() => setActiveTab('ratios')}
        >
          <BarChart3 size={15} /> Rasyolar &amp; Çarpanlar
        </button>
        <button
          type="button"
          className={`fin-nav-tab ${activeTab === 'peers' ? 'active' : ''}`}
          onClick={() => setActiveTab('peers')}
        >
          <PieChart size={15} /> Sektörel Kıyaslama ({peers.length})
        </button>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="fin-loading-state">
          <div className="fin-spinner" />
          <span>Mali tablolar ve bilanço verileri yükleniyor ({ticker})...</span>
        </div>
      ) : error ? (
        <div className="fin-error-state">
          <AlertCircle size={20} color="#f85149" />
          <span>{error}</span>
        </div>
      ) : (
        <div className="fin-tab-content">
          {/* TAB 1: SUMMARY & DUPONT */}
          {activeTab === 'summary' && (
            <div className="fin-summary-grid">
              {/* Chart: Revenue and Net Profit Growth */}
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

              {/* DuPont Analysis Breakdown */}
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

              {/* Key Health Indicators */}
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
          {activeTab === 'income' && (
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
          {activeTab === 'balance' && (
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
          {activeTab === 'cash' && (
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
          {activeTab === 'ratios' && (
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
          {activeTab === 'peers' && (
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
                      <td className="bold">{ticker} ★</td>
                      <td>{currentEquity?.name || ticker}</td>
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
                            onClick={() => setTicker(p.ticker)}
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
  );
}
