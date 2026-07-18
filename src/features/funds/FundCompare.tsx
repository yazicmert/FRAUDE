import { useEffect, useMemo, useState } from 'react';
import { getFundHistory } from '../../api/tauriClient';
import { useTranslation } from '../../api/i18n';

const SERIES_COLORS = ['#58a6ff', '#3fb950', '#d29922'];

interface Series {
  code: string;
  /** (unix ms, ilk güne göre % getiri) — tarih ekseni fonlar arası hizalıdır. */
  points: [number, number][];
}

/**
 * Seçilen fonların 3 aylık getirilerini tek grafikte üst üste çizer.
 * Her seri kendi ilk fiyatına normalize edilir (%0'dan başlar); böylece pay
 * fiyatı 0,7 TL olan fonla 21 TL olan fon aynı eksende karşılaştırılabilir.
 */
export default function FundCompare({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const { t } = useTranslation();
  const [series, setSeries] = useState<Series[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const key = codes.join(',');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSeries([]);

    // İstekler backend throttle'ından geçer (fon başına 3 istek, 6 istek/dk);
    // ilk açılış fon sayısına göre ~30-90 sn sürebilir, sonrası önbellekten.
    void Promise.allSettled(codes.map((code) => getFundHistory(code, 3))).then((results) => {
      if (cancelled) return;
      const loaded: Series[] = [];
      results.forEach((result, index) => {
        if (result.status !== 'fulfilled' || result.value.length < 2) return;
        const first = result.value[0][1];
        loaded.push({
          code: codes[index],
          points: result.value.map(([date, price]) => [
            Date.parse(date),
            (price / first - 1) * 100,
          ]),
        });
      });
      if (loaded.length === 0) {
        setError(t('fundCompareError'));
      }
      setSeries(loaded);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const chart = useMemo(() => {
    if (series.length === 0) return null;
    const xs = series.flatMap((s) => s.points.map(([x]) => x));
    const ys = series.flatMap((s) => s.points.map(([, y]) => y));
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const [rawY0, rawY1] = [Math.min(...ys, 0), Math.max(...ys, 0)];
    const pad = Math.max((rawY1 - rawY0) * 0.06, 0.5);
    const [y0, y1] = [rawY0 - pad, rawY1 + pad];
    const sx = (x: number) => ((x - x0) / (x1 - x0 || 1)) * 100;
    const sy = (y: number) => 100 - ((y - y0) / (y1 - y0 || 1)) * 100;
    return {
      zeroY: sy(0),
      paths: series.map((s) =>
        s.points
          .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${sx(x).toFixed(2)},${sy(y).toFixed(2)}`)
          .join(' '),
      ),
    };
  }, [series]);

  return (
    <div className="fund-compare-backdrop" onClick={onClose}>
      <div className="fund-compare-modal" onClick={(event) => event.stopPropagation()}>
        <div className="fund-compare-head">
          <div>
            <h2 style={{ margin: 0 }}>{t('fundCompareTitle')}</h2>
            <span className="fund-compare-sub">{t('fundCompareSub')}</span>
          </div>
          <button type="button" className="fund-compare-close" onClick={onClose}>×</button>
        </div>

        {loading ? (
          <div className="eco-cal-empty" style={{ padding: '48px 16px' }}>
            {t('fundCompareLoading')}
          </div>
        ) : error ? (
          <div className="eco-cal-empty" style={{ padding: '48px 16px' }}>{error}</div>
        ) : chart ? (
          <>
            <div className="fund-compare-legend">
              {series.map((s, index) => {
                const last = s.points[s.points.length - 1][1];
                return (
                  <span key={s.code} className="fund-compare-legend-item">
                    <span className="fund-legend-dot" style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }} />
                    <strong>{s.code}</strong>
                    <em className={last >= 0 ? 'positive' : 'negative'}>
                      {last >= 0 ? '+' : ''}{last.toFixed(2)}%
                    </em>
                  </span>
                );
              })}
            </div>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="fund-compare-chart">
              <line x1="0" y1={chart.zeroY} x2="100" y2={chart.zeroY} stroke="#8b949e55" strokeWidth="1" strokeDasharray="2,2" vectorEffect="non-scaling-stroke" />
              {chart.paths.map((d, index) => (
                <path
                  key={series[index].code}
                  d={d}
                  fill="none"
                  stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                  strokeWidth="1.6"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
          </>
        ) : null}
      </div>
    </div>
  );
}
