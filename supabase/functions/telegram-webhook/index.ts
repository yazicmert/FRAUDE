// FRAUDE — Gelişmiş Resmi Telegram Bot Webhook, Piyasa Motoru & AI Finans Asistanı
// ─────────────────────────────────────────────────────────────────────────────
// Resmi FRAUDE Telegram Botuna (@FraudeTerminal_Bot) gelen tüm mesajları,
// alarmları, fiyat sorgularını, grafik taleplerini, portföy yönetimini ve
// piyasa taramalarını yönetir:
//   • 6 Haneli Kod ve E-posta ile güvenli hesap eşleştirme
//   • Anlık Hisse Fiyat Kartı & Metrikler (/fiyat THYAO veya doğrudan 'THYAO')
//   • Görsel Fiyat Grafiği (/grafik THYAO) ➔ Koyu temalı QuickChart grafiği
//   • BIST Anlık Tarayıcı (/tavan, /taban, /hacim, /piyasa)
//   • Bilanço & Finansal Rapor Kartı (/bilanco THYAO)
//   • Telegram'dan Mini Portföy Takibi (/portfoy, /portfoy ekle ...)
//   • Telegram'dan Fiyat Alarmı Kurma (/alarm THYAO > 320) ve Yönetimi (/alarmlar)
//   • SPK Bülteni & İlk Halka Arz Başvuru Listesi (/spk, /halkaarz)
//   • Sabah/Akşam Bülteni Tercihi (/bulten ac, /bulten kapat)
//   • Yapay Zekâ Finansal Soru-Cevap (/sor <soru>)

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
    [{ text: '💼 Portföyüm' }, { text: '🏛️ SPK Bülteni' }],
    [{ text: '🚀 Tavan Hisseler' }, { text: '🔔 Alarmlarım' }],
    [{ text: '📰 Son Haberler' }, { text: 'ℹ️ Yardım' }],
  ],
  resize_keyboard: true,
};

const BIST_BENCHMARK_UNIVERSE = [
  'THYAO', 'ASELS', 'GARAN', 'AKBNK', 'ISCTR', 'YKBNK', 'TUPRS', 'EREGL', 'BIMAS', 'SAHOL',
  'KCHOL', 'SISE', 'PETKM', 'TCELL', 'FROTO', 'TOASO', 'TTKOM', 'PGSUS', 'ENKAI', 'KOZAL',
  'ASTOR', 'SASA', 'HEKTS', 'KRDMD', 'MGROS', 'OYAKC', 'CIMSA', 'ALARK', 'EKGYO', 'KONTR'
];

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

