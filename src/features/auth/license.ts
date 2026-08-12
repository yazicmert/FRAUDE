// Lisans doğrulama istemcisi.
//
// Anahtar biçimi: FRAUDE-XXXX-XXXX-XXXX-YYYY — ilk 12 karakter yük, son 4
// karakter SHA-256 tabanlı checksum (yazım hatası sunucuya gitmeden yakalanır).
// Alfabe karışan karakterleri içermez (I, L, O, U, 0, 1 yok). Aynı algoritma
// scripts/gen-licenses.mjs içinde de uygulanır; İKİSİ BİRLİKTE değişmelidir.
//
// Karar daima sunucuda: anahtarın SHA-256'sı Supabase RPC'ye gönderilir
// (activate_license / check_license, security definer). Düz anahtar ağa ve
// veritabanına hiç çıkmaz. Şema: docs/supabase-licenses.sql

import { supabase } from './supabaseClient';
import { isDesktopRuntime } from '../../api/platformClient';

export const LICENSE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const PAYLOAD_LEN = 12;
const CHECK_LEN = 4;

const DEVICE_KEY = 'fraude-device-id';
const CACHE_KEY = 'fraude-license-cache';
/** Sunucuya ulaşılamadığında son başarılı doğrulama bu süre boyunca geçerli sayılır. */
const OFFLINE_GRACE_MS = 72 * 60 * 60 * 1000;

export type LicenseError =
  | 'format'
  | 'invalid-key'
  | 'revoked'
  | 'expired'
  | 'in-use'
  | 'device-limit'
  | 'no-license'
  | 'network';

export type LicenseStatus =
  | { ok: true; plan: string; expiresAt: string | null; offline?: boolean }
  | { ok: false; error: LicenseError };

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function checksum(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  const bytes = new Uint8Array(digest);
  let out = '';
  for (let i = 0; i < CHECK_LEN; i += 1) out += LICENSE_ALPHABET[bytes[i] % LICENSE_ALPHABET.length];
  return out;
}

/** Girdiyi temizler; biçim/checksum geçerliyse kanonik anahtarı döndürür. */
export async function normalizeKey(input: string): Promise<string | null> {
  const raw = input.toUpperCase().replace(/[^A-Z2-9]/g, '').replace(/^FRAUDE/, '');
  if (raw.length !== PAYLOAD_LEN + CHECK_LEN) return null;
  if ([...raw].some((ch) => !LICENSE_ALPHABET.includes(ch))) return null;
  const payload = raw.slice(0, PAYLOAD_LEN);
  if ((await checksum(payload)) !== raw.slice(PAYLOAD_LEN)) return null;
  const groups = raw.match(/.{4}/g)!;
  return `FRAUDE-${groups.join('-')}`;
}

/** Makineden türetilen kimlik/etiket bir kez alınır, sonra bellekte tutulur. */
const DEVICE_NAME_KEY = 'fraude-device-name';
let identityReady: Promise<void> | null = null;

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

/**
 * Cihaz kimliğini makineye bağlar (yalnız masaüstü, oturum başına bir kez).
 *
 * Neden: kimlik eskiden webview'in localStorage'ında üretilen rastgele bir
 * UUID'ydi. Her webview deposunun kendi UUID'si olduğu için AYNI bilgisayarda
 * geliştirme derlemesi ile kurulu paket iki ayrı cihaz sayılıyor, max_devices
 * kotasını boşa harcıyordu; depo silinince cihaz "yeni" görünüyordu.
 *
 * Geçiş: elde eski rastgele kimlik varsa yenisine geçmeden ÖNCE bırakılır
 * (release_device), yoksa aynı makine iki slot işgal etmeye devam eder ve
 * kullanıcı sınıra takılır. Bırakma başarısız olsa da geçiş sürer — kullanıcı
 * fazla kaydı listeden elle çıkarabilir.
 *
 * Arka uç kimliği veremezse (eski çekirdek, web sürümü, komut hata verdi)
 * hiçbir şey değişmez: eski rastgele kimlik davranışı sürer.
 */
export function ensureDeviceIdentity(): Promise<void> {
  if (identityReady) return identityReady;
  identityReady = (async () => {
    if (!isDesktopRuntime()) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const identity = await invoke<{ id: string | null; name: string | null }>('device_identity');
      if (identity?.name) localStorage.setItem(DEVICE_NAME_KEY, identity.name);
      if (!identity?.id) return;

      const previous = localStorage.getItem(DEVICE_KEY);
      if (previous === identity.id) return;
      if (previous) await releaseDevice(previous).catch(() => false);
      localStorage.setItem(DEVICE_KEY, identity.id);
    } catch {
      // Komut yoksa/başarısızsa eski davranış geçerli
    }
  })();
  return identityReady;
}

/**
 * Ayarlar → Hesap'taki cihaz listesinde görünen ad. Arka uçtan gelen model
 * etiketi ("MacBook Pro · Apple M4 Pro") tercih edilir; yoksa
 * `navigator.platform`'a düşülür — o değer tarayıcılarda dondurulduğu için
 * her Mac'te "MacIntel", her Windows'ta "Win32" görünür, yani cihazları
 * ayırt etmez.
 */
