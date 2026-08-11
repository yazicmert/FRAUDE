import { Readability } from '@mozilla/readability';
import DOMPurify from 'dompurify';

/**
 * İndirilen haber sayfasının uygulama içinde gösterilebilen iki hâli.
 *
 * İkisi de tek indirmeden çıkar; kullanıcı okuyucu araç çubuğundan geçiş
 * yapar. `page` kaynak sayfanın kendi düzeni, `reader` yalnızca haber metni.
 */
export interface PreparedArticle {
  /** Sandbox'lı çerçeveye gömülmeye hazır tam sayfa (betikleri sökülmüş). */
  page: string;
  /** Temizlenmiş haber gövdesi; sayfadan metin çıkarılamazsa null. */
  reader: string | null;
  /** Readability'nin bulduğu başlık; yoksa null. */
  title: string | null;
}

/** Tembel yükleyen sitelerin gerçek görsel adresini sakladığı öznitelikler. */
const LAZY_SRC_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-echo', 'data-hi-res-src'];
const LAZY_SRCSET_ATTRS = ['data-srcset', 'data-lazy-srcset'];

/**
 * Sayfayı çerçevede güvenle çizilebilecek hâle getirir.
 *
 * Çerçeve `sandbox` ile açıldığından betikler zaten çalışmaz; yine de
 * ağa istek atan etiketler (betik, gömülü çerçeve, nesne) sökülür — hem
 * reklam/izleyici trafiği kesilsin hem de sayfa çevrimdışı bir belge gibi
 * davransın. Betikler çalışmadığından tembel yüklenen görseller boş kalırdı;
 * gerçek adresleri sakladıkları özniteliklerden geri yazılır.
 */
function toFramePage(html: string, fallbackUrl: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  doc.querySelectorAll('script, iframe, frame, object, embed, applet').forEach((node) => node.remove());

  // Sayfa arka uçta UTF-8'e çözülüp geliyor; kaynağın kendi charset bildirimi
  // kalırsa Türkçe metin bozuk çizilir (windows-1254 yayın yapan siteler var).
  doc.querySelectorAll('meta[charset], meta[http-equiv="Content-Type" i]').forEach((node) => node.remove());
  const head = doc.head ?? doc.documentElement;
  const charset = doc.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  head.prepend(charset);

  // Göreli adresler kaynağa göre çözülsün. Arka uç <base> ekliyor; gelmediyse
  // haberin kendi adresiyle tamamlanır, yoksa hiçbir görsel yüklenmez.
  if (!doc.querySelector('base[href]') && fallbackUrl) {
    const base = doc.createElement('base');
    base.setAttribute('href', fallbackUrl);
    head.append(base);
  }

  doc.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.toLowerCase().startsWith('on')) element.removeAttribute(attribute.name);
    }
  });

  // Bağlantılar çalışsaydı çerçeve kaynağın çerçevelemeyi reddettiği bir
  // adrese giderdi: kullanıcı boş ekranda, geri dönüşsüz kalırdı. Metin
  // kalsın diye yalnızca adres düşürülür.
  doc.querySelectorAll('a[href]').forEach((anchor) => {
    anchor.removeAttribute('href');
    anchor.removeAttribute('target');
  });

  doc.querySelectorAll('img').forEach((image) => {
    const current = image.getAttribute('src') ?? '';
    if (!current || current.startsWith('data:')) {
      const lazy = LAZY_SRC_ATTRS
        .map((name) => image.getAttribute(name))
        .find((value) => value && !value.startsWith('data:'));
      if (lazy) image.setAttribute('src', lazy);
    }
    if (!image.getAttribute('srcset')) {
      const lazySet = LAZY_SRCSET_ATTRS.map((name) => image.getAttribute(name)).find(Boolean);
      if (lazySet) image.setAttribute('srcset', lazySet);
    }
    // Çerçeve görünürlüğü tarayıcıya farklı raporlandığından ertelenen
    // görseller hiç istenmeyebiliyor.
    image.removeAttribute('loading');
  });

  // Kaynak siteye okuma bağlamı sızmasın; bazı sunucular yabancı referrer'lı
  // varlık isteklerini de geri çeviriyor.
  const referrer = doc.createElement('meta');
  referrer.setAttribute('name', 'referrer');
  referrer.setAttribute('content', 'no-referrer');
  head.prepend(referrer);

  // Tarayıcı bir sayfayı beyaz kâğıda çizer; çerçeve ise saydamdır. Sitenin
  // kendi stil dosyası gelmediğinde (kimi sunucu yabancı istekte vermiyor)
  // saydam gövde koyu okuyucu zeminine oturur ve siyah metin görünmez olurdu.
  // Bu kural yalnız <html>'i boyar: site kendi stilini getirdiyse onun gövde
  // rengi bunun üstünü örter.
  const style = doc.createElement('style');
  style.textContent =
    'html{background:#fff;color:#111}html,body{max-width:100%;overflow-x:hidden}' +
    'img,video,table{max-width:100%}img,video{height:auto}';
  head.append(style);

  return `<!doctype html>${doc.documentElement.outerHTML}`;
}

/**
 * Sayfadan yalnızca haber metnini çıkarır.
 *
 * Readability aldığı belgeyi tükettiğinden sayfa görünümüyle aynı ağaç
 * paylaşılamaz; bu yüzden HTML ikinci kez ayrıştırılır.
 */
function toReaderHtml(html: string): { reader: string | null; title: string | null } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const parsed = new Readability(doc).parse();
  if (!parsed?.content) return { reader: null, title: null };
  const clean = DOMPurify.sanitize(parsed.content, { USE_PROFILES: { html: true } }).trim();
  return { reader: clean || null, title: parsed.title?.trim() || null };
}

/**
 * Çekilen haber sayfasını okuyucunun iki moduna hazırlar.
 *
 * `fallbackUrl` yalnızca arka uç <base> etiketi ekleyememişse kullanılır.
 */
export function prepareArticle(html: string, fallbackUrl: string): PreparedArticle {
  const { reader, title } = toReaderHtml(html);
  return { page: toFramePage(html, fallbackUrl), reader, title };
}
