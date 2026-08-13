import { useEffect } from 'react';
import { useI18n } from '../lib/i18n';
import { SOURCE_GROUPS } from '../lib/sources';

const REPO_ISSUES = 'https://github.com/yazicmert/FRAUDE/issues';

/**
 * Veri kaynakları sayfası (/veri-kaynaklari).
 *
 * İki işi var: verinin gecikmeli olduğunu açıkça söylemek ve veriyi herkese
 * açık tutan kurumların adını künyesiyle anmak. Liste sources.ts'ten gelir ve
 * oradaki kayıtlar veri katmanının gerçekten çağırdığı adreslerden çıkarıldı.
 */
export default function Sources() {
  const { t, lang } = useI18n();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <article className="md">
      <header className="md-head md-head-plain">
        <div>
          <p className="lp-kicker">{t('srcPageKicker')}</p>
          <h1 className="md-title">{t('srcPageTitle')}</h1>
          <p className="md-lead">{t('srcPageLead')}</p>
        </div>
      </header>

      {/* Gecikme uyarısı sayfanın en üstünde; aranan ilk bilgi bu. */}
      <aside className="src-delay">
        <h2>{t('srcDelayTitle')}</h2>
        <p>{t('srcDelayBody')}</p>
      </aside>

      {SOURCE_GROUPS.map((group) => (
        <section className="md-section" key={group.id}>
          <h2 className="md-h2">{group.label[lang]}</h2>
          <p className="src-intro">{group.intro[lang]}</p>
          <ul className="src-list">
            {group.sources.map((source) => (
              <li key={source.url}>
                <a href={source.url} target="_blank" rel="noreferrer noopener">
                  {source.name}
                </a>
                <p>
                  <span className="src-takes-label">{t('srcTakesLabel')}:</span>{' '}
                  {source.takes[lang]}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="src-thanks">
        <h2>{t('srcThanksTitle')}</h2>
        <p>{t('srcThanksBody')}</p>
      </section>

      <section className="md-section">
        <h2 className="md-h2">{t('srcCorrectionTitle')}</h2>
        <p className="src-intro">{t('srcCorrectionBody')}</p>
        <a className="btn" href={REPO_ISSUES} target="_blank" rel="noreferrer noopener">
          {t('srcCorrectionCta')}
        </a>
      </section>
    </article>
  );
}
