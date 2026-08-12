import { useState } from 'react';
import { BrandMark } from '../components/Brand';
import { useI18n } from '../lib/i18n';
import { DOWNLOAD_MAC, DOWNLOAD_WIN } from '../lib/download';

/** Masaüstü uygulamasının derin bağlantı adresi (app: features/auth/deepLink.ts). */
const APP_CALLBACK = 'fraude://auth-callback';

/** Uygulamanın GitHub girişinde Supabase'e verdiği dönüş adresi. */
export const HANDOFF_PATH = '/uygulamaya-giris';

/**
 * Neden bu sayfa var: Chrome özel şemayı (fraude://) yalnız kullanıcı
 * hareketiyle açar. GitHub'ı ilk kez yetkilendiren kullanıcı onay ekranına
 * bastığı için hareket zincire taşınır ve uygulama açılır; GitHub'ı daha önce
 * yetkilendirmiş kullanıcıda zincir tek bir tıklama olmadan akar, tarayıcı
 * devri sessizce engeller ve sekme boş kalır. Dönüşü önce bu sayfaya alıp
 * uygulamayı kullanıcının dokunduğu düğmeden açıyoruz.
 *
 * Jetonlar adresin hash'inde gelir; supabase-js (detectSessionInUrl) ilk
 * fırsatta hash'i okuyup siler. Bu modül statik import edildiğinden gövdesi
 * senkron çalışır ve supabase'in ilk mikro-görevinden önce hash'i alır —
 * böylece jeton adres çubuğunda/geçmişte kalmaz ve sitede jetonu tüketen
 * ikinci bir oturum açılmaz (yenileme jetonu yalnız uygulamada döner).
 */
function captureCallback(): string {
  const { pathname, hash, search } = window.location;
  // Redirect URL allowlist'te değilse GoTrue jetonları Site URL'ine (kök
  // sayfa) bırakır; kökte jeton görürsek devri yine de biz üstleniriz.
  const stray = pathname === '/' && /[#&?](access_token|code|error)=/.test(hash + search);
  if (pathname !== HANDOFF_PATH && !stray) return '';
  const payload = hash.length > 1 ? hash : search.length > 1 ? search : '';
  // Adres çubuğunu temizle; router bu sayfaya düşsün diye yol da sabitlenir.
  window.history.replaceState(null, '', HANDOFF_PATH);
  return payload;
}

const CALLBACK_PAYLOAD = captureCallback();

export default function AppHandoff() {
  const { t } = useI18n();
  const [opened, setOpened] = useState(false);

  const params = new URLSearchParams(CALLBACK_PAYLOAD.replace(/^[#?]/, ''));
  const failure = params.get('error_description') ?? params.get('error');
  const hasTokens = Boolean(params.get('access_token') || params.get('code'));
  // Hash'i olduğu gibi taşı: uygulama hem #access_token hem ?code biçimini okur.
  const deepLink = APP_CALLBACK + CALLBACK_PAYLOAD;

  const openApp = () => {
    setOpened(true);
    window.location.href = deepLink;
  };

  return (
    <div className="page page-narrow">
      <div className="card" style={{ textAlign: 'center', paddingTop: 34 }}>
        <BrandMark size={54} />
        {failure ? (
          <>
            <h1 style={{ marginTop: 12 }}>{t('handoffFailTitle')}</h1>
            <p className="form-error">{t('handoffError') + failure}</p>
          </>
        ) : !hasTokens ? (
          <>
            <h1 style={{ marginTop: 12 }}>{t('handoffIdleTitle')}</h1>
            <p className="page-sub">{t('handoffInvalid')}</p>
          </>
        ) : (
          <>
            <h1 style={{ marginTop: 12 }}>{t('handoffTitle')}</h1>
            <p className="page-sub">{t('handoffSub')}</p>
            <button
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 4 }}
              onClick={openApp}
              autoFocus
            >
              {t('handoffOpenBtn')}
            </button>
            {opened && <p className="form-info">{t('handoffOpened')}</p>}
          </>
        )}
        <details style={{ marginTop: 18, textAlign: 'left' }}>
          <summary className="muted small" style={{ cursor: 'pointer' }}>
            {t('handoffTrouble')}
          </summary>
          <p className="muted small" style={{ marginTop: 8 }}>
            {t('handoffTroubleHelp')}
          </p>
          <p className="muted small">
            <a href={DOWNLOAD_MAC}>{t('handoffDownloadMac')}</a>
            {' · '}
            <a href={DOWNLOAD_WIN}>{t('handoffDownloadWin')}</a>
          </p>
        </details>
      </div>
    </div>
  );
}
