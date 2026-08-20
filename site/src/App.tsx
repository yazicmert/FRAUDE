import { Suspense, useEffect } from 'react';
import { BrandMark } from './components/Brand';
import SiteNav from './components/SiteNav';
import { navigate, usePath } from './lib/router';
import { displayName, useSession } from './lib/useSession';
import { useI18n } from './lib/i18n';
import { useSeo } from './lib/useSeo';
import { lazyRoute } from './lib/lazyRoute';
import { GITHUB_REPO } from './lib/seo';
import Landing from './pages/Landing';
import AppHandoff, { HANDOFF_PATH } from './pages/AppHandoff';
import './styles.css';

/**
 * Ana sayfa dışındaki her yol gecikmeli yüklenir. Ziyaretçilerin çoğu yalnız
 * tanıtım sayfasını açıyor; hesap, yönetim ve şifre ekranlarının kodunu
 * (supabase-js dahil) onlara indirmenin karşılığı yok.
 *
 * İki istisna var ve ikisi de bilinçli:
 * - `Landing` doğrudan import edilir; açılış sayfası için ikinci bir ağ turu
 *   ilk boyamayı geciktirir.
 * - `AppHandoff` doğrudan import edilir; modül gövdesinde adres hash'indeki
 *   jetonu senkron olarak alması gerekiyor (bkz. pages/AppHandoff.tsx).
 */
const Module = lazyRoute(() => import('./pages/Module'));
const Sources = lazyRoute(() => import('./pages/Sources'));
const SignIn = lazyRoute(() => import('./pages/SignIn'));
const Account = lazyRoute(() => import('./pages/Account'));
const Admin = lazyRoute(() => import('./pages/Admin'));
const ResetPassword = lazyRoute(() => import('./pages/ResetPassword'));
const Updates = lazyRoute(() => import('./pages/Updates'));
const LicenseAbuse = lazyRoute(() => import('./pages/LicenseAbuse'));
const NotFound = lazyRoute(() => import('./pages/NotFound'));

/**
 * Oturumun kesin olarak bilinmesi gereken yollar. Tanıtım sayfalarında
 * supabase-js yalnız tarayıcıda saklı bir oturum varsa iner (bkz. useSession).
 */
const SESSION_PATHS = new Set([
  '/giris',
  '/hesap',
  '/admin',
  '/sifre-yenile',
  '/lisans-iptal',
  HANDOFF_PATH,
]);

export default function App() {
  const path = usePath();
  const { user, ready, isAdmin } = useSession(SESSION_PATHS.has(path));
  const { t } = useI18n();

  useSeo(path);

  // Paylaşılan çapa bağlantısı (/#indir) doğru bölümde açılsın. Tarayıcı
  // hash'i belge yüklenirken çözmeye çalışır; o an React henüz hiçbir şey
  // çizmemiştir ve hedef DOM'da yoktur, ziyaretçi sayfanın tepesinde kalır.
  // Efekt DOM yazıldıktan sonra çalışır, hedef o an yerindedir; kaydırmayı
  // requestAnimationFrame'e ertelemiyoruz çünkü arka planda açılan sekmede
  // (yeni sekmede aç) o geri çağrı hiç çalışmaz ve ziyaretçi sekmeye
  // döndüğünde sayfanın tepesinde kalırdı. Görsellerin ölçüsü etikette yazılı
  // olduğu için düzen zaten oturmuş durumda.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    // Yükleniş sırasında yumuşak kaydırma kayan bir sayfa izlenimi verir.
    document.getElementById(id)?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }, [path]);

  const loading = (
    <div className="page">
      <p className="muted">{t('loading')}</p>
    </div>
  );

  let content: JSX.Element;
  // Masaüstü GitHub girişinin dönüş durağı; oturum gerektirmez, jetonu
  // uygulamaya devreder (bkz. pages/AppHandoff.tsx).
  if (path === HANDOFF_PATH) {
    content = <AppHandoff />;
  } else if (path === '/sifre-yenile') {
    content = <ResetPassword />;
  } else if (path === '/lisans-iptal') {
    content = <LicenseAbuse />;
  } else if (path === '/guncellemeler') {
    content = <Updates />;
  } else if (path === '/veri-kaynaklari') {
    content = <Sources />;
  } else if (path.startsWith('/modul/')) {
    content = <Module slug={decodeURIComponent(path.slice('/modul/'.length))} />;
  } else if (path === '/giris') {
    content = user ? <Account user={user} /> : <SignIn />;
  } else if (path === '/hesap') {
    content = !ready ? loading : user ? <Account user={user} /> : <SignIn />;
  } else if (path === '/admin') {
    content = !ready ? (
      loading
    ) : user && isAdmin ? (
      <Admin />
    ) : user ? (
      <div className="page"><p className="muted">{t('accessDenied')}</p></div>
    ) : (
      <SignIn />
    );
  } else if (path === '/') {
    content = <Landing />;
  } else {
    // Tanınmayan adres ana sayfayı çizmez: ziyaretçi hatayı görmeli, arama
    // motoru da bunu ana sayfanın kopyası saymamalı.
    content = <NotFound />;
  }

  return (
    <>
      {/* Klavyeyle gezen ziyaretçi her sayfada gezinme bağlantılarını tek tek
          geçmek zorunda kalmasın; bağlantı yalnız odaklandığında görünür. */}
      <a className="skip-link" href="#main">
        {t('skipToContent')}
      </a>

      <SiteNav user={user} isAdmin={isAdmin} userLabel={user ? displayName(user) : ''} />

      {/* tabIndex=-1 olmadan "içeriğe geç" yalnız görünümü kaydırır, odağı
          taşımaz; sonraki Tab yine üst çubuğa döner. */}
      <main id="main" tabIndex={-1}>
        <Suspense fallback={loading}>{content}</Suspense>
      </main>

      <footer className="site-footer">
        <BrandMark size={22} />
        <span>
          © {new Date().getFullYear()} FRAUDE — {t('footerTag')}
        </span>
        <div className="spacer" />
        <a
          href="/veri-kaynaklari"
          onClick={(event) => {
            event.preventDefault();
            navigate('/veri-kaynaklari');
          }}
        >
          {t('navSources')}
        </a>
        <a href={GITHUB_REPO} target="_blank" rel="noreferrer">
          GitHub
        </a>
        <span className="muted small">{t('disclaimer')}</span>
      </footer>
    </>
  );
}
