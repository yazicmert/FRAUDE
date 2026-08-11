#!/usr/bin/env node
// FRAUDE — Supabase projeden projeye veri taşıma.
//
// Şemayı TAŞIMAZ; önce hedefte docs/supabase-licenses.sql, supabase-site.sql ve
// supabase-notify.sql çalıştırılmış olmalıdır. Bu script yalnız SATIRLARI ve
// auth kullanıcılarını kopyalar.
//
// Kullanım:
//   SRC_URL=... SRC_SERVICE_KEY=... DST_URL=... DST_SERVICE_KEY=... \
//     node scripts/migrate-supabase.mjs            # kuru çalışma (hiçbir şey yazmaz)
//     node scripts/migrate-supabase.mjs --apply    # gerçekten yazar
//
// Tekrar çalıştırılabilir: her tablo birincil anahtar üzerinden upsert edilir,
// kullanıcılar zaten varsa atlanır. Kaynağa HİÇBİR yazma yapılmaz.
//
// PAROLALAR: auth API parola hash'ini okutmaz. Bu yolla taşınan e-posta/parola
// kullanıcıları yeni projede parolalarını sıfırlamak zorunda kalır. Parolaları
// korumak istiyorsan bunun yerine auth şemasını pg_dump ile taşı —
// bkz. docs/SUPABASE-MIGRATION.md.

const APPLY = process.argv.includes('--apply');

const SRC_URL = process.env.SRC_URL?.replace(/\/$/, '');
const SRC_KEY = process.env.SRC_SERVICE_KEY;
const DST_URL = process.env.DST_URL?.replace(/\/$/, '');
const DST_KEY = process.env.DST_SERVICE_KEY;

for (const [name, value] of Object.entries({ SRC_URL, SRC_SERVICE_KEY: SRC_KEY, DST_URL, DST_SERVICE_KEY: DST_KEY })) {
  if (!value) {
    console.error(`Eksik ortam değişkeni: ${name}`);
    process.exit(1);
  }
}
if (SRC_URL === DST_URL) {
  console.error('SRC_URL ve DST_URL aynı — yanlışlıkla kendi üstüne yazmayı önlemek için durduruldu.');
  process.exit(1);
}

const srcHead = { apikey: SRC_KEY, Authorization: `Bearer ${SRC_KEY}` };
const dstHead = { apikey: DST_KEY, Authorization: `Bearer ${DST_KEY}` };

// Yabancı anahtar sırası: auth.users → licenses → geri kalanı.
const TABLES = [
  { name: 'bist_tickers', conflict: 'code' },
  { name: 'licenses', conflict: 'id' },
  { name: 'admins', conflict: 'user_id' },
  { name: 'license_activations', conflict: 'id' },
  { name: 'license_requests', conflict: 'id' },
  { name: 'notify_prefs', conflict: 'user_id' },
  { name: 'notify_deliveries', conflict: 'id' },
  { name: 'notify_seen', conflict: 'source' },
];

async function readAll(table) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${SRC_URL}/rest/v1/${table}?select=*&limit=1000&offset=${offset}`, { headers: srcHead });
    if (!res.ok) throw new Error(`${table} okunamadı: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  return rows;
}

async function writeAll(table, conflict, rows) {
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const res = await fetch(`${DST_URL}/rest/v1/${table}?on_conflict=${conflict}`, {
      method: 'POST',
      headers: {
        ...dstHead,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) throw new Error(`${table} yazılamadı: ${res.status} ${(await res.text()).slice(0, 300)}`);
    written += chunk.length;
  }
  return written;
}

async function listUsers(url, head) {
  const users = [];
  for (let page = 1; ; page += 1) {
    const res = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: head });
    if (!res.ok) throw new Error(`kullanıcılar okunamadı: ${res.status}`);
    const list = (await res.json()).users ?? [];
    users.push(...list);
    if (list.length < 200) break;
  }
  return users;
}

console.log(`Kaynak : ${SRC_URL}`);
console.log(`Hedef  : ${DST_URL}`);
console.log(APPLY ? 'Kip    : YAZIYOR (--apply)\n' : 'Kip    : kuru çalışma (yazmak için --apply ekle)\n');

// ── 1) auth kullanıcıları ────────────────────────────────────────────────────
// UUID'ler KORUNUR: licenses.activated_by, admins.user_id, notify_prefs.user_id
// hepsi bu kimliklere bağlı.
const srcUsers = await listUsers(SRC_URL, srcHead);
const dstUsers = await listUsers(DST_URL, dstHead);
const dstIds = new Set(dstUsers.map((u) => u.id));
const dstEmails = new Set(dstUsers.map((u) => (u.email ?? '').toLowerCase()));

console.log(`=== auth.users: kaynakta ${srcUsers.length}, hedefte ${dstUsers.length} ===`);
let created = 0;
let skipped = 0;
const oauthUsers = [];

for (const u of srcUsers) {
  if (dstIds.has(u.id) || dstEmails.has((u.email ?? '').toLowerCase())) {
    skipped += 1;
    continue;
  }
  const provider = (u.app_metadata ?? {}).provider ?? 'email';
  if (provider !== 'email') oauthUsers.push(`${u.email} (${provider})`);

  const body = {
    id: u.id,
    email: u.email,
    email_confirm: Boolean(u.email_confirmed_at),
    user_metadata: u.user_metadata ?? {},
    app_metadata: u.app_metadata ?? {},
  };
  if (!APPLY) {
    console.log(`  [kuru] oluşturulacak: ${u.email}  id=${u.id}  sağlayıcı=${provider}`);
    created += 1;
    continue;
  }
  const res = await fetch(`${DST_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { ...dstHead, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.log(`  HATA ${u.email}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    continue;
  }
  console.log(`  oluşturuldu: ${u.email}  id=${u.id}`);
  created += 1;
}
console.log(`  → ${created} oluşturuldu / oluşturulacak, ${skipped} zaten var\n`);

// ── 2) public tablolar ───────────────────────────────────────────────────────
for (const { name, conflict } of TABLES) {
  const rows = await readAll(name);
  if (rows.length === 0) {
    console.log(`${name.padEnd(22)} 0 satır — atlandı`);
    continue;
  }
  if (!APPLY) {
    console.log(`${name.padEnd(22)} ${String(rows.length).padStart(5)} satır [kuru]`);
    continue;
  }
  const n = await writeAll(name, conflict, rows);
  console.log(`${name.padEnd(22)} ${String(n).padStart(5)} satır yazıldı`);
}

console.log('\n=== SONRASINDA YAPILACAKLAR ===');
if (oauthUsers.length) {
  console.log(`• OAuth kullanıcıları yeni projede sağlayıcıyı yeniden bağlamalı: ${oauthUsers.join(', ')}`);
  console.log('  (GitHub OAuth uygulamasının callback adresi yeni proje referansına göre güncellenmeli.)');
}
console.log('• E-posta/parola kullanıcıları parola sıfırlamalı (API parola hash\'i taşımaz).');
console.log('• Edge Function gizli anahtarları: supabase secrets set … (bkz. docs/SUPABASE-MIGRATION.md)');
if (!APPLY) console.log('\nHiçbir şey yazılmadı. Gerçekten taşımak için: --apply');
