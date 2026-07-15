// Çift-runtime bildirim yardımcısı: masaüstünde (Tauri) OS bildirimi, web'de
// tarayıcı Notification API'si kullanır. Her iki durumda da uygulama içi bir
// "toast" olayı yayınlar; böylece pencere önplandayken de görsel geri bildirim
// olur. Bildirim izni yoksa yalnızca uygulama içi toast gösterilir.
import { isDesktopRuntime } from '../api/platformClient';

export type ToastKind = 'info' | 'success' | 'warning' | 'danger';

export interface NotifyOptions {
  title: string;
  body?: string;
  kind?: ToastKind;
  /** Aynı etikete sahip bildirimler işletim sisteminde birbirinin yerine geçer. */
  tag?: string;
  /** true ise yalnızca uygulama içi toast gösterilir, OS bildirimi atlanır. */
  toastOnly?: boolean;
}

let permissionRequested = false;

/** OS/tarayıcı bildirim iznini bir kez ister. Sessizce başarısız olabilir. */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    if (isDesktopRuntime()) {
      const mod = await import('@tauri-apps/plugin-notification');
      if (await mod.isPermissionGranted()) return true;
      const res = await mod.requestPermission();
      return res === 'granted';
    }
    if (typeof Notification === 'undefined') return false;
    const perm = Notification.permission;
    if (perm === 'granted') return true;
    if (perm === 'denied') return false;
    // 'default': daha önce sorduysak tekrar sormayalım.
    if (permissionRequested) return false;
    permissionRequested = true;
    const res = await Notification.requestPermission();
    return res === 'granted';
  } catch {
    return false;
  }
}

function emitToast(opts: NotifyOptions) {
  window.dispatchEvent(
    new CustomEvent('fraude-toast', {
      detail: { title: opts.title, body: opts.body ?? '', kind: opts.kind ?? 'info' },
    }),
  );
}

/** Bildirim gönderir: mümkünse OS/tarayıcı bildirimi + her zaman uygulama içi toast. */
export async function notify(opts: NotifyOptions): Promise<void> {
  emitToast(opts);
  if (opts.toastOnly) return;
  try {
    if (isDesktopRuntime()) {
      const mod = await import('@tauri-apps/plugin-notification');
      let granted = await mod.isPermissionGranted();
      if (!granted) granted = (await mod.requestPermission()) === 'granted';
      if (granted) mod.sendNotification({ title: opts.title, body: opts.body });
      return;
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(opts.title, { body: opts.body, tag: opts.tag });
    }
  } catch {
    // OS bildirimi başarısız olsa da toast gösterilmiştir.
  }
}
