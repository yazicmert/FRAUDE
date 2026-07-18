import { useEffect, useState } from 'react';
import { openUrl } from '../../lib/openExternal';
import {
  getFundAllocation,
  getFundDisclosures,
  getFundHistory,
  getFundHoldings,
  getFundHoldingsAi,
  getFundIssuer,
  type FundAllocation,
  type FundDisclosure,
  type FundHoldingsReport,
  type FundIssuer,
  type FundRow,
} from '../../api/tauriClient';
import { useTranslation } from '../../api/i18n';
import { formatCount, formatTry } from './FundsView';

/** Dağılım halkasındaki renkler; sırayla ve döngüsel atanır. */
const SLICE_COLORS = [
  '#58a6ff', '#3fb950', '#d29922', '#f85149', '#ab7df8',
  '#39c5cf', '#db6d28', '#8b949e', '#6e7681', '#484f58',
];

/** Basit çizgi grafik: TEFAS yalnızca kapanış verdiği için mum yok. */
function Sparkline({ points }: { points: [string, number][] }) {
  if (points.length < 2) return null;
  const values = points.map(([, price]) => price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const path = points
    .map(([, price], index) => {
      const x = (index / (points.length - 1)) * 100;
      const y = 100 - ((price - min) / span) * 100;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
  const gain = values[values.length - 1] >= values[0];
  const color = gain ? '#3fb950' : '#f85149';
  // Kimlik yön'den türetilir; hook gerektirmez. Aynı yönlü iki grafik aynı
  // tanımı paylaşır — içerik birebir aynı olduğundan çakışma zararsızdır.
  const gradientId = `fund-spark-fill-${gain ? 'up' : 'down'}`;

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="fund-spark">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Çizginin altını yumuşak bir alan dolgusu tamamlar; grafik boşlukta asılı durmaz. */}
      <path d={`${path} L100,100 L0,100 Z`} fill={`url(#${gradientId})`} stroke="none" />
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function FundDetail({ fund }: { fund: FundRow }) {
  const { t } = useTranslation();
  const [allocation, setAllocation] = useState<FundAllocation[]>([]);
  const [history, setHistory] = useState<[string, number][]>([]);
  const [issuer, setIssuer] = useState<FundIssuer | null>(null);
  const [disclosures, setDisclosures] = useState<FundDisclosure[]>([]);
  const [holdings, setHoldings] = useState<FundHoldingsReport | null>(null);
  const [holdingsError, setHoldingsError] = useState<string | null>(null);
  const [aiOcrBusy, setAiOcrBusy] = useState(false);
  const [aiOcrError, setAiOcrError] = useState<string | null>(null);
  const [aiOcrUsed, setAiOcrUsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);

  // Taranmış PDF: kullanıcı isteğiyle sayfa görüntüleri AI'ya gönderilir.
  // Maliyet kullanıcının anahtarına işlediği için otomatik tetiklenmez.
  const runAiOcr = () => {
    setAiOcrBusy(true);
    setAiOcrError(null);
    getFundHoldingsAi(fund.code)
      .then((report) => {
        setHoldings(report);
        setAiOcrUsed(true);
      })
      .catch((err: unknown) => setAiOcrError(String(err)))
      .finally(() => setAiOcrBusy(false));
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNote(null);
    setAllocation([]);
    setHistory([]);
    setIssuer(null);
    setDisclosures([]);
    setHoldings(null);
    setHoldingsError(null);
    setAiOcrError(null);
    setAiOcrUsed(false);

    // Uçlar bağımsız: biri gelmezse diğerleri yine gösterilir.
    void (async () => {
      const [alloc, hist, iss, disc, hold] = await Promise.allSettled([
        getFundAllocation(fund.code),
        getFundHistory(fund.code, 3),
        getFundIssuer(fund.name),
        getFundDisclosures(fund.code),
        getFundHoldings(fund.code),
      ]);
      if (cancelled) return;
      if (alloc.status === 'fulfilled') setAllocation(alloc.value);
      if (hist.status === 'fulfilled') setHistory(hist.value);
      if (iss.status === 'fulfilled') setIssuer(iss.value);
      if (disc.status === 'fulfilled') setDisclosures(disc.value);
      if (hold.status === 'fulfilled') setHoldings(hold.value);
      else setHoldingsError(String(hold.reason));
      if (alloc.status === 'rejected' && hist.status === 'rejected') {
        setNote(t('fundDetailError'));
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [fund.code, fund.name]);

  const periodReturn =
    history.length >= 2 ? (history[history.length - 1][1] / history[0][1] - 1) * 100 : null;

  return (
    <div className="fund-detail">
      {/* Künye */}
      <div className="fund-detail-head">
        <div>
          <span className="fund-detail-code">{fund.code}</span>
          <span className="fund-detail-kind">{t(`fundKind${fund.kind}`)}</span>
        </div>
        <h2 className="fund-detail-name">{fund.name}</h2>
      </div>

      {/* Ölçüler */}
      <div className="fund-stats">
        <div>
          <span>Fiyat</span>
          <strong>{fund.price.toLocaleString('tr-TR', { maximumFractionDigits: 6 })} ₺</strong>
          <em className={fund.change_pct >= 0 ? 'positive' : 'negative'}>
            {fund.change_pct >= 0 ? '+' : ''}
            {fund.change_pct.toFixed(2)}%
          </em>
        </div>
        <div>
          <span>{t('fundPortfolioSize')}</span>
          <strong>{formatTry(fund.portfolio_size)}</strong>
        </div>
        <div>
          <span>{t('fundInvestors')}</span>
          <strong>{formatCount(fund.investor_count)}</strong>
        </div>
        <div>
          <span>{t('fundShares')}</span>
          <strong>{formatCount(Math.round(fund.share_count))}</strong>
        </div>
      </div>

      {/* Kurucu: site + KAP */}
      {issuer && (
        <div className="fund-issuer">
          <span className="fund-issuer-name">{issuer.name}</span>
          <div className="fund-issuer-links">
            {issuer.website && (
              <button
                type="button"
                className="small-button"
                onClick={() => void openUrl(`https://${issuer.website!.replace(/^https?:\/\//, '')}`)}
              >
                🌐 {issuer.website}
              </button>
            )}
            <button type="button" className="small-button" onClick={() => void openUrl(issuer.kap_url)}>
              📄 {t('fundKapRecord')}
            </button>
          </div>
        </div>
      )}

      {note && <div className="eco-cal-empty">{note}</div>}

      {/* Fiyat grafiği */}
      <div className="fund-section">
        <div className="fund-section-head">
          <h3>{t('fundPrice3m')}</h3>
          {periodReturn !== null && (
            <span className={periodReturn >= 0 ? 'positive' : 'negative'}>
              {periodReturn >= 0 ? '+' : ''}
              {periodReturn.toFixed(2)}%
            </span>
          )}
        </div>
        {loading && history.length === 0 ? (
          <div className="eco-cal-empty">{t('fundChartLoading')}</div>
        ) : history.length >= 2 ? (
          <Sparkline points={history} />
        ) : (
          <div className="eco-cal-empty">{t('fundNoHistory')}</div>
        )}
      </div>

      {/* KAP bildirimleri */}
      <div className="fund-section">
        <div className="fund-section-head">
          <h3>{t('kapDisclosures')}</h3>
          <span
            className="eco-cal-help"
            title={t('fundKapHelp')}
          >
            ?
          </span>
        </div>
        {loading && disclosures.length === 0 ? (
          <div className="eco-cal-empty">{t('fundDisclosuresLoading')}</div>
        ) : disclosures.length === 0 ? (
          <div className="eco-cal-empty">{t('fundNoDisclosures')}</div>
        ) : (
          <div className="fund-disclosures">
            {disclosures.map((item) => (
              <button
                key={item.url}
                type="button"
                className="fund-disclosure"
                onClick={() => void openUrl(item.url)}
                title={t('fundOpenOnKap')}
              >
                <span className="fund-disclosure-date">{item.date}</span>
                <span className="fund-disclosure-body">
                  <span className="fund-disclosure-subject">{item.subject}</span>
                  {/* KAP çoğu bildirimde özet olarak konuyu aynen yineler; kopyayı gösterme. */}
                  {item.summary && item.summary.trim() !== item.subject.trim() && (
                    <span className="fund-disclosure-summary">{item.summary}</span>
                  )}
                </span>
                <span className="fund-disclosure-open" aria-hidden>↗</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Portföy dağılımı */}
      <div className="fund-section">
        <div className="fund-section-head">
          <h3>{t('fundAllocation')}</h3>
          <span
            className="eco-cal-help"
            title={t('fundAllocationHelp')}
          >
            ?
          </span>
        </div>
        {loading && allocation.length === 0 ? (
          <div className="eco-cal-empty">{t('fundAllocationLoading')}</div>
        ) : allocation.length === 0 ? (
          <div className="eco-cal-empty">{t('fundNoAllocation')}</div>
        ) : (
          <>
            <div className="fund-bar">
              {allocation.map((slice, index) => (
                <span
                  key={slice.label}
                  style={{
                    width: `${slice.pct}%`,
                    background: SLICE_COLORS[index % SLICE_COLORS.length],
                  }}
                  title={`${slice.label} · %${slice.pct.toFixed(2)}`}
                />
              ))}
            </div>
            <div className="fund-legend">
              {allocation.map((slice, index) => (
                <div key={slice.label} className="fund-legend-item">
                  <span
                    className="fund-legend-dot"
                    style={{ background: SLICE_COLORS[index % SLICE_COLORS.length] }}
                  />
                  <span className="fund-legend-label" title={slice.label}>
                    {slice.label}
                  </span>
                  <span className="fund-legend-pct">%{slice.pct.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* İçindeki varlıklar (KAP Portföy Dağılım Raporu) */}
      <div className="fund-section">
        <div className="fund-section-head">
          <h3>{t('fundHoldings')}</h3>
          {holdings && <span className="fund-holdings-period">KAP PDR · {holdings.period}</span>}
          <span
            className="eco-cal-help"
            title={t('fundHoldingsHelp')}
          >
            ?
          </span>
        </div>
        {loading && !holdings && !holdingsError ? (
          <div className="eco-cal-empty">{t('fundHoldingsLoading')}</div>
        ) : holdingsError ? (
          <div className="eco-cal-empty">{t('fundNoHoldingsReport')}</div>
        ) : holdings && holdings.holdings.length === 0 ? (
          <div className="fund-holdings-fallback">
            <span className="eco-cal-empty">
              {t('fundPdfUnreadable')}
            </span>
            <span className="eco-cal-empty" style={{ fontSize: '0.74rem' }}>
              {t('fundAiOcrHint')}
            </span>
            {aiOcrError && (
              <span className="eco-cal-empty" style={{ color: '#f85149', fontSize: '0.76rem' }}>
                {t('fundAiOcrFailed')}{aiOcrError}
              </span>
            )}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="small-button"
                disabled={aiOcrBusy}
                onClick={runAiOcr}
              >
                {aiOcrBusy ? `⏳ ${t('fundAiOcrBusy')}` : `🖼 ${t('fundAiOcr')}`}
              </button>
              <button type="button" className="small-button" onClick={() => void openUrl(holdings.url)}>
                📄 {t('fundOpenReport')}
              </button>
            </div>
          </div>
        ) : holdings ? (
          <>
            <div className="fund-holdings">
              {(() => {
                const sorted = [...holdings.holdings].sort((a, b) => b.pct - a.pct);
                // Ölçek çubukları en büyük pozisyona göre normalize edilir; tipik
                // %1-3'lük ağırlıklar mutlak ölçekte görünmez kalırdı.
                const maxPct = Math.max(sorted[0]?.pct ?? 0, 0.0001);
                return sorted.map((holding, index) => (
                  <div
                    key={`${holding.code}-${holding.pct}`}
                    className="fund-holding"
                    title={holding.group ? `${holding.name} · ${holding.group}` : holding.name}
                  >
                    <span className="fund-holding-rank">{index + 1}</span>
                    <span className="fund-holding-code">{holding.code}</span>
                    <span className="fund-holding-name">{holding.name}</span>
                    <span className="fund-holding-meter">
                      <i style={{ width: `${Math.min((holding.pct / maxPct) * 100, 100)}%` }} />
                    </span>
                    <span className="fund-holding-pct">%{holding.pct.toFixed(2)}</span>
                  </div>
                ));
              })()}
            </div>
            <div className="fund-holdings-foot">
              <span>
                {t('fundHoldingsFoot', { n: holdings.holdings.length })}
                {aiOcrUsed ? ` · ${t('fundAiOcrDone')}` : ''}
              </span>
              <button type="button" className="small-button" onClick={() => void openUrl(holdings.url)}>
                📄 {t('fundOpenReport')}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
