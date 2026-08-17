import { CORE_VERSION } from '../../modules/workspaceRegistry';
import { openUrl } from '../../lib/openExternal';

const REPO = 'yazicmert/FRAUDE';
export const REGISTRY_URL = `https://raw.githubusercontent.com/${REPO}/main/updates/registry.json`;
export const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
export const RELEASES_PAGE_URL = `https://github.com/${REPO}/releases/latest`;

export interface ReleaseAssetInfo {
  name: string;
  downloadUrl: string;
  sizeBytes?: number;
  os: 'macos' | 'windows' | 'linux' | 'unknown';
}

export interface CheckUpdateResult {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  publishedAt?: string;
  releaseTitle?: string;
  releaseNotes?: string;
  asset?: ReleaseAssetInfo;
  htmlUrl: string;
}

export interface DownloadProgress {
  status: 'idle' | 'checking' | 'downloading' | 'verifying' | 'completed' | 'error';
  percentage: number;
  loadedBytes: number;
  totalBytes: number;
  speedBytesPerSec: number;
  error?: string;
  blobUrl?: string;
  fileName?: string;
}

/** "0.1.0" biçimli sürümleri karşılaştırır: a < b ise true (yeni sürüm var). */
export function isVersionNewer(candidate: string, current: string): boolean {
  const cleanCandidate = candidate.replace(/^v/, '').trim();
  const cleanCurrent = current.replace(/^v/, '').trim();
  const pa = cleanCandidate.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = cleanCurrent.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const a = pa[i] ?? 0;
    const b = pb[i] ?? 0;
    if (a !== b) return a > b;
  }
  return false;
}

/**
 * Kullanıcının işletim sistemine göre uygun kurulum dosyasını belirler.
 */
export function detectPlatformAsset(assets: Array<{ name: string; browser_download_url: string; size?: number }>): ReleaseAssetInfo | undefined {
  const ua = navigator.userAgent.toLowerCase();
  const isMac = ua.includes('mac') || navigator.platform?.toLowerCase().includes('mac');
  const isWin = ua.includes('win') || navigator.platform?.toLowerCase().includes('win');
  const isLinux = ua.includes('linux');

  if (isMac) {
    // Apple Silicon / ARM64 veya x64
    const macDmg = assets.find((a) => a.name.endsWith('.dmg') && (a.name.includes('arm64') || a.name.includes('aarch64')))
      || assets.find((a) => a.name.endsWith('.dmg'))
      || assets.find((a) => a.name.endsWith('.app.tar.gz'));
    if (macDmg) {
      return {
        name: macDmg.name,
        downloadUrl: macDmg.browser_download_url,
        sizeBytes: macDmg.size,
        os: 'macos',
      };
    }
  }

  if (isWin) {
    const winExe = assets.find((a) => a.name.endsWith('-setup.exe') || a.name.endsWith('.msi') || a.name.endsWith('.exe'))
      || assets.find((a) => a.name.endsWith('.zip'));
    if (winExe) {
      return {
        name: winExe.name,
        downloadUrl: winExe.browser_download_url,
        sizeBytes: winExe.size,
        os: 'windows',
      };
    }
  }

  if (isLinux) {
    const linuxApp = assets.find((a) => a.name.endsWith('.AppImage') || a.name.endsWith('.deb'));
    if (linuxApp) {
      return {
        name: linuxApp.name,
        downloadUrl: linuxApp.browser_download_url,
        sizeBytes: linuxApp.size,
        os: 'linux',
      };
    }
  }

  // Eşleşme yoksa ilk yürütülebilir paketi al
  const first = assets[0];
  if (first) {
    return {
      name: first.name,
      downloadUrl: first.browser_download_url,
      sizeBytes: first.size,
      os: 'unknown',
    };
  }
  return undefined;
}

/**
 * GitHub API ve yedek registry üzerinden en son sürümü ve uygun paketi denetler.
 */