async function sendTelegramPhoto(
  chatId: string | number,
  photoUrl: string,
  caption: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (!BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      photo: photoUrl,
      caption: caption,
      parse_mode: 'HTML',
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
  history?: number[];
}

async function fetchLiveQuote(rawTicker: string, includeHistory = false): Promise<YahooQuote | null> {
  const clean = rawTicker.toUpperCase().trim();
  const yahooSymbol = clean.includes('=') || clean.includes('-') ? clean : `${clean}.IS`;
  const range = includeHistory ? '1mo' : '1d';
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=${range}&interval=1d`,
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

    let history: number[] | undefined;
    if (includeHistory) {
      const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close as Array<number | null> | undefined;
      if (Array.isArray(closes)) {
        history = closes.filter((c): c is number => typeof c === 'number' && Number.isFinite(c));
      }
    }

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
      history,
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
    } else if (data.startsWith('chart_')) {
      const tk = data.replace('chart_', '').toUpperCase();
      await handleSendChart(cbChatId, tk);
    } else if (data.startsWith('del_alert_')) {
      const alertId = data.replace('del_alert_', '');
      await handleDeleteAlert(supabase, cbChatId, alertId);
    } else if (data.startsWith('del_port_')) {
      const tk = data.replace('del_port_', '').toUpperCase();
      await handleRemoveFromPortfolio(supabase, cbChatId, tk);
    } else if (data.startsWith('kap_')) {
      const tk = data.replace('kap_', '').toUpperCase();
      await handleRecentNewsForTicker(supabase, cbChatId, tk);
    } else if (data.startsWith('fin_')) {
      const tk = data.replace('fin_', '').toUpperCase();
      await handleFinancialStatement(supabase, cbChatId, tk);
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
      `Borsa İstanbul KAP açıklamalarını, SPK bültenlerini, fiyat alarmlarını ve portföy durumunu bu sohbete <b>1 saniyede anlık</b> almak için hesabınızı bağlayın.\n\n` +
      `<b>⚡ Nasıl Bağlanır?</b>\n` +
      `1️⃣ <b>E-posta ile:</b> FRAUDE hesabınızın e-postasını buraya yazın (örn: <code>adiniz@gmail.com</code>). Size hemen 6 haneli kod gönderelim.\n` +
      `2️⃣ <b>Uygulamadan:</b> FRAUDE Terminal masaüstü uygulamasında <i>Bildirimler ➔ Telegram</i> sekmesinden aldığınız kodu buraya gönderin.\n\n` +
      `<b>🚀 Hızlı Komutlar:</b>\n` +
      `• <code>/fiyat THYAO</code> veya doğrudan <code>THYAO</code> - Canlı fiyat\n` +
      `• <code>/grafik THYAO</code> - 1 Aylık görsel fiyat grafiği\n` +
      `• <code>/bilanco THYAO</code> - Bilanço ve kârlılık kartı\n` +
      `• <code>/tavan</code> - Günün en çok yükselen hisseleri\n` +
      `• <code>/portfoy</code> - Portföy ve kâr/zarar takibi\n` +
      `• <code>/spk</code> - SPK bültenleri & Halka arz listesi\n` +
      `• <code>/alarm THYAO &gt; 350</code> - Fiyat alarmı kur\n` +
      `• <code>/sor &lt;soru&gt;</code> - Yapay zekâ piyasa danışmanı`;

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

  // ── /portfoy ──────────────────────────────────────────────────────────────
  if (rawText.startsWith('/portfoy') || rawText === '💼 Portföyüm') {
    await handlePortfolioRouting(supabase, chatId, rawText);
    return new Response('ok', { status: 200 });
  }

  // ── /tavan veya Buton ─────────────────────────────────────────────────────
  if (rawText === '/tavan' || rawText === '🚀 Tavan Hisseler') {
    await handleMarketScreener(chatId, 'gainers');
    return new Response('ok', { status: 200 });
  }

  // ── /taban ────────────────────────────────────────────────────────────────
  if (rawText === '/taban' || rawText === '/dusenler') {
    await handleMarketScreener(chatId, 'losers');
    return new Response('ok', { status: 200 });
  }

  // ── /hacim ────────────────────────────────────────────────────────────────
  if (rawText === '/hacim') {
    await handleMarketScreener(chatId, 'volume');
    return new Response('ok', { status: 200 });
  }

  // ── /piyasa veya /ozet ───────────────────────────────────────────────────
  if (rawText === '/piyasa' || rawText === '/ozet') {
    await handleMarketSummary(chatId);
    return new Response('ok', { status: 200 });
  }

  // ── /grafik <TICKER> ──────────────────────────────────────────────────────
  if (rawText.startsWith('/grafik') || rawText.startsWith('/chart')) {
    const tk = rawText.replace(/^\/grafik|^\/chart/, '').trim().toUpperCase();
    if (!tk) {
      await sendTelegramReply(chatId, `ℹ️ Lütfen grafiğini görmek istediğiniz hisseyi belirtin.\nÖrnek: <code>/grafik THYAO</code>`);
      return new Response('ok', { status: 200 });
    }
    await handleSendChart(chatId, tk);
    return new Response('ok', { status: 200 });
  }

  // ── /bilanco <TICKER> ─────────────────────────────────────────────────────
  if (rawText.startsWith('/bilanco') || rawText.startsWith('/finansal')) {
    const tk = rawText.replace(/^\/bilanco|^\/finansal/, '').trim().toUpperCase();
    if (!tk) {
      await sendTelegramReply(chatId, `ℹ️ Lütfen bilançosunu görmek istediğiniz hisseyi belirtin.\nÖrnek: <code>/bilanco THYAO</code>`);
      return new Response('ok', { status: 200 });
    }
    await handleFinancialStatement(supabase, chatId, tk);
    return new Response('ok', { status: 200 });
  }

  // ── /bulten ac / bulten kapat ─────────────────────────────────────────────
  if (rawText.startsWith('/bulten')) {
    await handleDigestPreference(supabase, chatId, rawText);
    return new Response('ok', { status: 200 });
  }

  // ── /spk ──────────────────────────────────────────────────────────────────
  if (rawText === '/spk' || rawText === '🏛️ SPK Bülteni') {
    await handleSpkBulletins(supabase, chatId);
    return new Response('ok', { status: 200 });
  }

  // ── /halkaarz veya /ipo ───────────────────────────────────────────────────
  if (rawText === '/halkaarz' || rawText === '/ipo' || rawText === '🏛️ Halka Arzlar') {
    await handleIpoApplications(chatId);
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

  // ── /haberler ─────────────────────────────────────────────────────────────
  if (rawText === '/haberler' || rawText === '📰 Son Haberler') {
    await handleRecentNews(supabase, chatId);
    return new Response('ok', { status: 200 });
  }

  // ── /yardim ───────────────────────────────────────────────────────────────
  if (rawText === '/yardim' || rawText === '/help' || rawText === 'ℹ️ Yardım') {
    const helpMsg = `📖 <b>FRAUDE Bot Komut Rehberi</b>\n\n` +
      `<b>📊 Piyasa & Fiyat:</b>\n` +
      `• <code>THYAO</code> veya <code>/fiyat THYAO</code>: Canlı fiyat kartı\n` +
      `• <code>/grafik THYAO</code>: 1 Aylık görsel fiyat grafiği\n` +
      `• <code>/bilanco THYAO</code>: Bilanço ve kârlılık rasyoları\n` +
      `• <code>/tavan</code>: En çok yükselen BIST hisseleri\n` +
      `• <code>/taban</code>: En çok düşen hisseler\n` +
      `• <code>/hacim</code>: Hacim liderleri\n` +
      `• <code>/piyasa</code>: BIST 100, Altın, Döviz ve Petrol özeti\n\n` +
      `<b>💼 Portföy & Alarmlar:</b>\n` +
      `• <code>/portfoy</code>: Portföy özeti ve anlık kâr/zarar\n` +
      `• <code>/portfoy ekle THYAO 100 310.50</code>: Portföye hisse ekle\n` +
      `• <code>/alarm THYAO &gt; 350</code>: Fiyat alarmı kur\n` +
      `• <code>/alarmlar</code>: Aktif alarmları yönet\n\n` +
      `<b>🏛️ Kurul & Haberler:</b>\n` +
      `• <code>/spk</code>: SPK haftalık bültenleri & PDF\n` +
      `• <code>/halkaarz</code>: Halka arz başvuru listesi\n` +
      `• <code>/bulten ac</code>: Sabah/Akşam otomatik bülten\n` +
      `• <code>/sor &lt;soru&gt;</code>: AI piyasa analizi`;
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
    `ℹ️ Lütfen geçerli bir komut (örn: <code>THYAO</code>, <code>/portfoy</code>, <code>/tavan</code>) veya 6 haneli kodunuzu yazın.\n\nRehber için /yardim yazabilirsiniz.`,
    { reply_markup: MAIN_KEYBOARD },
  );
  return new Response('ok', { status: 200 });
});

// ── 1. Görsel Fiyat Grafiği ──────────────────────────────────────────────────

async function handleSendChart(chatId: string, ticker: string): Promise<void> {
  const quote = await fetchLiveQuote(ticker, true);
  if (!quote || !quote.history || quote.history.length === 0) {
    await sendTelegramReply(chatId, `⚠️ <code>${escapeTelegramHtml(ticker)}</code> için grafik verisi yüklenemedi.`);
    return;
  }

  const prices = quote.history;
  const isUp = quote.price >= quote.prevClose;
  const color = isUp ? '#00e676' : '#ff5252';
  const bgColor = isUp ? 'rgba(0,230,118,0.12)' : 'rgba(255,82,82,0.12)';
  const minVal = Math.min(...prices) * 0.985;
  const maxVal = Math.max(...prices) * 1.015;

  const chartConfig = {
    type: 'line',
    data: {
      labels: prices.map((_, i) => String(i + 1)),
      datasets: [
        {
          label: ticker,
          data: prices,
          borderColor: color,
          borderWidth: 3,
          backgroundColor: bgColor,
          fill: true,
          pointRadius: 0,
          tension: 0.2,
        },
      ],
    },
    options: {
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: `${ticker} · Son 1 Ay Fiyat Trendi`,
          color: '#ffffff',
          font: { size: 16, weight: 'bold' },
        },
      },
      layout: { padding: 15 },
      scales: {
        x: { display: false },
        y: {
          min: minVal,
          max: maxVal,
          grid: { color: 'rgba(255,255,255,0.08)' },
          ticks: { color: '#8b949e', font: { size: 11 } },
        },
      },
    },
  };

  const chartUrl = `https://quickchart.io/chart?bkg=%230d1117&w=600&h=320&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;

  const formatNum = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = isUp ? '+' : '';
  const icon = isUp ? '🟢' : '🔴';

  const caption = `📈 <b>${escapeTelegramHtml(quote.symbol)} · 1 Aylık Grafik</b>\n` +
    `💰 <b>Son Fiyat:</b> <code>${formatNum(quote.price)} ${quote.currency}</code> (${sign}%${formatNum(quote.pctChange)} ${icon})\n` +
    `📊 <b>1 Aylık Aralık:</b> ${formatNum(Math.min(...prices))} - ${formatNum(Math.max(...prices))} TL`;

  await sendTelegramPhoto(chatId, chartUrl, caption, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📊 Finansallar', callback_data: `fin_${quote.symbol}` },
          { text: '➕ Listeme Ekle', callback_data: `add_${quote.symbol}` },
        ],
      ],
    },
  });
}

