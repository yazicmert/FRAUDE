import { useEffect, useMemo, useState } from 'react';
import { useAlerts } from './useAlerts';
import {
  type AlertMetric,
  type AlertOp,
  ALERT_METRIC_LABELS,
  describeRule,
  metricNeedsThreshold,
} from './alertTypes';

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  paddingTop: '8vh',
  zIndex: 1000,
};

const panel: React.CSSProperties = {
  width: 'min(680px, 94vw)',
  maxHeight: '80vh',
  overflow: 'auto',
  background: 'var(--bg-panel)',
  border: '1px solid var(--border-color)',
  borderRadius: '10px',
  boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
  padding: '18px',
};

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-dark)',
  border: '1px solid var(--border-color)',
  color: 'var(--text-main)',
  borderRadius: '4px',
  padding: '6px 8px',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.8rem',
};

const METRICS: AlertMetric[] = ['price', 'change_pct', 'rsi', 'sma50', 'week_52_high', 'week_52_low'];

export default function AlertsModal({
  open,
  onClose,
  initialTicker,
}: {
  open: boolean;
  onClose: () => void;
  initialTicker?: string;
}) {
  const { rules, log, addRule, updateRule, removeRule, markLogRead, clearLog } = useAlerts();

  const [ticker, setTicker] = useState('');
  const [metric, setMetric] = useState<AlertMetric>('price');
  const [op, setOp] = useState<AlertOp>('above');
  const [threshold, setThreshold] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [note, setNote] = useState('');
  const [tab, setTab] = useState<'rules' | 'log'>('rules');

  useEffect(() => {
    if (open) {
      setTicker((initialTicker ?? '').toUpperCase());
      markLogRead();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTicker]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const needsThreshold = metricNeedsThreshold(metric);
  const canSubmit = ticker.trim().length > 0 && (!needsThreshold || threshold.trim() !== '');

  const sortedRules = useMemo(
    () => [...rules].sort((a, b) => Number(b.enabled) - Number(a.enabled)),
    [rules],
  );

  if (!open) return null;

  const submit = () => {
    if (!canSubmit) return;
    addRule({
      ticker: ticker.trim().toUpperCase(),
      metric,
      op,
      threshold: needsThreshold ? Number(threshold) : 0,
      note: note.trim() || undefined,
      enabled: true,
      repeat,
    });
    setThreshold('');
    setNote('');
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <strong style={{ fontSize: '1.05rem' }}>🔔 Fiyat & Teknik Alarmlar</strong>
          <button type="button" onClick={onClose} style={{ ...inputStyle, cursor: 'pointer', padding: '4px 10px' }}>✕</button>
        </div>

        {/* Yeni kural formu */}
        <div style={{ background: 'var(--bg-dark)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '12px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
            <input
              style={{ ...inputStyle, width: '96px', textTransform: 'uppercase' }}
              placeholder="HİSSE"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
            />
            <select style={{ ...inputStyle, minWidth: '170px' }} value={metric} onChange={(e) => setMetric(e.target.value as AlertMetric)}>
              {METRICS.map((m) => (
                <option key={m} value={m}>{ALERT_METRIC_LABELS[m]}</option>
              ))}
            </select>
            {metric !== 'week_52_high' && metric !== 'week_52_low' && (
              <select style={{ ...inputStyle }} value={op} onChange={(e) => setOp(e.target.value as AlertOp)}>
                <option value="above">{metric === 'sma50' ? 'yukarı keser' : 'üzerine çıkar'}</option>
                <option value="below">{metric === 'sma50' ? 'aşağı keser' : 'altına iner'}</option>
              </select>
            )}
            {needsThreshold && (
              <input
                style={{ ...inputStyle, width: '90px' }}
                type="number"
                step="any"
                placeholder="değer"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
              />
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
              tekrarla
            </label>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={submit}
              style={{
                ...inputStyle,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                background: canSubmit ? 'var(--accent-primary)' : 'var(--bg-panel)',
                color: canSubmit ? '#000' : 'var(--text-muted)',
                fontWeight: 'bold',
              }}
            >
              + Alarm Kur
            </button>
          </div>
          <input
            style={{ ...inputStyle, width: '100%', marginTop: '8px' }}
            placeholder="Not (opsiyonel) — neden bu seviye?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {/* Sekmeler */}
        <div style={{ display: 'flex', gap: '16px', borderBottom: '1px solid var(--border-color)', marginBottom: '12px' }}>
          {(['rules', 'log'] as const).map((tk) => (
            <button
              key={tk}
              type="button"
              onClick={() => setTab(tk)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '6px 2px',
                color: tab === tk ? 'var(--accent-primary)' : 'var(--text-muted)',
                borderBottom: tab === tk ? '2px solid var(--accent-primary)' : '2px solid transparent',
                fontWeight: tab === tk ? 'bold' : 'normal',
              }}
            >
              {tk === 'rules' ? `Kurallar (${rules.length})` : `Tetiklenenler (${log.length})`}
            </button>
          ))}
          {tab === 'log' && log.length > 0 && (
            <button type="button" onClick={clearLog} style={{ marginLeft: 'auto', ...inputStyle, cursor: 'pointer', padding: '2px 8px' }}>Temizle</button>
          )}
        </div>

        {tab === 'rules' ? (
          sortedRules.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
              Henüz alarm yok. Yukarıdan bir kural ekleyin veya bir hisse detayında “＋ Alarm” butonunu kullanın.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {sortedRules.map((r) => (
                <div key={r.id} style={{
                  display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px',
                  background: 'var(--bg-dark)', border: '1px solid var(--border-color)', borderRadius: '6px',
                  opacity: r.enabled ? 1 : 0.55,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.82rem' }}>{describeRule(r)}</div>
                    {r.note && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>{r.note}</div>}
                    <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {r.repeat ? 'Tekrarlı' : 'Tek seferlik'}
                      {r.lastTriggeredAt ? ` · son tetik: ${new Date(r.lastTriggeredAt).toLocaleString('tr-TR')}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateRule(r.id, { enabled: !r.enabled, ...(r.enabled ? {} : { lastMet: null }) })}
                    style={{ ...inputStyle, cursor: 'pointer', padding: '3px 8px', color: r.enabled ? 'var(--accent-primary)' : 'var(--text-muted)' }}
                    title={r.enabled ? 'Duraklat' : 'Etkinleştir'}
                  >
                    {r.enabled ? 'Aktif' : 'Pasif'}
                  </button>
                  <button type="button" onClick={() => removeRule(r.id)} style={{ ...inputStyle, cursor: 'pointer', padding: '3px 8px', color: '#f85149' }}>Sil</button>
                </div>
              ))}
            </div>
          )
        ) : (
          log.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>Henüz tetiklenen alarm yok.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {log.map((t) => (
                <div key={t.id} style={{ padding: '8px 10px', background: 'var(--bg-dark)', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
                  <div style={{ fontSize: '0.82rem' }}>🔔 {t.message}</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    güncel: {t.value.toFixed(2)} · {new Date(t.at).toLocaleString('tr-TR')}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
