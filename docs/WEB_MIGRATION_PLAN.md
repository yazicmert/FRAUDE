# FRAUDE — Web'e Taşıma ve Canlıya Alma Planı

> Durum: **Taslak / onay bekliyor**
> Hedef: Tauri masaüstü uygulamasını **halka açık, çok kullanıcılı** bir web uygulamasına dönüştürüp Vercel + kalıcı bir backend hostu üzerinde canlıya almak.
> Karar verilenler: (1) Halka açık / çok kullanıcılı. (2) AI anahtarını her kullanıcı kendi girer, sunucuda **şifreli** saklanır.

---

## 1. Amaç ve kapsam

FRAUDE bugün bir **Tauri (Rust + React)** masaüstü uygulaması. Her kullanıcı kendi makinesinde kendi kopyasını çalıştırdığı için:
- Tüm durum (state) tek bir global bellek deposunda (`AppStore`) tutulabiliyor,
- Kimlik doğrulama gerekmiyor,
- AI anahtarları yerel dosyada düz metin saklanabiliyor,
- Ağ çağrıları (Yahoo, İş Yatırım, KAP, GDELT, Google News) Rust tarafında yapıldığı için CORS sorunu yok.

Halka açık web sürümünde bu varsayımların **hepsi geçersiz**. Tek sunucu, binlerce kullanıcının verisini birbirinden izole tutmak zorunda. Bu belge o dönüşümün tam planıdır.

**Kapsam içi:** Frontend'in web'e alınması, backend'in HTTP servisine dönüştürülmesi, kimlik doğrulama, kişi-başı veri izolasyonu, AI anahtar şifreleme, çok kiracılı izleme (monitor), deploy pipeline'ı.

**Kapsam dışı (şimdilik):** Mobil uygulama, ödeme/abonelik, `.fraude-registry` modül imzalama sistemi (ayrı bir bileşen; ilk sürümde dokunulmuyor).

---

## 2. Mevcut mimari (As-Is)

```
┌─────────────────────────── Masaüstü (tek kullanıcı) ───────────────────────────┐
│                                                                                 │
│   React 19 + Vite (webview)                                                     │
│        │  @tauri-apps/api  invoke("command", args)                              │
│        ▼                                                                         │
│   Tauri Rust çekirdeği  (tek süreç, tek kullanıcı)                              │
│        ├─ commands.rs        → 47 komut (#[tauri::command])                      │
│        ├─ AppStore (Mutex)   → BELLEKTE, restart'ta uçar                         │
│        ├─ services / yahoo / isyatirim / kap / ipo_scraper …                    │
│        ├─ secrets.rs         → AI anahtarları DÜZ METİN                          │
│        └─ arka plan döngüleri: IPO tazeleme (30dk) + KAP monitor                 │
│                    │                                                             │
│                    ▼  reqwest ile dış kaynaklara doğrudan (CORS yok)             │
│        Yahoo · İş Yatırım · KAP · GDELT · Google News · SPK                      │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Frontend zaten web'e yarı hazır:** [`src/api/platformClient.ts`](../src/api/platformClient.ts) iki modu destekliyor:
- Masaüstü (`__TAURI_INTERNALS__` varsa) → `tauriInvoke`
- Web (`VITE_FRAUDE_API_URL` set ise) → `POST {API}/v1/rpc/{command}` + `{ data | error }` yanıtı

Yani frontend sözleşmesi belli: **backend `POST /v1/rpc/{command}` uçlarını sunmalı.** Bu uçlar henüz yok.

### 2.1 As-Is envanter

| Bileşen | Dosya | Durum |
|---|---|---|
| Komut yüzeyi | `commands.rs` | 47 komut, hepsi `#[tauri::command]` + `State<AppState>` |
| Global depo | `storage.rs` `AppStore` | Bellekte; disk kalıcılığı yok |
| AI anahtar | `secrets.rs` | **Düz metin** (`secret` alanı), yalnızca gösterimde maskeleniyor |
| Kazıma/servis | `services.rs` (62KB), `yahoo.rs` (59KB), `isyatirim.rs`, `kap.rs`, `ipo_scraper.rs`, `corporate_actions.rs` | Sağlam, korunuyor |
| Arka plan | `lib.rs` setup | IPO döngüsü + KAP monitor döngüsü (tokio task) |
| Monitor | `monitor.rs` | **Tek global izleme listesi** (`MonitorRuntime`) |
| HTTP sunucu | — | **YOK** |
| Auth | — | **YOK** |
| Veritabanı | — | **YOK** |

