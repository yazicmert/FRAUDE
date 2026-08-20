# Bildirim kuyruğu ve kullanıcı gönderim kanalları

Bu belge iki değişikliği kapsar:

1. **Kuyruk** — bildirim mailleri artık tespit turunun içinde değil, ayrı bir
   gönderici fonksiyonda gönderiliyor.
2. **Gönderim kanalı (transport)** — kullanıcı bildirimlerinin kendi
   altyapısından çıkmasını seçebiliyor.

Teslim edilebilirlik (spam kutusu) sorunu **bu belgenin konusu değildir**; onun
için `docs/email-deliverability.md`'deki DNS adımları gerekir. Aşağıdaki hiçbir
şey SPF/DMARC işinin yerine geçmez.

## 1. Neden kuyruk

Önceden `market-watch` maili tespit döngüsünün içinde tek tek `await` ediyordu.
İki sonucu vardı:

- Tek bir yavaş ya da yanıt vermeyen alıcı sunucusu tüm turu wall-clock
  sınırına sürüklüyor, `notify_seen` imleçleri ilerlemiyordu. İmleç ilerlemeyince
  bir sonraki tur aynı KAP kayıtlarını yeniden işliyordu.
- Gönderim başarısız olduğunda yeniden deneme yoktu; bildirim sessizce
  kayboluyordu.

Yeni akış:

```
market-watch (~10 dk)          mail-dispatch (1 dk)
  KAP/SPK/haber çek              claim_outbox_batch (SKIP LOCKED)
  Qwen ile önceliklendir    →    kanalı seç → gönder
  eşleştir                       başarı  → sent
  notify_deliveries + outbox     geçici hata → üstel geri çekilme
  imleçleri ilerlet              kalıcı hata → failed
```

`market-watch` artık ağ gecikmesinden bağımsız: yalnız veritabanına yazar.

### Yan etki: eklenti beslemesi düzeldi

`notify_deliveries` tablosuna **hiçbir zaman yazılmıyordu**, dolayısıyla
`notify-feed` (Chrome eklentisi) her zaman boş dönüyordu. `notify_prefs`
süzgeci (`market-watch/index.ts` içindeki `matchPrefs`) bu değişiklikle
uygulandı; tablo artık doluyor.

Kullanıcı başına tur limiti `MAX_PREF_MAILS_PER_RUN = 10`. Süzgeç tanımlamamış
bir kullanıcı ("Hepsi (1+)") bu sınıra çabuk gelir, kalan öğeleri uygulama içi
beslemeden görür. Sınır hem kullanıcıyı hem kuyruğu `öğe × kullanıcı`
çarpımından korur.

## 2. Gönderim kanalları

| kind | Ne yapar | Kimlik bilgisi |
| --- | --- | --- |
| `platform` | FRAUDE'nin Brevo hesabı. Varsayılan ve **daima yedek**. | yok |
| `webhook` | Bildirim JSON'u kullanıcının https ucuna POST edilir. Maile hiç dönüşmez. | isteğe bağlı imzalama sırrı |
| `api` | Kullanıcının Resend / Brevo / Postmark anahtarıyla mail gönderilir. | API anahtarı (şifreli) |

`platform` hiçbir koşulda devre dışı bırakılmaz: kullanıcının kendi kanalı
bozulduğunda ona bunu haber verecek yol da odur.

### Ham SMTP neden yok

Bilinçli bir karar:

- SMTP şifresi çoğu sağlayıcıda **posta kutusunun tamamına** gönderim yetkisi
  verir; API anahtarı yalnız gönderim yetkilidir ve tek tıkla iptal edilir.
- SMTP durumlu, çok gidiş-dönüşlü bir protokoldür (EHLO → STARTTLS → AUTH →
  MAIL FROM → RCPT → DATA → QUIT). Kullanıcı başına saniyeler süren el sıkışma,
  kuyruk turunu yine ağa bağımlı kılardı.
- Üçüncü taraf kimlik bilgisi saklamak KVKK/GDPR açısından aydınlatma metnine
  girmesi gereken bir sorumluluktur.

