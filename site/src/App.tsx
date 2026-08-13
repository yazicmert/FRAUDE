import { BrandMark } from './components/Brand';
import SiteNav from './components/SiteNav';
import { usePath } from './lib/router';
import { displayName, useSession } from './lib/useSession';
import { useI18n } from './lib/i18n';
import Landing from './pages/Landing';
import Module from './pages/Module';
import SignIn from './pages/SignIn';
import Account from './pages/Account';
import Admin from './pages/Admin';
import ResetPassword from './pages/ResetPassword';
import Updates from './pages/Updates';
import LicenseAbuse from './pages/LicenseAbuse';
import AppHandoff, { HANDOFF_PATH } from './pages/AppHandoff';
import './styles.css';

export default function App() {
  const path = usePath();
  const { user, ready, isAdmin } = useSession();
  const { t } = useI18n();

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
  } else if (path.startsWith('/modul/')) {
    content = <Module slug={decodeURIComponent(path.slice('/modul/'.length))} />;
  } else if (path === '/giris') {
    content = user ? <Account user={user} /> : <SignIn />;
  } else if (path === '/hesap') {
    content = !ready ? (
      <div className="page"><p className="muted">{t('loading')}</p></div>
    ) : user ? (
      <Account user={user} />
    ) : (
      <SignIn />
    );
  } else if (path === '/admin') {
    content = !ready ? (
      <div className="page"><p className="muted">{t('loading')}</p></div>
    ) : user && isAdmin ? (
      <Admin />
    ) : user ? (
      <div className="page"><p className="muted">{t('accessDenied')}</p></div>
    ) : (
      <SignIn />
    );
  } else {
    content = <Landing />;
  }

  return (
    <>
      <SiteNav user={user} isAdmin={isAdmin} userLabel={user ? displayName(user) : ''} />

      {content}

      <footer className="site-footer">
        <BrandMark size={22} />
        <span>
          © {new Date().getFullYear()} FRAUDE — {t('footerTag')}
        </span>
        <div className="spacer" />
        <a href="https://github.com/yazicmert/FRAUDE" target="_blank" rel="noreferrer">
          GitHub
        </a>
        <span className="muted small">{t('disclaimer')}</span>
      </footer>
    </>
  );
}
