// FRAUDE registry — çevrimdışı imzalayıcı / paketleyici.
//
// Modül sürümlerini imzalar ve fraude-server'ın (server/src/registry.rs)
// olduğu gibi sunacağı statik bir registry veri dizini üretir. İmzalama,
// istemcinin doğrulamasıyla (src/modules/crypto.ts → stableValue + Ed25519)
// BİREBİR aynı kanonikleştirmeyi kullanır; böylece imza paritesi garanti olur.
//
// Güvenlik (FMUP): özel imza anahtarı internete açık sunucuda DEĞİL, burada
// (tercihen çevrimdışı bir makinede) tutulur. Sunucu yalnız imzalı baytları sunar.
//
// Kullanım:
//   FRAUDE_REGISTRY_PUBLIC_URL=https://api.fraude.app \
//   FRAUDE_REGISTRY_DATA_DIR=.fraude-registry \
//   node scripts/registry-build.mjs
//
// Üretilen public key'i, üretimde masaüstü/web istemcisine VITE_FRAUDE_TRUST_KEYS
// olarak pinlersin (çıktıda hazır JSON verilir).

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const publicBaseUrl = (process.env.FRAUDE_REGISTRY_PUBLIC_URL || 'http://localhost:8787').replace(/\/$/, '');
const dataDir = resolve(process.env.FRAUDE_REGISTRY_DATA_DIR || '.fraude-registry');
const keyFile = resolve(process.env.FRAUDE_REGISTRY_KEY_FILE || `${dataDir}/signing-key.json`);
const keyId = process.env.FRAUDE_REGISTRY_KEY_ID || 'fraude-registry-1';

// Yayın modu: ayarlıysa imzalı sürümler yerel dizin yerine sunucuya gönderilir.
// (Masaüstü "Yayınla" butonu da bu ucu aynı gövdeyle çağırır.)
const publishUrl = (process.env.FRAUDE_REGISTRY_PUBLISH_URL || '').replace(/\/$/, '');
const adminToken = process.env.FRAUDE_REGISTRY_ADMIN_TOKEN || '';

// ── Kanonikleştirme — src/modules/crypto.ts ile BİREBİR aynı olmalı ──────────
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function writeFileAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

// ── Kalıcı imza anahtarı (yoksa üret, varsa yükle) ───────────────────────────
function loadOrCreateKeypair() {
  if (existsSync(keyFile)) {
    const stored = JSON.parse(readFileSync(keyFile, 'utf8'));
    return {
      privateKey: createPrivateKey({ key: stored.privateJwk, format: 'jwk' }),
      publicKey: createPublicKey({ key: stored.publicJwk, format: 'jwk' }),
    };
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const stored = {
    createdAt: new Date().toISOString(),
    keyId,
    privateJwk: privateKey.export({ format: 'jwk' }),
    publicJwk: publicKey.export({ format: 'jwk' }),
  };
  writeFileAtomic(keyFile, JSON.stringify(stored, null, 2));
  console.log(`Yeni Ed25519 imza anahtarı üretildi: ${keyFile}`);
  console.log('UYARI: Bu dosya gizlidir; sürüm kontrolüne veya sunucuya koyma.');
  return { privateKey, publicKey };
}

// ── Yayınlanacak modül sürümleri ─────────────────────────────────────────────
// Başlangıç: FMUP tanılama modülü (istemcinin var olan akışıyla uyumlu).
// Gerçek modüller eklendikçe buraya sürüm tanımı + declarative artifact eklenir.
function moduleReleases() {
  const newsArtifact = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    moduleId: 'fraude.news',
    version: '0.1.1',
    runtime: { kind: 'declarative-v1' },
    requests: [{ id: 'workspace-language', capability: 'storage:workspace', operation: 'workspace.read-preferences' }],
    files: [{
      path: 'views/news-feed.json',
      mediaType: 'application/json',
      content: JSON.stringify({ title: 'News security bulletin', summary: 'Signed declarative module content.' }),
    }],
    contributions: [{
      slot: 'module-center',
      kind: 'notice',
      title: { tr: 'Güvenli modül çalıştı', en: 'Secure module loaded' },
      body: {
        tr: 'Bu içerik çalıştırılabilir kod olmadan deklaratif sandbox içinde doğrulandı.',
        en: 'This content was validated in the declarative sandbox without executable code.',
      },
    }],
    tests: [
      { name: 'news-view-json', kind: 'json-valid', path: 'views/news-feed.json' },
      { name: 'signed-content', kind: 'contains', path: 'views/news-feed.json', value: 'Signed declarative' },
    ],
  }));

  return [{
    channel: 'official',
    artifact: newsArtifact,
    unsignedFor: (artifactHash) => ({
      manifest: {
        schemaVersion: 1,
        id: 'fraude.news',
        version: '0.1.1',
        name: { tr: 'Haber Akışı', en: 'News Feed' },
        description: {
          tr: 'FMUP imza ve staging tanılama sürümü.',
          en: 'FMUP signature and staging diagnostic release.',
        },
        kind: 'workspace',
        channel: 'official',
        targets: ['web', 'desktop'],
        compatibility: { fraude: '>=0.1.0 <1.0.0' },
        permissions: ['api:news', 'storage:workspace'],
        navigation: { tabKind: 'news', titleKey: 'newsFeed' },
        artifact: {
          sha256: artifactHash,
          url: `${publicBaseUrl}/v1/artifacts/${artifactHash}`,
          sizeBytes: newsArtifact.byteLength,
        },
      },
      baseArtifactHash: 'embedded:fraude.news@0.1.0',
      changes: [{
        path: 'views/news-feed.json',
        kind: 'modify',
        summary: {
          tr: 'Registry güven zinciri tanılaması.',
          en: 'Registry trust-chain diagnostic.',
        },
      }],
      releaseNotes: {
        tr: 'İmza, SHA-256, snapshot, aktivasyon ve rollback zincirini test eden çalıştırılamaz tanılama paketi.',
        en: 'A non-executable diagnostic package for testing signature, SHA-256, snapshot, activation, and rollback.',
      },
    }),
  }];
}

