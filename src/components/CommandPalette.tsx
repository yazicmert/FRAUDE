import { useEffect, useMemo, useRef, useState } from 'react';
import { getDashboardSnapshot } from '../api/tauriClient';
import { isDataRuntimeConfigured } from '../api/platformClient';
import { useTranslation } from '../api/i18n';
import type { EquityRow } from '../types';
import { PRESET_SYMBOLS, normalizeSearch, presetMatchesQuery } from './symbolCatalog';

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  keywords?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: PaletteCommand[];
  onOpenTicker: (ticker: string) => void;
  onRunFql: (cmd: string) => void;
  recentTickers: string[];
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
  paddingTop: '12vh', zIndex: 1200,
};

const box: React.CSSProperties = {
  width: 'min(560px, 92vw)', background: 'var(--bg-panel)',
  border: '1px solid var(--border-color)', borderRadius: '10px',
  boxShadow: '0 20px 60px rgba(0,0,0,0.55)', overflow: 'hidden',
};

export default function CommandPalette({ open, onClose, commands, onOpenTicker, onRunFql, recentTickers }: CommandPaletteProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [equities, setEquities] = useState<EquityRow[]>([]);

  useEffect(() => {
    if (!isDataRuntimeConfigured()) return;
    let cancelled = false;
    const load = () => {
      getDashboardSnapshot()
        .then(snapshot => { if (!cancelled) setEquities(snapshot.equities ?? []); })
        .catch(() => {});
    };
    load();
    window.addEventListener('fraude-sync-completed', load);
    return () => {
      cancelled = true;
      window.removeEventListener('fraude-sync-completed', load);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const items = useMemo<PaletteCommand[]>(() => {
    const q = query.trim();
    const lower = normalizeSearch(q);
    const out: PaletteCommand[] = [];

    if (q) {
      // Akıllı Hisse / Sembol araması
      const equityMatches = equities
        .filter(eq => normalizeSearch(eq.ticker).includes(lower) || normalizeSearch(eq.name).includes(lower))
        .slice(0, 5);
      
      const presetMatches = PRESET_SYMBOLS
        .filter(p => presetMatchesQuery(p, lower) && !equityMatches.some(e => e.ticker === p.symbol))
        .slice(0, 3);

      for (const eq of equityMatches) {
        out.push({ id: `eq-${eq.ticker}`, label: `${eq.ticker} · ${eq.name}`, hint: t('hintEquity'), run: () => onOpenTicker(eq.ticker) });
      }
      for (const p of presetMatches) {
        out.push({ id: `preset-${p.symbol}`, label: `${p.symbol} · ${p.label}`, hint: t('hintPreset'), run: () => onOpenTicker(p.symbol) });
      }

      // FQL Komutu çalıştırma (Eğer bir sembol seçmezse)
      out.push({ id: 'run-fql', label: `${t('paletteRunFql')} · ${q}`, hint: 'FQL', run: () => onRunFql(q) });
    }

    const matches = (c: PaletteCommand) => {
      if (!lower) return true;
      const hay = `${c.label} ${c.keywords ?? ''}`.toLowerCase();
      return lower.split(/\s+/).every((tok) => hay.includes(tok));
    };
    out.push(...commands.filter(matches));

    if (recentTickers.length > 0 && !q) {
      for (const tk of recentTickers.slice(0, 6)) {
        out.push({ id: `recent-${tk}`, label: tk, hint: t('hintRecent'), run: () => onOpenTicker(tk) });
      }
    }
    return out;
  }, [query, commands, recentTickers, onOpenTicker, onRunFql, equities]);

  useEffect(() => { setSel(0); }, [query]);

  if (!open) return null;

  const runAt = (i: number) => {
    const item = items[i];
    if (!item) return;
    item.run();
    onClose();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); runAt(sel); }
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={box} onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder={t('paletteInputPlaceholder')}
          style={{
            width: '100%', padding: '14px 16px', fontSize: '0.95rem',
            background: 'var(--bg-dark)', border: 'none', borderBottom: '1px solid var(--border-color)',
            color: 'var(--text-main)', fontFamily: 'var(--font-mono)', outline: 'none',
          }}
        />
        <div style={{ maxHeight: '48vh', overflow: 'auto' }}>
          {items.length === 0 ? (
            <div style={{ padding: '18px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t('paletteNoMatch')}</div>
          ) : (
            items.map((it, i) => (
              <div
                key={it.id}
                onMouseEnter={() => setSel(i)}
                onClick={() => runAt(i)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
                  padding: '9px 16px', cursor: 'pointer',
                  background: i === sel ? 'var(--bg-hover)' : 'transparent',
                  borderLeft: i === sel ? '2px solid var(--accent-primary)' : '2px solid transparent',
                }}
              >
                <span style={{ fontSize: '0.85rem', color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</span>
                {it.hint && <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{it.hint}</span>}
              </div>
            ))
          )}
        </div>
        <div style={{ padding: '7px 16px', borderTop: '1px solid var(--border-color)', fontSize: '0.66rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {t('paletteFooterHint')}
        </div>
      </div>
    </div>
  );
}
