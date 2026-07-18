import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  setMonitorConfig,
  runMonitorNow,
  markMonitorAlertsRead,
  clearMonitorAlerts,
} from '../../api/tauriClient';
import { useTranslation } from '../../api/i18n';
import type { AiAgent, MonitorState, MonitorAlert, MonitorEventType } from '../../types';

const EVENT_META: Record<MonitorEventType, { labelKey: string; icon: string; color: string }> = {
  ownership: { labelKey: 'monEvOwnership', icon: '🔴', color: '#f85149' },
  business: { labelKey: 'monEvBusiness', icon: '🤝', color: '#58a6ff' },
  capital: { labelKey: 'monEvCapital', icon: '💰', color: '#d29922' },
  other: { labelKey: 'monEvOther', icon: '📄', color: '#8b949e' },
};

const INTERVAL_OPTIONS = [
  { labelKey: 'monInt5m', secs: 5 * 60 },
  { labelKey: 'monInt15m', secs: 15 * 60 },
  { labelKey: 'monInt30m', secs: 30 * 60 },
  { labelKey: 'monInt1h', secs: 60 * 60 },
];

type FilterKey = 'all' | MonitorEventType;

export default function MonitorView({
  state,
  onState,
  onSelectTicker,
}: {
  state: MonitorState | null;
  onState: (s: MonitorState) => void;
  onSelectTicker?: (ticker: string) => void;
}) {
  const { t, lang } = useTranslation();
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [busy, setBusy] = useState(false);
  // Tauri'nin macOS WebView'ü window.confirm desteklemez (sessizce false döner
  // ve "Temizle" hiç çalışmazdı); onay iki aşamalı düğmeyle alınır.
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!confirmClear) return;
    const timer = setTimeout(() => setConfirmClear(false), 5000);
    return () => clearTimeout(timer);
  }, [confirmClear]);

  useEffect(() => {
    invoke<AiAgent[]>('list_ai_agents').then(setAgents).catch(() => {});
  }, []);

  // Panel açıkken okunmamış tüm uyarıları okundu işaretle (rozet sıfırlansın).
  // Rozet yalnızca materyal olayları sayar; burada listedeki herhangi bir
  // okunmamış kayıt varsa temizleriz (eski "diğer" kayıtları dahil).
  const hasUnread = (state?.alerts ?? []).some((a) => !a.read);
  useEffect(() => {
    if (hasUnread) {
      markMonitorAlertsRead().then(onState).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUnread]);

  const patchConfig = async (patch: Parameters<typeof setMonitorConfig>[0]) => {
    setBusy(true);
    try {
      onState(await setMonitorConfig(patch));
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  };

  const handleScanNow = async () => {
    setScanning(true);
    try {
      onState(await runMonitorNow());
    } catch (err) {
      console.error(err);
    } finally {
      setScanning(false);
    }
  };

  const handleClear = async () => {
    try {
      onState(await clearMonitorAlerts());
    } catch (err) {
      console.error(err);
    } finally {
      setConfirmClear(false);
    }
  };

  const alerts = state?.alerts ?? [];
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: alerts.length, ownership: 0, business: 0, capital: 0, other: 0 };
    for (const a of alerts) c[a.event_type] = (c[a.event_type] ?? 0) + 1;
    return c;
  }, [alerts]);

  const visibleAlerts = filter === 'all' ? alerts : alerts.filter((a) => a.event_type === filter);

  if (!state) {
    return <div className="empty-state" style={{ padding: '40px' }}>{t('monLoading')}</div>;
  }

  const { config } = state;

  return (
    <div className="view" style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <p className="eyebrow" style={{ margin: 0 }}>{t('monEyebrow')}</p>
          <h1 style={{ margin: '4px 0' }}>{t('monTitle')}</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0, maxWidth: '640px' }}>
            {t('monDesc')}
          </p>
        </div>
        <button
          type="button"
          onClick={handleScanNow}
          disabled={scanning || config.tickers.length === 0}
          style={{
            padding: '10px 18px', borderRadius: '8px', border: 'none', fontWeight: 700, cursor: config.tickers.length ? 'pointer' : 'default',
            background: config.tickers.length && !scanning ? 'var(--accent-primary)' : 'rgba(255,255,255,0.08)',
            color: config.tickers.length && !scanning ? '#000' : 'gray',
          }}
        >
          {scanning ? t('monScanning') : t('monScanNow')}
        </button>
      </div>

      {/* AYAR ÇUBUĞU */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center', marginTop: '20px', padding: '14px 16px', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
          <input type="checkbox" checked={config.enabled} disabled={busy} onChange={(e) => patchConfig({ enabled: e.target.checked })} style={{ width: '16px', height: '16px', accentColor: 'var(--accent-primary)' }} />
          <strong>{config.enabled ? t('monEnabledOn') : t('monEnabledOff')}</strong>
        </label>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem' }}>
          <span style={{ color: 'var(--text-muted)' }}>{t('monInterval')}</span>
          <div style={{ display: 'flex', gap: '4px' }}>
            {INTERVAL_OPTIONS.map((opt) => (
              <button
                key={opt.secs}
                type="button"
                disabled={busy}
                onClick={() => patchConfig({ interval_secs: opt.secs })}
                className={`small-button ${config.interval_secs === opt.secs ? 'active' : ''}`}
                style={{ background: config.interval_secs === opt.secs ? 'var(--accent-primary)' : 'var(--bg-elevated)', color: config.interval_secs === opt.secs ? '#000' : 'var(--text-primary)' }}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem' }}>
          <span style={{ color: 'var(--text-muted)' }}>{t('monAgent')}</span>
          <select
            value={config.agent_id ?? ''}
            disabled={busy}
            onChange={(e) => (e.target.value ? patchConfig({ agent_id: e.target.value }) : patchConfig({ clear_agent: true }))}
            style={{ padding: '6px 8px', background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'white', fontSize: '0.8rem' }}
          >
            <option value="">{t('monDefaultKey')}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.82rem', marginLeft: 'auto' }}>
          <input type="checkbox" checked={config.os_notifications} disabled={busy} onChange={(e) => patchConfig({ os_notifications: e.target.checked })} style={{ width: '15px', height: '15px', accentColor: 'var(--accent-primary)' }} />
          <span>{t('monOsNotif')}</span>
        </label>
      </div>

      {/* İZLENEN HİSSELER */}
      <div style={{ marginTop: '16px', fontSize: '0.82rem' }}>
        <span style={{ color: 'var(--text-muted)', marginRight: '8px' }}>
          {t('monWatched')} ({config.tickers.length}):
        </span>
        {config.tickers.length === 0 ? (
          <span style={{ color: '#d29922' }}>
            {t('monEmptyWatch')}
          </span>
        ) : (
          <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '6px' }}>
            {config.tickers.map((tk) => {
              const watched = state.baselined.includes(tk);
              return (
                <span
                  key={tk}
                  title={watched ? t('monWatchedTip') : t('monBaselineTip')}
                  onClick={() => onSelectTicker?.(tk)}
                  style={{ cursor: onSelectTicker ? 'pointer' : 'default', padding: '3px 8px', borderRadius: '10px', border: '1px solid var(--border-color)', background: watched ? 'rgba(63,185,80,0.1)' : 'rgba(255,255,255,0.04)', color: watched ? '#3fb950' : 'var(--text-muted)', fontWeight: 600 }}
                >
                  {watched ? '👁 ' : '⏳ '}{tk}
                </span>
              );
            })}
          </span>
        )}
      </div>
      <div style={{ marginTop: '6px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
        {state.last_run ? t('monLastRun', { time: new Date(state.last_run).toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US') }) : t('monNeverRun')}
      </div>

      {/* FİLTRE + EYLEMLER */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '22px', paddingBottom: '10px', borderBottom: '1px solid var(--border-color)' }}>
        {(['all', 'ownership', 'business', 'capital', 'other'] as FilterKey[]).map((key) => {
          const active = filter === key;
          const label = key === 'all' ? t('ecoCalFilterAll') : t(EVENT_META[key].labelKey);
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className="small-button"
              style={{ background: active ? 'var(--accent-primary)' : 'var(--bg-elevated)', color: active ? '#000' : 'var(--text-primary)', fontWeight: active ? 700 : 400 }}
            >
              {key !== 'all' && EVENT_META[key].icon} {label} ({counts[key] ?? 0})
            </button>
          );
        })}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          {alerts.length > 0 && (
            confirmClear ? (
              <>
                <button type="button" className="small-button" onClick={() => void handleClear()} style={{ background: '#f85149', color: '#fff', fontWeight: 700 }}>
                  {t('monClearConfirm')}
                </button>
                <button type="button" className="small-button" onClick={() => setConfirmClear(false)}>{t('aiCancel')}</button>
              </>
            ) : (
              <button type="button" className="small-button" title={t('monClearHint')} onClick={() => setConfirmClear(true)}>{t('monClear')}</button>
            )
          )}
        </div>
      </div>

      {/* UYARILAR */}
      <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {visibleAlerts.length === 0 ? (
          <div className="empty-state" style={{ padding: '36px', fontSize: '0.86rem' }}>
            {alerts.length === 0 ? t('monEmptyAlerts') : t('monEmptyFilter')}
          </div>
        ) : (
          visibleAlerts.map((alert) => <AlertCard key={alert.id} alert={alert} onSelectTicker={onSelectTicker} />)
        )}
      </div>
    </div>
  );
}

function AlertCard({ alert, onSelectTicker }: { alert: MonitorAlert; onSelectTicker?: (t: string) => void }) {
  const { t } = useTranslation();
  const meta = EVENT_META[alert.event_type];
  return (
    <div style={{ border: `1px solid ${meta.color}44`, borderLeft: `4px solid ${meta.color}`, borderRadius: '10px', background: 'var(--bg-panel)', padding: '16px', boxShadow: alert.read ? 'none' : `0 0 0 1px ${meta.color}22` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '3px 8px', borderRadius: '8px', background: `${meta.color}22`, color: meta.color }}>
          {meta.icon} {t(meta.labelKey)}
        </span>
        <span
          onClick={() => onSelectTicker?.(alert.ticker)}
          style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', cursor: onSelectTicker ? 'pointer' : 'default', color: 'var(--accent-primary)' }}
        >
          {alert.ticker}
        </span>
        {alert.company && <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{alert.company}</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <SeverityDots severity={alert.severity} />
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{alert.date}</span>
        </span>
      </div>

      <div style={{ marginTop: '10px', fontSize: '0.92rem', fontWeight: 600, lineHeight: 1.4 }}>
        {alert.url ? (
          <a onClick={(e) => { e.preventDefault(); void openUrl(alert.url); }} href={alert.url} style={{ color: 'var(--text-primary)', textDecoration: 'none', cursor: 'pointer' }}>
            {alert.title} <span style={{ color: '#58a6ff', fontSize: '0.75rem' }}>↗</span>
          </a>
        ) : alert.title}
      </div>

      {alert.ai_comment && (
        <div style={{ marginTop: '12px', padding: '12px 14px', background: 'rgba(0,0,0,0.22)', borderRadius: '8px', borderLeft: '3px solid var(--accent-primary)' }}>
          <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--accent-primary)', marginBottom: '6px', fontWeight: 700 }}>
            🤖 {t('monAiComment')}
          </div>
          <div style={{ fontSize: '0.85rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}>
            {alert.ai_comment}
          </div>
        </div>
      )}
    </div>
  );
}

function SeverityDots({ severity }: { severity: number }) {
  const { t } = useTranslation();
  const level = severity >= 9 ? 3 : severity >= 7 ? 2 : 1;
  const color = level === 3 ? '#f85149' : level === 2 ? '#d29922' : '#8b949e';
  return (
    <span title={t('monSeverity', { s: severity })} style={{ display: 'inline-flex', gap: '2px' }}>
      {[1, 2, 3].map((i) => (
        <span key={i} style={{ width: '6px', height: '6px', borderRadius: '50%', background: i <= level ? color : 'rgba(255,255,255,0.15)' }} />
      ))}
    </span>
  );
}
