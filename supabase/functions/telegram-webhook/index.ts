// FRAUDE — Gelişmiş Resmi Telegram Bot Webhook & AI Finans Asistanı
// ─────────────────────────────────────────────────────────────────────────────
// Resmi FRAUDE Telegram Botuna (@FraudeTerminal_Bot) gelen tüm mesajları,
// alarmları, fiyat sorgularını ve komutları yönetir:
//   • 6 Haneli Kod ve E-posta ile güvenli hesap eşleştirme
//   • Anlık Hisse Fiyat Kartı & Metrikler (/fiyat THYAO veya doğrudan 'THYAO')
//   • Telegram'dan Fiyat Alarmı Kurma (/alarm THYAO > 320) ve Yönetimi (/alarmlar)
//   • İzleme Listesine Hisse Ekleme/Çıkarma (/ekle THYAO, /cikar THYAO)
//   • Son Kritik KAP Haberleri (/haberler)
//   • Yapay Zekâ Finansal Soru-Cevap (/sor <soru>)
//   • İnteraktif Menü ve İnline Butonlar

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  escapeTelegramHtml,
  renderPairingEmailHtml,
  sendViaPlatform,
} from '../_shared/mailer.ts';

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '8991375615:AAGjohoZvw-eWcumCtDfS391Op7W_ER14ks';
const LLM_API_KEY = Deno.env.get('LLM_API_KEY');
const LLM_BASE_URL = Deno.env.get('LLM_BASE_URL') ?? 'https://api.deepseek.com/v1';
const LLM_MODEL = Deno.env.get('LLM_MODEL') ?? 'deepseek-chat';

const MAIN_KEYBOARD = {
  keyboard: [
    [{ text: '📊 Durum' }, { text: '📈 Hisselerim' }],
    [{ text: '🏛️ SPK Bülteni' }, { text: '🔔 Alarmlarım' }],
    [{ text: '📰 Son Haberler' }, { text: 'ℹ️ Yardım' }],
  ],
  resize_keyboard: true,
};

async function sendTelegramReply(
  chatId: string | number,
  htmlText: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (!BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: htmlText,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra,
    }),
  }).catch(() => {});
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

interface YahooQuote {
  symbol: string;
  name: string;
  price: number;
  prevClose: number;
  change: number;
  pctChange: number;
  dayHigh: number;
  dayLow: number;
  fiftyTwoHigh: number;
  fiftyTwoLow: number;
  volume: number;
  currency: string;
}

