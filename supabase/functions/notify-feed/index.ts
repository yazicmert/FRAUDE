// FRAUDE — bildirim beslemesi: Chrome eklentisi bu uçtan kullanıcının son
// sunucu bildirimlerini (KAP/SPK/haber) çeker ve masaüstü uygulaması kapalıyken
// bile Chrome bildirimi olarak gösterir.
//
// Kimlik = feed_token (notify_prefs.feed_token). Kullanıcı bu anahtarı web
// /hesap ya da uygulamadaki Bildirimler modülünden kopyalayıp eklenti
// ayarlarına yapıştırır. Supabase oturumu gerektirmez (eklentide oturum yok).
//
// GET /notify-feed?token=<feed_token>&since=<ISO|ms>
//   → { ok:true, account:"e@posta", items:[{id,source,priority,title,summary,
//        tickers,url,created_at}] }  (en yeni → en eski, en çok 50)
//
// Kurulum: supabase functions deploy notify-feed --no-verify-jwt --use-api
// (Gizli anahtar gerekmez; SUPABASE_URL + SERVICE_ROLE_KEY otomatik gelir.)

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = new URL(req.url);
  const token = (url.searchParams.get('token') ?? '').trim();
  if (!token || token.length < 16) return json({ ok: false, error: 'missing-token' }, 400);

  // since: ISO tarih ya da epoch ms; yoksa son 7 gün.
  const sinceRaw = url.searchParams.get('since') ?? '';
  let since: Date;
  if (/^\d+$/.test(sinceRaw)) since = new Date(Number(sinceRaw));
  else if (sinceRaw) since = new Date(sinceRaw);
  else since = new Date(Date.now() - 7 * 864e5);
  if (Number.isNaN(since.getTime())) since = new Date(Date.now() - 7 * 864e5);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: pref } = await supabase
    .from('notify_prefs')
    .select('user_id, email, enabled')
    .eq('feed_token', token)
    .maybeSingle();

  if (!pref) return json({ ok: false, error: 'invalid-token' }, 401);
  if (!pref.enabled) return json({ ok: true, account: pref.email, items: [] });

  const { data: rows, error } = await supabase
    .from('notify_deliveries')
    .select('id, source, priority, title, summary, tickers, url, created_at')
    .eq('user_id', pref.user_id)
    .gt('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return json({ ok: false, error: error.message }, 500);

  return json({ ok: true, account: pref.email, items: rows ?? [] });
});