---

## 3. Hedef mimari (To-Be)

```
                          KULLANICI TARAYICISI
                                  │
                                  ▼
          ┌───────────────────────────────────────────┐
          │  Frontend  —  Vercel (statik Vite build)   │
          │   • Giriş ekranı (Supabase Auth JS)        │
          │   • platformClient → Authorization: Bearer │
          └───────────────┬───────────────┬────────────┘
                          │               │
             Auth/oturum  │               │  /v1/rpc/{command}  (JWT ekli)
                          ▼               ▼
        ┌──────────────────────┐   ┌───────────────────────────────────────┐
        │  Supabase            │   │  Backend Rust API — Fly.io / Render    │
        │  • Auth (JWT verir)  │   │  (axum, kalıcı konteyner, hep açık)    │
        │  • Postgres          │◀──┤  • JWT doğrula (Supabase JWKS)         │
        │    - kişi-başı veri  │   │  • /v1/rpc router → mevcut komut mantığı│
        │    - RLS             │   │  • Paylaşımlı market cache (bellek)    │
        └──────────────────────┘   │  • Arka plan: IPO + çok-kiracılı monitor│
                                   │  • AI anahtar: envelope şifreleme      │
                                   └──────────────────┬────────────────────┘
                                                      │ reqwest (CORS yok, sunucu tarafı)
                                                      ▼
                       Yahoo · İş Yatırım · KAP · GDELT · Google News · SPK
                                                      │
                                                      ▼   (kullanıcının kendi anahtarıyla)
                                          AI sağlayıcı (OpenAI / Anthropic …)
```

### 3.1 Neden bu yığın?

| Karar | Gerekçe |
|---|---|
| Frontend → **Vercel** | Statik Vite build için ideal; sıfıra yakın konfigürasyon; otomatik CDN + HTTPS. |
| Backend Rust'ı **koru** | `services.rs`+`yahoo.rs` = 120KB+ test edilmiş kazıma. TS'e çevirmek devasa risk; ayrıca Vercel serverless arka plan döngüsünü/uzun süreci çözmez. |
| Backend → **Fly.io / Render** (Vercel değil) | Kalıcı, sürekli açık süreç gerekiyor: bellek cache + IPO döngüsü + monitor döngüsü. Vercel serverless durumsuz ve kısa ömürlü. |
| Auth+DB → **Supabase** | Auth + Postgres + Row-Level Security tek pakette. JWT'yi backend Rust JWKS ile doğrular. Kişi-başı veri ve oturumu hazır çözer. |
| RPC sözleşmesini **koru** | `platformClient` zaten `/v1/rpc/{command}` konuşuyor; sözleşmeyi bozmadan sadece JWT + kullanıcı ayrımı ekleriz → frontend değişikliği minimum. |

---

## 4. Veri modeli: paylaşımlı vs kişi-başı

Bugün tek `AppStore`'da karışık duran veriyi ikiye ayırıyoruz.

### 4.1 Paylaşımlı (tüm kullanıcılar için AYNI — sunucuda tek cache, auth gerekmez)

Bunlar piyasa gerçeği; kullanıcıya göre değişmez. Sunucu bir kez çeker, herkese servis eder.

`equities`, `kap`, `news`, `indices`, `index_changes`, `spk_bulletins`, IPO takvimi, kurumsal olaylar (temettü/sermaye artırımı), fiyat geçmişi, temel veriler (fundamentals), ortaklık yapısı (shareholders), bağlı ortaklıklar (subsidiaries).

→ **Bellek cache + arka plan tazeleme** olarak kalır (bugünküyle neredeyse aynı). İsteğe bağlı: Postgres'e/Redis'e taşınabilir ama ilk sürümde şart değil.

### 4.2 Kişi-başı (auth ZORUNLU — Postgres'te `user_id` ile izole)

| Veri | Bugün nerede | Yeni yeri |
|---|---|---|
| AI anahtarları | `AppStore.ai_keys` (düz metin) | `user_ai_keys` tablosu, **şifreli** |
| AI sohbet geçmişi | `AppStore.ai_history` | `user_ai_history` |
| Özel AI ajanları | `AppStore.agents` | `user_ai_agents` |
| Kayıtlı analizler | `AppStore.artifacts` | `user_artifacts` |
| İzleme listesi + config + uyarılar | `monitor.rs` (tek global) | `user_watchlists`, `user_monitor_config`, `user_monitor_alerts` |