async function fetchLiveQuote(rawTicker: string): Promise<YahooQuote | null> {
  const clean = rawTicker.toUpperCase().trim();
  const yahooSymbol = clean.includes('=') || clean.includes('-') ? clean : `${clean}.IS`;
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1d&interval=1d`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(6000),
      },
    );
    if (!res.ok) return null;
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta || typeof meta.regularMarketPrice !== 'number') return null;

    const price = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose || price;
    const change = price - prevClose;
    const pctChange = prevClose > 0 ? (change / prevClose) * 100 : 0;

    return {
      symbol: clean,
      name: meta.longName || meta.shortName || clean,
      price,
      prevClose,
      change,
      pctChange,
      dayHigh: meta.regularMarketDayHigh || price,
      dayLow: meta.regularMarketDayLow || price,
      fiftyTwoHigh: meta.fiftyTwoWeekHigh || price,
      fiftyTwoLow: meta.fiftyTwoWeekLow || price,
      volume: meta.regularMarketVolume || 0,
      currency: meta.currency || 'TL',
    };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let update: Record<string, unknown>;
  try {
    update = await req.json();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── 1. İnline Buton Tıklaması (Callback Query) ───────────────────────────
  const callbackQuery = update.callback_query as {
    id?: string;
    message?: { chat?: { id?: number } };
    data?: string;
  } | undefined;

  if (callbackQuery?.data && callbackQuery.message?.chat?.id) {
    const cbChatId = String(callbackQuery.message.chat.id);
    const data = callbackQuery.data;

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQuery.id }),
    }).catch(() => {});

    if (data === 'refresh_status') {
      await handleStatus(supabase, cbChatId);
    } else if (data === 'spk_ipo_apps') {
      await handleIpoApplications(cbChatId);
    } else if (data === 'spk_bulletin') {
      await handleSpkBulletins(supabase, cbChatId);
    } else if (data.startsWith('add_')) {
      const tk = data.replace('add_', '').toUpperCase();
      await handleAddTicker(supabase, cbChatId, tk);
    } else if (data.startsWith('del_alert_')) {
      const alertId = data.replace('del_alert_', '');
      await handleDeleteAlert(supabase, cbChatId, alertId);
    } else if (data.startsWith('kap_')) {
      const tk = data.replace('kap_', '').toUpperCase();
      await handleRecentNewsForTicker(supabase, cbChatId, tk);
    }
    return new Response('ok', { status: 200 });
  }

  // ── 2. Standart Mesaj ────────────────────────────────────────────────────
  const message = update.message as {
    chat?: { id?: number; username?: string; first_name?: string };
    text?: string;
  } | undefined;

  if (!message?.chat?.id || !message.text) {
    return new Response('ok', { status: 200 });
  }

  const chatId = String(message.chat.id);
  const rawText = message.text.trim();
  const tgUsername = message.chat.username
    ? `@${message.chat.username}`
    : (message.chat.first_name || 'Kullanıcı');

  // ── /start <kod> veya /start ──────────────────────────────────────────────
  if (rawText.startsWith('/start')) {
    const parts = rawText.split(/\s+/);
    const startParam = parts[1]?.trim();

    if (startParam && /^\d{6}$/.test(startParam)) {
      await handleVerifyCode(supabase, chatId, startParam, tgUsername);
      return new Response('ok', { status: 200 });
    }

    const welcome = `👋 <b>FRAUDE Terminal Bildirim & AI Asistanına Hoş Geldiniz!</b>\n\n` +
      `Borsa İstanbul KAP açıklamalarını, SPK bültenlerini ve fiyat alarmlarını bu sohbete <b>1 saniyede anlık</b> almak için hesabınızı bağlayın.\n\n` +
      `<b>⚡ Nasıl Bağlanır?</b>\n` +
      `1️⃣ <b>E-posta ile:</b> FRAUDE hesabınızın e-postasını buraya yazın (örn: <code>adiniz@gmail.com</code>). Size 6 haneli doğrulama PIN'i gönderelim.\n` +
      `2️⃣ <b>Uygulamadan:</b> FRAUDE Terminal masaüstü uygulamasında <i>Bildirimler ➔ Telegram</i> sekmesinden aldığınız kodu buraya gönderin.\n\n` +
      `<b>Komutlar:</b>\n` +
      `• <code>/durum</code> - Hesap ve bildirim durumu\n` +
      `• <code>/fiyat THYAO</code> - Canlı hisse fiyatı ve metrikler\n` +
      `• <code>/alarm THYAO &gt; 320</code> - Fiyat alarmı kur\n` +
      `• <code>/alarmlar</code> - Aktif alarmlarını yönet\n` +
      `• <code>/hisseler</code> - İzleme listen\n` +
      `• <code>/ekle &lt;KOD&gt;</code> - Listeye hisse ekle\n` +
      `• <code>/haberler</code> - Son kritik KAP açıklamaları\n` +
      `• <code>/sor &lt;soru&gt;</code> - AI Asistanına finansal soru sor`;

    await sendTelegramReply(chatId, welcome, { reply_markup: MAIN_KEYBOARD });
    return new Response('ok', { status: 200 });
  }

  // ── /durum ────────────────────────────────────────────────────────────────
  if (rawText === '/durum' || rawText === '/status' || rawText === '📊 Durum') {
    await handleStatus(supabase, chatId);
    return new Response('ok', { status: 200 });
  }

  // ── /hisseler ─────────────────────────────────────────────────────────────
  if (rawText === '/hisseler' || rawText === '📈 Hisselerim') {
    await handleWatchlist(supabase, chatId);
    return new Response('ok', { status: 200 });
  }

  // ── /alarmlar ─────────────────────────────────────────────────────────────
  if (rawText === '/alarmlar' || rawText === '🔔 Alarmlarım') {
    await handleListAlerts(supabase, chatId);
    return new Response('ok', { status: 200 });
  }

  // ── /alarm <TICKER> <OP> <VAL> ────────────────────────────────────────────
  if (rawText.startsWith('/alarm')) {
    await handleCreateAlarm(supabase, chatId, rawText);
    return new Response('ok', { status: 200 });
  }

  // ── /fiyat <TICKER> ───────────────────────────────────────────────────────
  if (rawText.startsWith('/fiyat')) {
    const tk = rawText.replace(/^\/fiyat/, '').trim().toUpperCase();
    if (!tk) {
      await sendTelegramReply(chatId, `ℹ️ Lütfen fiyatını görmek istediğiniz hisseyi belirtin.\nÖrnek: <code>/fiyat THYAO</code>`);
      return new Response('ok', { status: 200 });
    }
    await handleSendPriceCard(chatId, tk);
    return new Response('ok', { status: 200 });
  }

  // ── /ekle <TICKER> ────────────────────────────────────────────────────────
  if (rawText.startsWith('/ekle') || rawText.startsWith('+')) {
    const cleanTk = rawText.replace(/^\/ekle|\+/, '').trim().toUpperCase();
    if (!cleanTk) {
      await sendTelegramReply(chatId, `ℹ️ Lütfen eklenecek hisse kodunu belirtin.\nÖrnek: <code>/ekle THYAO</code>`);
      return new Response('ok', { status: 200 });
    }
    await handleAddTicker(supabase, chatId, cleanTk);
    return new Response('ok', { status: 200 });
  }

  // ── /cikar <TICKER> ───────────────────────────────────────────────────────
  if (rawText.startsWith('/cikar') || rawText.startsWith('/sil') || rawText.startsWith('-')) {
    const cleanTk = rawText.replace(/^\/cikar|\/sil|-/, '').trim().toUpperCase();
    if (!cleanTk) {
      await sendTelegramReply(chatId, `ℹ️ Lütfen çıkarılacak hisse kodunu belirtin.\nÖrnek: <code>/cikar THYAO</code>`);
      return new Response('ok', { status: 200 });
    }
    await handleRemoveTicker(supabase, chatId, cleanTk);
    return new Response('ok', { status: 200 });
  }

  // ── /spk veya /bulten ───────────────────────────────────────────────────────
  if (rawText === '/spk' || rawText === '/bulten' || rawText === '🏛️ SPK Bülteni') {
    await handleSpkBulletins(supabase, chatId);
    return new Response('ok', { status: 200 });
  }

  // ── /halkaarz veya /ipo ───────────────────────────────────────────────────
  if (rawText === '/halkaarz' || rawText === '/ipo' || rawText === '🏛️ Halka Arzlar') {
    await handleIpoApplications(chatId);
    return new Response('ok', { status: 200 });
  }

  // ── /haberler ─────────────────────────────────────────────────────────────
  if (rawText === '/haberler' || rawText === '📰 Son Haberler') {
    await handleRecentNews(supabase, chatId);
    return new Response('ok', { status: 200 });
  }

  // ── /yardim ───────────────────────────────────────────────────────────────
  if (rawText === '/yardim' || rawText === '/help' || rawText === 'ℹ️ Yardım') {
    const helpMsg = `📖 <b>FRAUDE Bot Komut Rehberi</b>\n\n` +
      `• <code>/durum</code>: Hesap ve bildirim ayarlarını gösterir.\n` +
      `• <code>/fiyat THYAO</code>: THYAO anlık fiyat ve günlük metrikleri.\n` +
      `• <code>/alarm THYAO &gt; 350</code>: THYAO için fiyat alarmı kurar.\n` +
      `• <code>/alarmlar</code>: Aktif alarmlarını listeler ve yönetir.\n` +
      `• <code>/hisseler</code>: Takip listenizdeki hisseleri listeler.\n` +
      `• <code>/ekle THYAO</code>: THYAO'yu bildirim listene ekler.\n` +
      `• <code>/cikar THYAO</code>: THYAO'yu bildirim listenden çıkarır.\n` +
      `• <code>/haberler</code>: Son gelen kritik KAP bildirimleri.\n` +
      `• <code>/sor &lt;soru&gt;</code>: Yapay zekâya piyasa sorusu sorar.\n` +
      `• <code>/cikis</code>: Telegram bağlantısını sonlandırır.`;
    await sendTelegramReply(chatId, helpMsg, { reply_markup: MAIN_KEYBOARD });
    return new Response('ok', { status: 200 });
  }

  // ── /sor <soru> veya AI Soru-Cevap ────────────────────────────────────────
  if (rawText.startsWith('/sor') || rawText.startsWith('/ai') || (rawText.endsWith('?') && rawText.length > 10)) {
    const query = rawText.replace(/^\/sor|^\/ai/, '').trim();
    await handleAiQuery(chatId, query);
    return new Response('ok', { status: 200 });
  }

  // ── /cikis ────────────────────────────────────────────────────────────────
  if (rawText === '/cikis' || rawText === '/logout' || rawText === '🚪 Çıkış') {
    await supabase
      .from('notify_transports')
      .update({
        kind: 'platform',
        telegram_chat_id: null,
        telegram_username: null,
        updated_at: new Date().toISOString(),
      })
      .eq('telegram_chat_id', chatId);

    await sendTelegramReply(
      chatId,
      `🚪 <b>Telegram Bağlantınız Kesildi</b>\n\nFRAUDE bildirimleriniz kayıtlı e-posta adresinize gelmeye devam edecektir. Yeniden bağlamak istediğinizde e-posta adresinizi yazabilirsiniz.`,
      { reply_markup: { remove_keyboard: true } },
    );
    return new Response('ok', { status: 200 });
  }

  // ── E-posta Girildiyse ➔ Kod Üret ve Mail Gönder ──────────────────────────
  if (isEmail(rawText)) {
    await handleSendEmailCode(supabase, chatId, rawText.toLowerCase().trim());
    return new Response('ok', { status: 200 });
  }

  // ── 6 Haneli Kod Girildiyse ➔ Doğrula ve Bağla ────────────────────────────
  if (/^\d{6}$/.test(rawText)) {
    await handleVerifyCode(supabase, chatId, rawText, tgUsername);
    return new Response('ok', { status: 200 });
  }

  // ── 3-6 Harfli BIST Kodu Yazıldıysa (Örn: THYAO, ASELS, GARAN) ───────────
  if (/^[A-Z]{3,6}$/i.test(rawText)) {
    const quote = await fetchLiveQuote(rawText);
    if (quote) {
      await handleSendPriceCardWithQuote(chatId, quote);
      return new Response('ok', { status: 200 });
    }
  }

  // ── Bilinmeyen Mesaj ──────────────────────────────────────────────────────
  await sendTelegramReply(
    chatId,
    `ℹ️ Lütfen kayıtlı <b>e-posta adresinizi</b>, <b>6 haneli kodunuzu</b> veya bir hisse kodunu (örn: <code>THYAO</code>) yazın.\n\nKomutlar için /yardim yazabilirsiniz.`,
    { reply_markup: MAIN_KEYBOARD },
  );
  return new Response('ok', { status: 200 });
});

