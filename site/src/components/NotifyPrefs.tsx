import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useI18n } from '../lib/i18n';

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

/** Hesap sayfasındaki bildirim tercihleri kartı (notify_prefs tablosu). */
export default function NotifyPrefs({ user }: { user: User }) {
  const { t } = useI18n();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [tickerText, setTickerText] = useState('');
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
          setPrefs(data as Prefs);
          setTickerText(((data as Prefs).tickers ?? []).join(', '));
          setKeywordText(((data as Prefs).keywords ?? []).join(', '));
        }
        setReady(true);
      });
  }, [user.id]);

  const parseList = (raw: string, upper: boolean): string[] =>
    Array.from(
      new Set(
        raw
          .split(/[,\n]/)
          .map((s) => (upper ? s.trim().toUpperCase() : s.trim()))
          .filter(Boolean),
      ),
    );

  const save = async () => {
    setBusy(true);
    setSaved(false);
    try {
      const row = {
        user_id: user.id,
        email: user.email,
        ...prefs,
        tickers: parseList(tickerText, true),
        keywords: parseList(keywordText, false),
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('notify_prefs').upsert(row, { onConflict: 'user_id' });
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
          <label>
            {t('notifyTickers')}
            <input
              value={tickerText}
              onChange={(e) => setTickerText(e.target.value)}
              placeholder="THYAO, GARAN, ASELS"
            />
          </label>
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
