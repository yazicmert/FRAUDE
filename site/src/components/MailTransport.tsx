import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useI18n } from '../lib/i18n';

/**
 * Hesap sayfasındaki "gönderim kanalı" kartı (notify_transports tablosu).
 *
 * Kullanıcı bildirimlerinin kendi altyapısından çıkmasını isteyebilir. İki yol
 * sunuluyor: kendi https webhook ucu ya da kendi transactional mail sağlayıcı
 * anahtarı. Ham SMTP kimlik bilgisi kasıtlı olarak istenmiyor — bkz.
 * docs/mail-transports.md.
 *
 * Tablo doğrudan YAZILMAZ (RLS'te yalnız select policy'si var): kayıt
 * transport-config Edge Function'ından geçer, çünkü adres SSRF süzgecinden
 * geçmeli, anahtar şifrelenmeli ve kaydetmeden önce gerçek bir test gönderimi
 * yapılmalı.
 */

type Kind = 'platform' | 'webhook' | 'api' | 'telegram';
type Provider = 'resend' | 'brevo' | 'postmark';

interface TransportState {
  kind: Kind;
  webhook_url: string | null;
  api_provider: Provider | null;
  from_email: string | null;
  from_name: string | null;
  has_secret: boolean;
  verified_at: string | null;
  last_error: string | null;
  disabled_at: string | null;
}

const EMPTY: TransportState = {
  kind: 'platform',
  webhook_url: null,
  api_provider: null,
  from_email: null,
  from_name: null,
  has_secret: false,
  verified_at: null,
  last_error: null,
  disabled_at: null,
};

/**
 * functions.invoke non-2xx yanıtta gövdeyi `data`ya koymaz, hatayı
 * FunctionsHttpError olarak verir. Doğrulama hatasının sebebini göstermek
 * istediğimiz için gövdeyi hatanın taşıdığı Response'tan okuyoruz.
 */
async function invokeTransportConfig(
  body: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string; retry_after_ms?: number }> {
  const { data, error } = await supabase.functions.invoke('transport-config', { body });
  if (!error) return (data ?? { ok: false, error: 'empty-response' }) as { ok: boolean };

  const context = (error as { context?: Response }).context;
  if (context && typeof context.json === 'function') {
    try {
      return await context.json();
    } catch {
      /* gövde JSON değilse aşağıya düş */
    }
  }
  return { ok: false, error: error.message };
}

