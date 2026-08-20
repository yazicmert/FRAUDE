import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../../api/i18n';
import { getSession } from '../auth/session';
import { supabase } from '../auth/supabaseClient';
import { useWatchlist } from '../../hooks/useWatchlist';
import { getDashboardSnapshot } from '../../api/tauriClient';
import { normalizeSearch } from '../../components/symbolCatalog';
import './NotificationsView.css';

interface Prefs {
  enabled: boolean;
  kap_enabled: boolean;
  spk_enabled: boolean;
  news_enabled: boolean;
  tickers: string[];
  keywords: string[];
  min_priority: number;
}

const DEFAULTS: Prefs = {
  enabled: true,
  kap_enabled: true,
  spk_enabled: true,
  news_enabled: true,
  tickers: [],
  keywords: [],
  min_priority: 4,
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Ayrıntılı bildirim yönetimi (masaüstü). Web'deki /hesap paneliyle aynı
 * notify_prefs tablosunu kullanır; ek olarak izleme listesiyle entegre çalışır
 * (tek tıkla içe aktarma) ve hisse/anahtar kelimeleri çip olarak düzenletir.
 */
export default function NotificationsView() {
  const { t } = useTranslation();
  const session = getSession();
  const { watchlist } = useWatchlist();

  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [newTicker, setNewTicker] = useState('');
  const [newKeyword, setNewKeyword] = useState('');
  const [state, setState] = useState<SaveState>('idle');
  const [ready, setReady] = useState(false);
  const [universe, setUniverse] = useState<{ ticker: string; name: string }[]>([]);
  const [tickerFocus, setTickerFocus] = useState(false);
  const [feedToken, setFeedToken] = useState('');
  const [copied, setCopied] = useState(false);

  // Telegram entegrasyon durumu
  const [transport, setTransport] = useState<{
    kind: string;
    telegram_chat_id: string | null;
    telegram_username: string | null;
    verified_at: string | null;
  } | null>(null);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [pairLoading, setPairLoading] = useState(false);
  const [pairEmailSent, setPairEmailSent] = useState(false);
  const [disconnectLoading, setDisconnectLoading] = useState(false);
  const [testMsgLoading, setTestMsgLoading] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const fetchTransport = async () => {
    if (!session?.id) return;
    const { data } = await supabase
      .from('notify_transports')
      .select('kind, telegram_chat_id, telegram_username, verified_at')
      .eq('user_id', session.id)
      .maybeSingle();
    if (data) {
      setTransport(data as any);
    } else {
      setTransport(null);
    }
  };

  useEffect(() => {
    if (!session) {
      setReady(true);
      return;
    }
    let cancelled = false;
    void supabase
      .from('notify_prefs')
      .select('enabled, kap_enabled, spk_enabled, news_enabled, tickers, keywords, min_priority, feed_token')
      .eq('user_id', session.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data) {
          const { feed_token, ...rest } = data as Prefs & { feed_token?: string };
          setPrefs({ ...DEFAULTS, ...(rest as Prefs) });
          if (feed_token) setFeedToken(feed_token);
        }
        setReady(true);
      });

    void fetchTransport();

    const onFocus = () => {
      void fetchTransport();
    };
    window.addEventListener('focus', onFocus);

    // Gerçek zamanlı kanal güncellemesini dinle
    const channel = supabase
      .channel(`notify_transports:${session.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notify_transports', filter: `user_id=eq.${session.id}` },
        () => {
          void fetchTransport();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      void supabase.removeChannel(channel);
    };
  }, [session?.id]);

  // Kod üretildiğinde kullanıcı Telegram'dan onaylayana kadar 2 saniyede bir otomatik yokla
  useEffect(() => {
    if (!pairCode) return;
    const timer = setInterval(() => {
      void fetchTransport();
    }, 2000);
    return () => clearInterval(timer);
  }, [pairCode]);

  // Telegram bağlandığı anda kod kutusunu kapat
  useEffect(() => {
    if (transport?.kind === 'telegram' && transport?.telegram_chat_id) {
      setPairCode(null);
    }
  }, [transport?.kind, transport?.telegram_chat_id]);

  const handleGetPairCode = async () => {
    setPairLoading(true);
    setPairEmailSent(false);
    try {
      const { data, error } = await supabase.functions.invoke('telegram-pair');
      if (error) throw error;
      if (data?.ok) {
        setPairCode(data.code);
        setPairEmailSent(true);
      }
    } catch (e) {
      console.error('Pair code error', e);
    } finally {
      setPairLoading(false);
    }
  };

  const handleDisconnectTelegram = async () => {
    if (!session?.id) return;
    setDisconnectLoading(true);
    try {
      await supabase
        .from('notify_transports')
        .update({
          kind: 'platform',
          telegram_chat_id: null,
          telegram_username: null,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', session.id);
      await fetchTransport();
      setPairCode(null);
    } catch (e) {
      console.error('Disconnect error', e);
    } finally {
      setDisconnectLoading(false);
    }
  };

  const handleSendTestNotification = async () => {
    if (!session?.id) return;
    setTestMsgLoading(true);
    setTestStatus('idle');
    try {
      const { error } = await supabase.from('notify_outbox').insert({
        user_id: session.id,
        to_email: session.email,
        subject: '⚡ FRAUDE Telegram Test Bildirimi',
        html: '<p>Test</p>',
        status: 'pending',
        payload: {
          source: 'test',
          priority: 5,
          title: '⚡ FRAUDE Telegram Test Bildirimi',
          summary: 'Tebrikler! Telegram bildirim kanalınız sorunsuz bağlandı. BIST açıklamaları ve piyasa alarmları bu sohbete anlık iletilecektir.',
          tickers: ['BIST'],
          url: 'https://fraude.app',
        },
      });
      if (error) throw error;
      setTestStatus('success');
      setTimeout(() => setTestStatus('idle'), 5000);
    } catch (e) {
      console.error('Test notification error', e);
      setTestStatus('error');
      setTimeout(() => setTestStatus('idle'), 5000);
    } finally {
      setTestMsgLoading(false);
    }
  };

  const copyFeedToken = async () => {
    try {
      await navigator.clipboard.writeText(feedToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* pano yoksa yoksay */
    }
  };

  // BIST evreni — hisse adı/kodu yazınca öneri açılır listesi (CommandPalette deseni)
  useEffect(() => {
    let cancelled = false;
    void getDashboardSnapshot()
      .then((snap) => {
        if (cancelled) return;
        const rows = (snap?.equities ?? []).map((e) => ({ ticker: e.ticker, name: e.name }));
        setUniverse(rows);
      })
      .catch(() => {
        /* veri çalışma zamanı yoksa öneri kapalı; elle giriş yine çalışır */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const watchlistTickers = useMemo(
    () => Array.from(new Set(watchlist.map((w) => w.ticker.toUpperCase()))),
    [watchlist],
  );
  const importable = watchlistTickers.filter((tk) => !prefs.tickers.includes(tk));

  const suggestions = useMemo(() => {
    const q = normalizeSearch(newTicker.trim());
    if (q.length < 1 || universe.length === 0) return [];
    return universe
      .filter((u) => normalizeSearch(u.ticker).includes(q) || normalizeSearch(u.name).includes(q))
      .slice(0, 8);
  }, [newTicker, universe]);

  const toggleTicker = (raw: string) => {
    const up = raw.toUpperCase();
    patch({
      tickers: prefs.tickers.includes(up)
        ? prefs.tickers.filter((x) => x !== up)
        : [...prefs.tickers, up],
    });
  };

  const patch = (p: Partial<Prefs>) => {
    setPrefs((prev) => ({ ...prev, ...p }));
    setState('idle');
  };
  const toggle = (key: keyof Prefs) => patch({ [key]: !prefs[key] } as Partial<Prefs>);

  const addTicker = (raw: string) => {
    const list = raw
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (list.length === 0) return;
    patch({ tickers: Array.from(new Set([...prefs.tickers, ...list])) });
    setNewTicker('');
  };
  const addKeyword = (raw: string) => {
    const k = raw.trim();
    if (!k) return;
    patch({ keywords: Array.from(new Set([...prefs.keywords, k])) });
    setNewKeyword('');
  };

  const save = async () => {
    if (!session) return;
    setState('saving');
    const { error } = await supabase.from('notify_prefs').upsert(
      {
        user_id: session.id,
        email: session.email,
        ...prefs,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
    setState(error ? 'error' : 'saved');
    if (!error) {
      setTimeout(() => setState('idle'), 2000);
      if (!feedToken) {
        // Satır ilk kez oluştuysa varsayılan besleme anahtarı üretildi — çek.
        const { data } = await supabase
          .from('notify_prefs')
          .select('feed_token')
          .eq('user_id', session.id)
          .maybeSingle();
        const tok = (data as { feed_token?: string } | null)?.feed_token;
        if (tok) setFeedToken(tok);
      }
    }
  };

  if (!session) {
    return (
      <div className="notif-view">
        <p className="notif-muted">{t('notifNeedsLogin')}</p>
      </div>
    );
  }
  if (!ready) return <div className="notif-view"><p className="notif-muted">{t('loading')}</p></div>;

  return (
    <div className="notif-view">
      <header className="notif-head">
        <div>
          <h1>{t('notifHeadTitle')}</h1>
          <p className="notif-muted">{t('notifHeadSub')}</p>
        </div>
        <label className="notif-switch">
          <input type="checkbox" checked={prefs.enabled} onChange={() => toggle('enabled')} />
          <span>{prefs.enabled ? t('notifOn') : t('notifOff')}</span>
        </label>
      </header>

      <p className="notif-dest">
        {t('notifDeliverTo')} <strong>{session.email}</strong>
      </p>

      <div className={prefs.enabled ? '' : 'notif-disabled'}>
        {/* Kaynaklar */}
        <section className="notif-card">
          <h2>{t('notifSources')}</h2>
          <div className="notif-sources">
            {(['kap_enabled', 'spk_enabled', 'news_enabled'] as const).map((key) => (
              <label key={key} className="notif-source">
                <input type="checkbox" checked={prefs[key]} onChange={() => toggle(key)} />
                <span>
                  {key === 'kap_enabled' ? t('notifKapSource') : key === 'spk_enabled' ? t('notifSpkSource') : t('notifNewsSource')}
                </span>
              </label>
            ))}
          </div>
        </section>

        {/* Takip edilen hisseler */}
        <section className="notif-card">
          <h2>{t('notifFollowed')}</h2>
          <p className="notif-muted small">{t('notifFollowedHint')}</p>
          <div className="notif-chips">
            {prefs.tickers.length === 0 && (
              <div style={{
                marginTop: '4px',
                padding: '10px 14px',
                background: 'rgba(88, 166, 255, 0.08)',
                border: '1px solid rgba(88, 166, 255, 0.2)',
                borderRadius: '8px',
                fontSize: '0.78rem',
                lineHeight: '1.45',
                color: '#a5d6ff',
              }}>
                ℹ️ {t('notifEmptyWatchlistHint')}
              </div>
            )}
            {prefs.tickers.map((tk) => (
              <span key={tk} className="notif-chip">
                {tk}
                <button onClick={() => patch({ tickers: prefs.tickers.filter((x) => x !== tk) })}>×</button>
              </span>
            ))}
          </div>
          <div className="notif-add">
            <div className="notif-autocomplete">
              <input
                value={newTicker}
                onChange={(e) => setNewTicker(e.target.value)}
                onFocus={() => setTickerFocus(true)}
                onBlur={() => setTimeout(() => setTickerFocus(false), 120)}
                onKeyDown={(e) => e.key === 'Enter' && addTicker(newTicker)}
                placeholder="THYAO"
              />
              {tickerFocus && suggestions.length > 0 && (
                <ul className="notif-suggest">
                  {suggestions.map((s) => {
                    const on = prefs.tickers.includes(s.ticker.toUpperCase());
                    return (
                      <li
                        key={s.ticker}
                        className={on ? 'on' : ''}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          toggleTicker(s.ticker);
                        }}
                      >
                        <span className="notif-suggest-tk">{s.ticker}</span>
                        <span className="notif-suggest-nm">{s.name}</span>
                        <span className="notif-suggest-mark">{on ? '✓' : '+'}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <button className="notif-btn" onClick={() => addTicker(newTicker)}>{t('notifAdd')}</button>
          </div>
          {importable.length > 0 && (
            <button
              className="notif-btn notif-btn-ghost"
              onClick={() => patch({ tickers: Array.from(new Set([...prefs.tickers, ...watchlistTickers])) })}
            >
              {t('notifImportWatchlist')} ({importable.length})
            </button>
          )}
        </section>

        {/* Anahtar kelimeler */}
        <section className="notif-card">
          <h2>{t('notifKeywordsTitle')}</h2>
          <p className="notif-muted small">{t('notifKeywordsHint')}</p>
          <div className="notif-chips">
            {prefs.keywords.length === 0 && <span className="notif-muted small">{t('notifNoneYet')}</span>}
            {prefs.keywords.map((k) => (
              <span key={k} className="notif-chip">
                {k}
                <button onClick={() => patch({ keywords: prefs.keywords.filter((x) => x !== k) })}>×</button>
              </span>
            ))}
          </div>
          <div className="notif-add">
            <input
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addKeyword(newKeyword)}
              placeholder={t('notifKeywordEx')}
            />
            <button className="notif-btn" onClick={() => addKeyword(newKeyword)}>{t('notifAdd')}</button>
          </div>
        </section>

        {/* Önem eşiği */}
        <section className="notif-card">
          <h2>{t('notifPriority')}</h2>
          <p className="notif-muted small">{t('notifPriorityHint')}</p>
          <div className="notif-prio">
            {[
              { v: 1, label: t('notifPrioAll') },
              { v: 3, label: t('notifPrioMed') },
              { v: 4, label: t('notifPrioHigh') },
              { v: 5, label: t('notifPrioCritical') },
            ].map((o) => (
              <button
                key={o.v}
                className={prefs.min_priority === o.v ? 'notif-prio-btn active' : 'notif-prio-btn'}
                onClick={() => patch({ min_priority: o.v })}
              >
                {o.label}
              </button>
            ))}
          </div>
        </section>

        {/* Telegram Bot Entegrasyonu */}
        <section className="notif-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <h2 style={{ margin: 0 }}>{t('notifTelegramTitle')}</h2>
            {transport?.kind === 'telegram' && transport?.telegram_chat_id ? (
              <span className="notif-telegram-badge connected">
                ● {t('notifTelegramConnected')} {transport.telegram_username ? `(${transport.telegram_username})` : ''}
              </span>
            ) : (
              <span className="notif-telegram-badge disconnected">
                ○ {t('notifTelegramNotConnected')}
              </span>
            )}
          </div>
          <p className="notif-muted small">{t('notifTelegramHint')}</p>

          {transport?.kind === 'telegram' && transport?.telegram_chat_id ? (
            <div>
              <div style={{ marginTop: '12px', fontSize: '13px', color: 'var(--text-main)' }}>
                Chat ID: <code style={{ color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>{transport.telegram_chat_id}</code>
              </div>
              <div className="notif-telegram-actions">
                <button
                  className="notif-btn notif-btn-primary"
                  disabled={testMsgLoading}
                  onClick={() => void handleSendTestNotification()}
                >
                  {testMsgLoading ? 'Gönderiliyor…' : t('notifTelegramTest')}
                </button>
                <button
                  className="notif-btn"
                  style={{ borderColor: 'rgba(255, 106, 94, 0.4)', color: '#ff6a5e' }}
                  disabled={disconnectLoading}
                  onClick={() => void handleDisconnectTelegram()}
                >
                  {disconnectLoading ? 'Ayrılıyor…' : t('notifTelegramDisconnect')}
                </button>
                <a
                  href="https://t.me/FraudeTerminal_Bot"
                  target="_blank"
                  rel="noreferrer"
                  className="notif-btn notif-btn-ghost"
                  style={{ textDecoration: 'none' }}
                >
                  {t('notifTelegramOpenBot')}
                </a>
              </div>
              {testStatus === 'success' && (
                <div className="notif-telegram-status-msg success" style={{ marginTop: '10px' }}>
                  {t('notifTelegramTestSuccess')}
                </div>
              )}
              {testStatus === 'error' && (
                <div className="notif-telegram-status-msg error" style={{ marginTop: '10px' }}>
                  {t('notifTelegramTestError')}
                </div>
              )}
            </div>
          ) : (
            <div style={{ marginTop: '12px' }}>
              {pairCode ? (
                <div className="notif-telegram-code-box">
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                    {t('notifTelegramCodeHint')}
                  </div>
                  <div className="notif-telegram-code">{pairCode}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    ⏳ {t('notifTelegramExpiresIn')}
                  </div>
                  {pairEmailSent && (
                    <div style={{ fontSize: '12px', color: '#58a6ff', marginTop: '8px' }}>
                      📬 {t('notifTelegramEmailSentNotice')}
                    </div>
                  )}
                  <div style={{ marginTop: '14px' }}>
                    <a
                      href={`https://t.me/FraudeTerminal_Bot?start=${pairCode}`}
                      target="_blank"
                      rel="noreferrer"
                      className="notif-btn notif-btn-primary"
                      style={{ display: 'inline-block', textDecoration: 'none' }}
                    >
                      {t('notifTelegramOpenBot')}
                    </a>
                  </div>
                </div>
              ) : (
                <div className="notif-telegram-actions">
                  <button
                    className="notif-btn notif-btn-primary"
                    disabled={pairLoading}
                    onClick={() => void handleGetPairCode()}
                  >
                    {pairLoading ? 'Kod Üretiliyor…' : t('notifTelegramGetCode')}
                  </button>
                  <a
                    href="https://t.me/FraudeTerminal_Bot"
                    target="_blank"
                    rel="noreferrer"
                    className="notif-btn"
                    style={{ textDecoration: 'none' }}
                  >
                    {t('notifTelegramOpenBot')}
                  </a>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Chrome eklentisi besleme anahtarı */}
        <section className="notif-card">
          <h2>{t('notifFeedTitle')}</h2>
          <p className="notif-muted small">{t('notifFeedHint')}</p>
          {feedToken ? (
            <div className="notif-feed-row">
              <input readOnly value={feedToken} onFocus={(e) => e.currentTarget.select()} />
              <button className="notif-btn" onClick={() => void copyFeedToken()}>
                {copied ? t('notifFeedCopied') : t('notifFeedCopy')}
              </button>
            </div>
          ) : (
            <p className="notif-muted small">{t('notifFeedEmpty')}</p>
          )}
        </section>
      </div>

      <div className="notif-footer">
        <button className="notif-btn notif-btn-primary" disabled={state === 'saving'} onClick={() => void save()}>
          {state === 'saving' ? t('notifSavingBtn') : state === 'saved' ? t('notifSavedBtn') : t('notifSaveBtn')}
        </button>
        {state === 'error' && <span className="notif-error">{t('notifSaveError')}</span>}
      </div>
    </div>
  );
}
