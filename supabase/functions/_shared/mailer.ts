// FRAUDE — gönderim kanalı (transport) soyutlaması.
// ─────────────────────────────────────────────────────────────────────────────
// Bildirim maili üç yoldan biriyle çıkabilir:
//
//   platform → FRAUDE'nin Brevo hesabı. Varsayılan ve DAİMA yedek: kullanıcının
//              kendi kanalı bozulduğunda onu haberdar edecek yol da budur, o
//              yüzden hiçbir koşulda devre dışı bırakılmaz.
//   webhook  → kullanıcının verdiği https uca bildirim JSON'u POST edilir.
//              Kimlik bilgisi saklamayan seçenek; kurumsal tarafın istediği
//              "veri bizde kalsın" senaryosunu en temiz karşılayan yol.
//   api      → kullanıcının kendi transactional sağlayıcı anahtarı
//              (Resend / Brevo / Postmark).
//
// Ham SMTP bilinçli olarak yok. Gerekçe docs/mail-transports.md'de; özeti:
// SMTP şifresi çoğu sağlayıcıda tüm posta kutusuna gönderim yetkisi verir,
// API anahtarı ise yalnız gönderim yetkilidir ve tek tıkla iptal edilir.

// ── Tipler ──────────────────────────────────────────────────────────────────

export type TransportKind = 'platform' | 'webhook' | 'api';
export type ApiProvider = 'resend' | 'brevo' | 'postmark';

export interface TransportRow {
  user_id: string;
  kind: TransportKind;
  webhook_url: string | null;
  api_provider: ApiProvider | null;
  from_email: string | null;
  from_name: string | null;
  verified_at: string | null;
  failure_count: number;
  disabled_at: string | null;
}

export interface StoredSecret {
  ciphertext: string;
  iv: string;
  key_version: number;
}

/** Gönderilecek tek mail. `payload` yalnız webhook kanalında kullanılır. */
export interface MailJob {
  to: string;
  subject: string;
  html: string;
  payload?: Record<string, unknown>;
}

/**
 * Gönderim sonucu. `retryable` ayrımı kritik: geçici hata (ağ, 5xx, 429)
 * yeniden denenir; kalıcı hata (401/403/422 — yanlış anahtar, doğrulanmamış
 * gönderici) denenmez, doğrudan kullanıcının kanalını arızalı sayar.
 */
export interface SendResult {
  ok: boolean;
  error?: string;
  retryable: boolean;
}

const SEND_TIMEOUT_MS = 10_000;

// ── Hata metni temizleme ────────────────────────────────────────────────────

/**
 * Sağlayıcı hata gövdeleri gönderdiğimiz anahtarı ya da yetkilendirme
 * başlığını aynen geri yansıtabiliyor. Bu metin veritabanına (last_error) ve
 * loglara gittiği için önce süzülür.
 */
export function scrubError(value: unknown): string {
  let text = typeof value === 'string' ? value : String(value);
  text = text
    .replace(/\b(xkeysib|re|pk|sk)[-_][A-Za-z0-9_-]{8,}/gi, '$1_***')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '***')
    .replace(/("?(?:api[-_]?key|token|authorization|password|secret)"?\s*[:=]\s*"?)[^",\s}]+/gi, '$1***');
  return text.slice(0, 500);
}

// ── Sır şifreleme (AES-GCM) ─────────────────────────────────────────────────
//
// Anahtar Edge Function secret'ında durur, veritabanında değil. Bir veritabanı
// dökümü tek başına kullanıcı anahtarlarını açmaya yetmez.
//
// Rotasyon: yeni anahtarı MAIL_CRED_KEY_V2 olarak ekle, MAIL_CRED_KEY_VERSION=2
// yap. Eski satırlar key_version=1 ile okunmaya devam eder; kullanıcı anahtarını
// bir dahaki kaydedişinde yeni sürüme geçer.

function envKeyName(version: number): string {
  return version <= 1 ? 'MAIL_CRED_KEY' : `MAIL_CRED_KEY_V${version}`;
}