// ── Sunucuya yayınla (POST /v1/registry/releases) ────────────────────────────
async function publishToServer(signed, artifact) {
  if (!adminToken) throw new Error('FRAUDE_REGISTRY_ADMIN_TOKEN gerekli (yayın modu)');
  const res = await fetch(`${publishUrl}/v1/registry/releases`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ release: signed, artifactBase64: artifact.toString('base64') }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`yayın hatası ${res.status}: ${text}`);
  return JSON.parse(text);
}

// ── Derleme / yayın ──────────────────────────────────────────────────────────
async function build() {
  const { privateKey, publicKey } = loadOrCreateKeypair();
  const publicJwk = publicKey.export({ format: 'jwk' });
  const trust = {
    keys: [{ id: keyId, algorithm: 'Ed25519', publicKey: publicJwk.x, channels: ['official'] }],
  };

  // Her sürümü imzala.
  const signedReleases = [];
  for (const release of moduleReleases()) {
    const artifactHash = createHash('sha256').update(release.artifact).digest('hex');
    const unsigned = release.unsignedFor(artifactHash);
    const payload = JSON.stringify(stableValue(unsigned));
    const signature = sign(null, Buffer.from(payload), privateKey).toString('base64url');
    const signed = { ...unsigned, provenance: { algorithm: 'Ed25519', keyId, signature } };
    signedReleases.push({ signed, artifact: release.artifact, artifactHash, channel: release.channel });
    console.log(`İmzalandı: ${unsigned.manifest.id}@${unsigned.manifest.version}  (artifact ${artifactHash.slice(0, 12)}…)`);
  }

  if (publishUrl) {
    // Yayın modu: yerelde imzala → sunucuya gönder. (Güven anahtarı ayrıca,
    // bir kez, out-of-band deploy edilir; yayın token'ı trust'ı değiştiremez.)
    console.log(`\nYayınlanıyor → ${publishUrl}/v1/registry/releases`);
    for (const { signed, artifact } of signedReleases) {
      const receipt = await publishToServer(signed, artifact);
      console.log(`  ✓ ${receipt.published.id}@${receipt.published.version} (kanal ${receipt.published.channel})`);
    }
    console.log('\nHatırlatma: sunucuda trust/keys.json bir kez deploy edilmiş olmalı ve');
    console.log('istemcide VITE_FRAUDE_TRUST_KEYS pinlenmiş olmalı:');
    console.log(JSON.stringify(trust.keys));
    return;
  }

  // Derleme modu: imzalı statik veri dizini üret (elle deploy / yerel test).
  writeFileAtomic(resolve(dataDir, 'trust/keys.json'), JSON.stringify(trust, null, 2));
  const byChannel = new Map();
  for (const { signed, artifact, artifactHash, channel } of signedReleases) {
    writeFileAtomic(resolve(dataDir, 'artifacts', artifactHash), artifact);
    if (!byChannel.has(channel)) byChannel.set(channel, []);
    byChannel.get(channel).push(signed);
  }
  for (const [channel, releases] of byChannel) {
    writeFileAtomic(resolve(dataDir, 'channels', channel, 'latest.json'), JSON.stringify({ releases }, null, 2));
  }
  console.log(`\nRegistry veri dizini hazır: ${dataDir}`);
  console.log(`Public base URL (artifact URL'lerine gömüldü): ${publicBaseUrl}`);
  console.log('\nÜretimde istemciye pinlenecek güven anahtarı (VITE_FRAUDE_TRUST_KEYS):');
  console.log(JSON.stringify(trust.keys));
}

build().catch((e) => {
  console.error('HATA:', e.message || e);
  process.exit(1);
});
