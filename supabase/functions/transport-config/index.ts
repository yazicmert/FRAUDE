// FRAUDE — kullanıcının kendi gönderim kanalını kaydeden ve doğrulayan uç.
// ─────────────────────────────────────────────────────────────────────────────
// notify_transports tablosuna doğrudan yazma HAKKI YOK (RLS'te yalnız select
// policy'si var). Yazma buradan geçer, çünkü kaydetmeden önce yapılması gereken
// üç şey var:
//   1) webhook adresinin SSRF süzgecinden geçmesi,
//   2) sırrın AES-GCM ile şifrelenmesi (düz metin veritabanına hiç girmez),
//   3) gerçek bir test gönderimi — çalışmayan kanal `verified_at` almaz,
//      mail-dispatch de doğrulanmamış kanalı kullanmaz, platform'a düşer.
//
// GÖNDERİCİ ADRESİ TAKLİDİ: from_email'i biz doğrulamıyoruz, sağlayıcı
// doğruluyor. Resend/Postmark/Brevo üçü de doğrulanmamış alan adından gönderimi
// reddeder; test gönderimi başarısız olursa kanal kaydedilir ama doğrulanmaz.
// Ayrıca bu kanal yalnız kullanıcının KENDİ adresine mail atar (notify_prefs.
// email), yani yanlış yapılandırmanın etki alanı kullanıcının kendisidir.
//
// Kurulum:
//   supabase functions deploy transport-config --use-api
//   Secrets: MAIL_CRED_KEY (base64, 32 bayt — `openssl rand -base64 32`),
//            BREVO_API_KEY + MAIL_FROM (platform testi için)

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  assertSafeWebhookUrl,
  decryptSecret,
  encryptSecret,
  scrubError,
  sendViaApi,
  sendViaWebhook,
  type ApiProvider,
  type StoredSecret,
  type TransportKind,
} from '../_shared/mailer.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** İki test arasında beklenmesi gereken süre. Uç adresi taramasını anlamsız kılar. */
const VERIFY_THROTTLE_MS = 15_000;

const API_PROVIDERS: readonly ApiProvider[] = ['resend', 'brevo', 'postmark'];

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

