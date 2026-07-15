import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../api/i18n';

interface TerminalEntry {
  cmd: string;
  output: string;
  ok: boolean;
}

interface TerminalPanelProps {
  history: TerminalEntry[];
  onCommand: (cmd: string) => Promise<void>;
}

const MIN_HEIGHT = 80;
const MAX_HEIGHT = 600;
const DEFAULT_HEIGHT = 176;

// FQL komut şablonları — terminal girişinde otomatik tamamlama önerileri.
const FQL_TEMPLATES: { insert: string; label: string; desc: string }[] = [
  { insert: 'open ', label: 'open <HİSSE>', desc: 'Hisse detayını aç' },
  { insert: 'scan BIST100 where rsi < 30', label: 'scan BIST100 where rsi < 30', desc: 'Aşırı satım taraması' },
  { insert: 'scan BIST100 where ', label: 'scan <PAZAR> where <koşul>', desc: 'Filtreli tarama' },
  { insert: 'kap ', label: 'kap <HİSSE>', desc: 'KAP bildirimleri' },
  { insert: 'ai ', label: 'ai <soru>', desc: 'AI’ya sor' },
  { insert: 'sync all incremental', label: 'sync all incremental', desc: 'Verileri senkronla' },
  { insert: 'help', label: 'help', desc: 'Komut yardımı' },
];

export default function TerminalPanel({ history, onCommand }: TerminalPanelProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);
  const [sugIdx, setSugIdx] = useState(-1);
  const [executingCmd, setExecutingCmd] = useState<string | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [height, setHeight] = useState(() => {
    const saved = localStorage.getItem('fraude-terminal-height');
    return saved ? Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, parseInt(saved, 10))) : DEFAULT_HEIGHT;
  });
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(DEFAULT_HEIGHT);

  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
    }
  }, [history]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startY.current = e.clientY;
    startHeight.current = height;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [height]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = startY.current - e.clientY; // upward drag increases height
      const newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, startHeight.current + delta));
      setHeight(newHeight);
    };

    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // persist
      localStorage.setItem('fraude-terminal-height', String(height));
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [height]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const command = input.trim();
    if (!command || executingCmd) return;
    setInput('');
    setExecutingCmd(command);
    try {
      await onCommand(command);
    } finally {
      setExecutingCmd(null);
    }
  };

  const inputLower = input.trim().toLowerCase();
  const suggestions = FQL_TEMPLATES.filter((s) =>
    inputLower === '' ? true : (s.insert.toLowerCase().startsWith(inputLower) || s.label.toLowerCase().includes(inputLower)),
  ).slice(0, 6);

  const applySuggestion = (i: number) => {
    const s = suggestions[i];
    if (!s) return;
    setInput(s.insert);
    setSugIdx(-1);
    inputRef.current?.focus();
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!focused || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSugIdx((idx) => Math.min(suggestions.length - 1, idx + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSugIdx((idx) => Math.max(-1, idx - 1));
    } else if (e.key === 'Tab') {
      e.preventDefault();
      applySuggestion(sugIdx >= 0 ? sugIdx : 0);
    } else if (e.key === 'Escape') {
      setSugIdx(-1);
      setFocused(false);
    }
  };

  return (
    <section className="terminal" style={{ height: `${height}px`, minHeight: `${MIN_HEIGHT}px`, maxHeight: `${MAX_HEIGHT}px` }}>
      {/* Drag resize handle */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          height: '5px',
          cursor: 'row-resize',
          background: 'transparent',
          position: 'relative',
          flexShrink: 0,
        }}
      >
        <div style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: '40px',
          height: '3px',
          borderRadius: '2px',
          background: 'var(--border-color)',
          transition: 'background 0.2s',
        }} />
      </div>
      <div className="terminal-header">
        <span>FRAUDE FQL</span>
        <span className="muted">{t('terminalTagline')}</span>
      </div>
      <div className="terminal-history" ref={historyRef}>
        {history.map((entry, index) => (
          <div key={`${entry.cmd}-${index}`} className="terminal-line">
            <div className="terminal-command">&gt; {entry.cmd}</div>
            <div className={entry.ok ? 'terminal-output' : 'terminal-output error'}>{entry.output}</div>
          </div>
        ))}
        {executingCmd && (
          <div className="terminal-line">
            <div className="terminal-command">&gt; {executingCmd}</div>
            <div className="terminal-output" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' }}>
              <div style={{ width: '12px', height: '12px', border: '2px solid rgba(0,255,157,0.3)', borderTop: '2px solid var(--accent-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
              İşleniyor...
            </div>
          </div>
        )}
      </div>
      <div style={{ position: 'relative' }}>
        {focused && suggestions.length > 0 && (
          <div style={{
            position: 'absolute', bottom: '100%', left: '0', right: '0',
            background: 'var(--bg-panel)', border: '1px solid var(--border-color)',
            borderBottom: 'none', maxHeight: '180px', overflow: 'auto', zIndex: 20,
          }}>
            {suggestions.map((s, i) => (
              <div
                key={s.label}
                onMouseDown={(e) => { e.preventDefault(); applySuggestion(i); }}
                onMouseEnter={() => setSugIdx(i)}
                style={{
                  display: 'flex', justifyContent: 'space-between', gap: '12px',
                  padding: '6px 12px', cursor: 'pointer', fontSize: '0.78rem',
                  fontFamily: 'var(--font-mono)',
                  background: i === sugIdx ? 'var(--bg-hover)' : 'transparent',
                }}
              >
                <span style={{ color: 'var(--accent-primary)' }}>{s.label}</span>
                <span style={{ color: 'var(--text-muted)' }}>{s.desc}</span>
              </div>
            ))}
          </div>
        )}
        <form className="terminal-input-form" onSubmit={handleSubmit}>
          <span className="prompt">&gt;_</span>
          <input
            ref={inputRef}
            className="terminal-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={onInputKeyDown}
            placeholder={`${t('terminalPlaceholder')} · TAB ile tamamla`}
            autoFocus
          />
        </form>
      </div>
    </section>
  );
}

