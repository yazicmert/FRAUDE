import { useEffect } from 'react';
import { useI18n } from './i18n';
import { OG_IMAGE, OG_IMAGE_ALT, SITE_ORIGIN, alternates, canonical, routeMeta } from './seo';

/**
 * Belge künyesini adres ve dile göre günceller.
 *
 * Sunucudan gelen HTML ön-derleme adımının bastığı künyeyi taşır (bkz.
 * `scripts/prerender.ts`). Burası aynı etiketleri **istemcide** tazeler:
 * kullanıcı sekmeye tıklayıp modül sayfasına geçtiğinde ya da dili
 * değiştirdiğinde başlık, açıklama ve kanonik adres onunla birlikte değişsin.
 *
 * Etiketler `data-seo` ile işaretlenir; her güncellemede eskiler silinip
 * yenileri basılır. Böylece bir önceki sayfadan artık etiket kalmaz —
 * ön-derlenmiş HTML'den gelenler de aynı işareti taşıdığı için temizlenir.
 */
export function useSeo(path: string): void {
  const { lang, t } = useI18n();

  useEffect(() => {
    const meta = routeMeta(path, lang, t as (key: string) => string);
    const head = document.head;

    document.title = meta.title;
    head.querySelectorAll('[data-seo]').forEach((node) => node.remove());

    const add = (tag: 'meta' | 'link' | 'script', attrs: Record<string, string>, text?: string) => {
      const el = document.createElement(tag);
      el.setAttribute('data-seo', '');
      for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
      if (text) el.textContent = text;
      head.appendChild(el);
    };

    const url = canonical(meta.path);
    const image = `${SITE_ORIGIN}${OG_IMAGE}`;

    add('meta', { name: 'description', content: meta.description });
    add('link', { rel: 'canonical', href: url });

    // Dizine girmeyecek sayfalarda önizleme kartı da gereksiz; robot yönergesi yeter.
    if (meta.noindex) {
      add('meta', { name: 'robots', content: 'noindex, nofollow' });
      return;
    }

    add('meta', { name: 'robots', content: 'index, follow, max-image-preview:large' });

    for (const alt of alternates(meta.path)) {
      add('link', { rel: 'alternate', hreflang: alt.hreflang, href: alt.href });
    }

    add('meta', { property: 'og:type', content: 'website' });
    add('meta', { property: 'og:site_name', content: 'FRAUDE' });
    add('meta', { property: 'og:title', content: meta.title });
    add('meta', { property: 'og:description', content: meta.description });
    add('meta', { property: 'og:url', content: url });
    add('meta', { property: 'og:image', content: image });
    add('meta', { property: 'og:image:width', content: '1200' });
    add('meta', { property: 'og:image:height', content: '630' });
    add('meta', { property: 'og:image:alt', content: OG_IMAGE_ALT[lang] });
    add('meta', { property: 'og:locale', content: lang === 'tr' ? 'tr_TR' : 'en_US' });
    add('meta', { property: 'og:locale:alternate', content: lang === 'tr' ? 'en_US' : 'tr_TR' });

    add('meta', { name: 'twitter:card', content: 'summary_large_image' });
    add('meta', { name: 'twitter:title', content: meta.title });
    add('meta', { name: 'twitter:description', content: meta.description });
    add('meta', { name: 'twitter:image', content: image });
    add('meta', { name: 'twitter:image:alt', content: OG_IMAGE_ALT[lang] });

    for (const entry of meta.jsonLd) {
      add('script', { type: 'application/ld+json' }, JSON.stringify(entry));
    }
  }, [path, lang, t]);
}
