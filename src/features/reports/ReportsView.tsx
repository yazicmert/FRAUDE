import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAnalystReports } from '../../api/tauriClient';
import { useTranslation } from '../../api/i18n';
import ReportDocumentModal from './ReportDocumentModal';
import type { AnalystConsensus, AnalystReport, AnalystReportPayload } from '../../types';

type ActiveTab = 'reports' | 'consensus';

/** "Hepsi" seçeneği için filtre değeri. */
const ALL = '__all__';

/** Bir seferde çizilen rapor sayısı. */
const PAGE_SIZE = 60;

/**
 * Rapor türlerinin ekran sırası. Şirket raporları en değerlisi olduğu için
 * başta; bültenler günlük akışta çok sayıda olduğundan sonda.
 */
const KIND_ORDER: AnalystReport['kind'][] = ['company', 'sector', 'strategy', 'bulletin', 'other'];

const KIND_KEY: Record<AnalystReport['kind'], string> = {
  company: 'reportKindCompany',
  sector: 'reportKindSector',
  strategy: 'reportKindStrategy',
  bulletin: 'reportKindBulletin',
  other: 'reportKindOther',
};

const KIND_COLOR: Record<AnalystReport['kind'], string> = {
  company: '#58a6ff',
  sector: '#a371f7',
  strategy: '#d29922',
  bulletin: '#8b949e',
  other: '#8b949e',
};

/**
 * Tavsiye etiketinin rengi. Eşikler `analyst_consensus::rating_label` ile aynı
 * ölçekten okunur (1 = AL … 3 = SAT); etiket metnine göre renk seçmek diller
 * arasında kırılır.
 */
function markColor(mark: number | null | undefined): string {
  if (mark == null) return 'var(--text-muted)';
  if (mark < 1.5) return '#3fb950';
  if (mark < 1.85) return '#56d364';
  if (mark <= 2.15) return '#d29922';
  return '#f85149';
}