Kurumsal bir müşteri özellikle ham SMTP isterse, eklenecek yer
`_shared/mailer.ts` içindeki `sendWithTransport` — ama o noktada aşağıdaki
güvenlik listesinin tamamı zorunludur, isteğe bağlı değil.

### Gönderici adresi taklidi

`from_email`'i biz doğrulamıyoruz; sağlayıcı doğruluyor. Resend, Postmark ve
Brevo üçü de doğrulanmamış alan adından gönderimi reddeder, bu yüzden test
gönderimi geçmeyen kanal `verified_at` alamaz ve kullanılmaz. Ayrıca bu kanal
yalnız kullanıcının **kendi** adresine (`notify_prefs.email`) mail atar — yanlış
yapılandırmanın etki alanı kullanıcının kendisidir.

### SSRF koruması

`webhook_url` alanına yazılan her şeye Supabase altyapısı bağlanır. Korumasız
bırakılırsa bu uç, iç ağ ve bulut metadata servisleri için bir tarayıcıya
dönüşür. `assertSafeWebhookUrl` üç katman uygular:

1. Yalnız `https`, yalnız 443.
2. IP literali (özel aralıklar), `localhost`, `*.local`, `*.internal`,
   `metadata.google.internal` reddedilir.
3. Ad çözülebiliyorsa çözülen A/AAAA kayıtları da aynı süzgeçten geçer.

Ek olarak gönderimde **yönlendirme takip edilmez** (`redirect: 'manual'`) —
aksi hâlde herkese açık bir adres 302 ile `169.254.169.254`'e çevirebilirdi.
Kaydetme uçlarında 15 saniyelik hız sınırı var; zamanlama üzerinden port
taramasını anlamsız kılar.

**Bilinen boşluk:** `Deno.resolveDns` her çalışma zamanında açık değil. Çözüm
başarısız olursa 3. katman atlanır ve yalnız literal kontrolleri kalır (DNS
rebinding penceresi). Webhook gövdesinde kullanıcı verisi taşımadığımız için
kabul edildi.

### Sır saklama

- Sırlar `notify_transport_secrets` tablosunda, **RLS açık ve hiçbir policy
  yok**: sahibi dahil kimse `select` edemez. Arayüz "kayıtlı" yazar, yalnız
  değiştirmeye izin verir.
- İçerik ayrıca AES-GCM ile şifrelenir. Anahtar (`MAIL_CRED_KEY`) Edge Function
  secret'ındadır, veritabanında değil — bir veritabanı dökümü tek başına
  anahtarları açmaya yetmez.
