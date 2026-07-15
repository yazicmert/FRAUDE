import { useEffect, useMemo, useState } from 'react';
import { getFinancialStatements } from '../../api/tauriClient';
import { FinancialStatement, FinancialPeriod } from '../../types';
import { ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

type MetricKind = 'value' | 'ratio';

interface MetricDef {
  key: string;
  label: string;
  kind: MetricKind;
  color: string;
}

const METRICS: MetricDef[] = [
  { key: 'revenue', label: 'Hasılat', kind: 'value', color: '#58a6ff' },
  { key: 'gross_profit', label: 'Brüt Kâr', kind: 'value', color: '#3fb950' },
  { key: 'operating_income', label: 'Faaliyet Kârı', kind: 'value', color: '#ff8c00' },
  { key: 'net_income', label: 'Net Kâr', kind: 'value', color: '#f85149' },
  { key: 'cash_flow', label: 'Faaliyet Nakit Akışı', kind: 'value', color: '#ffd700' },
  { key: 'free_cash_flow', label: 'Serbest Nakit Akışı', kind: 'value', color: '#e3b341' },
  { key: 'assets', label: 'Toplam Varlıklar', kind: 'value', color: '#8a2be2' },
  { key: 'equity', label: 'Özkaynaklar', kind: 'value', color: '#00ced1' },
  { key: 'debt', label: 'Finansal Borç', kind: 'value', color: '#ff7b72' },
  { key: 'gross_margin', label: 'Brüt Marj %', kind: 'ratio', color: '#7ee787' },
  { key: 'operating_margin', label: 'Faaliyet Marjı %', kind: 'ratio', color: '#ffa657' },
  { key: 'net_margin', label: 'Net Kâr Marjı %', kind: 'ratio', color: '#ff9900' },
  { key: 'revenue_growth', label: 'Hasılat Büyümesi %', kind: 'ratio', color: '#a5d6ff' },
  { key: 'net_income_growth', label: 'Net Kâr Büyümesi %', kind: 'ratio', color: '#ffbedd' },
  { key: 'roe', label: 'ROE %', kind: 'ratio', color: '#d2a8ff' },
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

  if (loading) return <div className="empty-state">Yükleniyor...</div>;
  if (error) return <div className="empty-state error">Hata: {error}</div>;
  if (!data) return <div className="empty-state">Veri bulunamadı.</div>;
  if (periods.length === 0) {
    return <div className="empty-state">Bu şirket için mali tablo verisi bulunmuyor.</div>;
  }

  const formatMillions = (val: number) =>
    new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(val) + ' M';
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
        <h2>Mali Tablolar (Milyon {data.currency})</h2>
        <div className="tabs" style={{ display: 'flex', gap: '8px' }}>
          <button
            className={`small-button ${periodType === 'annual' ? 'active' : ''}`}
            onClick={() => setPeriodType('annual')}
            style={{
              padding: '6px 12px', background: periodType === 'annual' ? 'var(--accent-primary)' : 'transparent',
              color: periodType === 'annual' ? '#000' : 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer'
            }}
          >Yıllık</button>
          <button
            className={`small-button ${periodType === 'quarterly' ? 'active' : ''}`}
            onClick={() => setPeriodType('quarterly')}
            style={{
              padding: '6px 12px', background: periodType === 'quarterly' ? 'var(--accent-primary)' : 'transparent',
              color: periodType === 'quarterly' ? '#000' : 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer'
            }}
          >Çeyreklik</button>
        </div>
      </div>

      {/* Serbest grafik: istenen metrikler seçilip tek grafikte incelenir */}
      <section className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
          <h3 style={{ fontSize: '1rem', margin: 0 }}>Serbest Grafik</h3>
          <span style={{ fontSize: '0.72rem', color: '#8b949e' }}>
            Tutarlar sol eksende (Milyon {data.currency}), oranlar sağ eksende (%). İstediğiniz metriğe tıklayın.
          </span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '12px 0 4px' }}>
          {METRICS.filter((m) => m.kind === 'value').map((m) => (
            <button key={m.key} type="button" style={chipStyle(m, selected.includes(m.key))} onClick={() => toggleMetric(m.key)}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: m.color, display: 'inline-block' }} />
              {m.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
          {METRICS.filter((m) => m.kind === 'ratio').map((m) => (
            <button key={m.key} type="button" style={chipStyle(m, selected.includes(m.key))} onClick={() => toggleMetric(m.key)}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: m.color, display: 'inline-block' }} />
              {m.label}
            </button>
          ))}
        </div>
        {selectedDefs.length === 0 ? (
          <div className="empty-state" style={{ height: '320px' }}>Grafik için en az bir metrik seçin.</div>
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
                  <Bar key={m.key} yAxisId="left" dataKey={m.key} name={m.label} fill={m.color} radius={[2, 2, 0, 0]} />
                ) : (
                  <Line key={m.key} yAxisId={hasRatio ? 'right' : 'left'} type="monotone" dataKey={m.key} name={m.label} stroke={m.color} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>

        {/* Gelir ve Kâr Tablosu */}
        <section className="panel" style={{ height: '350px' }}>
          <h3 style={{ marginBottom: '16px', fontSize: '1rem' }}>Gelir Tablosu ve Kâr Marjı</h3>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 5, right: 0, bottom: 25, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
              <XAxis dataKey="name" stroke="#8b949e" fontSize={12} tickMargin={10} />
              <YAxis yAxisId="left" stroke="#8b949e" fontSize={12} tickFormatter={(tick) => `${tick}`} />
              <YAxis yAxisId="right" orientation="right" stroke="#8b949e" fontSize={12} tickFormatter={(tick) => `${tick}%`} />
              <Tooltip content={<CustomTooltip />} />
              <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '12px' }} />
              <Bar yAxisId="left" dataKey="revenue" name="Satışlar (Hasılat)" fill="#58a6ff" radius={[2, 2, 0, 0]} />
              <Bar yAxisId="left" dataKey="gross_profit" name="Brüt Kâr" fill="#3fb950" radius={[2, 2, 0, 0]} />
              <Bar yAxisId="left" dataKey="net_income" name="Net Dönem Kârı" fill="#f85149" radius={[2, 2, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="net_margin" name="Net Kâr Marjı %" stroke="#ff9900" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </section>

        {/* Bilanço Özeti */}
        <section className="panel" style={{ height: '350px' }}>
          <h3 style={{ marginBottom: '16px', fontSize: '1rem' }}>Bilanço Özeti (Varlık & Özkaynak)</h3>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 25, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
              <XAxis dataKey="name" stroke="#8b949e" fontSize={12} tickMargin={10} />
              <YAxis stroke="#8b949e" fontSize={12} tickFormatter={(tick) => `${tick}`} />
              <Tooltip content={<CustomTooltip />} />
              <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '12px' }} />
              <Bar dataKey="assets" name="Toplam Varlıklar" fill="#8a2be2" radius={[2, 2, 0, 0]} />
              <Bar dataKey="equity" name="Özkaynaklar" fill="#00ced1" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>

        {/* Nakit Akım */}
        <section className="panel" style={{ height: '350px', gridColumn: 'span 2' }}>
          <h3 style={{ marginBottom: '16px', fontSize: '1rem' }}>Faaliyet Nakit Akışı</h3>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 25, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
              <XAxis dataKey="name" stroke="#8b949e" fontSize={12} tickMargin={10} />
              <YAxis stroke="#8b949e" fontSize={12} tickFormatter={(tick) => `${tick}`} />
              <Tooltip content={<CustomTooltip />} />
              <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '12px' }} />
              <Bar dataKey="cash_flow" name="İşletme Faaliyetlerinden Nakit Akışları" fill="#ffd700" radius={[2, 2, 0, 0]} />
              <Bar dataKey="operating_income" name="Faaliyet Kârı (EBIT)" fill="#ff8c00" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>

      </div>

      <p style={{ fontSize: '0.7rem', color: '#8b949e', margin: 0 }}>
        Kaynak: İş Yatırım mali tablo verileri · Çeyreklik gelir tablosu ve nakit akışı kalemleri kümülatif değerlerden çeyrek bazına ayrıştırılır · ROE çeyreklikte son 4 çeyrek net kârıyla hesaplanır.
      </p>
    </div>
  );
}
