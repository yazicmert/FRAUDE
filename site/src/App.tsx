import { BrandMark, Wordmark } from './components/Brand';
import { navigate, usePath } from './lib/router';
import { displayName, useSession } from './lib/useSession';
import { useI18n } from './lib/i18n';
import Landing from './pages/Landing';
import SignIn from './pages/SignIn';
import Account from './pages/Account';
import Admin from './pages/Admin';
import ResetPassword from './pages/ResetPassword';
import Updates from './pages/Updates';
import LicenseAbuse from './pages/LicenseAbuse';
import './styles.css';

export default function App() {
  const path = usePath();
  const { user, ready, isAdmin } = useSession();
  const { t, lang, setLang } = useI18n();

  let content: JSX.Element;
  if (path === '/sifre-yenile') {
    content = <ResetPassword />;
  } else if (path === '/lisans-iptal') {
    content = <LicenseAbuse />;
  } else if (path === '/guncellemeler') {
    content = <Updates />;
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
      <nav className="site-nav">
        <a className="brand" onClick={() => navigate('/')}>
          <BrandMark size={30} />
          <Wordmark />
        </a>
        <div className="links">
          <a href="/#ozellikler">{t('navFeatures')}</a>
          <a href="/#baslangic">{t('navStart')}</a>
          <a href="/#indir">{t('navDownload')}</a>
          <a onClick={() => navigate('/guncellemeler')}>{t('navUpdates')}</a>
        </div>
        <div className="spacer" />
        <button
          className="btn btn-sm"
          aria-label="Language"
          onClick={() => setLang(lang === 'tr' ? 'en' : 'tr')}
        >
          {lang === 'tr' ? 'EN' : 'TR'}
        </button>
        {user ? (
          <>
            {isAdmin && (
              <button className="btn btn-sm" onClick={() => navigate('/admin')}>
                {t('adminNav')}
              </button>
            )}
            <button className="btn btn-sm" onClick={() => navigate('/hesap')}>
              {displayName(user)}
            </button>
          </>
        ) : (
          <button className="btn btn-sm" onClick={() => navigate('/giris')}>
            {t('signIn')}
          </button>
        )}
        <a className="btn btn-primary btn-sm" href="/#indir">
          {t('downloadShort')}
        </a>
      </nav>

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