function getDeviceName(): string {
  return localStorage.getItem(DEVICE_NAME_KEY) || navigator.platform || 'unknown';
}

interface LicenseCache {
  userId: string;
  plan: string;
  expiresAt: string | null;
  at: number;
}

function readCache(): LicenseCache | null {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
    return raw && typeof raw.at === 'number' ? (raw as LicenseCache) : null;
  } catch {
    return null;
  }
}

function writeCache(cache: LicenseCache | null) {
  if (cache) localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  else localStorage.removeItem(CACHE_KEY);
}

type RpcResult = { ok: boolean; error?: string; plan?: string; expires_at?: string | null };

function serverError(result: RpcResult): LicenseError {
  const known: LicenseError[] = ['invalid-key', 'revoked', 'expired', 'in-use', 'device-limit', 'no-license'];
  return known.includes(result.error as LicenseError) ? (result.error as LicenseError) : 'invalid-key';
}

export async function activateLicense(canonicalKey: string, userId: string): Promise<LicenseStatus> {
  await ensureDeviceIdentity();
  const keyHash = await sha256Hex(canonicalKey);
  try {
    const { data, error } = await supabase.rpc('activate_license', {
      p_key_hash: keyHash,
      p_device_id: getDeviceId(),
      p_device_name: getDeviceName(),
    });
    if (error) return { ok: false, error: 'network' };
    const result = data as RpcResult;
    if (!result.ok) return { ok: false, error: serverError(result) };
    const status: LicenseStatus = { ok: true, plan: result.plan ?? 'standard', expiresAt: result.expires_at ?? null };
    writeCache({ userId, plan: status.plan, expiresAt: status.expiresAt, at: Date.now() });
    return status;
  } catch {
    return { ok: false, error: 'network' };
  }
}

export interface LicenseDevice {
  /** Eski şemalarda dönmez; cihaz çıkarma düğmesi yalnız dolu olduğunda çıkar. */
  device_id?: string | null;
  device_name: string | null;
  last_seen_at: string;
  current: boolean;
}

export interface LicenseOverview {
  plan: string;
  expiresAt: string | null;
  maxDevices: number;
  activatedAt: string | null;
  devices: LicenseDevice[];
}

/**
 * Ayarlar → Hesap için lisans özeti (cihaz listesiyle). RPC henüz kurulmamışsa
 * veya erişilemezse null döner; arayüz check_license temellerine düşer.
 */
export async function licenseOverview(): Promise<LicenseOverview | null> {
  await ensureDeviceIdentity();
  try {
    const { data, error } = await supabase.rpc('license_overview', { p_device_id: getDeviceId() });
    if (error) return null;
    const result = data as RpcResult & {
      max_devices?: number;
      activated_at?: string | null;
      devices?: LicenseDevice[];
    };
    if (!result.ok) return null;
    return {
      plan: result.plan ?? 'standard',
      expiresAt: result.expires_at ?? null,
      maxDevices: result.max_devices ?? 1,
      activatedAt: result.activated_at ?? null,
      devices: result.devices ?? [],
    };
  } catch {
    return null;
  }
}

/**
 * Bu cihazı hesabın lisansına bağlayarak denetler. Cihaz adını da yazan iki
 * argümanlı biçim yenidir; şeması güncellenmemiş kurulumlarda (PGRST202: işlev
 * bulunamadı) tek argümanlı eski biçime düşülür — böylece güncelleme sırası
 * kullanıcıyı kapıda bırakmaz.
 */
async function callCheckLicense() {
  const first = await supabase.rpc('check_license', {
    p_device_id: getDeviceId(),
    p_device_name: getDeviceName(),
  });
  if (first.error?.code !== 'PGRST202') return first;
  return supabase.rpc('check_license', { p_device_id: getDeviceId() });
}

/** Lisansa bağlı bir cihazı bırakır; sınır dolduğunda yeni cihaza yer açar. */
export async function releaseDevice(deviceId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('release_device', { p_device_id: deviceId });
    if (error) return false;
    return (data as RpcResult).ok === true;
  } catch {
    return false;
  }
}

export async function checkLicense(userId: string): Promise<LicenseStatus> {
  // Kimlik/geçiş burada da beklenir: kapıdaki ilk çağrı budur, eski rastgele
  // kimlik bırakılmadan denetim yapılırsa aynı makine iki slot işgal eder.
  await ensureDeviceIdentity();
  try {
    const { data, error } = await callCheckLicense();
    if (error) throw error;
    const result = data as RpcResult;
    if (!result.ok) {
      writeCache(null);
      return { ok: false, error: serverError(result) };
    }
    const status: LicenseStatus = { ok: true, plan: result.plan ?? 'standard', expiresAt: result.expires_at ?? null };
    writeCache({ userId, plan: status.plan, expiresAt: status.expiresAt, at: Date.now() });
    return status;
  } catch {
    // Ağ yoksa: aynı kullanıcının taze önbelleği varsa sınırlı süre çalışmaya izin ver.
    const cache = readCache();
    if (cache && cache.userId === userId && Date.now() - cache.at < OFFLINE_GRACE_MS) {
      return { ok: true, plan: cache.plan, expiresAt: cache.expiresAt, offline: true };
    }
    return { ok: false, error: 'network' };
  }
}
