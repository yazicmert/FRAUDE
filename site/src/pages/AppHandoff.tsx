import { useEffect, useRef, useState } from 'react';
import { BrandMark } from '../components/Brand';
import { useI18n } from '../lib/i18n';
import { DOWNLOAD_MAC, DOWNLOAD_WIN } from '../lib/download';

/** Masaüstü uygulamasının derin bağlantı şeması (app: features/auth/deepLink.ts). */
const APP_CALLBACK = 'fraude://auth-callback';

/** Uygulamanın GitHub girişinde Supabase'e verdiği dönüş adresi. */
export const HANDOFF_PATH = '/uygulamaya-giris';

/** Uygulama açılmadıysa yardım panelinin kendiliğinden açılacağı süre. */
const FALLBACK_MS = 2500;

/**
 * Neden bu sayfa var: tarayıcılar özel şemayı (fraude://) yalnız kullanıcı
 * hareketiyle açar. GitHub'ı ilk kez yetkilendiren kullanıcı onay ekranına
 * bastığı için hareket zincire taşınır ve uygulama açılır; GitHub'ı daha önce
 * yetkilendirmiş kullanıcıda zincir tek bir tıklama olmadan akar, tarayıcı
 * devri sessizce engeller ve sekme boş kalır. Dönüşü önce bu sayfaya alıp
 * uygulamayı kullanıcının dokunduğu bağlantıdan açıyoruz.
 *
 * Devir bir <a href="fraude://…"> ile yapılır, JS yönlendirmesiyle değil:
 * şema açılışını tarayıcının kendisi üstlenir. Chrome/Edge/Brave, Safari ve
 * Firefox'un üçü de bu biçimi kabul eder — JS ile atanan window.location
 * Safari ve Firefox'ta sessizce düşebilir.
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

/** İndirme bağlantılarında öne çıkarılacak paket; bilinmiyorsa null. */
function guessPlatform(): 'mac' | 'win' | null {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'win';
  // iPadOS masaüstü Safari gibi görünür; ikisi de mac paketine bakar.
  if (/Mac|iPhone|iPad|iPod/i.test(ua)) return 'mac';
  return null;
}

export default function AppHandoff() {
  const { t } = useI18n();
  const [attempted, setAttempted] = useState(false);
  const [stalled, setStalled] = useState(false);
  const timer = useRef<number | null>(null);

  const params = new URLSearchParams(CALLBACK_PAYLOAD.replace(/^[#?]/, ''));
  const failure = params.get('error_description') ?? params.get('error');
  const hasTokens = Boolean(params.get('access_token') || params.get('code'));
  // Hash'i olduğu gibi taşı: uygulama hem #access_token hem ?code biçimini okur.
  const deepLink = APP_CALLBACK + CALLBACK_PAYLOAD;
  const platform = guessPlatform();

  // Şema açılışı JS'e sonuç döndürmez, yani "uygulama açıldı mı" KESİN olarak
  // bilinemez: uygulama öne gelse bile sekme çoğu masaüstünde 'visible'
  // kalır. window.blur da güvenilmez — tarayıcının izin penceresi açılınca da
  // tetiklenir, kullanıcı vazgeçse bile. Bu yüzden sayaç dolunca "açılmadı"
  // demiyoruz; koşullu bir yardım gösteriyoruz. Sekme gerçekten gizlenirse
  // (kullanıcı uygulamaya geçti) yardım hiç çıkmaz.
  useEffect(() => {
    if (!attempted) return;
    const handedOver = () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') handedOver();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', handedOver);
    timer.current = window.setTimeout(() => setStalled(true), FALLBACK_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', handedOver);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [attempted]);

  const help = (
    <div style={{ marginTop: 18, textAlign: 'left' }}>
      <p className="muted small" style={{ fontWeight: 600 }}>{t('handoffTrouble')}</p>
      <p className="muted small">{t('handoffTroubleHelp')}</p>
      <p className="muted small">{t('handoffDesktopOnly')}</p>
      <p className="muted small">
        {platform !== 'win' && <a href={DOWNLOAD_MAC}>{t('handoffDownloadMac')}</a>}
        {platform === null && ' · '}
        {platform !== 'mac' && <a href={DOWNLOAD_WIN}>{t('handoffDownloadWin')}</a>}
      </p>
    </div>
  );

  return (
    <div className="page page-narrow">
      <div className="card" style={{ textAlign: 'center', paddingTop: 34 }}>
        <BrandMark size={54} />
        {failure ? (
          <>
            <h1 style={{ marginTop: 12 }}>{t('handoffFailTitle')}</h1>
            <p className="form-error">{t('handoffError') + failure}</p>
            {help}
          </>
        ) : !hasTokens ? (
          <>
            <h1 style={{ marginTop: 12 }}>{t('handoffIdleTitle')}</h1>
            <p className="page-sub">{t('handoffInvalid')}</p>
            {help}
          </>
        ) : (
          <>
            <h1 style={{ marginTop: 12 }}>{t('handoffTitle')}</h1>
            <p className="page-sub">{t('handoffSub')}</p>
            {/*
              Düğme değil bağlantı: şemayı tarayıcı kendi açar. Tıklama
              engellenmez, onClick yalnız bekleme sayacını kurar.
            */}
            <a
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 4, display: 'block' }}
              href={deepLink}
              onClick={() => setAttempted(true)}
            >
              {attempted ? t('handoffOpenAgainBtn') : t('handoffOpenBtn')}
            </a>
            {attempted && <p className="form-info">{t('handoffOpened')}</p>}
            {stalled && <p className="muted small">{t('handoffStalled')}</p>}
            {(!attempted || stalled) && help}
          </>
        )}
      </div>
    </div>
  );
}
