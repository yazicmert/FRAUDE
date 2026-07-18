#!/usr/bin/env node
// FRAUDE lisans anahtarı üretici (yalnızca yerelde, service-role ile çalışır).
//
//   node scripts/gen-licenses.mjs --count 10 --plan pro --devices 2 \
//        --expires 2027-07-18 --note "X firması" [--dry-run]
//
// Anahtar biçimi: FRAUDE-XXXX-XXXX-XXXX-YYYY (son grup SHA-256 checksum).
// Algoritma src/features/auth/license.ts ile AYNIDIR; ikisi birlikte değişir.
// DB'ye yalnız SHA-256 özet yazılır; düz anahtarlar ekrana ve
// scripts/licenses-<zaman>.csv dosyasına (gitignore'lu) döker.
//
// Kimlik: scripts/.env içinden SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY okunur
// (ortam değişkeni öncelikli). Service-role anahtarı repo'ya asla girmez.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const PAYLOAD_LEN = 12;
const CHECK_LEN = 4;

const scriptsDir = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = join(scriptsDir, '.env');
  const fromFile = {};
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match) fromFile[match[1]] = match[2];
    }
  }
  return {
    url: process.env.SUPABASE_URL ?? fromFile.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? fromFile.SUPABASE_SERVICE_ROLE_KEY,
  };
}

function parseArgs(argv) {
  const args = { count: 5, plan: 'standard', devices: 2, expires: null, note: '', dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--dry-run') args.dryRun = true;
    else if (key === '--count') args.count = Number(argv[++i]);
    else if (key === '--plan') args.plan = argv[++i];
    else if (key === '--devices') args.devices = Number(argv[++i]);
    else if (key === '--expires') args.expires = argv[++i];
    else if (key === '--note') args.note = argv[++i];
    else {
      console.error(`Bilinmeyen argüman: ${key}`);
      process.exit(1);
    }
  }
  if (!Number.isInteger(args.count) || args.count < 1 || args.count > 500) {
    console.error('--count 1-500 arası olmalı');
    process.exit(1);
  }
  if (args.expires && Number.isNaN(Date.parse(args.expires))) {
    console.error('--expires geçerli bir tarih olmalı (örn. 2027-07-18)');
    process.exit(1);
  }
  return args;
}

async function sha256Bytes(text) {
  return new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

async function sha256Hex(text) {
  return [...(await sha256Bytes(text))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function checksum(payload) {
  const bytes = await sha256Bytes(payload);
  let out = '';
  for (let i = 0; i < CHECK_LEN; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

async function generateKey() {
  const random = new Uint8Array(PAYLOAD_LEN);
  webcrypto.getRandomValues(random);
  let payload = '';
  for (const byte of random) payload += ALPHABET[byte % ALPHABET.length];
  const full = payload + (await checksum(payload));
  return `FRAUDE-${full.match(/.{4}/g).join('-')}`;
}

async function main() {
  const args = parseArgs(process.argv);
  const { url, serviceKey } = loadEnv();

  if (!args.dryRun && (!url || !serviceKey || serviceKey.includes('BURAYA'))) {
    console.error(
      'scripts/.env içinde SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY tanımlı olmalı.\n' +
        '(Denemek için: --dry-run ile DB yazmadan anahtar üretebilirsiniz.)',
    );
    process.exit(1);
  }

  const rows = [];
  const keys = [];
  for (let i = 0; i < args.count; i += 1) {
    const key = await generateKey();
    keys.push(key);
    rows.push({
      key_hash: await sha256Hex(key),
      plan: args.plan,
      max_devices: args.devices,
      expires_at: args.expires ? new Date(args.expires).toISOString() : null,
      note: args.note || null,
    });
  }

  if (!args.dryRun) {
    const response = await fetch(`${url}/rest/v1/licenses`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(rows),
    });
    if (!response.ok) {
      console.error(`Supabase hatası (${response.status}): ${await response.text()}`);
      process.exit(1);
    }
  }

  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const csvPath = join(scriptsDir, `licenses-${stamp}.csv`);
  const csv = ['key,plan,max_devices,expires_at,note']
    .concat(keys.map((key) => `${key},${args.plan},${args.devices},${args.expires ?? ''},"${args.note}"`))
    .join('\n');
  writeFileSync(csvPath, `${csv}\n`);

  console.log(`\n${args.dryRun ? '[KURU ÇALIŞMA — DB\'ye yazılmadı]\n' : ''}Üretilen anahtarlar (${keys.length}):\n`);
  for (const key of keys) console.log(`  ${key}`);
  console.log(`\nPlan: ${args.plan} · Cihaz limiti: ${args.devices} · Bitiş: ${args.expires ?? 'süresiz'}`);
  console.log(`CSV: ${csvPath}`);
  console.log('Bu listeyi güvenli bir yerde saklayın; DB yalnızca özetleri tutar, anahtarlar geri okunamaz.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
