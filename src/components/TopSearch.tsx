import { useEffect, useState } from 'react';
import { getDashboardSnapshot } from '../api/tauriClient';
import { isDataRuntimeConfigured } from '../api/platformClient';
import { useTranslation } from '../api/i18n';
import type { EquityRow } from '../types';
import { PRESET_SYMBOLS, normalizeSearch, presetMatchesQuery, PresetSymbol } from './symbolCatalog';

interface TopSearchProps {
  placeholder: string;
  /** Kutunun sağında gösterilen kısayol rozeti (ör. komut paleti ⌘K). */
  hintKeys?: string[];
  onCommand: (cmd: string) => void;
  onSelectTicker: (ticker: string) => void;
  onSelectIndex: (symbol: string) => void;
}

type Suggestion =
  | { kind: 'equity'; ticker: string; name: string }
  | { kind: 'preset'; preset: PresetSymbol };

const COMMAND_PREFIXES = ['ask', 'open', 'scan', 'kap', 'sync', 'help'];

function isCommandInput(value: string): boolean {
  const lower = value.trim().toLowerCase();
  return COMMAND_PREFIXES.some(prefix => lower === prefix || lower.startsWith(`${prefix} `));
}

/**
 * Üst çubuk arama kutusu: yazarken hisse, endeks, emtia, döviz ve kripto
 * varlıklarında canlı arama yapar; ask/open/scan gibi girdiler FQL komutu
 * olarak çalıştırılır.
 */
export default function TopSearch({ placeholder, hintKeys, onCommand, onSelectTicker, onSelectIndex }: TopSearchProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
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

  const query = normalizeSearch(value);
  const command = isCommandInput(value);

  const equityMatches = !query || command
    ? []
    : equities
        .filter(eq => normalizeSearch(eq.ticker).includes(query) || normalizeSearch(eq.name).includes(query))
        .slice(0, 8);
  const presetMatches = !query || command
    ? []
    : PRESET_SYMBOLS
        .filter(p => presetMatchesQuery(p, query) && !equityMatches.some(e => e.ticker === p.symbol))
        .slice(0, 8);

  const suggestions: Suggestion[] = [
    ...equityMatches.map(eq => ({ kind: 'equity' as const, ticker: eq.ticker, name: eq.name })),
    ...presetMatches.map(preset => ({ kind: 'preset' as const, preset })),
  ];
  const activeIndex = Math.min(highlight, Math.max(suggestions.length - 1, 0));

  const reset = () => {
    setValue('');
    setOpen(false);
    setHighlight(0);
  };

  const pick = (suggestion: Suggestion) => {
    if (suggestion.kind === 'equity') {
      onSelectTicker(suggestion.ticker);
    } else if (suggestion.preset.indexName) {
      onSelectIndex(suggestion.preset.indexName);
    } else {
      onSelectTicker(suggestion.preset.symbol);
    }
    reset();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && suggestions.length > 0) {
      event.preventDefault();
      setHighlight(current => (current + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp' && suggestions.length > 0) {
      event.preventDefault();
      setHighlight(current => (current - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === 'Escape') {
      setOpen(false);
    } else if (event.key === 'Enter') {
      const trimmed = value.trim();
      if (!trimmed) return;
      if (!command && suggestions.length > 0) {
        pick(suggestions[activeIndex]);
      } else {
        onCommand(trimmed);
        reset();
      }
    }
  };

  return (
    <div style={{ position: 'relative', maxWidth: '400px', width: '100%' }}>
      <input
        className="top-input"
        placeholder={placeholder}
        value={value}
        style={{ width: '100%' }}
        autoComplete="off"
        onChange={(event) => { setValue(event.target.value); setOpen(true); setHighlight(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={handleKeyDown}
      />
      {hintKeys && hintKeys.length > 0 && !value && (
        <span className="top-input-kbd">
          {hintKeys.map((key) => <kbd key={key}>{key}</kbd>)}
        </span>
      )}
      {open && query.length > 0 && !command && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
          background: 'var(--bg-panel)', border: '1px solid var(--border-color)',
          borderRadius: '6px', margin: '6px 0 0 0',
          maxHeight: '340px', overflowY: 'auto',
          boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
        }}>
          {suggestions.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {t('searchNoResults')}
            </div>
          ) : (
            <>
              {suggestions.map((suggestion, index) => {
                const isActive = index === activeIndex;
                const rowStyle: React.CSSProperties = {
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '7px 12px', cursor: 'pointer', fontSize: '0.82rem',
                  background: isActive ? 'rgba(0, 255, 157, 0.07)' : 'transparent',
                  borderLeft: isActive ? '2px solid var(--accent-primary)' : '2px solid transparent',
                };
                return suggestion.kind === 'equity' ? (
                  <div
                    key={`eq-${suggestion.ticker}`}
                    style={rowStyle}
                    onMouseDown={(e) => { e.preventDefault(); pick(suggestion); }}
                    onMouseEnter={() => setHighlight(index)}
                  >
                    <span style={{ fontWeight: 'bold', color: 'var(--accent-primary)', minWidth: '58px' }}>
                      {suggestion.ticker.replace('.IS', '')}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, color: 'var(--text-muted)', fontSize: '0.72rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {suggestion.name}
                    </span>
                    <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '1px 6px' }}>
                      {t('hintEquity')}
                    </span>
                  </div>
                ) : (
                  <div
                    key={`p-${suggestion.preset.symbol}`}
                    style={rowStyle}
                    onMouseDown={(e) => { e.preventDefault(); pick(suggestion); }}
                    onMouseEnter={() => setHighlight(index)}
                  >
                    <span style={{ fontWeight: 'bold', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                      {suggestion.preset.label}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, color: 'var(--text-muted)', fontSize: '0.7rem', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {suggestion.preset.symbol}
                    </span>
                    <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '1px 6px' }}>
                      {suggestion.preset.group}
                    </span>
                  </div>
                );
              })}
              <div style={{ padding: '5px 12px', fontSize: '0.62rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)' }}>
                {t('searchFooterHint')}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
