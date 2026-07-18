// FRAUDE — BIST hisse evrenini KAP'tan tazeler (public bist_tickers tablosu).
//
// Web bildirim panelindeki hisse otomatik-tamamlaması bu tabloyu okur; böylece
// yeni halka arzlar/pay grupları bir sonraki tazelemede kendiliğinden görünür
// (tarayıcı KAP'a CORS nedeniyle doğrudan erişemez, sunucu erişir).
// `kap.org.tr/tr/bist-sirketler` sayfasını core/src/bist_universe.rs ile aynı
// mantıkla ayrıştırır. pg_cron ile günde bir tetiklenir; CRON_SECRET ile korunur.
//
// Kurulum: supabase functions deploy refresh-bist-universe --no-verify-jwt --use-api
// Secrets: CRON_SECRET (paylaşılan). Zamanlama docs/supabase-site.sql sonunda.

import { createClient } from 'npm:@supabase/supabase-js@2';

const KAP_LIST_URL = 'https://www.kap.org.tr/tr/bist-sirketler';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** Şirket satırlarından [kod, ünvan] çiftlerini çıkarır (bist_universe.rs kopyası). */
function parseSymbols(html: string): Array<[string, string]> {
  // slug → ünvan: düz metinli anchor (içinde <div> yok)
  const slugName = new Map<string, string>();
  const nameRe = /href="(\/tr\/sirket-bilgileri\/ozet\/[^"]+)">([^<]+)<\/a>/g;
  let nm: RegExpExecArray | null;
  while ((nm = nameRe.exec(html)) !== null) {
    const name = nm[2].trim();
    if (name && !slugName.has(nm[1])) slugName.set(nm[1], name);
  }

  // ticker hücresi: aynı slug'a giden, içinde bir veya daha çok <div>KOD</div> olan anchor
  const rowRe = /href="(\/tr\/sirket-bilgileri\/ozet\/[^"]+)">((?:\s*<div>[^<]*<\/div>)+)\s*<\/a>/g;
  const codeRe = /<div>([^<]*)<\/div>/g;
  const seen = new Set<string>();
  const out: Array<[string, string]> = [];
  let row: RegExpExecArray | null;
  while ((row = rowRe.exec(html)) !== null) {
    const name = slugName.get(row[1]) ?? '';
    let c: RegExpExecArray | null;
    codeRe.lastIndex = 0;
    while ((c = codeRe.exec(row[2])) !== null) {
      const code = c[1].trim().toUpperCase();
      if (code.length >= 3 && code.length <= 6 && /^[A-Z0-9]+$/.test(code) && !seen.has(code)) {
        seen.add(code);
        out.push([code, name]);
      }
    }
  }
  return out;
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret && req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401 });
  }

  let html: string;
  try {
    const res = await fetch(KAP_LIST_URL, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'tr-TR,tr;q=0.9' },
    });
    if (!res.ok) return new Response(JSON.stringify({ ok: false, error: `kap-${res.status}` }), { status: 502 });
    html = await res.text();
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 502 });
  }

  const symbols = parseSymbols(html);
  if (symbols.length < 400) {
    // Beklenenden az → muhtemelen sayfa yapısı değişti; tabloyu bozma
    return new Response(JSON.stringify({ ok: false, error: 'too-few', count: symbols.length }), { status: 502 });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const now = new Date().toISOString();
  const rows = symbols.map(([code, name]) => ({ code, name, updated_at: now }));

  // Toplu upsert (parça parça, 500'lük)
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('bist_tickers').upsert(rows.slice(i, i + 500), { onConflict: 'code' });
    if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  }
  // Kotasyondan çıkanları temizle (bu turda görülmeyen kodlar)
  const codes = symbols.map(([c]) => c);
  await supabase.from('bist_tickers').delete().not('code', 'in', `(${codes.map((c) => `"${c}"`).join(',')})`);

  return new Response(JSON.stringify({ ok: true, count: symbols.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
