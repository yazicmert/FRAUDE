import { lazy, type ComponentType } from 'react';

/** En son ne zaman parça hatası yüzünden yenilendik (ms). */
const RETRY_KEY = 'fraude-site-chunk-reload';

/** İki yenileme arası en az bu kadar geçmeli; kalıcı 404 döngüye dönmesin. */
const RETRY_COOLDOWN_MS = 15_000;

function readLastRetry(): number {
  try {
    return Number(sessionStorage.getItem(RETRY_KEY)) || 0;
  } catch {
    return 0;
  }
}

/**
 * Gecikmeli yüklenen sayfa; bayat parça adına karşı korumalı.
 *
 * Yeni sürüm yayına alındığında paket adları değişir (içerik özetli isimler).
 * O sırada açık duran sekmedeki HTML hâlâ eski adları gösterir: kullanıcı
 * hesabına ya da bir modül sayfasına geçmek istediğinde tarayıcı artık var
 * olmayan dosyayı ister, import reddedilir ve React askıda kalır — ekran
 * boş görünür ve konsola "Failed to fetch dynamically imported module" düşer.
 *
 * Doğru davranış sayfayı bir kez yenileyip güncel HTML'i almak. Yenileme
 * yalnız bir kez denenir: dosya gerçekten kayıpsa (ağ kesintisi, engellenmiş
 * istek) ikinci denemede hata yüzeye çıkar, sonsuz döngü oluşmaz.
 */
// React'in kendi `lazy` imzasıyla aynı gevşeklik: yol bileşenleri farklı prop
// kümeleri taşıyor, ortak bir daraltma mümkün değil.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyRoute<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().catch((error) => {
      const now = Date.now();
      if (now - readLastRetry() < RETRY_COOLDOWN_MS) throw error;
      try {
        sessionStorage.setItem(RETRY_KEY, String(now));
      } catch {
        // Depolama yoksa yenilemeyi hiç denemeyelim; döngüyü durduramayız.
        throw error;
      }
      window.location.reload();
      // Yenileme başlarken bileşen çözülmemeli: askıda bırakıyoruz.
      return new Promise<{ default: T }>(() => {});
    }),
  );
}
