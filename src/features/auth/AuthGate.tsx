import { useEffect, useState, type ReactNode } from 'react';
import IntroSplash from './IntroSplash';
import LoginView from './LoginView';
import { AUTH_EVENT, getSession, type AuthUser } from './session';

// Pencere oturumu başına intro bir kez oynar; sayfa yenilemeleri (HMR dahil)
// introyu tekrarlamaz, uygulamanın yeni açılışı tekrarlar.
const INTRO_KEY = 'fraude-intro-played';

/**
 * Açılış kapısı: intro → (oturum yoksa) login → uygulama.
 * Oturum durumu session.ts'in AUTH_EVENT olayıyla canlı izlenir.
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [introDone, setIntroDone] = useState(() => sessionStorage.getItem(INTRO_KEY) === '1');
  const [user, setUser] = useState<AuthUser | null>(() => getSession());

  useEffect(() => {
    const onAuthChanged = () => setUser(getSession());
    window.addEventListener(AUTH_EVENT, onAuthChanged);
    return () => window.removeEventListener(AUTH_EVENT, onAuthChanged);
  }, []);

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
  if (!user) return <LoginView />;
  return <>{children}</>;
}
