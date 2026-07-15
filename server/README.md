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

## Modül registry (masaüstü/web güncelleme)

Masaüstü ve web istemcisi, imzalı **modül** güncellemelerini (FMUP — declarative
`views/data/locales`, çalıştırılabilir kod değil) bu sunucudan alır. İstemci
sözleşmesi `src/modules/registryClient.ts` + doğrulama `src/modules/crypto.ts`.

Sunulan uçlar (`src/registry.rs`):

```text
GET  /v1/trust/keys                 → { keys: [...] }          güven anahtarları
GET  /v1/channels/{channel}/latest  → { releases: [...] }      imzalı sürümler
GET  /v1/artifacts/{sha256}         → declarative artifact baytları
POST /v1/registry/releases          → imzalı sürüm YAYINLA (admin)
```

**Güvenlik modeli — çevrimdışı imzala, statik sun.** Özel imza anahtarı bu
internete açık sunucuda **bulunmaz**. Sürümler `scripts/registry-build.mjs` ile
çevrimdışı imzalanır; sunucu yalnız imzalı baytları olduğu gibi sunar. İmzalama,
istemcinin doğrulamasıyla (`stableValue` + Ed25519) birebir aynı
kanonikleştirmeyi kullanır → imza paritesi yapısal olarak garantidir.

### Yayın akışı — yerelde imzala → sunucuya gönder

Admin (senin makinen) sürümü YEREL imzalar ve HTTP ile sunucuya yollar. Özel
imza anahtarı ne sunucuda ne de web istemcisinde bulunur. Masaüstü "Yayınla"
butonu da bu ucu aynı gövdeyle çağırır.

```bash
# Tek seferlik: güven anahtarını sunucuya (out-of-band) deploy et + istemcide pinle.
#   node scripts/registry-build.mjs  → trust/keys.json üretir + pinlenecek anahtarı yazdırır
#   sunucu data dir'ine trust/keys.json'ı koy;  frontend .env → VITE_FRAUDE_TRUST_KEYS='[...]'

# Her yayında: yerelde imzala → sunucuya gönder
FRAUDE_REGISTRY_KEY_FILE=~/.fraude/signing-key.json \
FRAUDE_REGISTRY_PUBLISH_URL=https://api.fraude.app \
FRAUDE_REGISTRY_ADMIN_TOKEN=<sunucudaki token> \
FRAUDE_REGISTRY_PUBLIC_URL=https://api.fraude.app \
node scripts/registry-build.mjs
# → POST /v1/registry/releases ; sunucu artifact+release'i doğrular ve saklar
```

Gövde: `{ "release": <imzalı ModuleRelease>, "artifactBase64": "<base64>" }`.
Sunucu: admin token'ı doğrular → artifact hash'i manifest ile karşılaştırır →
artifact'i ve `channels/{ch}/latest.json`'ı atomik yazar (aynı modül kimliğini
değiştirir). İmzanın kriptografik doğrulaması istemcidedir (pinli anahtar).

**Alternatif (CI / elle deploy):** `FRAUDE_REGISTRY_PUBLISH_URL` vermezsen aynı
komut imzalı statik veri dizini üretir; onu sunucuya kopyalarsın.

Yetkilendirme: yayın ucu `FRAUDE_REGISTRY_ADMIN_TOKEN` ile korunur (tanımsızsa
`503`). Uygun cevaplar: token yok/yanlış → `401`, geçersiz gövde/hash → `400`.

Doğrulama (istemci pariteli): yayınla→`200`, auth `401/401/503`, imza + artifact
hash + negatif test uçtan uca geçirildi — masaüstü/web istemcisi yayınlanan
sürümü kabul eder.

### Masaüstü "Yayınla" butonu

Masaüstü admin uygulamasında **Yayınla** paneli (yalnız desktop navigasyonunda
görünür) aynı akışı UI'dan yürütür:

- Panel release'i kurar, artifact SHA-256'sını ve kanonik imza payload'ını
  istemcinin birebir kodu (`src/modules/crypto.ts` `releaseSigningPayload`) ile
  üretir; Tauri komutu `publish_module_release` bu kanonik baytları **yerel
  Ed25519 anahtarıyla** imzalar (ed25519-dalek; Rust↔WebCrypto imza paritesi
  birim testiyle kanıtlı) ve admin token'ıyla `POST /v1/registry/releases`'e yollar.
- Özel imza anahtarı ve admin token'ı **webview'e hiç girmez**; yalnız Rust tarafında.

Masaüstü yayın yapılandırması — `{config}/fraude/registry-publish.json`
(veya aynı adlı ortam değişkenleri override eder):

```json
{
  "publishUrl": "https://api.fraude.app",
  "publicBaseUrl": "https://api.fraude.app",
  "adminToken": "<sunucudaki FRAUDE_REGISTRY_ADMIN_TOKEN>",
  "keyId": "fraude-registry-1"
}
```

İmza anahtarı: `{config}/fraude/registry-signing-key.json`
(`scripts/registry-build.mjs` üretir; **bu makinede kalır**).

### Notlar / güvenlik

- `signing-key.json` gizlidir; sürüm kontrolüne/sunucuya konmaz (kök `.gitignore`
  `.fraude-registry/` dizinini yok sayar). Üretimde `FRAUDE_REGISTRY_KEY_FILE`
  çevrimdışı bir makinede tutulmalı; FMUP: çevrimdışı kök + döndürülebilir yayın
  anahtarı + iptal metadata'sı.
- Artifact URL'leri imzaya dahildir; `FRAUDE_REGISTRY_PUBLIC_URL` imzalama anında
  üretim URL'ine ayarlanmalıdır (değişmez artifact URL'leri).
- **Katkı alımı (contribution intake)** bu sürümde `503` döner. Etkinleştirmek
  için Ed25519 katkı-imzası doğrulaması (istemci kanonik baytlarıyla parite) +
  kimlik doğrulamalı review akışı gerekir (bugünkü `FRAUDE_REGISTRY_REVIEW_TOKEN`
  yerine oturum + rol + CSRF + denetim günlüğü).
- **Çekirdek binary self-update** (uygulamanın `.dmg/.exe`'sini güncellemesi) ayrı
  bir mekanizmadır (`tauri-plugin-updater` — kurulu değil) ve bu registry'nin
  kapsamı dışındadır.

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
