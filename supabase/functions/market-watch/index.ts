// FRAUDE — piyasa gözcüsü: KAP + SPK + haber akışlarını yoklar, Qwen ile
// önceliklendirir ve kullanıcıya Brevo ile mailler. Uygulama kapalıyken çalışır.
//
// Akış (pg_cron ile ~10 dk'da bir tetiklenir):
//   1) notify_seen imleçlerinden sonra gelen yeni KAP bildirimleri + NTV haberleri
//      + yeni SPK bülteni çekilir.
//   2) KAP/haber öğeleri Qwen'e verilir; model her öğe için ilgili BIST kodlarını,
//      1-5 önem puanını ve tek satır Türkçe özet döndürür (sağlayıcıdan bağımsız,
//      OpenAI-uyumlu chat/completions — app'teki katmanla aynı desen).
//   3) Her kullanıcı için: takip ettiği kod/anahtar kelimeyle eşleşen ve
//      min_priority eşiğini geçen öğeler markalı bir dijest mailinde gönderilir.
//      Yeni SPK bülteni, spk_enabled kullanıcılara düz bildirim olarak gider.
//   4) İmleçler en yeni öğeye ilerletilir.
//
// Kurulum (pano; CLI erişemez):
//   supabase functions deploy market-watch --no-verify-jwt --use-api
//   Secrets: LLM_API_KEY (Qwen/DashScope anahtarı, zorunlu),
//            LLM_BASE_URL (ops., varsayılan DashScope compatible-mode),
//            LLM_MODEL (ops., varsayılan qwen-plus),
//            CRON_SECRET (pg_cron ile paylaşılan gizli; header ile doğrulanır),
//            BREVO_API_KEY + MAIL_FROM (lisans maili ile ortak).
// Zamanlama pg_cron + pg_net ile kurulur (docs/supabase-site.sql sonundaki blok).

import { createClient } from 'npm:@supabase/supabase-js@2';

