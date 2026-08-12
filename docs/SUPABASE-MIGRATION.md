# Supabase proje taşıması — `frfbmutvkekctpacktlz` → `emrusyelfekcfyisfzzl`

Bu kılavuz FRAUDE'nin tüm Supabase altyapısını yeni projeye taşır: şema, veri,
kimlik doğrulama, Edge Function'lar, mail altyapısı ve zamanlama. Sırayla
uygulanmalıdır — her adım bir öncekine dayanır.

> **Neden elle adımlar var:** eski proje (`frfbmutvkekctpacktlz`) bu makinedeki
> `supabase` CLI hesabında **görünmüyor**; CLI yalnız yeni projeyi yönetebiliyor.
> Eski taraftan okuma service-role anahtarıyla (`scripts/.env`) yapılır.

---

## DURUM — 2026-08-12

Taşımanın **veri ve altyapı tarafı bitti**. Yeni proje canlıya alınmaya hazır
değil: aşağıdaki "kalanlar" tamamlanmadan istemci yayınlanmamalı.

### Yapıldı

| Adım | Sonuç |
| --- | --- |
| Şema | 4 migration uygulandı — 8 tablo, 14 RPC (eski projede olmayan `license_overview` + `release_device` dahil) |
| Edge Function | 5'i de dağıtıldı ve ACTIVE (`market-watch`, `notify-feed`, `refresh-bist-universe` `verify_jwt=false`; `send-license-email`, `report-license-abuse` `verify_jwt=true`) |
| Auth kullanıcıları | 6/6 — UUID'ler korundu |
| Tablo verisi | `bist_tickers` 796, `licenses` 13, `license_activations` 6, `license_requests` 3, `admins` 1, `notify_seen` 2; `notify_prefs`/`notify_deliveries` kaynakta boş |
| Bütünlük | Öksüz yabancı anahtar yok; 4 active lisansın 4'ü de hesaba bağlı (`activated_by` dolu) |
| pg_cron | `market-watch` (10 dk) + `refresh-bist-universe` (06:30) kuruldu, ikisi de `active` |
| İstemci kodu | Uygulama, site ve Chrome eklentisi yeni adrese çevrildi; `npm run build` ve `npm --prefix site run build` geçiyor |

### Kalanlar — yayından ÖNCE

1. **Auth ayarları** (`--only=auth`): `SMTP_USER`, `SMTP_PASS`, `GITHUB_CLIENT_ID`,
   `GITHUB_SECRET` girilmeden çalıştırılamadı. Bunlar olmadan yeni projede
   **GitHub girişi ve doğrulama/şifre e-postaları çalışmaz**.
2. **Edge Function gizli anahtarları** (`--only=gizli`): `BREVO_API_KEY`,
   `MAIL_FROM`, `ADMIN_EMAIL`, `LLM_API_KEY` girilmedi. Bunlar olmadan lisans
   e-postası ve market-watch bildirimleri sessizce çalışmaz.
3. **GitHub OAuth uygulaması** (GitHub tarafında): *Authorization callback URL* →
   `https://emrusyelfekcfyisfzzl.supabase.co/auth/v1/callback`.
4. **Mail şablonları**: `docs/email-templates/` içindekiler yeni panoya elle
   yapıştırılmalı (bkz. o dizindeki README).
5. **Parolalar taşınmadı** (bilinçli karar): auth API parola hash'ini okutmaz,
   eski projenin DB parolası da yok. Mevcut **4 e-posta/parola kullanıcısı ilk
   girişte şifre yenilemeli**. Onlara haber verilmeli.

---

## Bağlantı notu — doğrudan DB adresi IPv4'ten erişilmez

`db.<ref>.supabase.co` yalnız **IPv6** çözümlenir. IPv4 bir ağdaysan `psql` ve
`pg_dump` oraya bağlanamaz ("no route to host" / sessiz zaman aşımı). Havuz
(pooler) adresi IPv4'tür ve kullanıcı adı farklıdır:

```
postgresql://postgres.<ref>:<parola>@aws-1-eu-west-1.pooler.supabase.com:5432/postgres
```

Konaktaki sayı bölgeye/projeye göre `aws-0` ya da `aws-1` olabilir; yeni proje
`aws-1`, eski nesil projeler `aws-0`. `run-migration.mjs` ikisini de sırayla
dener (`POOLERS`). `supabase db push` bunu kendi hallettiği için şema adımı
doğrudan çalışır.