// ── İşlevsel Fonksiyonlar ───────────────────────────────────────────────────

async function handleSendPriceCard(chatId: string, ticker: string): Promise<void> {
  const quote = await fetchLiveQuote(ticker);
  if (!quote) {
    await sendTelegramReply(
      chatId,
      `⚠️ <code>${escapeTelegramHtml(ticker)}</code> için piyasa fiyatı bulunamadı. Lütfen geçerli bir hisse kodu girdiğinizden emin olun.`,
    );
    return;
  }
  await handleSendPriceCardWithQuote(chatId, quote);
}

async function handleSendPriceCardWithQuote(chatId: string, quote: YahooQuote): Promise<void> {
  const isUp = quote.change >= 0;
  const icon = isUp ? '🟢' : '🔴';
  const sign = isUp ? '+' : '';

  const formatNum = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatVol = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)} Milyon`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)} Bin`;
    return v.toString();
  };

  const card = `📈 <b>${escapeTelegramHtml(quote.symbol)} · ${escapeTelegramHtml(quote.name)}</b>\n` +
    `───────────────────────────\n` +
    `💰 <b>Fiyat:</b> <code>${formatNum(quote.price)} ${quote.currency}</code> (${sign}%${formatNum(quote.pctChange)} ${icon})\n` +
    `📊 <b>Günlük Aralık:</b> ${formatNum(quote.dayLow)} - ${formatNum(quote.dayHigh)} ${quote.currency}\n` +
    `📦 <b>İşlem Adedi:</b> ${formatVol(quote.volume)} Lot\n` +
    `🎯 <b>52H Zirve / Dip:</b> ${formatNum(quote.fiftyTwoHigh)} / ${formatNum(quote.fiftyTwoLow)} ${quote.currency}\n` +
    `───────────────────────────`;

  await sendTelegramReply(chatId, card, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: `➕ Listeme Ekle`, callback_data: `add_${quote.symbol}` },
          { text: `📰 Son KAP`, callback_data: `kap_${quote.symbol}` },
        ],
      ],
    },
  });
}

