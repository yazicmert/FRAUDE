// FRAUDE — gönderim kanalı (transport) soyutlaması.
// ─────────────────────────────────────────────────────────────────────────────
// Bildirimler dört yoldan biriyle çıkabilir:
//
//   platform → FRAUDE'nin Brevo hesabı. Varsayılan ve DAİMA yedek.
//   telegram → FRAUDE Telegram Botu (@FraudeTerminalBot) veya özel bot.
//   webhook  → kullanıcının verdiği https uca bildirim JSON'u POST edilir.
//   api      → kullanıcının kendi transactional sağlayıcı anahtarı (Resend/Brevo/Postmark).

// ── Tipler ──────────────────────────────────────────────────────────────────

export type TransportKind = 'platform' | 'webhook' | 'api' | 'telegram';
export type ApiProvider = 'resend' | 'brevo' | 'postmark';

export interface TransportRow {
  user_id: string;
  kind: TransportKind;
  webhook_url: string | null;
  api_provider: ApiProvider | null;
  from_email: string | null;
  from_name: string | null;
  telegram_chat_id: string | null;
  telegram_username: string | null;
  verified_at: string | null;
  failure_count: number;
  disabled_at: string | null;
}

export interface StoredSecret {
  ciphertext: string;
  iv: string;
  key_version: number;
}

/** Gönderilecek tek bildirim / mail. */
export interface MailJob {
  to: string;
  subject: string;
  html: string;
  payload?: Record<string, unknown>;
}

export interface SendResult {
  ok: boolean;
  error?: string;
  retryable: boolean;
}

const SEND_TIMEOUT_MS = 10_000;

// ── Hata metni temizleme ────────────────────────────────────────────────────

export function scrubError(value: unknown): string {
  let text = typeof value === 'string' ? value : String(value);
  text = text
    .replace(/\b(xkeysib|re|pk|sk)[-_][A-Za-z0-9_-]{8,}/gi, '$1_***')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '***')
    .replace(/("?(?:api[-_]?key|token|authorization|password|secret)"?\s*[:=]\s*"?)[^",\s}]+/gi, '$1***');
  return text.slice(0, 500);
}

// ── Sır şifreleme (AES-GCM) ─────────────────────────────────────────────────

function envKeyName(version: number): string {
  return version <= 1 ? 'MAIL_CRED_KEY' : `MAIL_CRED_KEY_V${version}`;
}

async function importKey(version: number): Promise<CryptoKey> {
  const name = envKeyName(version);
  const raw = Deno.env.get(name);
  if (!raw) throw new Error(`missing-secret:${name}`);
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

export function currentKeyVersion(): number {
  const v = Number(Deno.env.get('MAIL_CRED_KEY_VERSION') ?? '1');
  return Number.isInteger(v) && v > 0 ? v : 1;
}

export async function encryptSecret(plain: string): Promise<StoredSecret> {
  const version = currentKeyVersion();
  const key = await importKey(version);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plain);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return {
    ciphertext: toBase64(new Uint8Array(cipher)),
    iv: toBase64(iv),
    key_version: version,
  };
}

export async function decryptSecret(secret: StoredSecret): Promise<string> {
  const key = await importKey(secret.key_version);
  const iv = fromBase64(secret.iv);
  const cipher = fromBase64(secret.ciphertext);
  const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return new TextDecoder().decode(plainBuffer);
}

// ── SSRF Koruması ──────────────────────────────────────────────────────────

const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
  /^metadata\.google\.internal$/i,
  /^169\.254\.169\.254$/,
];

export async function assertSafeWebhookUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('invalid-url-format');
  }

  if (url.protocol !== 'https:') {
    throw new Error('https-required');
  }

  const port = url.port ? Number(url.port) : 443;
  if (port !== 443) {
    throw new Error('standard-https-port-required');
  }

  const host = url.hostname.toLowerCase();
  for (const pattern of BLOCKED_HOST_PATTERNS) {
    if (pattern.test(host)) {
      throw new Error(`private-host-rejected:${host}`);
    }
  }

  try {
    const addresses = await Deno.resolveDns(host, 'A');
    for (const ip of addresses) {
      for (const pattern of BLOCKED_HOST_PATTERNS) {
        if (pattern.test(ip)) {
          throw new Error(`resolved-private-ip:${ip}`);
        }
      }
    }
  } catch (e) {
    const msg = String(e);
    if (msg.includes('resolved-private-ip') || msg.includes('private-host-rejected')) throw e;
  }

  return url;
}

// ── Gönderim yardımcıları ──────────────────────────────────────────────────

export function parseSender(raw: string): { name: string; email: string } {
  const match = raw.match(/^\s*(?:"?([^"<]+)"?\s+)?<?([^\s>]+)>?\s*$/);
  if (!match) return { name: 'FRAUDE', email: raw.trim() };
  return { name: (match[1] || 'FRAUDE').trim(), email: match[2].trim() };
}

function retryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  payload: unknown,
  opts: { followRedirects?: boolean } = {},
): Promise<SendResult> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
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
    await res.body?.cancel().catch(() => {});
    return { ok: true, retryable: false };
  } catch (e) {
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

export async function sendViaWebhook(
  rawUrl: string,
  job: MailJob,
  signingSecret: string | null,
): Promise<SendResult> {
  let url: URL;
  try {
    url = await assertSafeWebhookUrl(rawUrl);
  } catch (e) {
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
      redirect: 'manual',
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

// ── Telegram Entegrasyonu ──────────────────────────────────────────────────

export function escapeTelegramHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function formatTelegramMessage(job: MailJob): string {
  const payload = job.payload as {
    source?: string;
    title?: string;
    summary?: string;
    tickers?: string[];
    url?: string | null;
    priority?: number;
  } | undefined;

  const title = payload?.title ?? job.subject;
  const summary = payload?.summary ?? '';
  const tickers = payload?.tickers ?? [];
  const url = payload?.url;
  const source = payload?.source;

  const icon = source === 'kap' ? '📢' : source === 'spk' ? '🏛️' : '📰';
  const tickerBadge = tickers.length > 0 ? ` · <code>${tickers.join(', ')}</code>` : '';

  let msg = `${icon} <b>FRAUDE Terminal</b>${tickerBadge}\n\n`;
  msg += `<b>${escapeTelegramHtml(title)}</b>\n\n`;
  if (summary) {
    msg += `${escapeTelegramHtml(summary)}\n\n`;
  }
  if (url) {
    msg += `🔗 <a href="${escapeTelegramHtml(url)}">Detayı İncele ↗</a>`;
  }
  return msg;
}

export async function sendViaTelegram(
  botToken: string,
  chatId: string,
  job: MailJob,
): Promise<SendResult> {
  const text = formatTelegramMessage(job);
  return await postJson(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {},
    {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    },
  );
}

export function renderPairingEmailHtml(code: string): string {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="color-scheme" content="dark"></head>
<body style="margin:0;padding:0;background-color:#0a0d12;" bgcolor="#0a0d12">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0a0d12"><tr><td align="center" style="padding:40px 16px;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:100%;">
      <tr><td align="center" style="padding-bottom:22px;font-family:'SF Mono',Menlo,monospace;font-size:20px;font-weight:800;letter-spacing:5px;color:#e8f0f7;"><span style="color:#00e896;">F</span>RAUDE</td></tr>
      <tr><td bgcolor="#10151d" style="background-color:#10151d;border:1px solid #232a33;border-radius:14px;padding:32px 30px;text-align:center;">
        <div style="font-family:-apple-system,'Segoe UI',sans-serif;font-size:20px;font-weight:700;color:#e8f0f7;margin-bottom:12px;">Telegram Eşleştirme Kodu</div>
        <div style="font-family:-apple-system,'Segoe UI',sans-serif;font-size:14px;color:#8b949e;line-height:1.6;margin-bottom:24px;">
          FRAUDE hesabınızı Telegram Botuna bağlamak için aşağıdaki 6 haneli kodu Telegram sohbetine yazın. Kod <b>5 dakika</b> geçerlidir.
        </div>
        <div style="display:inline-block;background:#0d1117;border:2px dashed #00e896;border-radius:12px;padding:16px 32px;font-family:'SF Mono',Menlo,monospace;font-size:32px;font-weight:800;letter-spacing:8px;color:#00e896;margin-bottom:24px;">
          ${escapeTelegramHtml(code)}
        </div>
        <div style="font-family:-apple-system,'Segoe UI',sans-serif;font-size:13px;color:#8b949e;">
          Bu işlemi siz başlatmadıysanız bu e-postayı güvenle yok sayabilirsiniz.
        </div>
      </td></tr>
      <tr><td align="center" style="padding-top:22px;font-family:-apple-system,'Segoe UI',sans-serif;font-size:12px;color:#8b949e;">FRAUDE Terminal — finansal dostunuz</td></tr>
    </table></td></tr></table></body></html>`;
}

// ── Tek giriş noktası ───────────────────────────────────────────────────────

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

  if (t.kind === 'telegram') {
    if (!t.telegram_chat_id) {
      return { ok: false, error: 'telegram-chat-id-missing', retryable: false, usedKind: 'telegram' };
    }
    const botToken = secret || Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!botToken) {
      return { ok: false, error: 'telegram-bot-token-missing', retryable: false, usedKind: 'telegram' };
    }
    const result = await sendViaTelegram(botToken, t.telegram_chat_id, job);
    return { ...result, usedKind: 'telegram' };
  }

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

async function hmacHex(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
