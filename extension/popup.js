// Fraude eklentisi popup mantığı. İki iş: (1) sunucu bildirimlerini (KAP/SPK/
// haber) notify-feed'den gösterir — köprüden bağımsız, uygulama kapalıyken de;
// (2) masaüstü köprüsüne (127.0.0.1) araştırma görevi gönderir. Vanilla JS.

const $ = (id) => document.getElementById(id);
const SUPABASE_URL = 'https://frfbmutvkekctpacktlz.supabase.co';
const SRC_ICON = { kap: '📄', spk: '⚖️', news: '📰' };
let imageDataUrl = null;

async function getConfig() {
  const { port, token } = await chrome.storage.local.get(['port', 'token']);
  return { port: port || 8799, token: token || '' };
}

// ── Sunucu bildirimleri (notify-feed) ───────────────────────────────────────
async function loadNotifs() {
  const { feedToken } = await chrome.storage.local.get(['feedToken']);
  if (!feedToken) return; // anahtar yoksa bölümü gizli bırak
  let data;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/functions/v1/notify-feed?token=${encodeURIComponent(feedToken)}&since=0`,
    );
    if (!res.ok) return;
    data = await res.json();
  } catch {
    return;
  }
  const items = (data && data.items) || [];
  const wrap = $('notifsWrap');
  const box = $('notifs');
  wrap.classList.remove('hidden');
  box.innerHTML = '';
  if (items.length === 0) {
    box.innerHTML = '<div class="notif-empty muted">Henüz bildirim yok.</div>';
    return;
  }
  for (const it of items.slice(0, 8)) {
    const row = document.createElement('div');
    row.className = 'notif-row';
    if (it.url) {
      row.classList.add('clickable');
      row.onclick = () => chrome.tabs.create({ url: it.url });
    }
    const cls = it.priority >= 5 ? 'p5' : it.priority >= 4 ? 'p4' : 'p3';
    const tk = Array.isArray(it.tickers) && it.tickers.length
      ? `<span class="notif-tk">${it.tickers.join(', ')}</span> ` : '';
    row.innerHTML =
      `<span class="notif-dot ${cls}"></span>` +
      `<span class="notif-src">${SRC_ICON[it.source] || '🔔'}</span>` +
      `<span class="notif-txt">${tk}${escapeHtml(it.summary || it.title || '')}</span>`;
    box.appendChild(row);
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function api(path, opts = {}) {
  const cfg = await getConfig();
  const res = await fetch(`http://127.0.0.1:${cfg.port}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + cfg.token,
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(detail || 'HTTP ' + res.status);
  }
  return res.json();
}

function showPreview() {
  const box = $('imgPreview');
  box.innerHTML = '';
  if (imageDataUrl) {
    const img = document.createElement('img');
    img.src = imageDataUrl;
    img.className = 'preview';
    const clear = document.createElement('button');
    clear.textContent = '✕';
    clear.className = 'link';
    clear.onclick = () => { imageDataUrl = null; showPreview(); };
    box.appendChild(img);
    box.appendChild(clear);
  }
}

function readImage(file) {
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) {
    $('msg').textContent = '⚠️ Görsel 4MB’den küçük olmalı.';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => { imageDataUrl = reader.result; showPreview(); };
  reader.readAsDataURL(file);
}

async function loadRecent() {
  try {
    const data = await api('/ext/v1/jobs?since=0');
    const jobs = (data.jobs || []).slice(0, 5);
    const box = $('recent');
    if (jobs.length === 0) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="recent-title">Son görevler</div>';
    for (const job of jobs) {
      const row = document.createElement('div');
      row.className = 'recent-row';
      const dot = { queued: '⏳', running: '🔄', done: '✅', error: '⚠️' }[job.status] || '•';
      row.textContent = `${dot} ${job.title}`;
      box.appendChild(row);
    }
  } catch {
    /* sessiz */
  }
}

async function init() {
  // Popup açılınca rozet sıfırlanır.
  chrome.action.setBadgeText({ text: '' });

  // Sunucu bildirimleri köprüden bağımsız yüklenir (uygulama kapalı olabilir).
  loadNotifs();

  const cfg = await getConfig();
  if (!cfg.token) {
    $('unpaired').classList.remove('hidden');
    return;
  }
  $('main').classList.remove('hidden');

  try {
    const state = await api('/ext/v1/state');
    $('status').classList.add('ok');

    // Üyelik: uygulamada oturum açılmamışsa gönderim engellenir.
    if (state.account && state.account.email) {
      $('account').textContent = '👤 ' + state.account.email;
      $('account').classList.remove('warn');
      $('submit').disabled = false;
    } else {
      $('account').textContent = '⚠️ Uygulamada oturum açık değil — Fraude’ye giriş yapın.';
      $('account').classList.add('warn');
      $('submit').disabled = true;
    }

    const sel = $('agent');
    for (const a of state.agents || []) {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.name + (a.busy ? ' (meşgul)' : '');
      sel.appendChild(opt);
    }
  } catch {
    $('status').classList.add('err');
    $('msg').textContent = '⚠️ Masaüstü uygulamasına bağlanılamadı. Fraude açık mı?';
  }
  loadRecent();
}

$('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('notifSettings').addEventListener('click', () => chrome.runtime.openOptionsPage());

$('fillUrl').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) $('url').value = tab.url;
  } catch {
    /* activeTab yoksa yoksay */
  }
});

$('image').addEventListener('change', (e) => readImage(e.target.files[0]));

document.addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.items ? [...e.clipboardData.items] : [];
  const img = items.find((i) => i.type.startsWith('image/'));
  if (img) readImage(img.getAsFile());
});

$('submit').addEventListener('click', async () => {
  const prompt = $('prompt').value.trim();
  const url = $('url').value.trim();
  const agentId = $('agent').value;
  if (!prompt && !url && !imageDataUrl) {
    $('msg').textContent = '⚠️ Metin, URL veya görsel gerekli.';
    return;
  }
  $('submit').disabled = true;
  $('msg').textContent = 'Gönderiliyor…';
  try {
    await api('/ext/v1/jobs', {
      method: 'POST',
      body: JSON.stringify({
        prompt: prompt || undefined,
        url: url || undefined,
        imageDataUrl: imageDataUrl || undefined,
        agentId: agentId || undefined,
      }),
    });
    $('msg').textContent = '✅ Gönderildi. Bittiğinde bildirim alacaksınız.';
    $('prompt').value = '';
    $('url').value = '';
    imageDataUrl = null;
    showPreview();
    loadRecent();
  } catch (e) {
    $('msg').textContent = '⚠️ Gönderilemedi: ' + e.message;
  } finally {
    $('submit').disabled = false;
  }
});

init();
