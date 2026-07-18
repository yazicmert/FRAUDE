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
  min_priority: 3,
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

  useEffect(() => {
    if (!session) {
      setReady(true);
      return;
    }
    let cancelled = false;
    void supabase
      .from('notify_prefs')
      .select('enabled, kap_enabled, spk_enabled, news_enabled, tickers, keywords, min_priority')
      .eq('user_id', session.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data) setPrefs({ ...DEFAULTS, ...(data as Prefs) });
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.id]);

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
    if (!error) setTimeout(() => setState('idle'), 2000);
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
            {prefs.tickers.length === 0 && <span className="notif-muted small">{t('notifNoneYet')}</span>}
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
