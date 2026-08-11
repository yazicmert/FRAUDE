# E-posta teslim edilebilirliği (spam kutusu sorunu)

FRAUDE'den çıkan tüm mailler (Supabase Auth doğrulama/şifre + lisans anahtarı +
market-watch dijesti) **Brevo** üzerinden `intelligentverseconnection.com`
kimliğiyle gidiyor. Bu belge maillerin neden spam'e düştüğünü ve sırayla nelerin
düzeltileceğini tutar. Kod tarafı yapıldı; **DNS ve Brevo panosu adımları elle
yapılmalı** (bu depodan uygulanamaz).

Ölçüm tarihi: 2026-08-11.

## Ölçülen durum

| Kayıt | Değer | Durum |
| --- | --- | --- |
| SPF | `v=spf1 include:_spf.mx.cloudflare.net ~all` | ⚠️ Brevo yok — yalnız Cloudflare **gelen** posta yönlendirmesi |
| DKIM | `brevo1/brevo2._domainkey` → Brevo anahtarları | ✅ kurulu ve çözümleniyor |
| DMARC | `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com` | ⚠️ uygulama yok, rapor bize gelmiyor |
| MX | Cloudflare Email Routing | ✅ |
| MTA-STS / TLS-RPT / BIMI | yok | ⚠️ ileri seviye, sonraya |

Kara liste sorguları (Spamhaus DBL, URIBL) genel DNS çözümleyicisi üzerinden
reddedildi — sonuç **belirsiz**, aşağıdaki adımda elle bakılmalı.

## 1. SPF'e Brevo eklensin (5 dakika, en ucuz kazanç)

Şu an SPF kaydında Brevo yok. Brevo kendi Return-Path'ini kullandığı sürece SPF
teknik olarak "pass" verir ama **From alan adıyla hizalanmaz**; kimlik doğrulama
tek bacağa (DKIM) kalır ve bazı filtreler bunu zayıf sinyal sayar.

Cloudflare DNS'te `intelligentverseconnection.com` TXT kaydını **tek satırda**
şu hâle getir (bir alan adında yalnız bir SPF kaydı olabilir, ikinci kayıt
eklemek ikisini birden geçersiz kılar):

```
v=spf1 include:_spf.mx.cloudflare.net include:spf.brevo.com ~all
```

## 2. DMARC raporları bize de gelsin, sonra sıkılaştır

Önce raporu kendine yönlendir (`p=none` kalsın, 2-4 hafta izle):

```
_dmarc  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@intelligentverseconnection.com, mailto:rua@dmarc.brevo.com; fo=1"
```

Raporlarda tüm meşru gönderim SPF+DKIM geçiyorsa sıkılaştır:

```
_dmarc  TXT  "v=DMARC1; p=quarantine; pct=100; rua=mailto:dmarc@intelligentverseconnection.com; fo=1"
```

`p=quarantine`/`reject` alan adını taklit eden gönderimi keser ve Gmail'in
gönderici karnesinde olumlu sinyaldir. **Adım 1 tamamlanmadan sıkılaştırma.**

## 3. Marka ile alan adı uyuşmazlığı (asıl neden adayı)

Kullanıcı Gmail'de `FRAUDE <...@intelligentverseconnection.com>` görüyor. Marka
"FRAUDE", alan adı ilgisiz ve jenerik bir kelime dizisi; üstelik gönderim
geçmişi yok (yeni alan adı = itibar yok). Bu, içerik kusursuz olsa bile
başlangıçta spam'e düşmenin en yaygın nedenidir. Ek olarak ürün adının
"fraud"a benzemesi, finans/lisans anahtarı içeriğiyle birleşince filtrelerde
dezavantaj yaratır.

Öneri sırası:

1. **Markalı bir alan adı al** (ör. `fraude.app`, `fraude.com.tr`) ve hem site
   hem gönderim kimliği oraya taşınsın. En yüksek getirili adım.
2. Taşıma yapılmayacaksa en azından **gönderim alt alan adı ayır**:
   - `mail.intelligentverseconnection.com` → işlemsel (lisans, Auth)
   - `notify.intelligentverseconnection.com` → dijest
   Her biri Brevo'da ayrı doğrulanır; birinin itibarı diğerini batırmaz.
3. `noreply@` yerine **izlenen** bir adres kullan (`bildirim@`, `destek@`).
   Kod artık `REPLY_TO_EMAIL` secret'ı varsa Reply-To ekliyor.

## 4. İşlemsel ve toplu akışları ayır

