import { useEffect, useMemo, useState } from 'react';
import { getFinancialStatements } from '../../api/tauriClient';
import { useTranslation } from '../../api/i18n';
import { FinancialStatement, FinancialPeriod } from '../../types';
import { ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

type MetricKind = 'value' | 'ratio';

interface MetricDef {
  key: string;
  /** i18n sözlük anahtarı; görünen ad render sırasında t() ile çözülür. */
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

/// Büyüme yıllıkta bir önceki yıla, çeyreklikte geçen yılın aynı çeyreğine göredir.
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

export default function FinancialsTab({ ticker }: { ticker: string }) {
  const { t, lang } = useTranslation();
  const [data, setData] = useState<FinancialStatement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [periodType, setPeriodType] = useState<'annual' | 'quarterly'>('annual');
  const [selected, setSelected] = useState<string[]>(DEFAULT_SELECTION);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getFinancialStatements(ticker)
      .then(setData)
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [ticker]);

  const periods = periodType === 'annual' ? (data?.annuals ?? []) : (data?.quarterlies ?? []);
  const quarterly = periodType === 'quarterly';

  const chartData = useMemo(() => periods.map((p, index) => {
    const growthLag = quarterly ? 4 : 1;
    const ttmNet = trailingNetIncome(periods, index, quarterly);
    return {
      name: quarterly ? `${p.period.substring(0, 4)}/${p.period.substring(5, 7)}` : p.period.substring(0, 4),
      revenue: p.revenue != null ? p.revenue / 1e6 : null,
      gross_profit: p.gross_profit != null ? p.gross_profit / 1e6 : null,
      operating_income: p.operating_income != null ? p.operating_income / 1e6 : null,
      net_income: p.net_income != null ? p.net_income / 1e6 : null,
      cash_flow: p.operating_cash_flow != null ? p.operating_cash_flow / 1e6 : null,
      free_cash_flow: p.free_cash_flow != null ? p.free_cash_flow / 1e6 : null,
      assets: p.total_assets != null ? p.total_assets / 1e6 : null,
      equity: p.total_equity != null ? p.total_equity / 1e6 : null,
      debt: p.total_debt != null ? p.total_debt / 1e6 : null,
      gross_margin: ratio(p.gross_profit, p.revenue),
      operating_margin: ratio(p.operating_income, p.revenue),
      net_margin: ratio(p.net_income, p.revenue),
      revenue_growth: growth(periods, index, 'revenue', growthLag),
      net_income_growth: growth(periods, index, 'net_income', growthLag),
      roe: ratio(ttmNet, p.total_equity),
    };
  }), [periods, quarterly]);

  if (loading) return <div className="empty-state">{t('loadingData')}</div>;
  if (error) return <div className="empty-state error">{t('errorLabel')}: {error}</div>;
  if (!data) return <div className="empty-state">{t('dataNotFound')}</div>;
  if (periods.length === 0) {
    return <div className="empty-state">{t('finNoStatements')}</div>;
  }

  const formatMillions = (val: number) =>
    new Intl.NumberFormat(lang === 'tr' ? 'tr-TR' : 'en-US', { maximumFractionDigits: 0 }).format(val) + ' M';
  const formatPercent = (val: number) => val.toFixed(1) + '%';

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>{t('finTitle', { currency: data.currency })}</h2>
        <div className="tabs" style={{ display: 'flex', gap: '8px' }}>
          <button
            className={`small-button ${periodType === 'annual' ? 'active' : ''}`}
            onClick={() => setPeriodType('annual')}
            style={{
              padding: '6px 12px', background: periodType === 'annual' ? 'var(--accent-primary)' : 'transparent',
              color: periodType === 'annual' ? '#000' : 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer'
            }}
          >{t('periodYearly')}</button>
          <button
            className={`small-button ${periodType === 'quarterly' ? 'active' : ''}`}
            onClick={() => setPeriodType('quarterly')}
            style={{
              padding: '6px 12px', background: periodType === 'quarterly' ? 'var(--accent-primary)' : 'transparent',
              color: periodType === 'quarterly' ? '#000' : 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer'
            }}
          >{t('finQuarterly')}</button>
        </div>
      </div>

      {/* Serbest grafik: istenen metrikler seçilip tek grafikte incelenir */}
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

        {/* Gelir ve Kâr Tablosu */}
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

        {/* Bilanço Özeti */}
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

        {/* Nakit Akım */}
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

      <p style={{ fontSize: '0.7rem', color: '#8b949e', margin: 0 }}>
        {t('finSourceNote')}
      </p>
    </div>
  );
}
