// FRAUDE — Uygulama İçi Telegram Eşleştirme Kodu Üretici
// ─────────────────────────────────────────────────────────────────────────────
// Masaüstü veya web uygulamasından çağrılır; 6 haneli rastgele kod üretir,
// veritabanına yazar ve kullanıcının e-posta adresine de mail atar.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { renderPairingEmailHtml, sendViaPlatform } from '../_shared/mailer.ts';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method-not-allowed' }, 405);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── Kimlik Doğrulama ───────────────────────────────────────────────────────
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !userData.user) return json({ ok: false, error: 'not-authenticated' }, 401);
  const user = userData.user;
  const email = user.email;
  if (!email) return json({ ok: false, error: 'no-email-on-account' }, 400);

  // ── 6 Haneli Kod Üret (5 dakika geçerli) ──────────────────────────────────
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  // Eski kullanılmamış kodları geçersiz kıl
  await supabase
    .from('telegram_link_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('used_at', null);

  // Yeni kodu kaydet
  const { error: insertError } = await supabase.from('telegram_link_codes').insert({
    user_id: user.id,
    email: email,
    code,
    expires_at: expiresAt,
  });

  if (insertError) {
    return json({ ok: false, error: insertError.message }, 500);
  }

  // Kullanıcının e-postasına da kodu gönder (uygulama kapansa bile e-postadan görsün)
  sendViaPlatform({
    to: email,
    subject: `FRAUDE Telegram Eşleştirme Kodunuz: ${code}`,
    html: renderPairingEmailHtml(code),
  }).catch(() => {});

  return json({
    ok: true,
    code,
    expires_at: expiresAt,
    email,
    bot_username: 'FraudeTerminalBot',
    bot_url: 'https://t.me/FraudeTerminalBot',
  });
});
