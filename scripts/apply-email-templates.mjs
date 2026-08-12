#!/usr/bin/env node
// FRAUDE — Auth e-posta şablonlarını Supabase'e uygular.
//
// Depodaki docs/email-templates/*.html TEK doğru kaynaktır; bu betik onları
// Authentication → Emails alanına yazar. Elle kopyala-yapıştır yapılırsa depo
// ile pano sessizce ayrışır (taşımada bunun bedeli görüldü).
//
// Şablonlar TR ve EN'i birlikte taşır: Go template içindeki koşullar dili
// seçer (ayrıntı için dosyaların başındaki açıklamalara bak). Konu satırları
// da templatelenir — GoTrue'nun kendi varsayılanı `{{ .Token }} is your
// verification code` olduğu için bu desteklendiği kesindir.
//
// Kullanım:
//   node scripts/apply-email-templates.mjs [--project-ref <ref>] [--dry-run]
//
// Erişim jetonu sırayla aranır:
//   1) SUPABASE_ACCESS_TOKEN ortam değişkeni
//   2) macOS anahtar zinciri ("Supabase CLI" servisi — supabase login yazar)

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_REF = 'emrusyelfekcfyisfzzl';
const SITE = 'https://fraude.intelligentverseconnection.com';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const refIndex = args.indexOf('--project-ref');
const projectRef = refIndex >= 0 ? args[refIndex + 1] : DEFAULT_REF;

function accessToken() {
  const fromEnv = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  try {
    return execFileSync('security', ['find-generic-password', '-s', 'Supabase CLI', '-w'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    console.error(
      'Erişim jetonu yok. SUPABASE_ACCESS_TOKEN ver ya da `supabase login` çalıştır.',
    );
    process.exit(1);
  }
}

const template = (name) => readFileSync(join(ROOT, 'docs/email-templates', name), 'utf8');

// Konu satırının dil koşulu gövdedekiyle AYNI mantığı taşır; şablon
// değişkenleri iki alan arasında paylaşılmadığı için tekrar yazılır.
const langIsEn = 'eq (printf "%v" .Data.lang) "en"';
const resetEn = `eq .RedirectTo "${SITE}/sifre-yenile?lang=en"`;
const resetTr = `ne .RedirectTo "${SITE}/sifre-yenile?lang=tr"`;

const payload = {
  mailer_subjects_confirmation:
    `{{ if ${langIsEn} }}FRAUDE Terminal — confirm your account` +
    `{{ else }}FRAUDE Terminal — hesabını doğrula{{ end }}`,
  mailer_templates_confirmation_content: template('confirm-signup.html'),
  mailer_subjects_recovery:
    `{{ if or (${resetEn}) (and (${resetTr}) (${langIsEn})) }}FRAUDE Terminal — reset your password` +
    `{{ else }}FRAUDE Terminal — şifreni yenile{{ end }}`,
  mailer_templates_recovery_content: template('reset-password.html'),
};

for (const [key, value] of Object.entries(payload)) {
  if (!value?.trim()) {
    console.error(`Boş içerik: ${key}`);
    process.exit(1);
  }
}
// Değişkenler kaybolursa e-posta işe yaramaz hale gelir; sessizce geçmesin.
for (const name of ['confirm-signup.html', 'reset-password.html']) {
  const html = template(name);
  for (const variable of ['{{ .ConfirmationURL }}', '{{ .Email }}']) {
    if (!html.includes(variable)) {
      console.error(`${name} içinde ${variable} yok — yanlış dosya?`);
      process.exit(1);
    }
  }
}

const api = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;
const headers = {
  Authorization: `Bearer ${accessToken()}`,
  'Content-Type': 'application/json',
  // Varsayılan istemci kimliğiyle API 403 döner; açık bir ad şart.
  'User-Agent': 'fraude-apply-email-templates/1.0',
};

if (dryRun) {
  console.log(`(kuru çalışma) proje ${projectRef} — yazılacaklar:`);
  for (const [key, value] of Object.entries(payload)) {
    console.log(`  ${key}: ${value.length} karakter`);
  }
  process.exit(0);
}

const patch = await fetch(api, { method: 'PATCH', headers, body: JSON.stringify(payload) });
if (!patch.ok) {
  console.error(`PATCH başarısız (${patch.status}):`, await patch.text());
  process.exit(1);
}

// Geri okuyup doğrula: "uyguladım" demek yetmez, yazıldığı görülmeli.
const after = await (await fetch(api, { headers })).json();
let ok = true;
for (const [key, value] of Object.entries(payload)) {
  const same = after[key] === value;
  ok &&= same;
  console.log(`  ${key.replace('mailer_', '').padEnd(36)} ${same ? 'EŞLEŞTİ' : 'FARKLI'}`);
}
console.log(ok ? '\nŞablonlar uygulandı.' : '\nDOĞRULAMA BAŞARISIZ');
process.exit(ok ? 0 : 1);
