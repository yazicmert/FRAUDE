/**
 * İndirme bağlantıları tek yerden yönetilir. Release iş akışı
 * (.github/workflows/release.yml) paketleri bu sabit adlarla yükler;
 * böylece bağlantılar sürüm numarasından bağımsız hep son sürümü verir.
 */
const RELEASE_BASE = 'https://github.com/yazicmert/FRAUDE/releases/latest/download';

export const DOWNLOAD_MAC = `${RELEASE_BASE}/FRAUDE-Terminal_macos_arm64.dmg`;
export const DOWNLOAD_WIN = `${RELEASE_BASE}/FRAUDE-Terminal_windows_x64-setup.exe`;
