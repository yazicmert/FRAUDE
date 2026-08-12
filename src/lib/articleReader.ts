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
 * Belgenin göreli adresleri kaynağa göre çözsün diye <base>'i düzeltir.
 *
 * İki tuzak var. Birincisi: sayfa kendi <base href="/"> etiketiyle geliyorsa
 * arka uç ekleme yapmadan geçer, ama blob belgesinde "/" uygulamanın kendi
 * adresine çözülür ve sayfanın tek bir görseli bile yüklenmez — bu yüzden var
 * olan <base> mutlak adrese çevrilir. İkincisi: <base> kendisinden önce
 * ayrıştırılmış etiketleri etkilemez, bu yüzden <head>'in başına konur.
 */
function normalizeBase(doc: Document, sourceUrl: string): void {
  const head = doc.head ?? doc.documentElement;
  const existing = doc.querySelector('base[href]');
  const resolved = (() => {
    const raw = existing?.getAttribute('href') ?? '';
    try {
      return raw ? new URL(raw, sourceUrl).href : sourceUrl;
    } catch {
      return sourceUrl;
    }
  })();
  if (!resolved) return;

  const base = existing ?? doc.createElement('base');
  base.setAttribute('href', resolved);
  head.prepend(base);
}

/**
 * Sayfayı çerçevede güvenle çizilebilecek hâle getirir.
 *
 * Çerçeve `sandbox` ile açıldığından betikler zaten çalışmaz; yine de
 * ağa istek atan etiketler (betik, gömülü çerçeve, nesne, ön yükleme)
 * sökülür — hem reklam/izleyici trafiği kesilsin hem de sayfa çevrimdışı
 * bir belge gibi davransın. Betikler çalışmadığından tembel yüklenen
 * görseller boş kalırdı; gerçek adresleri sakladıkları özniteliklerden geri
 * yazılır.
 */
function toFramePage(html: string, sourceUrl: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  doc
    .querySelectorAll(
      'script, iframe, frame, object, embed, applet,' +
        ' link[rel~="preload"], link[rel~="prefetch"], link[rel~="dns-prefetch"], link[rel~="preconnect"],' +
        // Yenileme etiketi sayfayı kaynağın çerçevelemeyi reddettiği adrese
        // götürüp ekranı boş bırakabilir.
        ' meta[http-equiv="refresh" i]',
    )
    .forEach((node) => node.remove());

  // Sayfa arka uçta UTF-8'e çözülüp geliyor; kaynağın kendi charset bildirimi
  // kalırsa Türkçe metin bozuk çizilir (windows-1254 yayın yapan siteler var).
  doc.querySelectorAll('meta[charset], meta[http-equiv="Content-Type" i]').forEach((node) => node.remove());

  normalizeBase(doc, sourceUrl);

  const head = doc.head ?? doc.documentElement;
  const charset = doc.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  head.prepend(charset);

  // Kaynak siteye okuma bağlamı sızmasın; bazı sunucular yabancı referrer'lı
  // varlık isteklerini de geri çeviriyor.
  const referrer = doc.createElement('meta');
  referrer.setAttribute('name', 'referrer');
  referrer.setAttribute('content', 'no-referrer');
  head.prepend(referrer);

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

  // <picture> içindeki kaynaklar da tembel yükleniyor; yalnız <img>'e bakmak
  // görselin yerine gri bir yer tutucu bırakırdı.
  doc.querySelectorAll('img, source').forEach((element) => {
    const current = element.getAttribute('src') ?? '';
    if (element.tagName === 'IMG' && (!current || current.startsWith('data:'))) {
      const lazy = LAZY_SRC_ATTRS
        .map((name) => element.getAttribute(name))
        .find((value) => value && !value.startsWith('data:'));
      if (lazy) element.setAttribute('src', lazy);
    }
    if (!element.getAttribute('srcset')) {
      const lazySet = LAZY_SRCSET_ATTRS.map((name) => element.getAttribute(name)).find(Boolean);
      if (lazySet) element.setAttribute('srcset', lazySet);
    }
    // Çerçeve görünürlüğü tarayıcıya farklı raporlandığından ertelenen
    // görseller hiç istenmeyebiliyor.
    element.removeAttribute('loading');
  });

  // Tarayıcı bir sayfayı beyaz kâğıda çizer; çerçeve ise saydamdır. Sitenin
  // kendi stil dosyası gelmediğinde (kimi sunucu yabancı istekte vermiyor)
  // saydam gövde koyu okuyucu zeminine oturur ve siyah metin görünmez olurdu.
  // Kural <head>'in başına konur: sayfa kendi stilini getirebildiyse onunki
  // sonra geldiği için üste çıkar, getiremediyse bu zemin kalır.
  const style = doc.createElement('style');
  style.textContent =
    'html{background:#fff;color:#111}html,body{max-width:100%}' +
    'img,video,table{max-width:100%}img,video{height:auto}';
  head.prepend(style);

  return `<!doctype html>${doc.documentElement.outerHTML}`;
}

/**
 * Sayfadan yalnızca haber metnini çıkarır.
 *
 * Readability aldığı belgeyi tükettiğinden sayfa görünümüyle aynı ağaç
 * paylaşılamaz; bu yüzden HTML ikinci kez ayrıştırılır. Çıkan metin
 * uygulamanın kendi belgesine gömüldüğünden görseller uygulamanın
 * referrer'ıyla istenmesin diye işaretlenir.
 */
function toReaderHtml(html: string, sourceUrl: string): { reader: string | null; title: string | null } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Readability göreli adresleri belgenin base'ine göre mutlaklaştırır; base
  // bozuksa haber metni görselsiz ve kırık bağlantılı çıkar.
  normalizeBase(doc, sourceUrl);

  const parsed = new Readability(doc).parse();
  if (!parsed?.content) return { reader: null, title: null };

  const clean = DOMPurify.sanitize(parsed.content, { USE_PROFILES: { html: true } }).trim();
  if (!clean) return { reader: null, title: parsed.title?.trim() || null };

  const fragment = new DOMParser().parseFromString(clean, 'text/html');
  fragment.querySelectorAll('img').forEach((image) => {
    image.setAttribute('referrerpolicy', 'no-referrer');
    image.setAttribute('loading', 'lazy');
  });

  return { reader: fragment.body.innerHTML, title: parsed.title?.trim() || null };
}

/**
 * Çekilen haber sayfasını okuyucunun iki moduna hazırlar.
 *
 * `sourceUrl` göreli adreslerin çözüleceği adrestir; arka uç zaten bir
 * <base> ekliyor, bu adres onun doğrulanması ve eksik kaldığında tamamlanması
 * için kullanılır.
 */
export function prepareArticle(html: string, sourceUrl: string): PreparedArticle {
  const { reader, title } = toReaderHtml(html, sourceUrl);
  return { page: toFramePage(html, sourceUrl), reader, title };
}
