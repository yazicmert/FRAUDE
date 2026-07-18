import { BrandMark } from '../components/Brand';
import CandleTape from '../components/CandleTape';
import { navigate } from '../lib/router';
import { DOWNLOAD_MAC, DOWNLOAD_WIN } from '../lib/download';
import { useI18n, type StringKey } from '../lib/i18n';

const FEATURES: { icon: string; title: StringKey; text: StringKey }[] = [
  { icon: '📈', title: 'f1t', text: 'f1x' },
  { icon: '🔍', title: 'f2t', text: 'f2x' },
  { icon: '📢', title: 'f3t', text: 'f3x' },
  { icon: '💼', title: 'f4t', text: 'f4x' },
  { icon: '🤖', title: 'f5t', text: 'f5x' },
  { icon: '🗓️', title: 'f6t', text: 'f6x' },
];

export default function Landing() {
  const { t } = useI18n();
  return (
    <>
      <section className="hero" id="top">
        <div className="hero-grid" />
        <CandleTape variant="far" />
        <CandleTape variant="near" />
        <div className="hero-inner">
          <div className="hero-logo">
            <BrandMark size={96} />
          </div>
          <h1>
            {t('heroTitleTop')}
            <br />
            <span className="accent">{t('heroTitleAccent')}</span>
          </h1>
          <p className="lead">{t('heroLead')}</p>
          <div className="hero-ctas">
            <a className="btn btn-primary" href="#indir">
              {t('heroDownload')}
            </a>
            <button className="btn" onClick={() => navigate('/hesap')}>
              {t('heroRequest')}
            </button>
          </div>
          <p className="hero-note">{t('heroNote')}</p>
        </div>
      </section>

      <section className="section" id="ozellikler">
        <h2>{t('featuresTitle')}</h2>
        <p className="sub">{t('featuresSub')}</p>
        <div className="feature-grid">
          {FEATURES.map((feature) => (
            <div className="feature-card" key={feature.title}>
              <div className="icon">{feature.icon}</div>
              <h3>{t(feature.title)}</h3>
              <p>{t(feature.text)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section" id="baslangic">
        <h2>{t('stepsTitle')}</h2>
        <p className="sub">{t('stepsSub')}</p>
        <div className="steps">
          {(['s1', 's2', 's3'] as const).map((step, index) => (
            <div className="step" key={step}>
              <div className="num">{index + 1}</div>
              <h3>{t(`${step}t` as StringKey)}</h3>
              <p>{t(`${step}x` as StringKey)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="download-band" id="indir">
        <h2>{t('dlTitle')}</h2>
        <p>{t('dlSub')}</p>
        <div className="platform-btns">
          <a className="btn btn-primary" href={DOWNLOAD_MAC}>
            {t('dlMac')}
          </a>
          <a className="btn btn-primary" href={DOWNLOAD_WIN}>
            {t('dlWin')}
          </a>
          <button className="btn" onClick={() => navigate('/hesap')}>
            {t('dlRequest')}
          </button>
        </div>
        <p className="hero-note" style={{ marginTop: 14 }}>{t('dlGatekeeper')}</p>
      </section>
    </>
  );
}
