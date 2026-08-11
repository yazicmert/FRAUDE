import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from '../../api/i18n';
import { EyeIcon, EyeOffIcon, LockIcon, MailIcon, UserIcon } from '../../components/icons';
import { signIn, signInWithGitHub, signUp, type AuthError } from './session';
import { AUTH_CALLBACK_EVENT, type AuthCallbackDetail } from './deepLink';
import AuthBackdrop, { BrandMark } from './AuthBackdrop';
import './auth.css';

const ERROR_KEYS: Record<Exclude<AuthError, 'confirm-email'>, string> = {
  'email-taken': 'authErrEmailTaken',
  'invalid-credentials': 'authErrInvalidCredentials',
  'weak-password': 'authErrPasswordShort',
  'oauth-unavailable': 'authErrOAuthUnavailable',
  network: 'authErrNetwork',
  unknown: 'authErrUnknown',
};

const EMAIL_RE = /.+@.+\..+/;

/** Kaba şifre gücü puanı (0-4): uzunluk + karakter çeşitliliği. */
function passwordScore(password: string): number {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.min(4, score);
}

const STRENGTH_KEYS = ['authPwWeak', 'authPwWeak', 'authPwFair', 'authPwGood', 'authPwStrong'];
const STRENGTH_COLORS = ['#f0554a', '#f0554a', '#f5a623', '#7ee787', '#00e896'];

function StrengthMeter({ password }: { password: string }) {
  const { t } = useTranslation();
  const score = passwordScore(password);
  const color = STRENGTH_COLORS[score];
  return (
    <div className="auth-strength" aria-hidden="true">
      <div className="auth-strength-bars">
        {[1, 2, 3, 4].map((step) => (
          <i key={step} style={{ background: step <= score ? color : 'rgba(255,255,255,0.1)' }} />
        ))}
      </div>
      <span style={{ color: password ? color : undefined }}>
        {password ? t(STRENGTH_KEYS[score]) : t('authPasswordHint')}
      </span>
    </div>
  );
}