### 4.3 Komut sınıflandırması (47 komut)

**Paylaşımlı / auth opsiyonel (~21):**
`get_dashboard_snapshot`, `get_ticker_snapshot`, `get_financial_statements`, `run_screener`, `list_kap_announcements`, `get_price_history`, `get_news_feed`, `get_news_preview`, `get_news_html`, `get_bist_indices`, `get_shareholders`, `get_subsidiaries`, `research_entity_news`, `get_corporate_events`, `get_kap_for_ticker`, `get_dividends`, `get_capital_increases`, `get_ipo_calendar`, `execute_fql`

**Kişi-başı / auth ZORUNLU (~22):**
`ask_ai`, `list_ai_keys`, `save_ai_key`, `delete_ai_key`, `set_default_ai_key`, `test_ai_key`, `list_ai_history`, `delete_ai_history`, `clear_ai_history`, `list_ai_agents`, `save_ai_agent`, `delete_ai_agent`, `list_artifacts`, `save_artifact`, `delete_artifact`, `run_agent_analysis`, `get_monitor_state`, `sync_monitor_tickers`, `set_monitor_config`, `run_monitor_now`, `mark_monitor_alerts_read`, `clear_monitor_alerts`

**Yalnızca admin / arka plan (kullanıcıya kapatılır):**
`sync_data`, `update_bist_indices` → halka açıkta uçtan tetiklenmez; arka plan job'ına ya da korumalı admin ucuna taşınır.

---

## 5. Veritabanı şeması (Postgres / Supabase)

Supabase Auth `auth.users` tablosunu yönetir. Uygulama tabloları `public` şemasında, hepsinde `user_id uuid references auth.users` ve **Row-Level Security** açık (bir kullanıcı yalnızca kendi satırlarını görür).

```sql
-- AI anahtarları (şifreli). Düz metin ASLA saklanmaz.
create table user_ai_keys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  provider      text not null,
  label         text not null,
  secret_cipher bytea not null,      -- AES-256-GCM ile şifreli anahtar
  secret_nonce  bytea not null,      -- GCM nonce
  masked_key    text not null,       -- gösterim için (sk-t••••)
  default_model text not null,
  api_url       text,
  enabled       boolean not null default true,
  is_default    boolean not null default false,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

create table user_ai_history (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  prompt     text not null,
  response   text not null,
  context    text,
  created_at timestamptz not null default now()
);

create table user_ai_agents (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  name       text not null,
  config     jsonb not null,        -- ajan tanımı
  created_at timestamptz not null default now()
);

create table user_artifacts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  title      text not null,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);

create table user_watchlists (
  user_id  uuid not null references auth.users on delete cascade,
  ticker   text not null,
  added_at timestamptz not null default now(),
  primary key (user_id, ticker)
);

create table user_monitor_config (
  user_id         uuid primary key references auth.users on delete cascade,
  enabled         boolean not null default false,
  interval_secs   integer not null default 900,
  agent_id        uuid,
  os_notifications boolean not null default false
);

create table user_monitor_alerts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  ticker     text not null,
  title      text not null,
  event_type text not null,
  severity   smallint not null,
  ai_comment text,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

-- Her tabloda:
alter table user_ai_keys enable row level security;
create policy "own rows" on user_ai_keys
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- (diğer tablolar için tekrarlanır)
```

> **Not:** Backend Rust, Postgres'e `sqlx` ile bağlanır. RLS ikinci savunma hattıdır; birincil izolasyon backend'in her sorguya `user_id`'yi JWT'den koymasıdır.

---

## 6. Kimlik doğrulama akışı

```
1. Kullanıcı frontend'de Supabase Auth ile giriş yapar (email+şifre / OAuth).
2. Supabase, kullanıcıya kısa ömürlü JWT (access_token) + refresh_token verir.
3. platformClient her /v1/rpc çağrısına  Authorization: Bearer <JWT>  ekler.
4. Backend axum middleware:
      • JWT'yi Supabase JWKS ile doğrular (imza + exp + aud),
      • sub (user_id) çıkarır, request context'e koyar.
5. Kişi-başı komutlarda: user_id ile Postgres sorgusu.
   Paylaşımlı komutlarda: JWT opsiyonel; yoksa da cache'ten döner (rate-limit uygulanır).
```

