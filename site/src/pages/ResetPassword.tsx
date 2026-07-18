import { FormEvent, useEffect, useState } from 'react';
import { BrandMark } from '../components/Brand';
import { supabase } from '../lib/supabase';
import { navigate } from '../lib/router';
import { useI18n } from '../lib/i18n';

/**
 * E-postadaki yenileme bağlantısı buraya döner. supabase-js adresteki
 * kurtarma jetonunu oturuma çevirir; oturum oluşunca yeni şifre formu açılır.
 * Jeton geçersiz/süresi dolmuşsa oturum oluşmaz ve hata gösterilir.
 */
export default function ResetPassword() {
  const { t } = useI18n();
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [passwordAgain, setPasswordAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Jeton takası asenkron: olumlu sonucu dinleyiciden al, olumsuz kararı
    // kısa bir bekleme sonrasına bırak ki hata mesajı erken parlamasın.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setHasSession(true);
    });
    const timer = setTimeout(() => {
      supabase.auth.getSession().then(({ data }) => {
        setHasSession((prev) => prev ?? Boolean(data.session));
      });
    }, 1500);
    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password.length < 8) return setError(t('errPwShort'));
    if (password !== passwordAgain) return setError(t('errPwMatch'));

    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(t('resetSaveFailed') + updateError.message);
        return;
      }
      setDone(true);
      setTimeout(() => navigate('/hesap'), 1200);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page-narrow">
      <div className="card" style={{ textAlign: 'center', paddingTop: 34 }}>
        <BrandMark size={54} />
        <h1 style={{ marginTop: 12 }}>{t('resetTitle')}</h1>
        <p className="page-sub">{t('resetSub')}</p>
        {hasSession === null ? (
          <p className="muted">{t('loading')}</p>
        ) : !hasSession ? (
          <>
            <p className="form-error">{t('resetLinkInvalid')}</p>
            <p className="auth-switch-line">
              <button onClick={() => navigate('/giris')}>{t('backToSignIn')}</button>
            </p>
          </>
        ) : done ? (
          <p className="form-info">{t('resetDone')}</p>
        ) : (
          <form className="form" onSubmit={submit} style={{ textAlign: 'left' }}>
            <label>
              {t('newPwLabel')}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                autoFocus
              />
            </label>
            <label>
              {t('newPwAgainLabel')}
              <input
                type="password"
                value={passwordAgain}
                onChange={(e) => setPasswordAgain(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            <p className="form-error">{error ?? ''}</p>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? t('working') : t('resetSaveBtn')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
