// GitHub OAuth ve e-postadaki doğrulama/kurtarma bağlantısı masaüstünde
// fraude:// şemasıyla uygulamaya döner (Supabase Redirect URL:
// fraude://auth-callback). Supabase jetonları adresin hash kısmında yollar
// (implicit akış); burada ayrıştırılıp oturuma çevrilir — session.ts'teki
// onAuthStateChange gerisini halleder.
//
// İki teslim yolu vardır ve İKİSİ de gereklidir:
//   • uygulama AÇIKKEN gelen adres  → onOpenUrl
//   • uygulama KAPALIYKEN gelen adres → eklenti adresi tamponlar, getCurrent
//     ile okunur. Soğuk açılışta tampon JS hazır olduğunda henüz dolmamış
//     olabildiği için tek atış yetmez; birkaç saniye yoklanır.
//
// OAuth dönüşü bu adrese DOĞRUDAN gelmez: tarayıcılar özel şemayı yalnız
// kullanıcı hareketiyle açar, bu yüzden zincir sitedeki devir sayfasından
// geçer (bkz. DESKTOP_OAUTH_REDIRECT).

import { supabase } from './supabaseClient';
import { isDesktopRuntime } from '../../api/platformClient';

/** Kayıt/kurtarma/OAuth dönüşlerinin masaüstünde geleceği adres. */
export const DESKTOP_AUTH_REDIRECT = 'fraude://auth-callback';

/** Tanıtım sitesinin kökü; dağıtım adresi değişirse .env ile ezilir. */
const SITE_ORIGIN =
  import.meta.env.VITE_FRAUDE_SITE_URL?.trim().replace(/\/$/, '')
  || 'https://fraude.intelligentverseconnection.com';

/**
 * GitHub girişinin masaüstünde döneceği adres. Doğrudan fraude:// DEĞİL:
 * tarayıcılar özel şemayı yalnız kullanıcı hareketiyle açar. GitHub'ı ilk kez
 * yetkilendiren kullanıcı onay ekranına bastığı için hareket zincire taşınır
 * ve uygulama açılır; GitHub'ı daha önce yetkilendirmiş kullanıcıda zincir tek
 * bir tıklama olmadan aktığı için tarayıcı devri sessizce engeller ve sekme
 * boş kalır. Bu sayfa jetonu alıp uygulamayı kullanıcının dokunduğu
 * bağlantıdan açar (site: pages/AppHandoff.tsx). E-posta bağlantıları bu
 * köprüye ihtiyaç duymaz; orada tıklamayı kullanıcı zaten yapar.
 */
export const DESKTOP_OAUTH_REDIRECT = `${SITE_ORIGIN}/uygulamaya-giris`;

/** Derin bağlantı sonucu; LoginView dinler (sessiz başarısızlık olmasın). */
export const AUTH_CALLBACK_EVENT = 'fraude:auth-callback';

export interface AuthCallbackDetail {
  status: 'signed-in' | 'error';
  /** Sunucudan gelen ham hata metni (varsa). */
  message?: string;
  /** Çeviriye bırakılan bilinen durum: tarayıcıdan dönüş hiç gelmedi. */
  reason?: 'no-callback';
}

/** Teşhis izinin localStorage anahtarı (son 12 kayıt). */
const TRACE_KEY = 'fraude-auth-callback-trace';

/** Tarayıcıya gidilen anın damgası; dönüş gelmediğini anlamayı sağlar. */
const PENDING_KEY = 'fraude-oauth-pending';

/** Bekleyen dönüşün geçerli sayıldığı süre. */
const PENDING_TTL_MS = 15 * 60 * 1000;

/** OAuth için tarayıcı açıldığında işaretlenir (session.ts çağırır). */
export function markOAuthPending(): void {
  try {
    localStorage.setItem(PENDING_KEY, String(Date.now()));
  } catch {
    // Depo yazılamıyorsa akış yine çalışır, yalnız "dönüş gelmedi" uyarısı çıkmaz
  }
}

/** Bekleyen dönüşün yaşı (sn); yoksa/eskiyse null. */
function pendingAgeSeconds(): number | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const age = Date.now() - Number(raw);
    if (!Number.isFinite(age) || age < 0 || age > PENDING_TTL_MS) return null;
    return Math.round(age / 1000);
  } catch {
    return null;
  }
}

function clearOAuthPending(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // yok sayılabilir
  }
}

/**
 * Teşhis izi. Uygulamada devtools yok; "geri döndü ama giriş olmadı"
 * şikâyetinde tek kanıt budur — diskteki localStorage'dan okunabilir.
 * Yalnız parametre ADLARI ve sonuç yazılır; jeton DEĞERLERİ asla.
 */
