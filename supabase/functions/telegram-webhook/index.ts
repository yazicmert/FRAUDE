// FRAUDE — Telegram Bot Webhook İşleyicisi
// ─────────────────────────────────────────────────────────────────────────────
// Resmi FRAUDE Telegram Botuna (@FraudeTerminalBot) gelen mesajları karşılar.
// Kullanıcılar e-posta yazarak veya uygulamadan aldıkları 6 haneli kodla
// hesaplarını bağlayabilir.

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  escapeTelegramHtml,
  renderPairingEmailHtml,
  sendViaPlatform,
} from '../_shared/mailer.ts';

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';

async function sendTelegramReply(chatId: string | number, htmlText: string): Promise<void> {
  if (!BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: htmlText,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── 1. Komut: /start /help ────────────────────────────────────────────────
  if (rawText.startsWith('/start') || rawText === '/help' || rawText === '/yardim') {
    const welcome = `👋 <b>FRAUDE Terminal Bildirim Botuna Hoş Geldiniz!</b>\n\n` +
      `BIST KAP bildirimlerini, SPK bültenlerini ve fiyat alarmlarını bu sohbete anlık olarak almak için hesabınızı bağlayabilirsiniz.\n\n` +
      `<b>Nasıl Bağlanır?</b>\n` +
      `1️⃣ <b>E-posta ile:</b> Buraya FRAUDE hesabınızın e-postasını yazın (örn: <code>adiniz@gmail.com</code>). Size 6 haneli bir kod göndereceğiz.\n` +
      `2️⃣ <b>Uygulamadan:</b> FRAUDE Terminal masaüstü uygulamasında <i>Bildirimler ➔ Telegram</i> sekmesinden aldığınız kodu buraya yazın.\n\n` +
      `<i>Komutlar:</i>\n` +
      `/durum - Bildirim ve hesap durumu\n` +
      `/cikis - Telegram bağlantısını kes`;
    await sendTelegramReply(chatId, welcome);
    return new Response('ok', { status: 200 });
  }

  // ── 2. Komut: /durum /status ──────────────────────────────────────────────
  if (rawText === '/durum' || rawText === '/status') {
    const { data: transport } = await supabase
      .from('notify_transports')
      .select('user_id, verified_at, disabled_at')
      .eq('telegram_chat_id', chatId)
      .eq('kind', 'telegram')
      .maybeSingle();

    if (!transport || !transport.verified_at || transport.disabled_at) {
      await sendTelegramReply(
        chatId,
        `ℹ️ Henüz bağlı bir FRAUDE hesabınız bulunmuyor.\n\nBaşlamak için FRAUDE'ye kayıtlı e-posta adresinizi buraya yazabilirsiniz.`,
      );
      return new Response('ok', { status: 200 });
    }

    const { data: prefs } = await supabase
      .from('notify_prefs')
      .select('tickers, min_priority, enabled')
      .eq('user_id', transport.user_id)
      .maybeSingle();

    const tickersList = prefs?.tickers?.length ? prefs.tickers.join(', ') : 'Tüm Kritik Bildirimler';
    const statusText = `📊 <b>FRAUDE Telegram Bildirim Durumu</b>\n\n` +
      `Durum: 🟢 <b>Aktif</b>\n` +
      `İzlenen Hisseler: <code>${escapeTelegramHtml(tickersList)}</code>\n` +
      `Minimum Öncelik Eşiği: <b>${prefs?.min_priority ?? 4}+ (Kritik)</b>\n\n` +
      `Bağlantıyı sonlandırmak için /cikis yazabilirsiniz.`;
    await sendTelegramReply(chatId, statusText);
    return new Response('ok', { status: 200 });
  }

  // ── 3. Komut: /cikis /logout ──────────────────────────────────────────────
  if (rawText === '/cikis' || rawText === '/logout') {
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
      `🚪 <b>Telegram Bağlantısı Kesildi</b>\n\nFRAUDE bildirimleriniz artık kayıtlı e-posta adresinize iletilecektir. Yeniden bağlamak istediğinizde e-posta adresinizi yazabilirsiniz.`,
    );
    return new Response('ok', { status: 200 });
  }

  // ── 4. E-posta Girildiyse ➔ 6 Haneli Kod Üret ve Mail At ───────────────────
  if (isEmail(rawText)) {
    const targetEmail = rawText.toLowerCase().trim();

    // Kullanıcı var mı kontrol et
    const { data: userRow } = await supabase
      .from('notify_prefs')
      .select('user_id')
      .eq('email', targetEmail)
      .maybeSingle();

    // notify_prefs yoksa auth.users tablosuna admin ile bak
    let userId = userRow?.user_id;
    if (!userId) {
      const { data: authList } = await supabase.auth.admin.listUsers();
      const matchedAuth = authList?.users?.find(
        (u) => u.email?.toLowerCase() === targetEmail,
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
      return new Response('ok', { status: 200 });
    }

    // 6 Haneli Rastgele Kod Üret
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    await supabase.from('telegram_link_codes').insert({
      user_id: userId,
      email: targetEmail,
      code,
      expires_at: expiresAt,
    });

    // E-posta Gönder
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
      return new Response('ok', { status: 200 });
    }

    await sendTelegramReply(
      chatId,
      `📬 <b>Doğrulama Kodu Gönderildi!</b>\n\n<code>${escapeTelegramHtml(targetEmail)}</code> adresinize 6 haneli bir eşleştirme kodu ilettik.\n\nLütfen e-postanızı kontrol edin ve gelen 6 haneli kodu buraya yazın (Kod <b>5 dakika</b> geçerlidir).`,
    );
    return new Response('ok', { status: 200 });
  }

  // ── 5. 6 Haneli Kod Girildiyse ➔ Eşleştir ve Onayla ────────────────────────
  if (/^\d{6}$/.test(rawText)) {
    const enteredCode = rawText;
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
      return new Response('ok', { status: 200 });
    }

    // Kodu kullanıldı olarak işaretle
    await supabase
      .from('telegram_link_codes')
      .update({ used_at: now })
      .eq('id', matched.id);

    // notify_transports tablosunu güncelle
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
        `<i>İyi seanslar dileriz!</i>`,
    );
    return new Response('ok', { status: 200 });
  }

  // ── 6. Bilinmeyen Mesaj ───────────────────────────────────────────────────
  await sendTelegramReply(
    chatId,
    `ℹ️ Lütfen FRAUDE hesabınıza kayıtlı <b>e-posta adresinizi</b> veya uygulamadan aldığınız <b>6 haneli kodu</b> yazın.\n\nYardım için /start yazabilirsiniz.`,
  );
  return new Response('ok', { status: 200 });
});