Bugün lisans anahtarı maili (kritik, kullanıcı bekliyor) ile 10 dakikada bir
gidebilen dijest aynı alan adı ve aynı paylaşımlı IP havuzunda. Dijest şikâyet
alırsa lisans maili de düşer. Ayrım için ya adım 3.2'deki alt alan adları ya da
Brevo'da ayrı gönderim akışı kullanılmalı.

## 5. Dijest sıklığı (ürün kararı — kod değişikliği gerekir)

`market-watch` cron'u `*/10 10-18 * * 1-5`: kullanıcı başına günde teorik olarak
48 ayrı mail. Yüksek hacim + düşük açılma oranı = itibar düşüşü, ayrıca kullanıcı
"spam" düğmesine basmaya yaklaşır. Önerilen: önem 5 olanlar anında, kalanlar
saatlik ya da günlük tek özet. `notify_prefs`'e sıklık alanı eklenerek
kullanıcıya bırakılabilir.

## 6. Brevo panosu ve ops

- **Gönderici doğrulaması**: `MAIL_FROM` adresi Brevo'da doğrulanmış olmalı;
  alan adı "Authenticated" görünmeli (DKIM yeşil).
- **Supabase Auth SMTP**: Authentication → SMTP Settings gerçekten Brevo'yu
  göstermeli. Supabase'in varsayılan SMTP'si (`mail.app.supabase.io`) kullanılırsa
  doğrulama/şifre mailleri neredeyse kesin spam'e düşer. From adresi de yukarıdaki
  doğrulanmış alan adıyla aynı olmalı.
- **Bounce/şikâyet temizliği**: bugün yok. Sert dönen (hard bounce) adreslere
  göndermeye devam etmek itibarın en hızlı yıkılma yoludur. Brevo webhook'u
  (`hard_bounce`, `spam`, `unsubscribed`) → `notify_prefs.enabled = false`
  yapacak küçük bir Edge Function eklenmeli. **Yapılacak.**
- **Google Postmaster Tools**: `intelligentverseconnection.com` kaydedilmeli;
  Gmail'deki alan adı itibarı ve şikâyet oranı ancak oradan görülür. Şikâyet
  oranı %0.3'ün altında tutulmalı.
- **Isındırma (warm-up)**: yeni alan adından günde birkaç yüz mailden fazlası
  birden gönderilmemeli; hacim 2-4 haftaya yayılarak artırılmalı.
- **Kara liste kontrolü**: mxtoolbox.com/blacklists ve Spamhaus'ta alan adı elle
  sorgulanmalı (bu depodan yapılan sorgular genel çözümleyici üzerinden reddedildi).

## 7. Kodda yapılanlar (bu değişiklik)

- **Düz metin alternatifi** — dijest, lisans ve admin maillerine `textContent`
  eklendi. Yalnız-HTML gövde klasik bir spam sinyalidir.
- **RFC 8058 tek tıkla abonelikten çıkma** — dijest artık `List-Unsubscribe` ve
  `List-Unsubscribe-Post` başlıklarıyla gidiyor. Gmail/Yahoo toplu gönderici
  kuralları bunu şart koşuyor; başlık yokken kullanıcının tek çıkışı "spam"
  düğmesidir ve şikâyet oranı doğrudan itibarı düşürür.
- **Görünür abonelik iptali** — dijest altbilgisinde "Bu bildirimleri durdur"
  bağlantısı; sitede `/bildirim-iptal` onay sayfası.
- **Reply-To** — `REPLY_TO_EMAIL` secret'ı tanımlıysa tüm mailler yanıtlanabilir
  adres taşır.

Yeni uç: `supabase/functions/notify-unsubscribe` (kimlik = `notify_prefs.feed_token`).

```
supabase functions deploy notify-unsubscribe --no-verify-jwt --use-api
supabase functions deploy market-watch --no-verify-jwt --use-api
supabase functions deploy send-license-email --use-api
supabase functions deploy report-license-abuse --no-verify-jwt --use-api
```

Yeni secret (opsiyonel ama önerilir): `REPLY_TO_EMAIL`.

## 8. Doğrulama

1. Kendine bir dijest ve bir lisans maili gönder; Gmail'de **Show original** ile
   `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS` üçünü de gör.
2. mail-tester.com'a gönderip 10 üzerinden puan al (8+ hedef).
3. Gmail'de mailin üstünde "Unsubscribe" bağlantısının çıktığını doğrula — bu,
   `List-Unsubscribe` başlığının okunduğunu gösterir.
