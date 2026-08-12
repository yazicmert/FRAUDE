// FRAUDE — lisans anahtarı teslim e-postası (Brevo üzerinden).
//
// Admin panel bir talebi onayladıktan sonra bu fonksiyonu çağırır; fonksiyon
// talebi service-role ile okur, docs/email-templates/license-key.html ile aynı
// tasarımdaki gövdeyi anahtarla doldurur ve Brevo transactional API'siyle
// gönderir. Başarıda license_requests.emailed_at damgalanır.
//
// Kurulum (CLI bu projeye erişemediğinden pano üzerinden):
//   Dashboard → Edge Functions → Deploy new function → "send-license-email",
//   bu dosyayı editöre yapıştır. Secrets:
//   - BREVO_API_KEY: Brevo panosundan v3 API anahtarı (xkeysib-…). Dikkat:
//     Supabase Auth'taki SMTP anahtarı DEĞİL, ayrı üretilir.
//   - MAIL_FROM: Brevo'da doğrulanmış gönderici, "FRAUDE <adres>" ya da düz
//     adres (Auth SMTP'de kullanılan gönderici uygundur).
// Ayrıntı: docs/email-templates/README.md

import { createClient } from 'npm:@supabase/supabase-js@2';

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** "Bu talebi ben yapmadım" bağlantısı için tek kullanımlık jeton. */
function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

type MailLang = 'tr' | 'en';

/**
 * E-posta metinleri. Tasarım TEK kaynaktır (aşağıdaki HTML); yalnız metinler
 * dile göre seçilir. Dil, talebin yapıldığı arayüzden gelir:
 * license_requests.lang (site: pages/Account.tsx). Bilinmiyorsa 'tr'.
 */
const MAIL_STRINGS = {
  tr: {
    subject: 'FRAUDE Terminal — lisans anahtarın hazır',
    preview: 'Lisans talebin onaylandı — anahtarın ve kurulum adımları içeride.',
    title: 'Lisans anahtarın hazır',
    greeting: (n: string | null) => (n ? `Merhaba ${n},` : 'Merhaba,'),
    intro:
      'FRAUDE Terminal lisans talebin onaylandı. Anahtarın aşağıda — uygulamadaki lisans ekranına yapıştırman yeterli.',
    downloadLabel: 'Uygulamayı indir:',
    mac: 'macOS (Apple&nbsp;Silicon)',
    win: 'Windows&nbsp;(x64)',
    step2: 'Talebi açtığın e-posta adresiyle giriş yap.',
    step3: 'Lisans ekranında anahtarı yapıştır ve etkinleştir.',
    note:
      'Anahtar hesabına bağlanır ve sınırlı sayıda cihazda etkinleştirilebilir. Anahtarını kimseyle paylaşma; sorun yaşarsan bu e-postayı yanıtlaman yeterli.',
    footer: 'FRAUDE Terminal — finansal dostunuz',
    revoke: 'Bu talebi ben yapmadım — anahtarı iptal et',
    revokeFallback: 'Bu talebi sen yapmadıysan bize bu adresten haber ver.',
  },
  en: {
    subject: 'FRAUDE Terminal — your license key is ready',
    preview: 'Your license request was approved — the key and setup steps are inside.',
    title: 'Your license key is ready',
    greeting: (n: string | null) => (n ? `Hello ${n},` : 'Hello,'),
    intro:
      'Your FRAUDE Terminal license request was approved. Your key is below — paste it into the license screen in the app.',
    downloadLabel: 'Download the app:',
    mac: 'macOS (Apple&nbsp;Silicon)',
    win: 'Windows&nbsp;(x64)',
    step2: 'Sign in with the email address you used for the request.',
    step3: 'Paste the key on the license screen and activate it.',
    note:
      'The key is bound to your account and can be activated on a limited number of devices. Do not share it with anyone; if something goes wrong, just reply to this email.',
    footer: 'FRAUDE Terminal — your financial companion',
    revoke: 'I did not make this request — revoke the key',
    revokeFallback: 'If you did not make this request, let us know at this address.',
  },
} as const;

