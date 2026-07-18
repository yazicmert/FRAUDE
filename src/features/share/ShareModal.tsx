import { useEffect, useMemo, useRef, useState } from 'react';
import { notify } from '../../lib/notify';
import { useTranslation } from '../../api/i18n';

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
  paddingTop: '10vh', zIndex: 1000,
};
const panel: React.CSSProperties = {
  width: 'min(560px, 94vw)', maxHeight: '80vh', overflow: 'auto',
  background: 'var(--bg-panel)', border: '1px solid var(--border-color)',
  borderRadius: '10px', boxShadow: '0 16px 48px rgba(0,0,0,0.5)', padding: '18px',
};
const btn: React.CSSProperties = {
  background: 'var(--bg-dark)', border: '1px solid var(--border-color)', color: 'var(--text-main)',
  borderRadius: '6px', padding: '8px 12px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '0.82rem',
};

function readJson(key: string): unknown[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface Backup {
  app: 'fraude';
  kind: 'backup';
  version: number;
  exportedAt: string;
  data: {
    watchlist: unknown[];
    alerts: unknown[];
    screenerPresets: unknown[];
  };
}

function buildBackup(): Backup {
  return {
    app: 'fraude',
    kind: 'backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      watchlist: readJson('fraude-watchlist'),
      alerts: readJson('fraude-alerts'),
      screenerPresets: readJson('fraude-screener-presets'),
    },
  };
}

// Birleştirme yardımcıları: anahtar bazlı; içe aktarılan çakışmada üstün gelir.
function mergeByKey(existing: any[], incoming: any[], keyOf: (x: any) => string): any[] {
  const map = new Map<string, any>();
  for (const item of existing) map.set(keyOf(item), item);
  for (const item of incoming) map.set(keyOf(item), item);
  return Array.from(map.values());
}

export default function ShareModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [importText, setImportText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const counts = useMemo(() => ({
    watchlist: readJson('fraude-watchlist').length,
    alerts: readJson('fraude-alerts').length,
    presets: readJson('fraude-screener-presets').length,
  }), [open]);

  if (!open) return null;

  const exportText = JSON.stringify(buildBackup(), null, 2);

  const doDownload = () => {
    const blob = new Blob([exportText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fraude-yedek-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    void notify({ title: t('shareDownloaded'), body: t('shareDownloadedBody'), kind: 'success', toastOnly: true });
  };

  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(exportText);
      void notify({ title: t('shareCopied'), kind: 'success', toastOnly: true });
    } catch {
      void notify({ title: t('shareCopyFailed'), body: t('shareCopyFailedBody'), kind: 'danger', toastOnly: true });
    }
  };

  const applyImport = (text: string) => {
    let parsed: Backup;
    try {
      parsed = JSON.parse(text);
    } catch {
      void notify({ title: t('shareInvalidFile'), body: t('shareInvalidJson'), kind: 'danger', toastOnly: true });
      return;
    }
    if (!parsed || parsed.app !== 'fraude' || !parsed.data) {
      void notify({ title: t('shareUnknownBackup'), body: t('shareNotFraude'), kind: 'danger', toastOnly: true });
      return;
    }
    const d = parsed.data;
    let changed = 0;

    if (Array.isArray(d.watchlist) && d.watchlist.length > 0) {
      const merged = mergeByKey(readJson('fraude-watchlist'), d.watchlist, (x) => String(x.ticker ?? x));
      localStorage.setItem('fraude-watchlist', JSON.stringify(merged));
      window.dispatchEvent(new CustomEvent('fraude-watchlist-updated', { detail: merged }));
      changed += 1;
    }
    if (Array.isArray(d.alerts) && d.alerts.length > 0) {
      // İçe aktarılan alarmlara yeni id verilir ve durumları sıfırlanır (çakışma önlemi).
      const normalized = d.alerts.map((a: any) => ({ ...a, id: uid(), lastMet: null }));
      const merged = [...readJson('fraude-alerts'), ...normalized];
      localStorage.setItem('fraude-alerts', JSON.stringify(merged));
      window.dispatchEvent(new CustomEvent('fraude-alerts-updated', { detail: merged }));
      changed += 1;
    }
    if (Array.isArray(d.screenerPresets) && d.screenerPresets.length > 0) {
      const merged = mergeByKey(readJson('fraude-screener-presets'), d.screenerPresets, (x) => String(x.name));
      localStorage.setItem('fraude-screener-presets', JSON.stringify(merged));
      window.dispatchEvent(new CustomEvent('fraude-screener-presets-updated', { detail: merged }));
      changed += 1;
    }

    if (changed === 0) {
      void notify({ title: t('shareNothingToImport'), kind: 'warning', toastOnly: true });
    } else {
      void notify({ title: t('shareImported'), body: t('shareImportedBody', { n: changed }), kind: 'success', toastOnly: true });
      onClose();
    }
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => applyImport(String(reader.result ?? ''));
    reader.readAsText(file);
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <strong style={{ fontSize: '1.05rem' }}>📤 {t('paletteShare')}</strong>
          <button type="button" onClick={onClose} style={{ ...btn, padding: '4px 10px' }}>✕</button>
        </div>

        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
          {t('shareDesc')}
        </p>

        <div style={{ display: 'flex', gap: '10px', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '14px', flexWrap: 'wrap' }}>
          <span>📋 {t('shareWatchlist')}: <strong style={{ color: 'var(--text-main)' }}>{counts.watchlist}</strong></span>
          <span>⏰ {t('setAlert')}: <strong style={{ color: 'var(--text-main)' }}>{counts.alerts}</strong></span>
          <span>🔍 Screener: <strong style={{ color: 'var(--text-main)' }}>{counts.presets}</strong></span>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <button type="button" style={{ ...btn, background: 'var(--accent-primary)', color: '#000', fontWeight: 'bold' }} onClick={doDownload}>⬇️ {t('shareDownload')}</button>
          <button type="button" style={btn} onClick={doCopy}>📋 {t('shareCopy')}</button>
        </div>

        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '14px' }}>
          <strong style={{ fontSize: '0.9rem' }}>{t('shareImportTitle')}</strong>
          <div style={{ display: 'flex', gap: '8px', margin: '10px 0', flexWrap: 'wrap' }}>
            <button type="button" style={btn} onClick={() => fileRef.current?.click()}>📁 {t('shareChooseFile')}</button>
            <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={onFile} />
            <button type="button" style={btn} disabled={!importText.trim()} onClick={() => applyImport(importText)}>{t('shareImportPasted')}</button>
          </div>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={t('sharePastePlaceholder')}
            style={{ width: '100%', minHeight: '90px', resize: 'vertical', background: 'var(--bg-dark)', border: '1px solid var(--border-color)', color: 'var(--text-main)', borderRadius: '6px', padding: '8px', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}
          />
        </div>
      </div>
    </div>
  );
}
