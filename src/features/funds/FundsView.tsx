import { useEffect, useMemo, useState } from 'react';
import {
  getFundReturns,
  getFunds,
  type FundKind,
  type FundReturns,
  type FundRow,
  FUND_KIND_LABELS,
} from '../../api/tauriClient';
import FundDetail from './FundDetail';
import FundCompare from './FundCompare';
import { useTranslation } from '../../api/i18n';

/** Büyük TL tutarlarını okunur kısaltır: 2391178506 → "2,39 mlr ₺" */
export function formatTry(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '—';
  const units: [number, string][] = [
    [1e9, 'mlr'],
    [1e6, 'mn'],
    [1e3, 'bin'],
  ];
  for (const [size, suffix] of units) {
    if (Math.abs(value) >= size) {
      return `${(value / size).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ${suffix} ₺`;
    }
  }
  return `${value.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ₺`;
}

export function formatCount(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString('tr-TR') : '—';
}

type ReturnKey = 'r1m' | 'r3m' | 'r1y';
type SortKey = 'portfolio_size' | 'change_pct' | ReturnKey | 'investor_count' | 'code';

/** Sıralama düğmesi i18n anahtarları; görünen ad render'da t() ile çözülür. */
const SORT_LABEL_KEYS: Record<SortKey, string> = {
  portfolio_size: 'fundSize',
  change_pct: 'fundDaily',
  r1m: 'fund1m',
  r3m: 'fund3m',
  r1y: 'fund1y',
  investor_count: 'fundInvestors',
  code: 'fundCode',
};

const RETURN_KEYS: ReturnKey[] = ['r1m', 'r3m', 'r1y'];
/** Karşılaştırma grafiğine aynı anda en fazla bu kadar fon alınır. */
const COMPARE_LIMIT = 3;