async function handleCreateAlarm(supabase: any, chatId: string, rawText: string): Promise<void> {
  const { data: transport } = await supabase
    .from('notify_transports')
    .select('user_id')
    .eq('telegram_chat_id', chatId)
    .eq('kind', 'telegram')
    .maybeSingle();

  if (!transport) {
    await sendTelegramReply(chatId, `⚠️ Alarm kurmak için önce FRAUDE e-posta adresinizi yazarak oturum açmalısınız.`);
    return;
  }

  // Örnekler: /alarm THYAO > 350, /alarm ASELS < 55, /alarm BIMAS 600
  const match = rawText.match(/^\/alarm\s+([A-Za-z0-9]+)\s*(>|>=|<|<=|=)?\s*([0-9.,]+)$/i);
  if (!match) {
    await sendTelegramReply(
      chatId,
      `ℹ️ <b>Fiyat Alarmı Formatı:</b>\n\n` +
        `• <code>/alarm THYAO &gt; 350</code> (THYAO 350 TL üzerine çıkınca)\n` +
        `• <code>/alarm ASELS &lt; 58.50</code> (ASELS 58.50 TL altına inince)\n\n` +
        `Mevcut alarmlarınızı görmek için: <code>/alarmlar</code>`,
    );
    return;
  }

  const ticker = match[1].toUpperCase();
  const rawOp = match[2] || '>';
  const rawVal = parseFloat(match[3].replace(',', '.'));

  if (!Number.isFinite(rawVal) || rawVal <= 0) {
    await sendTelegramReply(chatId, `⚠️ Lütfen geçerli bir hedef fiyat girin.`);
    return;
  }

  const operator = rawOp === '<' || rawOp === '<=' ? 'lt' : 'gt';
  const opLabel = operator === 'gt' ? '>=' : '<=';

  const { error } = await supabase.from('user_alerts').insert({
    user_id: transport.user_id,
    ticker,
    metric: 'price',
    operator,
    threshold: rawVal,
    target_label: `Fiyat ${opLabel} ${rawVal} TL`,
    enabled: true,
  });

  if (error) {
    await sendTelegramReply(chatId, `⚠️ Alarm kaydedilemedi: ${escapeTelegramHtml(error.message)}`);
    return;
  }

  await sendTelegramReply(
    chatId,
    `🎯 <b>Fiyat Alarmı Kuruldu!</b>\n\n` +
      `Hisse: <code>${ticker}</code>\n` +
      `Hedef: <b>${opLabel} ${rawVal.toFixed(2)} TL</b>\n\n` +
      `Fiyat bu seviyeye ulaştığı saniye Telegram'dan bildirim alacaksınız.`,
  );
}