- `notify_transports` yazılabilir değildir (yalnız `select` policy'si var).
  Yazma `transport-config` fonksiyonundan geçer.
- Hata metinleri veritabanına yazılmadan önce `scrubError` ile süzülür;
  sağlayıcılar gönderdiğimiz anahtarı hata gövdesinde geri yansıtabiliyor.

## 3. Kurulum

### Secrets

| Ad | Nerede kullanılır | Not |
| --- | --- | --- |
| `BREVO_API_KEY` | mail-dispatch, transport-config | mevcut |
| `MAIL_FROM` | mail-dispatch | mevcut |
| `CRON_SECRET` | market-watch, mail-dispatch | mevcut |
| `MAIL_CRED_KEY` | mail-dispatch, transport-config | **yeni** |
| `MAIL_CRED_KEY_VERSION` | aynı | isteğe bağlı, varsayılan `1` |

Şifreleme anahtarını üret (base64, 32 bayt):

```bash
openssl rand -base64 32
```

### Migration

`supabase/migrations/20260818000006_notify_outbox_and_transports.sql` — Supabase
Dashboard → SQL Editor'a yapıştırıp çalıştırın. Tekrar çalıştırmak güvenlidir.

### Deploy

```bash
supabase functions deploy mail-dispatch --no-verify-jwt --use-api
```

```bash
supabase functions deploy transport-config --use-api
```

```bash
supabase functions deploy market-watch --no-verify-jwt --use-api
```

`transport-config` JWT doğrulaması İLE gider (kullanıcı oturumu gerekir);
diğer ikisi cron tarafından `x-cron-secret` ile çağrılır.

### Cron

SQL Editor'da:

```sql
select cron.schedule('mail-dispatch', '* * * * *', $$
  select net.http_post(
    url := 'https://emrusyelfekcfyisfzzl.supabase.co/functions/v1/mail-dispatch',
    headers := '{"x-cron-secret":"<CRON_SECRET>"}'::jsonb
  );
$$);
```

## 4. Webhook sözleşmesi (kullanıcıya anlatılacak kısım)

Gövde:

```json
{
  "type": "fraude.notification",
  "timestamp": "1755500000",
  "to": "kullanici@ornek.com",
  "subject": "📢 FRAUDE KAP: ...",
  "source": "kap",
  "priority": 4,
  "title": "...",
  "summary": "...",
  "tickers": ["THYAO"],
  "url": "https://www.kap.org.tr/tr/Bildirim/123456"
}
```

Başlıklar: `X-Fraude-Timestamp` ve (sır tanımlıysa) `X-Fraude-Signature:
sha256=<hex>`. İmza `HMAC-SHA256(sır, "<timestamp>.<ham gövde>")`.

Node ile doğrulama:

```js
const expected = 'sha256=' + crypto.createHmac('sha256', secret)
  .update(`${req.headers['x-fraude-timestamp']}.${rawBody}`).digest('hex');
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers['x-fraude-signature']));
```

2xx dönmeyen yanıt hata sayılır. 3xx **kabul edilmez** (yönlendirme takip
edilmiyor). 4xx kalıcı hata sayılır ve yeniden denenmez; 408/429/5xx geçici
sayılır ve geri çekilmeyle tekrarlanır.

## 5. Hata yönetimi

- Deneme sınırı `MAX_ATTEMPTS = 5`, geri çekilme 1 → 5 → 15 → 60 dakika.
- Kullanıcının kanalı üst üste `FAILURES_BEFORE_DISABLE = 5` hata verirse
  `disabled_at` damgalanır, bildirimler platform'a düşer ve kullanıcıya durum
  **platform kanalından** bildirilir (bozuk kanaldan "kanalın bozuk" demek
  anlamsız olurdu). Başarılı tek gönderim sayacı sıfırlar.
- Dispatcher tur ortasında ölürse satırlar `sending` durumunda asılı kalır;
  `reap_stuck_outbox` 5 dakika sonra onları bekleyene döndürür. `attempts`
  zaten artmış olduğu için sonsuz döngü oluşmaz.
- Üst üste binen cron turları `claim_outbox_batch` (`FOR UPDATE SKIP LOCKED`)
  sayesinde aynı maili iki kez göndermez.

Kuyruğun sağlığına bakmak için:

```sql
select status, count(*), max(attempts) from public.notify_outbox group by status;
```

Takılmış kanalları görmek için:

```sql
select user_id, kind, failure_count, disabled_at, last_error
from public.notify_transports where disabled_at is not null;
```

## 6. Anahtar rotasyonu

1. Yeni anahtarı üret, `MAIL_CRED_KEY_V2` olarak ekle.
2. `MAIL_CRED_KEY_VERSION=2` yap.
3. Eski anahtarı (`MAIL_CRED_KEY`) **silme** — mevcut satırlar `key_version=1`
   ile okunmaya devam eder.
4. Kullanıcılar anahtarlarını bir dahaki kaydedişlerinde yeni sürüme geçer.
   Tüm satırlar geçtiğinde (`select distinct key_version from
   public.notify_transport_secrets`) eski anahtar kaldırılabilir.

## 7. Temizlik (henüz yapılmadı)

`notify_outbox` sınırsız büyür. Gönderilmiş satırlar için bir saklama
politikası gerekiyor, örneğin:

```sql
delete from public.notify_outbox
where status in ('sent', 'failed') and created_at < now() - interval '30 days';
```

Bunu bir cron'a bağlamak açık iş olarak duruyor.
