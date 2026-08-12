// E-postadaki doğrulama/kurtarma bağlantısı ve GitHub girişi masaüstünde
// fraude:// şemasıyla uygulamaya döner (Supabase Redirect URL:
// fraude://auth-callback). Supabase jetonları adresin hash kısmında yollar
// (implicit akış); burada ayrıştırılıp oturuma çevrilir — session.ts'teki
// onAuthStateChange gerisini halleder.

import { supabase } from './supabaseClient';
import { isDesktopRuntime } from '../../api/platformClient';

/** Kayıt/kurtarma e-postalarının masaüstünde döneceği adres. */
export const DESKTOP_AUTH_REDIRECT = 'fraude://auth-callback';

/**
 * GitHub girişinin masaüstünde döneceği adres. Doğrudan fraude:// DEĞİL:
 * Chrome özel şemayı yalnız kullanıcı hareketiyle açar, GitHub'ı daha önce
 * yetkilendirmiş kullanıcıda zincir tek bir tıklama olmadan aktığı için devir
 * sessizce engellenir. Bu sayfa jetonu alıp uygulamayı kullanıcının dokunduğu
 * düğmeden açar (site: pages/AppHandoff.tsx). E-posta bağlantıları bu köprüye
 * ihtiyaç duymaz; orada tıklamayı kullanıcı zaten yapar.
 */
export const DESKTOP_OAUTH_REDIRECT =
  'https://fraude.intelligentverseconnection.com/uygulamaya-giris';

/** Derin bağlantı bir oturum üretemediğinde LoginView'ın gösterdiği olay. */
export const AUTH_DEEPLINK_ERROR = 'fraude:auth-deeplink-error';

function reportFailure(message: string): void {
  window.dispatchEvent(new CustomEvent(AUTH_DEEPLINK_ERROR, { detail: message }));
}

async function handleAuthUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== 'fraude:') return;

  // Jetonlar hash'te gelir (#access_token=…&refresh_token=…); PKCE
  // yapılandırılırsa ?code=… gelebilir — ikisi de desteklenir.
  const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  const pick = (key: string) => hashParams.get(key) ?? parsed.searchParams.get(key);

  // Supabase hatayı da aynı adresle yollar; sessizce yutulursa kullanıcı giriş
  // ekranında hiçbir açıklama görmeden bekler.
  const failure = pick('error_description') ?? pick('error');
  if (failure) {
    reportFailure(failure);
    return;
  }

  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');
  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) reportFailure(error.message);
    return;
  }

  const code = pick('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) reportFailure(error.message);
  }
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

  void import('@tauri-apps/plugin-deep-link').then(({ getCurrent, onOpenUrl }) => {
    void getCurrent().then((urls) => {
      for (const url of urls ?? []) void handleAuthUrl(url);
    });
    void onOpenUrl((urls) => {
      for (const url of urls) void handleAuthUrl(url);
    });
  }).catch(() => {
    // Eklenti yoksa (eski çekirdek) sessiz geç; e-posta bağlantısı siteye düşer
  });
}