async function importKey(version: number): Promise<CryptoKey> {
  const name = envKeyName(version);
  const raw = Deno.env.get(name);
  if (!raw) throw new Error(`missing-secret:${name}`);
  // base64 → 32 bayt. Üretmek için: openssl rand -base64 32
  const bytes = Uint8Array.from(atob(raw.trim()), (c) => c.charCodeAt(0));
  if (bytes.length !== 32) throw new Error(`bad-secret-length:${name}`);
  return await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

/** Yazma sürümü: yeni sırlar bu anahtarla şifrelenir. */
export function currentKeyVersion(): number {
  const v = Number(Deno.env.get('MAIL_CRED_KEY_VERSION') ?? '1');
  return Number.isInteger(v) && v > 0 ? v : 1;
}

export async function encryptSecret(plain: string): Promise<StoredSecret> {
  const version = currentKeyVersion();
  const key = await importKey(version);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plain),
  );
  return {
    ciphertext: toBase64(new Uint8Array(cipher)),
    iv: toBase64(iv),
    key_version: version,
  };
}

export async function decryptSecret(rec: StoredSecret): Promise<string> {
  const key = await importKey(rec.key_version);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(rec.iv) },
    key,
    fromBase64(rec.ciphertext),
  );
  return new TextDecoder().decode(plain);
}

// ── Webhook adres güvenliği (SSRF) ──────────────────────────────────────────
//
// Kullanıcı `webhook_url` alanına ne yazarsa Supabase altyapısı oraya bağlanır.
// Kontrolsüz bırakılırsa bu uç, iç ağ ve bulut metadata servisleri için bir
// tarayıcıya dönüşür. Üç katman:
//   1) yalnız https, standart port
//   2) IP literali ya da bilinen iç isim → red
//   3) DNS çözülebiliyorsa çözülen adresler de aynı süzgeçten geçer
// Ayrıca gönderimde yönlendirme takip EDİLMEZ: aksi hâlde herkese açık bir
// adres 302 ile 169.254.169.254'e çevirebilir.

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // ayrıştıramadıysak güvenli tarafta kal
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;              // link-local + metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;                // 192.0.0/24 IETF
  if (a === 100 && b >= 64 && b <= 127) return true;    // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
  if (a >= 224) return true;                            // multicast + reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (v === '::' || v === '::1') return true;
  if (v.startsWith('fc') || v.startsWith('fd')) return true; // unique local
  if (v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')) {
    return true; // link local
  }
  // ::ffff:1.2.3.4 — IPv4 eşlemesi
  const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

function isIpLiteral(host: string): 'v4' | 'v6' | null {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return 'v4';
  if (host.includes(':')) return 'v6';
  return null;
}

const BLOCKED_HOST_SUFFIXES = ['.local', '.internal', '.localdomain', '.home.arpa'];
const BLOCKED_HOSTS = ['localhost', 'metadata.google.internal', 'instance-data'];

/**
 * Adresi doğrular; uygun değilse sebep metniyle fırlatır. Kaydetme sırasında da
 * her gönderimden önce de çağrılır — DNS kaydı kaydedildikten sonra iç bir
 * adrese çevrilebilir (DNS rebinding), tek seferlik kontrol yetmez.
 */
