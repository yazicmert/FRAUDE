import { useEffect, useId, useRef, useState } from 'react';
import { BrandMark, Wordmark } from './Brand';
import { navigate } from '../lib/router';
import { useI18n, type StringKey } from '../lib/i18n';

/** Ana sayfadaki bölümlere giden çapa bağlantıları — tek kaynak. */
const SECTIONS: { hash: string; label: StringKey }[] = [
  { hash: '#uygulama', label: 'navFeatures' },
  { hash: '#kullanim', label: 'navStart' },
  { hash: '#erisim', label: 'navAccess' },
  { hash: '#indir', label: 'navDownload' },
];

/**
 * Site gezinmesi. Geniş ekranda bağlantılar satırda durur; dar ekranda
 * (640px altı) bir menü düğmesinin arkasına katlanır.
 *
 * Daha önce bu bağlantılar dar ekranda `display:none` ile gizleniyordu ve
 * yerine hiçbir şey konmuyordu — telefondan gelen ziyaretçi bölümlere hiç
 * ulaşamıyordu. Menü o boşluğu kapatıyor.
 */
export default function SiteNav({
  user,
  isAdmin,
  userLabel,
}: {
  user: unknown;
  isAdmin: boolean;
  userLabel: string;
}) {
  const { t, lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);

  // ESC ile kapat ve odağı düğmeye geri ver; açıkken arka planı kaydırma.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  /**
   * Gezinme bağlantılarının ortak sarmalayıcısı. Daha önce bunlar `href`siz
   * `<a onClick>` idi: tarayıcı `href` taşımayan bir bağlantıyı odaklanabilir
   * saymaz, ekran okuyucu da bağlantı olarak duyurmaz — menü klavyeyle
   * erişilemiyordu. Artık gerçek adres var; tıklama yine SPA içinde kalıyor.
   */
  const linkProps = (to: string) => ({
    href: to,
    'aria-current': (window.location.pathname === to ? 'page' : undefined) as 'page' | undefined,
    onClick: (event: React.MouseEvent) => {
      // Yeni sekmede açma isteğine (⌘/Ctrl/orta tık) karışma.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      go(to);
    },
  });

  const goHash = (hash: string) => {
    setOpen(false);
    if (window.location.pathname !== '/') navigate('/');
    // Yönlendirme sonrası düzen otururken çapaya atla.
    requestAnimationFrame(() => {
      window.location.hash = hash.slice(1);
    });
  };

  return (
    <nav className="site-nav" aria-label={t('navMenu')}>
      <a className="brand" {...linkProps('/')} aria-label="FRAUDE">
        <BrandMark size={30} />
        <Wordmark />
      </a>

      <div className="links">
        {SECTIONS.map((section) => (
          <a key={section.hash} href={`/${section.hash}`} onClick={(e) => { e.preventDefault(); goHash(section.hash); }}>
            {t(section.label)}
          </a>
        ))}
        <a {...linkProps('/guncellemeler')}>{t('navUpdates')}</a>
      </div>

      <div className="spacer" />

      {/* Dil düğmesi hedef dili söyler; "EN" yazan düğme İngilizceye geçirir.
          Rozetin kendisi iki harf olduğu için erişilebilir ad ayrıca verilir. */}
      <button
        className="btn btn-sm nav-lang"
        lang={lang === 'tr' ? 'en' : 'tr'}
        aria-label={lang === 'tr' ? 'Switch to English' : "Türkçe'ye geç"}
        onClick={() => setLang(lang === 'tr' ? 'en' : 'tr')}
      >
        {lang === 'tr' ? 'EN' : 'TR'}
      </button>

      {/* Hesap/yönetim düğmeleri gerçekte birer gezinme; bağlantı oldukları
          için yeni sekmede açılabilir ve adresleri durum çubuğunda görünür. */}
      {user ? (
        <>
          {isAdmin && (
            <a className="btn btn-sm nav-wide" {...linkProps('/admin')}>
              {t('adminNav')}
            </a>
          )}
          <a className="btn btn-sm nav-wide" {...linkProps('/hesap')}>
            {userLabel}
          </a>
        </>
      ) : (
        <a className="btn btn-sm nav-wide" {...linkProps('/giris')}>
          {t('signIn')}
        </a>
      )}

      <a className="btn btn-primary btn-sm nav-wide" href="/#indir" onClick={(e) => { e.preventDefault(); goHash('#indir'); }}>
        {t('downloadShort')}
      </a>

      <button
        ref={toggleRef}
        className="nav-toggle"
        aria-label={open ? t('navMenuClose') : t('navMenu')}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`nav-burger${open ? ' nav-burger-x' : ''}`} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </button>

      {/* Panelin altında kalan sayfayı karartır; boşluğa dokunmak menüyü kapatır. */}
      {open && <div className="nav-scrim" onClick={() => setOpen(false)} aria-hidden="true" />}

      <div id={panelId} className={`nav-panel${open ? ' nav-panel-on' : ''}`} hidden={!open}>
        {SECTIONS.map((section) => (
          <a key={section.hash} href={`/${section.hash}`} onClick={(e) => { e.preventDefault(); goHash(section.hash); }}>
            {t(section.label)}
          </a>
        ))}
        <a {...linkProps('/guncellemeler')}>{t('navUpdates')}</a>
        <hr />
        {user ? (
          <>
            {isAdmin && <a {...linkProps('/admin')}>{t('adminNav')}</a>}
            <a {...linkProps('/hesap')}>{userLabel}</a>
          </>
        ) : (
          <a {...linkProps('/giris')}>{t('signIn')}</a>
        )}
        <a className="btn btn-primary nav-panel-cta" href="/#indir" onClick={(e) => { e.preventDefault(); goHash('#indir'); }}>
          {t('downloadShort')}
        </a>
      </div>
    </nav>
  );
}
