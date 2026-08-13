import HeroTerminal from '../components/HeroTerminal';
import ProductShots from '../components/ProductShots';
import { navigate } from '../lib/router';
import { DOWNLOAD_MAC, DOWNLOAD_WIN } from '../lib/download';
import { useI18n, type StringKey } from '../lib/i18n';
import { ALL_MODULES, ALWAYS_ON, MODULE_COUNT, MODULE_GROUPS, SOURCES } from '../lib/product';
import { useLatestVersion } from '../lib/version';

const PILLARS: { label: StringKey; title: StringKey; body: StringKey }[] = [
  { label: 'p1l', title: 'p1t', body: 'p1x' },
  { label: 'p2l', title: 'p2t', body: 'p2x' },
  { label: 'p3l', title: 'p3t', body: 'p3x' },
];

/** Kullanım anlatısı: her adım gerçek bir modülün ekran görüntüsünü gösterir. */
const FLOW: { slug: string; title: StringKey; body: StringKey }[] = [
  { slug: 'teknik-tarayici', title: 'f1t', body: 'f1x' },
  { slug: 'bilgi-deposu', title: 'f2t', body: 'f2x' },
  { slug: 'izleme-radari', title: 'f3t', body: 'f3x' },
];

const FAQ: { q: StringKey; a: StringKey }[] = [
  { q: 'q1', a: 'a1' },
  { q: 'q2', a: 'a2' },
  { q: 'q3', a: 'a3' },
  { q: 'q4', a: 'a4' },
  { q: 'q5', a: 'a5' },
  { q: 'q6', a: 'a6' },
];

const INCLUDED: StringKey[] = ['accY1', 'accY2', 'accY3', 'accY4'];

