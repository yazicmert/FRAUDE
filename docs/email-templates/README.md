# FRAUDE e-posta şablonları

Uygulama/site marka diliyle (koyu zemin, yeşil vurgu, mono wordmark) hazırlanmış,
e-posta istemcilerine dayanıklı (tablo düzeni + inline stil) üç şablon. Tarayıcıda
açıp önizleyebilirsin.

| Dosya | Ne zaman gider | Nereye kurulur |
| --- | --- | --- |
| `confirm-signup.html` | Kayıt sonrası doğrulama | Supabase panosu → Authentication → Emails → **Confirm sign up** |
| `reset-password.html` | Şifre yenileme talebi | Supabase panosu → Authentication → Emails → **Reset password** |
| `license-key.html` | Lisans talebi onaylanınca | `send-license-email` Edge Function otomatik gönderir (aşağıda); bu dosya elle gönderim için yedek |

## Supabase şablonları (kayıt + şifre)

1. Panoda (proje `frfbmutvkekctpacktlz`) Authentication → Emails bölümünü aç.
2. İlgili şablonun **Message body** alanına HTML dosyasının tamamını yapıştır.
3. Konu satırları:
   - Confirm sign up: `FRAUDE Terminal — hesabını doğrula`
   - Reset password: `FRAUDE Terminal — şifreni yenile`
4. `{{ .ConfirmationURL }}` ve `{{ .Email }}` değişkenlerini Supabase doldurur —
   Go template sözdizimidir, aynen kalmalı.

Yönlendirme zinciri şablona gömülü değildir, `ConfirmationURL` içindeki
`redirect_to`'dan gelir:

- Masaüstünden kayıt → `fraude://auth-callback` (bkz. `src/features/auth/deepLink.ts`)
- Siteden şifre yenileme → `<site-origin>/sifre-yenile`

İkisi de panodaki **Redirect URLs allowlist**'te olmalı; e-postalar Auth → SMTP
ayarındaki sunucudan çıkar. Not: pano bu hesaptaki `supabase` CLI'da görünmez,
işlemler elle yapılır.

## Lisans anahtarı — Edge Function + Brevo

Admin panelde onay verilince `Admin.tsx` `send-license-email` fonksiyonunu
çağırır; fonksiyon talebi service-role ile okur, anahtarı şablona gömüp Brevo
transactional API'siyle gönderir ve `license_requests.emailed_at` damgalar.
Onaylı satırlarda "E-posta gönder / Yeniden gönder" düğmesi vardır; e-posta
hatası onayı bozmaz. (Auth e-postaları Brevo SMTP'den, bu fonksiyon aynı
hesabın HTTP API'sinden çıkar — gönderici aynı olabilir.)

E-postanın altındaki **"Bu talebi ben yapmadım — anahtarı iptal et"** düğmesi
tek kullanımlık jetonla sitedeki `/lisans-iptal` onay sayfasına gider (Supabase
`*.supabase.co`'dan HTML sunumunu text/plain'e çevirdiğinden sayfa fonksiyonda
DEĞİL sitededir). Sayfa `report-license-abuse` fonksiyonunu (JSON API) çağırır:
onaylanınca anahtar revoke edilir, talep `abuse_reported_at` ile damgalanır
(panelde kırmızı "İptal bildirimi" rozeti) ve `ADMIN_EMAIL` secret'ındaki
adrese (yoksa `MAIL_FROM` adresine) bildirim maili gider. Fonksiyon alıcı
oturumsuz olduğundan `--no-verify-jwt` ile deploy edilir; eski maillerdeki
doğrudan fonksiyon bağlantıları 302 ile siteye yönlenir.

Kanonik şablon fonksiyonun içindedir
(`supabase/functions/send-license-email/index.ts` → `renderEmail`);
`license-key.html` elle gönderim yedeğidir — tasarım değişirse **ikisini birden**
güncelle. İndirme bağlantıları `site/src/lib/download.ts` ile aynı sabit release
asset adlarıdır; adlar değişirse ikisinde de güncellenmeli.

Kurulum (CLI bu projeye erişemediğinden hepsi panodan, bir kez):

1. **SQL**: `docs/supabase-site.sql`'i SQL Editor'da yeniden çalıştır
   (`emailed_at` sütunu + `admin_list_requests` güncellemesi; tekrar güvenli).
2. **Brevo API anahtarı**: Brevo panosu → Settings → API Keys → yeni v3 anahtarı
   (`xkeysib-…`). Dikkat: Supabase Auth'taki **SMTP anahtarı bu değildir**, ayrı
   üretilir. Gönderici adresi Brevo'da doğrulanmış olmalı — Auth SMTP'de
   kullandığın gönderici hazır ve uygundur.
3. **Fonksiyon**: Dashboard → Edge Functions → Deploy new function →
   ad `send-license-email`, `supabase/functions/send-license-email/index.ts`
   içeriğini editöre yapıştır. "Verify JWT" açık kalabilir; fonksiyon ayrıca
   `admins` tablosundan admin kontrolü yapar.
4. **Secrets**: Edge Functions → Secrets: `BREVO_API_KEY` ve `MAIL_FROM`
   (örn. `FRAUDE <lisans@domain>` ya da düz adres) — ikisi de zorunlu.
