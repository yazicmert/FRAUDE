import { useEffect } from 'react';
import { navigate } from '../lib/router';
import { DOWNLOAD_MAC, DOWNLOAD_WIN } from '../lib/download';
import { useI18n } from '../lib/i18n';
import { ALL_MODULES, findModule, type ModuleEntry } from '../lib/product';

/**
 * Tek modülün ayrıntı sayfası: /modul/<slug>.
 * Metnin tamamı product.ts'ten gelir; ekran görüntüleri uygulamanın kendisinden
 * çekilip site/public/shots altına konur.
 */
export default function Module({ slug }: { slug: string }) {
  const { t, lang } = useI18n();
  const mod = findModule(slug);

  // Modülden modüle geçerken sayfa başına dön; yoksa okuyucu ortada başlıyor.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [slug]);

  if (!mod) {
    return (
      <div className="page">
        <h1>{t('modNotFound')}</h1>
        <p className="page-sub">{t('modNotFoundSub')}</p>
        <button className="btn btn-primary" onClick={() => navigate('/#moduller')}>
          {t('modBackAll')}
        </button>
      </div>
    );
  }

  const index = ALL_MODULES.findIndex((m) => m.slug === slug);
  const prev: ModuleEntry | undefined = ALL_MODULES[index - 1];
  const next: ModuleEntry | undefined = ALL_MODULES[index + 1];

  return (
    <article className="md">
      <a
        className="md-back"
        href="/#moduller"
        onClick={(event) => {
          event.preventDefault();
          navigate('/');
          window.location.hash = 'moduller';
        }}
      >
        ← {t('modBackAll')}
      </a>

      <header className="md-head">
        <span className="md-code" aria-hidden="true">
          {mod.code}
        </span>
        <div>
          <h1 className="md-title">{mod.name[lang]}</h1>
          <p className="md-lead">{mod.lead[lang]}</p>
        </div>
      </header>

      {mod.shot ? (
        <figure className="md-shot">
          <img
            src={`/shots/${mod.shot}.webp`}
            alt={`${mod.name[lang]} — ${mod.desc[lang]}`}
            loading="lazy"
            decoding="async"
          />
          <figcaption>
            {t('modShotCaption')}
            {mod.shotNote ? ` ${mod.shotNote[lang]}` : ''}
          </figcaption>
        </figure>
      ) : (
        <p className="md-noshot">{t('modNoShot')}</p>
      )}

      <section className="md-section">
        <h2 className="md-h2">{t('modDoesTitle')}</h2>
        <ul className="md-does">
          {mod.does.map((item) => (
            <li key={item.en}>{item[lang]}</li>
          ))}
        </ul>
      </section>

      <section className="md-section">
        <h2 className="md-h2">{t('modFeedsTitle')}</h2>
        <ul className="md-feeds">
          {mod.feeds.map((feed) => (
            <li key={feed.en}>{feed[lang]}</li>
          ))}
        </ul>
      </section>

      <section className="md-section">
        <h2 className="md-h2">{t('modFlowTitle')}</h2>
        <ol className="md-flow">
          {mod.flow.map((step, i) => (
            <li key={step.en}>
              <span className="md-flow-n">{String(i + 1).padStart(2, '0')}</span>
              <span>{step[lang]}</span>
            </li>
          ))}
        </ol>
      </section>

      <nav className="md-nav" aria-label={t('modBackAll')}>
        {prev ? (
          <a
            className="md-nav-link"
            href={`/modul/${prev.slug}`}
            onClick={(event) => {
              event.preventDefault();
              navigate(`/modul/${prev.slug}`);
            }}
          >
            <span className="md-nav-dir">← {t('modPrev')}</span>
            <span className="md-nav-name">{prev.name[lang]}</span>
          </a>
        ) : (
          <span />
        )}
        {next ? (
          <a
            className="md-nav-link md-nav-next"
            href={`/modul/${next.slug}`}
            onClick={(event) => {
              event.preventDefault();
              navigate(`/modul/${next.slug}`);
            }}
          >
            <span className="md-nav-dir">{t('modNext')} →</span>
            <span className="md-nav-name">{next.name[lang]}</span>
          </a>
        ) : (
          <span />
        )}
      </nav>

      <section className="md-cta">
        <h2 className="md-h2">{t('modCtaTitle')}</h2>
        <p className="lp-sub">{t('modCtaSub')}</p>
        <div className="lp-ctas lp-ctas-center">
          <a className="btn btn-primary" href={DOWNLOAD_MAC}>
            {t('dlMac')}
          </a>
          <a className="btn" href={DOWNLOAD_WIN}>
            {t('dlWin')}
          </a>
        </div>
      </section>
    </article>
  );
}
