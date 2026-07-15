import { useEffect, useMemo, useRef, useState } from 'react';

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

const TICKER_RE = /^[a-zA-Z]{2,6}$/;

export default function CommandPalette({ open, onClose, commands, onOpenTicker, onRunFql, recentTickers }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const items = useMemo<PaletteCommand[]>(() => {
    const q = query.trim();
    const lower = q.toLowerCase();
    const out: PaletteCommand[] = [];

    if (q) {
      if (TICKER_RE.test(q)) {
        const sym = q.toUpperCase();
        out.push({ id: 'open-ticker', label: `Hisse aç · ${sym}`, hint: 'ENTER', run: () => onOpenTicker(sym) });
      }
      out.push({ id: 'run-fql', label: `Terminalde çalıştır · ${q}`, hint: 'FQL', run: () => onRunFql(q) });
    }

    const matches = (c: PaletteCommand) => {
      if (!lower) return true;
      const hay = `${c.label} ${c.keywords ?? ''}`.toLowerCase();
      return lower.split(/\s+/).every((tok) => hay.includes(tok));
    };
    out.push(...commands.filter(matches));

    if (recentTickers.length > 0) {
      for (const tk of recentTickers.slice(0, 8)) {
        if (!lower || tk.toLowerCase().includes(lower)) {
          out.push({ id: `recent-${tk}`, label: tk, hint: 'son bakılan', run: () => onOpenTicker(tk) });
        }
      }
    }
    return out;
  }, [query, commands, recentTickers, onOpenTicker, onRunFql]);

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
          placeholder="Komut, hisse kodu veya FQL yaz… (örn. GARAN, scan BIST100 where rsi < 30)"
          style={{
            width: '100%', padding: '14px 16px', fontSize: '0.95rem',
            background: 'var(--bg-dark)', border: 'none', borderBottom: '1px solid var(--border-color)',
            color: 'var(--text-main)', fontFamily: 'var(--font-mono)', outline: 'none',
          }}
        />
        <div style={{ maxHeight: '48vh', overflow: 'auto' }}>
          {items.length === 0 ? (
            <div style={{ padding: '18px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Eşleşme yok.</div>
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
          ↑↓ gez · ENTER seç · ESC kapat
        </div>
      </div>
    </div>
  );
}
