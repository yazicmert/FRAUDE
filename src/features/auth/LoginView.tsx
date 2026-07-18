import { FormEvent, useState } from 'react';
import { useTranslation } from '../../api/i18n';
import { EyeIcon, EyeOffIcon, LockIcon, MailIcon, UserIcon } from '../../components/icons';
import { signIn, signUp, type AuthError } from './session';
import AuthBackdrop, { BrandMark } from './AuthBackdrop';
import './auth.css';

const ERROR_KEYS: Record<Exclude<AuthError, 'confirm-email'>, string> = {
  'email-taken': 'authErrEmailTaken',
  'invalid-credentials': 'authErrInvalidCredentials',
  'weak-password': 'authErrPasswordShort',
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
