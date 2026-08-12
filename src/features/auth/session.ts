// Supabase Auth oturumu (Faz 2).
//
// Hesaplar artık FRAUDE bulutunda (Supabase) tutulur; bu modül Faz 1'deki
// yerel sürümle aynı yüzeyi (signIn/signUp/signOut/getSession + AUTH_EVENT)
// korur, AuthGate ve SettingsView değişmeden çalışır. Sunucu tarafındaki JWT
// doğrulama karşılığı için bkz. server/src/auth.rs.

import { supabase } from './supabaseClient';
import type { User } from '@supabase/supabase-js';
import { isDesktopRuntime } from '../../api/platformClient';
import { getLanguage } from '../../api/i18n';
import { openUrl } from '../../lib/openExternal';
import {
  DESKTOP_AUTH_REDIRECT,
  DESKTOP_OAUTH_REDIRECT,
  initAuthDeepLink,
  markOAuthPending,
} from './deepLink';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

/** Oturum değişince (giriş/çıkış) window üzerinde yayınlanır. */
export const AUTH_EVENT = 'fraude:auth-changed';

export type AuthError =
  | 'email-taken'
  | 'invalid-credentials'
  | 'confirm-email'
  | 'weak-password'
  | 'oauth-unavailable'
  | 'network'
  | 'unknown';

function toUser(user: User | null | undefined): AuthUser | null {
  if (!user) return null;
  const metadata = user.user_metadata ?? {};
  // E-posta kaydı `name`, GitHub ise çoğunlukla `full_name` / `user_name`
  // gönderir. İlk dolu değeri kullanarak iki giriş yöntemini aynı profile çevir.
  // GitHub hesabı adresini gizliyorsa e-posta boş gelebilir; oturum yine
  // geçerlidir — burada null dönmek kullanıcıyı giriş ekranına kilitlerdi.
  const email = user.email ?? '';
  const name = ([metadata.name, metadata.full_name, metadata.user_name] as unknown[])
    .map((value) => typeof value === 'string' ? value.trim() : '')
    .find(Boolean) || email.split('@')[0] || user.id.slice(0, 8);
  return { id: user.id, name, email, createdAt: user.created_at };
}

// Senkron getSession() çağrıları için modül içi önbellek; Supabase oturumu
// asenkron geri yüklediğinden AuthGate önce initSession() bekler.
let currentUser: AuthUser | null = null;

supabase.auth.onAuthStateChange((_event, session) => {
  const next = toUser(session?.user);
  const changed = next?.id !== currentUser?.id;
  currentUser = next;
  if (changed) window.dispatchEvent(new CustomEvent(AUTH_EVENT));
});

/** Kalıcı oturumu geri yükler; uygulama açılışında bir kez beklenir. */
export async function initSession(): Promise<AuthUser | null> {
  // Masaüstünde e-posta bağlantıları fraude:// ile uygulamaya döner
  initAuthDeepLink();
  const { data } = await supabase.auth.getSession();
  currentUser = toUser(data.session?.user);
  return currentUser;
}

export function getSession(): AuthUser | null {
  return currentUser;
}

function mapError(message: string): AuthError {
  const text = message.toLowerCase();
  if (text.includes('already registered') || text.includes('already exists')) return 'email-taken';
  if (text.includes('invalid login credentials')) return 'invalid-credentials';
  if (text.includes('email not confirmed')) return 'confirm-email';
  if (text.includes('password') && (text.includes('weak') || text.includes('at least'))) return 'weak-password';
  if (text.includes('fetch') || text.includes('network')) return 'network';
  return 'unknown';
}

export async function signUp(
  name: string,
  email: string,
  password: string,
): Promise<AuthUser | AuthError> {
  try {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        // `lang`: doğrulama e-postası uygulamanın diliyle gelir ve tercih
        // hesapta kalır (şablon `.Data.lang` okur — docs/email-templates/).
        data: { name: name.trim(), lang: getLanguage() },
        // Masaüstünde doğrulama e-postası siteye değil uygulamaya dönsün
        ...(isDesktopRuntime() ? { emailRedirectTo: DESKTOP_AUTH_REDIRECT } : {}),
      },
    });
    if (error) return mapError(error.message);
    // Doğrulama açıkken Supabase kayıtlı adrese hata döndürmez (adres
    // taraması olmasın diye); ipucu boş identities dizisidir.
    if (data.user && (data.user.identities?.length ?? 0) === 0) return 'email-taken';
    // E-posta onayı açıksa oturum dönmez; kullanıcıya kutusunu kontrol
    // etmesi söylenir.
    if (!data.session) return 'confirm-email';
    return toUser(data.user)!;
  } catch {
    return 'network';
  }
}

export async function signIn(email: string, password: string): Promise<AuthUser | AuthError> {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) return mapError(error.message);
    return toUser(data.user)!;
  } catch {
    return 'network';
  }
}

/**
 * GitHub OAuth'u sistem tarayıcısında başlatır. Masaüstünde dönüş doğrudan
 * fraude:// değil, sitedeki devir sayfasıdır — gerekçesi DESKTOP_OAUTH_REDIRECT.
 */
export async function signInWithGitHub(): Promise<'oauth-unavailable' | 'network' | null> {
  try {
    const redirectTo = isDesktopRuntime()
      ? DESKTOP_OAUTH_REDIRECT
      : `${window.location.origin}${window.location.pathname}`;
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });

    if (error || !data?.url) return 'oauth-unavailable';
    // Dönüşün beklendiğini işaretle: fraude:// adresi hiç gelmezse
    // deepLink.ts sessiz kalmak yerine kullanıcıya sebebini gösterir.
    if (isDesktopRuntime()) markOAuthPending();
    await openUrl(data.url);
    return null;
  } catch (error) {
    if (error instanceof TypeError) return 'network';
    return 'oauth-unavailable';
  }
}

/**
 * Mevcut oturum açmış e-posta hesabına GitHub kimliğini bağlar.
 */
export async function linkGitHubIdentity(): Promise<'oauth-unavailable' | 'network' | null> {
  try {
    const redirectTo = isDesktopRuntime()
      ? DESKTOP_OAUTH_REDIRECT
      : `${window.location.origin}${window.location.pathname}`;
    const { data, error } = await supabase.auth.linkIdentity({
      provider: 'github',
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });

    if (error || !data?.url) {
      return signInWithGitHub();
    }
    if (isDesktopRuntime()) markOAuthPending();
    await openUrl(data.url);
    return null;
  } catch {
    return signInWithGitHub();
  }
}

export function signOut() {
  void supabase.auth.signOut();
}
