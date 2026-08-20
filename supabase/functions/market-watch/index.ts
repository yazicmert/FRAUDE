// FRAUDE — piyasa gözcüsü: KAP + SPK + haber akışlarını ve kullanıcı fiyat alarmlarını
// yoklar, Qwen ile önceliklendirir ve eşleşenleri bildirim kuyruğuna yazar.
// Uygulama kapalıyken çalışır.
//
// Akış (pg_cron ile ~10 dk'da bir tetiklenir):
//   1) notify_seen imleçlerinden sonra gelen yeni KAP bildirimleri + NTV haberleri
//      + yeni SPK bülteni çekilir.
//   2) KAP/haber öğeleri Qwen'e verilir; model her öğe için ilgili BIST kodlarını,
//      1-5 önem puanını ve tek satır Türkçe özet döndürür.
//   3) user_alerts tablosundaki aktif özel alarmlar (fiyat kırılımları, özel KAP/haber anahtarları)
//      değerlendirilir.
//   4) notify_prefs tercihiyle (hisse / anahtar kelime / önem eşiği) eşleşen
//      öğeler ilgili kullanıcılara çıkarılır.
//   5) Eşleşen her şey TEK seferde notify_deliveries + notify_outbox'a yazılır.
//   6) İmleçler en yeni öğeye ilerletilir.
//
// BU FONKSİYON MAİL GÖNDERMEZ. Gönderimi mail-dispatch yapar. Ayrımın sebebi:
// eskiden mailler tespit döngüsünün içinde tek tek `await` ediliyordu, tek bir
// yavaş alıcı sunucusu turu wall-clock sınırına sürükleyip imleçlerin
// ilerlemesini engelliyordu. Artık tespit turu ağ gecikmesinden bağımsız.

import { createClient } from 'npm:@supabase/supabase-js@2';

