import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useI18n } from '../lib/i18n';

type Phase = 'loading' | 'invalid' | 'pending' | 'already' | 'revoked' | 'error';

interface AbuseInfo {
  status: 'pending' | 'already' | 'revoked';
  email?: string;
  masked_key?: string;
}

/**
 * Lisans e-postasındaki "Bu talebi ben yapmadım" bağlantısının onay sayfası.
 * Fonksiyon *.supabase.co'dan HTML sunamadığı için sayfa burada; iş
 * report-license-abuse Edge Function'ında (JSON API, jeton tek kullanımlık).
 */
export default function LicenseAbuse() {
  const { t } = useI18n();
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [phase, setPhase] = useState<Phase>('loading');
  const [info, setInfo] = useState<AbuseInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const call = async (confirm: boolean): Promise<AbuseInfo | null> => {
    const { data, error } = await supabase.functions.invoke('report-license-abuse', {
      body: { token, confirm },
    });
    if (error || !data?.ok) return null;
    return data as AbuseInfo;
  };

  useEffect(() => {
    if (!/^[0-9a-f]{64}$/.test(token)) {
      setPhase('invalid');
      return;
    }
    void call(false).then((result) => {
      if (!result) return setPhase('invalid');
      if (result.status === 'already') return setPhase('already');
      setInfo(result);
      setPhase('pending');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirm = async () => {
    setBusy(true);
    try {
      const result = await call(true);
      if (!result) return setPhase('error');
      setPhase(result.status === 'already' ? 'already' : 'revoked');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page-narrow">
      <div className="card" style={{ textAlign: 'center', paddingTop: 34 }}>
        {phase === 'loading' && <p className="muted">{t('loading')}</p>}

        {phase === 'invalid' && (
          <>
            <h1>{t('abuseInvalidTitle')}</h1>
            <p className="page-sub">{t('abuseInvalid')}</p>
          </>
        )}

        {phase === 'pending' && info && (
          <>
            <h1>{t('abuseTitle')}</h1>
            <p className="page-sub">{t('abuseSentTo')}</p>
            <p style={{ margin: '6px 0 2px' }}>{info.email}</p>
            <p style={{ fontFamily: 'monospace', color: 'var(--green)', marginBottom: 18 }}>
              {info.masked_key}
            </p>
            <p className="page-sub" style={{ marginBottom: 22 }}>{t('abuseWarn')}</p>
            <button className="btn btn-danger" disabled={busy} onClick={() => void confirm()}>
              {busy ? t('working') : t('abuseConfirm')}
            </button>
          </>
        )}

        {phase === 'already' && (
          <>
            <h1>{t('abuseAlreadyTitle')}</h1>
            <p className="page-sub">{t('abuseAlready')}</p>
          </>
        )}

        {phase === 'revoked' && (
          <>
            <h1>{t('abuseRevokedTitle')}</h1>
            <p className="page-sub">{t('abuseRevoked')}</p>
          </>
        )}

        {phase === 'error' && (
          <>
            <h1>{t('abuseErrorTitle')}</h1>
            <p className="page-sub">{t('abuseError')}</p>
          </>
        )}
      </div>
    </div>
  );
}