// ── 2. Piyasa Tarayıcısı (Tavan, Taban, Hacim) ───────────────────────────────

async function handleMarketScreener(chatId: string, mode: 'gainers' | 'losers' | 'volume'): Promise<void> {
  await sendTelegramReply(chatId, `🔍 <i>BIST taranıyor…</i>`);

  const quotes: YahooQuote[] = [];
  await Promise.all(
    BIST_BENCHMARK_UNIVERSE.map(async (tk) => {
      const q = await fetchLiveQuote(tk);
      if (q) quotes.push(q);
    }),
  );

  if (quotes.length === 0) {
    await sendTelegramReply(chatId, `⚠️ Piyasa verisi alınamadı.`);
    return;
  }

  let title = '';
  let sorted: YahooQuote[] = [];

  if (mode === 'gainers') {
    title = `🚀 <b>Günün En Çok Yükselen BIST Hisseleri:</b>`;
    sorted = quotes.sort((a, b) => b.pctChange - a.pctChange).slice(0, 6);
  } else if (mode === 'losers') {
    title = `📉 <b>Günün En Çok Düşen BIST Hisseleri:</b>`;
    sorted = quotes.sort((a, b) => a.pctChange - b.pctChange).slice(0, 6);
  } else {
    title = `📊 <b>Günün En Yüksek Hacimli BIST Hisseleri:</b>`;
    sorted = quotes.sort((a, b) => (b.volume * b.price) - (a.volume * a.price)).slice(0, 6);
  }

  const formatNum = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let text = `${title}\n───────────────────────────\n\n`;
  for (const q of sorted) {
    const isUp = q.change >= 0;
    const icon = isUp ? '🟢' : '🔴';
    const sign = isUp ? '+' : '';
    text += `• <b>${q.symbol}</b>: <code>${formatNum(q.price)} TL</code> (${sign}%${formatNum(q.pctChange)} ${icon})\n`;
  }
  text += `\n───────────────────────────\n<i>Grafik görmek için <code>/grafik KOD</code> yazabilirsiniz.</i>`;

  await sendTelegramReply(chatId, text);
}

