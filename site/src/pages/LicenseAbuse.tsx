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
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [surveyDone, setSurveyDone] = useState(false);

  const call = async (body: Record<string, unknown>): Promise<AbuseInfo | null> => {
    const { data, error } = await supabase.functions.invoke('report-license-abuse', {
      body: { token, ...body },
    });
    if (error || !data?.ok) return null;
    return data as AbuseInfo;
  };

  useEffect(() => {
    if (!/^[0-9a-f]{64}$/.test(token)) {
      setPhase('invalid');
      return;
    }
    void call({ confirm: false }).then((result) => {
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
      const result = await call({ confirm: true });
      if (!result) return setPhase('error');
      setPhase(result.status === 'already' ? 'already' : 'revoked');
    } finally {
      setBusy(false);
    }
  };

  const sendSurvey = async () => {
    if (!rating) return;
    setBusy(true);
    try {
      const result = await call({ rating, comment });
      if (result) setSurveyDone(true);
    } finally {
      setBusy(false);
    }
  };

  const survey = surveyDone ? (
    <p className="form-info" style={{ marginTop: 20 }}>{t('surveyThanks')}</p>
  ) : (
    <div style={{ marginTop: 26, borderTop: '1px solid var(--border)', paddingTop: 20 }}>
      <p style={{ fontWeight: 600, marginBottom: 4 }}>{t('surveyTitle')}</p>
      <p className="muted small" style={{ marginBottom: 12 }}>{t('surveyHint')}</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 14 }}>
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            className={value === rating ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
            onClick={() => setRating(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <div className="form" style={{ textAlign: 'left' }}>
        <label>
          {t('surveyComment')}
          <textarea
            value={comment}
            maxLength={1000}
            onChange={(event) => setComment(event.target.value)}
          />
        </label>
      </div>
      <button
        className="btn btn-sm"
        style={{ marginTop: 12 }}
        disabled={busy || !rating}
        onClick={() => void sendSurvey()}
      >
        {busy ? t('working') : t('surveySend')}
      </button>
    </div>
  );

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
            {survey}
          </>
        )}

        {phase === 'revoked' && (
          <>
            <h1>{t('abuseRevokedTitle')}</h1>
            <p className="page-sub">{t('abuseRevoked')}</p>
            {survey}
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