/** Gelen değeri güvenli bir dile çevirir; tanımsız/bozuk değer Türkçeye düşer. */
function toMailLang(value: unknown): MailLang {
  return value === 'en' ? 'en' : 'tr';
}

/** docs/email-templates/license-key.html ile aynı tasarım; anahtar ve ad gömülü. */
function renderEmail(
  licenseKey: string,
  name: string | null,
  revokeUrl: string | null,
  lang: MailLang,
): string {
  const L = MAIL_STRINGS[lang];
  const greeting = L.greeting(name ? escapeHtml(name) : null);
  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>${L.subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0d12;" bgcolor="#0a0d12">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
    ${L.preview}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0a0d12" style="background-color:#0a0d12;">
    <tr>
      <td align="center" style="padding:44px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:100%;">
          <tr>
            <td align="center" style="padding-bottom:26px;font-family:'SF Mono',SFMono-Regular,Menlo,Consolas,'Courier New',monospace;font-size:21px;font-weight:800;letter-spacing:5px;color:#e8f0f7;">
              <span style="color:#00e896;">F</span>RAUDE
            </td>
          </tr>
          <tr>
            <td bgcolor="#10151d" style="background-color:#10151d;border:1px solid #232a33;border-radius:14px;padding:38px 34px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Inter',sans-serif;font-size:21px;font-weight:700;color:#e8f0f7;padding-bottom:14px;">
                    ${L.title}
                  </td>
                </tr>
                <tr>
                  <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Inter',sans-serif;font-size:14.5px;line-height:1.7;color:#b7c2cc;padding-bottom:24px;">
                    ${greeting}<br><br>
                    ${L.intro}
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-bottom:28px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td align="center" bgcolor="#0a0d12" style="background-color:#0a0d12;border:1px solid #232a33;border-radius:10px;padding:20px 12px;font-family:'SF Mono',SFMono-Regular,Menlo,Consolas,'Courier New',monospace;font-size:17px;font-weight:700;letter-spacing:2px;color:#00e896;">
                          ${escapeHtml(licenseKey)}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Inter',sans-serif;font-size:14px;line-height:1.9;color:#b7c2cc;padding-bottom:26px;">
                    <span style="color:#00e896;font-weight:700;">1.</span>
                    ${L.downloadLabel}
                    <a href="https://github.com/yazicmert/FRAUDE/releases/latest/download/FRAUDE-Terminal_macos_arm64.dmg" style="color:#00c3ff;text-decoration:none;">${L.mac}</a>
                    &nbsp;&middot;&nbsp;
                    <a href="https://github.com/yazicmert/FRAUDE/releases/latest/download/FRAUDE-Terminal_windows_x64-setup.exe" style="color:#00c3ff;text-decoration:none;">${L.win}</a><br>
                    <span style="color:#00e896;font-weight:700;">2.</span>
                    ${L.step2}<br>
                    <span style="color:#00e896;font-weight:700;">3.</span>
                    ${L.step3}
                  </td>
                </tr>
                <tr>
                  <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Inter',sans-serif;font-size:12.5px;line-height:1.7;color:#8b949e;border-top:1px solid #232a33;padding-top:22px;">
                    ${L.note}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-top:26px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Inter',sans-serif;font-size:12px;line-height:1.7;color:#8b949e;">
              ${L.footer}
            </td>
          </tr>
          ${revokeUrl ? `<tr>
            <td align="center" style="padding-top:14px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="border:1px solid rgba(255,106,94,0.5);border-radius:8px;">
                    <a href="${revokeUrl}"
                       style="display:inline-block;padding:9px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Inter',sans-serif;font-size:12.5px;font-weight:600;color:#ff6a5e;text-decoration:none;border-radius:8px;">
                      ${L.revoke}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>` : `<tr>
            <td align="center" style="padding-top:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Inter',sans-serif;font-size:12px;line-height:1.7;color:#8b949e;">
              ${L.revokeFallback}
            </td>
          </tr>`}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method-not-allowed' }, 405);

  const brevoKey = Deno.env.get('BREVO_API_KEY');
  const fromRaw = Deno.env.get('MAIL_FROM');
  if (!brevoKey || !fromRaw) return json({ ok: false, error: 'mailer-not-configured' }, 500);

  // MAIL_FROM "Ad <adres>" ya da düz adres olabilir
  const fromMatch = fromRaw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const sender = fromMatch
    ? { name: fromMatch[1].trim() || 'FRAUDE', email: fromMatch[2].trim() }
    : { name: 'FRAUDE', email: fromRaw.trim() };

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Çağıran oturumlu ve admin olmalı (admins tablosu service-role ile okunur)
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !userData.user) return json({ ok: false, error: 'not-authenticated' }, 401);

  const { data: adminRow } = await supabase
    .from('admins')
    .select('user_id')
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (!adminRow) return json({ ok: false, error: 'not-admin' }, 403);

  let requestId: unknown;
  try {
    ({ requestId } = await req.json());
  } catch {
    return json({ ok: false, error: 'bad-request' }, 400);
  }
  if (typeof requestId !== 'string' || !requestId) return json({ ok: false, error: 'bad-request' }, 400);

  const { data: request, error: requestError } = await supabase
    .from('license_requests')
    // `lang` sütunu sonradan eklendi; henüz uygulanmamış bir veritabanında
    // sorgu tümden hata vermesin diye ayrıca ve toleranslı okunur (aşağıda).
    .select('id, email, name, status, delivered_key')
    .eq('id', requestId)
    .maybeSingle();
  if (requestError || !request) return json({ ok: false, error: 'not-found' }, 404);
  if (request.status !== 'approved' || !request.delivered_key) {
    return json({ ok: false, error: 'not-approved' }, 409);
  }

  // Talebin dili: kullanıcı siteyi hangi dilde kullanıyorsa e-posta da o dilde
  // gider. Sütun yoksa (migration uygulanmamış) sorgu hata verir; o durumda
  // Türkçeye düşülür — lisans teslimi dil yüzünden durmamalı.
  const { data: langRow } = await supabase
    .from('license_requests')
    .select('lang')
    .eq('id', requestId)
    .maybeSingle();
  const lang = toMailLang(langRow?.lang);
  const L = MAIL_STRINGS[lang];

  // İptal jetonu: her gönderimde yenilenir (eski mailin bağlantısı geçersizleşir).
  // Kolon yoksa/güncelleme başarısızsa e-posta düğmesiz gönderilir.
  const revokeToken = randomToken();
  const { error: tokenError } = await supabase
    .from('license_requests')
    .update({ revoke_token: revokeToken })
    .eq('id', requestId);
  const siteUrl = Deno.env.get('SITE_URL') ?? 'https://fraude.intelligentverseconnection.com';
  const revokeUrl = tokenError ? null : `${siteUrl}/lisans-iptal?token=${revokeToken}`;

  const brevoResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': brevoKey, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender,
      to: [request.name ? { email: request.email, name: request.name } : { email: request.email }],
      subject: L.subject,
      htmlContent: renderEmail(request.delivered_key, request.name, revokeUrl, lang),
    }),
  });
  if (!brevoResponse.ok) {
    const detail = await brevoResponse.text().catch(() => '');
    console.error('brevo-failed', brevoResponse.status, detail);
    return json({ ok: false, error: 'brevo-failed', detail }, 502);
  }

  await supabase
    .from('license_requests')
    .update({ emailed_at: new Date().toISOString() })
    .eq('id', requestId);

  return json({ ok: true });
});