async function handleMarketSummary(chatId: string): Promise<void> {
  const instruments = [
    { name: 'BIST 100', symbol: 'XU100.IS' },
    { name: 'Dolar / TL', symbol: 'USDTRY=X' },
    { name: 'Euro / TL', symbol: 'EURTRY=X' },
    { name: 'Gram Altın', symbol: 'GC=F' },
    { name: 'Brent Petrol', symbol: 'BZ=F' },
    { name: 'Bitcoin', symbol: 'BTC-USD' },
  ];

  const results = await Promise.all(
    instruments.map(async (inst) => {
      const q = await fetchLiveQuote(inst.symbol);
      return { ...inst, quote: q };
    }),
  );

  const formatNum = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let text = `🌐 <b>Piyasa Genel Özeti</b>\n───────────────────────────\n\n`;
  for (const r of results) {
    if (!r.quote) continue;
    const isUp = r.quote.change >= 0;
    const icon = isUp ? '🟢' : '🔴';
    const sign = isUp ? '+' : '';
    text += `• <b>${r.name}:</b> <code>${formatNum(r.quote.price)}</code> (${sign}%${formatNum(r.quote.pctChange)} ${icon})\n`;
  }
  text += `\n───────────────────────────\n<i>Kaynak: FRAUDE Canlı Piyasa Motoru</i>`;

  await sendTelegramReply(chatId, text);
}

