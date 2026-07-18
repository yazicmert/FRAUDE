import { FormEvent, useState, useEffect, useRef } from 'react';
import { getTickerSnapshot, askAi, listAiHistory, listAiAgents, deleteAiHistory, clearAiHistory } from '../../api/tauriClient';
import { useTranslation } from '../../api/i18n';
import type { AiHistoryRecord, AiAgent, AiChatMessage } from '../../types';
import ReactMarkdown from 'react-markdown';
import { openUrl } from '../../lib/openExternal';

interface AiPanelProps {
  mode: 'side' | 'workspace';
  activeContext: string;
  /** Uygulamanın başka yerlerinden gelen tek-tık AI aksiyonu; nonce değişince çalışır. */
  quickPrompt?: { text: string; nonce: number } | null;
}

function AssistantMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        a: ({ node, ...props }) => (
          <a
            {...props}
            style={{ color: 'var(--accent-primary)', textDecoration: 'underline', cursor: 'pointer' }}
            onClick={async (e) => {
              e.preventDefault();
              if (props.href) {
                try {
                  await openUrl(props.href);
                } catch (err) {
                  console.error('Failed to open link:', err);
                }
              }
            }}
          />
        ),
        p: ({ node, ...props }) => <p style={{ margin: '0 0 12px 0' }} {...props} />,
        ul: ({ node, ...props }) => <ul style={{ margin: '0 0 12px 0', paddingLeft: '24px' }} {...props} />,
        ol: ({ node, ...props }) => <ol style={{ margin: '0 0 12px 0', paddingLeft: '24px' }} {...props} />,
        li: ({ node, ...props }) => <li style={{ marginBottom: '6px' }} {...props} />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export default function AiPanel({ mode, activeContext, quickPrompt }: AiPanelProps) {
  const { t, lang } = useTranslation();
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<AiHistoryRecord[]>([]);
  // Tauri'nin macOS WebView'ü window.confirm/alert desteklemez; onay ve hata
  // bildirimi arayüz içinde gösterilir.
  const [confirmClear, setConfirmClear] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [providerInfo, setProviderInfo] = useState<{ provider: string; model: string } | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  // Yan panel dardır; başlık, kontroller ve giriş alanı sıkışık düzende çizilir.
  const compact = mode === 'side';

  const fetchHistory = async () => {
    try {
      const records = await listAiHistory();
      setHistory(records);
    } catch (e) {
      console.error('Failed to load history', e);
    }
  };

  const fetchAgents = async () => {
    try {
      const records = await listAiAgents();
      setAgents(records.filter(a => a.is_active));
    } catch (e) {
      console.error('Failed to load agents', e);
    }
  };

  useEffect(() => {
    fetchHistory();
    fetchAgents();
  }, []);

  // Yeni mesajda sohbeti en alta kaydır
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const runPrompt = async (raw: string) => {
    const value = raw.trim();
    if (!value || loading) return;

    // Model isteğine anlık hisse verisi eklenir; balonda yalnızca kullanıcının
    // yazdığı metin görünür.
    let finalPrompt = value;
    if (activeContext.startsWith('ticker:')) {
      const ticker = activeContext.replace('ticker:', '');
      try {
        const snapshot = await getTickerSnapshot(ticker);
        if (snapshot && snapshot.equity) {
          const eq = snapshot.equity;
          finalPrompt += `\n[Sistem Notu: Kullanıcının sorduğu hisse ${eq.ticker} (${eq.name}). Anlık fiyat: ${eq.price.toFixed(2)}, Günlük değişim: %${eq.change_pct.toFixed(2)}. RSI: ${eq.rsi.toFixed(1)}, F/K: ${eq.pe?.toFixed(2) || 'Yok'}, PD/DD: ${eq.pb?.toFixed(2) || 'Yok'}, ROE: ${eq.roe !== null ? '%' + eq.roe.toFixed(2) : 'Yok'}. Lütfen cevap verirken bu anlık verileri baz al.]`;
        }
      } catch (e) {
        console.error('Context injection failed', e);
      }
    }

    // Bu mesajdan ÖNCEKİ sohbet geçmişi modele gönderilir; böylece her mesaj
    // aynı konuşmanın devamı olarak anlaşılır.
    const priorThread = messages;
    setMessages(current => [...current, { role: 'user', content: value }]);
    setPrompt('');
    setLoading(true);
    try {
      const aiRes = await askAi(finalPrompt, activeContext, selectedAgentId || undefined, priorThread);
      setMessages(current => [...current, { role: 'assistant', content: aiRes.summary }]);
      setProviderInfo({ provider: aiRes.provider, model: aiRes.model });
      fetchHistory();
    } catch (e) {
      setMessages(current => [...current, { role: 'assistant', content: `⚠️ Hata: ${String(e)}` }]);
    } finally {
      setLoading(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void runPrompt(prompt);
  };

  // Tek-tık AI aksiyonu: en güncel kapanışa erişmek için ref üzerinden çağrılır.
  const runPromptRef = useRef(runPrompt);
  runPromptRef.current = runPrompt;
  const lastQuickNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!quickPrompt) return;
    if (lastQuickNonce.current === quickPrompt.nonce) return;
    lastQuickNonce.current = quickPrompt.nonce;
    void runPromptRef.current(quickPrompt.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickPrompt?.nonce]);

  const loadHistoricalRecord = (record: AiHistoryRecord) => {
    // Kayıt yeni bir sohbet başlangıcı olarak yüklenir; kullanıcı kaldığı
    // yerden devam edebilir.
    setMessages([
      { role: 'user', content: record.prompt },
      { role: 'assistant', content: record.response },
    ]);
    setProviderInfo({ provider: t('aiHistoryRecord'), model: formatTimestamp(record.timestamp) });
  };

  const newChat = () => {
    setMessages([]);
    setProviderInfo(null);
  };

  const removeRecord = async (id: string) => {
    setHistoryError(null);
    try {
      setHistory(await deleteAiHistory(id));
    } catch (e) {
      setHistoryError(t('aiDeleteFailed', { e: String(e) }));
    }
  };

  const clearAll = async () => {
    setHistoryError(null);
    try {
      await clearAiHistory();
      setHistory([]);
    } catch (e) {
      setHistoryError(t('aiClearFailed', { e: String(e) }));
    } finally {
      setConfirmClear(false);
    }
  };

  // Onay istemi birkaç saniye içinde kullanılmazsa kendiliğinden kapanır
  useEffect(() => {
    if (!confirmClear) return;
    const timer = setTimeout(() => setConfirmClear(false), 5000);
    return () => clearTimeout(timer);
  }, [confirmClear]);

  // Eski kayıtlar "unix:..." biçiminde saklanmıştı; okunur tarihe çevrilir.
  const formatTimestamp = (value: string) => {
    const match = value.match(/^unix:(\d+)$/);
    if (!match) return value;
    return new Date(Number(match[1]) * 1000).toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
  };

  return (
    <div className={mode === 'workspace' ? 'view ai-workspace' : 'ai-side'} style={{ display: 'flex', flexDirection: 'row', height: '100%', overflow: 'hidden' }}>

      {/* SIDEBAR FOR HISTORY */}
      {mode === 'workspace' && (
        <div style={{
          width: '300px',
          borderRight: '1px solid var(--border-color)',
          background: 'rgba(0,0,0,0.1)',
          display: 'flex',
          flexDirection: 'column',
          padding: '24px 16px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: '8px' }}>
            <h2 style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '1px', margin: 0, color: 'var(--text-muted)' }}>{t('aiHistoryTitle')}</h2>
            {history.length > 0 && (
              confirmClear ? (
                <span style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={clearAll}
                    style={{ padding: '2px 8px', fontSize: '0.7rem', background: '#f85149', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                  >
                    {t('aiConfirmClearYes')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    style={{ padding: '2px 8px', fontSize: '0.7rem', background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer' }}
                  >
                    {t('aiCancel')}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  title={t('aiClearAllTitle')}
                  style={{ padding: '2px 8px', fontSize: '0.7rem', background: 'transparent', color: '#f85149', border: '1px solid rgba(248, 81, 73, 0.4)', borderRadius: '4px', cursor: 'pointer' }}
                >
                  {t('aiClearAll')}
                </button>
              )
            )}
          </div>
          {historyError && (
            <div style={{ marginBottom: '10px', padding: '8px 10px', fontSize: '0.72rem', color: '#ff7b72', background: 'rgba(248, 81, 73, 0.08)', border: '1px solid rgba(248, 81, 73, 0.35)', borderRadius: '6px' }}>
              {historyError}
            </div>
          )}
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {history.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('aiNoHistory')}</p>
            ) : (
              history.map(record => (
                <div
                  key={record.id}
                  onClick={() => loadHistoricalRecord(record)}
                  title={t('aiLoadRecordTitle')}
                  style={{
                    background: 'var(--bg-panel)',
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    cursor: 'pointer',
                    transition: 'border-color 0.2s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                    <p style={{ flex: 1, minWidth: 0, fontSize: '0.85rem', margin: '0 0 8px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }}>{record.prompt}</p>
                    <button
                      type="button"
                      title={t('aiDeleteRecordTitle')}
                      onClick={(e) => { e.stopPropagation(); void removeRecord(record.id); }}
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.9rem', lineHeight: 1, padding: '0 2px' }}
                      onMouseEnter={(e) => e.currentTarget.style.color = '#f85149'}
                      onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
                    >
                      ×
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                    {record.tags.map(tag => (
                      <span key={tag} style={{ fontSize: '0.65rem', padding: '2px 6px', background: 'rgba(0, 255, 157, 0.1)', color: 'var(--accent-primary)', borderRadius: '4px' }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{formatTimestamp(record.timestamp)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* MAIN CONTENT */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: compact ? '14px 14px 12px' : '32px', overflow: 'hidden', background: 'var(--bg-default)' }}>
        {compact ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
              <strong style={{ fontSize: '0.9rem', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>✨ {t('aiChat')}</strong>
              <span
                title={`${t('aiContext')}: ${activeContext || 'Global'}`}
                style={{
                  fontSize: '0.65rem', padding: '2px 8px', borderRadius: '10px',
                  background: 'rgba(0, 255, 157, 0.08)', color: 'var(--accent-primary)',
                  border: '1px solid rgba(0, 255, 157, 0.18)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
                }}
              >
                {activeContext || 'Global'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={newChat}
                  title={t('aiNewChat')}
                  style={{ width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-color)', fontSize: '0.95rem', lineHeight: 1, cursor: 'pointer' }}
                >
                  +
                </button>
              )}
              <select
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                title={t('aiAgentTitle')}
                style={{ maxWidth: '110px', padding: '3px 4px', borderRadius: '6px', background: 'var(--bg-panel)', color: 'var(--text-muted)', border: '1px solid var(--border-color)', fontSize: '0.7rem' }}
              >
                <option value="">Global AI</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
        ) : (
          <div className="view-header" style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p className="eyebrow">AI Analyst</p>
              <h1>{t('aiResearch')}</h1>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={newChat}
                  style={{ padding: '4px 12px', borderRadius: '6px', background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-color)', fontSize: '0.8rem', cursor: 'pointer' }}
                >
                  + {t('aiNewChat')}
                </button>
              )}
              <select
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                style={{ padding: '4px 8px', borderRadius: '6px', background: 'var(--bg-panel)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', fontSize: '0.8rem' }}
              >
                <option value="">Global AI</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <span style={{ fontSize: '0.8rem', padding: '4px 10px', background: 'rgba(0, 255, 157, 0.1)', color: 'var(--accent-primary)', borderRadius: '12px', border: '1px solid rgba(0, 255, 157, 0.2)' }}>
                {t('aiContext')}: {activeContext || 'Global'}
              </span>
            </div>
          </div>
        )}

        <div ref={threadRef} style={{ flex: 1, overflowY: 'auto', paddingBottom: '20px' }}>
          {messages.length === 0 ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              opacity: 0.5,
              textAlign: 'center'
            }}>
              <div style={{ fontSize: compact ? '1.8rem' : '3rem', marginBottom: compact ? '10px' : '16px' }}>✨</div>
              <h2 style={{ marginBottom: '8px', fontWeight: 500, fontSize: compact ? '0.95rem' : undefined }}>{t('aiReady')}</h2>
              <p style={{ maxWidth: '400px', fontSize: compact ? '0.78rem' : '0.9rem', lineHeight: 1.5, padding: compact ? '0 8px' : 0 }}>
                {compact ? t('aiIntroCompact') : t('aiIntroFull')}
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {messages.map((message, index) => (
                message.role === 'user' ? (
                  <div key={index} style={{ alignSelf: 'flex-end', maxWidth: compact ? '88%' : '80%' }}>
                    <div style={{
                      background: 'rgba(0, 255, 157, 0.08)',
                      border: '1px solid rgba(0, 255, 157, 0.2)',
                      borderRadius: '12px 12px 2px 12px',
                      padding: compact ? '8px 10px' : '10px 14px',
                      fontSize: compact ? '0.82rem' : '0.95rem',
                      lineHeight: 1.55,
                      color: 'var(--text-primary)',
                      whiteSpace: 'pre-wrap',
                    }}>
                      {message.content}
                    </div>
                  </div>
                ) : (
                  <div key={index} style={{ alignSelf: 'flex-start', maxWidth: compact ? '100%' : '95%', fontSize: compact ? '0.86rem' : '1rem', lineHeight: compact ? 1.6 : 1.7, color: 'var(--text-primary)' }}>
                    <AssistantMarkdown content={message.content} />
                  </div>
                )
              ))}
              {loading && (
                <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  <div style={{ width: '12px', height: '12px', border: '2px solid rgba(255,255,255,0.2)', borderTop: '2px solid var(--accent-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                  {t('aiPreparing')}
                </div>
              )}
              <p style={{ margin: '4px 0 0', fontSize: compact ? '0.65rem' : '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                {t('aiDisclaimer')}
                {providerInfo && ` · ${providerInfo.provider} / ${providerInfo.model}`}
              </p>
            </div>
          )}
        </div>

        <div style={{ marginTop: 'auto', paddingTop: compact ? '10px' : '16px' }}>
          <form onSubmit={submit} style={compact ? undefined : { position: 'relative' }}>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit(e as unknown as FormEvent);
                }
              }}
              placeholder={messages.length > 0 ? t('aiContinuePlaceholder') : compact ? t('aiAskPlaceholderCompact') : t('aiAskPlaceholderFull')}
              style={{
                width: '100%',
                minHeight: compact ? '46px' : '60px',
                background: 'var(--bg-panel)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: compact ? '10px 12px' : '16px',
                paddingRight: compact ? '12px' : '120px',
                fontSize: compact ? '0.84rem' : '0.95rem',
                color: 'var(--text-primary)',
                resize: 'none',
                fontFamily: 'inherit',
                transition: 'border-color 0.2s',
                outline: 'none',
                boxShadow: compact ? 'none' : '0 4px 12px rgba(0, 0, 0, 0.1)',
                display: 'block',
                boxSizing: 'border-box',
              }}
              onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
              onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
            />
            {compact ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>{t('aiEnterToSend')}</span>
                <button
                  type="submit"
                  disabled={loading || !prompt.trim()}
                  style={{
                    background: loading ? 'transparent' : 'var(--text-primary)',
                    color: loading ? 'var(--text-primary)' : 'var(--bg-default)',
                    border: loading ? '1px solid var(--border-color)' : 'none',
                    padding: '5px 14px',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: loading || !prompt.trim() ? 'not-allowed' : 'pointer',
                    opacity: !prompt.trim() && !loading ? 0.35 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  {loading ? (
                    <>
                      <div style={{ width: '10px', height: '10px', border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid currentColor', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                      {t('aiProcessing')}
                    </>
                  ) : t('aiSend')}
                </button>
              </div>
            ) : (
              <button
                type="submit"
                disabled={loading || !prompt.trim()}
                style={{
                  position: 'absolute',
                  right: '8px',
                  bottom: '12px',
                  background: loading ? 'transparent' : 'var(--text-primary)',
                  color: loading ? 'var(--text-primary)' : 'var(--bg-default)',
                  border: loading ? '1px solid var(--text-primary)' : 'none',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  fontWeight: '600',
                  cursor: loading || !prompt.trim() ? 'not-allowed' : 'pointer',
                  opacity: !prompt.trim() && !loading ? 0.3 : 1,
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                {loading ? (
                  <>
                    <div style={{ width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid currentColor', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    {t('aiProcessing')}
                  </>
                ) : t('aiSend')}
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
