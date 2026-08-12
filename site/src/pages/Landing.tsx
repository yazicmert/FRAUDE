import HeroTerminal from '../components/HeroTerminal';
import { navigate } from '../lib/router';
import { DOWNLOAD_MAC, DOWNLOAD_WIN } from '../lib/download';
import { useI18n, type StringKey } from '../lib/i18n';
import { ALWAYS_ON, MODULE_COUNT, MODULE_GROUPS, SOURCES } from '../lib/product';
import { useLatestVersion } from '../lib/version';

const PILLARS: { label: StringKey; title: StringKey; body: StringKey }[] = [
  { label: 'p1l', title: 'p1t', body: 'p1x' },
  { label: 'p2l', title: 'p2t', body: 'p2x' },
  { label: 'p3l', title: 'p3t', body: 'p3x' },
];

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
          <div className="lp-ctas">
            <a className="btn btn-primary" href={DOWNLOAD_MAC}>
              {t('dlMac')}
            </a>
            <a className="btn" href={DOWNLOAD_WIN}>
              {t('dlWin')}
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
                <li className="lp-mod" key={mod.code}>
                  <span className="lp-mod-code" aria-hidden="true">
                    {mod.code}
                  </span>
                  <div>
                    <h4>{mod.name[lang]}</h4>
                    <p>{mod.desc[lang]}</p>
                  </div>
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

      <section className="lp-section" id="baslangic">
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

      <section className="lp-download" id="indir">
        <h2 className="lp-h2">{t('dlTitle')}</h2>
        <p className="lp-sub">{t('dlSub')}</p>
        <div className="lp-ctas lp-ctas-center">
          <a className="btn btn-primary" href={DOWNLOAD_MAC}>
            {t('dlMac')}
          </a>
          <a className="btn" href={DOWNLOAD_WIN}>
            {t('dlWin')}
          </a>
          <button className="btn btn-ghost" onClick={() => navigate('/hesap')}>
            {t('dlRequest')}
          </button>
        </div>
        <p className="lp-note">{t('dlGatekeeper')}</p>
      </section>
    </>
  );
}
