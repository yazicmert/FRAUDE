// FRAUDE — Gelişmiş Resmi Telegram Bot Webhook İşleyicisi
// ─────────────────────────────────────────────────────────────────────────────
// Resmi FRAUDE Telegram Botuna (@FraudeTerminal_Bot) gelen mesajları ve
// komutları karşılar:
//   • E-posta ile 6 haneli doğrulama PIN'i üretme ve e-postaya gönderme
//   • 6 haneli kodla (veya /start <kod> derin bağlantısıyla) tek tıkla eşleştirme
//   • /durum, /hisseler, /ekle, /cikar, /haberler, /cikis komutları
//   • İnteraktif özel klavye menüsü ve geri çağırma (callback_query) desteği

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  escapeTelegramHtml,
  renderPairingEmailHtml,
  sendViaPlatform,
} from '../_shared/mailer.ts';

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '8991375615:AAGjohoZvw-eWcumCtDfS391Op7W_ER14ks';

const MAIN_KEYBOARD = {
  keyboard: [
    [{ text: '📊 Durum' }, { text: '📈 Hisselerim' }],
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

  // ── Callback Query (İnline Buton Tıklaması) ──────────────────────────────
  const callbackQuery = update.callback_query as {
    id?: string;
    message?: { chat?: { id?: number } };
    data?: string;
  } | undefined;

  if (callbackQuery?.data && callbackQuery.message?.chat?.id) {
    const cbChatId = String(callbackQuery.message.chat.id);
    const data = callbackQuery.data;

    // Telegram'a callback cevabı ver (yükleniyor simgesini kaldır)
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQuery.id }),
    }).catch(() => {});

    if (data === 'refresh_status') {
      // Durumu yenile
      await handleStatus(supabase, cbChatId);
    }
    return new Response('ok', { status: 200 });
  }

  // ── Standart Mesaj ────────────────────────────────────────────────────────
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

  // ── 1. Derin Bağlantılı /start <kod> veya Düz /start ───────────────────────
  if (rawText.startsWith('/start')) {
    const parts = rawText.split(/\s+/);
    const startParam = parts[1]?.trim();

    // Eğer /start 849201 şeklinde kodla gelmişse doğrudan doğrula
    if (startParam && /^\d{6}$/.test(startParam)) {
      await handleVerifyCode(supabase, chatId, startParam, tgUsername);
      return new Response('ok', { status: 200 });
    }

    const welcome = `👋 <b>FRAUDE Terminal Bildirim Botuna Hoş Geldiniz!</b>\n\n` +
      `Borsa İstanbul KAP açıklamalarını, SPK bültenlerini ve fiyat alarmlarını bu sohbete <b>1 saniyede anlık</b> almak için hesabınızı bağlayın.\n\n` +
      `<b>⚡ Nasıl Bağlanır?</b>\n` +
      `1️⃣ <b>E-posta ile:</b> FRAUDE hesabınızın e-postasını buraya yazın (örn: <code>adiniz@gmail.com</code>). Size hemen 6 haneli bir kod göndereceğiz.\n` +
      `2️⃣ <b>Uygulamadan:</b> FRAUDE Terminal masaüstü uygulamasında <i>Bildirimler ➔ Telegram</i> sekmesinden aldığınız kodu buraya gönderin.\n\n` +
      `<i>Komutlar:</i>\n` +
      `/durum - Bildirim ve hesap durumu\n` +
      `/hisseler - Takip edilen hisseler\n` +
      `/ekle &lt;KOD&gt; - Listeye hisse ekle\n` +
      `/cikar &lt;KOD&gt; - Listeden hisse çıkar\n` +
      `/haberler - Son gelen kritik haberler\n` +
      `/cikis - Bağlantıyı kes`;

    await sendTelegramReply(chatId, welcome, { reply_markup: MAIN_KEYBOARD });
    return new Response('ok', { status: 200 });
  }

  // ── 2. /durum veya Buton ──────────────────────────────────────────────────
  if (rawText === '/durum' || rawText === '/status' || rawText === '📊 Durum') {
    await handleStatus(supabase, chatId);
    return new Response('ok', { status: 200 });
  }

  // ── 3. /hisseler veya Buton ───────────────────────────────────────────────
  if (rawText === '/hisseler' || rawText === '📈 Hisselerim') {
    await handleWatchlist(supabase, chatId);
    return new Response('ok', { status: 200 });
  }

  // ── 4. /ekle <TICKER> veya + <TICKER> ─────────────────────────────────────
  if (rawText.startsWith('/ekle') || rawText.startsWith('+')) {
    const cleanTk = rawText.replace(/^\/ekle|\+/, '').trim().toUpperCase();
    if (!cleanTk) {
      await sendTelegramReply(chatId, `ℹ️ Lütfen eklenecek hisse kodunu belirtin.\nÖrnek: <code>/ekle THYAO</code>`);
      return new Response('ok', { status: 200 });
    }
    await handleAddTicker(supabase, chatId, cleanTk);
    return new Response('ok', { status: 200 });
  }

  // ── 5. /cikar <TICKER> veya - <TICKER> ────────────────────────────────────
  if (rawText.startsWith('/cikar') || rawText.startsWith('/sil') || rawText.startsWith('-')) {
    const cleanTk = rawText.replace(/^\/cikar|\/sil|-/, '').trim().toUpperCase();
    if (!cleanTk) {
      await sendTelegramReply(chatId, `ℹ️ Lütfen çıkarılacak hisse kodunu belirtin.\nÖrnek: <code>/cikar THYAO</code>`);
      return new Response('ok', { status: 200 });
    }
    await handleRemoveTicker(supabase, chatId, cleanTk);
    return new Response('ok', { status: 200 });
  }

  // ── 6. /haberler veya Buton ───────────────────────────────────────────────
  if (rawText === '/haberler' || rawText === '📰 Son Haberler') {
    await handleRecentNews(supabase, chatId);
    return new Response('ok', { status: 200 });
  }

  // ── 7. /yardim ────────────────────────────────────────────────────────────
  if (rawText === '/yardim' || rawText === '/help' || rawText === 'ℹ️ Yardım') {
    const helpMsg = `📖 <b>FRAUDE Bot Komut Rehberi</b>\n\n` +
      `• <code>/durum</code>: Bağlı hesap ve bildirim ayarlarını gösterir.\n` +
      `• <code>/hisseler</code>: Bildirim aldığınız hisseleri listeler.\n` +
      `• <code>/ekle THYAO</code>: THYAO hissesini bildirim listenize ekler.\n` +
      `• <code>/cikar THYAO</code>: THYAO hissesini listenizden çıkarır.\n` +
      `• <code>/haberler</code>: Son gelen kritik KAP bildirimlerini listeler.\n` +
      `• <code>/cikis</code>: Telegram bildirim bağlantısını sonlandırır.`;
    await sendTelegramReply(chatId, helpMsg, { reply_markup: MAIN_KEYBOARD });
    return new Response('ok', { status: 200 });
  }

  // ── 8. /cikis ─────────────────────────────────────────────────────────────
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

  // ── 9. E-posta Girildiyse ➔ Kod Üret ve Mail Gönder ──────────────────────
  if (isEmail(rawText)) {
    await handleSendEmailCode(supabase, chatId, rawText.toLowerCase().trim());
    return new Response('ok', { status: 200 });
  }

  // ── 10. 6 Haneli Kod Girildiyse ➔ Doğrula ve Bağla ────────────────────────
  if (/^\d{6}$/.test(rawText)) {
    await handleVerifyCode(supabase, chatId, rawText, tgUsername);
    return new Response('ok', { status: 200 });
  }

  // ── 11. Bilinmeyen Mesaj ──────────────────────────────────────────────────
  await sendTelegramReply(
    chatId,
    `ℹ️ Lütfen kayıtlı <b>e-posta adresinizi</b> veya uygulamadan aldığınız <b>6 haneli kodu</b> yazın.\n\nYardım için /yardim yazabilirsiniz.`,
    { reply_markup: MAIN_KEYBOARD },
  );
  return new Response('ok', { status: 200 });
});

// ── Yardımcı Fonksiyonlar ───────────────────────────────────────────────────

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
    `<i>Hisse eklemek için <code>/ekle KOD</code> yazabilirsiniz.</i>`;

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
  // notify_deliveries veya notify_outbox üzerinden en son 5 bildirimi çek
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
      `Takip ettiğiniz hisselerin KAP açıklamaları, SPK bültenleri ve piyasa alarmları artık bu sohbete 1 saniyede düşecektir.\n\n` +
      `<i>Menüden /hisseler yazarak takip listenizi özelleştirebilirsiniz.</i>`,
    { reply_markup: MAIN_KEYBOARD },
  );
}
