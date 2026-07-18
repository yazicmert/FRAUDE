import { openUrl as tauriOpenUrl } from '@tauri-apps/plugin-opener';
import { isDesktopRuntime } from '../api/platformClient';

/**
 * Dış bağlantı açar: masaüstünde sistem tarayıcısı (Tauri opener), web'de
 * yeni sekme. Görünümler '@tauri-apps/plugin-opener' yerine bunu kullanır;
 * aynı imza sayesinde çağrı yerleri değişmez.
 */
export async function openUrl(url: string): Promise<void> {
  if (isDesktopRuntime()) {
    return tauriOpenUrl(url);
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