async function handleListAlerts(supabase: any, chatId: string): Promise<void> {
  const { data: transport } = await supabase
    .from('notify_transports')
    .select('user_id')
    .eq('telegram_chat_id', chatId)
    .eq('kind', 'telegram')
    .maybeSingle();

  if (!transport) {
    await sendTelegramReply(chatId, `⚠️ Önce e-posta adresinizi yazarak oturum açmalısınız.`);
    return;
  }

  const { data: alerts } = await supabase
    .from('user_alerts')
    .select('id, ticker, metric, operator, threshold, enabled, created_at')
    .eq('user_id', transport.user_id)
    .eq('enabled', true)
    .order('created_at', { ascending: false });

  if (!alerts || alerts.length === 0) {
    await sendTelegramReply(
      chatId,
      `🔔 <b>Aktif Fiyat Alarmınız Yok</b>\n\nYeni alarm kurmak için:\n<code>/alarm THYAO &gt; 350</code>`,
    );
    return;
  }

  let text = `🔔 <b>Aktif Fiyat Alarmlarınız (${alerts.length}):</b>\n\n`;
  const inlineButtons: Array<Array<{ text: string; callback_data: string }>> = [];

  for (const a of alerts) {
    const op = a.operator === 'lt' || a.operator === 'lte' ? '≤' : '≥';
    text += `• <b>${escapeTelegramHtml(a.ticker)}</b>: Fiyat ${op} <b>${Number(a.threshold).toFixed(2)} TL</b>\n`;
    inlineButtons.push([
      { text: `🗑️ Sil: ${a.ticker} (${op}${a.threshold})`, callback_data: `del_alert_${a.id}` },
    ]);
  }

  text += `\n<i>Yeni alarm kurmak için: <code>/alarm KOD &gt; FİYAT</code></i>`;

  await sendTelegramReply(chatId, text, {
    reply_markup: {
      inline_keyboard: inlineButtons,
    },
  });
}

async function handleDeleteAlert(supabase: any, chatId: string, alertId: string): Promise<void> {
  await supabase.from('user_alerts').delete().eq('id', alertId);
  await sendTelegramReply(chatId, `🗑️ Fiyat alarmı silindi.`);
  await handleListAlerts(supabase, chatId);
}

async function handleAiQuery(chatId: string, query: string): Promise<void> {
  if (!LLM_API_KEY) {
    await sendTelegramReply(chatId, `ℹ️ AI Asistanı şu anda bakımda.`);
    return;
  }

  await sendTelegramReply(chatId, `🤖 <i>Piyasa verileri analiz ediliyor…</i>`);

  try {
    const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LLM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          {
            role: 'system',
            content:
              'Sen FRAUDE Terminal Borsa İstanbul ve Finans Asistanısın. ' +
              'Kullanıcının Türkçe sorularına borsa terminolojisine uygun, net, profesyonel ve 2-3 paragrafı geçmeyen öz ve bilgilendirici yanıtlar ver. ' +
              'Yatırım tavsiyesi olmadığını belirten doğal bir üslup kullan.',
          },
          { role: 'user', content: query },
        ],
        temperature: 0.3,
        max_tokens: 600,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      await sendTelegramReply(chatId, `⚠️ AI yanıt üretirken bir hata oluştu.`);
      return;
    }

    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content?.trim() || 'Yanıt alınamadı.';

    await sendTelegramReply(chatId, `🤖 <b>FRAUDE AI Analizi:</b>\n\n${escapeTelegramHtml(reply)}`);
  } catch (e) {
    await sendTelegramReply(chatId, `⚠️ Bağlantı zaman aşımına uğradı.`);
  }
}

async function handleStatus(supabase: any, chatId: string): Promise<void> {
  const { data: transport } = await supabase
    .from('notify_transports')
    .select('user_id, verified_at, disabled_at, from_email')
    .eq('telegram_chat_id', chatId)
    .eq('kind', 'telegram')
    .maybeSingle();

  if (!transport || !transport.verified_at || transport.disabled_at) {
    await sendTelegramReply(
      chatId,
      `ℹ️ Henüz bağlı bir FRAUDE hesabınız bulunmuyor.\n\nBaşlamak için FRAUDE'ye kayıtlı e-posta adresinizi buraya yazabilirsiniz.`,
      { reply_markup: MAIN_KEYBOARD },
    );
    return;
  }

  const { data: prefs } = await supabase
    .from('notify_prefs')
    .select('tickers, min_priority, enabled, kap_enabled, spk_enabled, news_enabled, email')
    .eq('user_id', transport.user_id)
    .maybeSingle();

  const tickersList = prefs?.tickers?.length ? prefs.tickers.join(', ') : 'Tüm BIST (Yalnızca Kritik 4-5 Seviye)';
  const statusText = `📊 <b>FRAUDE Telegram Bildirim Durumu</b>\n\n` +
    `Durum: 🟢 <b>Aktif & Bağlı</b>\n` +
    `Hesap: <code>${escapeTelegramHtml(prefs?.email || transport.user_id.slice(0, 8))}</code>\n` +
    `İzlenen Hisseler: <code>${escapeTelegramHtml(tickersList)}</code>\n` +
    `Minimum Öncelik Eşiği: <b>${prefs?.min_priority ?? 4}+ (Kritik)</b>\n` +
    `Kaynaklar: KAP (${prefs?.kap_enabled !== false ? '✓' : '✗'}), SPK (${prefs?.spk_enabled !== false ? '✓' : '✗'}), Haber (${prefs?.news_enabled !== false ? '✓' : '✗'})\n\n` +
    `<i>Hisse eklemek için <code>/ekle KOD</code>, fiyat alarmı için <code>/alarm KOD &gt; FİYAT</code> yazabilirsiniz.</i>`;

  await sendTelegramReply(chatId, statusText, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔄 Durumu Yenile', callback_data: 'refresh_status' }],
      ],
    },
  });
}

