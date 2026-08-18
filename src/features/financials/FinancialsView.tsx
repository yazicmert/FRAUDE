import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from '../../api/i18n';
import {
  getFinancialStatements,
  getDashboardSnapshot,
  listFinancialDisclosures,
  type StatementCurrency,
} from '../../api/tauriClient';
import type {
  FinancialStatement,
  FinancialPeriod,
  DashboardSnapshot,
  EquityRow,
  KapAnnouncement,
} from '../../types';
import { isBistEquity } from '../../lib/equityGroups';
import KapDocumentViewerModal from '../kap/KapDocumentViewerModal';
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
  Filter,
  Layers,
  ExternalLink,
  Radio,
  Database,
} from 'lucide-react';
import { supabase } from '../auth/supabaseClient';
import './FinancialsView.css';

interface FinancialsViewProps {
  onSelectTicker: (ticker: string) => void;
  initialTicker?: string;
}

const DEFAULT_POPULAR_TICKERS = ['THYAO', 'EREGL', 'FROTO', 'BIMAS', 'ASELS', 'KCHOL', 'TUPRS', 'SISE', 'SAHOL', 'AKBNK'];

type ViewMode = 'list' | 'detail';
type DetailTab = 'summary' | 'income' | 'balance' | 'cash' | 'ratios' | 'peers';

