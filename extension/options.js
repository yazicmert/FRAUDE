const $ = (id) => document.getElementById(id);
const SUPABASE_URL = 'https://frfbmutvkekctpacktlz.supabase.co';

async function load() {
  const { port, token, feedToken } = await chrome.storage.local.get(['port', 'token', 'feedToken']);
  if (port) $('port').value = port;
  if (token) $('token').value = token;
  if (feedToken) $('feedToken').value = feedToken;
}

// ── Bildirim beslemesi (Supabase) ───────────────────────────────────────────
$('saveFeed').addEventListener('click', async () => {
  const feedToken = $('feedToken').value.trim();
  // Anahtar değişince "görülmüş" imleçlerini sıfırla ki test bildirimi gelebilsin.
  await chrome.storage.local.set({ feedToken, feedSince: null, feedNotified: [] });
  $('feedMsg').textContent = 'Kaydedildi ✓';
});

$('testFeed').addEventListener('click', async () => {
  const feedToken = $('feedToken').value.trim();
  if (!feedToken) { $('feedMsg').textContent = '⚠️ Önce besleme anahtarını girin.'; return; }
  $('feedMsg').textContent = 'Test ediliyor…';
  try {
    const res = await fetch(
      `${SUPABASE_URL}/functions/v1/notify-feed?token=${encodeURIComponent(feedToken)}&since=0`,
    );
    if (res.ok) {
      const d = await res.json();
      const who = d.account ? ` · 👤 ${d.account}` : '';
      $('feedMsg').textContent = `✅ Bağlandı — ${(d.items || []).length} son bildirim${who}.`;
    } else if (res.status === 401) {
      $('feedMsg').textContent = '⚠️ Anahtar geçersiz (401). Hesabınızdaki anahtarla aynı olmalı.';
    } else {
      $('feedMsg').textContent = `⚠️ Yanıt: HTTP ${res.status}`;
    }
  } catch {
    $('feedMsg').textContent = '⚠️ Bağlanılamadı. İnternet bağlantısını kontrol edin.';
  }
});

// ── Araştırma köprüsü (masaüstü) ────────────────────────────────────────────
$('save').addEventListener('click', async () => {
  const port = parseInt($('port').value, 10) || 8799;
  const token = $('token').value.trim();
  await chrome.storage.local.set({ port, token });
  $('msg').textContent = 'Kaydedildi ✓';
});

$('test').addEventListener('click', async () => {
  const port = parseInt($('port').value, 10) || 8799;
  const token = $('token').value.trim();
  $('msg').textContent = 'Test ediliyor…';
  try {
    const res = await fetch(`http://127.0.0.1:${port}/ext/v1/state`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (res.ok) {
      const d = await res.json();
      const who = d.account && d.account.email ? ` · 👤 ${d.account.email}` : ' · ⚠️ oturum açık değil';
      $('msg').textContent = `✅ Bağlandı — ${(d.agents || []).length} aktif ajan${who}.`;
    } else if (res.status === 401) {
      $('msg').textContent = '⚠️ Token hatalı (401). Uygulamadaki token ile aynı olmalı.';
    } else {
      $('msg').textContent = `⚠️ Yanıt: HTTP ${res.status}`;
    }
  } catch {
    $('msg').textContent = '⚠️ Bağlanılamadı. Fraude açık mı ve port doğru mu?';
  }
});

load();
