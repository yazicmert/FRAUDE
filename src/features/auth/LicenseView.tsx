import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from '../../api/i18n';
import {
  activateLicense,
  checkLicense,
  licenseOverview,
  normalizeKey,
  releaseDevice,
  type LicenseDevice,
  type LicenseError,
  type LicenseStatus,
} from './license';
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

/** Kart altındaki "hesap · çıkış" satırı; iki ekranda da aynı. */
function AccountFooter({ user }: { user: AuthUser }) {
  const { t } = useTranslation();
  return (
    <p className="auth-switch">
      {user.email}
      {' · '}
      <button type="button" onClick={signOut}>
        {t('authSignOut')}
      </button>
    </p>
  );
}

/**
 * Lisans hesapta etkin ama cihaz sınırı dolu: anahtar sormak anlamsızdır,
 * bunun yerine bağlı cihazlar listelenir ve biri bırakılarak bu bilgisayara
 * yer açılır.
 */
function DeviceLimitView({
  user,
  onActivated,
}: {
  user: AuthUser;
  onActivated: (status: LicenseStatus) => void;
}) {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<LicenseDevice[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const overview = await licenseOverview();
    setDevices(overview?.devices ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Lisansı yeniden dener; geçtiyse kapı açılır, geçmediyse liste tazelenir. */
  const retry = async (label: string) => {
    setBusy(label);
    setError(null);
    try {
      const status = await checkLicense(user.id);
      if (status.ok) return onActivated(status);
      setError(t(ERROR_KEYS[status.error]));
      await load();
    } finally {
      setBusy(null);
    }
  };

  const release = async (device: LicenseDevice) => {
    if (!device.device_id) return;
    setBusy(device.device_id);
    setError(null);
    try {
      if (!(await releaseDevice(device.device_id))) {
        setError(t('authErrUnknown'));
        return;
      }
    } finally {
      setBusy(null);
    }
    await retry('retry');
  };

  return (
    <div className="auth-screen">
      <AuthBackdrop />
      <div className="auth-card">
        <div className="auth-logo">
          <BrandMark />
        </div>
        <h1 className="auth-title">{t('authDeviceLimitTitle')}</h1>
        <p className="auth-tagline">{t('authDeviceLimitSub')}</p>
        {devices === null ? (
          <p className="auth-note">{t('authLicenseChecking')}</p>
        ) : (
          <ul className="auth-devices">
            {devices.map((device, index) => (
              <li key={device.device_id ?? index}>
                <span className="dev-name">{device.device_name ?? t('authUnknownDevice')}</span>
                <span className="dev-seen">{new Date(device.last_seen_at).toLocaleString()}</span>
                <button
                  type="button"
                  disabled={!device.device_id || busy !== null}
                  onClick={() => release(device)}
                >
                  {busy === device.device_id ? t('authWorking') : t('authReleaseDevice')}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="auth-error">{error ?? ''}</p>
        <button
          className="auth-submit"
          type="button"
          disabled={busy !== null}
          onClick={() => retry('retry')}
        >
          <span>{busy === 'retry' ? t('authWorking') : t('authRetry')}</span>
        </button>
        <AccountFooter user={user} />
        <p className="auth-note">{t('authLicenseContact')}</p>
      </div>
    </div>
  );
}

/**
 * Oturum açıldıktan sonra erişim kapısı: lisans anahtarı girilip Supabase
 * RPC ile hesaba ve cihaza bağlanır. Başarıda onActivated çağrılır.
 *
 * Anahtar yalnızca hesabında hiç etkin lisans olmayan üyeye sorulur; lisansı
 * olan üye yeni bir bilgisayarda da anahtarsız girer (bkz. check_license).
 */
export default function LicenseView({
  user,
  reason,
  onActivated,
}: {
  user: AuthUser;
  reason?: LicenseError | null;
  onActivated: (status: LicenseStatus) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  // Denetimden gelen neden (süresi dolmuş, ağ yok…) ilk mesaj olarak durur.
  const [error, setError] = useState<string | null>(
    reason && reason !== 'no-license' ? t(ERROR_KEYS[reason]) : null,
  );
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

  if (reason === 'device-limit') return <DeviceLimitView user={user} onActivated={onActivated} />;

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
        <AccountFooter user={user} />
        <p className="auth-note">
          {t('authNoLicense')} {t('authLicenseContact')}
        </p>
      </div>
    </div>
  );
}