function ArrowIcon() {
  return (
    <svg
      className="auth-submit-arrow"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/**
 * Giriş/kayıt ekranı (Supabase Auth). Başarılı girişte session.ts AUTH_EVENT
 * yayınlar; geçişi AuthGate üstlenir, burada yönlendirme yapılmaz.
 */
export default function LoginView() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordAgain, setPasswordAgain] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [matchTouched, setMatchTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const emailInvalid = emailTouched && email.trim() !== '' && !EMAIL_RE.test(email.trim());
  const mismatch = matchTouched && passwordAgain !== '' && password !== passwordAgain;

  // fraude:// dönüşü başarısızsa kullanıcı bunu görmeli; eskiden uygulama
  // öne geliyor ama ekranda hiçbir şey değişmiyordu. Başarıda AuthGate zaten
  // devralır, burada yalnız bekleme durumu kapatılır.
  useEffect(() => {
    const onCallback = (event: Event) => {
      const detail = (event as CustomEvent<AuthCallbackDetail>).detail;
      setBusy(false);
      if (detail?.status !== 'error') return;
      setInfo(null);
      if (detail.reason === 'no-callback') return setError(t('authErrOAuthNoReturn'));
      setError(detail.message ? `${t('authErrOAuthCallback')} ${detail.message}` : t('authErrOAuthCallback'));
    };
    window.addEventListener(AUTH_CALLBACK_EVENT, onCallback);
    return () => window.removeEventListener(AUTH_CALLBACK_EVENT, onCallback);
  }, [t]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setInfo(null);
    if (!EMAIL_RE.test(email.trim())) return setError(t('authErrEmailInvalid'));
    if (mode === 'signup') {
      if (!name.trim()) return setError(t('authErrNameRequired'));
      if (password.length < 8 || passwordScore(password) < 2) return setError(t('authErrPasswordShort'));
      if (password !== passwordAgain) return setError(t('authErrPasswordMismatch'));
    } else if (!password) {
      return setError(t('authErrPasswordShort'));
    }
    setBusy(true);
    try {
      const result =
        mode === 'signup' ? await signUp(name, email, password) : await signIn(email, password);
      if (result === 'confirm-email') setInfo(t('authConfirmEmail'));
      else if (typeof result === 'string') setError(t(ERROR_KEYS[result]));
      // Başarıda AuthGate, AUTH_EVENT ile lisans denetimine geçer.
    } finally {
      setBusy(false);
    }
  };

  const submitGitHub = async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const result = await signInWithGitHub();
      if (result) setError(t(ERROR_KEYS[result]));
      // Geliştirme sürümünde fraude:// şemasını kurulu paket sahiplenir;
      // dönüş bu pencereye değil /Applications'taki uygulamaya gider.
      else setInfo(`${t('authGitHubBrowserOpened')}${import.meta.env.DEV ? ` ${t('authGitHubDevNote')}` : ''}`);
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: 'signin' | 'signup') => {
    setMode(next);
    setError(null);
    setInfo(null);
  };

  return (
    <div className="auth-screen">
      <AuthBackdrop />
      <div className="auth-card">
        <div className="auth-logo">
          <BrandMark />
        </div>
        <h1 className="auth-title">
          <span className="green">F</span>RAUDE
        </h1>
        <p className="auth-tagline">{t('authTagline')}</p>
        <form className="auth-form" onSubmit={submit}>
          {mode === 'signup' && (
            <label>
              {t('authName')}
              <div className="auth-input">
                <UserIcon size={16} />
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                />
              </div>
            </label>
          )}
          <label>
            {t('authEmail')}
            <div className={`auth-input${emailInvalid ? ' auth-input-error' : ''}`}>
              <MailIcon size={16} />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onBlur={() => setEmailTouched(true)}
                autoComplete="email"
                autoFocus
              />
            </div>
            {emailInvalid && <span className="auth-field-hint">{t('authErrEmailInvalid')}</span>}
          </label>
          <label>
            {t('authPassword')}
            <div className="auth-input">
              <LockIcon size={16} />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
              <button
                type="button"
                className="auth-eye"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={t('authPassword')}
              >
                {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
              </button>
            </div>
            {mode === 'signup' && <StrengthMeter password={password} />}
          </label>
          {mode === 'signup' && (
            <label>
              {t('authPasswordAgain')}
              <div className={`auth-input${mismatch ? ' auth-input-error' : ''}`}>
                <LockIcon size={16} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={passwordAgain}
                  onChange={(event) => setPasswordAgain(event.target.value)}
                  onBlur={() => setMatchTouched(true)}
                  autoComplete="new-password"
                />
              </div>
              {mismatch && <span className="auth-field-hint">{t('authErrPasswordMismatch')}</span>}
            </label>
          )}
          {info ? <p className="auth-error auth-info">{info}</p> : <p className="auth-error">{error ?? ''}</p>}
          <button className="auth-submit" type="submit" disabled={busy}>
            <span>{busy ? t('authWorking') : mode === 'signup' ? t('authSignUp') : t('authSignIn')}</span>
            <ArrowIcon />
          </button>
        </form>
        <div className="auth-divider"><span>{t('authOrContinue')}</span></div>
        <button className="auth-github" type="button" disabled={busy} onClick={() => void submitGitHub()}>
          <GitHubIcon />
          <span>{t('authContinueGitHub')}</span>
        </button>
        <p className="auth-switch">
          {mode === 'signin' ? (
            <button type="button" onClick={() => switchMode('signup')}>
              {t('authSwitchToSignUp')}
            </button>
          ) : (
            <button type="button" onClick={() => switchMode('signin')}>
              {t('authSwitchToSignIn')}
            </button>
          )}
        </p>
        <p className="auth-note">{t('authLocalNote')}</p>
      </div>
    </div>
  );
}
