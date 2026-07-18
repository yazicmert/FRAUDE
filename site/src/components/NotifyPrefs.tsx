import { useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useI18n } from '../lib/i18n';
import { BIST_TICKERS } from '../lib/bistTickers';

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

/** Türkçe duyarsız arama normalizasyonu (İ/ı/ş/ğ… → sade). */
function norm(s: string): string {
  return s
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .trim();
}

/** Hesap sayfasındaki bildirim tercihleri kartı (notify_prefs tablosu). */
export default function NotifyPrefs({ user }: { user: User }) {
  const { t } = useI18n();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [newTicker, setNewTicker] = useState('');
  const [tickerFocus, setTickerFocus] = useState(false);
  const [keywordText, setKeywordText] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void supabase
      .from('notify_prefs')
      .select('enabled, kap_enabled, spk_enabled, news_enabled, tickers, keywords, min_priority')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setPrefs({ ...DEFAULTS, ...(data as Prefs) });
          setKeywordText(((data as Prefs).keywords ?? []).join(', '));
        }
        setReady(true);
      });
  }, [user.id]);

  const suggestions = useMemo(() => {
    const q = norm(newTicker);
    if (q.length < 1) return [];
    return BIST_TICKERS.filter(
      ([code, name]) => norm(code).includes(q) || norm(name).includes(q),
    ).slice(0, 8);
  }, [newTicker]);

  const toggleTicker = (code: string) => {
    const up = code.toUpperCase();
    setPrefs((p) => ({
      ...p,
      tickers: p.tickers.includes(up) ? p.tickers.filter((x) => x !== up) : [...p.tickers, up],
    }));
    setSaved(false);
  };

  const save = async () => {
    setBusy(true);
    setSaved(false);
    try {
      const keywords = Array.from(
        new Set(keywordText.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)),
      );
      const { error } = await supabase.from('notify_prefs').upsert(
        { user_id: user.id, email: user.email, ...prefs, keywords, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
      if (!error) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setBusy(false);
    }
  };

  const toggle = (key: keyof Prefs) => setPrefs((p) => ({ ...p, [key]: !p[key] }));

  if (!ready) return null;

  return (
    <div className="card">
      <h2>{t('notifyTitle')}</h2>
      <p className="muted small" style={{ marginBottom: 16 }}>{t('notifySub')}</p>

      <label className="notify-row">
        <input type="checkbox" checked={prefs.enabled} onChange={() => toggle('enabled')} />
        <span>{t('notifyEnabled')}</span>
      </label>

      <div style={{ opacity: prefs.enabled ? 1 : 0.5, pointerEvents: prefs.enabled ? 'auto' : 'none' }}>
        <div className="notify-sources">
          <label className="notify-row">
            <input type="checkbox" checked={prefs.kap_enabled} onChange={() => toggle('kap_enabled')} />
            <span>{t('notifyKap')}</span>
          </label>
          <label className="notify-row">
            <input type="checkbox" checked={prefs.spk_enabled} onChange={() => toggle('spk_enabled')} />
            <span>{t('notifySpk')}</span>
          </label>
          <label className="notify-row">
            <input type="checkbox" checked={prefs.news_enabled} onChange={() => toggle('news_enabled')} />
            <span>{t('notifyNews')}</span>
          </label>
        </div>

        <div className="form" style={{ marginTop: 14 }}>
          <div>
            <label style={{ display: 'block' }}>{t('notifyTickers')}</label>
            {prefs.tickers.length > 0 && (
              <div className="nt-chips">
                {prefs.tickers.map((tk) => (
                  <span key={tk} className="nt-chip">
                    {tk}
                    <button type="button" onClick={() => toggleTicker(tk)}>×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="nt-autocomplete">
              <input
                value={newTicker}
                onChange={(e) => setNewTicker(e.target.value)}
                onFocus={() => setTickerFocus(true)}
                onBlur={() => setTimeout(() => setTickerFocus(false), 120)}
                placeholder={t('notifyTickerSearch')}
              />
              {tickerFocus && suggestions.length > 0 && (
                <ul className="nt-suggest">
                  {suggestions.map(([code, name]) => {
                    const on = prefs.tickers.includes(code.toUpperCase());
                    return (
                      <li
                        key={code}
                        className={on ? 'on' : ''}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          toggleTicker(code);
                          setNewTicker('');
                        }}
                      >
                        <span className="nt-tk">{code}</span>
                        <span className="nt-nm">{name}</span>
                        <span className="nt-mark">{on ? '✓' : '+'}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
          <label>
            {t('notifyKeywords')}
            <input
              value={keywordText}
              onChange={(e) => setKeywordText(e.target.value)}
              placeholder={t('notifyKeywordsPlaceholder')}
            />
          </label>
          <label>
            {t('notifyMinPriority')}
            <select
              value={prefs.min_priority}
              onChange={(e) => setPrefs((p) => ({ ...p, min_priority: Number(e.target.value) }))}
            >
              <option value={1}>{t('notifyPrioAll')}</option>
              <option value={3}>{t('notifyPrioMed')}</option>
              <option value={4}>{t('notifyPrioHigh')}</option>
              <option value={5}>{t('notifyPrioCritical')}</option>
            </select>
          </label>
        </div>
      </div>

      <button className="btn btn-primary" style={{ marginTop: 16 }} disabled={busy} onClick={() => void save()}>
        {busy ? t('notifySaving') : saved ? t('notifySaved') : t('notifySave')}
      </button>
    </div>
  );
}
