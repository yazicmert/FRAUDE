import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useI18n } from '../lib/i18n';
import { navigate } from '../lib/router';

type Phase = 'loading' | 'invalid' | 'pending' | 'already' | 'done' | 'error';

interface UnsubInfo {
  status: 'subscribed' | 'already' | 'unsubscribed';
  email?: string;
}

/**
 * Dijest mailindeki "Bu bildirimleri durdur" bağlantısının onay sayfası.
 * Fonksiyon *.supabase.co'dan HTML sunamadığı için sayfa burada; iş
 * notify-unsubscribe Edge Function'ında (kimlik = feed_token).
 * Posta sağlayıcısının tek tık isteği bu sayfaya uğramaz, doğrudan fonksiyona
 * POST atar (RFC 8058).
 */
export default function NotifyUnsubscribe() {
  const { t } = useI18n();
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [phase, setPhase] = useState<Phase>('loading');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const call = async (confirm: boolean): Promise<UnsubInfo | null> => {
    const { data, error } = await supabase.functions.invoke('notify-unsubscribe', {
      body: { token, confirm },
    });
    if (error || !data?.ok) return null;
    return data as UnsubInfo;
  };

  useEffect(() => {
    if (token.length < 16) {
      setPhase('invalid');
      return;
    }
    void call(false).then((result) => {
      if (!result) return setPhase('invalid');
      setEmail(result.email ?? '');
      setPhase(result.status === 'already' ? 'already' : 'pending');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirm = async () => {
    setBusy(true);
    try {
      const result = await call(true);
      setPhase(result ? 'done' : 'error');
    } finally {
      setBusy(false);
    }
  };

  const accountLink = (
    <button className="btn btn-sm" style={{ marginTop: 18 }} onClick={() => navigate('/hesap')}>
      {t('unsubToAccount')}
    </button>
  );

  return (
    <div className="page page-narrow">
      <div className="card" style={{ textAlign: 'center', paddingTop: 34 }}>
        {phase === 'loading' && <p className="muted">{t('loading')}</p>}

        {phase === 'invalid' && (
          <>
            <h1>{t('unsubInvalidTitle')}</h1>
            <p className="page-sub">{t('unsubInvalid')}</p>
            {accountLink}
          </>
        )}

        {phase === 'pending' && (
          <>
            <h1>{t('unsubTitle')}</h1>
            <p className="page-sub">{t('unsubSub')}</p>
            <p style={{ margin: '6px 0 22px' }}>{email}</p>
            <button className="btn btn-danger" disabled={busy} onClick={() => void confirm()}>
              {busy ? t('working') : t('unsubConfirm')}
            </button>
          </>
        )}

        {phase === 'already' && (
          <>
            <h1>{t('unsubAlreadyTitle')}</h1>
            <p className="page-sub">{t('unsubAlready')}</p>
            {accountLink}
          </>
        )}

        {phase === 'done' && (
          <>
            <h1>{t('unsubDoneTitle')}</h1>
            <p className="page-sub">{t('unsubDone')}</p>
            {accountLink}
          </>
        )}

        {phase === 'error' && (
          <>
            <h1>{t('unsubErrorTitle')}</h1>
            <p className="page-sub">{t('unsubError')}</p>
            {accountLink}
          </>
        )}
      </div>
    </div>
  );
}