async function handleWatchlist(supabase: any, chatId: string): Promise<void> {
  const { data: transport } = await supabase
    .from('notify_transports')
    .select('user_id')
    .eq('telegram_chat_id', chatId)
    .eq('kind', 'telegram')
    .maybeSingle();

  if (!transport) {
    await sendTelegramReply(chatId, `⚠️ Önce FRAUDE e-posta adresinizi yazarak oturum açmalısınız.`);
    return;
  }

  const { data: prefs } = await supabase
    .from('notify_prefs')
    .select('tickers')
    .eq('user_id', transport.user_id)
    .maybeSingle();

  const tickers = prefs?.tickers ?? [];
  if (tickers.length === 0) {
    await sendTelegramReply(
      chatId,
      `📋 <b>İzleme Listeniz Boş</b>\n\nHisse eklemediğinizde yalnızca kritik (öncelik 4-5) bilanço ve SPK bültenleri iletilir.\n\nHisse eklemek için: <code>/ekle THYAO</code>`,
    );
    return;
  }

  const text = `📋 <b>Takip Ettiğiniz Hisseler (${tickers.length}):</b>\n\n` +
    tickers.map((t: string) => `• <code>${escapeTelegramHtml(t)}</code>`).join('\n') +
    `\n\n<i>Yeni hisse eklemek için <code>/ekle KOD</code>, çıkarmak için <code>/cikar KOD</code> yazabilirsiniz.</i>`;

  await sendTelegramReply(chatId, text);
}

async function handleAddTicker(supabase: any, chatId: string, ticker: string): Promise<void> {
  const { data: transport } = await supabase
    .from('notify_transports')
    .select('user_id')
    .eq('telegram_chat_id', chatId)
    .eq('kind', 'telegram')
    .maybeSingle();

  if (!transport) {
    await sendTelegramReply(chatId, `⚠️ Önce e-posta adresinizi yazarak hesabınızı bağlamalısınız.`);
    return;
  }

  const { data: prefs } = await supabase
    .from('notify_prefs')
    .select('tickers')
    .eq('user_id', transport.user_id)
    .maybeSingle();

  const currentTickers = (prefs?.tickers ?? []) as string[];
  if (currentTickers.includes(ticker)) {
    await sendTelegramReply(chatId, `ℹ️ <code>${ticker}</code> zaten izleme listenizde bulunuyor.`);
    return;
  }

  const updated = [...currentTickers, ticker];
  await supabase
    .from('notify_prefs')
    .update({ tickers: updated, updated_at: new Date().toISOString() })
    .eq('user_id', transport.user_id);

  await sendTelegramReply(
    chatId,
    `✅ <b>${escapeTelegramHtml(ticker)}</b> izleme listenize eklendi!\nArtık ${ticker} ile ilgili KAP ve fiyat bildirimleri anında bu sohbete iletilecek.`,
  );
}

async function handleRemoveTicker(supabase: any, chatId: string, ticker: string): Promise<void> {
  const { data: transport } = await supabase
    .from('notify_transports')
    .select('user_id')
    .eq('telegram_chat_id', chatId)
    .eq('kind', 'telegram')
    .maybeSingle();

  if (!transport) {
    await sendTelegramReply(chatId, `⚠️ Önce e-posta adresinizi yazarak hesabınızı bağlamalısınız.`);
    return;
  }

  const { data: prefs } = await supabase
    .from('notify_prefs')
    .select('tickers')
    .eq('user_id', transport.user_id)
    .maybeSingle();

  const currentTickers = (prefs?.tickers ?? []) as string[];
  if (!currentTickers.includes(ticker)) {
    await sendTelegramReply(chatId, `ℹ️ <code>${ticker}</code> listenizde bulunamadı.`);
    return;
  }

  const updated = currentTickers.filter((t) => t !== ticker);
  await supabase
    .from('notify_prefs')
    .update({ tickers: updated, updated_at: new Date().toISOString() })
    .eq('user_id', transport.user_id);

  await sendTelegramReply(chatId, `🗑️ <b>${escapeTelegramHtml(ticker)}</b> izleme listenizden çıkarıldı.`);
}

async function handleRecentNews(supabase: any, chatId: string): Promise<void> {
  const { data: news } = await supabase
    .from('notify_outbox')
    .select('subject, payload, created_at')
    .order('created_at', { ascending: false })
    .limit(4);

  if (!news || news.length === 0) {
    await sendTelegramReply(chatId, `ℹ️ Henüz son bildirim kaydı bulunmuyor.`);
    return;
  }

  let text = `📰 <b>Son Piyasa Gelişmeleri & KAP</b>\n\n`;
  for (const item of news) {
    const p = item.payload as any;
    const title = p?.title || item.subject;
    const summary = p?.summary ? `\n<i>${escapeTelegramHtml(p.summary)}</i>` : '';
    const tickers = p?.tickers?.length ? `[<code>${p.tickers.join(', ')}</code>] ` : '';
    text += `• ${tickers}<b>${escapeTelegramHtml(title)}</b>${summary}\n\n`;
  }

  await sendTelegramReply(chatId, text);
}