const LLM_BASE_URL = (Deno.env.get('LLM_BASE_URL') ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1')
  .replace(/\/chat\/completions\/?$/, '')
  .replace(/\/$/, '');
const LLM_MODEL = Deno.env.get('LLM_MODEL') ?? 'qwen-plus';
const KAP_FEED = 'https://www.kap.org.tr/tr/api/disclosure/list/light';
const NEWS_RSS = 'https://www.ntv.com.tr/ekonomi.rss';
const SPK_PAGE = 'https://spk.gov.tr/spk-bultenleri/2026-yili-spk-bultenleri';
const UA = 'Mozilla/5.0 (FRAUDE market-watch)';

interface FeedItem {
  source: 'kap' | 'news';
  key: string;          // dedup anahtarı (disclosureIndex / haber linki)
  title: string;
  body: string;
  url: string | null;
  tickers: string[];    // Qwen doldurur
  priority: number;     // Qwen doldurur (1-5)
  summary: string;      // Qwen doldurur (TR)
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stripTags(v: string): string {
  return v.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

// ── Kaynak çekiciler ────────────────────────────────────────────────────────
async function fetchKap(lastKey: string | null): Promise<FeedItem[]> {
  try {
    const res = await fetch(KAP_FEED, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(rows)) return [];
    const lastNum = lastKey ? Number(lastKey) : 0;
    const items: FeedItem[] = [];
    for (const r of rows) {
      const idx = Number(r.disclosureIndex);
      if (!Number.isFinite(idx) || idx <= lastNum) continue;
      const title = String(r.title ?? r.subject ?? '').trim();
      const summary = String(r.summary ?? '').trim();
      items.push({
        source: 'kap',
        key: String(idx),
        title,
        body: summary || title,
        url: `https://www.kap.org.tr/tr/Bildirim/${idx}`,
        tickers: [],
        priority: 3,
        summary: '',
      });
    }
    return items;
  } catch {
    return [];
  }
}

async function fetchNews(lastKey: string | null): Promise<FeedItem[]> {
  try {
    const res = await fetch(NEWS_RSS, { headers: { 'User-Agent': UA } });
    if (!res.ok) return [];
    const xml = await res.text();
    const items: FeedItem[] = [];
    const blocks = xml.split(/<item>/i).slice(1);
    for (const block of blocks) {
      const pick = (tag: string) => {
        const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
        if (!m) return '';
        return stripTags(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
      };
      const link = pick('link') || pick('guid');
      const title = pick('title');
      if (!link || !title) continue;
      if (lastKey && link === lastKey) break; // en yeniden eskiye — imlece varınca dur
      items.push({
        source: 'news',
        key: link,
        title,
        body: pick('description') || title,
        url: link,
        tickers: [],
        priority: 2,
        summary: '',
      });
    }
    return items;
  } catch {
    return [];
  }
}

/** SPK yeni haftalık bülteni. Döner: [bültenNo, pdfUrl] ya da null. */
async function fetchSpk(lastKey: string | null): Promise<{ no: string; url: string } | null> {
  try {
    const res = await fetch(SPK_PAGE, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    const html = await res.text();
    let bestNum = lastKey ? Number(lastKey.split('-')[1] ?? '0') : 0;
    let best: { no: string; url: string } | null = null;
    const re = /(?:href="([^"]*?(\d{4})-(\d+)\.pdf)")/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const num = Number(m[3]);
      if (num > bestNum) {
        bestNum = num;
        const href = m[1].startsWith('http') ? m[1] : `https://spk.gov.tr${m[1].startsWith('/') ? '' : '/'}${m[1]}`;
        best = { no: `${m[2]}-${m[3]}`, url: href };
      }
    }
    return best;
  } catch {
    return null;
  }
}

// ── Qwen önceliklendirme (OpenAI-uyumlu) ────────────────────────────────────
async function enrich(items: FeedItem[]): Promise<FeedItem[]> {
  const apiKey = Deno.env.get('LLM_API_KEY');
  if (!apiKey || items.length === 0) return items; // anahtar yoksa ham geç (priority varsayılan)

  const numbered = items.map((it, i) => `#${i} [${it.source}] ${it.title}\n${it.body}`.slice(0, 600)).join('\n\n');
  const sys =
    'Sen bir Borsa İstanbul haber/bildirim analistisin. Sana numaralı öğeler verilir. ' +
    'Her öğe için ilgili BIST hisse kodlarını (varsa), yatırımcı için önem puanını (1=önemsiz, 5=kritik) ' +
    've tek cümlelik Türkçe özet üret. Yalnızca şu biçimde JSON döndür: ' +
    '{"items":[{"i":<numara>,"tickers":["THYAO"],"priority":<1-5>,"summary":"..."}]}';

  try {
    const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: numbered },
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) {
      console.error('llm-failed', res.status, await res.text().catch(() => ''));
      return items;
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(content);
    for (const row of parsed.items ?? []) {
      const idx = Number(row.i);
      if (!Number.isInteger(idx) || idx < 0 || idx >= items.length) continue;
      const it = items[idx];
      if (Array.isArray(row.tickers)) it.tickers = row.tickers.map((t: unknown) => String(t).toUpperCase());
      const p = Number(row.priority);
      if (Number.isFinite(p)) it.priority = Math.min(5, Math.max(1, Math.round(p)));
      if (typeof row.summary === 'string' && row.summary.trim()) it.summary = row.summary.trim();
    }
  } catch (e) {
    console.error('llm-parse-failed', String(e));
  }
  return items;
}

// ── Kullanıcı eşleştirme + mail ─────────────────────────────────────────────
interface Pref {
  user_id: string;
  email: string;
  kap_enabled: boolean;
  news_enabled: boolean;
  spk_enabled: boolean;
  tickers: string[];
  keywords: string[];
  min_priority: number;
}

function matches(pref: Pref, item: FeedItem): boolean {
  if (item.source === 'kap' && !pref.kap_enabled) return false;
  if (item.source === 'news' && !pref.news_enabled) return false;
  const tickers = pref.tickers.map((t) => t.toUpperCase());
  if (tickers.length === 0 && pref.keywords.length === 0) return item.priority >= pref.min_priority;
  if (item.tickers.some((t) => tickers.includes(t))) return true;
  const hay = `${item.title} ${item.body}`.toLowerCase();
  if (tickers.some((t) => hay.includes(t.toLowerCase()))) return true;
  if (pref.keywords.some((k) => k.trim() && hay.includes(k.toLowerCase()))) return true;
  return false;
}

function renderDigest(items: FeedItem[], spk: { no: string; url: string } | null): string {
  const sorted = [...items].sort((a, b) => b.priority - a.priority);
  const rows = sorted
    .map((it) => {
      const dot = it.priority >= 5 ? '#ff6a5e' : it.priority >= 4 ? '#f5c542' : '#00e896';
      const tk = it.tickers.length ? `<span style="color:#00e896;font-weight:700;">${it.tickers.map(escapeHtml).join(', ')}</span> · ` : '';
      const link = it.url ? `<a href="${it.url}" style="color:#00c3ff;text-decoration:none;">Detay →</a>` : '';
      return `<tr><td style="padding:12px 0;border-bottom:1px solid #232a33;font-family:-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.6;color:#b7c2cc;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dot};margin-right:8px;"></span>
        ${tk}<span style="color:#e8f0f7;">${escapeHtml(it.summary || it.title)}</span> ${link}
      </td></tr>`;
    })
    .join('');
  const spkRow = spk
    ? `<tr><td style="padding:12px 0;border-bottom:1px solid #232a33;font-family:-apple-system,'Segoe UI',sans-serif;font-size:14px;color:#b7c2cc;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#00c3ff;margin-right:8px;"></span>
        <span style="color:#e8f0f7;">Yeni SPK bülteni yayımlandı (${escapeHtml(spk.no)})</span>
        <a href="${spk.url}" style="color:#00c3ff;text-decoration:none;"> Aç →</a></td></tr>`
    : '';
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"></head>
<body style="margin:0;padding:0;background-color:#0a0d12;" bgcolor="#0a0d12">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0a0d12" style="background-color:#0a0d12;"><tr><td align="center" style="padding:40px 16px;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:100%;">
      <tr><td align="center" style="padding-bottom:22px;font-family:'SF Mono',Menlo,monospace;font-size:20px;font-weight:800;letter-spacing:5px;color:#e8f0f7;"><span style="color:#00e896;">F</span>RAUDE</td></tr>
      <tr><td bgcolor="#10151d" style="background-color:#10151d;border:1px solid #232a33;border-radius:14px;padding:32px 30px;">
        <div style="font-family:-apple-system,'Segoe UI',sans-serif;font-size:19px;font-weight:700;color:#e8f0f7;margin-bottom:6px;">Takip bildirimlerin</div>
        <div style="font-family:-apple-system,'Segoe UI',sans-serif;font-size:13px;color:#8b949e;margin-bottom:14px;">AI önem sırasına göre dizildi.</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${spkRow}${rows}</table>
      </td></tr>
      <tr><td align="center" style="padding-top:22px;font-family:-apple-system,'Segoe UI',sans-serif;font-size:12px;line-height:1.7;color:#8b949e;">
        FRAUDE Terminal — finansal dostunuz<br>Bildirim tercihlerini hesabından değiştirebilirsin.</td></tr>
    </table></td></tr></table></body></html>`;
}

async function sendMail(to: string, subject: string, html: string): Promise<void> {
  const brevoKey = Deno.env.get('BREVO_API_KEY');
  const fromRaw = Deno.env.get('MAIL_FROM') ?? '';
  if (!brevoKey || !fromRaw) return;
  const m = fromRaw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const sender = m ? { name: m[1].trim() || 'FRAUDE', email: m[2].trim() } : { name: 'FRAUDE', email: fromRaw.trim() };
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': brevoKey, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender, to: [{ email: to }], subject, htmlContent: html }),
  });
  if (!res.ok) console.error('brevo-failed', res.status, await res.text().catch(() => ''));
}

// ── Ana akış ────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  // pg_cron paylaşılan gizli ile doğrulanır (fonksiyon --no-verify-jwt deploy edilir)
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret && req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401 });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: seenRows } = await supabase.from('notify_seen').select('source, last_key');
  const cursor: Record<string, string | null> = { kap: null, news: null, spk: null };
  for (const r of seenRows ?? []) cursor[r.source] = r.last_key;

  const [kapItems, newsItems, spkNew] = await Promise.all([
    fetchKap(cursor.kap),
    fetchNews(cursor.news),
    fetchSpk(cursor.spk),
  ]);

  let feed = [...kapItems, ...newsItems];
  if (feed.length > 40) feed = feed.slice(0, 40); // tek turda üst sınır (maliyet + gürültü)
  feed = await enrich(feed);

  const { data: prefs } = await supabase
    .from('notify_prefs')
    .select('user_id, email, kap_enabled, news_enabled, spk_enabled, tickers, keywords, min_priority')
    .eq('enabled', true);

  let sent = 0;
  for (const pref of (prefs ?? []) as Pref[]) {
    const mine = feed.filter((it) => matches(pref, it));
    const spkForUser = pref.spk_enabled ? spkNew : null;
    if (mine.length === 0 && !spkForUser) continue;
    const subject =
      mine.length > 0
        ? `FRAUDE — ${mine.length} yeni bildirim`
        : 'FRAUDE — yeni SPK bülteni';
    await sendMail(pref.email, subject, renderDigest(mine, spkForUser));
    sent++;
  }

  // İmleçleri en yeniye ilerlet (eşleşme olsun olmasın, tekrar işlenmesin)
  const advance: Array<{ source: string; last_key: string }> = [];
  if (kapItems.length > 0) {
    const maxKap = Math.max(...kapItems.map((i) => Number(i.key)));
    advance.push({ source: 'kap', last_key: String(maxKap) });
  }
  if (newsItems.length > 0) advance.push({ source: 'news', last_key: newsItems[0].key });
  if (spkNew) advance.push({ source: 'spk', last_key: spkNew.no });
  if (advance.length > 0) {
    await supabase.from('notify_seen').upsert(
      advance.map((a) => ({ ...a, updated_at: new Date().toISOString() })),
      { onConflict: 'source' },
    );
  }

  return new Response(
    JSON.stringify({ ok: true, new_items: feed.length, spk: spkNew?.no ?? null, mails_sent: sent }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
