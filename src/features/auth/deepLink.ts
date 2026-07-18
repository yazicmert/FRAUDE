// E-postadaki doğrulama/kurtarma bağlantısı masaüstünde fraude:// şemasıyla
// uygulamaya döner (Supabase Redirect URL: fraude://auth-callback). Supabase
// jetonları adresin hash kısmında yollar (implicit akış); burada ayrıştırılıp
// oturuma çevrilir — session.ts'teki onAuthStateChange gerisini halleder.

import { supabase } from './supabaseClient';
import { isDesktopRuntime } from '../../api/platformClient';

/** Kayıt/kurtarma e-postalarının masaüstünde döneceği adres. */
export const DESKTOP_AUTH_REDIRECT = 'fraude://auth-callback';

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
  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');
  if (accessToken && refreshToken) {
    await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    return;
  }
  const code = parsed.searchParams.get('code') ?? hashParams.get('code');
  if (code) {
    await supabase.auth.exchangeCodeForSession(code);
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