---

## HIZLI YOL — tek dosya doldur, tek komut çalıştır

Aşağıdaki uzun anlatımın tamamı otomatikleştirildi. Yapman gereken:

```bash
cp scripts/.env.migration.example scripts/.env.migration
# dosyayı doldur (içinde her alanın nereden alınacağı yazıyor)

node scripts/run-migration.mjs            # kuru çalışma — hiçbir şey değişmez
node scripts/run-migration.mjs --apply    # taşımayı yapar
```

Script şu yedi adımı sırayla yürütür ve **eksik kimlik bilgisi olan adımı
atlayıp nedenini söyler** — elindekiyle başlayıp sonra tamamlayabilirsin:

| # | Adım | Gerektirdiği |
| --- | --- | --- |
| 1 | Şema (`supabase db push`) | `DST_DB_PASSWORD` |
| 2 | Auth ayarları (`supabase config push`) | `SMTP_*`, `GITHUB_*`, `SITE_URL` |
| 3 | Edge Function gizli anahtarları | `BREVO_API_KEY`, `MAIL_FROM`, `CRON_SECRET` |
| 4 | Kullanıcı parolaları (`pg_dump`) | `SRC_DB_PASSWORD` + `DST_DB_PASSWORD` |
| 5 | Tablo verisi | `SRC_/DST_SERVICE_KEY` |
| 6 | pg_cron zamanlaması | `DST_DB_PASSWORD`, `CRON_SECRET` |
| 7 | İstemci proje adresi | `DST_ANON_KEY` |

Tek bir adımı çalıştırmak için: `--only=sema` (ya da `auth`, `gizli`, `parola`,
`veri`, `cron`, `istemci`).