export async function assertSafeWebhookUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('webhook-url-invalid');
  }
  if (url.protocol !== 'https:') throw new Error('webhook-url-not-https');
  if (url.port && url.port !== '443') throw new Error('webhook-url-bad-port');

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTS.includes(host)) throw new Error('webhook-url-internal-host');
  if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new Error('webhook-url-internal-host');
  }

  const literal = isIpLiteral(host);
  if (literal === 'v4' && isPrivateIPv4(host)) throw new Error('webhook-url-private-ip');
  if (literal === 'v6' && isPrivateIPv6(host)) throw new Error('webhook-url-private-ip');

  // DNS katmanı. Çalışma zamanı izin vermiyorsa (resolveDns her ortamda açık
  // değil) yukarıdaki kontrollerle yetiniriz — bu bilinen bir boşluktur ve
  // webhook gövdesinde kullanıcı verisi taşımadığımız için kabul edilmiştir.
  if (!literal) {
    try {
      const records = [
        ...(await Deno.resolveDns(host, 'A').catch(() => [] as string[])),
        ...(await Deno.resolveDns(host, 'AAAA').catch(() => [] as string[])),
      ];
      for (const ip of records) {
        if (ip.includes(':') ? isPrivateIPv6(ip) : isPrivateIPv4(ip)) {
          throw new Error('webhook-url-private-ip');
        }
      }
    } catch (e) {
      if (e instanceof Error && e.message === 'webhook-url-private-ip') throw e;
      // izin/çözümleme hatası: sessizce geç
    }
  }

  return url;
}

// ── HMAC imzası ─────────────────────────────────────────────────────────────

/**
 * Webhook alıcısının gövdenin gerçekten FRAUDE'den geldiğini doğrulaması için.
 * Kullanıcı bir imzalama sırrı tanımladıysa uygulanır; tanımlamadıysa gövde
 * imzasız gider (uç adresinin gizliliği tek koruma olur).
 */
async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Gönderim uçları ─────────────────────────────────────────────────────────

/** "Ad <adres>" ya da düz adres → { name, email } */
export function parseSender(raw: string, fallbackName = 'FRAUDE'): { name: string; email: string } {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m
    ? { name: m[1].trim() || fallbackName, email: m[2].trim() }
    : { name: fallbackName, email: raw.trim() };
}

/** HTTP durum koduna göre yeniden deneme kararı. */
function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  opts: { followRedirects?: boolean } = {},
): Promise<SendResult> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      redirect: opts.followRedirects ? 'follow' : 'manual',
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400 && !opts.followRedirects) {
      return { ok: false, error: `redirect-not-allowed:${res.status}`, retryable: false };
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return {
        ok: false,
        error: scrubError(`${res.status} ${detail}`),
        retryable: retryableStatus(res.status),
      };
    }
    // Gövdeyi tüketmezsek bağlantı sızar.
    await res.body?.cancel().catch(() => {});
    return { ok: true, retryable: false };
  } catch (e) {
    // Ağ hatası / timeout: geçici kabul edilir.
    return { ok: false, error: scrubError(e), retryable: true };
  }
}

export const DEFAULT_MAIL_HEADERS: Record<string, string> = {
  'List-Unsubscribe': '<https://fraude.app/hesap/bildirimler>, <mailto:unsubscribe@fraude.app?subject=unsubscribe>',
  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  'Precedence': 'bulk',
  'Auto-Submitted': 'auto-generated',
  'X-Auto-Response-Suppress': 'All',
};

/** FRAUDE'nin kendi Brevo hesabı. Varsayılan kanal ve her zaman son çare. */
export async function sendViaPlatform(job: MailJob): Promise<SendResult> {
  const apiKey = Deno.env.get('BREVO_API_KEY');
  const fromRaw = Deno.env.get('MAIL_FROM');
  if (!apiKey || !fromRaw) {
    return { ok: false, error: 'platform-mailer-not-configured', retryable: false };
  }
  return await postJson(
    'https://api.brevo.com/v3/smtp/email',
    { 'api-key': apiKey, accept: 'application/json' },
    {
      sender: parseSender(fromRaw),
      to: [{ email: job.to }],
      subject: job.subject,
      htmlContent: job.html,
      headers: DEFAULT_MAIL_HEADERS,
    },
  );
}