// ── 3. Bilanço ve Finansal Kart ─────────────────────────────────────────────

async function handleFinancialStatement(supabase: any, chatId: string, ticker: string): Promise<void> {
  const { data: quarters } = await supabase
    .from('bist_financial_quarters')
    .select('year, quarter, revenue, gross_profit, operating_income, net_income, currency')
    .eq('ticker', ticker)
    .order('year', { ascending: false })
    .order('quarter', { ascending: false })
    .limit(4);

  if (!quarters || quarters.length === 0) {
    await sendTelegramReply(chatId, `ℹ️ <code>${escapeTelegramHtml(ticker)}</code> için henüz XBRL bilanço kaydı bulunamadı.`);
    return;
  }

  const latest = quarters[0];
  const prevYear = quarters.find((q: any) => q.year === latest.year - 1 && q.quarter === latest.quarter);

  const fmtM = (n: number | null | undefined) => {
    if (n === null || n === undefined) return '-';
    if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} Mlr TL`;
    if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} Mln TL`;
    return `${n.toLocaleString('tr-TR')} TL`;
  };

  const calcGrowth = (curr: number | null, prev: number | null) => {
    if (!curr || !prev || prev === 0) return '';
    const pct = ((curr - prev) / Math.abs(prev)) * 100;
    const sign = pct >= 0 ? '+' : '';
    const icon = pct >= 0 ? '🟢' : '🔴';
    return ` (Yıllık ${sign}%${pct.toFixed(1)} ${icon})`;
  };

  const text = `📊 <b>${escapeTelegramHtml(ticker)} Finansal Özeti (${latest.year}/Q${latest.quarter})</b>\n` +
    `───────────────────────────\n\n` +
    `💰 <b>Net Satışlar (Hasılat):</b>\n• <code>${fmtM(latest.revenue)}</code>${calcGrowth(latest.revenue, prevYear?.revenue)}\n\n` +
    `📈 <b>Brüt Kâr:</b>\n• <code>${fmtM(latest.gross_profit)}</code>${calcGrowth(latest.gross_profit, prevYear?.gross_profit)}\n\n` +
    `⚙️ <b>Esas Faaliyet Kârı:</b>\n• <code>${fmtM(latest.operating_income)}</code>${calcGrowth(latest.operating_income, prevYear?.operating_income)}\n\n` +
    `🎯 <b>Net Dönem Kârı:</b>\n• <code>${fmtM(latest.net_income)}</code>${calcGrowth(latest.net_income, prevYear?.net_income)}\n\n` +
    `───────────────────────────\n<i>Kaynak: KAP XBRL Resmi Finansal Tablolar</i>`;

  await sendTelegramReply(chatId, text, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📈 Fiyat Grafiği', callback_data: `chart_${ticker}` },
          { text: '📰 Son KAP', callback_data: `kap_${ticker}` },
        ],
      ],
    },
  });
}

// ── 4. Mini Portföy Yönetimi ────────────────────────────────────────────────