async function handleRecentNewsForTicker(supabase: any, chatId: string, ticker: string): Promise<void> {
  const { data: news } = await supabase
    .from('notify_outbox')
    .select('subject, payload, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  const matched = (news ?? []).filter((n: any) => {
    const tks = (n.payload?.tickers ?? []) as string[];
    return tks.includes(ticker) || (n.subject && n.subject.includes(ticker));
  }).slice(0, 3);

  if (matched.length === 0) {
    await sendTelegramReply(chatId, `ℹ️ <code>${ticker}</code> için son kaydedilen KAP bildirimi bulunamadı.`);
    return;
  }

  let text = `📰 <b>${escapeTelegramHtml(ticker)} · Son KAP Açıklamaları</b>\n\n`;
  for (const item of matched) {
    const p = item.payload as any;
    const title = p?.title || item.subject;
    const summary = p?.summary ? `\n<i>${escapeTelegramHtml(p.summary)}</i>` : '';
    text += `• <b>${escapeTelegramHtml(title)}</b>${summary}\n\n`;
  }

  await sendTelegramReply(chatId, text);
}

async function handleSendEmailCode(supabase: any, chatId: string, targetEmail: string): Promise<void> {
  const { data: userRow } = await supabase
    .from('notify_prefs')
    .select('user_id')
    .eq('email', targetEmail)
    .maybeSingle();

  let userId = userRow?.user_id;
  if (!userId) {
    const { data: authList } = await supabase.auth.admin.listUsers();
    const matchedAuth = authList?.users?.find(
      (u: any) => u.email?.toLowerCase() === targetEmail,
    );
    if (matchedAuth) {
      userId = matchedAuth.id;
    }
  }

  if (!userId) {
    await sendTelegramReply(
      chatId,
      `⚠️ <b>Hesap Bulunamadı</b>\n\n<code>${escapeTelegramHtml(targetEmail)}</code> adresiyle kayıtlı bir FRAUDE hesabı bulunamadı. Lütfen FRAUDE Terminal'e kayıt olduğunuz e-posta adresini girdiğinizden emin olun.`,
    );
    return;
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  await supabase.from('telegram_link_codes').insert({
    user_id: userId,
    email: targetEmail,
    code,
    expires_at: expiresAt,
  });

  const emailResult = await sendViaPlatform({
    to: targetEmail,
    subject: `FRAUDE Telegram Eşleştirme Kodunuz: ${code}`,
    html: renderPairingEmailHtml(code),
  });

  if (!emailResult.ok) {
    await sendTelegramReply(
      chatId,
      `⚠️ E-posta gönderilirken bir sorun oluştu (${escapeTelegramHtml(emailResult.error || 'Ağ hatası')}). Lütfen FRAUDE uygulamasından kod almayı deneyin.`,
    );
    return;
  }

  await sendTelegramReply(
    chatId,
    `📬 <b>Doğrulama Kodu Gönderildi!</b>\n\n<code>${escapeTelegramHtml(targetEmail)}</code> adresinize 6 haneli bir eşleştirme kodu ilettik.\n\nLütfen e-postanızı kontrol edin ve gelen 6 haneli kodu buraya yazın (Kod <b>5 dakika</b> geçerlidir).`,
  );
}

async function handleVerifyCode(
  supabase: any,
  chatId: string,
  enteredCode: string,
  tgUsername: string,
): Promise<void> {
  const now = new Date().toISOString();

  const { data: matched, error: matchError } = await supabase
    .from('telegram_link_codes')
    .select('id, user_id, email, expires_at')
    .eq('code', enteredCode)
    .is('used_at', null)
    .gt('expires_at', now)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (matchError || !matched) {
    await sendTelegramReply(
      chatId,
      `❌ <b>Geçersiz veya Süresi Dolmuş Kod</b>\n\nGirdiğiniz 6 haneli kod bulunamadı veya 5 dakikalık geçerlilik süresi dolmuş olabilir.\n\nYeniden kod almak için e-posta adresinizi buraya yazabilirsiniz.`,
    );
    return;
  }

  await supabase
    .from('telegram_link_codes')
    .update({ used_at: now })
    .eq('id', matched.id);

  await supabase.from('notify_transports').upsert({
    user_id: matched.user_id,
    kind: 'telegram',
    telegram_chat_id: chatId,
    telegram_username: tgUsername,
    verified_at: now,
    failure_count: 0,
    last_error: null,
    disabled_at: null,
    updated_at: now,
  });

  await sendTelegramReply(
    chatId,
    `✅ <b>Tebrikler! FRAUDE Hesabınız Başarıyla Bağlandı</b>\n\n` +
      `Hesap: <code>${escapeTelegramHtml(matched.email)}</code>\n` +
      `Kanal: <b>Telegram Anlık Bildirimleri</b>\n\n` +
      `Takip ettiğiniz hisselerin KAP açıklamaları, SPK bültenleri ve fiyat alarmları artık bu sohbete 1 saniyede düşecektir.\n\n` +
      `<i>Menüden /hisseler yazarak takip listenizi özelleştirebilir veya /alarm yazarak fiyat alarmı kurabilirsiniz.</i>`,
    { reply_markup: MAIN_KEYBOARD },
  );
}

async function handleSpkBulletins(supabase: any, chatId: string): Promise<void> {
  const currentYear = new Date().getFullYear();
  let bulletins: Array<{ no: string; date: string; url: string }> = [];

  try {
    const res = await fetch(`https://spk.gov.tr/spk-bultenleri/${currentYear}-yili-spk-bultenleri`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const html = await res.text();
      const anchorMatches = html.match(/<a\s+href=["']([^"']*?(\d{4})-(\d+)\.pdf)["'][\s\S]*?<\/a>/gi) || [];
      for (const a of anchorMatches) {
        const hrefMatch = a.match(/href=["']([^"']+)["']/i);
        const baslikMatch = a.match(/liste-baslik[^>]*>([\s\S]*?)<\/div>/i);
        const icerikMatch = a.match(/liste-icerik[^>]*>([\s\S]*?)<\/div>/i);

        const href = hrefMatch ? hrefMatch[1] : '';
        const no = baslikMatch
          ? baslikMatch[1].replace(/<[^>]+>/g, '').replace(/Bülten\s*No\s*:\s*/i, '').trim()
          : '';
        const rawDate = icerikMatch
          ? icerikMatch[1].replace(/<[^>]+>/g, '').replace(/Yayımlanma\s*:\s*/i, '').trim()
          : '';
        const date = rawDate.replace(/&#199;/g, 'Ç').replace(/&ccedil;/g, 'ç').replace(/&nbsp;/g, ' ');

        if (href && (no || href.includes('.pdf'))) {
          bulletins.push({
            no: no || 'Bülten',
            date,
            url: href,
          });
        }
      }
    }
  } catch {}

  const recent = bulletins.slice(0, 4);

  const { data: lastSpk } = await supabase
    .from('notify_outbox')
    .select('subject, payload, created_at')
    .ilike('subject', '%SPK%')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let text = `🏛️ <b>Sermaye Piyasası Kurulu (SPK) Bültenleri</b>\n───────────────────────────\n\n`;

  if (lastSpk) {
    const p = lastSpk.payload as any;
    text += `📢 <b>Son Bülten Özeti:</b>\n<i>${escapeTelegramHtml(p?.summary || p?.title || lastSpk.subject)}</i>\n\n───────────────────────────\n\n`;
  }

  if (recent.length > 0) {
    text += `📄 <b>Son Yayımlanan Resmi Bültenler:</b>\n\n`;
    for (const b of recent) {
      const dateLine = b.date ? `\n  📅 <b>${escapeTelegramHtml(b.date)}</b>` : '';
      text += `• <b>SPK Bülteni No: ${escapeTelegramHtml(b.no)}</b>${dateLine}\n  👉 <a href="${b.url}">Resmi PDF'i Görüntüle / İndir ↗</a>\n\n`;
    }
  } else {
    text += `• <a href="https://spk.gov.tr/spk-bultenleri">SPK Resmi Bülten Sayfasına Git ↗</a>\n\n`;
  }

  text += `───────────────────────────`;

  await sendTelegramReply(chatId, text, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🏛️ Halka Arz Başvuruları', callback_data: 'spk_ipo_apps' },
          { text: '📄 SPK Resmi Sitesi ↗', url: 'https://spk.gov.tr/spk-bultenleri' },
        ],
      ],
    },
  });
}

