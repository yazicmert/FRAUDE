#!/usr/bin/env node
// FRAUDE — Supabase taşımasını uçtan uca yürütür.
//
//   cp scripts/.env.migration.example scripts/.env.migration   # doldur
//   node scripts/run-migration.mjs            # kuru çalışma: ne olacağını yazar
//   node scripts/run-migration.mjs --apply    # gerçekten uygular
//
// Eksik kimlik bilgisi olan adımı ATLAR ve nedenini söyler; elindekiyle
// başlayıp sonra tamamlayabilirsin. Her adım tekrar çalıştırılabilir.
//
// Adımlar:
//   1 şema        supabase db push            (DST_DB_PASSWORD)
//   2 auth ayarı  supabase config push        (SMTP_* / GITHUB_*)
//   3 gizliler    supabase secrets set        (BREVO_API_KEY, LLM_API_KEY…)
//   4 parolalar   pg_dump auth → psql         (SRC_DB_PASSWORD + DST_DB_PASSWORD)
//   5 veri        migrate-supabase.mjs        (SRC/DST_SERVICE_KEY)
//   6 cron        pg_cron + pg_net kur        (DST_DB_PASSWORD + CRON_SECRET)
//   7 istemci     kaynak koddaki proje adresi (DST_ANON_KEY)

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APPLY = process.argv.includes('--apply');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
      .filter(([, v]) => v !== ''),
  );
}

// Eski proje anahtarları scripts/.env'de. Worktree'den çalışırken o dosya
// yalnız ana çalışma kopyasında bulunur; oraya da bak.
function mainCheckout() {
  try {
    const gitCommon = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    return dirname(gitCommon); // .../fraude/.git → .../fraude
  } catch {
    return null;
  }
}

const envPaths = [resolve(ROOT, 'scripts/.env')];
const main = mainCheckout();
if (main && main !== ROOT) envPaths.push(resolve(main, 'scripts/.env'));
envPaths.push(resolve(ROOT, 'scripts/.env.migration'));

const env = Object.assign({}, ...envPaths.map(readEnvFile));
// scripts/.env eski projeyi SUPABASE_URL adıyla tutuyor.
env.SRC_URL ??= env.SUPABASE_URL;
env.SRC_SERVICE_KEY ??= env.SUPABASE_SERVICE_ROLE_KEY;

const REF = 'emrusyelfekcfyisfzzl';
const results = [];

function have(...names) {
  return names.filter((n) => !env[n]);
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
    ...opts,
  });
}

function step(id, title, needs, action) {
  if (ONLY && ONLY !== id) return;
  const missing = have(...needs);
  process.stdout.write(`\n── ${id}. ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}\n`);
  if (missing.length) {
    console.log(`   ATLANDI — eksik: ${missing.join(', ')}`);
    results.push([id, title, 'atlandı', missing.join(', ')]);
    return;
  }
  if (!APPLY) {
    console.log('   [kuru] hazır — --apply ile çalışacak');
    results.push([id, title, 'hazır', '']);
    return;
  }
  try {
    const note = action() ?? '';
    console.log(`   ✓ tamam ${note}`);
    results.push([id, title, 'tamam', note]);
  } catch (err) {
    const msg = (err.stderr || err.stdout || err.message || '').toString().trim().split('\n').slice(-3).join(' | ');
    console.log(`   ✗ HATA: ${msg.slice(0, 400)}`);
    results.push([id, title, 'HATA', msg.slice(0, 200)]);
  }
}

// Supabase'in doğrudan DB adresi (db.<ref>.supabase.co) yalnız IPv6 çözümlenir;
// IPv4 ağlardan erişilmez. Havuz (pooler) adresi IPv4'tür, kullanıcı adı
// postgres.<ref> biçimindedir. Havuz konağı bölgeye göre değişir (aws-0/aws-1).
const POOLERS = ['aws-1-eu-west-1.pooler.supabase.com', 'aws-0-eu-west-1.pooler.supabase.com'];

function dbUrl(host, password, user = 'postgres') {
  return `postgresql://${user}:${encodeURIComponent(password)}@${host}:5432/postgres`;
}

