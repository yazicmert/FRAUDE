// Yerel kimlik oturumu (Faz 1).
//
// Hesaplar şimdilik yalnızca bu cihazda (localStorage) tutulur; parola düz
// metin yerine tuzlanmış SHA-256 özetiyle saklanır. Faz 2'de bu modülün
// signIn/signUp/signOut yüzeyi aynen korunarak Supabase Auth'a (JWT)
// bağlanacak — sunucudaki karşılığı için bkz. server/src/auth.rs.

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

interface StoredAccount extends AuthUser {
  salt: string;
  hash: string;
}

const USERS_KEY = 'fraude-auth-users';
const SESSION_KEY = 'fraude-auth-session';

/** Oturum değişince (giriş/çıkış) window üzerinde yayınlanır. */
export const AUTH_EVENT = 'fraude:auth-changed';

export type AuthError = 'email-taken' | 'unknown-user' | 'wrong-password';

async function digest(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  if (globalThis.crypto?.subtle) {
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Güvenli bağlam yoksa (çok eski WebView) son çare: zayıf ama deterministik özet.
  let acc = 0;
  for (const byte of data) acc = (acc * 31 + byte) >>> 0;
  return `weak-${acc.toString(16)}`;
}

function loadAccounts(): StoredAccount[] {
  try {
    const raw = JSON.parse(localStorage.getItem(USERS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function toUser(account: StoredAccount): AuthUser {
  const { id, name, email, createdAt } = account;
  return { id, name, email, createdAt };
}

function setSession(user: AuthUser | null) {
  if (user) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
  window.dispatchEvent(new CustomEvent(AUTH_EVENT));
}

export function getSession(): AuthUser | null {
  try {
    const raw = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
    return raw && typeof raw.email === 'string' ? (raw as AuthUser) : null;
  } catch {
    return null;
  }
}

export async function signUp(name: string, email: string, password: string): Promise<AuthUser | AuthError> {
  const normalized = email.trim().toLowerCase();
  const accounts = loadAccounts();
  if (accounts.some((account) => account.email === normalized)) return 'email-taken';
  const salt = crypto.randomUUID();
  const account: StoredAccount = {
    id: crypto.randomUUID(),
    name: name.trim(),
    email: normalized,
    createdAt: new Date().toISOString(),
    salt,
    hash: await digest(password, salt),
  };
  localStorage.setItem(USERS_KEY, JSON.stringify([...accounts, account]));
  const user = toUser(account);
  setSession(user);
  return user;
}

export async function signIn(email: string, password: string): Promise<AuthUser | AuthError> {
  const normalized = email.trim().toLowerCase();
  const account = loadAccounts().find((candidate) => candidate.email === normalized);
  if (!account) return 'unknown-user';
  if ((await digest(password, account.salt)) !== account.hash) return 'wrong-password';
  const user = toUser(account);
  setSession(user);
  return user;
}

export function signOut() {
  setSession(null);
}
