import { BrandMark, Wordmark } from './components/Brand';
import { navigate, usePath } from './lib/router';
import { displayName, useSession } from './lib/useSession';
import Landing from './pages/Landing';
import SignIn from './pages/SignIn';
import Account from './pages/Account';
import Admin from './pages/Admin';
import './styles.css';

const DOWNLOAD_URL = 'https://github.com/yazicmert/FRAUDE/releases/latest';

export default function App() {
  const path = usePath();
  const { user, ready, isAdmin } = useSession();

  let content: JSX.Element;
  if (path === '/giris') {
    content = user ? <Account user={user} /> : <SignIn />;
  } else if (path === '/hesap') {
    content = !ready ? (
      <div className="page"><p className="muted">Yükleniyor…</p></div>
    ) : user ? (
      <Account user={user} />
    ) : (
      <SignIn />
    );
  } else if (path === '/admin') {
    content = !ready ? (
      <div className="page"><p className="muted">Yükleniyor…</p></div>
    ) : user && isAdmin ? (
      <Admin />
    ) : user ? (
      <div className="page"><p className="muted">Bu sayfaya erişim yetkiniz yok.</p></div>
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
          <a href="/#ozellikler">Özellikler</a>
          <a href="/#baslangic">Başlangıç</a>
          <a href="/#indir">İndir</a>
        </div>
        <div className="spacer" />
        {user ? (
          <>
            {isAdmin && (
              <button className="btn btn-sm" onClick={() => navigate('/admin')}>
                Yönetim
              </button>
            )}
            <button className="btn btn-sm" onClick={() => navigate('/hesap')}>
              {displayName(user)}
            </button>
          </>
        ) : (
          <button className="btn btn-sm" onClick={() => navigate('/giris')}>
            Giriş Yap
          </button>
        )}
        <a className="btn btn-primary btn-sm" href={DOWNLOAD_URL} target="_blank" rel="noreferrer">
          ⬇ İndir
        </a>
      </nav>

      {content}

      <footer className="site-footer">
        <BrandMark size={22} />
        <span>© {new Date().getFullYear()} FRAUDE — Borsa İstanbul araştırma terminali</span>
        <div className="spacer" />
        <a href="https://github.com/yazicmert/FRAUDE" target="_blank" rel="noreferrer">
          GitHub
        </a>
        <span className="muted small">Veriler yatırım tavsiyesi değildir.</span>
      </footer>
    </>
  );
}
