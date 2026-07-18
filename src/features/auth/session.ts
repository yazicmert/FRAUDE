// Supabase Auth oturumu (Faz 2).
//
// Hesaplar artık FRAUDE bulutunda (Supabase) tutulur; bu modül Faz 1'deki
// yerel sürümle aynı yüzeyi (signIn/signUp/signOut/getSession + AUTH_EVENT)
// korur, AuthGate ve SettingsView değişmeden çalışır. Sunucu tarafındaki JWT
// doğrulama karşılığı için bkz. server/src/auth.rs.

import { supabase } from './supabaseClient';
import type { User } from '@supabase/supabase-js';
import { isDesktopRuntime } from '../../api/platformClient';
import { DESKTOP_AUTH_REDIRECT, initAuthDeepLink } from './deepLink';

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
  | 'network'
  | 'unknown';

function toUser(user: User | null | undefined): AuthUser | null {
  if (!user || !user.email) return null;
  const name =
    (user.user_metadata?.name as string | undefined)?.trim() || user.email.split('@')[0];
  return { id: user.id, name, email: user.email, createdAt: user.created_at };
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
        data: { name: name.trim() },
        // Masaüstünde doğrulama e-postası siteye değil uygulamaya dönsün
        ...(isDesktopRuntime() ? { emailRedirectTo: DESKTOP_AUTH_REDIRECT } : {}),
      },
    });
    if (error) return mapError(error.message);
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

export function signOut() {
  void supabase.auth.signOut();
}
