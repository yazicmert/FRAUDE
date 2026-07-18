import { FormEvent, useState } from 'react';
import { useTranslation } from '../../api/i18n';
import { activateLicense, normalizeKey, type LicenseError, type LicenseStatus } from './license';
import { signOut, type AuthUser } from './session';
import AuthBackdrop, { BrandMark } from './AuthBackdrop';
import './auth.css';

const ERROR_KEYS: Record<LicenseError, string> = {
  format: 'authErrLicenseFormat',
  'invalid-key': 'authErrLicenseInvalid',
  revoked: 'authErrLicenseRevoked',
  expired: 'authErrLicenseExpired',
  'in-use': 'authErrLicenseInUse',
  'device-limit': 'authErrLicenseDeviceLimit',
  'no-license': 'authErrLicenseInvalid',
  network: 'authErrNetwork',
};

/** XXXX-XXXX-XXXX-XXXX kalıbına canlı biçimlendirir (FRAUDE- öneki sabit). */
function formatKeyInput(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z2-9]/g, '').replace(/^FRAUDE/, '').slice(0, 16);
  return clean.match(/.{1,4}/g)?.join('-') ?? '';
}

/**
 * Oturum açıldıktan sonra erişim kapısı: lisans anahtarı girilip Supabase
 * RPC ile hesaba ve cihaza bağlanır. Başarıda onActivated çağrılır.
 */
export default function LicenseView({
  user,
  onActivated,
}: {
  user: AuthUser;
  onActivated: (status: LicenseStatus) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const canonical = await normalizeKey(value);
    if (!canonical) return setError(t('authErrLicenseFormat'));
    setBusy(true);
    try {
      const status = await activateLicense(canonical, user.id);
      if (status.ok) onActivated(status);
      else setError(t(ERROR_KEYS[status.error]));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <AuthBackdrop />
      <div className="auth-card">
        <div className="auth-logo">
          <BrandMark />
        </div>
        <h1 className="auth-title">{t('authLicenseTitle')}</h1>
        <p className="auth-tagline">{t('authLicenseSub')}</p>
        <form className="auth-form" onSubmit={submit}>
          <label>
            {t('authLicenseKey')}
            <div className="auth-input auth-license-input">
              <span className="auth-license-prefix">FRAUDE-</span>
              <input
                type="text"
                value={value}
                onChange={(event) => setValue(formatKeyInput(event.target.value))}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                spellCheck={false}
                autoComplete="off"
                autoFocus
              />
            </div>
          </label>
          <p className="auth-error">{error ?? ''}</p>
          <button className="auth-submit" type="submit" disabled={busy || value.length < 19}>
            <span>{busy ? t('authWorking') : t('authActivate')}</span>
          </button>
        </form>
        <p className="auth-switch">
          {user.email}
          {' · '}
          <button type="button" onClick={signOut}>
            {t('authSignOut')}
          </button>
        </p>
        <p className="auth-note">
          {t('authNoLicense')} {t('authLicenseContact')}
        </p>
      </div>
    </div>
  );
}
