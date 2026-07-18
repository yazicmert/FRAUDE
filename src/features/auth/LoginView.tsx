import { FormEvent, useMemo, useState } from 'react';
import { useTranslation } from '../../api/i18n';
import { EyeIcon, EyeOffIcon, LockIcon, MailIcon, UserIcon } from '../../components/icons';
import { signIn, signUp, type AuthError } from './session';
import { buildCandles, CandleStrip } from './IntroSplash';
import './auth.css';

const ERROR_KEYS: Record<AuthError, string> = {
  'email-taken': 'authErrEmailTaken',
  'unknown-user': 'authErrUnknownUser',
  'wrong-password': 'authErrWrongPassword',
};

// Kart arkasında akan stilize endeks patikası (1200x320 tuvalinde).
const SPARK_PATH =
  'M0,250 C80,242 120,192 190,200 S320,150 400,164 S540,92 620,110 ' +
  'S760,142 830,120 S980,62 1060,76 S1160,42 1200,30';

/** Mum-F logosu — uygulama ikonuyla aynı harf, kart zemininde küçük boy. */
function BrandMark() {
  return (
    <svg width="58" height="58" viewBox="0 0 1024 1024" aria-hidden="true">
      <rect x="32" y="32" width="960" height="960" rx="212" fill="#10151d" />
      <rect x="326" y="164" width="16" height="696" rx="8" fill="#00d488" opacity="0.9" />
      <rect x="350" y="462" width="268" height="112" rx="26" fill="#f0554a" />
      <rect x="618" y="510" width="44" height="16" rx="8" fill="#f0554a" opacity="0.9" />
      <rect x="278" y="212" width="424" height="112" rx="26" fill="#00d488" />
      <rect x="702" y="260" width="44" height="16" rx="8" fill="#00d488" opacity="0.9" />
      <rect x="278" y="212" width="112" height="600" rx="26" fill="#00d488" />
    </svg>
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
 * Giriş/kayıt ekranı. Başarılı girişte session.ts AUTH_EVENT yayınlar;
 * geçişi AuthGate üstlenir, burada yönlendirme yapılmaz.
 */
export default function LoginView() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordAgain, setPasswordAgain] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Bant iki eş kopyadan oluşur; -%50 kayınca döngü dikişsiz kapanır.
  const nearTape = useMemo(() => buildCandles(0x42495354, 64, 0.9), []);
  const farTape = useMemo(() => buildCandles(0x46524445, 72, 0.6), []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!/.+@.+\..+/.test(email.trim())) return setError(t('authErrEmailInvalid'));
    if (password.length < 6) return setError(t('authErrPasswordShort'));
    if (mode === 'signup') {
      if (!name.trim()) return setError(t('authErrNameRequired'));
      if (password !== passwordAgain) return setError(t('authErrPasswordMismatch'));
    }
    setBusy(true);
    try {
      const result =
        mode === 'signup' ? await signUp(name, email, password) : await signIn(email, password);
      if (typeof result === 'string') setError(t(ERROR_KEYS[result]));
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: 'signin' | 'signup') => {
    setMode(next);
    setError(null);
  };

  return (
    <div className="auth-screen">
      <div className="auth-grid" aria-hidden="true" />
      <svg className="auth-spark" viewBox="0 0 1200 320" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#00e896" stopOpacity="0" />
            <stop offset="0.35" stopColor="#00e896" />
            <stop offset="1" stopColor="#00c3ff" />
          </linearGradient>
        </defs>
        <path className="auth-spark-base" d={SPARK_PATH} />
        <path className="auth-spark-flow" d={SPARK_PATH} />
      </svg>
      <div className="auth-tape auth-tape-far" aria-hidden="true">
        <div className="auth-tape-half"><CandleStrip candles={farTape} /></div>
        <div className="auth-tape-half"><CandleStrip candles={farTape} /></div>
      </div>
      <div className="auth-tape auth-tape-near" aria-hidden="true">
        <div className="auth-tape-half"><CandleStrip candles={nearTape} /></div>
        <div className="auth-tape-half"><CandleStrip candles={nearTape} /></div>
      </div>
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
            <div className="auth-input">
              <MailIcon size={16} />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                autoFocus
              />
            </div>
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
          </label>
          {mode === 'signup' && (
            <label>
              {t('authPasswordAgain')}
              <div className="auth-input">
                <LockIcon size={16} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={passwordAgain}
                  onChange={(event) => setPasswordAgain(event.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </label>
          )}
          <p className="auth-error">{error ?? ''}</p>
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
