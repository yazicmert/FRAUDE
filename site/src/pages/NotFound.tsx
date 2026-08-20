import { navigate } from '../lib/router';
import { useI18n } from '../lib/i18n';

/**
 * Tanınmayan adres. Daha önce bu durumda ana sayfa çiziliyordu: ziyaretçi
 * yazım hatasını fark etmiyor, arama motoru da her hatalı bağlantıyı ana
 * sayfanın kopyası sanıyordu ("yumuşak 404"). Artık ayrı bir sayfa var ve
 * künyesi `noindex` taşıyor.
 */
export default function NotFound() {
  const { t } = useI18n();

  return (
    <div className="page page-narrow nf">
      <p className="nf-code" aria-hidden="true">
        404
      </p>
      <h1>{t('nfTitle')}</h1>
      <p className="page-sub">{t('nfBody')}</p>
      <div className="lp-ctas">
        <a
          className="btn btn-primary"
          href="/"
          onClick={(event) => {
            event.preventDefault();
            navigate('/');
          }}
        >
          {t('nfHomeCta')}
        </a>
        <a
          className="btn"
          href="/#moduller"
          onClick={(event) => {
            event.preventDefault();
            navigate('/');
            requestAnimationFrame(() => {
              window.location.hash = 'moduller';
            });
          }}
        >
          {t('nfModulesCta')}
        </a>
      </div>
    </div>
  );
}