export default function Landing() {
  const { t, lang } = useI18n();
  const version = useLatestVersion();

  return (
    <>
      <section className="lp-hero" id="top">
        <div className="lp-hero-copy">
          <p className="lp-eyebrow">
            <span className="lp-tag">{version}</span>
            <span>{t('heroEyebrow').replace('{n}', String(MODULE_COUNT))}</span>
          </p>
          <h1 className="lp-h1">
            {t('heroLine1')}
            <br />
            <span className="lp-h1-2">{t('heroLine2')}</span>
          </h1>
          <p className="lp-lead">{t('heroLead')}</p>
          {/* Tek birincil çağrı; ikinci platform yarışan buton değil, bağlantı. */}
          <div className="lp-ctas">
            <a className="btn btn-primary btn-lg" href={DOWNLOAD_MAC}>
              {t('dlMac')}
            </a>
            <a className="lp-alt" href={DOWNLOAD_WIN}>
              {t('heroSecondary')} →
            </a>
          </div>
          <p className="lp-note">{t('heroNote')}</p>
        </div>

        <div className="lp-hero-term">
          <HeroTerminal />
        </div>
      </section>

      <section className="lp-sources" aria-label={t('srcTitle')}>
        <span className="lp-sources-label">{t('srcTitle')}</span>
        <ul className="lp-sources-list">
          {SOURCES.map((source) => (
            <li key={source}>{source}</li>
          ))}
        </ul>
        <a
          className="lp-sources-more"
          href="/veri-kaynaklari"
          onClick={(event) => {
            event.preventDefault();
            navigate('/veri-kaynaklari');
          }}
        >
          {t('navSources')} →
        </a>
      </section>

      <section className="lp-section" id="uygulama">
        <header className="lp-head">
          <p className="lp-kicker">{t('shotKicker')}</p>
          <h2 className="lp-h2">{t('shotTitle')}</h2>
          <p className="lp-sub">{t('shotSub')}</p>
        </header>
        <ProductShots />
      </section>

      <section className="lp-section lp-section-alt" id="kullanim">
        <header className="lp-head">
          <p className="lp-kicker">{t('flowKicker')}</p>
          <h2 className="lp-h2">{t('flowTitle')}</h2>
          <p className="lp-sub">{t('flowSub')}</p>
        </header>
        <ol className="lp-flow">
          {FLOW.map((step, index) => {
            const mod = ALL_MODULES.find((m) => m.slug === step.slug);
            return (
              <li className="lp-flow-item" key={step.slug}>
                <div className="lp-flow-copy">
                  <span className="lp-flow-n">{String(index + 1).padStart(2, '0')}</span>
                  <h3>{t(step.title)}</h3>
                  <p>{t(step.body)}</p>
                  {mod && (
                    <a
                      className="lp-flow-link"
                      href={`/modul/${mod.slug}`}
                      onClick={(event) => {
                        event.preventDefault();
                        navigate(`/modul/${mod.slug}`);
                      }}
                    >
                      {mod.name[lang]} →
                    </a>
                  )}
                </div>
                {mod?.shot && (
                  <div className="lp-flow-shot">
                    <img
                      src={`/shots/${mod.shot}.webp`}
                      alt={`${mod.name[lang]} — ${mod.desc[lang]}`}
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <section className="lp-section" id="moduller">
        <header className="lp-head">
          <p className="lp-kicker">{t('modKicker')}</p>
          <h2 className="lp-h2">{t('modTitle').replace('{n}', String(MODULE_COUNT))}</h2>
          <p className="lp-sub">{t('modSub')}</p>
        </header>

        {MODULE_GROUPS.map((group) => (
          <div className="lp-group" key={group.id}>
            <h3 className="lp-group-label">{group.label[lang]}</h3>
            <ul className="lp-mods">
              {group.modules.map((mod) => (
                <li key={mod.code}>
                  <a
                    className="lp-mod"
                    href={`/modul/${mod.slug}`}
                    onClick={(event) => {
                      event.preventDefault();
                      navigate(`/modul/${mod.slug}`);
                    }}
                  >
                    <span className="lp-mod-code" aria-hidden="true">
                      {mod.code}
                    </span>
                    <div>
                      <h4>{mod.name[lang]}</h4>
                      <p>{mod.desc[lang]}</p>
                      <span className="lp-mod-go">{t('modOpen')} →</span>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <p className="lp-alwayson">
          <span>{t('modAlways')}</span>
          {ALWAYS_ON.map((surface) => (
            <span className="lp-chip" key={surface.code}>
              <b>{surface.code}</b> {surface.label[lang]}
            </span>
          ))}
        </p>
      </section>

      <section className="lp-section lp-section-alt" id="neden">
        <header className="lp-head">
          <p className="lp-kicker">{t('whyKicker')}</p>
          <h2 className="lp-h2">{t('whyTitle')}</h2>
        </header>
        <div className="lp-pillars">
          {PILLARS.map((pillar) => (
            <article className="lp-pillar" key={pillar.title}>
              <p className="lp-pillar-label">{t(pillar.label)}</p>
              <h3>{t(pillar.title)}</h3>
              <p className="lp-pillar-body">{t(pillar.body)}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-section" id="erisim">
        <header className="lp-head">
          <p className="lp-kicker">{t('accKicker')}</p>
          <h2 className="lp-h2 lp-price">{t('accTitle')}</h2>
          <p className="lp-sub">{t('accSub')}</p>
        </header>
        <div className="lp-access">
          <ul className="lp-included">
            {INCLUDED.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
          <div className="lp-access-why">
            <h3>{t('accWhyTitle')}</h3>
            <p>{t('accWhyBody')}</p>
            <button className="btn btn-primary" onClick={() => navigate('/hesap')}>
              {t('accCta')}
            </button>
          </div>
        </div>
      </section>

      <section className="lp-section lp-section-alt" id="baslangic">
        <header className="lp-head">
          <p className="lp-kicker">{t('stepsKicker')}</p>
          <h2 className="lp-h2">{t('stepsTitle')}</h2>
          <p className="lp-sub">{t('stepsSub')}</p>
        </header>
        <ol className="lp-steps">
          {(['s1', 's2', 's3'] as const).map((step, index) => (
            <li key={step}>
              <span className="lp-step-n">{String(index + 1).padStart(2, '0')}</span>
              <h3>{t(`${step}t` as StringKey)}</h3>
              <p>{t(`${step}x` as StringKey)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="lp-section" id="sss">
        <header className="lp-head">
          <p className="lp-kicker">{t('faqKicker')}</p>
          <h2 className="lp-h2">{t('faqTitle')}</h2>
        </header>
        <div className="lp-faq">
          {FAQ.map((item) => (
            <details key={item.q}>
              <summary>{t(item.q)}</summary>
              <p>{t(item.a)}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="lp-download" id="indir">
        <h2 className="lp-h2">{t('dlTitle')}</h2>
        <p className="lp-sub">{t('dlSub')}</p>
        <div className="lp-ctas lp-ctas-center">
          <a className="btn btn-primary btn-lg" href={DOWNLOAD_MAC}>
            {t('dlMac')}
          </a>
          <a className="btn" href={DOWNLOAD_WIN}>
            {t('dlWin')}
          </a>
        </div>
        <p className="lp-note">{t('dlGatekeeper')}</p>
      </section>
    </>
  );
}
