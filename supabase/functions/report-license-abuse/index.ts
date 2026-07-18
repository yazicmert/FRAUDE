// FRAUDE — "Bu talebi ben yapmadım" bildirimi (JSON API).
//
// Supabase, *.supabase.co üzerinden HTML sunumunu engeller (text/plain +
// sandbox CSP'ye çevirir); bu yüzden onay SAYFASI sitededir (/lisans-iptal),
// bu fonksiyon yalnız API'dir:
//   GET  ?token=…            → 302 ile sitedeki onay sayfasına yönlendirir
//                              (eski e-postalardaki doğrudan bağlantılar için)
//   POST {token, confirm}    → confirm=false: talep bilgisi (e-posta + maskeli
//                              anahtar); confirm=true: anahtar revoke edilir,
//                              abuse_reported_at damgalanır, yöneticiye Brevo
//                              ile bildirim gider. Jeton tek kullanımlıktır.
//   POST {token, rating, comment?} → iptal sonrası memnuniyet anketi; yalnız
//                              bildirimi yapılmış (abuse_reported_at dolu)
//                              taleplere, bir kez yazılır.
//
// Kurulum: alıcı oturumsuz olduğundan JWT doğrulaması KAPALI deploy edilir:
//   supabase functions deploy report-license-abuse --no-verify-jwt --use-api
// Secrets: BREVO_API_KEY, MAIL_FROM (ortak), ADMIN_EMAIL (ops.), SITE_URL (ops.)

import { createClient } from 'npm:@supabase/supabase-js@2';

const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://fraude.intelligentverseconnection.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function maskKey(key: string): string {
  return key.replace(/^(FRAUDE-[^-]{4})-.*-([^-]{4})$/, '$1-••••-••••-$2');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Eski e-postalardaki doğrudan bağlantılar sitedeki onay sayfasına gider
  if (req.method === 'GET') {
    const token = new URL(req.url).searchParams.get('token') ?? '';
    return new Response(null, {
      status: 302,
      headers: { ...corsHeaders, Location: `${SITE_URL}/lisans-iptal?token=${encodeURIComponent(token)}` },
    });
  }
  if (req.method !== 'POST') return json({ ok: false, error: 'method-not-allowed' }, 405);

  let token: unknown;
  let confirm: unknown;
  let rating: unknown;
  let comment: unknown;
  try {
    ({ token, confirm, rating, comment } = await req.json());
  } catch {
    return json({ ok: false, error: 'bad-request' }, 400);
  }
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
    return json({ ok: false, error: 'invalid-token' }, 404);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: request } = await supabase
    .from('license_requests')
    .select('id, email, name, delivered_key, abuse_reported_at, feedback_rating, created_at')
    .eq('revoke_token', token)
    .maybeSingle();
  if (!request || !request.delivered_key) return json({ ok: false, error: 'invalid-token' }, 404);

  // Memnuniyet anketi: yalnız bildirimi yapılmış taleplere, bir kez
  if (rating !== undefined) {
    if (!request.abuse_reported_at) return json({ ok: false, error: 'not-reported' }, 409);
    if (request.feedback_rating) return json({ ok: true, status: 'feedback-exists' });
    const ratingNum = Number(rating);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return json({ ok: false, error: 'bad-rating' }, 400);
    }
    const commentText =
      typeof comment === 'string' && comment.trim() ? comment.trim().slice(0, 1000) : null;
    const { error: feedbackError } = await supabase
      .from('license_requests')
      .update({ feedback_rating: ratingNum, feedback_comment: commentText })
      .eq('id', request.id);
    if (feedbackError) {
      console.error('feedback-failed', feedbackError.message);
      return json({ ok: false, error: 'feedback-failed' }, 500);
    }
    return json({ ok: true, status: 'feedback-saved' });
  }

  if (request.abuse_reported_at) return json({ ok: true, status: 'already' });

  if (!confirm) {
    return json({
      ok: true,
      status: 'pending',
      email: request.email,
      masked_key: maskKey(request.delivered_key),
    });
  }

  // Onaylandı: iptal + damga + yönetici bildirimi
  const keyHash = await sha256Hex(request.delivered_key);
  const { error: revokeError } = await supabase
    .from('licenses')
    .update({ status: 'revoked' })
    .eq('key_hash', keyHash);
  if (revokeError) {
    console.error('revoke-failed', revokeError.message);
    return json({ ok: false, error: 'revoke-failed' }, 500);
  }
  await supabase
    .from('license_requests')
    .update({ abuse_reported_at: new Date().toISOString() })
    .eq('id', request.id);

  const brevoKey = Deno.env.get('BREVO_API_KEY');
  const fromRaw = Deno.env.get('MAIL_FROM') ?? '';
  const fromMatch = fromRaw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const senderEmail = fromMatch ? fromMatch[2].trim() : fromRaw.trim();
  const adminEmail = Deno.env.get('ADMIN_EMAIL') || senderEmail;
  if (brevoKey && senderEmail && adminEmail) {
    const info = `Talep sahibi: ${request.name ?? '—'} <${request.email}>
Anahtar (iptal edildi): ${request.delivered_key}
Talep tarihi: ${request.created_at}
Bildirim: ${new Date().toISOString()}`;
    const notify = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': brevoKey, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: 'FRAUDE', email: senderEmail },
        to: [{ email: adminEmail }],
        subject: 'FRAUDE — lisans iptal bildirimi (talebi ben yapmadım)',
        htmlContent: `<pre style="font-family:monospace;font-size:14px;">${escapeHtml(info)}</pre>
<p>Anahtar otomatik iptal edildi; talep admin panelde "İptal bildirimi" rozetiyle görünür.</p>`,
      }),
    });
    if (!notify.ok) console.error('admin-notify-failed', notify.status, await notify.text().catch(() => ''));
  }

  return json({ ok: true, status: 'revoked' });
});