// Çalışan havuz adresini bulup psql'i orada koşturur.
function psql(ref, password, args) {
  let lastErr;
  for (const host of POOLERS) {
    try {
      return run('psql', [dbUrl(host, password, `postgres.${ref}`), '-v', 'ON_ERROR_STOP=1', ...args]);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

console.log(`FRAUDE Supabase taşıması → ${REF}`);
console.log(APPLY ? 'Kip: UYGULUYOR (--apply)' : 'Kip: kuru çalışma (yazmak için --apply ekle)');

// ── 1. Şema ─────────────────────────────────────────────────────────────────
step('sema', 'Şema (db push)', ['DST_DB_PASSWORD'], () => {
  run('supabase', ['db', 'push', '--linked', '--include-all', '--yes', '-p', env.DST_DB_PASSWORD]);
  return '3 migration uygulandı';
});

// ── 2. Auth ayarları ────────────────────────────────────────────────────────
step(
  'auth',
  'Auth ayarları (config push)',
  ['SITE_URL', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'ADMIN_EMAIL', 'GITHUB_CLIENT_ID', 'GITHUB_SECRET'],
  () => {
    run('supabase', ['config', 'push', '--yes']);
    return 'redirect URL, SMTP ve GitHub sağlayıcısı kuruldu';
  },
);

// ── 3. Edge Function gizli anahtarları ──────────────────────────────────────
step('gizli', 'Edge Function gizli anahtarları', ['BREVO_API_KEY', 'MAIL_FROM', 'CRON_SECRET'], () => {
  const pairs = [
    'BREVO_API_KEY',
    'MAIL_FROM',
    'ADMIN_EMAIL',
    'SITE_URL',
    'CRON_SECRET',
    'LLM_API_KEY',
    'LLM_BASE_URL',
    'LLM_MODEL',
  ]
    .filter((k) => env[k])
    .map((k) => `${k}=${env[k]}`);
  run('supabase', ['secrets', 'set', '--project-ref', REF, ...pairs]);
  return `${pairs.length} anahtar yazıldı`;
});

// ── 4. Parolalar (auth.users + auth.identities) ─────────────────────────────
step('parola', 'Kullanıcı parolaları (pg_dump)', ['SRC_DB_PASSWORD', 'DST_DB_PASSWORD'], () => {
  const dump = run('pg_dump', [
    '--data-only',
    '--table=auth.users',
    '--table=auth.identities',
    dbUrl(POOLERS[0], env.SRC_DB_PASSWORD, 'postgres.frfbmutvkekctpacktlz'),
  ]);
  const tmp = resolve(ROOT, 'scripts/.auth-dump.sql');
  writeFileSync(tmp, dump);
  psql(REF, env.DST_DB_PASSWORD, ['-f', tmp]);
  return 'parolalar korunarak taşındı (kullanıcılar aynı parolayla girer)';
});

// ── 5. Veri ─────────────────────────────────────────────────────────────────
step('veri', 'Tablo verisi', ['SRC_URL', 'SRC_SERVICE_KEY', 'DST_URL', 'DST_SERVICE_KEY'], () => {
  const out = run('node', ['scripts/migrate-supabase.mjs', '--apply']);
  const lines = out.trim().split('\n').filter((l) => /satır yazıldı|oluşturuldu/.test(l));
  return `\n     ${lines.join('\n     ')}`;
});

// ── 6. Zamanlama ────────────────────────────────────────────────────────────
step('cron', 'pg_cron zamanlaması', ['DST_DB_PASSWORD', 'CRON_SECRET'], () => {
  const sql = `
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('market-watch') where exists (select 1 from cron.job where jobname = 'market-watch');
select cron.unschedule('refresh-bist-universe') where exists (select 1 from cron.job where jobname = 'refresh-bist-universe');
select cron.schedule('market-watch', '*/10 * * * *', $CRON$
  select net.http_post(
    url := 'https://${REF}.supabase.co/functions/v1/market-watch',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','${env.CRON_SECRET}'),
    body := '{}'::jsonb
  );
$CRON$);
select cron.schedule('refresh-bist-universe', '30 6 * * *', $CRON$
  select net.http_post(
    url := 'https://${REF}.supabase.co/functions/v1/refresh-bist-universe',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','${env.CRON_SECRET}'),
    body := '{}'::jsonb
  );
$CRON$);
`;
  const tmp = resolve(ROOT, 'scripts/.cron.sql');
  writeFileSync(tmp, sql);
  psql(REF, env.DST_DB_PASSWORD, ['-f', tmp]);
  return 'market-watch (10 dk) + refresh-bist-universe (06:30) kuruldu';
});

// ── 7. İstemci kaynak kodu ──────────────────────────────────────────────────
step('istemci', 'İstemci proje adresi', ['DST_URL', 'DST_ANON_KEY'], () => {
  // Chrome eklentisi de aynı projeye konuşur: adresi host_permissions'da ve üç
  // betikte tutar; anon anahtarı gömmez, kullanıcının kendi oturumunu taşır.
  const targets = [
    'src/features/auth/supabaseClient.ts',
    'site/src/lib/supabase.ts',
    'extension/manifest.json',
    'extension/background.js',
    'extension/popup.js',
    'extension/options.js',
  ];
  const touched = [];
  for (const rel of targets) {
    const path = resolve(ROOT, rel);
    if (!existsSync(path)) continue;
    const before = readFileSync(path, 'utf8');
    const after = before
      .replace(/https:\/\/frfbmutvkekctpacktlz\.supabase\.co/g, env.DST_URL)
      .replace(/(SUPABASE_PUBLISHABLE_KEY\s*=\s*)'[^']*'/, `$1'${env.DST_ANON_KEY}'`);
    if (after !== before) {
      writeFileSync(path, after);
      touched.push(rel);
    }
  }
  return touched.length ? `güncellendi: ${touched.join(', ')}` : 'değişiklik gerekmedi';
});

// ── Özet ────────────────────────────────────────────────────────────────────
console.log('\n\n═══ ÖZET ═══');
for (const [, title, state, note] of results) {
  console.log(`  ${state.padEnd(8)} ${title}${note && state !== 'tamam' ? ` — ${note}` : ''}`);
}
const skipped = results.filter((r) => r[2] === 'atlandı');
if (skipped.length) {
  console.log(`\n${skipped.length} adım atlandı. scripts/.env.migration içindeki eksikleri doldurup tekrar çalıştır.`);
}
if (!APPLY) console.log('\nHiçbir şey değiştirilmedi. Uygulamak için: node scripts/run-migration.mjs --apply');
else console.log('\nSon adım: npm run build && npm --prefix site run build');
