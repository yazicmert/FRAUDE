import { useEffect, useMemo, useRef, useState } from 'react';
import { getFinancialStatements, getKapForTicker, type StatementCurrency } from '../../api/tauriClient';
import { useTranslation } from '../../api/i18n';
import { FinancialStatement, FinancialPeriod, KapAnnouncement } from '../../types';
import { ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import KapDocumentViewerModal from '../kap/KapDocumentViewerModal';
import FinancialAuditInspectorModal, { type AuditTarget } from './FinancialAuditInspectorModal';
import HoverKapPreviewPopover, { type HoverTargetInfo } from './HoverKapPreviewPopover';
import { openUrl } from '../../lib/openExternal';
import { recordCopilotAction, setCopilotActivePayload } from '../ai/userContext';
import './FinancialsTab.css';

type MetricKind = 'value' | 'ratio';

interface MetricDef {
  key: string;
  labelKey: string;
  kind: MetricKind;
  color: string;
}

const METRICS: MetricDef[] = [
  { key: 'revenue', labelKey: 'finRevenue', kind: 'value', color: '#58a6ff' },
  { key: 'gross_profit', labelKey: 'finGrossProfit', kind: 'value', color: '#3fb950' },
  { key: 'operating_income', labelKey: 'finOperatingIncome', kind: 'value', color: '#ff8c00' },
  { key: 'net_income', labelKey: 'finNetIncome', kind: 'value', color: '#f85149' },
  { key: 'cash_flow', labelKey: 'finCashFlow', kind: 'value', color: '#ffd700' },
  { key: 'free_cash_flow', labelKey: 'finFreeCashFlow', kind: 'value', color: '#e3b341' },
  { key: 'assets', labelKey: 'finAssets', kind: 'value', color: '#8a2be2' },
  { key: 'equity', labelKey: 'finEquity', kind: 'value', color: '#00ced1' },
  { key: 'debt', labelKey: 'finDebt', kind: 'value', color: '#ff7b72' },
  { key: 'gross_margin', labelKey: 'finGrossMargin', kind: 'ratio', color: '#7ee787' },
  { key: 'operating_margin', labelKey: 'finOperatingMargin', kind: 'ratio', color: '#ffa657' },
  { key: 'net_margin', labelKey: 'finNetMargin', kind: 'ratio', color: '#ff9900' },
  { key: 'revenue_growth', labelKey: 'finRevenueGrowth', kind: 'ratio', color: '#a5d6ff' },
  { key: 'net_income_growth', labelKey: 'finNetIncomeGrowth', kind: 'ratio', color: '#ffbedd' },
  { key: 'roe', labelKey: 'finRoe', kind: 'ratio', color: '#d2a8ff' },
];

const metricByKey = new Map(METRICS.map((m) => [m.key, m]));
const DEFAULT_SELECTION = ['revenue', 'net_income', 'net_margin'];

function ratio(numerator?: number | null, denominator?: number | null): number | null {
  if (numerator === null || numerator === undefined) return null;
  if (!denominator) return null;
  return (numerator / denominator) * 100;
}

function growth(periods: FinancialPeriod[], index: number, field: 'revenue' | 'net_income', lag: number): number | null {
  const current = periods[index]?.[field];
  const previous = periods[index - lag]?.[field];
  if (current === null || current === undefined || previous === null || previous === undefined || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function trailingNetIncome(periods: FinancialPeriod[], index: number, quarterly: boolean): number | null {
  if (!quarterly) return periods[index]?.net_income ?? null;
  if (index < 3) return null;
  let sum = 0;
  for (let i = index - 3; i <= index; i++) {
    const value = periods[i]?.net_income;
    if (value === null || value === undefined) return null;
    sum += value;
  }
  return sum;
}

interface TableRowDef {
  key: string;
  label: string;
  category: 'income' | 'balance' | 'cash' | 'ratios';
  categoryLabel: string;
  isBold?: boolean;
  color?: string;
  formatFn: (col: any) => string;
  rawValFn?: (col: any) => number | null | undefined;
}

export interface CompareSelectionItem {
  periodName: string;
  periodRaw: string;
  metricKey: string;
  metricLabel: string;
  formattedValue: string;
  rawValue?: number | null;
}

export default function FinancialsTab({ ticker }: { ticker: string }) {
  const { t, lang } = useTranslation();
  const [data, setData] = useState<FinancialStatement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [periodType, setPeriodType] = useState<'annual' | 'quarterly'>('annual');
  const [currency, setCurrency] = useState<StatementCurrency>('TRY');
  const [selected, setSelected] = useState<string[]>(DEFAULT_SELECTION);
  const [viewFormat, setViewFormat] = useState<'both' | 'chart' | 'table'>('both');

  // Tablo Filtreleri & AI Karşılaştırma Modu
  const [tableCategory, setTableCategory] = useState<'all' | 'income' | 'balance' | 'cash' | 'ratios'>('all');
  const [tableMaxPeriods, setTableMaxPeriods] = useState<number>(8);
  const [tableSearch, setTableSearch] = useState<string>('');
  const [selectedCompareItems, setSelectedCompareItems] = useState<CompareSelectionItem[]>([]);
  const isCmdFPressedRef = useRef(false);

  // Cmd+F veya Ctrl+F (FRAUDE AI Seçim Modu) ikisi aynı anda basılı iken tıklama takibi
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const keyStr = e.key ? e.key.toLowerCase() : '';
      if ((e.metaKey || e.ctrlKey) && keyStr === 'f') {
        isCmdFPressedRef.current = true;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const keyStr = e.key ? e.key.toLowerCase() : '';
      if (keyStr === 'f' || (!e.metaKey && !e.ctrlKey)) {
        isCmdFPressedRef.current = false;
      }
    };
    const handleBlur = () => {
      isCmdFPressedRef.current = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  // KAP Bildirimleri ve Fare Önizlemesi
  const [kapDisclosures, setKapDisclosures] = useState<KapAnnouncement[]>([]);
  const [activeKapModal, setActiveKapModal] = useState<KapAnnouncement | null>(null);
  const [activeFocusRow, setActiveFocusRow] = useState<import('../kap/KapDocumentViewerModal').TargetFocusRow | null>(null);
  const [auditTarget, setAuditTarget] = useState<AuditTarget | null>(null);
  const [hoverInfo, setHoverInfo] = useState<HoverTargetInfo | null>(null);
  const [isPopoverHovered, setIsPopoverHovered] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    let cancelled = false;
    getFinancialStatements(ticker, currency)
      .then((statement) => { if (!cancelled) setData(statement); })
      .catch((err) => { if (!cancelled) setError(String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker, currency]);

  useEffect(() => {
    if (ticker) {
      getKapForTicker(ticker)
        .then((items) => setKapDisclosures(items || []))
        .catch(() => setKapDisclosures([]));
    }
  }, [ticker]);

  const kapFinancials = useMemo(() => {
    return kapDisclosures.filter((d) => {
      const cat = (d.category || '').toLowerCase();
      const title = (d.title || '').toLowerCase();
      const subj = (d.summary || '').toLowerCase();
      return (
        cat.includes('fr') ||
        cat.includes('finansal') ||
        title.includes('finansal') ||
        title.includes('bilanço') ||
        title.includes('faaliyet') ||
        title.includes('sorumluluk') ||
        subj.includes('çeyrek') ||
        subj.includes('finansal')
      );
    });
  }, [kapDisclosures]);

  const findKapForPeriod = (_colName: string, colPeriodRaw: string): KapAnnouncement => {
    const raw = colPeriodRaw || '';
    const year = raw.length >= 4 ? raw.substring(0, 4) : '2025';
    const month = raw.length >= 7 ? raw.substring(5, 7) : '12';

    // 1. Önce hem yılı hem de finansal rapor kategorisini uyan ilanları filtrele
    const yearMatches = (kapDisclosures || []).filter((d) => {
      if (!d || !d.id) return false;
      const numericId = (d.id || '').replace(/[^0-9]/g, '');
      if (numericId.length < 5) return false;
      const text = `${d.title || ''} ${d.summary || ''} ${d.date || ''}`.toLowerCase();
      return text.includes(year) || (d.date || '').includes(year);
    });

    // 2. Çeyrek / Yıllık tam eşleşmesi olan bildirimi bul
    const match = yearMatches.find((d) => {
      const text = `${d.title || ''} ${d.summary || ''} ${d.date || ''}`.toLowerCase();
      if (month === '03' && (text.includes('1.') || text.includes('3 ay') || text.includes('.03.'))) return true;
      if (month === '06' && (text.includes('2.') || text.includes('6 ay') || text.includes('.06.'))) return true;
      if (month === '09' && (text.includes('3.') || text.includes('9 ay') || text.includes('.09.'))) return true;
      if (month === '12' && (text.includes('4.') || text.includes('yıllık') || text.includes('12 ay') || text.includes('.12.'))) return true;
      return false;
    });

    if (match) return match;
    if (yearMatches.length > 0) return yearMatches[0];

    const cleanTicker = (ticker || '').replace('.IS', '');
    return {
      id: `KAP-ANNUAL-${cleanTicker}-${year}`,
      ticker: cleanTicker,
      title: `${cleanTicker} ${year} Dönemi Resmî KAP Finansal Rapor Bildirimi`,
      date: raw || `${year}-12-31`,
      category: 'FR',
      summary: `${cleanTicker} ${year} Yılı Bilanço ve Gelir Tablosu KAP Arşivi`,
      url: `https://www.kap.org.tr/tr/sirket-bilgileri/ozet/${cleanTicker}`,
      ai_importance_score: 95,
      attachment_count: 1,
    };
  };

  const periods = periodType === 'annual' ? (data?.annuals ?? []) : (data?.quarterlies ?? []);
  const quarterly = periodType === 'quarterly';

  const chartData = useMemo(() => {
    const rawList = (periods || []).map((p, index) => {
      const pPeriod = p?.period || '';

      const rev = p?.revenue != null ? p.revenue / 1e6 : null;
      const gross = p?.gross_profit != null ? p.gross_profit / 1e6 : null;
      const opInc = p?.operating_income != null ? p.operating_income / 1e6 : null;
      const netInc = p?.net_income != null ? p.net_income / 1e6 : null;
      const ast = p?.total_assets != null ? p.total_assets / 1e6 : null;
      const eq = p?.total_equity != null ? p.total_equity / 1e6 : null;
      const dbt = p?.total_debt != null ? p.total_debt / 1e6 : null;
      const cf = p?.operating_cash_flow != null ? p.operating_cash_flow / 1e6 : null;
      const fcf = p?.free_cash_flow != null ? p.free_cash_flow / 1e6 : null;

      // Bilançosu henüz gelmemiş boş çeyrekleri veya tüm verisi null olan dönemleri eliyoruz
      if (rev === null && netInc === null && ast === null && gross === null) {
        return null;
      }

      let yearStr = '';
      let monthStr = '';
      if (/^\d{4}-\d{2}/.test(pPeriod)) {
        yearStr = pPeriod.substring(0, 4);
        monthStr = pPeriod.substring(5, 7);
      } else if (/^\d{2}\.\d{2}\.\d{4}/.test(pPeriod)) {
        yearStr = pPeriod.substring(6, 10);
        monthStr = pPeriod.substring(3, 5);
      } else {
        const match = pPeriod.match(/\b(19|20)\d{2}\b/);
        if (match) {
          yearStr = match[0];
          monthStr = '12';
        }
      }

      if (!yearStr || parseInt(yearStr, 10) < 2000) {
        return null;
      }

      // Çeyreklik modda sadece 03, 06, 09, 12 standart çeyrek sonu aylarını kabul et!
      const VALID_QUARTER_MONTHS = new Set(['03', '06', '09', '12']);
      if (quarterly && !VALID_QUARTER_MONTHS.has(monthStr)) {
        return null;
      }

      const growthLag = quarterly ? 4 : 1;
      const ttmNet = trailingNetIncome(periods, index, quarterly);

      return {
        periodRaw: pPeriod,
        name: quarterly ? `${yearStr}/${monthStr}` : yearStr,
        revenue: rev,
        gross_profit: gross,
        operating_income: opInc,
        net_income: netInc,
        cash_flow: cf,
        free_cash_flow: fcf,
        assets: ast,
        equity: eq,
        debt: dbt,
        gross_margin: ratio(p?.gross_profit, p?.revenue),
        operating_margin: ratio(p?.operating_income, p?.revenue),
        net_margin: ratio(p?.net_income, p?.revenue),
        revenue_growth: growth(periods, index, 'revenue', growthLag),
        net_income_growth: growth(periods, index, 'net_income', growthLag),
        roe: ratio(ttmNet, p?.total_equity),
      };
    });

    return rawList.filter((item): item is NonNullable<typeof item> => item !== null);
  }, [periods, quarterly]);

  const formatMillions = (val: number | null | undefined) => {
    if (val === null || val === undefined) return '—';
    const num = new Intl.NumberFormat(lang === 'tr' ? 'tr-TR' : 'en-US', { maximumFractionDigits: 0 }).format(val);
    return `${num} M`;
  };

  const formatPercent = (val: number | null | undefined) => {
    if (val === null || val === undefined) return '—';
    const prefix = val > 0 ? '+' : '';
    return `${prefix}${val.toFixed(1)}%`;
  };

  const tableRows: TableRowDef[] = useMemo(() => [
    { key: 'revenue', label: 'Hasılat (Satış Gelirleri)', category: 'income', categoryLabel: '📈 GELİR TABLOSU', isBold: true, color: '#e6f7ff', formatFn: (c) => formatMillions(c?.revenue), rawValFn: (c) => c?.revenue },
    { key: 'gross_profit', label: 'Brüt Kâr', category: 'income', categoryLabel: '📈 GELİR TABLOSU', color: '#3fb950', formatFn: (c) => formatMillions(c?.gross_profit), rawValFn: (c) => c?.gross_profit },
    { key: 'operating_income', label: 'Faaliyet Kârı (EBIT)', category: 'income', categoryLabel: '📈 GELİR TABLOSU', color: '#ff8c00', formatFn: (c) => formatMillions(c?.operating_income), rawValFn: (c) => c?.operating_income },
    { key: 'net_income', label: 'Net Dönem Kârı', category: 'income', categoryLabel: '📈 GELİR TABLOSU', isBold: true, color: '#00ff9d', formatFn: (c) => formatMillions(c?.net_income), rawValFn: (c) => c?.net_income },
    { key: 'gross_margin', label: 'Brüt Kâr Marjı (%)', category: 'income', categoryLabel: '📈 GELİR TABLOSU', color: '#7ee787', formatFn: (c) => formatPercent(c?.gross_margin), rawValFn: (c) => c?.gross_margin },
    { key: 'operating_margin', label: 'Faaliyet Marjı (%)', category: 'income', categoryLabel: '📈 GELİR TABLOSU', color: '#ffa657', formatFn: (c) => formatPercent(c?.operating_margin), rawValFn: (c) => c?.operating_margin },
    { key: 'net_margin', label: 'Net Kâr Marjı (%)', category: 'income', categoryLabel: '📈 GELİR TABLOSU', isBold: true, color: '#ff9900', formatFn: (c) => formatPercent(c?.net_margin), rawValFn: (c) => c?.net_margin },

    { key: 'assets', label: 'Toplam Varlıklar (Aktifler)', category: 'balance', categoryLabel: '🏛️ BİLANÇO KALEMLERİ', color: '#c084fc', formatFn: (c) => formatMillions(c?.assets), rawValFn: (c) => c?.assets },
    { key: 'equity', label: 'Özkaynaklar (Net Varlıklar)', category: 'balance', categoryLabel: '🏛️ BİLANÇO KALEMLERİ', isBold: true, color: '#00ced1', formatFn: (c) => formatMillions(c?.equity), rawValFn: (c) => c?.equity },
    { key: 'debt', label: 'Finansal Borçlar', category: 'balance', categoryLabel: '🏛️ BİLANÇO KALEMLERİ', color: '#ff7b72', formatFn: (c) => formatMillions(c?.debt), rawValFn: (c) => c?.debt },

    { key: 'cash_flow', label: 'İşletme Nakit Akışı', category: 'cash', categoryLabel: '💵 NAKİT AKIŞ KALEMLERİ', color: '#ffd700', formatFn: (c) => formatMillions(c?.cash_flow), rawValFn: (c) => c?.cash_flow },
    { key: 'free_cash_flow', label: 'Serbest Nakit Akışı (FCF)', category: 'cash', categoryLabel: '💵 NAKİT AKIŞ KALEMLERİ', isBold: true, color: '#e3b341', formatFn: (c) => formatMillions(c?.free_cash_flow), rawValFn: (c) => c?.free_cash_flow },

    { key: 'roe', label: 'Özsermaye Kârlılığı (ROE %)', category: 'ratios', categoryLabel: '📊 RASYOLAR & BÜYÜME', isBold: true, color: '#d2a8ff', formatFn: (c) => formatPercent(c?.roe), rawValFn: (c) => c?.roe },
    { key: 'revenue_growth', label: 'Yıllık Hasılat Büyümesi (%)', category: 'ratios', categoryLabel: '📊 RASYOLAR & BÜYÜME', color: '#a5d6ff', formatFn: (c) => formatPercent(c?.revenue_growth), rawValFn: (c) => c?.revenue_growth },
    { key: 'net_income_growth', label: 'Yıllık Net Kâr Büyümesi (%)', category: 'ratios', categoryLabel: '📊 RASYOLAR & BÜYÜME', color: '#ffbedd', formatFn: (c) => formatPercent(c?.net_income_growth), rawValFn: (c) => c?.net_income_growth },
  ], [lang]);

  const filteredRows = useMemo(() => {
    return tableRows.filter((row) => {
      if (tableCategory !== 'all' && row.category !== tableCategory) {
        return false;
      }
      if (tableSearch.trim() !== '') {
        const query = tableSearch.toLowerCase();
        return row.label.toLowerCase().includes(query) || row.key.toLowerCase().includes(query);
      }
      return true;
    });
  }, [tableRows, tableCategory, tableSearch]);

  const filteredColumns = useMemo(() => {
    const desc = [...chartData].reverse();
    if (tableMaxPeriods > 0) {
      return desc.slice(0, tableMaxPeriods);
    }
    return desc;
  }, [chartData, tableMaxPeriods]);

  if (loading) return <div className="empty-state">{t('loadingData')}</div>;
  if (error) return <div className="empty-state error">{t('errorLabel')}: {error}</div>;
  if (!data) return <div className="empty-state">{t('dataNotFound')}</div>;

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    return (
      <div style={{ backgroundColor: 'rgba(22, 27, 34, 0.95)', border: '1px solid #30363d', padding: '12px', borderRadius: '6px', color: '#c9d1d9', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
        <p style={{ margin: '0 0 8px 0', fontWeight: 'bold', color: '#fff', borderBottom: '1px solid #30363d', paddingBottom: '4px' }}>{label}</p>
        {payload.filter((entry: any) => entry.value !== null && entry.value !== undefined).map((entry: any, index: number) => {
          const metric = metricByKey.get(entry.dataKey);
          const isRatio = metric ? metric.kind === 'ratio' : String(entry.name).includes('%');
          return (
            <div key={index} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', gap: '16px' }}>
              <span style={{ color: entry.color }}>{entry.name}:</span>
              <span style={{ fontWeight: 'bold', color: '#fff' }}>
                {isRatio ? formatPercent(entry.value) : formatMillions(entry.value)}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  const toggleMetric = (key: string) => {
    setSelected((current) => current.includes(key) ? current.filter((k) => k !== key) : [...current, key]);
  };

  const selectedDefs = METRICS.filter((m) => selected.includes(m.key));
  const hasRatio = selectedDefs.some((m) => m.kind === 'ratio');
  const hasValue = selectedDefs.some((m) => m.kind === 'value');

  const chipStyle = (metric: MetricDef, active: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: '6px',
    padding: '4px 10px', borderRadius: '14px', fontSize: '0.75rem', cursor: 'pointer',
    background: active ? `${metric.color}26` : 'transparent',
    color: active ? metric.color : '#8b949e',
    border: `1px solid ${active ? `${metric.color}66` : '#30363d'}`,
    fontWeight: active ? 'bold' : 'normal',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* ── Üst Araç Çubuğu ve Görünüm Kontrolleri ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <h2>{t('finTitle', { currency: data.currency })} ({ticker})</h2>

        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="tabs" style={{ display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.05)', padding: '3px', borderRadius: '6px' }}>
            <button
              type="button"
              className={`small-button ${viewFormat === 'both' ? 'active' : ''}`}
              onClick={() => setViewFormat('both')}
              style={{
                padding: '5px 10px', background: viewFormat === 'both' ? '#00ff9d' : 'transparent',
                color: viewFormat === 'both' ? '#000' : '#8b949e', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.76rem'
              }}
            >
              📊 Tablo & Grafik
            </button>
            <button
              type="button"
              className={`small-button ${viewFormat === 'table' ? 'active' : ''}`}
              onClick={() => setViewFormat('table')}
              style={{
                padding: '5px 10px', background: viewFormat === 'table' ? '#00ff9d' : 'transparent',
                color: viewFormat === 'table' ? '#000' : '#8b949e', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.76rem'
              }}
            >
              📋 Sadece Tablo
            </button>
            <button
              type="button"
              className={`small-button ${viewFormat === 'chart' ? 'active' : ''}`}
              onClick={() => setViewFormat('chart')}
              style={{
                padding: '5px 10px', background: viewFormat === 'chart' ? '#00ff9d' : 'transparent',
                color: viewFormat === 'chart' ? '#000' : '#8b949e', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.76rem'
              }}
            >
              📈 Sadece Grafik
            </button>
          </div>

          <div className="tabs" style={{ display: 'flex', gap: '6px' }}>
            {(['TRY', 'USD'] as StatementCurrency[]).map((code) => (
              <button
                key={code}
                type="button"
                className={`small-button ${currency === code ? 'active' : ''}`}
                onClick={() => setCurrency(code)}
                title={t('finCurrencyHint')}
                style={{
                  padding: '5px 12px', background: currency === code ? 'var(--accent-primary)' : 'transparent',
                  color: currency === code ? '#000' : 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold'
                }}
              >{code}</button>
            ))}
          </div>

          <div className="tabs" style={{ display: 'flex', gap: '6px' }}>
            <button
              className={`small-button ${periodType === 'annual' ? 'active' : ''}`}
              onClick={() => setPeriodType('annual')}
              style={{
                padding: '5px 12px', background: periodType === 'annual' ? 'var(--accent-primary)' : 'transparent',
                color: periodType === 'annual' ? '#000' : 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold'
              }}
            >{t('periodYearly')}</button>
            <button
              className={`small-button ${periodType === 'quarterly' ? 'active' : ''}`}
              onClick={() => setPeriodType('quarterly')}
              style={{
                padding: '5px 12px', background: periodType === 'quarterly' ? 'var(--accent-primary)' : 'transparent',
                color: periodType === 'quarterly' ? '#000' : 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold'
              }}
            >{t('finQuarterly')}</button>
          </div>
        </div>
      </div>

      {/* ── KAP Resmî Finansal Raporlar & Bilanço Ekleri Paneli ── */}
      <section className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
          <h3 style={{ fontSize: '1rem', margin: 0, color: '#00ff9d', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>⚖️ KAP Resmî Finansal Raporlar & Bilanço Bildirimleri ({ticker})</span>
          </h3>
          <span style={{ fontSize: '0.75rem', color: '#8b949e' }}>
            Kamuyu Aydınlatma Platformu resmî arşivinden finansal tablolar ve Excel/PDF indirme linkleri
          </span>
        </div>

        {kapFinancials.length === 0 ? (
          <div style={{ padding: '16px', textAlign: 'center', color: '#8b949e', fontSize: '0.82rem', background: 'rgba(255,255,255,0.02)', borderRadius: '6px' }}>
            💡 Bu şirket için yakında yayımlanmış KAP finansal rapor bildirimi henüz çekilmedi.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {kapFinancials.map((ann) => {
              const cleanId = ann.id.replace(/[^0-9]/g, '');
              const excelExportUrl = `https://www.kap.org.tr/tr/api/notification/export/excel/${cleanId}`;
              const pdfExportUrl = `https://www.kap.org.tr/tr/api/BildirimPdf/${cleanId}`;

              return (
                <div
                  key={ann.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 16px',
                    background: 'rgba(22, 27, 34, 0.6)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '8px',
                    flexWrap: 'wrap',
                    gap: '12px'
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: '240px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{
                        fontSize: '0.7rem',
                        padding: '2px 6px',
                        background: 'rgba(0, 255, 157, 0.15)',
                        color: '#00ff9d',
                        border: '1px solid rgba(0, 255, 157, 0.3)',
                        borderRadius: '4px',
                        fontWeight: 'bold',
                        fontFamily: 'monospace'
                      }}>
                        {ann.category || 'FR'}
                      </span>
                      <strong style={{ fontSize: '0.88rem', color: '#e6f7ff' }}>{ann.title}</strong>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#8b949e' }}>
                      📅 {ann.date} {ann.summary ? `· ${ann.summary}` : ''}
                      {ann.attachment_count > 0 && (
                        <span style={{ marginLeft: '8px', color: '#7ee787', fontWeight: 'bold' }}>
                          📎 {ann.attachment_count} Ek Dosya
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                      type="button"
                      className="small-button"
                      onClick={() => setActiveKapModal(ann)}
                      style={{
                        background: 'rgba(0, 255, 157, 0.15)',
                        border: '1px solid #00ff9d',
                        color: '#00ff9d',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        fontSize: '0.78rem',
                        fontWeight: 'bold',
                        cursor: 'pointer'
                      }}
                    >
                      👁️ KAP Önizle
                    </button>
                    <button
                      type="button"
                      className="small-button"
                      onClick={() => void openUrl(excelExportUrl)}
                      style={{
                        background: 'rgba(35, 134, 54, 0.2)',
                        border: '1px solid #2ea043',
                        color: '#7ee787',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        fontSize: '0.78rem',
                        fontWeight: 'bold',
                        cursor: 'pointer'
                      }}
                      title="KAP Bilanço Excel İndir (.xlsx)"
                    >
                      📊 Excel (.xlsx) ↗
                    </button>
                    <button
                      type="button"
                      className="small-button"
                      onClick={() => void openUrl(pdfExportUrl)}
                      style={{
                        background: 'rgba(88, 166, 255, 0.15)',
                        border: '1px solid #58a6ff',
                        color: '#58a6ff',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        fontSize: '0.78rem',
                        fontWeight: 'bold',
                        cursor: 'pointer'
                      }}
                      title="KAP Bilanço PDF İndir"
                    >
                      📄 PDF ↗
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── SADE & İNTERAKTİF MALİ TABLO (CANLI FARE ÖNİZLEMELİ) ── */}
      {(viewFormat === 'table' || viewFormat === 'both') && (
        <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <h3 style={{ fontSize: '0.95rem', margin: 0, color: '#e6f7ff', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>📋 Finansal Veri Tablosu</span>
              <span style={{ fontSize: '0.75rem', color: '#8b949e', fontWeight: 'normal' }}>
                ({periodType === 'quarterly' ? 'Çeyreklik' : 'Yıllık'} · Milyon {currency} · 💡 Farenizle rakamın üstüne gelerek KAP bildirimi canlı eklerini görebilirsiniz)
              </span>
            </h3>

            <div style={{ position: 'relative', minWidth: '220px' }}>
              <input
                type="text"
                placeholder="🔍 Kalem ara (Hasılat, Net Kâr...)"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 12px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '6px',
                  color: '#ffffff',
                  fontSize: '0.78rem',
                  outline: 'none'
                }}
              />
              {tableSearch && (
                <button
                  type="button"
                  onClick={() => setTableSearch('')}
                  style={{
                    position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
                    background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '0.8rem'
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {[
                { id: 'all', label: 'Tümü' },
                { id: 'income', label: '📈 Gelir Tablosu' },
                { id: 'balance', label: '🏛️ Bilanço' },
                { id: 'cash', label: '💵 Nakit Akışı' },
                { id: 'ratios', label: '📊 Rasyolar' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setTableCategory(tab.id as any)}
                  style={{
                    padding: '4px 10px',
                    fontSize: '0.74rem',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    background: tableCategory === tab.id ? 'rgba(0, 255, 157, 0.15)' : 'transparent',
                    color: tableCategory === tab.id ? '#00ff9d' : '#8b949e',
                    border: `1px solid ${tableCategory === tab.id ? '#00ff9d' : 'transparent'}`,
                    fontWeight: tableCategory === tab.id ? 'bold' : 'normal'
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '3px', background: 'rgba(255,255,255,0.05)', padding: '2px', borderRadius: '5px' }}>
                <button
                  type="button"
                  onClick={() => setPeriodType('annual')}
                  style={{
                    padding: '3px 8px',
                    fontSize: '0.72rem',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    background: periodType === 'annual' ? '#00ff9d' : 'transparent',
                    color: periodType === 'annual' ? '#000' : '#8b949e',
                    border: 'none',
                    fontWeight: periodType === 'annual' ? 'bold' : 'normal'
                  }}
                >
                  📅 Yıllık
                </button>
                <button
                  type="button"
                  onClick={() => setPeriodType('quarterly')}
                  style={{
                    padding: '3px 8px',
                    fontSize: '0.72rem',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    background: periodType === 'quarterly' ? '#00ff9d' : 'transparent',
                    color: periodType === 'quarterly' ? '#000' : '#8b949e',
                    border: 'none',
                    fontWeight: periodType === 'quarterly' ? 'bold' : 'normal'
                  }}
                >
                  ⏱️ Çeyreklik (3-Aylık)
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.74rem', color: '#8b949e' }}>
                <span>Gösterim:</span>
                {[
                  { val: 4, label: 'Son 4' },
                  { val: 8, label: 'Son 8' },
                  { val: 12, label: 'Son 12' },
                  { val: 0, label: 'Tümü' },
                ].map((opt) => (
                  <button
                    key={opt.val}
                    type="button"
                    onClick={() => setTableMaxPeriods(opt.val)}
                    style={{
                      padding: '2px 6px',
                      fontSize: '0.7rem',
                      borderRadius: '3px',
                      cursor: 'pointer',
                      background: tableMaxPeriods === opt.val ? 'rgba(88, 166, 255, 0.2)' : 'transparent',
                      color: tableMaxPeriods === opt.val ? '#58a6ff' : '#8b949e',
                      border: 'none',
                      fontWeight: tableMaxPeriods === opt.val ? 'bold' : 'normal'
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={{ overflowX: 'auto', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '6px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', fontFamily: 'var(--font-mono, monospace)' }}>
              <thead>
                <tr style={{ background: 'rgba(22, 27, 34, 0.95)', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
                  <th style={{ padding: '9px 14px', textAlign: 'left', minWidth: '220px', color: '#00ff9d', position: 'sticky', left: 0, background: '#161b22', zIndex: 2 }}>
                    Mali Kalem
                  </th>
                  {filteredColumns.map((col) => {
                    const kapAnn = findKapForPeriod(col.name, col.periodRaw);
                    const isYearSelected = selectedCompareItems.some(
                      (item) => item.periodRaw === col.periodRaw && item.metricKey === 'FULL_PERIOD'
                    );

                    return (
                      <th
                        key={col.name}
                        onClick={(e) => {
                          if ((e.metaKey || e.ctrlKey) && isCmdFPressedRef.current) {
                            e.preventDefault();
                            const newItem: CompareSelectionItem = {
                              periodName: col.name,
                              periodRaw: col.periodRaw,
                              metricKey: 'FULL_PERIOD',
                              metricLabel: `${col.name} Dönemi`,
                              formattedValue: `(Hasılat: ${formatMillions(col.revenue)} · Net Kâr: ${formatMillions(col.net_income)})`,
                              rawValue: col.revenue,
                            };
                            setSelectedCompareItems((prev) => {
                              const exists = prev.find((i) => i.periodRaw === newItem.periodRaw && i.metricKey === 'FULL_PERIOD');
                              let updated: CompareSelectionItem[];
                              if (exists) {
                                updated = prev.filter((i) => !(i.periodRaw === newItem.periodRaw && i.metricKey === 'FULL_PERIOD'));
                              } else {
                                updated = prev.length >= 2 ? [prev[1], newItem] : [...prev, newItem];
                              }
                              if (updated.length === 2) {
                                setCopilotActivePayload({
                                  type: 'AI_VARIABLE_COMPARISON',
                                  ticker,
                                  comparisonSummary: `${ticker} ${updated[0].periodName} (${updated[0].formattedValue}) vs ${updated[1].periodName} (${updated[1].formattedValue})`,
                                  item1: updated[0],
                                  item2: updated[1],
                                });
                                recordCopilotAction(`Seçili 2 Yıl: [${updated[0].periodName}] vs [${updated[1].periodName}]`);
                              } else {
                                setCopilotActivePayload(null);
                              }
                              return updated;
                            });
                          } else {
                            setActiveKapModal(kapAnn);
                          }
                        }}
                        title={`⚖️ Cmd+Tıklama: Dönem Seç (AI) | Normal Tıklama: KAP Bildirimi Aç (${kapAnn.title})`}
                        style={{
                          padding: '9px 12px',
                          textAlign: 'right',
                          minWidth: '95px',
                          color: isYearSelected ? '#00ff9d' : '#58a6ff',
                          fontWeight: 'bold',
                          cursor: 'pointer',
                          userSelect: 'none',
                          background: isYearSelected ? 'rgba(0, 255, 157, 0.25)' : 'transparent',
                          boxShadow: isYearSelected ? 'inset 0 0 0 2px #00ff9d' : 'none',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                          <span>{col.name}</span>
                          <span style={{ fontSize: '0.65rem', opacity: 0.6 }}>{isYearSelected ? '📌' : '🔍'}</span>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={filteredColumns.length + 1} style={{ padding: '24px', textAlign: 'center', color: '#8b949e' }}>
                      Aranan kritere uygun mali kalem bulunamadı.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => (
                    <tr
                      key={row.key}
                      style={{
                        borderBottom: '1px solid rgba(255, 255, 255, 0.03)',
                        background: row.isBold ? 'rgba(255, 255, 255, 0.02)' : 'transparent'
                      }}
                    >
                      <td
                        style={{
                          padding: '8px 14px',
                          color: row.color || '#c9d1d9',
                          fontWeight: row.isBold ? 'bold' : 'normal',
                          position: 'sticky',
                          left: 0,
                          background: '#161b22',
                          zIndex: 1,
                          borderRight: '1px solid rgba(255, 255, 255, 0.04)'
                        }}
                      >
                        {row.label}
                      </td>
                      {filteredColumns.map((col, colIdx) => {
                        const rawVal = row.rawValFn ? row.rawValFn(col) : null;
                        const isNegative = rawVal !== null && rawVal !== undefined && rawVal < 0;
                        const kapAnn = findKapForPeriod(col.name, col.periodRaw);
                        const formatted = row.formatFn(col);
                        const prevCol = filteredColumns[colIdx + 1];

                        const isSelectedForCompare = selectedCompareItems.some(
                          (item) => (item.periodRaw === col.periodRaw && item.metricKey === row.key) || (item.periodRaw === col.periodRaw && item.metricKey === 'FULL_PERIOD')
                        );

                        return (
                          <td
                            key={col.name}
                            onClick={(e) => {
                              if ((e.metaKey || e.ctrlKey) && isCmdFPressedRef.current) {
                                e.preventDefault();
                                const newItem: CompareSelectionItem = {
                                  periodName: col.name,
                                  periodRaw: col.periodRaw,
                                  metricKey: row.key,
                                  metricLabel: row.label,
                                  formattedValue: formatted,
                                  rawValue: rawVal,
                                };
                                setSelectedCompareItems((prev) => {
                                  const exists = prev.find((i) => i.periodRaw === newItem.periodRaw && i.metricKey === newItem.metricKey);
                                  let updated: CompareSelectionItem[];
                                  if (exists) {
                                    updated = prev.filter((i) => !(i.periodRaw === newItem.periodRaw && i.metricKey === newItem.metricKey));
                                  } else {
                                    updated = prev.length >= 2 ? [prev[1], newItem] : [...prev, newItem];
                                  }
                                  if (updated.length === 2) {
                                    setCopilotActivePayload({
                                      type: 'AI_VARIABLE_COMPARISON',
                                      ticker,
                                      comparisonSummary: `${ticker} ${updated[0].periodName} (${updated[0].metricLabel}: ${updated[0].formattedValue}) vs ${updated[1].periodName} (${updated[1].metricLabel}: ${updated[1].formattedValue})`,
                                      item1: updated[0],
                                      item2: updated[1],
                                    });
                                    recordCopilotAction(`Seçili 2 Değişken: [${updated[0].periodName} ${updated[0].metricLabel}] vs [${updated[1].periodName} ${updated[1].metricLabel}]`);
                                  } else {
                                    setCopilotActivePayload(null);
                                  }
                                  return updated;
                                });
                              } else {
                                setAuditTarget({
                                  metricKey: row.key,
                                  metricLabel: row.label,
                                  periodName: col.name,
                                  periodRaw: col.periodRaw,
                                  value: rawVal,
                                  formattedValue: formatted,
                                  currency: currency,
                                  periodType: periodType,
                                  colData: col,
                                  prevColData: prevCol,
                                  kapAnnouncement: kapAnn,
                                });
                              }
                            }}
                            onMouseEnter={(e) => {
                              if (isPopoverHovered) return;
                              (e.currentTarget as HTMLElement).style.background = isSelectedForCompare ? 'rgba(0, 255, 157, 0.35)' : 'rgba(0, 255, 157, 0.15)';
                              setHoverInfo({
                                metricLabel: row.label,
                                periodName: col.name,
                                periodRaw: col.periodRaw,
                                formattedValue: formatted,
                                currency: currency,
                                kapAnnouncement: kapAnn,
                                x: e.clientX,
                                y: e.clientY,
                              });
                            }}
                            onMouseLeave={(e) => {
                              (e.currentTarget as HTMLElement).style.background = isSelectedForCompare ? 'rgba(0, 255, 157, 0.25)' : 'transparent';
                              if (!isPopoverHovered) {
                                setHoverInfo(null);
                              }
                            }}
                            style={{
                              padding: '8px 12px',
                              textAlign: 'right',
                              color: isNegative ? '#ff7b72' : (row.isBold ? '#ffffff' : '#c9d1d9'),
                              fontWeight: row.isBold ? 'bold' : 'normal',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                              background: isSelectedForCompare ? 'rgba(0, 255, 157, 0.25)' : 'transparent',
                              boxShadow: isSelectedForCompare ? 'inset 0 0 0 2px #00ff9d' : 'none',
                            }}
                          >
                            {formatted}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Grafikler ve Finansal Metrikler ── */}
      {(viewFormat === 'chart' || viewFormat === 'both') && (
        <>
          <section className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
              <h3 style={{ fontSize: '1rem', margin: 0 }}>{t('finFreeChart')}</h3>
              <span style={{ fontSize: '0.72rem', color: '#8b949e' }}>
                {t('finFreeChartHint', { currency: data.currency })}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '12px 0 4px' }}>
              {METRICS.filter((m) => m.kind === 'value').map((m) => (
                <button key={m.key} type="button" style={chipStyle(m, selected.includes(m.key))} onClick={() => toggleMetric(m.key)}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: m.color, display: 'inline-block' }} />
                  {t(m.labelKey)}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
              {METRICS.filter((m) => m.kind === 'ratio').map((m) => (
                <button key={m.key} type="button" style={chipStyle(m, selected.includes(m.key))} onClick={() => toggleMetric(m.key)}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: m.color, display: 'inline-block' }} />
                  {t(m.labelKey)}
                </button>
              ))}
            </div>
            {selectedDefs.length === 0 ? (
              <div className="empty-state" style={{ height: '320px' }}>{t('finPickMetric')}</div>
            ) : (
              <div style={{ height: '380px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 5, right: 0, bottom: 25, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
                    <XAxis dataKey="name" stroke="#8b949e" fontSize={12} tickMargin={10} />
                    {hasValue && <YAxis yAxisId="left" stroke="#8b949e" fontSize={12} />}
                    {hasRatio && <YAxis yAxisId="right" orientation="right" stroke="#8b949e" fontSize={12} tickFormatter={(tick) => `${tick}%`} />}
                    <Tooltip content={<CustomTooltip />} />
                    <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '12px' }} />
                    {selectedDefs.map((m) => m.kind === 'value' ? (
                      <Bar key={m.key} yAxisId="left" dataKey={m.key} name={t(m.labelKey)} fill={m.color} radius={[2, 2, 0, 0]} />
                    ) : (
                      <Line key={m.key} yAxisId={hasRatio ? 'right' : 'left'} type="monotone" dataKey={m.key} name={t(m.labelKey)} stroke={m.color} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            <section className="panel" style={{ height: '350px' }}>
              <h3 style={{ marginBottom: '16px', fontSize: '1rem' }}>{t('finIncomeTitle')}</h3>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 5, right: 0, bottom: 25, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
                  <XAxis dataKey="name" stroke="#8b949e" fontSize={12} tickMargin={10} />
                  <YAxis yAxisId="left" stroke="#8b949e" fontSize={12} tickFormatter={(tick) => `${tick}`} />
                  <YAxis yAxisId="right" orientation="right" stroke="#8b949e" fontSize={12} tickFormatter={(tick) => `${tick}%`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '12px' }} />
                  <Bar yAxisId="left" dataKey="revenue" name={t('finSales')} fill="#58a6ff" radius={[2, 2, 0, 0]} />
                  <Bar yAxisId="left" dataKey="gross_profit" name={t('finGrossProfit')} fill="#3fb950" radius={[2, 2, 0, 0]} />
                  <Bar yAxisId="left" dataKey="net_income" name={t('finNetPeriodProfit')} fill="#f85149" radius={[2, 2, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="net_margin" name={t('finNetMargin')} stroke="#ff9900" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </section>

            <section className="panel" style={{ height: '350px' }}>
              <h3 style={{ marginBottom: '16px', fontSize: '1rem' }}>{t('finBalanceTitle')}</h3>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 25, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
                  <XAxis dataKey="name" stroke="#8b949e" fontSize={12} tickMargin={10} />
                  <YAxis stroke="#8b949e" fontSize={12} tickFormatter={(tick) => `${tick}`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '12px' }} />
                  <Bar dataKey="assets" name={t('finAssets')} fill="#8a2be2" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="equity" name={t('finEquity')} fill="#00ced1" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </section>

            <section className="panel" style={{ height: '350px', gridColumn: 'span 2' }}>
              <h3 style={{ marginBottom: '16px', fontSize: '1rem' }}>{t('finCashFlow')}</h3>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 25, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
                  <XAxis dataKey="name" stroke="#8b949e" fontSize={12} tickMargin={10} />
                  <YAxis stroke="#8b949e" fontSize={12} tickFormatter={(tick) => `${tick}`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '12px' }} />
                  <Bar dataKey="cash_flow" name={t('finOperatingCash')} fill="#ffd700" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="operating_income" name={t('finEbit')} fill="#ff8c00" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </section>
          </div>
        </>
      )}

      <p style={{ fontSize: '0.75rem', color: '#8b949e', margin: 0, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '12px', lineHeight: '1.5' }}>
        ⚖️ <b>Veri Kaynağı:</b> KAP (Kamuyu Aydınlatma Platformu) Resmî Bildirim Arşivi & İş Yatırım Mali Tablo Veri Servisi · Çeyreklik gelir tablosu ve nakit akışı kalemleri kümülatif değerlerden çeyrek bazına ayrıştırılır · ROE çeyreklikte son 4 çeyrek net kârıyla hesaplanır.
      </p>

      {/* KAP Doküman İnceleme Modalı */}
      {activeKapModal && (
        <KapDocumentViewerModal
          announcement={activeKapModal}
          targetFocusRow={activeFocusRow}
          onClose={() => {
            setActiveKapModal(null);
            setActiveFocusRow(null);
          }}
        />
      )}

      {/* Rakam Doğrulama & Hesaplama İspat Kartı Modalı */}
      {auditTarget && (
        <FinancialAuditInspectorModal
          target={auditTarget}
          ticker={ticker}
          onClose={() => setAuditTarget(null)}
          onOpenKapViewer={(ann) => setActiveKapModal(ann)}
        />
      )}

      {/* Live Hover KAP Preview Popover */}
      {hoverInfo && (
        <HoverKapPreviewPopover
          target={hoverInfo}
          ticker={ticker}
          onPopoverMouseEnter={() => setIsPopoverHovered(true)}
          onPopoverMouseLeave={() => {
            setIsPopoverHovered(false);
            setHoverInfo(null);
          }}
          onOpenKapViewer={(ann: KapAnnouncement) => {
            setActiveKapModal(ann);
            setActiveFocusRow({
              label: hoverInfo.metricLabel,
              value: hoverInfo.formattedValue,
              xbrlCode: '1C / 3C',
              section: 'Konsolide Finansal Tablolar',
              page: 'Sayfa 3-4',
            });
          }}
        />
      )}
    </div>
  );
}