interface EarningsItem {
  id: string;
  ticker: string;
  name: string;
  date: string;
  period: string;
  title: string;
  summary: string;
  url: string;
  announcement: KapAnnouncement;
  equity?: EquityRow;
}

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

  // Modal for KAP document preview
  const [previewAnnouncement, setPreviewAnnouncement] = useState<KapAnnouncement | null>(null);

  const [statement, setStatement] = useState<FinancialStatement | null>(null);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [kapDisclosures, setKapDisclosures] = useState<KapAnnouncement[]>([]);
  const [loadingDisclosures, setLoadingDisclosures] = useState(false);
  const [loadingStatement, setLoadingStatement] = useState(false);
  const [statementError, setStatementError] = useState<string | null>(null);
  const [archiveStats, setArchiveStats] = useState<{ totalTickers: number; totalPeriods: number } | null>(null);

  // Load 10-Year Supabase Financials Archive Stats
  useEffect(() => {
    async function loadArchiveStats() {
      try {
        const { data, count, error } = await supabase
          .from('bist_financial_periods')
          .select('ticker', { count: 'exact' });
        if (!error && data) {
          const unique = new Set(data.map((d: { ticker: string }) => d.ticker)).size;
          setArchiveStats({
            totalTickers: unique,
            totalPeriods: count ?? data.length,
          });
        }
      } catch (err) {
        console.warn('Supabase archive stats fetch error:', err);
      }
    }
    loadArchiveStats();
  }, []);

  // Load Dashboard Snapshot & Live KAP Financial Disclosures
  useEffect(() => {
    getDashboardSnapshot().then(setSnapshot).catch(console.error);

    setLoadingDisclosures(true);
    listFinancialDisclosures()
      .then((res) => {
        setKapDisclosures(res || []);
      })
      .catch((err) => {
        console.error('KAP Finansal bildirimleri yüklenemedi:', err);
      })
      .finally(() => {
        setLoadingDisclosures(false);
      });
  }, []);

  // All Turkish BIST Equities map
  const bistEquitiesMap = useMemo(() => {
    const map = new Map<string, EquityRow>();
    for (const eq of (snapshot?.equities || []).filter(isBistEquity)) {
      map.set(eq.ticker.toUpperCase(), eq);
    }
    return map;
  }, [snapshot]);

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
    return bistEquitiesMap.get(selectedTicker.toUpperCase());
  }, [bistEquitiesMap, selectedTicker]);

  // Autocomplete search suggestions (BIST only)
  const searchSuggestions = useMemo(() => {
    if (!searchInput.trim()) return [];
    const q = searchInput.trim().toUpperCase();
    return Array.from(bistEquitiesMap.values())
      .filter((e) => e.ticker.toUpperCase().includes(q) || (e.name && e.name.toUpperCase().includes(q)))
      .slice(0, 8);
  }, [searchInput, bistEquitiesMap]);

  // Helper to extract financial period string from KAP title or date
  const parsePeriodFromDisclosure = (title: string, summary: string, date: string, eq?: EquityRow): string => {
    const text = `${title} ${summary}`.toUpperCase();

    // 1. Check for explicit date endings like "30.06.2024", "30/06/2024", "31.12.2024"
    const dMatch06 = text.match(/30[\.\/]06[\.\/](202[0-9])/);
    if (dMatch06) return `${dMatch06[1]}/06`;

    const dMatch09 = text.match(/30[\.\/]09[\.\/](202[0-9])/);
    if (dMatch09) return `${dMatch09[1]}/09`;

    const dMatch12 = text.match(/31[\.\/]12[\.\/](202[0-9])/);
    if (dMatch12) return `${dMatch12[1]}/12`;

    const dMatch03 = text.match(/31[\.\/]03[\.\/](202[0-9])/);
    if (dMatch03) return `${dMatch03[1]}/03`;

    // 2. Check for explicit Year + Month or Quarter combinations
    const yearMatch = text.match(/(202[0-9])/);
    const year = yearMatch ? yearMatch[1] : (eq?.fundamentals_as_of ? eq.fundamentals_as_of.split('/')[0] : '2024');

    if (text.includes('12 AYLIK') || text.includes('4. ÇEYREK') || text.includes('4.ÇEYREK') || text.includes('4 ÇEYREK') || text.includes('YILLIK')) {
      return `${year}/12`;
    }
    if (text.includes('9 AYLIK') || text.includes('3. ÇEYREK') || text.includes('3.ÇEYREK') || text.includes('3 ÇEYREK')) {
      return `${year}/09`;
    }
    if (text.includes('6 AYLIK') || text.includes('2. ÇEYREK') || text.includes('2.ÇEYREK') || text.includes('2 ÇEYREK')) {
      return `${year}/06`;
    }
    if (text.includes('3 AYLIK') || text.includes('1. ÇEYREK') || text.includes('1.ÇEYREK') || text.includes('1 ÇEYREK')) {
      return `${year}/03`;
    }

    // 3. Explicit 202X/XX pattern in text
    const matchSlash = text.match(/(202[0-9])\s*[\/\-]\s*(12|09|06|03|[1-4])/);
    if (matchSlash) {
      let q = matchSlash[2];
      if (q === '4') q = '12';
      else if (q === '3') q = '09';
      else if (q === '2') q = '06';
      else if (q === '1') q = '03';
      return `${matchSlash[1]}/${q}`;
    }

    // 4. Authoritative fundamentals_as_of from İş Yatırım
    if (eq?.fundamentals_as_of) {
      return eq.fundamentals_as_of;
    }

    // 5. Fallback based on disclosure calendar publish month
    const pubMonthMatch = date.match(/(\d{2})\.(\d{2})\.(202[0-9])/);
    if (pubMonthMatch) {
      const month = parseInt(pubMonthMatch[2], 10);
      const pubYear = pubMonthMatch[3];
      if (month >= 7 && month <= 9) return `${pubYear}/06`;
      if (month >= 10 && month <= 11) return `${pubYear}/09`;
      if (month >= 12 || month <= 4) {
        const targetYear = month <= 4 ? String(parseInt(pubYear, 10) - 1) : pubYear;
        return `${targetYear}/12`;
      }
      if (month >= 5 && month <= 6) return `${pubYear}/03`;
    }

    return '2024/12';
  };

  // Build the list of earnings disclosures from KAP
  const earningsList = useMemo<EarningsItem[]>(() => {
    // 1. Gather all KAP financial disclosures
    let rawItems = [...kapDisclosures];

    // Fallback: also merge any FR announcements from dashboard snapshot if not already present
    if (snapshot?.kap_announcements) {
      for (const ann of snapshot.kap_announcements) {
        const cat = (ann.category || '').toUpperCase();
        const tLower = (ann.title || '').toLowerCase();
        if (cat === 'FR' || tLower.includes('finansal rapor') || tLower.includes('bilanço') || tLower.includes('sorumluluk beyanı')) {
          if (!rawItems.some((x) => x.id === ann.id)) {
            rawItems.push(ann);
          }
        }
      }
    }

    // Process & deduplicate strictly by ticker (keeping the newest disclosure for each ticker)
    const items: EarningsItem[] = [];
    const seenTickers = new Set<string>();

    for (const ann of rawItems) {
      const ticker = ann.ticker.toUpperCase();
      if (!ticker || ticker === 'KAP' || ticker === '-') continue;

      // Only include valid Borsa Istanbul equities from bistEquitiesMap
      const eq = bistEquitiesMap.get(ticker);
      if (!eq) continue;

      // STRICT DEDUPLICATION: 1 row per company (newest disclosure takes precedence)
      if (seenTickers.has(ticker)) {
        continue;
      }

      const period = parsePeriodFromDisclosure(ann.title, ann.summary, ann.date, eq);
      const name = eq.name || ticker;

      // Add item
      items.push({
        id: ann.id,
        ticker,
        name,
        date: ann.date,
        period,
        title: ann.title,
        summary: ann.summary,
        url: ann.url,
        announcement: ann,
        equity: eq,
      });
      seenTickers.add(ticker);
    }

    // Fallback: if KAP stream is currently between disclosure seasons, populate with BIST equities having valid fundamentals_as_of
    if (items.length < 5 && snapshot?.equities) {
      for (const eq of snapshot.equities.filter(isBistEquity)) {
        if (eq.fundamentals_as_of && !seenTickers.has(eq.ticker.toUpperCase())) {
          const fakeAnn: KapAnnouncement = {
            id: `EQUITY-${eq.ticker}`,
            ticker: eq.ticker,
            title: `${eq.ticker} ${eq.fundamentals_as_of} Finansal Raporu`,
            date: eq.fundamentals_as_of || 'Son Dönem',
            category: 'Finansal Rapor',
            summary: `${eq.name} ${eq.fundamentals_as_of} mali tabloları`,
            url: `https://www.kap.org.tr/tr/sirket-bilgileri/ozet/${eq.ticker}`,
            ai_importance_score: 55,
            attachment_count: 1,
          };
          items.push({
            id: fakeAnn.id,
            ticker: eq.ticker,
            name: eq.name || eq.ticker,
            date: eq.fundamentals_as_of || 'Son Dönem',
            period: eq.fundamentals_as_of || '2024/12',
            title: fakeAnn.title,
            summary: fakeAnn.summary,
            url: fakeAnn.url,
            announcement: fakeAnn,
            equity: eq,
          });
          seenTickers.add(eq.ticker.toUpperCase());
        }
      }
    }

    return items;
  }, [kapDisclosures, snapshot, bistEquitiesMap]);

  // Unique list of periods from earningsList
  const availablePeriods = useMemo(() => {
    const set = new Set<string>();
    for (const item of earningsList) {
      if (item.period) set.add(item.period);
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [earningsList]);

  // Filtered earnings list
  const filteredEarnings = useMemo(() => {
    let list = [...earningsList];

    // Search query
    if (listSearchInput.trim()) {
      const q = listSearchInput.trim().toUpperCase();
      list = list.filter((e) => e.ticker.includes(q) || e.name.toUpperCase().includes(q));
    }

    // Index filter
    if (indexFilter !== 'all') {
      const matchIndex = indexFilter.toUpperCase();
      list = list.filter((e) =>
        e.equity?.index_memberships && e.equity.index_memberships.some((m) => m.toUpperCase().includes(matchIndex))
      );
    }

    // Period filter
    if (periodFilter !== 'all') {
      list = list.filter((e) => e.period === periodFilter);
    }

    return list;
  }, [earningsList, listSearchInput, indexFilter, periodFilter]);

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

  // Peer companies (strictly BIST)
  const peers = useMemo<EquityRow[]>(() => {
    if (!currentEquity) return [];
    const primaryIndex = currentEquity.index_memberships?.[0];
    return Array.from(bistEquitiesMap.values())
      .filter((e) => e.ticker !== selectedTicker && (!primaryIndex || (e.index_memberships && e.index_memberships.includes(primaryIndex))))
      .slice(0, 10);
  }, [currentEquity, bistEquitiesMap, selectedTicker]);

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
              KAP'tan anlık çekilen son bilanço bildirimleri, şirket finansalları, DuPont analizi ve sektörel rasyolar
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
            <Radio size={15} color="#3fb950" /> KAP Bilanço Radarı ({filteredEarnings.length})
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

      {/* 10-Year Cloud Archive Progress Bar */}
      <div className="fin-archive-progress-card">
        <div className="fin-archive-header">
          <div className="fin-archive-title">
            <Database size={15} color="#3fb950" />
            <span>10 Yıllık BIST KAP XBRL Bulut Veritabanı (2016 – 2026)</span>
          </div>
          <span className="fin-archive-badge">
            {archiveStats
              ? `${archiveStats.totalTickers} / 560 Şirket (${archiveStats.totalPeriods.toLocaleString()} Çeyrek) • %${Math.round((archiveStats.totalTickers / 560) * 100)}`
              : 'Veritabanı senkronize ediliyor...'}
          </span>
        </div>
        <div className="fin-archive-track">
          <div
            className="fin-archive-bar"
            style={{
              width: `${Math.min(100, Math.max(2, ((archiveStats?.totalTickers || 0) / 560) * 100))}%`,
            }}
          />
        </div>
      </div>

      {/* Robust Data Source Banner */}
      <div className="fin-data-source-badge">
        <div className="fin-badge-icon-wrap">
          <ShieldCheck size={16} color="#3fb950" />
        </div>
        <div className="fin-badge-text">
          <strong>KAP &amp; İş Yatırım Canlı Bilanço Motoru:</strong> Liste, Kamuyu Aydınlatma Platformu'na (KAP) düşen en güncel <strong>Finansal Rapor (FR)</strong> bildirimlerinden süzülür (en son açıklayandan en erken açıklayana sıralı). Mali tablolar doğrudan İş Yatırım UFRS / XI_29 veri motorundan saf çeyreklik hassasiyetle hesaplanır.
        </div>
      </div>

      {/* ========================================================= */}
      {/* VIEW 1: BİLANÇO LİSTESİ (KAP LATEST DISCLOSED EARNINGS RADAR) */}
      {/* ========================================================= */}
      {viewMode === 'list' && (
        <div className="fin-list-view-section">
          {/* List Controls & Filters */}
          <div className="fin-list-filter-bar">
            <div className="fin-search-container list-search">
              <Search size={15} className="fin-search-icon" />
              <input
                type="text"
                placeholder="Bilanço açıklayan şirket ara..."
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
                <option value="all">Tüm BIST Endeksleri</option>
                <option value="BIST 30">BIST 30</option>
                <option value="BIST 50">BIST 50</option>
                <option value="BIST 100">BIST 100</option>
                <option value="SINAI">BIST Sınai</option>
                <option value="BANKA">BIST Banka</option>
                <option value="HIZMET">BIST Hizmetler</option>
                <option value="TEKNOLOJI">BIST Teknoloji</option>
                <option value="HALKA ARZ">BIST Halka Arz</option>
                <option value="TEMETTU">BIST Temettü</option>
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
                <option value="all">Tüm Çeyrekler ({availablePeriods.length} Dönem)</option>
                {availablePeriods.map((p) => (
                  <option key={p} value={p}>{p} Bilanço Sezonu</option>
                ))}
              </select>
            </div>

            <div className="fin-list-count">
              <span>{filteredEarnings.length} bilanço bildirimi</span>
            </div>
          </div>

          {/* Table of Disclosed Financials from KAP */}
          <div className="fin-card full-width">
            <div className="fin-table-scroll">
              <table className="fin-data-table radar-table">
                <thead>
                  <tr>
                    <th style={{ minWidth: '130px' }}>KAP Açıklama Zamanı</th>
                    <th>Şirket</th>
                    <th>Bilanço Dönemi</th>
                    <th className="num-col">Fiyat</th>
                    <th className="num-col">Günlük %</th>
                    <th className="num-col">Net Kâr Büyümesi</th>
                    <th className="num-col">Ciro Büyümesi</th>
                    <th className="num-col">ROE (Özkaynak Kar.)</th>
                    <th className="num-col">F/K</th>
                    <th className="num-col">PD/DD</th>
                    <th className="num-col">Net Borç/FAVÖK</th>
                    <th style={{ textAlign: 'center' }}>İşlemler</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingDisclosures ? (
                    <tr>
                      <td colSpan={12} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>
                        <div className="fin-spinner" style={{ margin: '0 auto 8px' }} />
                        KAP'tan son bilanço bildirimleri çekiliyor...
                      </td>
                    </tr>
                  ) : filteredEarnings.length === 0 ? (
                    <tr>
                      <td colSpan={12} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>
                        Filtreye uygun bilanço açıklamış şirket bulunamadı.
                      </td>
                    </tr>
                  ) : (
                    filteredEarnings.map((item) => {
                      const eq = item.equity;
                      return (
                        <tr
                          key={item.id}
                          className={`fin-radar-row ${selectedTicker === item.ticker ? 'selected-row' : ''}`}
                          onClick={() => handleOpenDetail(item.ticker)}
                        >
                          <td>
                            <div className="fin-time-group">
                              <span className="fin-disclosure-date">{item.date}</span>
                              <span className="fin-fr-badge">KAP FR</span>
                            </div>
                          </td>
                          <td>
                            <div className="fin-row-name-group">
                              <span className="bold fin-ticker-code">{item.ticker}</span>
                              <span className="fin-row-subname">{item.name}</span>
                            </div>
                          </td>
                          <td>
                            <span className="fin-period-pill newest">
                              {item.period}
                            </span>
                          </td>
                          <td className="num-col">₺{eq?.price?.toFixed(2) ?? '-'}</td>
                          <td className={`num-col ${((eq?.change_pct ?? 0) >= 0) ? 'pos' : 'neg'}`}>
                            {formatPercent(eq?.change_pct)}
                          </td>
                          <td className={`num-col bold ${((eq?.profit_growth ?? 0) >= 0) ? 'pos' : 'neg'}`}>
                            {formatPercent(eq?.profit_growth)}
                          </td>
                          <td className={`num-col ${((eq?.sales_growth ?? 0) >= 0) ? 'pos' : 'neg'}`}>
                            {formatPercent(eq?.sales_growth)}
                          </td>
                          <td className="num-col bold">
                            {eq?.roe ? `${eq.roe.toFixed(1)}%` : '-'}
                          </td>
                          <td className="num-col bold">{eq?.pe ? eq.pe.toFixed(2) : '-'}</td>
                          <td className="num-col">{eq?.pb ? eq.pb.toFixed(2) : '-'}</td>
                          <td className="num-col">{eq?.net_debt_ebitda ? eq.net_debt_ebitda.toFixed(2) : '-'}</td>
                          <td style={{ textAlign: 'center' }}>
                            <div className="fin-actions-cell" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                className="fin-table-kap-btn"
                                title="KAP Bildirimini Görüntüle"
                                onClick={() => setPreviewAnnouncement(item.announcement)}
                              >
                                <ExternalLink size={12} /> KAP
                              </button>
                              <button
                                type="button"
                                className="fin-table-open-btn"
                                onClick={() => handleOpenDetail(item.ticker)}
                              >
                                İncele <ArrowRight size={12} />
                              </button>
                            </div>
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

      {/* KAP Document Viewer Modal */}
      {previewAnnouncement && (
        <KapDocumentViewerModal
          announcement={previewAnnouncement}
          onClose={() => setPreviewAnnouncement(null)}
        />
      )}
    </div>
  );
}