function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `₺${value.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

const HORIZONTAL_SCROLLER: React.CSSProperties = {
  overflowX: 'auto',
  overflowY: 'hidden',
  overscrollBehaviorX: 'contain',
  touchAction: 'pan-y',
};

interface ReportsViewProps {
  onSelectTicker?: (ticker: string) => void;
}

/**
 * Aracı kurum ve banka araştırma raporları.
 *
 * İki ayrı kaynağı tek ekranda toplar:
 *
 * 1. **Raporlar** — yurt içi kurumların yayımladığı rapor arşivi (İş Yatırım,
 *    Vakıf, Halk, Marbaş, A1 Capital). Başlık, hedef fiyat ve tavsiye metinden
 *    çıkarılır; kayıt tıklanınca kurumun kendi PDF'i açılır.
 * 2. **Konsensüs** — payı izleyen kurumların toplu tavsiyesi ve ortalama hedef
 *    fiyatı. Yurt dışı bankaların BIST raporları kamuya kapalı olduğu için
 *    kapsamlarına yalnız bu toplamlardan ulaşılabiliyor.
 */
export default function ReportsView({ onSelectTicker }: ReportsViewProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<ActiveTab>('reports');
  const [payload, setPayload] = useState<AnalystReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [broker, setBroker] = useState<string>(ALL);
  const [kind, setKind] = useState<string>(ALL);
  const [query, setQuery] = useState('');
  /** Gömülü okuyucuda açık olan rapor. */
  const [openReport, setOpenReport] = useState<AnalystReport | null>(null);
  /**
   * Kaç rapor çizileceği. Arşiv her tazelemede büyür ve geri budanmaz; tamamını
   * tek seferde çizmek aylar içinde binlerce kart demek olur.
   */
  const [visible, setVisible] = useState(PAGE_SIZE);

  const load = useCallback(async (forceRefresh: boolean) => {
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      // Hisse verilmez: modül bütün arşivi ve evrenin konsensüsünü ister.
      const next = await getAnalystReports(undefined, forceRefresh);
      setPayload(next);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const reports = payload?.reports ?? [];
  const consensus = payload?.consensus ?? [];

  /** Arşivde gerçekten kaydı olan kurumlar; boş çip gösterilmez. */
  const brokers = useMemo(() => {
    const seen = new Map<string, number>();
    for (const report of reports) seen.set(report.broker, (seen.get(report.broker) ?? 0) + 1);
    return [...seen.entries()].sort((a, b) => b[1] - a[1]);
  }, [reports]);

  const kinds = useMemo(() => {
    const seen = new Set(reports.map((report) => report.kind));
    return KIND_ORDER.filter((value) => seen.has(value));
  }, [reports]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('tr');
    return reports.filter((report) => {
      if (broker !== ALL && report.broker !== broker) return false;
      if (kind !== ALL && report.kind !== kind) return false;
      if (!needle) return true;
      return (
        report.title.toLocaleLowerCase('tr').includes(needle) ||
        report.tickers.some((code) => code.toLocaleLowerCase('tr').includes(needle)) ||
        (report.analyst?.toLocaleLowerCase('tr').includes(needle) ?? false)
      );
    });
  }, [reports, broker, kind, query]);

  // Filtre değişince listenin başına dönülür; yoksa daraltılmış bir sonuçta
  // önceki "daha fazla" penceresi açık kalıyor.
  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [broker, kind, query]);

  const consensusRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('tr');
    if (!needle) return consensus;
    return consensus.filter((row) => row.ticker.toLocaleLowerCase('tr').includes(needle));
  }, [consensus, query]);

  const chip = (active: boolean, label: string, onClick: () => void, key: string) => (
    <button
      key={key}
      type="button"
      className={`tab-button${active ? ' active' : ''}`}
      onClick={onClick}
      style={{ borderRadius: '12px', border: '1px solid var(--border-color)' }}
    >
      {label}
    </button>
  );

  return (
    <div className="view reports-view">
      <div className="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ marginBottom: '2px' }}>{t('reportsTitle')}</h1>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{t('reportsSubtitle')}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {payload?.last_updated && (
            <span style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
              {t('lastUpdatedLabel')}: {payload.last_updated.slice(0, 10)}
            </span>
          )}
          <button type="button" className="tab-button" onClick={() => void load(true)} disabled={refreshing}>
            {refreshing ? t('refreshing') : t('kapRefresh')}
          </button>
        </div>
      </div>

      <div className="tabs" style={{ width: 'fit-content', margin: '10px 0 14px' }}>
        <button type="button" className={`tab-button${tab === 'reports' ? ' active' : ''}`} onClick={() => setTab('reports')}>
          {t('reportsTabArchive')} ({reports.length})
        </button>
        <button type="button" className={`tab-button${tab === 'consensus' ? ' active' : ''}`} onClick={() => setTab('consensus')}>
          {t('reportsTabConsensus')} ({consensus.length})
        </button>
      </div>

      {/* Bir kurumun düşmesi listeyi gizlemez; uyarı olarak gösterilir. */}
      {payload && payload.errors.length > 0 && (
        <div className="panel" style={{ padding: '8px 12px', marginBottom: '12px', borderColor: '#d2992255' }}>
          <span style={{ fontSize: '0.72rem', color: '#d29922' }}>
            {t('reportsPartialSources')}: {payload.errors.join(' · ')}
          </span>
        </div>
      )}

      <div className="corporate-filter" style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={tab === 'reports' ? t('reportsSearchPlaceholder') : t('reportsSearchTickerPlaceholder')}
          style={{ maxWidth: '280px', flex: '1 1 220px' }}
        />
        {tab === 'reports' && (
          <>
            {chip(broker === ALL, t('reportsAllBrokers'), () => setBroker(ALL), 'broker-all')}
            {brokers.map(([name, count]) =>
              chip(broker === name, `${name} (${count})`, () => setBroker(name), `broker-${name}`),
            )}
            <span style={{ width: '1px', height: '18px', background: 'var(--border-color)' }} />
            {chip(kind === ALL, t('reportsAllKinds'), () => setKind(ALL), 'kind-all')}
            {kinds.map((value) => chip(kind === value, t(KIND_KEY[value]), () => setKind(value), `kind-${value}`))}
          </>
        )}
      </div>

      {loading ? (
        <div className="empty-state" style={{ padding: '28px' }}>{t('loadingData')}</div>
      ) : error ? (
        <div className="empty-state" style={{ padding: '28px', color: '#f85149' }}>{error}</div>
      ) : tab === 'reports' ? (
        filtered.length === 0 ? (
          <div className="empty-state" style={{ padding: '28px' }}>{t('reportsEmpty')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filtered.slice(0, visible).map((report) => (
              <div
                key={report.id}
                className="panel"
                style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ padding: '2px 8px', borderRadius: '10px', fontSize: '0.66rem', fontWeight: 'bold', background: '#58a6ff22', color: '#58a6ff' }}>
                    {report.broker}
                  </span>
                  <span style={{ padding: '2px 8px', borderRadius: '10px', fontSize: '0.66rem', background: `${KIND_COLOR[report.kind]}22`, color: KIND_COLOR[report.kind] }}>
                    {t(KIND_KEY[report.kind])}
                  </span>
                  <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                    {report.published}
                  </span>
                  {report.rating && (
                    <span style={{ padding: '2px 8px', borderRadius: '10px', fontSize: '0.66rem', fontWeight: 'bold', background: '#3fb95022', color: '#3fb950' }}>
                      {report.rating}
                    </span>
                  )}
                  {report.target_price != null && (
                    <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: '#d29922' }}>
                      {t('targetPriceLabel')}: {formatPrice(report.target_price)}
                    </span>
                  )}
                  {report.analyst && (
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{report.analyst}</span>
                  )}
                </div>

                {/* Rapor tarayıcıya gönderilmez; KAP bildirimleri gibi
                    uygulamanın içindeki okuyucuda açılır. */}
                <button
                  type="button"
                  onClick={() => setOpenReport(report)}
                  style={{
                    background: 'none', border: 'none', padding: 0, textAlign: 'left',
                    color: 'var(--text-main)', fontSize: '0.86rem', fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {report.title}
                </button>

                {report.summary && (
                  <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    {report.summary}
                  </p>
                )}

                {report.tickers.length > 0 && (
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {report.tickers.map((code) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => onSelectTicker?.(code)}
                        style={{
                          padding: '2px 8px', borderRadius: '4px', fontSize: '0.68rem',
                          fontFamily: 'var(--font-mono)', fontWeight: 700,
                          background: 'var(--bg-panel)', border: '1px solid var(--border-color)',
                          color: 'var(--accent-primary)', cursor: 'pointer',
                        }}
                      >
                        {code}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {filtered.length > visible && (
              <button
                type="button"
                className="tab-button"
                onClick={() => setVisible((current) => current + PAGE_SIZE)}
                style={{ alignSelf: 'center', padding: '8px 18px', marginTop: '4px' }}
              >
                {t('reportsShowMore')} ({filtered.length - visible})
              </button>
            )}
          </div>
        )
      ) : consensusRows.length === 0 ? (
        <div className="empty-state" style={{ padding: '28px' }}>{t('reportsConsensusEmpty')}</div>
      ) : (
        <div className="panel" style={{ padding: 0 }}>
          <div style={HORIZONTAL_SCROLLER}>
            <table>
              <thead>
                <tr>
                  <th>{t('ticker')}</th>
                  <th>{t('consensusRating')}</th>
                  <th style={{ textAlign: 'right' }}>{t('consensusAnalysts')}</th>
                  <th>{t('consensusSpread')}</th>
                  <th style={{ textAlign: 'right' }}>{t('price')}</th>
                  <th style={{ textAlign: 'right' }}>{t('consensusTargetAvg')}</th>
                  <th style={{ textAlign: 'right' }}>{t('consensusUpside')}</th>
                  <th style={{ textAlign: 'right' }}>{t('consensusRange')}</th>
                </tr>
              </thead>
              <tbody>
                {consensusRows.map((row) => (
                  <ConsensusRow key={row.ticker} row={row} onSelectTicker={onSelectTicker} t={t} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p style={{ marginTop: '14px', fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
        {tab === 'reports' ? t('reportsSourcesNote') : t('consensusSourcesNote')}
      </p>

      <ReportDocumentModal
        report={openReport}
        onClose={() => setOpenReport(null)}
        onSelectTicker={onSelectTicker}
      />
    </div>
  );
}

function ConsensusRow({
  row,
  onSelectTicker,
  t,
}: {
  row: AnalystConsensus;
  onSelectTicker?: (ticker: string) => void;
  t: (key: string) => string;
}) {
  const total = Math.max(row.total, 1);
  const bar = (count: number, color: string) =>
    count > 0 ? <span style={{ flex: count / total, background: color, height: '6px', borderRadius: '2px' }} /> : null;

  return (
    <tr>
      <td>
        <button
          type="button"
          onClick={() => onSelectTicker?.(row.ticker)}
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent-primary)',
          }}
        >
          {row.ticker}
        </button>
      </td>
      <td style={{ color: markColor(row.mark), fontWeight: 600, fontSize: '0.76rem' }}>
        {row.rating ?? '—'}
      </td>
      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{row.total || '—'}</td>
      <td style={{ minWidth: '120px' }}>
        {row.total > 0 ? (
          <div title={`${t('consensusBuy')} ${row.buy} · ${t('consensusHold')} ${row.hold} · ${t('consensusSell')} ${row.sell}`}>
            <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
              {bar(row.buy, '#3fb950')}
              {bar(row.hold, '#d29922')}
              {bar(row.sell, '#f85149')}
            </div>
            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: '3px' }}>
              {row.buy}·{row.hold}·{row.sell}
            </div>
          </div>
        ) : (
          '—'
        )}
      </td>
      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatPrice(row.last_close)}</td>
      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatPrice(row.target_average)}</td>
      <td
        style={{
          textAlign: 'right',
          fontFamily: 'var(--font-mono)',
          color: row.upside == null ? 'var(--text-muted)' : row.upside >= 0 ? '#3fb950' : '#f85149',
        }}
      >
        {formatPercent(row.upside)}
      </td>
      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
        {row.target_low != null && row.target_high != null
          ? `${formatPrice(row.target_low)} – ${formatPrice(row.target_high)}`
          : '—'}
      </td>
    </tr>
  );
}