function trace(stage: string, extra: Record<string, unknown> = {}): void {
  try {
    const raw = localStorage.getItem(TRACE_KEY);
    const list = raw ? (JSON.parse(raw) as unknown[]) : [];
    list.push({ at: new Date().toISOString(), stage, ...extra });
    localStorage.setItem(TRACE_KEY, JSON.stringify(list.slice(-12)));
  } catch {
    // Depo doluysa/okunamıyorsa teşhis uğruna giriş akışını bozma
  }
}

function announce(detail: AuthCallbackDetail): void {
  window.dispatchEvent(new CustomEvent<AuthCallbackDetail>(AUTH_CALLBACK_EVENT, { detail }));
}

// Aynı adres hem getCurrent hem onOpenUrl ile gelebilir; jetonu iki kez
// işlemeyi (ve refresh_token'ı boşa döndürmeyi) engeller.
const handled = new Set<string>();

async function handleAuthUrl(url: string): Promise<void> {
  if (handled.has(url)) return;
  handled.add(url);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    trace('parse-failed');
    return;
  }
  if (parsed.protocol !== 'fraude:') return;

  // Jetonlar hash'te gelir (#access_token=…&refresh_token=…); PKCE
  // yapılandırılırsa ?code=… gelebilir — ikisi de desteklenir.
  const params = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  parsed.searchParams.forEach((value, key) => {
    if (!params.has(key)) params.append(key, value);
  });
  trace('callback', { host: parsed.host, params: [...params.keys()] });
  clearOAuthPending();

  try {
    // Supabase hatayı da aynı adrese yazar (ör. sağlayıcı kapalı, kod
    // takas edilemedi). Eskiden bu sessizce yutuluyordu: uygulama açılıyor,
    // hiçbir şey olmuyordu.
    const errorCode = params.get('error') ?? params.get('error_code');
    if (errorCode) {
      trace('provider-error', { code: errorCode });
      announce({ status: 'error', message: params.get('error_description') ?? errorCode });
      return;
    }

    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (accessToken && refreshToken) {
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) {
        trace('set-session-failed', { status: error.status });
        announce({ status: 'error', message: error.message });
        return;
      }
      trace('signed-in');
      announce({ status: 'signed-in' });
      return;
    }

    const code = params.get('code');
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        trace('exchange-failed', { status: error.status });
        announce({ status: 'error', message: error.message });
        return;
      }
      trace('signed-in');
      announce({ status: 'signed-in' });
      return;
    }

    trace('no-credentials');
  } catch (error) {
    // Ağ/istisna durumunda da kullanıcı bir şey görmeli
    trace('threw');
    announce({ status: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}

/** Soğuk açılış yoklama takvimi (ms, kümülatif ~8 sn). */
const COLD_START_POLL_MS = [0, 200, 500, 1000, 2000, 4000];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let initialized = false;

/**
 * Derin bağlantı dinleyicisini kurar (yalnız masaüstü, bir kez). Uygulama
 * kapalıyken tıklanan bağlantı açılışta getCurrent ile, açıkken gelenler
 * onOpenUrl ile yakalanır.
 */
export function initAuthDeepLink(): void {
  if (initialized || !isDesktopRuntime()) return;
  initialized = true;

  void import('@tauri-apps/plugin-deep-link')
    .then(async ({ getCurrent, onOpenUrl }) => {
      // Uygulama açıkken gelenler
      void onOpenUrl((urls) => {
        trace('open-url', { count: urls.length });
        for (const url of urls) void handleAuthUrl(url);
      });

      // Kapalıyken gelen (soğuk açılış): tampon geç dolabildiği için yoklanır
      for (const wait of COLD_START_POLL_MS) {
        if (wait) await delay(wait);
        let urls: string[] | null;
        try {
          urls = await getCurrent();
        } catch {
          trace('get-current-failed');
          return;
        }
        if (urls?.length) {
          trace('get-current', { count: urls.length });
          for (const url of urls) void handleAuthUrl(url);
          return;
        }
      }
      // Tarayıcıya gidilmişse ve adres hiç gelmediyse bu bir arızadır;
      // kullanıcı boş ekrana bakmak yerine sebebini görsün. Devir sayfasında
      // bekleyen kullanıcı için de geçerlidir: köprüdeki bağlantıya hiç
      // dokunulmadıysa uygulama tarafında sebep budur.
      const pendingAge = pendingAgeSeconds();
      if (pendingAge !== null) {
        trace('cold-start-empty', { pendingAgeSec: pendingAge });
        clearOAuthPending();
        announce({ status: 'error', reason: 'no-callback' });
      }
    })
    .catch(() => {
      // Eklenti yoksa (eski çekirdek) sessiz geç; e-posta bağlantısı siteye düşer
      trace('plugin-missing');
    });
}
