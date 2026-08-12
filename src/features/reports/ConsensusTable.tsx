import { useTranslation } from '../../api/i18n';
import type { AnalystConsensus } from '../../types';

/**
 * Analist konsensüsü tablosu.
 *
 * Yurt dışı bankaların BIST raporları aboneliğe kapalı; kapsamlarına
 * ulaşılabilen tek kamuya açık yüzey bu toplamlar. Bilgi Deposu'nun kendi
 * sekmesinde ve şirket odağında aynı bileşen çizilir.
 */

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

export function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `₺${value.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

/**
 * Geniş içerik kendi kabında yatay kaydırılır; sayfa gövdesi yana kaymaz.
 * (Uygulama kabuğunun ızgara sözleşmesi: bkz. AGENTS.md.)
 */
const HORIZONTAL_SCROLLER: React.CSSProperties = {
  overflowX: 'auto',
  overflowY: 'hidden',
  overscrollBehaviorX: 'contain',
  touchAction: 'pan-y',
};

export default function ConsensusTable({
  rows,
  onSelectTicker,
}: {
  rows: AnalystConsensus[];
  onSelectTicker?: (ticker: string) => void;
}) {
  const { t } = useTranslation();
  return (
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
            {rows.map((row) => (
              <ConsensusRow key={row.ticker} row={row} onSelectTicker={onSelectTicker} t={t} />
            ))}
          </tbody>
        </table>
      </div>
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