export default function MailTransport({ user }: { user: User }) {
  const { t } = useI18n();
  const [state, setState] = useState<TransportState>(EMPTY);
  const [kind, setKind] = useState<Kind>('platform');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [provider, setProvider] = useState<Provider>('resend');
  const [fromEmail, setFromEmail] = useState('');
  const [fromName, setFromName] = useState('FRAUDE');
  const [secret, setSecret] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    void supabase
      .from('notify_transports')
      .select('kind, webhook_url, api_provider, from_email, from_name, has_secret, verified_at, last_error, disabled_at')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          const row = data as TransportState;
          setState(row);
          setKind(row.kind);
          setWebhookUrl(row.webhook_url ?? '');
          if (row.api_provider) setProvider(row.api_provider);
          setFromEmail(row.from_email ?? '');
          setFromName(row.from_name ?? 'FRAUDE');
        }
        setReady(true);
      });
  }, [user.id]);

  const save = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const body: Record<string, unknown> = { kind };
      if (kind === 'webhook') {
        body.webhookUrl = webhookUrl.trim();
        if (secret.trim()) body.secret = secret.trim();
      } else if (kind === 'api') {
        body.apiProvider = provider;
        body.fromEmail = fromEmail.trim();
        body.fromName = fromName.trim();
        if (secret.trim()) body.secret = secret.trim();
      }

      const result = await invokeTransportConfig(body);

      if (result.ok) {
        setNotice({ tone: 'ok', text: kind === 'platform' ? t('mtSavedPlatform') : t('mtVerified') });
        setSecret('');
      } else if (result.retry_after_ms) {
        setNotice({ tone: 'err', text: t('mtTooMany') });
      } else {
        setNotice({ tone: 'err', text: `${t('mtFailed')}${result.error ?? ''}` });
      }

      // Durum satırını her hâlükârda tazele: kayıt başarısız testte de yazılır.
      const { data } = await supabase
        .from('notify_transports')
        .select('kind, webhook_url, api_provider, from_email, from_name, has_secret, verified_at, last_error, disabled_at')
        .eq('user_id', user.id)
        .maybeSingle();
      if (data) setState(data as TransportState);
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return null;

  const active = state.kind !== 'platform' && state.verified_at !== null && !state.disabled_at;

  return (
    <div className="card">
      <h2>{t('mtTitle')}</h2>
      <p className="muted small" style={{ marginBottom: 16 }}>{t('mtSub')}</p>

      {/* Mevcut durum */}
      <div
        className="small"
        style={{
          marginBottom: 16,
          padding: '10px 12px',
          borderRadius: 8,
          border: '1px solid var(--border, #232a33)',
          background: 'rgba(255,255,255,0.02)',
        }}
      >
        {state.disabled_at ? (
          <span style={{ color: '#ff8f85' }}>{t('mtDisabled')}</span>
        ) : active ? (
          <span style={{ color: '#00e896' }}>{t('mtStatusActive')}</span>
        ) : (
          <span className="muted">{t('mtStatusPlatform')}</span>
        )}
        {state.last_error && (
          <div className="muted" style={{ marginTop: 6, fontSize: 12, wordBreak: 'break-all' }}>
            {t('mtLastError')}: <code>{state.last_error}</code>
          </div>
        )}
      </div>

      <div className="form">
        <label>
          {t('mtKind')}
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="platform">{t('mtKindPlatform')}</option>
            <option value="telegram">{t('mtKindTelegram')}</option>
            <option value="webhook">{t('mtKindWebhook')}</option>
            <option value="api">{t('mtKindApi')}</option>
          </select>
        </label>

        {kind === 'platform' && <p className="muted small">{t('mtPlatformNote')}</p>}

        {kind === 'telegram' && (
          <p className="muted small">
            Telegram botuna (<b>@FraudeTerminal_Bot</b>) giderek e-postanızı yazın veya masaüstü FRAUDE Terminal uygulamasından 6 haneli kod alarak anında eşleştirin.
          </p>
        )}

        {kind === 'webhook' && (
          <>
            <label>
              {t('mtWebhookUrl')}
              <input
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://ornek.com/fraude-bildirim"
                inputMode="url"
              />
            </label>
            <label>
              {t('mtWebhookSecret')}
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={state.has_secret ? t('mtSecretStored') : ''}
                autoComplete="new-password"
              />
            </label>
            <p className="muted small">{t('mtWebhookNote')}</p>
          </>
        )}

        {kind === 'api' && (
          <>
            <label>
              {t('mtProvider')}
              <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
                <option value="resend">Resend</option>
                <option value="brevo">Brevo</option>
                <option value="postmark">Postmark</option>
              </select>
            </label>
            <label>
              {t('mtFromEmail')}
              <input
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
                placeholder="bildirim@sirketiniz.com"
                inputMode="email"
              />
            </label>
            <label>
              {t('mtFromName')}
              <input value={fromName} onChange={(e) => setFromName(e.target.value)} />
            </label>
            <label>
              {t('mtApiKey')}
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={state.has_secret ? t('mtSecretStored') : ''}
                autoComplete="new-password"
              />
            </label>
            <p className="muted small">{t('mtApiNote')}</p>
          </>
        )}
      </div>

      {notice && (
        <p className="small" style={{ marginTop: 12, color: notice.tone === 'ok' ? '#00e896' : '#ff8f85' }}>
          {notice.text}
        </p>
      )}

      <button className="btn btn-primary" style={{ marginTop: 16 }} disabled={busy} onClick={() => void save()}>
        {busy ? t('mtSaving') : kind === 'platform' ? t('mtSave') : t('mtSaveAndTest')}
      </button>

      <p className="muted small" style={{ marginTop: 14 }}>{t('mtSecurityNote')}</p>
    </div>
  );
}