**Elle kalan tek iş:** GitHub'daki OAuth uygulamasının *Authorization callback
URL* alanını `https://emrusyelfekcfyisfzzl.supabase.co/auth/v1/callback`
yapmak (bu GitHub tarafında, Supabase'de değil) ve mail şablonlarını panoya
yapıştırmak (Adım 3).

Aşağısı ne olup bittiğinin ayrıntısı — script'in yaptığı işin karşılığıdır.

---

## 0. Taşınacakların envanteri

2026-08-11'de canlı projeden çıkarılan gerçek durum:

| Tür | Ad | Satır / not |
| --- | --- | --- |
| Tablo | `bist_tickers` | 796 |
| Tablo | `licenses` | 13 (4'ü active) |
| Tablo | `license_activations` | 6 |
| Tablo | `license_requests` | 3 |
| Tablo | `admins` | 1 |
| Tablo | `notify_seen` | 2 |
| Tablo | `notify_prefs` | 0 |
| Tablo | `notify_deliveries` | 0 |
| Auth | `auth.users` | 6 (4 e-posta/parola, kalanı OAuth) |
| RPC | 12 adet | `activate_license`, `check_license`, `is_admin`, `admin_*` (6), `_generate_license`, `rls_auto_enable` |
| Edge Function | 5 adet | `market-watch`, `notify-feed`, `refresh-bist-universe`, `report-license-abuse`, `send-license-email` |

**Şema kayması — dikkat:** canlı projede `license_overview` RPC'si **yok**
(depodaki `supabase-licenses.sql`'de var ama hiç çalıştırılmamış). Yeni projeye
dosyanın tamamı uygulanacağı için yeni projede olacak — bu bir düzeltmedir,
`release_device` ve hesap bazlı `check_license` de aynı dosyayla birlikte gelir.

---

## 1. Gereken kimlik bilgileri

| Ne | Nereden | Ne için |
| --- | --- | --- |
| Yeni proje `anon` (publishable) anahtarı | Yeni pano → Project Settings → API Keys | `supabaseClient.ts` + `site/src/lib/supabase.ts` |
| Yeni proje `service_role` anahtarı | aynı yer | veri taşıma script'i, `scripts/.env` |
| Yeni proje DB parolası | Yeni pano → Project Settings → Database | `supabase link`, `db push`, `pg_dump` geri yükleme |
| **Eski proje DB parolası** | Eski pano → Project Settings → Database (gerekirse *Reset*) | **yalnız parolaları taşımak için** (Adım 4-A) |

Eski DB parolası olmadan da taşıma tamamlanır; tek kayıp, e-posta/parola
kullanıcılarının yeni projede **parola sıfırlamak zorunda kalması**.

---

## 2. Şema

**Yol A — tek komut (DB parolası gerekir).** Üç SQL dosyası
`supabase/migrations/` altına sıralı migration olarak konuldu:

```bash
supabase link --project-ref emrusyelfekcfyisfzzl   # yapıldıysa atla
supabase db push --linked                          # DB parolasını sorar
```

**Yol B — panodan elle.** Yeni panonun SQL Editor'ında **bu sırayla** çalıştır:

1. `docs/supabase-licenses.sql` — lisans çekirdeği (tablolar + RPC'ler)
2. `docs/supabase-site.sql` — lisans talepleri, admin RPC'leri, site tarafı
3. `docs/supabase-notify.sql` — **yeni dosya**: `bist_tickers` + `notify_*`

> `supabase-notify.sql` bu taşıma sırasında yazıldı: bu dört tablo daha önce
> yalnızca canlı veritabanında vardı, depoda karşılığı yoktu. Şema, PostgREST
> tip bilgisinden ve tabloları kullanan Edge Function'lardan çıkarıldı.
> **Eski DB parolası varsa** aşağıdaki komutla gerçek DDL'i doğrula:
> ```
> pg_dump --schema-only --schema=public \
>   "postgresql://postgres:<ESKI_PAROLA>@db.frfbmutvkekctpacktlz.supabase.co:5432/postgres" \
>   > /tmp/eski-sema.sql
> ```
> Fark varsa gerçek DDL kazanır; `supabase-notify.sql`'i ona göre düzelt.

Sonra kendini admin yap (yeni projede `auth.users` doldurulduktan **sonra**):

```sql
insert into public.admins (user_id)
select id from auth.users where email = 'muzaffermertyazici@icloud.com'
on conflict do nothing;
```

---

## 3. Kimlik doğrulama ayarları (elle, panoda)

- **URL Configuration → Redirect URLs** allowlist'ine ekle:
  - `fraude://auth-callback` (masaüstü derin bağlantı)
  - `<site-origin>/sifre-yenile`
  - site origin'inin kendisi
- **Providers → GitHub**: etkinleştir. GitHub OAuth uygulamasının
  **Authorization callback URL**'ini yeni projeye çevir:
  `https://emrusyelfekcfyisfzzl.supabase.co/auth/v1/callback`
  (Kullanıcı `ihtiyarb21@itu.edu.tr` GitHub ile giriyor — bu yapılmazsa giremez.)
- **Emails**: `docs/email-templates/` içindeki şablonları yapıştır —
  `confirm-signup.html` → *Confirm sign up*, `reset-password.html` → *Reset password*.
  Konular `docs/email-templates/README.md`'de.
- **SMTP**: eski projedeki Brevo SMTP ayarını birebir gir (host, port, kullanıcı,
  parola, gönderici adı/adresi). Auth e-postaları buradan çıkar.

---

## 4. Veri

### 4-A. Parolaları da taşımak istiyorsan (tercih edilen)

Auth API parola hash'ini okutmaz; parolalar yalnız doğrudan Postgres ile taşınır:

```bash
pg_dump --data-only --table=auth.users --table=auth.identities \
  "postgresql://postgres:<ESKI_PAROLA>@db.frfbmutvkekctpacktlz.supabase.co:5432/postgres" \
  > /tmp/auth-data.sql

psql "postgresql://postgres:<YENI_PAROLA>@db.emrusyelfekcfyisfzzl.supabase.co:5432/postgres" \
  -f /tmp/auth-data.sql
```

Sonra Adım 4-B'yi çalıştır — kullanıcılar zaten var olduğu için atlanır, yalnız
public tablolar kopyalanır.

### 4-B. Tablolar (ve parola taşımıyorsan kullanıcılar)

```bash
SRC_URL=https://frfbmutvkekctpacktlz.supabase.co \
SRC_SERVICE_KEY=<eski service_role> \
DST_URL=https://emrusyelfekcfyisfzzl.supabase.co \
DST_SERVICE_KEY=<yeni service_role> \
node scripts/migrate-supabase.mjs            # önce kuru çalışma
```

Çıktı beklendiği gibiyse sonuna `--apply` ekleyip tekrar çalıştır.

Script **UUID'leri korur** — `licenses.activated_by`, `admins.user_id`,
`license_activations.user_id` hep aynı kimliklere bağlı kalır. Tekrar
çalıştırılabilir (upsert), kaynağa hiç yazmaz.

---

## 5. Edge Function'lar

> ✅ **Bu adımın deploy kısmı 2026-08-11'de yapıldı.** Beş fonksiyon da yeni
> projede `ACTIVE`, `verify_jwt` bayrakları doğru (`market-watch`,
> `notify-feed`, `refresh-bist-universe` → false; `send-license-email`,
> `report-license-abuse` → true). Proje de `supabase link` ile bağlandı.
> **Gizli anahtarlar hâlâ girilmedi** — aşağıdaki `secrets set` şart, yoksa
> fonksiyonlar çalışma anında hata verir.

Kod değişirse yeniden deploy:

```bash
supabase functions deploy market-watch          --no-verify-jwt --use-api
supabase functions deploy notify-feed           --no-verify-jwt --use-api
supabase functions deploy refresh-bist-universe --no-verify-jwt --use-api
supabase functions deploy send-license-email    --use-api
supabase functions deploy report-license-abuse  --use-api
```

(`--use-api` Docker gerektirmez; bu makinede Docker kapalı.)

Gizli anahtarları gir — **eski projeden okunamaz**, elindeki asıl değerleri
kullan (Brevo panosu, Qwen/DashScope panosu):

```bash
supabase secrets set \
  BREVO_API_KEY=<...> \
  MAIL_FROM="FRAUDE <no-reply@...>" \
  ADMIN_EMAIL=<...> \
  SITE_URL=https://fraude.intelligentverseconnection.com \
  CRON_SECRET=<yeni rastgele değer> \
  LLM_API_KEY=<...> \
  LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1 \
  LLM_MODEL=qwen-plus
```

`SUPABASE_URL` ve `SUPABASE_SERVICE_ROLE_KEY` Supabase tarafından otomatik
sağlanır, elle girilmez.

---

## 6. Zamanlama (pg_cron + pg_net)

`docs/supabase-site.sql` sonundaki (satır ~408) yorumlu blok şablondur. Yeni
panonun SQL Editor'ında yorumu kaldırıp çalıştır; **URL'lerdeki proje
referansını `emrusyelfekcfyisfzzl` yap** ve `<CRON_SECRET>` yerine Adım 5'te
verdiğin değeri koy. İki iş vardır: `market-watch` (~10 dk) ve
`refresh-bist-universe` (`30 6 * * *`).

Doğrula: `select * from cron.job;`

---

## 7. İstemcileri çevir

Yeni `anon` anahtarını aldıktan sonra üç yerde proje adresi/anahtarı değişir:

- `src/features/auth/supabaseClient.ts` — masaüstü uygulaması
- `site/src/lib/supabase.ts` — web sitesi
- `scripts/.env` — `gen-licenses.mjs` (yeni URL + yeni service_role)

Sonra: `npm run build` ve site tarafında `npm --prefix site run build`.

---

## 8. Doğrulama listesi

- [ ] `select count(*) from bist_tickers;` → 796
- [ ] `licenses` 13 satır, 4'ü `active`; `activated_by` değerleri dolu
- [ ] Uygulamada lisanslı hesapla giriş → **anahtar sorulmuyor** (hesap bazlı
      `check_license` çalışıyor)
- [ ] Ayarlar → Hesap'ta lisans özeti ve cihaz listesi dolu (`license_overview`)
- [ ] Sitede `/hesap` açılıyor, `/admin` admin hesabıyla giriyor
- [ ] GitHub ile giriş çalışıyor (callback yeni projeye bakıyor)
- [ ] Kayıt ve şifre yenileme e-postaları geliyor (SMTP + şablonlar)
- [ ] `select * from cron.job;` iki iş gösteriyor
- [ ] `notify-feed` bir `feed_token` ile 200 dönüyor

---

## 9. Eski projeyi kapatmadan önce

Yeni proje uçtan uca doğrulanana kadar eski projeyi **silme**. Taşıma
tamamlandıktan sonra eski projede yalnız okuma kalsın; lisans anahtarları
`key_hash` olarak taşındığı için kullanıcıların anahtarları yeni projede de
aynen çalışır (düz anahtar hiçbir yerde tutulmuyor, taşınmasına gerek yok).