`platformClient.ts`'e eklenecek tek şey: `fetch` header'ına Supabase oturum token'ı. Yanıt sözleşmesi (`{ data | error }`) **aynı kalır**.

---

## 7. AI anahtar güvenliği (envelope encryption)

Bugünkü davranış: [`secrets.rs`](../src-tauri/src/secrets.rs) anahtarı düz metin tutuyor. Halka açıkta **kabul edilemez.**

**Yeni tasarım (AES-256-GCM zarf şifreleme):**
- Sunucuda bir **master key** ortam değişkeninde tutulur: `FRAUDE_KEY_ENC_SECRET` (32 byte, base64). Asla repoya girmez; host secret'ı.
- `save_ai_key`: `secret_cipher = AES256-GCM(master_key, nonce, plaintext)` → Postgres'e `secret_cipher` + `secret_nonce` yazılır. `masked_key` gösterim için türetilir.
- `ask_ai` / `run_agent_analysis`: anahtar sorgudan çekilip bellekte deşifre edilir, AI sağlayıcıya kullanılır, kullanımdan sonra düşürülür. Deşifre metin **loglanmaz, yanıtta dönmez.**
- `list_ai_keys` yalnızca `masked_key` döner (bugünkü `public_record` davranışı korunur).

Rust tarafı: `aes-gcm` crate. Gelecekte master key rotasyonu için `key_version` sütunu eklenebilir (ilk sürümde tek sürüm).

---

## 8. Çok kiracılı monitor (izleme motoru)

Bugün: tek global `MonitorRuntime`, tek izleme listesi, `lib.rs`'de tek arka plan döngüsü.

Yeni: tek arka plan worker'ı **tüm kullanıcıların** izleme listelerini dolaşır.

```
Her tur (örn. 15 dk):
  1. Tüm user_watchlists'ten benzersiz ticker kümesini topla (dedup).
  2. Her benzersiz ticker için KAP bildirimlerini BİR KEZ çek + sınıflandır (classify).
  3. Yeni önemli olayları, o ticker'ı izleyen HER kullanıcının
     user_monitor_alerts tablosuna yaz.
  4. AI etiketleme (opsiyonel): kullanıcının kendi anahtarı + config'ine göre,
     yalnızca monitor'ı 'enabled' olan kullanıcılar için.
```

- **Bildirim mekanizması:** Masaüstündeki OS bildirimi ve `emit` web'de yok. Yerine: (a) kullanıcı paneli açıkken alarm rozetini polling / (b) sonraki fazda web-push veya e-posta. İlk sürümde polling yeterli.
- Aynı ticker'ın tekrar tekrar çekilmesini önlemek dedup ile maliyeti düşürür.

---

## 9. Backend'in Tauri'den ayrılması (yapısal)

Mevcut komutlar `State<'_, AppState>` alıyor ve `Result<T, String>` döndürüyor — bu Tauri'ye sıkı bağlı değil, sadece imza meselesi. Plan:

