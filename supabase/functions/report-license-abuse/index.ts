// FRAUDE — "Bu talebi ben yapmadım" bildirimi.
//
// Lisans e-postasının altındaki düğme buraya tek kullanımlık jetonla gelir.
// GET: onay sayfası gösterir (e-posta tarayıcıları bağlantıları otomatik
// açabildiğinden tek tıkla iptal YAPILMAZ). Onay formu POST edilince:
//   1) delivered_key'in SHA-256 özetiyle licenses satırı bulunup revoke edilir,
//   2) license_requests.abuse_reported_at damgalanır (jeton tek kullanımlık),
//   3) yöneticiye (ADMIN_EMAIL, yoksa MAIL_FROM adresi) Brevo ile bildirim gider.
//
// Kurulum: alıcı oturumsuz olduğundan JWT doğrulaması KAPALI deploy edilir:
//   supabase functions deploy report-license-abuse --no-verify-jwt --use-api
// Secrets: BREVO_API_KEY, MAIL_FROM (send-license-email ile ortak), ADMIN_EMAIL (ops.)

import { createClient } from 'npm:@supabase/supabase-js@2';

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

/** Marka dilinde küçük bir sonuç/onay sayfası. */
function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FRAUDE — ${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0d12;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Inter',sans-serif;">
  <div style="max-width:460px;margin:40px 16px;text-align:center;">
    <div style="font-family:'SF Mono',SFMono-Regular,Menlo,Consolas,monospace;font-size:21px;font-weight:800;letter-spacing:5px;color:#e8f0f7;margin-bottom:24px;"><span style="color:#00e896;">F</span>RAUDE</div>
    <div style="background:#10151d;border:1px solid #232a33;border-radius:14px;padding:34px 30px;">
      <div style="font-size:19px;font-weight:700;color:#e8f0f7;margin-bottom:12px;">${escapeHtml(title)}</div>
      <div style="font-size:14px;line-height:1.7;color:#b7c2cc;">${body}</div>
    </div>
  </div>
</body>
</html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function maskKey(key: string): string {
  return key.replace(/^(FRAUDE-[^-]{4})-.*-([^-]{4})$/, '$1-••••-••••-$2');
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let token: string | null = null;
  if (req.method === 'GET') token = url.searchParams.get('token');
  else if (req.method === 'POST') token = String((await req.formData()).get('token') ?? '') || null;
  else return page('Geçersiz istek', 'Bu adres yalnız e-postadaki bağlantıyla kullanılır.', 405);

  if (!token || !/^[0-9a-f]{64}$/.test(token)) {
    return page('Bağlantı geçersiz', 'Bu bağlantı hatalı ya da eksik. E-postadaki düğmeyi kullan.', 400);
  }

  const { data: request } = await supabase
    .from('license_requests')
    .select('id, email, name, delivered_key, abuse_reported_at, created_at')
    .eq('revoke_token', token)
    .maybeSingle();
  if (!request || !request.delivered_key) {
    return page('Bağlantı geçersiz', 'Bu bağlantının süresi dolmuş ya da daha yeni bir e-posta gönderilmiş. Sorun sürerse lisans e-postasını yanıtlayarak bize ulaş.', 404);
  }
  if (request.abuse_reported_at) {
    return page('Bildirim zaten alınmış', 'Bu talep daha önce bildirilmiş ve anahtar iptal edilmişti. Ek bir şey yapmana gerek yok.');
  }

  if (req.method === 'GET') {
    return page(
      'Bu talebi sen mi yapmadın?',
      `<span style="color:#e8f0f7;font-weight:600;">${escapeHtml(request.email)}</span> adresine
       <span style="font-family:monospace;color:#00e896;">${escapeHtml(maskKey(request.delivered_key))}</span>
       anahtarı gönderildi. Aşağıdaki düğmeye basarsan anahtar <span style="color:#ff6a5e;">kalıcı olarak iptal edilir</span>
       ve yönetici bilgilendirilir.<br><br>
       <form method="post" action="${url.pathname}">
         <input type="hidden" name="token" value="${token}">
         <button type="submit" style="background:none;border:1px solid rgba(255,106,94,0.6);border-radius:8px;padding:11px 24px;color:#ff6a5e;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;">
           Evet, bu talebi ben yapmadım — anahtarı iptal et
         </button>
       </form>`,
    );
  }

  // POST: iptal + damga + yönetici bildirimi
  const keyHash = await sha256Hex(request.delivered_key);
  const { error: revokeError } = await supabase
    .from('licenses')
    .update({ status: 'revoked' })
    .eq('key_hash', keyHash);
  if (revokeError) {
    console.error('revoke-failed', revokeError.message);
    return page('Bir sorun oluştu', 'Anahtar iptal edilemedi. Lütfen lisans e-postasını yanıtlayarak bize ulaş.', 500);
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

  return page(
    'Anahtar iptal edildi',
    'Bildirimin alındı: anahtar kalıcı olarak iptal edildi ve yönetici bilgilendirildi. Hesabının güvenliğinden şüpheleniyorsan şifreni de yenilemeni öneririz.',
  );
});
