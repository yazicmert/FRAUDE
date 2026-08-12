// Fraude eklentisi arka plan servis worker'ı (MV3).
//
// İki kaynağı yoklar (chrome.alarms ~45 sn; MV3 worker'ı uyuyabildiğinden
// setInterval değil):
//   1) Masaüstü köprüsü (127.0.0.1) — araştırma işleri; yalnız uygulama açıkken.
//   2) Supabase notify-feed — sunucudaki KAP/SPK/haber bildirimleri; feed_token
//      ile, uygulama KAPALIYKEN de. "Chrome açıksa bildirim gelsin" bunu sağlar.
// Yeni öğe için Chrome bildirimi gösterir ve aksiyon rozetini artırır.

const ALARM = 'fraude-poll';
const SUPABASE_URL = 'https://emrusyelfekcfyisfzzl.supabase.co';

function ensureAlarm() {
  chrome.alarms.create(ALARM, { periodInMinutes: 0.75 });
}

chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) {
    void pollJobs();
    void pollFeed();
  }
});

// Bildirime tıklanınca: bir URL kaydedilmişse aç, sonra temizle.
chrome.notifications.onClicked.addListener(async (id) => {
  const { notifUrls } = await chrome.storage.local.get(['notifUrls']);
  const map = notifUrls || {};
  if (map[id]) {
    chrome.tabs.create({ url: map[id] });
    delete map[id];
    await chrome.storage.local.set({ notifUrls: map });
  }
  chrome.notifications.clear(id);
});

async function bumpBadge(n) {
  const cur = parseInt((await chrome.action.getBadgeText({})) || '0', 10) || 0;
  await chrome.action.setBadgeText({ text: String(cur + n) });
  await chrome.action.setBadgeBackgroundColor({ color: '#00b36b' });
}

// ── 1) Masaüstü köprüsü: araştırma işleri ───────────────────────────────────
async function getBridge() {
  const { port, token } = await chrome.storage.local.get(['port', 'token']);
  return { port: port || 8799, token: token || '' };
}

async function pollJobs() {
  const cfg = await getBridge();
  if (!cfg.token) return;

  const store = await chrome.storage.local.get(['lastSeen', 'notified']);
  const lastSeen = store.lastSeen || 0;
  const notifiedSet = new Set(store.notified || []);

  let data;
  try {
    const res = await fetch(`http://127.0.0.1:${cfg.port}/ext/v1/jobs?since=${lastSeen}`, {
      headers: { Authorization: 'Bearer ' + cfg.token },
    });
    if (!res.ok) return;
    data = await res.json();
  } catch {
    return; // uygulama kapalı olabilir; sessizce geç
  }

  const jobs = data.jobs || [];
  let maxSeen = lastSeen;
  let newlyDone = 0;

  for (const job of jobs) {
    if (typeof job.updated_at_ms === 'number' && job.updated_at_ms > maxSeen) {
      maxSeen = job.updated_at_ms;
    }
    const terminal = job.status === 'done' || job.status === 'error';
    if (terminal && !notifiedSet.has(job.id)) {
      notifiedSet.add(job.id);
      newlyDone++;
      chrome.notifications.create(job.id, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: job.status === 'done' ? '✅ Araştırma tamamlandı' : '⚠️ Araştırma başarısız',
        message: job.title || 'Fraude araştırma görevi',
        priority: 1,
      });
    }
  }

  if (newlyDone > 0) await bumpBadge(newlyDone);
  await chrome.storage.local.set({
    lastSeen: maxSeen,
    notified: [...notifiedSet].slice(-200), // sınırsız büyümesin
  });
}

// ── 2) Supabase notify-feed: sunucu bildirimleri (KAP/SPK/haber) ────────────
const SRC_ICON = { kap: '📄', spk: '⚖️', news: '📰' };

async function pollFeed() {
  const { feedToken, feedSince, feedNotified, notifUrls } = await chrome.storage.local.get([
    'feedToken', 'feedSince', 'feedNotified', 'notifUrls',
  ]);
  if (!feedToken) return;

  // İlk çalıştırmada geçmişi bildirimle boğma: son 1 saatten öncesini "görülmüş" say.
  const since = feedSince || new Date(Date.now() - 3600e3).toISOString();
  const seen = new Set(feedNotified || []);
  const urls = notifUrls || {};

  let data;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/functions/v1/notify-feed?token=${encodeURIComponent(feedToken)}&since=${encodeURIComponent(since)}`,
    );
    if (!res.ok) return; // 401 (yanlış anahtar) / geçici hata → sessiz geç
    data = await res.json();
  } catch {
    return;
  }

  const items = (data && data.items) || [];
  let maxTs = since;
  let newly = 0;

  // En eskiden yeniye bildir (kronolojik his).
  for (const it of [...items].reverse()) {
    if (it.created_at && it.created_at > maxTs) maxTs = it.created_at;
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    newly++;
    const dot = it.priority >= 5 ? '🔴' : it.priority >= 4 ? '🟡' : '🟢';
    const tk = Array.isArray(it.tickers) && it.tickers.length ? it.tickers.join(', ') + ' · ' : '';
    chrome.notifications.create('feed:' + it.id, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `${dot} ${SRC_ICON[it.source] || '🔔'} FRAUDE bildirim`,
      message: tk + (it.summary || it.title || ''),
      priority: it.priority >= 4 ? 2 : 1,
    });
    if (it.url) urls['feed:' + it.id] = it.url;
  }

  if (newly > 0) await bumpBadge(newly);
  await chrome.storage.local.set({
    feedSince: maxTs,
    feedNotified: [...seen].slice(-300),
    notifUrls: urls,
  });
}