async function handlePortfolioRouting(supabase: any, chatId: string, rawText: string): Promise<void> {
  const { data: transport } = await supabase
    .from('notify_transports')
    .select('user_id')
    .eq('telegram_chat_id', chatId)
    .eq('kind', 'telegram')
    .maybeSingle();

  if (!transport) {
    await sendTelegramReply(chatId, `⚠️ Portföyünüzü görmek için önce e-posta adresinizi yazarak oturum açmalısınız.`);
    return;
  }

  // Örnek: /portfoy ekle THYAO 100 310.50
  const addMatch = rawText.match(/^\/portfoy\s+ekle\s+([A-Za-z0-9]+)\s+([0-9.,]+)\s+([0-9.,]+)$/i);
  if (addMatch) {
    const tk = addMatch[1].toUpperCase();
    const shares = parseFloat(addMatch[2].replace(',', '.'));
    const cost = parseFloat(addMatch[3].replace(',', '.'));
    if (!shares || !cost || shares <= 0 || cost <= 0) {
      await sendTelegramReply(chatId, `⚠️ Lütfen geçerli lot adedi ve maliyet girin.\nÖrnek: <code>/portfoy ekle THYAO 100 310.50</code>`);
      return;
    }

    await supabase.from('user_portfolio_items').upsert({
      user_id: transport.user_id,
      ticker: tk,
      shares,
      cost_basis: cost,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,ticker' });

    await sendTelegramReply(chatId, `✅ <b>${tk}</b> portföyünüze eklendi!\n📦 <b>${shares} Lot</b> · Maliyet: <b>${cost.toFixed(2)} TL</b>`);
    await handleViewPortfolio(supabase, chatId, transport.user_id);
    return;
  }

  // Örnek: /portfoy sil THYAO
  const delMatch = rawText.match(/^\/portfoy\s+(?:sil|cikar)\s+([A-Za-z0-9]+)$/i);
  if (delMatch) {
    const tk = delMatch[1].toUpperCase();
    await supabase.from('user_portfolio_items').delete().eq('user_id', transport.user_id).eq('ticker', tk);
    await sendTelegramReply(chatId, `🗑️ <b>${tk}</b> portföyünüzden çıkarıldı.`);
    await handleViewPortfolio(supabase, chatId, transport.user_id);
    return;
  }

  // Sadece /portfoy
  await handleViewPortfolio(supabase, chatId, transport.user_id);
}

async function handleViewPortfolio(supabase: any, chatId: string, userId: string): Promise<void> {
  const { data: items } = await supabase
    .from('user_portfolio_items')
    .select('id, ticker, shares, cost_basis')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (!items || items.length === 0) {
    const emptyMsg = `💼 <b>Portföyünüz Henüz Boş</b>\n\n` +
      `Portföyünüze hisse eklemek için:\n` +
      `<code>/portfoy ekle THYAO 100 310.50</code>\n` +
      `(Format: Hisse, Lot Sayısı, Ortalama Maliyet)`;
    await sendTelegramReply(chatId, emptyMsg);
    return;
  }

  let totalCost = 0;
  let totalCurrentVal = 0;
  const rows: Array<{
    ticker: string;
    shares: number;
    cost: number;
    price: number;
    val: number;
    pl: number;
    pct: number;
  }> = [];

  for (const item of items) {
    const q = await fetchLiveQuote(item.ticker);
    const price = q?.price || Number(item.cost_basis);
    const shares = Number(item.shares);
    const costBasis = Number(item.cost_basis);
    const itemCost = shares * costBasis;
    const itemVal = shares * price;
    const pl = itemVal - itemCost;
    const pct = itemCost > 0 ? (pl / itemCost) * 100 : 0;

    totalCost += itemCost;
    totalCurrentVal += itemVal;

    rows.push({
      ticker: item.ticker,
      shares,
      cost: costBasis,
      price,
      val: itemVal,
      pl,
      pct,
    });
  }

  const totalPL = totalCurrentVal - totalCost;
  const totalPct = totalCost > 0 ? (totalPL / totalCost) * 100 : 0;
  const isUp = totalPL >= 0;
  const sign = isUp ? '+' : '';
  const icon = isUp ? '🟢' : '🔴';

  const fmt = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let text = `💼 <b>Portföy Durumunuz</b>\n───────────────────────────\n` +
    `💰 <b>Toplam Değer:</b> <code>${fmt(totalCurrentVal)} TL</code>\n` +
    `🎯 <b>Toplam Kâr/Zarar:</b> <b>${sign}${fmt(totalPL)} TL (${sign}%${fmt(totalPct)} ${icon})</b>\n` +
    `───────────────────────────\n\n`;

  const inlineButtons: Array<Array<{ text: string; callback_data: string }>> = [];

  for (const r of rows) {
    const rUp = r.pl >= 0;
    const rIcon = rUp ? '🟢' : '🔴';
    const rSign = rUp ? '+' : '';
    text += `• <b>${r.ticker}</b> (${r.shares} Lot)\n` +
      `  Fiyat: <code>${fmt(r.price)} TL</code> | Maliyet: ${fmt(r.cost)} TL\n` +
      `  Kâr/Zarar: <b>${rSign}${fmt(r.pl)} TL (${rSign}%${fmt(r.pct)} ${rIcon})</b>\n\n`;

    inlineButtons.push([
      { text: `📈 Grafik: ${r.ticker}`, callback_data: `chart_${r.ticker}` },
      { text: `🗑️ Portföyden Çıkar`, callback_data: `del_port_${r.ticker}` },
    ]);
  }

  text += `───────────────────────────\n<i>Hisse eklemek için: <code>/portfoy ekle KOD LOT MALİYET</code></i>`;

  await sendTelegramReply(chatId, text, {
    reply_markup: {
      inline_keyboard: inlineButtons,
    },
  });
}

async function handleRemoveFromPortfolio(supabase: any, chatId: string, ticker: string): Promise<void> {
  const { data: transport } = await supabase
    .from('notify_transports')
    .select('user_id')
    .eq('telegram_chat_id', chatId)
    .eq('kind', 'telegram')
    .maybeSingle();

  if (transport) {
    await supabase.from('user_portfolio_items').delete().eq('user_id', transport.user_id).eq('ticker', ticker);
    await sendTelegramReply(chatId, `🗑️ <b>${ticker}</b> portföyünüzden çıkarıldı.`);
    await handleViewPortfolio(supabase, chatId, transport.user_id);
  }
}

// ── 5. Sabah / Akşam Bülteni Ayarı ──────────────────────────────────────────

async function handleDigestPreference(supabase: any, chatId: string, rawText: string): Promise<void> {
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

  const isDisable = rawText.includes('kapat') || rawText.includes('iptal') || rawText.includes('off');
  const enabled = !isDisable;

  await supabase
    .from('notify_prefs')
    .update({ daily_digest_enabled: enabled, updated_at: new Date().toISOString() })
    .eq('user_id', transport.user_id);

  if (enabled) {
    await sendTelegramReply(
      chatId,
      `☀️ <b>Sabah & Akşam Piyasa Bülteni Aktif Edildi!</b>\n\n` +
        `• <b>09:45:</b> Sabah seans açılış öncesi küresel piyasalar, Dolar/Altın ve gece gelen kritik KAP özetleri.\n` +
        `• <b>18:35:</b> Akşam seans kapanışı, BIST 100 kapanış rakamları ve günün en çok kazandıranları.\n\n` +
        `<i>Kapatmak isterseniz <code>/bulten kapat</code> yazabilirsiniz.</i>`,
    );
  } else {
    await sendTelegramReply(
      chatId,
      `🔕 <b>Piyasa Bülteni Kapatıldı</b>\n\nSabah ve akşam bültenleri gönderilmeyecektir. Yeniden açmak için: <code>/bulten ac</code>`,
    );
  }
}

// ── Yardımcı Fonksiyonlar ───────────────────────────────────────────────────

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
          { text: `📈 Grafik`, callback_data: `chart_${quote.symbol}` },
          { text: `📊 Bilanço`, callback_data: `fin_${quote.symbol}` },
        ],
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
    .select('tickers, min_priority, enabled, kap_enabled, spk_enabled, news_enabled, daily_digest_enabled, email')
    .eq('user_id', transport.user_id)
    .maybeSingle();

  const tickersList = prefs?.tickers?.length ? prefs.tickers.join(', ') : 'Tüm BIST (Yalnızca Kritik 4-5 Seviye)';
  const digestStatus = prefs?.daily_digest_enabled !== false ? '🟢 Aktif' : '⚪ Kapalı';

  const statusText = `📊 <b>FRAUDE Telegram Bildirim Durumu</b>\n\n` +
    `Durum: 🟢 <b>Aktif & Bağlı</b>\n` +
    `Hesap: <code>${escapeTelegramHtml(prefs?.email || transport.user_id.slice(0, 8))}</code>\n` +
    `İzlenen Hisseler: <code>${escapeTelegramHtml(tickersList)}</code>\n` +
    `Günlük Bülten: <b>${digestStatus}</b>\n` +
    `Minimum Öncelik Eşiği: <b>${prefs?.min_priority ?? 4}+ (Kritik)</b>\n` +
    `Kaynaklar: KAP (${prefs?.kap_enabled !== false ? '✓' : '✗'}), SPK (${prefs?.spk_enabled !== false ? '✓' : '✗'}), Haber (${prefs?.news_enabled !== false ? '✓' : '✗'})\n\n` +
    `<i>Hisse eklemek için <code>/ekle KOD</code>, portföy için <code>/portfoy</code> yazabilirsiniz.</i>`;

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
      `<i>Menüden /hisseler yazarak takip listenizi özelleştirebilir veya /portfoy yazarak portföyünüzü ekleyebilirsiniz.</i>`,
    { reply_markup: MAIN_KEYBOARD },
  );
}