const LLM_BASE_URL = (Deno.env.get('LLM_BASE_URL') ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1')
  .replace(/\/chat\/completions\/?$/, '')
  .replace(/\/$/, '');
const LLM_MODEL = Deno.env.get('LLM_MODEL') ?? 'qwen-plus';
const KAP_FEED = 'https://www.kap.org.tr/tr/api/disclosure/list/light';
const NEWS_RSS = 'https://www.ntv.com.tr/ekonomi.rss';
const SPK_PAGE = 'https://spk.gov.tr/spk-bultenleri/2026-yili-spk-bultenleri';
const UA = 'Mozilla/5.0 (FRAUDE market-watch)';

/** Tek turda bir kullanıcıya genel tercihlerden üretilecek en fazla bildirim. */
const MAX_PREF_MAILS_PER_RUN = 10;

/** Toplu yazım parça boyutu: tek dev insert isteği zaman aşımına düşmesin. */
const INSERT_CHUNK = 100;

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

/** notify_prefs satırı: kullanıcının genel bildirim süzgeci. */
interface PrefRow {
  user_id: string;
  email: string | null;
  kap_enabled: boolean;
  spk_enabled: boolean;
  news_enabled: boolean;
  tickers: string[] | null;
  keywords: string[] | null;
  min_priority: number;
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

// ── Bildirim kuyruğu ───────────────────────────────────────────────────────

/**
 * Tur boyunca biriken tek bir bildirim. Hem notify_deliveries'e (Chrome
 * eklentisi beslemesi ve site geçmişi) hem notify_outbox'a (mail) düşer;
 * ikisi tek toplu yazımla gider.
 */
interface Outgoing {
  userId: string;
  email: string;
  subject: string;
  html: string;
  delivery: {
    source: string;
    priority: number;
    title: string;
    summary: string;
    tickers: string[];
    url: string | null;
  };
}

/**
 * Biriken bildirimleri yazar. Önce notify_deliveries (kimlikleri geri alınır),
 * sonra onlara bağlı notify_outbox satırları.
 *
 * Sıra bağımlılığı: tek bir `insert ... returning` ifadesi satırları verilen
 * sırayla döndürür, bu yüzden `inserted[i]` ile `list[i]` eşleşir. Toplu yazım
 * bilinçli: kullanıcı başına ayrı istek atmak turu yine ağa bağımlı kılardı.
 */
async function flushQueue(
  supabase: ReturnType<typeof createClient>,
  list: Outgoing[],
): Promise<number> {
  let written = 0;

  for (let start = 0; start < list.length; start += INSERT_CHUNK) {
    const chunk = list.slice(start, start + INSERT_CHUNK);

    const { data: inserted, error: deliveryError } = await supabase
      .from('notify_deliveries')
      .insert(
        chunk.map((o) => ({
          user_id: o.userId,
          source: o.delivery.source,
          priority: o.delivery.priority,
          title: o.delivery.title,
          summary: o.delivery.summary,
          tickers: o.delivery.tickers,
          url: o.delivery.url,
        })),
      )
      .select('id');

    // Besleme yazımı başarısız olsa da mail kuyruğa girmeli: bildirimin
    // kullanıcıya ulaşması, geçmişte görünmesinden önceliklidir.
    if (deliveryError) console.error('deliveries-insert-failed', deliveryError.message);

    const { error: outboxError } = await supabase.from('notify_outbox').insert(
      chunk.map((o, i) => ({
        user_id: o.userId,
        delivery_id: (inserted?.[i] as { id: string } | undefined)?.id ?? null,
        to_email: o.email,
        subject: o.subject,
        html: o.html,
        // Webhook kanalı HTML değil bu gövdeyi alır.
        payload: o.delivery,
      })),
    );

    if (outboxError) console.error('outbox-insert-failed', outboxError.message);
    else written += chunk.length;
  }

  return written;
}

/**
 * notify_prefs süzgecini akışa uygular.
 *
 * Kural: kaynak açık olmalı ve önem puanı eşiği geçmeli. Kullanıcı hiç hisse ve
 * anahtar kelime tanımlamadıysa eşik tek ölçüttür (arayüzdeki "Hepsi (1+)"
 * seçeneği bu şekilde anlam kazanır); tanımladıysa hisse VEYA anahtar kelime
 * eşleşmesi aranır.
 *
 * SPK bülteni puansızdır ve şirkete özgü değildir: kaynağı açık olan herkese
 * gider.
 */
function matchPrefs(
  prefRows: PrefRow[],
  feed: FeedItem[],
  spkNew: { no: string; url: string } | null,
): Outgoing[] {
  const out: Outgoing[] = [];

  for (const pref of prefRows) {
    if (!pref.email || !pref.enabled) continue;

    const tickers = (pref.tickers ?? []).map((t) => t.toUpperCase());
    const keywords = (pref.keywords ?? []).map((k) => k.toLowerCase()).filter(Boolean);
    const hasSpecificFilter = tickers.length > 0 || keywords.length > 0;
    let produced = 0;

    for (const item of feed) {
      // Üst sınır iki işi birden yapar: kullanıcıyı tek turda aşırı mail altında
      // bırakmaz ve kuyruğun kullanıcı×öğe çarpımıyla patlamasını engeller.
      if (produced >= MAX_PREF_MAILS_PER_RUN) break;
      if (item.source === 'kap' && !pref.kap_enabled) continue;
      if (item.source === 'news' && !pref.news_enabled) continue;
      if (item.priority < pref.min_priority) continue;

      let matched = false;
      if (hasSpecificFilter) {
        if (tickers.length > 0) {
          const hayUpper = `${item.title} ${item.body}`.toUpperCase();
          matched = tickers.some((t) => item.tickers.includes(t) || hayUpper.includes(t));
        }
        if (!matched && keywords.length > 0) {
          const hayLower = `${item.title} ${item.body}`.toLowerCase();
          matched = keywords.some((k) => hayLower.includes(k));
        }
      } else {
        // Kullanıcı hiç hisse veya anahtar kelime tanımlamamışsa:
        // Tüm borsanın olağan bildirimleriyle posta kutusunu boğmamak için
        // yalnızca KRİTİK (öncelik >= 4: bilanço, sermaye artırımı, olağanüstü durum vb.)
        // veya SPK bülteni gelişmelerinde bildirim üretilir.
        if (item.priority >= Math.max(4, pref.min_priority)) {
          matched = true;
        }
      }
      if (!matched) continue;

      const label = item.source === 'kap' ? 'KAP' : 'Haber';
      const shown = item.tickers.length > 0 ? item.tickers.join(', ') : label;
      const subject = `${item.source === 'kap' ? '📢' : '📰'} FRAUDE ${label}: ${item.title.slice(0, 90)}`;
      const details = `${item.summary || item.body}\n\nKaynak: ${label}`;

      out.push({
        userId: pref.user_id,
        email: pref.email,
        subject,
        html: renderSingleAlertHtml(subject, shown, details, item.url),
        delivery: {
          source: item.source,
          priority: item.priority,
          title: item.title,
          summary: item.summary || item.body.slice(0, 300),
          tickers: item.tickers,
          url: item.url,
        },
      });
      produced++;
    }

    if (spkNew && pref.spk_enabled) {
      const subject = `🏛️ FRAUDE SPK Bülteni ${spkNew.no}`;
      const details = `Yeni SPK Bülteni (${spkNew.no}) yayımlandı.`;
      out.push({
        userId: pref.user_id,
        email: pref.email,
        subject,
        html: renderSingleAlertHtml(subject, 'SPK', details, spkNew.url),
        delivery: {
          source: 'spk',
          priority: 4,
          title: subject,
          summary: details,
          tickers: [],
          url: spkNew.url,
        },
      });
    }
  }

  return out;
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
        FRAUDE Terminal — 24/7 Bulut Gözcüsü<br>
        Bu bildirimleri <a href="https://fraude.app/hesap/bildirimler" style="color:#58a6ff;text-decoration:underline;">Bildirim Ayarları</a> sayfasından yönetebilir veya kapatabilirsiniz.
      </td></tr>
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

  // 1. Kullanıcı tercihlerini çek
  const { data: prefs } = await supabase
    .from('notify_prefs')
    .select('user_id, email, kap_enabled, news_enabled, spk_enabled, tickers, keywords, min_priority')
    .eq('enabled', true);

  const prefRows = (prefs ?? []) as PrefRow[];
  const userEmailMap = new Map<string, string>();
  for (const p of prefRows) {
    if (p.email) userEmailMap.set(p.user_id, p.email);
  }

  // Tur boyunca biriken bildirimler; sonda tek seferde yazılır.
  const outgoing: Outgoing[] = [];
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
          outgoing.push({
            userId: alert.user_id,
            email: userEmail,
            subject,
            html: renderSingleAlertHtml(subject, alert.ticker, desc),
            delivery: {
              source: 'alert',
              priority: 5,
              title: subject,
              summary: desc,
              tickers: [alert.ticker],
              url: null,
            },
          });
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
          outgoing.push({
            userId: alert.user_id,
            email: userEmail,
            subject,
            html: renderSingleAlertHtml(subject, alert.ticker, details, item.url),
            delivery: {
              source: item.source,
              priority: Math.max(item.priority, 4), // özel alarm eşleşmesi her zaman önemli
              title: item.title,
              summary: item.summary || item.title,
              tickers: [alert.ticker],
              url: item.url,
            },
          });
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
        outgoing.push({
          userId: alert.user_id,
          email: userEmail,
          subject,
          html: renderSingleAlertHtml(subject, alert.ticker, details, spkNew.url),
          delivery: {
            source: 'spk',
            priority: 4,
            title: subject,
            summary: details,
            tickers: [alert.ticker],
            url: spkNew.url,
          },
        });
        customAlertsSent++;
      }
    }
  }

  // 3. GENEL BİLDİRİM TERCİHLERİ (notify_prefs)
  // Özel alarmı olmayan kullanıcı da takip ettiği hisseler / anahtar kelimeler
  // için bildirim alır. Bu adım eksikti: notify_deliveries hiç yazılmadığı için
  // Chrome eklentisinin beslemesi (notify-feed) sürekli boş dönüyordu.
  const prefsMatched = matchPrefs(prefRows, feed, spkNew);
  outgoing.push(...prefsMatched);

  // 4. Kuyruğa yaz. Gönderimi mail-dispatch üstlenir.
  const queued = await flushQueue(supabase, outgoing);

  // 5. İmleçleri ilerlet
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
      // "sent" değil "queued": gönderimden mail-dispatch sorumlu.
      custom_alerts_queued: customAlertsSent,
      pref_matches_queued: prefsMatched.length,
      queued,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
