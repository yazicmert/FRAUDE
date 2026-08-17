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
  /** Readability veya başlıktan bulunan başlık; yoksa null. */
  title: string | null;
}

/** Tembel yükleyen sitelerin gerçek görsel adresini sakladığı öznitelikler. */
const LAZY_SRC_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-echo', 'data-hi-res-src', 'data-actualsrc'];
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
 * Sayfadaki tembel yüklenen görselleri ve resim kaynaklarını çözümler.
 */
function resolveLazyImages(container: Element | Document): void {
  container.querySelectorAll('img, source').forEach((element) => {
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
    element.removeAttribute('loading');
  });
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

  resolveLazyImages(doc);

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
 * Modern haber ve kripto siteleri (Yahoo Finance, CoinDesk, Decrypt, SeekingAlpha vb.)
 * için Readability başarısız olduğunda veya kısa döndürdüğünde devreye giren yedek çıkarıcı.
 */
function extractFallbackArticle(doc: Document): string | null {
  const ARTICLE_SELECTORS = [
    'article',
    '[itemprop="articleBody"]',
    '[itemprop="text"]',
    '.caas-body',
    '.article-body',
    '.story-body',
    '.article-content',
    '.article__content',
    '.post-content',
    '.entry-content',
    '.news-content',
    '.content-body',
    '#article-body',
    'main',
  ];

  let candidate: Element | null = null;
  for (const selector of ARTICLE_SELECTORS) {
    const el = doc.querySelector(selector);
    if (el && (el.textContent ?? '').trim().length > 120) {
      candidate = el;
      break;
    }
  }

  if (!candidate) return null;

  const clone = candidate.cloneNode(true) as Element;
  clone.querySelectorAll(
    'script, style, noscript, iframe, frame, object, form, nav, header, footer, aside, ' +
    '.ad, .ads, .advertisement, .social-share, .cookie-banner, .comments, .related-articles, button, input',
  ).forEach((node) => node.remove());

  resolveLazyImages(clone);

  const rawHtml = clone.innerHTML;
  const clean = DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } }).trim();
  const textLen = clean.replace(/<[^>]*>/g, '').trim().length;
  return textLen >= 100 ? clean : null;
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
  normalizeBase(doc, sourceUrl);

  const parsed = new Readability(doc).parse();
  let cleanContent = parsed?.content
    ? DOMPurify.sanitize(parsed.content, { USE_PROFILES: { html: true } }).trim()
    : null;

  const title = parsed?.title?.trim()
    || doc.querySelector('title')?.textContent?.trim()
    || doc.querySelector('h1')?.textContent?.trim()
    || null;

  // Readability yetersiz veya boş kaldıysa yedek çıkarıcıyı dene
  const textLength = cleanContent ? cleanContent.replace(/<[^>]*>/g, '').trim().length : 0;
  if (!cleanContent || textLength < 120) {
    const freshDoc = new DOMParser().parseFromString(html, 'text/html');
    normalizeBase(freshDoc, sourceUrl);
    const fallback = extractFallbackArticle(freshDoc);
    if (fallback) {
      cleanContent = fallback;
    }
  }

  if (!cleanContent) return { reader: null, title };

  const fragment = new DOMParser().parseFromString(cleanContent, 'text/html');
  resolveLazyImages(fragment);
  fragment.querySelectorAll('img').forEach((image) => {
    image.setAttribute('referrerpolicy', 'no-referrer');
    image.setAttribute('loading', 'lazy');
  });

  return { reader: fragment.body.innerHTML, title };
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
