# fraude-server

FRAUDE'nin web API'si — masaüstü (Tauri) uygulamasının komut yüzeyini HTTP olarak
sunar. Frontend web modunda (`src/api/platformClient.ts`) her komutu
`POST {VITE_FRAUDE_API_URL}/v1/rpc/{command}` olarak çağırır ve `{ data | error }`
zarfı bekler; bu sunucu tam olarak o sözleşmeyi konuşur.

Bu bir **Faz 0 iskeletidir**: deploy edilebilir, sözleşmeyi konuşur, ama komut
gövdeleri henüz veri mantığına bağlı değildir. Aşağıdaki "fraude-core çıkarımı"
adımı gerçek veriyi bağlar.

## Çalıştırma (yerel)

```bash
cd server
cp .env.example .env          # gerekiyorsa düzenle
cargo run                     # http://localhost:8787
```

Duman testi:

```bash
curl localhost:8787/healthz                         # -> ok
curl -X POST localhost:8787/v1/rpc/get_dashboard_snapshot -d '{}'
#   -> 501 { "error": "... henüz fraude-core'a bağlanmadı" }
curl -X POST localhost:8787/v1/rpc/list_ai_keys -d '{}'
#   -> 401 { "error": "... kişi-başı komut ... Faz 2" }
curl -X POST localhost:8787/v1/rpc/bilinmeyen -d '{}'
#   -> 404 { "error": "bilinmeyen komut" }
```

Frontend'i buna bağlamak: proje kökünde `.env` içine
`VITE_FRAUDE_API_URL=http://localhost:8787` yazıp `npm run dev`.

## Komut yüzeyi

`src/rpc.rs` üç kayıt defteri tutar (masaüstü `invoke_handler`'dan türetildi):

- **SHARED_COMMANDS** (19) — paylaşımlı piyasa verisi, auth opsiyonel, cache'lenir.
- **USER_COMMANDS** (22) — kişi-başı veri, JWT zorunlu (Faz 2).
- **ADMIN_COMMANDS** (2) — yalnızca arka plan; web ucundan `403`.

## fraude-core çıkarımı (sıradaki adım)

Kod incelemesi, `src-tauri/src` içindeki **~25 modülün tamamen Tauri'siz**
olduğunu, yalnızca 4 dosyanın (`commands.rs`, `lib.rs`, `module_updater.rs`,
`main.rs`) `tauri`'ye dokunduğunu gösterdi. Bu, çıkarımı düşük riskli kılar:

1. **`core/` (fraude-core) crate'i oluştur.** Tauri'siz modülleri
   (`services`, `yahoo`, `isyatirim`, `kap`, `domain`, `indicators`,
   `fundamentals`, `monitor`, `corporate_actions`, `shareholders`,
   `subsidiaries`, `ipo_scraper`, `ipo_store`, `bist`, `bist_indices`, `news`,
   `news_tagger`, `ai_tagger`, `providers`, `secrets`, `spk`, `storage`, `fql`)
   olduğu gibi taşı — birbirlerini `crate::` ile çağırdıkları için hep birlikte
   taşınınca içerideki yollar değişmez.
2. **`AppState`'i core'a taşı** (bugün `lib.rs`'de; alanları — store, reqwest,
   ipo_cache, monitor — Tauri'siz).
3. **Workspace kur:** kök `Cargo.toml` = `[workspace] members = ["server", "src-tauri", "core"]`.
   `server` ve `src-tauri`, `fraude-core`'a path bağımlısı olur.
4. **src-tauri sadeleşir:** `commands.rs` ince `#[tauri::command]` sarmalayıcı
   kalır, `crate::X` → `fraude_core::X`. Masaüstü çalışmaya devam eder.
5. **server'da komutları bağla:** `rpc::dispatch` içindeki her komut, ilgili
   `fraude_core` fonksiyonunu çağırır (args JSON'u ilgili tipe deserialize edip),
   sonucu `{ data }` olarak sarar. `commands.rs`'deki gövdelerin birebir HTTP
   karşılığı.
6. **Arka plan döngüleri:** IPO tazeleme + (çok kiracılı) monitor, `main.rs`'de
   `tokio::spawn` ile başlar.

> Bu adımda `Dockerfile` de core'u kopyalayacak şekilde güncellenir
> (`COPY ../core ...` yerine workspace kökünden derleme).

Sonraki fazlar (auth + Postgres, AI anahtar şifreleme, çok kiracılı monitor)
için kök `docs/WEB_MIGRATION_PLAN.md`.

## Deploy

- **Fly.io:** `fly launch --no-deploy` → `fly secrets set ...` → `fly deploy`
  (bkz. `fly.toml`).
- **Render:** Docker ortamı, health check `/healthz`, port `8080`.
- Frontend Vercel'de; `VITE_FRAUDE_API_URL` bu servisin prod URL'ine ayarlanır.
