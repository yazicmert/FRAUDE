// FRAUDE — piyasa gözcüsü: KAP + SPK + haber akışlarını ve kullanıcı fiyat alarmlarını
// yoklar, Qwen ile önceliklendirir ve kullanıcıya Brevo/SMTP ile mailler. Uygulama kapalıyken çalışır.
//
// Akış (pg_cron ile ~10 dk'da bir tetiklenir):
//   1) notify_seen imleçlerinden sonra gelen yeni KAP bildirimleri + NTV haberleri
//      + yeni SPK bülteni çekilir.
//   2) KAP/haber öğeleri Qwen'e verilir; model her öğe için ilgili BIST kodlarını,
//      1-5 önem puanını ve tek satır Türkçe özet döndürür.
//   3) user_alerts tablosundaki aktif özel alarmlar (fiyat kırılımları, özel KAP/haber anahtarları)
//      değerlendirilir ve eşleşenlere anında alarm maili gönderilir.
//   4) notify_prefs tercihine sahip kullanıcılara dijest maili iletilir.
//   5) İmleçler en yeni öğeye ilerletilir.

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

interface CustomAlertRow {
  id: string;
  user_id: string;
  ticker: string;
  metric: string;
  op: string;
  threshold: number | null;
  keywords: string[] | null;
  note: string | null;
  enabled: boolean;
  repeat: boolean;
  email_notify: boolean;
  is_triggered: boolean;
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
      if (lastKey && link === lastKey) break;
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

/** Tek hisse için son anlık fiyatı çeker (Yahoo / BIST). */
async function fetchTickerPrice(ticker: string): Promise<number | null> {
  try {
    const norm = ticker.toUpperCase().trim();
    const yahooSymbol = norm.includes('=') || norm.includes('-') ? norm : `${norm}.IS`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1d`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    return typeof price === 'number' && Number.isFinite(price) ? price : null;
  } catch {
    return null;
  }
}

// ── Qwen önceliklendirme ───────────────────────────────────────────────────
async function enrich(items: FeedItem[]): Promise<FeedItem[]> {
  const apiKey = Deno.env.get('LLM_API_KEY');
  if (!apiKey || items.length === 0) return items;

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

// ── Mail Gönderimi ─────────────────────────────────────────────────────────
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

function renderSingleAlertHtml(title: string, ticker: string, details: string, url?: string | null): string {
  const linkHtml = url
    ? `<div style="margin-top:16px;"><a href="${url}" style="display:inline-block;padding:8px 16px;background:#238636;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;font-size:13px;">Detayı İncele →</a></div>`
    : '';

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"></head>
<body style="margin:0;padding:0;background-color:#0a0d12;" bgcolor="#0a0d12">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0a0d12" style="background-color:#0a0d12;"><tr><td align="center" style="padding:40px 16px;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:100%;">
      <tr><td align="center" style="padding-bottom:22px;font-family:'SF Mono',Menlo,monospace;font-size:20px;font-weight:800;letter-spacing:5px;color:#e8f0f7;"><span style="color:#00e896;">F</span>RAUDE</td></tr>
      <tr><td bgcolor="#10151d" style="background-color:#10151d;border:1px solid #232a33;border-radius:14px;padding:32px 30px;">
        <div style="display:inline-block;padding:3px 8px;border-radius:4px;background:#1f6feb22;color:#58a6ff;font-family:'SF Mono',Menlo,monospace;font-size:12px;font-weight:bold;margin-bottom:12px;">${escapeHtml(ticker)} · ALARM TETİKLENDİ</div>
        <div style="font-family:-apple-system,'Segoe UI',sans-serif;font-size:18px;font-weight:700;color:#e8f0f7;margin-bottom:10px;">${escapeHtml(title)}</div>
        <div style="font-family:-apple-system,'Segoe UI',sans-serif;font-size:14px;color:#b7c2cc;line-height:1.6;background:#0d1117;padding:14px;border-radius:8px;border:1px solid #21262d;">${escapeHtml(details)}</div>
        ${linkHtml}
      </td></tr>
      <tr><td align="center" style="padding-top:22px;font-family:-apple-system,'Segoe UI',sans-serif;font-size:12px;line-height:1.7;color:#8b949e;">
        FRAUDE Terminal — 24/7 Bulut Gözcüsü<br>Bu alarmı FRAUDE grafik veya alarm panelinden yönetebilirsiniz.</td></tr>
    </table></td></tr></table></body></html>`;
}

// ── Ana akış ────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
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
  if (feed.length > 40) feed = feed.slice(0, 40);
  feed = await enrich(feed);

  // 1. Kullanıcı e-postalarını çek
  const { data: prefs } = await supabase
    .from('notify_prefs')
    .select('user_id, email, kap_enabled, news_enabled, spk_enabled, tickers, keywords, min_priority')
    .eq('enabled', true);

  const userEmailMap = new Map<string, string>();
  for (const p of prefs ?? []) {
    if (p.email) userEmailMap.set(p.user_id, p.email);
  }

  let customAlertsSent = 0;

  // 2. KULLANICI ÖZEL ALARMLARINI İŞLE (user_alerts)
  const { data: activeCustomAlerts } = await supabase
    .from('user_alerts')
    .select('*')
    .eq('enabled', true)
    .eq('email_notify', true);

  if (activeCustomAlerts && activeCustomAlerts.length > 0) {
    // A) Fiyat Alarmları için gerekli hisseleri topla ve fiyat çek
    const priceAlerts = (activeCustomAlerts as CustomAlertRow[]).filter((a) => a.metric === 'price' && typeof a.threshold === 'number');
    const uniqueTickers = Array.from(new Set(priceAlerts.map((a) => a.ticker)));
    const pricesMap = new Map<string, number>();

    await Promise.all(
      uniqueTickers.map(async (t) => {
        const p = await fetchTickerPrice(t);
        if (p !== null) pricesMap.set(t, p);
      })
    );

    // Fiyat kurallarını test et
    for (const alert of priceAlerts) {
      const curPrice = pricesMap.get(alert.ticker);
      if (curPrice === undefined || alert.threshold === null) continue;

      const isMet = alert.op === 'above' ? curPrice >= alert.threshold : curPrice <= alert.threshold;
      if (isMet) {
        const userEmail = userEmailMap.get(alert.user_id);
        if (userEmail) {
          const subject = `🎯 FRAUDE Fiyat Alarmı: ${alert.ticker} (${curPrice.toFixed(2)} TL)`;
          const desc = `${alert.ticker} hedef fiyat seviyesine ulaştı! Hedef Eşik: ${alert.threshold} TL (${alert.op === 'above' ? 'Üzeri' : 'Altı'}), Güncel Fiyat: ${curPrice.toFixed(2)} TL.${alert.note ? `\nNot: ${alert.note}` : ''}`;
          await sendMail(userEmail, subject, renderSingleAlertHtml(subject, alert.ticker, desc));
          customAlertsSent++;
        }

        // Güncelle
        await supabase
          .from('user_alerts')
          .update({
            is_triggered: true,
            triggered_at: new Date().toISOString(),
            enabled: alert.repeat,
            last_value: curPrice,
          })
          .eq('id', alert.id);
      }
    }

    // B) KAP / SPK / Haber Özel Alarmlarını test et
    const feedAlerts = (activeCustomAlerts as CustomAlertRow[]).filter((a) => a.metric === 'kap' || a.metric === 'news' || a.metric === 'spk');
    for (const alert of feedAlerts) {
      const userEmail = userEmailMap.get(alert.user_id);
      if (!userEmail) continue;

      // KAP / Haber Eşleşmesi
      if (alert.metric === 'kap' || alert.metric === 'news') {
        const matchedItems = feed.filter((it) => {
          if (it.source !== alert.metric) return false;
          const matchTicker = it.tickers.includes(alert.ticker) || it.title.toUpperCase().includes(alert.ticker) || it.body.toUpperCase().includes(alert.ticker);
          if (!matchTicker) return false;

          if (alert.keywords && alert.keywords.length > 0) {
            const hay = `${it.title} ${it.body}`.toLowerCase();
            return alert.keywords.some((k) => hay.includes(k.toLowerCase()));
          }
          return true;
        });

        for (const item of matchedItems) {
          const subject = `📢 FRAUDE ${alert.metric === 'kap' ? 'KAP' : 'Haber'} Alarmı: ${alert.ticker}`;
          const details = `${item.summary || item.title}\n\nKaynak: ${item.source.toUpperCase()}`;
          await sendMail(userEmail, subject, renderSingleAlertHtml(subject, alert.ticker, details, item.url));
          customAlertsSent++;

          await supabase
            .from('user_alerts')
            .update({
              is_triggered: true,
              triggered_at: new Date().toISOString(),
              enabled: alert.repeat,
            })
            .eq('id', alert.id);
        }
      }

      // SPK Eşleşmesi
      if (alert.metric === 'spk' && spkNew) {
        const subject = `🏛️ FRAUDE SPK Bülteni: ${alert.ticker}`;
        const details = `Yeni SPK Bülteni (${spkNew.no}) yayımlandı.`;
        await sendMail(userEmail, subject, renderSingleAlertHtml(subject, alert.ticker, details, spkNew.url));
        customAlertsSent++;
      }
    }
  }

  // 3. İmleçleri ilerlet
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
    JSON.stringify({
      ok: true,
      new_items: feed.length,
      spk: spkNew?.no ?? null,
      custom_alerts_sent: customAlertsSent,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