export default function FundsView() {
  const { t } = useTranslation();
  const [funds, setFunds] = useState<FundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<FundKind | 'ALL'>('YAT');
  const [sort, setSort] = useState<SortKey>('portfolio_size');
  const [selected, setSelected] = useState<FundRow | null>(null);
  const [returns, setReturns] = useState<Map<string, FundReturns>>(new Map());
  const [returnsReady, setReturnsReady] = useState(false);
  const [compare, setCompare] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  // Getiriler liste geldikten SONRA istenir, paralel değil: TEFAS dakikada 6
  // istekle sınırlı ve iki çağrı aynı bütçeyi paylaşıyor. Paralel başlarken
  // getiri hattı (15 istek) ilk pencerenin haklarını kapabiliyor ve 5 isteklik
  // liste dakikalarca throttle kuyruğunda bekliyordu ("fonlar yüklenmedi").
  // Sıralı akışta liste ilk pencerede saniyeler içinde gelir; getiriler arka
  // planda tamamlanınca kolonlar dolar.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const rows = await getFunds();
        if (cancelled) return;
        setFunds(rows);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
          setLoading(false);
        }
        return; // liste yokken getiri istemek bütçeyi boşa harcar
      }
      try {
        const rows = await getFundReturns();
        if (cancelled) return;
        setReturns(new Map(rows.map((row) => [row.code, row])));
      } catch {
        // getiri kolonları boş kalır; liste kullanılabilir durumdadır
      }
      if (!cancelled) setReturnsReady(true);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleCompare = (code: string) => {
    setCompare((current) =>
      current.includes(code)
        ? current.filter((c) => c !== code)
        : current.length < COMPARE_LIMIT
          ? [...current, code]
          : current,
    );
  };

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const fund of funds) map.set(fund.kind, (map.get(fund.kind) ?? 0) + 1);
    return map;
  }, [funds]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('tr');
    const rows = funds.filter((fund) => {
      if (kind !== 'ALL' && fund.kind !== kind) return false;
      if (!needle) return true;
      return (
        fund.code.toLocaleLowerCase('tr').includes(needle) ||
        fund.name.toLocaleLowerCase('tr').includes(needle)
      );
    });
    return rows.sort((a, b) => {
      if (sort === 'code') return a.code.localeCompare(b.code, 'tr');
      if (RETURN_KEYS.includes(sort as ReturnKey)) {
        // Getirisi olmayan fon (yeni kurulmuş / seyrek fiyatlanan) sona düşer.
        const av = returns.get(a.code)?.[sort as ReturnKey] ?? Number.NEGATIVE_INFINITY;
        const bv = returns.get(b.code)?.[sort as ReturnKey] ?? Number.NEGATIVE_INFINITY;
        return bv - av;
      }
      return b[sort as 'portfolio_size' | 'change_pct' | 'investor_count'] - a[sort as 'portfolio_size' | 'change_pct' | 'investor_count'];
    });
  }, [funds, query, kind, sort, returns]);

  // Satırdaki getiri kolonu: getiri sıralamasındayken o dönem, değilse 1Y.
  const periodKey: ReturnKey = RETURN_KEYS.includes(sort as ReturnKey) ? (sort as ReturnKey) : 'r1y';

  if (loading) {
    return (
      <div className="empty-state">
        {t('fundsLoading')}
      </div>
    );
  }
  if (error) return <div className="empty-state error">{error}</div>;
  if (funds.length === 0) return <div className="empty-state">{t('fundsNoData')}</div>;

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <p className="eyebrow">TEFAS</p>
          <h1>{t('funds')}</h1>
        </div>
        <div className="price-block">
          <strong>{formatCount(funds.length)}</strong>
          <span>{t('fundUnit')} · {funds[0]?.date}</span>
        </div>
      </div>

      {/* Filtreler */}
      <div className="fund-toolbar">
        <input
          className="fund-search"
          placeholder={t('fundSearchPh')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="fund-chips">
          <button
            type="button"
            className={`eco-cal-chip ${kind === 'ALL' ? 'active' : ''}`}
            onClick={() => setKind('ALL')}
          >
            {t('ecoCalFilterAll')} ({funds.length})
          </button>
          {(Object.keys(FUND_KIND_LABELS) as FundKind[]).map((value) => (
            <button
              key={value}
              type="button"
              className={`eco-cal-chip ${kind === value ? 'active' : ''}`}
              title={t(`fundKind${value}`)}
              onClick={() => setKind(value)}
            >
              {value} ({counts.get(value) ?? 0})
            </button>
          ))}
        </div>
      </div>

      <div className="split-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
        {/* Liste */}
        <section className="panel" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className="fund-list-head">
            <h2 style={{ margin: 0 }}>{formatCount(visible.length)} {t('fundUnit')}</h2>
            <div className="fund-chips">
              {(Object.keys(SORT_LABEL_KEYS) as SortKey[]).map((value) => {
                // Getiri kolonları henüz gelmediyse 1A/3A/1Y çipleri bunu belli
                // eder: tıklanabilir kalır ama bekleyen veriye işaret eder.
                const pending = !returnsReady && RETURN_KEYS.includes(value as ReturnKey);
                return (
                  <button
                    key={value}
                    type="button"
                    className={`eco-cal-chip ${sort === value ? 'active' : ''}`}
                    style={pending ? { opacity: 0.55 } : undefined}
                    title={pending ? t('fundReturnsPending') : RETURN_KEYS.includes(value as ReturnKey) ? t('fundSortTip') : undefined}
                    onClick={() => setSort(value)}
                  >
                    {t(SORT_LABEL_KEYS[value])}{pending ? '…' : ''}
                  </button>
                );
              })}
            </div>
          </div>
          {!returnsReady && (
            <div className="fund-returns-note">
              {t('fundsReturnsNote')}
            </div>
          )}
          {compare.length > 0 && (
            <div className="fund-compare-bar">
              {compare.map((code) => (
                <span key={code} className="fund-compare-chip">
                  {code}
                  <button type="button" onClick={() => toggleCompare(code)} title={t('removeBtn')}>×</button>
                </span>
              ))}
              <button
                type="button"
                className="small-button"
                disabled={compare.length < 2}
                title={compare.length < 2 ? t('fundsMin2') : undefined}
                onClick={() => setCompareOpen(true)}
              >
                📈 {t('fundsCompare')}
              </button>
              <button type="button" className="small-button" onClick={() => setCompare([])}>
                {t('monClear')}
              </button>
            </div>
          )}

          <div className="fund-list">
            {visible.length === 0 && <div className="eco-cal-empty">{t('fundsNoMatch')}</div>}
            {visible.slice(0, 300).map((fund) => {
              const period = returns.get(fund.code)?.[periodKey];
              const inCompare = compare.includes(fund.code);
              return (
              <button
                type="button"
                key={`${fund.kind}-${fund.code}`}
                className={`fund-row ${selected?.code === fund.code ? 'active' : ''}`}
                onClick={() => setSelected(fund)}
              >
                <span
                  role="button"
                  tabIndex={-1}
                  className={`fund-compare-toggle ${inCompare ? 'active' : ''}`}
                  title={inCompare ? t('fundsCompareRemove') : t('fundsCompareAdd', { n: COMPARE_LIMIT })}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleCompare(fund.code);
                  }}
                >
                  {inCompare ? '✓' : '+'}
                </span>
                <span className="fund-code">{fund.code}</span>
                <span className="fund-name" title={fund.name}>
                  {fund.name}
                </span>
                <span className="fund-size">{formatTry(fund.portfolio_size)}</span>
                <span
                  className={`fund-change ${period === undefined || period === null ? '' : period >= 0 ? 'positive' : 'negative'}`}
                  title={t('fundPeriodReturn', { p: t(SORT_LABEL_KEYS[periodKey]) })}
                >
                  {period === undefined || period === null
                    ? `${t(SORT_LABEL_KEYS[periodKey])} —`
                    : `${t(SORT_LABEL_KEYS[periodKey])} ${period >= 0 ? '+' : ''}${period.toFixed(1)}%`}
                </span>
                <span className={`fund-change ${fund.change_pct >= 0 ? 'positive' : 'negative'}`}>
                  {fund.change_pct >= 0 ? '+' : ''}
                  {fund.change_pct.toFixed(2)}%
                </span>
              </button>
              );
            })}
            {visible.length > 300 && (
              <div className="eco-cal-empty">
                {t('fundsLimitWarning')} ({formatCount(visible.length - 300)} {t('fundMore')})
              </div>
            )}
          </div>
        </section>

        {/* Detay */}
        <section className="panel" style={{ minHeight: 0 }}>
          {selected ? (
            <FundDetail fund={selected} />
          ) : (
            <div className="empty-state">{t('fundsPickOne')}</div>
          )}
        </section>
      </div>

      {compareOpen && compare.length >= 2 && (
        <FundCompare codes={compare} onClose={() => setCompareOpen(false)} />
      )}
    </div>
  );
}