1. Kazıma/servis mantığını (`services`, `yahoo`, `isyatirim`, `kap`, `ipo_*`, `corporate_actions`, `domain`, `indicators`, `fundamentals`, `monitor` çekirdeği) **Tauri'den bağımsız bir crate**'e (`fraude-core`) taşı. Bunlar zaten `tauri::` kullanmıyor.
2. Yeni bir binary crate (`fraude-server`) axum ile:
   - `AppState` yeniden kurulur (bellek cache + `sqlx::PgPool` + `reqwest::Client` + master key).
   - `POST /v1/rpc/:command` → tek dispatcher; komut adına göre gövdeyi (JSON) ilgili fonksiyona yönlendirir, `{ data }` veya `{ error }` sarar.
   - Auth middleware, CORS (yalnızca Vercel origin'i), rate-limit.
   - `lib.rs`'deki iki tokio döngüsü buraya taşınır (IPO + çok-kiracılı monitor).
3. Tauri `src-tauri` **korunur** (masaüstü sürümü çalışmaya devam eder); `fraude-core`'u paylaşır. Böylece tek kod tabanı iki hedefi (masaüstü + web) besler.

```
fraude-core   (kütüphane: tüm iş mantığı, Tauri'siz)
   ├── src-tauri/     → masaüstü (Tauri) — core'u kullanır
   └── fraude-server/ → web (axum)       — core'u kullanır  ★ YENİ
```

---

## 10. Migration pipeline (fazlar)

Her faz **kendi başına çalışır ve doğrulanabilir**. Bir faz bitmeden diğerine geçilmez.

### Faz 0 — Backend'i Tauri'den ayır (host-bağımsız temel)
- [ ] `git init` + `.gitignore` düzeni + ilk commit (şu an git deposu değil).
- [ ] `fraude-core` crate: iş mantığını Tauri'siz kütüphaneye çıkar.
- [ ] `fraude-server` crate: axum, `POST /v1/rpc/:command` dispatcher, bellek cache.
- [ ] IPO + (tek-kullanıcılı geçici) monitor döngüsünü sunucuya taşı.
- [ ] `Dockerfile` (çok aşamalı: cargo build → ince runtime imajı).
- **Doğrulama:** `docker run` + frontend `VITE_FRAUDE_API_URL=localhost:8787` ile lokal uçtan uca; paylaşımlı komutlar (dashboard, ticker, screener) dönüyor.

### Faz 1 — Auth'suz canlı (paylaşımlı veri)
- [ ] Frontend → Vercel (preview).
- [ ] Backend → Fly.io/Render (ilk deploy).
- [ ] CORS + HTTPS + prod `VITE_FRAUDE_API_URL`.
- **Doğrulama:** Canlı URL'de piyasa verisi, grafikler, screener çalışıyor. (AI ve kişi-başı özellikler henüz kapalı.)

### Faz 2 — Auth + kişi-başı veri
- [ ] Supabase projesi, Auth, tablolar + RLS (§5).
- [ ] Frontend giriş/kayıt ekranı (Supabase Auth JS) + token enjeksiyonu.
- [ ] Backend JWT doğrulama middleware (JWKS).
- [ ] `sqlx` + Postgres bağlantısı; history / agents / artifacts kişi-başı CRUD'a taşınır.
- **Doğrulama:** İki farklı hesap birbirinin verisini göremiyor; giriş olmadan kişi-başı uçlar 401.

### Faz 3 — AI (kullanıcı anahtarı) + çok kiracılı monitor
- [ ] `user_ai_keys` + envelope encryption (§7).
- [ ] `ask_ai`, `run_agent_analysis` kullanıcı anahtarıyla.
- [ ] Çok kiracılı monitor worker'ı (§8) + alarm polling.
- **Doğrulama:** Kullanıcı kendi anahtarını girip AI sorusu soruyor; anahtar DB'de şifreli; izleme listesi kişiye özel uyarı üretiyor.

### Faz 4 — Sertleştirme ve üretim olgunluğu
- [ ] Rate-limiting, kötüye kullanım koruması, istek boyutu limitleri.
- [ ] Yapılandırılmış loglama + hata izleme (örn. Sentry).
- [ ] Sağlık ucu (`/healthz`), yeniden başlatmaya dayanıklılık.
- [ ] Yedekleme (Supabase otomatik) + gizli anahtar rotasyon planı.
- [ ] Yük testi (eşzamanlı kullanıcı + monitor maliyeti).
- **Doğrulama:** Temel yük altında stabil; hatalar izlenebiliyor; anahtarlar güvende.

---

## 11. CI/CD deployment pipeline

```
   Geliştirici
      │  git push  (feature dalı → PR → main)
      ▼
  ┌──────────────── GitHub ────────────────┐
  │  GitHub Actions                          │
  │  ┌─────────────────────────────────────┐ │
  │  │ 1) Lint + type-check (tsc)          │ │
  │  │ 2) cargo fmt --check + clippy       │ │
  │  │ 3) cargo test  (fraude-core)        │ │
  │  │ 4) vite build  (frontend derlenir mi)│ │
  │  └─────────────────────────────────────┘ │
  └───────────────┬─────────────┬────────────┘
     yeşilse       │             │
                   ▼             ▼
        ┌────────────────┐  ┌──────────────────────────┐
        │ Vercel         │  │ Fly.io / Render          │
        │ (frontend)     │  │ (backend)                │
        │ • PR → preview │  │ • Docker imajı build+push│
        │ • main → prod  │  │ • main → prod deploy     │
        │ • otomatik CDN │  │ • healthz geçince yayına │
        └────────────────┘  └──────────────────────────┘
                   │             │
                   └──── env: VITE_FRAUDE_API_URL → backend prod URL
```

**Vercel tarafı:**
- GitHub reposuna bağlanır; her PR otomatik **preview URL**, `main`'e merge **production**.
- Build komutu: `npm run build` (`tsc && vite build`), çıktı: `dist/`.
- Ortam değişkenleri Vercel panelinden (§12).

**Backend tarafı (Fly.io örneği):**
- `fly.toml` + `Dockerfile`. `flyctl deploy` (Actions'tan `FLY_API_TOKEN` ile).
- Gizli anahtarlar `fly secrets set` ile (repoya girmez).
- `/healthz` yeşil olunca trafik yeni sürüme geçer (rolling).

**Supabase tarafı:**
- Şema göçleri `supabase/migrations/*.sql` olarak repoda; `supabase db push` CI adımı (veya elle, ilk kurulumda).

---

## 12. Ortam değişkenleri

**Frontend (Vercel):**
| Değişken | Örnek | Açıklama |
|---|---|---|
| `VITE_FRAUDE_API_URL` | `https://api.fraude.app` | Backend prod URL |
| `VITE_SUPABASE_URL` | `https://xxx.supabase.co` | Supabase proje URL |
| `VITE_SUPABASE_ANON_KEY` | `eyJ…` | Public anon key (client güvenli) |

**Backend (Fly/Render secrets — repoya ASLA girmez):**
| Değişken | Açıklama |
|---|---|
| `DATABASE_URL` | Postgres bağlantısı (Supabase) |
| `SUPABASE_JWKS_URL` | JWT doğrulama için JWKS ucu |
| `FRAUDE_KEY_ENC_SECRET` | AI anahtar şifreleme master key (32 byte base64) |
| `ALLOWED_ORIGIN` | CORS için Vercel prod origin'i |
| `RUST_LOG` | Log seviyesi |

---

## 13. Riskler ve açık sorular

| Risk / soru | Not |
|---|---|
| **Kaynak sitelerin ölçek/oran limitleri** | Yahoo/İş Yatırım/KAP'a tek sunucudan çok kullanıcı adına istek → IP başına rate-limit/ban riski. Agresif cache + dedup şart. Paylaşımlı veriyi tek merkezde tutmak zaten bunu azaltıyor. |
| **Kullanıcıların AI anahtarlarını saklamak** | Yasal/güven yükü. Envelope encryption + net gizlilik metni + "anahtarını istediğinde sil" gerekli. |
| **Maliyet** | Fly/Render (backend) + Supabase (DB) sabit aylık gider. Vercel hobi planında olabilir. |
| **Telif/kullanım şartları** | Bazı kaynaklar (Google News RSS, KAP indeksleme) yalnızca kişisel/ticari-olmayan kullanım içindi (README). Halka açık serviste yeniden değerlendirilmeli. |
| **Alan adı + KVKK/gizlilik** | Halka açık için domain, gizlilik politikası, kullanım şartları gerekir. |
| **Monitor maliyeti** | Kullanıcı sayısı arttıkça izleme turu maliyeti; benzersiz ticker sayısıyla ölçeklenir (kullanıcı sayısıyla değil) — dedup kritik. |

---

## 14. Kaba efor tahmini

| Faz | İçerik | Büyüklük |
|---|---|---|
| Faz 0 | Tauri'den ayırma + axum kabuğu + Docker | Orta-Büyük |
| Faz 1 | Vercel + Fly deploy, paylaşımlı veri canlı | Küçük-Orta |
| Faz 2 | Auth + Postgres + kişi-başı CRUD + RLS | Büyük |
| Faz 3 | AI anahtar şifreleme + çok kiracılı monitor | Büyük |
| Faz 4 | Sertleştirme, gözlemlenebilirlik, yük | Orta |

Bu bir "hafta sonu portu" değil; masaüstü uygulamasından **çok kiracılı bir web servisi** inşa etmektir. Ama iyi haber: en ağır ve riskli kısım — veri kazıma ve finansal hesaplama mantığı — zaten yazılmış ve korunuyor.

---

## 15. Sıradaki adım

Bu plan onaylanınca **Faz 0** ile başlanır:
1. `git init` ve ilk commit,
2. `fraude-core` ayrımı,
3. `fraude-server` (axum) `/v1/rpc` iskeleti,
4. `docker run` + lokal frontend ile uçtan uca doğrulama.

> Onay / değişiklik isteğin varsa bu belge güncellenir, sonra kodlamaya geçilir.
