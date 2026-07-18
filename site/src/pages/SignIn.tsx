import { FormEvent, useState } from 'react';
import { BrandMark } from '../components/Brand';
import { supabase } from '../lib/supabase';
import { navigate } from '../lib/router';
import { useI18n } from '../lib/i18n';

const EMAIL_RE = /.+@.+\..+/;

/** 0 = boş, 1 = zayıf, 2 = orta, 3 = güçlü. Uzunluk + karakter çeşitliliği. */
function passwordStrength(pw: string): 0 | 1 | 2 | 3 {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  if (score <= 2) return 1;
  if (score <= 3) return 2;
  return 3;
}

/** Giriş/kayıt — uygulamadaki akışla aynı Supabase projesi ve kurallar. */
export default function SignIn() {
  const { t } = useI18n();
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const strength = passwordStrength(password);

  const switchMode = (next: 'signin' | 'signup' | 'forgot') => {
    setMode(next);
    setError(null);
    setInfo(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setInfo(null);
    if (!EMAIL_RE.test(email.trim())) return setError(t('errEmail'));
    if (mode === 'forgot') {
      // Yenileme e-postası Supabase Auth üzerinden (projede tanımlı SMTP ile)
      // gönderilir; bağlantı /sifre-yenile sayfasına döner.
      setBusy(true);
      try {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(
          email.trim().toLowerCase(),
          { redirectTo: `${window.location.origin}/sifre-yenile` },
        );
        if (resetError) {
          setError(t('resetFailed') + resetError.message);
        } else {
          setInfo(t('resetSent'));
        }
      } finally {
        setBusy(false);
      }
      return;
    }
    if (mode === 'signup' && !name.trim()) return setError(t('errName'));
    if (mode === 'signup' && password.length < 8) return setError(t('errPwShort'));
    if (!password) return setError(t('errPwRequired'));

    setBusy(true);
    try {
      if (mode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: { data: { name: name.trim() } },
        });
        if (signUpError) {
          const raw = signUpError.message?.trim() ?? '';
          setError(
            /already|registered|exists/i.test(raw)
              ? t('errEmailTaken')
              : t('errSignUp') + (raw && raw !== '{}' ? raw : t('unknownError')),
          );
          return;
        }
        // Doğrulama açıkken Supabase kayıtlı adrese hata döndürmez (adres
        // taraması olmasın diye); ipucu boş identities dizisidir.
        if (data.user && (data.user.identities?.length ?? 0) === 0) {
          setMode('signin');
          setError(t('errEmailTaken'));
          return;
        }
        if (!data.session) {
          setInfo(t('confirmEmail'));
          return;
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
        if (signInError) {
          setError(
            signInError.message.toLowerCase().includes('invalid')
              ? t('errInvalidCreds')
              : t('errSignIn') + signInError.message,
          );
          return;
        }
      }
      navigate('/hesap');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page-narrow">
      <div className="card" style={{ textAlign: 'center', paddingTop: 34 }}>
        <BrandMark size={54} />
        <h1 style={{ marginTop: 12 }}>
          {mode === 'signin' ? t('welcomeBack') : mode === 'signup' ? t('createAccount') : t('forgotTitle')}
        </h1>
        <p className="page-sub">
          {mode === 'signin' ? t('signInSub') : mode === 'signup' ? t('signUpSub') : t('forgotSub')}
        </p>
        <form className="form" onSubmit={submit} style={{ textAlign: 'left' }}>
          {mode === 'signup' && (
            <label>
              {t('nameLabel')}
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </label>
          )}
          <label>
            {t('emailLabel')}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
            />
          </label>
          {mode !== 'forgot' && (
            <label>
              {t('passwordLabel')}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
              {mode === 'signup' && strength > 0 && (
                <span className={`pw-meter s${strength}`}>
                  <span className="pw-meter-bar"><span /><span /><span /></span>
                  <span className="pw-meter-label">
                    {strength === 1 ? t('pwWeak') : strength === 2 ? t('pwMedium') : t('pwStrong')}
                  </span>
                </span>
              )}
            </label>
          )}
          {info ? <p className="form-info">{info}</p> : <p className="form-error">{error ?? ''}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy
              ? t('working')
              : mode === 'signin'
                ? t('signIn')
                : mode === 'signup'
                  ? t('signUpBtn')
                  : t('sendResetBtn')}
          </button>
        </form>
        <p className="auth-switch-line">
          {mode === 'signin' ? (
            <>
              <button onClick={() => switchMode('signup')}>{t('noAccount')}</button>
              {' · '}
              <button onClick={() => switchMode('forgot')}>{t('forgotPw')}</button>
            </>
          ) : (
            <button onClick={() => switchMode('signin')}>
              {mode === 'signup' ? t('haveAccount') : t('backToSignIn')}
            </button>
          )}
        </p>
      </div>
    </div>
  );
}