async function handleIpoApplications(chatId: string): Promise<void> {
  let apps: Array<{ name: string; date: string }> = [];
  try {
    const res = await fetch('https://spk.gov.tr/istatistikler/basvurular/ilk-halka-arz-basvurusu', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const html = await res.text();
      const rows = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
      for (const r of rows) {
        const cells = (r.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || []).map((c) =>
          c.replace(/<[^>]+>/g, '').trim(),
        );
        if (cells.length >= 3 && /\d{2}\.\d{2}\.\d{4}/.test(cells[2])) {
          apps.push({ name: cells[1], date: cells[2] });
        }
      }
    }
  } catch {}

  const recentApps = apps.slice(-6).reverse();

  let text = `🏛️ <b>SPK İlk Halka Arz Başvuru Listesi</b>\n───────────────────────────\n\n`;
  if (recentApps.length > 0) {
    for (const a of recentApps) {
      text += `🏢 <b>${escapeTelegramHtml(a.name)}</b>\n📅 Başvuru Tarihi: <code>${a.date}</code>\n\n`;
    }
  } else {
    text += `Halka arz başvuru listesine şu an ulaşılamıyor.\n\n`;
  }
  text += `───────────────────────────\n<i>Kaynak: spk.gov.tr</i>`;

  await sendTelegramReply(chatId, text, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🏛️ SPK Bültenleri', callback_data: 'spk_bulletin' },
          { text: '🌐 SPK Başvuru Tablosu ↗', url: 'https://spk.gov.tr/istatistikler/basvurular/ilk-halka-arz-basvurusu' },
        ],
      ],
    },
  });
}