function renderTestHtml(kindLabel: string): string {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="color-scheme" content="dark"></head>
<body style="margin:0;padding:0;background-color:#0a0d12;" bgcolor="#0a0d12">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0a0d12"><tr><td align="center" style="padding:40px 16px;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:100%;">
      <tr><td align="center" style="padding-bottom:22px;font-family:'SF Mono',Menlo,monospace;font-size:20px;font-weight:800;letter-spacing:5px;color:#e8f0f7;"><span style="color:#00e896;">F</span>RAUDE</td></tr>
      <tr><td bgcolor="#10151d" style="background-color:#10151d;border:1px solid #232a33;border-radius:14px;padding:32px 30px;">
        <div style="font-family:-apple-system,'Segoe UI',sans-serif;font-size:18px;font-weight:700;color:#e8f0f7;margin-bottom:10px;">Gönderim kanalı çalışıyor ✓</div>
        <div style="font-family:-apple-system,'Segoe UI',sans-serif;font-size:14px;color:#b7c2cc;line-height:1.7;">
          Bu test mesajını okuyorsanız FRAUDE bildirimleriniz artık <b>${kindLabel}</b> üzerinden gelecek.
          Kanal üst üste beş kez hata verirse otomatik olarak kapatılır ve bildirimleriniz FRAUDE sunucusundan gelmeye devam eder.
        </div>
      </td></tr>
      <tr><td align="center" style="padding-top:22px;font-family:-apple-system,'Segoe UI',sans-serif;font-size:12px;color:#8b949e;">FRAUDE Terminal — finansal dostunuz</td></tr>
    </table></td></tr></table></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method-not-allowed' }, 405);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── Kimlik ────────────────────────────────────────────────────────────────
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !userData.user) return json({ ok: false, error: 'not-authenticated' }, 401);
  const user = userData.user;
  const accountEmail = user.email;
  if (!accountEmail) return json({ ok: false, error: 'account-has-no-email' }, 400);

  // ── Girdi ─────────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'bad-request' }, 400);
  }

  const kind = String(body.kind ?? '') as TransportKind;
  if (!['platform', 'webhook', 'api'].includes(kind)) {
    return json({ ok: false, error: 'bad-kind' }, 400);
  }

  const now = new Date().toISOString();

  // ── Platform'a dönüş: kanalı sil, sırrı imha et ───────────────────────────
  if (kind === 'platform') {
    await supabase.from('notify_transport_secrets').delete().eq('user_id', user.id);
    const { error } = await supabase.from('notify_transports').upsert(
      {
        user_id: user.id,
        kind: 'platform',
        webhook_url: null,
        api_provider: null,
        from_email: null,
        from_name: null,
        has_secret: false,
        verified_at: now,
        failure_count: 0,
        last_error: null,
        disabled_at: null,
        updated_at: now,
      },
      { onConflict: 'user_id' },
    );
    if (error) return json({ ok: false, error: scrubError(error.message) }, 500);
    return json({ ok: true, kind: 'platform', verified: true });
  }

  // ── Hız sınırı ────────────────────────────────────────────────────────────
  const { data: existing } = await supabase
    .from('notify_transports')
    .select('updated_at, has_secret')
    .eq('user_id', user.id)
    .maybeSingle();

  if (existing?.updated_at) {
    const elapsed = Date.now() - new Date(existing.updated_at as string).getTime();
    if (elapsed < VERIFY_THROTTLE_MS) {
      return json(
        { ok: false, error: 'too-many-attempts', retry_after_ms: VERIFY_THROTTLE_MS - elapsed },
        429,
      );
    }
  }

  // Sır: yeni verildiyse şifrelenir, verilmediyse mevcut kayıt korunur.
  const rawSecret = typeof body.secret === 'string' && body.secret.trim() ? body.secret.trim() : null;
  const hadSecret = Boolean(existing?.has_secret);

  // ── Alan doğrulama ────────────────────────────────────────────────────────
  let webhookUrl: string | null = null;
  let apiProvider: ApiProvider | null = null;
  let fromEmail: string | null = null;
  let fromName: string | null = null;

  if (kind === 'webhook') {
    webhookUrl = String(body.webhookUrl ?? '').trim();
    try {
      await assertSafeWebhookUrl(webhookUrl);
    } catch (e) {
      return json({ ok: false, error: scrubError(e) }, 400);
    }
  } else {
    const provider = String(body.apiProvider ?? '') as ApiProvider;
    if (!API_PROVIDERS.includes(provider)) return json({ ok: false, error: 'bad-provider' }, 400);
    apiProvider = provider;

    fromEmail = String(body.fromEmail ?? '').trim().toLowerCase();
    if (!isEmail(fromEmail)) return json({ ok: false, error: 'bad-from-email' }, 400);

    fromName = String(body.fromName ?? '').trim().slice(0, 80) || 'FRAUDE';

    if (!rawSecret && !hadSecret) return json({ ok: false, error: 'api-key-required' }, 400);
  }

  // ── Sırrı çöz/şifrele ─────────────────────────────────────────────────────
  // Test gönderimi düz metin anahtara ihtiyaç duyar. Yeni anahtar geldiyse onu
  // kullanırız; gelmediyse saklı olanı çözeriz.
  let plainSecret: string | null = rawSecret;
  if (!plainSecret && hadSecret) {
    const { data: stored } = await supabase
      .from('notify_transport_secrets')
      .select('ciphertext, iv, key_version')
      .eq('user_id', user.id)
      .maybeSingle();
    if (stored) {
      try {
        plainSecret = await decryptSecret(stored as StoredSecret);
      } catch (e) {
        console.error('secret-decrypt-failed', user.id, scrubError(e));
        return json({ ok: false, error: 'stored-secret-unreadable' }, 500);
      }
    }
  }

  // ── Test gönderimi ────────────────────────────────────────────────────────
  const testJob = {
    to: accountEmail,
    subject: 'FRAUDE — gönderim kanalı testi',
    html: renderTestHtml(kind === 'webhook' ? 'kendi webhook ucunuz' : 'kendi mail sağlayıcınız'),
    payload: {
      source: 'test',
      priority: 1,
      title: 'FRAUDE gönderim kanalı testi',
      summary: 'Bu, kanalın çalıştığını doğrulamak için gönderilen tek seferlik bir mesajdır.',
      tickers: [] as string[],
      url: null,
    },
  };

  const result =
    kind === 'webhook'
      ? await sendViaWebhook(webhookUrl!, testJob, plainSecret)
      : await sendViaApi(apiProvider!, plainSecret!, { name: fromName!, email: fromEmail! }, testJob);

  // ── Kaydet ────────────────────────────────────────────────────────────────
  // Test başarısız olsa da ayarlar saklanır (kullanıcı baştan yazmasın), ama
  // verified_at verilmez — dispatcher bu kanalı kullanmaz, platform'a düşer.
  if (rawSecret) {
    const enc = await encryptSecret(rawSecret);
    const { error: secretError } = await supabase.from('notify_transport_secrets').upsert(
      { user_id: user.id, ...enc, updated_at: now },
      { onConflict: 'user_id' },
    );
    if (secretError) return json({ ok: false, error: scrubError(secretError.message) }, 500);
  }

  const { error: saveError } = await supabase.from('notify_transports').upsert(
    {
      user_id: user.id,
      kind,
      webhook_url: webhookUrl,
      api_provider: apiProvider,
      from_email: fromEmail,
      from_name: fromName,
      has_secret: Boolean(rawSecret) || hadSecret,
      verified_at: result.ok ? now : null,
      failure_count: 0,
      last_error: result.ok ? null : (result.error ?? 'test-failed'),
      disabled_at: null,
      updated_at: now,
    },
    { onConflict: 'user_id' },
  );
  if (saveError) return json({ ok: false, error: scrubError(saveError.message) }, 500);

  if (!result.ok) {
    return json({ ok: false, saved: true, verified: false, error: result.error ?? 'test-failed' }, 422);
  }
  return json({ ok: true, kind, verified: true });
});
