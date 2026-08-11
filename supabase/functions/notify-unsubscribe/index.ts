// FRAUDE — bildirim aboneliğinden çıkma ucu.
//
// Neden var: dijest maili düzenli/tekrarlayan bir gönderim olduğundan Gmail ve
// Yahoo toplu gönderici kuralları tek tıkla abonelikten çıkmayı (RFC 8058)
// zorunlu tutuyor. Başlığı gönderen market-watch, işi burası yapıyor.
// Kimlik = notify_prefs.feed_token (notify-feed ile aynı jeton).
//
// İki giriş:
//   POST ?token=<feed_token>   body: "List-Unsubscribe=One-Click"
//     → posta istemcisi/sağlayıcı otomatik çağırır, onay sormadan kapatır (RFC 8058)
//   POST  JSON { token, confirm }
//     → sitedeki /bildirim-iptal sayfası; confirm:false durumu okur, true kapatır
//   GET  ?token=...  → eski/düz bağlantılar için siteye 302
//
// Kurulum: supabase functions deploy notify-unsubscribe --no-verify-jwt --use-api
// (Gizli anahtar gerekmez; SUPABASE_URL + SERVICE_ROLE_KEY otomatik gelir.)

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://fraude.intelligentverseconnection.com';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function client() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

/** E-postayı maskeler: kullanıcı doğru adresi gördüğünü anlasın, adres sızmasın. */
function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain) return '***';
  const head = user.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = new URL(req.url);
  const queryToken = (url.searchParams.get('token') ?? '').trim();

  // Eski/düz bağlantı tıklaması: onay sayfası siteye ait (*.supabase.co HTML
  // sunamıyor, bkz. lisans-iptal akışı).
  if (req.method === 'GET') {
    const target = queryToken
      ? `${SITE_URL}/bildirim-iptal?token=${encodeURIComponent(queryToken)}`
      : `${SITE_URL}/hesap`;
    return Response.redirect(target, 302);
  }

  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);

  const contentType = req.headers.get('content-type') ?? '';
  const raw = await req.text().catch(() => '');

  // RFC 8058 tek tık: gövde "List-Unsubscribe=One-Click", jeton sorgu dizesinde.
  const oneClick =
    contentType.includes('application/x-www-form-urlencoded') &&
    /List-Unsubscribe=One-Click/i.test(raw);

  let token = queryToken;
  let confirm = oneClick;
  if (!oneClick && raw) {
    try {
      const body = JSON.parse(raw) as { token?: string; confirm?: boolean };
      token = (body.token ?? token).trim();
      confirm = body.confirm === true;
    } catch {
      return json({ ok: false, error: 'bad-body' }, 400);
    }
  }

  if (!token || token.length < 16) {
    return oneClick
      ? new Response('missing token', { status: 400 })
      : json({ ok: false, error: 'missing-token' }, 400);
  }

  const supabase = client();
  const { data: pref } = await supabase
    .from('notify_prefs')
    .select('user_id, email, enabled')
    .eq('feed_token', token)
    .maybeSingle();

  if (!pref) {
    // Tek tıkta sağlayıcıya hata döndürmek gönderici karnesine yazılır; jeton
    // eskimişse de "tamam" demek doğru davranış — abonelik zaten yok.
    return oneClick
      ? new Response('ok', { status: 200 })
      : json({ ok: false, error: 'invalid-token' }, 401);
  }

  if (!confirm) {
    return json({
      ok: true,
      status: pref.enabled ? 'subscribed' : 'already',
      email: maskEmail(pref.email),
    });
  }

  if (pref.enabled) {
    const { error } = await supabase
      .from('notify_prefs')
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq('user_id', pref.user_id);
    if (error) {
      console.error('unsubscribe-failed', error.message);
      return oneClick
        ? new Response('error', { status: 500 })
        : json({ ok: false, error: 'update-failed' }, 500);
    }
  }

  return oneClick
    ? new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } })
    : json({ ok: true, status: 'unsubscribed', email: maskEmail(pref.email) });
});
