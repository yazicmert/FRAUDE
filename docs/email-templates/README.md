# FRAUDE e-posta şablonları

Uygulama/site marka diliyle (koyu zemin, yeşil vurgu, mono wordmark) hazırlanmış,
e-posta istemcilerine dayanıklı (tablo düzeni + inline stil) üç şablon. Tarayıcıda
açıp önizleyebilirsin.

| Dosya | Ne zaman gider | Nereye kurulur |
| --- | --- | --- |
| `confirm-signup.html` | Kayıt sonrası doğrulama | Supabase panosu → Authentication → Emails → **Confirm sign up** |
| `reset-password.html` | Şifre yenileme talebi | Supabase panosu → Authentication → Emails → **Reset password** |
| `license-key.html` | Lisans talebi onaylanınca | `send-license-email` Edge Function otomatik gönderir (aşağıda); bu dosya elle gönderim için yedek — **yalnız Türkçe**, canlı gönderim iki dillidir |

## Dil: kullanıcı hangi dilde kullanıyorsa o dilde gider

Şablonlar TR ve EN'i **tek dosyada** taşır; tasarım ortaktır, yalnız metinler
Go template koşullarıyla dallanır. Dil sinyali her akışta farklıdır:

| E-posta | Dil nereden gelir | Kim yazar |
| --- | --- | --- |
| Kayıt doğrulama | `user_metadata.lang` → şablonda `.Data.lang` | Kayıt anında site (`pages/SignIn.tsx`) ve uygulama (`features/auth/session.ts`) |
| Şifre yenileme | `redirect_to` adresindeki `?lang=` → şablonda `.RedirectTo` | Site (`pages/SignIn.tsx`); kullanıcı oturum açmadığı için istek anındaki tek sinyal budur. Adres tanınmazsa `.Data.lang`'e düşer |
| Lisans anahtarı | `license_requests.lang` sütunu | Talep anında site (`pages/Account.tsx`); e-postayı Edge Function render eder |

Değer yoksa **Türkçe** gösterilir. Kullanıcı arayüz dilini değiştirdiğinde
tercih hesaba da yazılır (site `lib/i18n.tsx` → `updateUser`), böylece sonraki
e-postalar yeni dilde gelir.

Şifre yenilemenin `?lang=tr` ve `?lang=en` adresleri **Redirect URLs
allowlist'inde bulunmalıdır** (joker yok, iki tam adres) — yoksa GoTrue adresi
düşürür ve akış kırılır. Karşılığı `supabase/config.toml` içinde de yazılıdır.

## Supabase şablonları (kayıt + şifre)

Uygulanışı elle DEĞİL betikle yapılır — depo ile pano ayrışmasın:

```
node scripts/apply-email-templates.mjs            # uygular ve geri okuyup doğrular
node scripts/apply-email-templates.mjs --dry-run  # yalnız ne yazılacağını gösterir
```

Betik gövdeleri bu dizinden okur, konu satırlarını da (dile göre dallanan)
kendisi yazar ve yazdıktan sonra karşılaştırıp doğrular. Erişim jetonunu
`SUPABASE_ACCESS_TOKEN`'dan ya da macOS anahtar zincirindeki `supabase login`
kaydından alır. Elle yapmak gerekirse: Authentication → Emails → ilgili
şablonun **Message body** alanına dosyanın tamamı yapıştırılır.

`{{ .ConfirmationURL }}` ve `{{ .Email }}` değişkenlerini Supabase doldurur —
Go template sözdizimidir, aynen kalmalı. Konu satırları da templatelenir
(GoTrue'nun kendi varsayılanı `{{ .Token }} is your verification code`).

Yönlendirme zinciri şablona gömülü değildir, `ConfirmationURL` içindeki
`redirect_to`'dan gelir:

- Masaüstünden kayıt → `fraude://auth-callback` (bkz. `src/features/auth/deepLink.ts`)
- Masaüstünden GitHub OAuth → `fraude://auth-callback` (sistem tarayıcısı uygulamaya geri döner)
- Siteden şifre yenileme → `<site-origin>/sifre-yenile`

Bu yönlendirmeler panodaki **Redirect URLs allowlist**'te olmalı. GitHub girişi
için Authentication → Providers altındaki GitHub sağlayıcısı da etkin kalmalı;
site ve masaüstü aynı sağlayıcıyı kullanır. E-postalar Auth → SMTP ayarındaki
sunucudan çıkar. Not: pano bu hesaptaki `supabase` CLI'da görünmez, işlemler
elle yapılır.

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
