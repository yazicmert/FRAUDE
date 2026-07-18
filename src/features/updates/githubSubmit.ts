// Uygulama içinden otomatik PR gönderimi: kullanıcının kendi GitHub token'ıyla
// (public_repo yetkisi yeter) depo fork'lanır, güncelleme kaydı registry.json'ın
// başına eklenir ve upstream'e PR açılır. Token yalnız bu cihazda saklanır;
// token yoksa çağıran taraf issue akışına düşer (UpdatesView).
const API = 'https://api.github.com';
const UPSTREAM_OWNER = 'yazicmert';
const UPSTREAM_REPO = 'FRAUDE';
const UPSTREAM = `${UPSTREAM_OWNER}/${UPSTREAM_REPO}`;
const REGISTRY_PATH = 'updates/registry.json';

export type PrStep = 'user' | 'fork' | 'branch' | 'commit' | 'pr';

interface RegistryEntry {
  id: string;
  title: { tr: string; en: string };
  [key: string]: unknown;
}

async function gh<T>(
  token: string,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const err = (await res.json()) as { message?: string };
      if (err.message) detail = `${detail} — ${err.message}`;
    } catch {
      // gövdesiz hata
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/**
 * Kaydı registry'ye ekleyen PR'ı açar ve PR adresini döndürür.
 * `onStep` her aşamada çağrılır (ilerleme göstergesi için).
 */
export async function submitUpdateViaPr(
  token: string,
  entry: RegistryEntry,
  onStep: (step: PrStep) => void,
): Promise<string> {
  onStep('user');
  const me = await gh<{ login: string }>(token, 'GET', '/user');

  // Upstream sahibi kendisiyse fork gerekmez; dal doğrudan upstream'de açılır
  const ownRepo = me.login === UPSTREAM_OWNER;
  const workOwner = ownRepo ? UPSTREAM_OWNER : me.login;

  if (!ownRepo) {
    onStep('fork');
    await gh(token, 'POST', `/repos/${UPSTREAM}/forks`, {});
    // Fork asenkron hazırlanır; erişilir olana dek bekle
    let ready = false;
    for (let i = 0; i < 10 && !ready; i++) {
      try {
        await gh(token, 'GET', `/repos/${workOwner}/${UPSTREAM_REPO}`);
        ready = true;
      } catch {
        await sleep(1500);
      }
    }
    if (!ready) throw new Error('Fork hazırlanamadı; birkaç saniye sonra tekrar deneyin.');
  }

  onStep('branch');
  const mainRef = await gh<{ object: { sha: string } }>(
    token, 'GET', `/repos/${UPSTREAM}/git/ref/heads/main`,
  );
  const branch = `update/${entry.id}`;
  try {
    await gh(token, 'POST', `/repos/${workOwner}/${UPSTREAM_REPO}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: mainRef.object.sha,
    });
  } catch (err) {
    // Dal önceki denemeden kalmış olabilir; commit adımı yine de ilerler
    if (!(err instanceof Error) || !err.message.includes('422')) throw err;
  }

  onStep('commit');
  const file = await gh<{ content: string; sha: string }>(
    token, 'GET', `/repos/${UPSTREAM}/contents/${REGISTRY_PATH}?ref=main`,
  );
  const registry = JSON.parse(decodeBase64Utf8(file.content)) as { updates: RegistryEntry[] };
  if (registry.updates.some((u) => u.id === entry.id)) {
    throw new Error(`"${entry.id}" kimliğiyle bir kayıt zaten var; başlığı değiştirin.`);
  }
  registry.updates.unshift(entry);
  await gh(token, 'PUT', `/repos/${workOwner}/${UPSTREAM_REPO}/contents/${REGISTRY_PATH}`, {
    message: `Güncelleme kaydı: ${entry.id}`,
    content: encodeBase64Utf8(`${JSON.stringify(registry, null, 2)}\n`),
    branch,
    sha: file.sha,
  });

  onStep('pr');
  const pr = await gh<{ html_url: string }>(token, 'POST', `/repos/${UPSTREAM}/pulls`, {
    title: `[Güncelleme] ${entry.title.tr}`,
    head: ownRepo ? branch : `${me.login}:${branch}`,
    base: 'main',
    body: [
      'Uygulama içi Güncelleme Gönder formundan açıldı.',
      '',
      'Bakımcı kontrol listesi updates/README.md içindedir; güvenlik incelemesinden',
      'sonra merge edildiğinde kayıt sitede ve uygulamada görünür olur.',
    ].join('\n'),
  });
  return pr.html_url;
}