export async function checkApplicationUpdate(): Promise<CheckUpdateResult> {
  const currentVersion = CORE_VERSION;

  try {
    const res = await fetch(LATEST_RELEASE_API, {
      headers: { accept: 'application/vnd.github+json' },
    });

    if (res.ok) {
      const data = await res.json();
      const latestTag = (data.tag_name || '').replace(/^v/, '');
      const hasUpdate = isVersionNewer(latestTag, currentVersion);
      const asset = detectPlatformAsset(data.assets || []);

      return {
        currentVersion,
        latestVersion: latestTag || currentVersion,
        hasUpdate,
        publishedAt: data.published_at,
        releaseTitle: data.name || `v${latestTag}`,
        releaseNotes: data.body || '',
        asset,
        htmlUrl: data.html_url || RELEASES_PAGE_URL,
      };
    }
  } catch (err) {
    console.warn('[AppUpdater] GitHub releases API unreachable, trying fallback registry', err);
  }

  // Fallback: registry.json kontrolü
  try {
    const regRes = await fetch(REGISTRY_URL, { headers: { accept: 'application/json' } });
    if (regRes.ok) {
      const regData = await regRes.json();
      const firstIncluded = regData.updates?.find((u: any) => typeof u.includedIn === 'string' && u.includedIn)?.includedIn;
      if (firstIncluded) {
        const latestTag = firstIncluded.replace(/^v/, '');
        const hasUpdate = isVersionNewer(latestTag, currentVersion);
        return {
          currentVersion,
          latestVersion: latestTag,
          hasUpdate,
          htmlUrl: RELEASES_PAGE_URL,
        };
      }
    }
  } catch (regErr) {
    console.warn('[AppUpdater] Fallback registry fetch failed', regErr);
  }

  return {
    currentVersion,
    latestVersion: currentVersion,
    hasUpdate: false,
    htmlUrl: RELEASES_PAGE_URL,
  };
}

/**
 * Doğrudan uygulama içerisinden en son kurulum paketini indirir ve indirme durumunu anlık yayınlar.
 */
export async function startDirectDownload(
  downloadUrl: string,
  fileName: string,
  onProgress: (progress: DownloadProgress) => void
): Promise<void> {
  onProgress({
    status: 'downloading',
    percentage: 0,
    loadedBytes: 0,
    totalBytes: 0,
    speedBytesPerSec: 0,
    fileName,
  });

  try {
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`İndirme başarısız oldu (HTTP ${response.status})`);
    }

    const contentLength = response.headers.get('content-length');
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

    if (!response.body) {
      // Body streaming desteklenmiyorsa standart blob yöntemi
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      triggerFileDownload(blobUrl, fileName);
      onProgress({
        status: 'completed',
        percentage: 100,
        loadedBytes: blob.size,
        totalBytes: blob.size,
        speedBytesPerSec: 0,
        blobUrl,
        fileName,
      });
      return;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;
    let lastTime = Date.now();
    let lastBytes = 0;
    let speed = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (value) {
        chunks.push(value);
        receivedBytes += value.length;

        const now = Date.now();
        const timeDiff = (now - lastTime) / 1000;
        if (timeDiff >= 0.3) {
          speed = Math.round((receivedBytes - lastBytes) / timeDiff);
          lastTime = now;
          lastBytes = receivedBytes;

          const pct = totalBytes > 0 ? Math.min(99, Math.round((receivedBytes / totalBytes) * 100)) : 50;
          onProgress({
            status: 'downloading',
            percentage: pct,
            loadedBytes: receivedBytes,
            totalBytes: totalBytes || receivedBytes,
            speedBytesPerSec: speed,
            fileName,
          });
        }
      }
    }

    onProgress({
      status: 'verifying',
      percentage: 100,
      loadedBytes: receivedBytes,
      totalBytes: receivedBytes,
      speedBytesPerSec: 0,
      fileName,
    });

    const combinedBlob = new Blob(chunks as any[]);
    const blobUrl = URL.createObjectURL(combinedBlob);

    // İndirilen kurulum dosyasını otomatik olarak aç / başlat
    triggerFileDownload(blobUrl, fileName);

    onProgress({
      status: 'completed',
      percentage: 100,
      loadedBytes: receivedBytes,
      totalBytes: receivedBytes,
      speedBytesPerSec: 0,
      blobUrl,
      fileName,
    });
  } catch (err: any) {
    console.error('[AppUpdater] Direct download failed', err);
    onProgress({
      status: 'error',
      percentage: 0,
      loadedBytes: 0,
      totalBytes: 0,
      speedBytesPerSec: 0,
      error: err?.message || 'İndirme sırasında bir hata oluştu',
      fileName,
    });
    // Hata durumunda dış tarayıcıda indirme sayfasını aç
    void openUrl(downloadUrl);
  }
}

function triggerFileDownload(blobUrl: string, fileName: string) {
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    try {
      document.body.removeChild(link);
    } catch {
      // ignore
    }
  }, 1000);
}

/**
 * Bayt cinsinden boyutu okunabilir MB/GB formatına çevirir.
 */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