/** Kullanıcının kendi ucu. Mail değil, yapılandırılmış bildirim gönderilir. */
export async function sendViaWebhook(
  rawUrl: string,
  job: MailJob,
  signingSecret: string | null,
): Promise<SendResult> {
  let url: URL;
  try {
    url = await assertSafeWebhookUrl(rawUrl);
  } catch (e) {
    // Adres kalıcı olarak geçersiz; yeniden denemek anlamsız.
    return { ok: false, error: scrubError(e), retryable: false };
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: 'fraude.notification',
    timestamp,
    to: job.to,
    subject: job.subject,
    ...job.payload,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'FRAUDE-notify/1',
    'X-Fraude-Timestamp': timestamp,
  };
  if (signingSecret) {
    headers['X-Fraude-Signature'] = `sha256=${await hmacHex(signingSecret, `${timestamp}.${body}`)}`;
  }

  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body,
      redirect: 'manual', // 302 ile iç adrese sıçramayı engeller
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400) {
      return { ok: false, error: `redirect-not-allowed:${res.status}`, retryable: false };
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return {
        ok: false,
        error: scrubError(`${res.status} ${detail}`),
        retryable: retryableStatus(res.status),
      };
    }
    await res.body?.cancel().catch(() => {});
    return { ok: true, retryable: false };
  } catch (e) {
    return { ok: false, error: scrubError(e), retryable: true };
  }
}

/** Kullanıcının kendi transactional sağlayıcı anahtarı. */
export async function sendViaApi(
  provider: ApiProvider,
  apiKey: string,
  from: { name: string; email: string },
  job: MailJob,
): Promise<SendResult> {
  switch (provider) {
    case 'resend':
      return await postJson(
        'https://api.resend.com/emails',
        { Authorization: `Bearer ${apiKey}` },
        {
          from: from.name ? `${from.name} <${from.email}>` : from.email,
          to: [job.to],
          subject: job.subject,
          html: job.html,
          headers: DEFAULT_MAIL_HEADERS,
        },
      );

    case 'brevo':
      return await postJson(
        'https://api.brevo.com/v3/smtp/email',
        { 'api-key': apiKey, accept: 'application/json' },
        {
          sender: { name: from.name || 'FRAUDE', email: from.email },
          to: [{ email: job.to }],
          subject: job.subject,
          htmlContent: job.html,
          headers: DEFAULT_MAIL_HEADERS,
        },
      );

    case 'postmark':
      return await postJson(
        'https://api.postmarkapp.com/email',
        { 'X-Postmark-Server-Token': apiKey, Accept: 'application/json' },
        {
          From: from.name ? `${from.name} <${from.email}>` : from.email,
          To: job.to,
          Subject: job.subject,
          HtmlBody: job.html,
          MessageStream: 'outbound',
          Headers: Object.entries(DEFAULT_MAIL_HEADERS).map(([Name, Value]) => ({ Name, Value })),
        },
      );
  }
}

// ── Tek giriş noktası ───────────────────────────────────────────────────────

/**
 * Kanalı seçer ve gönderir. Kanal yoksa, doğrulanmamışsa ya da devre dışı
 * bırakılmışsa platform'a düşer — bildirim, konfigürasyon hatası yüzünden
 * kaybolmaz.
 */
export async function sendWithTransport(
  transport: TransportRow | null,
  secret: string | null,
  job: MailJob,
): Promise<SendResult & { usedKind: TransportKind }> {
  const usable =
    transport &&
    transport.kind !== 'platform' &&
    transport.verified_at !== null &&
    transport.disabled_at === null;

  if (!usable) {
    return { ...(await sendViaPlatform(job)), usedKind: 'platform' };
  }

  const t = transport as TransportRow;

  if (t.kind === 'webhook') {
    if (!t.webhook_url) {
      return { ok: false, error: 'webhook-url-missing', retryable: false, usedKind: 'webhook' };
    }
    return { ...(await sendViaWebhook(t.webhook_url, job, secret)), usedKind: 'webhook' };
  }

  // kind === 'api'
  if (!t.api_provider || !t.from_email || !secret) {
    return { ok: false, error: 'api-transport-incomplete', retryable: false, usedKind: 'api' };
  }
  const result = await sendViaApi(
    t.api_provider,
    secret,
    { name: t.from_name ?? 'FRAUDE', email: t.from_email },
    job,
  );
  return { ...result, usedKind: 'api' };
}
