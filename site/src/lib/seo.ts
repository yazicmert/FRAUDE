/**
 * Sayfa künyesi (başlık, açıklama, paylaşım kartı, yapısal veri).
 *
 * Site tek sayfalık bir uygulama: adres değişir ama belge `<head>`'i sunucudan
 * hep aynı gelir. Arama motoru JavaScript'i çalıştırdığı için buradaki
 * güncelleme ona yeter; **sosyal ağların önizleme robotları çalıştırmaz**.
 * O yüzden aynı künye `scripts/prerender.mjs` tarafından derleme sonrası her
 * adres için statik HTML'e de basılır — iki taraf bu dosyadaki
 * `routeMeta()` fonksiyonundan beslenir, künye tek yerde tanımlıdır.
 */
import { ALL_MODULES, MODULE_COUNT, SOURCES, findModule } from './product';
import type { Lang } from './strings';

/** Yayın kökü. E-posta işlevlerindeki `SITE_URL` ile aynı olmalı. */
export const SITE_ORIGIN = 'https://fraude.intelligentverseconnection.com';

/** Paylaşım kartı — 1200×630, sosyal ağların beklediği ölçü. */
export const OG_IMAGE = '/og.png';

/** Kartın alternatif metni: görseli göremeyen okuyucu da ne olduğunu bilsin. */
export const OG_IMAGE_ALT: Record<Lang, string> = {
  tr: 'FRAUDE paylaşım kartı: teknik tarayıcı panelinde RSI 30 altındaki BIST hisselerini listeleyen örnek bir tarama.',
  en: 'FRAUDE share card: a sample screener run listing BIST stocks below RSI 30.',
};

export const GITHUB_REPO = 'https://github.com/yazicmert/FRAUDE';

export interface RouteMeta {
  title: string;
  description: string;
  /** Kanonik adres, köke göre (`/modul/pano` gibi). */
  path: string;
  /** Arama motoru bu sayfayı dizine almasın (hesap, yönetim, oturum sayfaları). */
  noindex: boolean;
  /** Sayfaya özel yapısal veri; ana sayfada ürün + SSS künyesi taşır. */
  jsonLd: unknown[];
}

const SITE_NAME = 'FRAUDE';

const COPY = {
  tr: {
    homeTitle: 'FRAUDE — Borsa İstanbul için masaüstü finans terminali',
    homeDesc: `KAP bildirimleri, SPK bültenleri, TEFAS fon verisi ve teknik tarama tek masaüstü uygulamasında. ${MODULE_COUNT} modül, macOS ve Windows, açık kaynak ve ücretsiz.`,
    sourcesTitle: 'Veri kaynakları — FRAUDE',
    sourcesDesc:
      'FRAUDE kendi verisini üretmez. Ekrandaki her satırın hangi kurumdan geldiğini, ne sıklıkla çekildiğini ve gecikme koşullarını burada yayımlıyoruz.',
    updatesTitle: 'Güncellemeler — FRAUDE',
    updatesDesc:
      'Güvenlik incelemesinden geçip depoya alınan katkılar ve hangi sürümle yayımlandıkları.',
    signInTitle: 'Giriş — FRAUDE',
    accountTitle: 'Hesabım — FRAUDE',
    adminTitle: 'Yönetim — FRAUDE',
    notFoundTitle: 'Sayfa bulunamadı — FRAUDE',
    notFoundDesc: 'Aradığınız adres burada yok.',
    genericDesc: 'FRAUDE — finansal dostunuz.',
    modulesCrumb: 'Modüller',
    homeCrumb: 'Ana sayfa',
    appDesc: `Borsa İstanbul ve küresel piyasalar için ${MODULE_COUNT} modüllü masaüstü finans terminali. Veriyi KAP, SPK, TEFAS, Borsa İstanbul, İş Yatırım ve TCMB'nin herkese açık uçlarından okur.`,
  },
  en: {
    homeTitle: 'FRAUDE — Desktop finance terminal for Borsa İstanbul',
    homeDesc: `KAP disclosures, SPK bulletins, TEFAS fund data and technical screening in one desktop app. ${MODULE_COUNT} modules, macOS and Windows, open source and free.`,
    sourcesTitle: 'Data sources — FRAUDE',
    sourcesDesc:
      'FRAUDE produces no data of its own. Every row on screen comes from a named institution; this page lists which one, how often it is fetched and how delayed it is.',
    updatesTitle: 'Updates — FRAUDE',
    updatesDesc:
      'Contributions that passed security review and were merged, and the release each one shipped in.',
    signInTitle: 'Sign in — FRAUDE',
    accountTitle: 'My account — FRAUDE',
    adminTitle: 'Admin — FRAUDE',
    notFoundTitle: 'Page not found — FRAUDE',
    notFoundDesc: 'There is nothing at this address.',
    genericDesc: 'FRAUDE — your financial companion.',
    modulesCrumb: 'Modules',
    homeCrumb: 'Home',
    appDesc: `A ${MODULE_COUNT}-module desktop finance terminal for Borsa İstanbul and global markets, reading from the public endpoints of KAP, SPK, TEFAS, Borsa İstanbul, İş Yatırım and the Turkish central bank.`,
  },
} as const;

/** Oturuma bağlı ya da tek kullanımlık adresler — dizine girmemeli. */
const PRIVATE_PATHS = new Set([
  '/giris',
  '/hesap',
  '/admin',
  '/sifre-yenile',
  '/lisans-iptal',
  '/uygulamaya-giris',
  '/bildirim-iptal',
]);

