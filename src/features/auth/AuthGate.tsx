import { useEffect, useState, type ReactNode } from 'react';
import IntroSplash from './IntroSplash';
import LoginView from './LoginView';
import LicenseView from './LicenseView';
import AuthBackdrop, { BrandMark } from './AuthBackdrop';
import { AUTH_EVENT, getSession, initSession, type AuthUser } from './session';
import { checkLicense, type LicenseError } from './license';
import { useTranslation } from '../../api/i18n';
import { isDesktopRuntime } from '../../api/platformClient';
import { setBridgeIdentity } from '../../api/tauriClient';
import './auth.css';

// Pencere oturumu başına intro bir kez oynar; sayfa yenilemeleri (HMR dahil)
// introyu tekrarlamaz, uygulamanın yeni açılışı tekrarlar.
const INTRO_KEY = 'fraude-intro-played';

type LicenseState = 'unknown' | 'checking' | 'ok' | 'missing';

/** Oturum/lisans denetlenirken gösterilen kısa bekleme ekranı. */
function GateLoading({ label }: { label: string }) {
  return (
    <div className="auth-screen">
      <AuthBackdrop />
      <div className="auth-loading">
        <BrandMark />
        <p>{label}</p>
      </div>
    </div>
  );
}

/**
 * Açılış kapısı: intro → (oturum yoksa) login → (lisans yoksa) lisans → uygulama.
 * Oturum durumu session.ts'in AUTH_EVENT olayıyla canlı izlenir; lisans kararı
 * daima sunucuda verilir (license.ts → Supabase RPC).
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [introDone, setIntroDone] = useState(() => sessionStorage.getItem(INTRO_KEY) === '1');
  const [booted, setBooted] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [license, setLicense] = useState<LicenseState>('unknown');
  // Lisans neden geçmedi: anahtar ekranı buna göre metin/akış seçer.
  const [licenseError, setLicenseError] = useState<LicenseError | null>(null);

  useEffect(() => {
    const onAuthChanged = () => setUser(getSession());
    window.addEventListener(AUTH_EVENT, onAuthChanged);
    initSession().then((restored) => {
      setUser(restored);
      setBooted(true);
    });
    return () => window.removeEventListener(AUTH_EVENT, onAuthChanged);
  }, []);

  // Chrome eklentisi köprüsüne giriş yapmış üyeyi bildir: köprü Rust'ta uygulama
  // açılışında (webview oturumundan bağımsız) başladığından, üyelik yalnızca bu
  // yolla tanınır. Lisans onaylıyken hesap yazılır, çıkışta temizlenir; böylece
  // köprü oturum yoksa eklentiden iş kabul etmez.
  useEffect(() => {
    if (!isDesktopRuntime()) return;
    if (user && license === 'ok') {
      setBridgeIdentity({ email: user.email, name: user.name }).catch(() => {});
    } else if (!user) {
      setBridgeIdentity(null).catch(() => {});
    }
  }, [user?.id, user?.email, user?.name, license]);

  // Kullanıcı değişince lisans yeniden denetlenir; çıkışta durum sıfırlanır.
  useEffect(() => {
    if (!user) {
      setLicense('unknown');
      return;
    }
    let cancelled = false;
    setLicense('checking');
    checkLicense(user.id).then((status) => {
      if (cancelled) return;
      setLicense(status.ok ? 'ok' : 'missing');
      setLicenseError(status.ok ? null : status.error);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  if (!introDone) {
    return (
      <IntroSplash
        onDone={() => {
          sessionStorage.setItem(INTRO_KEY, '1');
          setIntroDone(true);
        }}
      />
    );
  }
  if (!booted) return <GateLoading label={t('authWorking')} />;
  if (!user) return <LoginView />;
  if (license === 'checking' || license === 'unknown') {
    return <GateLoading label={t('authLicenseChecking')} />;
  }
  if (license === 'missing') {
    return (
      <LicenseView
        user={user}
        reason={licenseError}
        onActivated={() => {
          setLicenseError(null);
          setLicense('ok');
        }}
      />
    );
  }
  return <>{children}</>;
}
