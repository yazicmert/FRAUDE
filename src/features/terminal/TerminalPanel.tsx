import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../api/i18n';

export interface TerminalEntry {
  cmd: string;
  output: string;
  ok: boolean;
}

interface TerminalPanelProps {
  history: TerminalEntry[];
  onCommand: (cmd: string) => Promise<void>;
  onClearHistory?: () => void;
  terminalHeight?: number;
  onHeightChange?: (h: number) => void;
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
  { insert: 'clear', label: 'clear', desc: 'Terminal geçmişini temizle' },
  { insert: 'help', label: 'help', desc: 'Komut yardımı' },
];

export default function TerminalPanel({
  history,
  onCommand,
  onClearHistory,
  terminalHeight,
  onHeightChange,
}: TerminalPanelProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);
  const [sugIdx, setSugIdx] = useState(-1);
  const [executingCmd, setExecutingCmd] = useState<string | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [height, setHeight] = useState(() => {
    if (typeof terminalHeight === 'number' && terminalHeight > 0) return terminalHeight;
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
  }, [history, executingCmd]);

  const updateHeight = useCallback(
    (newHeight: number) => {
      const clamped = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, newHeight));
      setHeight(clamped);
      localStorage.setItem('fraude-terminal-height', String(clamped));
      onHeightChange?.(clamped);
    },
    [onHeightChange],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      startY.current = e.clientY;
      startHeight.current = height;
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    },
    [height],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = startY.current - e.clientY; // upward drag increases height
      updateHeight(startHeight.current + delta);
    };

    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [updateHeight]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const command = input.trim();
    if (!command || executingCmd) return;
    setInput('');
    setSugIdx(-1);

    if (command.toLowerCase() === 'clear') {
      onClearHistory?.();
      return;
    }

    setExecutingCmd(command);
    try {
      await onCommand(command);
    } finally {
      setExecutingCmd(null);
    }
  };

  const inputLower = input.trim().toLowerCase();
  const suggestions = FQL_TEMPLATES.filter((s) =>
    inputLower === ''
      ? true
      : s.insert.toLowerCase().startsWith(inputLower) || s.label.toLowerCase().includes(inputLower),
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

  const handleResetHeight = () => {
    updateHeight(DEFAULT_HEIGHT);
  };

  return (
    <section
      className="terminal"
      style={{
        height: `${height}px`,
        minHeight: `${MIN_HEIGHT}px`,
        maxHeight: `${MAX_HEIGHT}px`,
      }}
    >
      {/* Drag resize handle */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          height: '6px',
          cursor: 'row-resize',
          background: 'transparent',
          position: 'relative',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        title="Sürükleyerek terminal yüksekliğini ayarla"
      >
        <div
          style={{
            width: '44px',
            height: '3px',
            borderRadius: '2px',
            background: 'var(--border-color)',
            transition: 'background 0.2s, width 0.2s',
          }}
        />
      </div>

      <div className="terminal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontWeight: 700, letterSpacing: '0.05em' }}>FRAUDE FQL</span>
          <span className="muted" style={{ fontSize: '0.72rem' }}>
            {t('terminalTagline')}
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '1px 6px',
              borderRadius: '999px',
              background: 'rgba(0, 255, 157, 0.1)',
              border: '1px solid rgba(0, 255, 157, 0.25)',
              fontSize: '0.62rem',
              color: '#00ff9d',
              fontWeight: 600,
            }}
          >
            <span
              style={{
                width: '5px',
                height: '5px',
                borderRadius: '50%',
                background: '#00ff9d',
                boxShadow: '0 0 6px #00ff9d',
              }}
            />
            CANLI
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            type="button"
            onClick={handleResetHeight}
            title="Yüksekliği sıfırla (176px)"
            style={{
              background: 'transparent',
              border: '1px solid var(--border-color)',
              color: 'var(--text-muted)',
              fontSize: '0.68rem',
              padding: '2px 7px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
            }}
          >
            Sıfırla
          </button>

          {onClearHistory && (
            <button
              type="button"
              onClick={onClearHistory}
              title="Geçmişi temizle (clear)"
              style={{
                background: 'transparent',
                border: '1px solid var(--border-color)',
                color: 'var(--text-muted)',
                fontSize: '0.68rem',
                padding: '2px 7px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
              }}
            >
              Temizle
            </button>
          )}
        </div>
      </div>

      <div className="terminal-history" ref={historyRef}>
        {history.map((entry, index) => {
          const isAi = entry.cmd.startsWith('ai ');
          return (
            <div key={`${entry.cmd}-${index}`} className="terminal-line" style={{ marginBottom: '8px' }}>
              <div
                className="terminal-command"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontWeight: 600,
                  fontSize: '0.78rem',
                }}
              >
                <span style={{ color: 'var(--accent-primary)' }}>&gt;</span>
                <span>{entry.cmd}</span>
              </div>

              <div
                className={entry.ok ? 'terminal-output' : 'terminal-output error'}
                style={{
                  marginTop: '3px',
                  padding: '5px 9px',
                  borderRadius: '5px',
                  background: entry.ok
                    ? isAi
                      ? 'rgba(0, 195, 255, 0.05)'
                      : 'rgba(255, 255, 255, 0.02)'
                    : 'rgba(255, 77, 77, 0.08)',
                  borderLeft: entry.ok
                    ? isAi
                      ? '3px solid #00c3ff'
                      : '3px solid var(--accent-primary)'
                    : '3px solid #ff4d4d',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.78rem',
                  lineHeight: '1.45',
                  color: entry.ok ? 'var(--text-main, #d0d7de)' : '#ff8080',
                }}
              >
                {entry.output}
              </div>
            </div>
          );
        })}

        {executingCmd && (
          <div className="terminal-line">
            <div className="terminal-command" style={{ fontWeight: 600 }}>
              &gt; {executingCmd}
            </div>
            <div
              className="terminal-output"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                color: 'var(--text-muted)',
                marginTop: '3px',
                padding: '4px 8px',
              }}
            >
              <div
                style={{
                  width: '12px',
                  height: '12px',
                  border: '2px solid rgba(0,255,157,0.3)',
                  borderTop: '2px solid var(--accent-primary)',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                }}
              />
              Komut işleniyor...
            </div>
          </div>
        )}
      </div>

      <div style={{ position: 'relative' }}>
        {focused && suggestions.length > 0 && (
          <div
            style={{
              position: 'absolute',
              bottom: '100%',
              left: '0',
              right: '0',
              background: 'rgba(13, 17, 23, 0.95)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid rgba(0, 195, 255, 0.35)',
              borderRadius: '8px 8px 0 0',
              boxShadow: '0 -10px 30px rgba(0, 0, 0, 0.7), 0 0 15px rgba(0, 195, 255, 0.15)',
              maxHeight: '180px',
              overflowY: 'auto',
              zIndex: 50,
            }}
          >
            {suggestions.map((s, i) => (
              <div
                key={s.label}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applySuggestion(i);
                }}
                onMouseEnter={() => setSugIdx(i)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '7px 12px',
                  cursor: 'pointer',
                  fontSize: '0.78rem',
                  fontFamily: 'var(--font-mono)',
                  background: i === sugIdx ? 'rgba(0, 195, 255, 0.15)' : 'transparent',
                  borderLeft: i === sugIdx ? '3px solid #00c3ff' : '3px solid transparent',
                  transition: 'background 0.15s ease',
                }}
              >
                <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{s.label}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>{s.desc}</span>
              </div>
            ))}
          </div>
        )}

        <form className="terminal-input-form" onSubmit={handleSubmit}>
          <span className="prompt" style={{ fontWeight: 700, paddingRight: '4px' }}>
            &gt;_
          </span>
          <input
            ref={inputRef}
            className="terminal-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={onInputKeyDown}
            placeholder={`${t('terminalPlaceholder')} · TAB ile tamamla · 'clear' ile temizle`}
            autoFocus
          />
        </form>
      </div>
    </section>
  );
}