/** Site haritasına ve ön-derlemeye giren herkese açık adresler. */
export function publicPaths(): string[] {
  return ['/', '/veri-kaynaklari', '/guncellemeler', ...ALL_MODULES.map((m) => `/modul/${m.slug}`)];
}

function organization() {
  return {
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_ORIGIN,
    logo: `${SITE_ORIGIN}/favicon.svg`,
    sameAs: [GITHUB_REPO],
  };
}

/**
 * Ürün künyesi. `offers.price: '0'` uydurma değil: erişim ücretsiz, lisans
 * anahtarı yalnızca kapasite kapısı (bkz. ana sayfadaki Erişim bölümü).
 */
function softwareApplication(lang: Lang) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'macOS, Windows',
    description: COPY[lang].appDesc,
    url: SITE_ORIGIN,
    image: `${SITE_ORIGIN}${OG_IMAGE}`,
    inLanguage: ['tr', 'en'],
    isAccessibleForFree: true,
    license: `${GITHUB_REPO}/blob/main/README.md`,
    codeRepository: GITHUB_REPO,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'TRY' },
    publisher: organization(),
    featureList: ALL_MODULES.map((m) => m.name[lang]),
  };
}

function webSite(lang: Lang) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_ORIGIN,
    inLanguage: lang,
    publisher: organization(),
  };
}

/**
 * SSS künyesi ana sayfadaki soruların birebir kopyasıdır. Metni burada
 * tekrar yazmıyoruz: `t()` ile aynı kaynaktan okunur, yoksa yapısal veri ile
 * ekranda görünen metin ayrışır ve bu bir işaretleme ihlalidir.
 */
function faqPage(t: (key: string) => string) {
  const pairs = [1, 2, 3, 4, 5, 6].map((n) => ({ q: t(`q${n}`), a: t(`a${n}`) }));
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: pairs.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

function breadcrumbs(lang: Lang, trail: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { name: COPY[lang].homeCrumb, path: '/' },
      ...trail,
    ].map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: `${SITE_ORIGIN}${item.path === '/' ? '' : item.path}`,
    })),
  };
}

/**
 * Bir adresin künyesi. `t` yalnızca ana sayfanın SSS künyesi için gerekir;
 * ön-derleme betiği metinleri kendi tarafından geçirir.
 */
export function routeMeta(path: string, lang: Lang, t?: (key: string) => string): RouteMeta {
  const copy = COPY[lang];
  const noindex = PRIVATE_PATHS.has(path);

  if (path === '/') {
    const jsonLd: unknown[] = [softwareApplication(lang), webSite(lang)];
    if (t) jsonLd.push(faqPage(t));
    return { title: copy.homeTitle, description: copy.homeDesc, path: '/', noindex: false, jsonLd };
  }

  if (path === '/veri-kaynaklari') {
    return {
      title: copy.sourcesTitle,
      // Kaynak adları açıklamanın içinde: arama sonucunda kurum adı aranırsa eşleşsin.
      description: `${copy.sourcesDesc} ${SOURCES.join(', ')}.`,
      path,
      noindex: false,
      jsonLd: [breadcrumbs(lang, [{ name: copy.sourcesTitle.split(' — ')[0], path }])],
    };
  }

  if (path === '/guncellemeler') {
    return {
      title: copy.updatesTitle,
      description: copy.updatesDesc,
      path,
      noindex: false,
      jsonLd: [breadcrumbs(lang, [{ name: copy.updatesTitle.split(' — ')[0], path }])],
    };
  }

  if (path.startsWith('/modul/')) {
    const slug = decodeURIComponent(path.slice('/modul/'.length));
    const mod = findModule(slug);
    if (!mod) {
      return { title: copy.notFoundTitle, description: copy.notFoundDesc, path, noindex: true, jsonLd: [] };
    }
    return {
      title: `${mod.name[lang]} — ${SITE_NAME}`,
      description: `${mod.lead[lang]} ${mod.desc[lang]}`,
      path: `/modul/${mod.slug}`,
      noindex: false,
      jsonLd: [
        breadcrumbs(lang, [
          { name: copy.modulesCrumb, path: '/#moduller' },
          { name: mod.name[lang], path: `/modul/${mod.slug}` },
        ]),
      ],
    };
  }

  // Başlığı olan özel sayfalar. Listedeki diğer adresler (jetonla açılan tek
  // kullanımlık bağlantılar) sekmede kendi adlarını taşımaz: sayfa yoksa
  // bulunamadı başlığı doğrudur, robot yönergesi yine de noindex kalır.
  const PRIVATE_TITLES: Record<string, string> = {
    '/giris': copy.signInTitle,
    '/hesap': copy.accountTitle,
    '/admin': copy.adminTitle,
  };

  return {
    title: PRIVATE_TITLES[path] ?? copy.notFoundTitle,
    description: noindex ? copy.genericDesc : copy.notFoundDesc,
    path,
    noindex: true,
    jsonLd: [],
  };
}

/**
 * Dil seçimi adreste değil, `?lang=` sorgusunda ve yerel depoda tutuluyor.
 * hreflang bağlantıları da bu yüzden sorgu parametresini gösterir; kanonik
 * adres sorgusuz sürümdür, böylece iki dil tek sayfada birikir.
 */
export function alternates(path: string): { hreflang: string; href: string }[] {
  const base = `${SITE_ORIGIN}${path === '/' ? '/' : path}`;
  return [
    { hreflang: 'tr', href: `${base}?lang=tr` },
    { hreflang: 'en', href: `${base}?lang=en` },
    { hreflang: 'x-default', href: base },
  ];
}

export function canonical(path: string): string {
  return `${SITE_ORIGIN}${path === '/' ? '/' : path}`;
}
