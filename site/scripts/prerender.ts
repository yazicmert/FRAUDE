import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';
import { STRINGS } from '../src/lib/strings';
import {
  OG_IMAGE,
  OG_IMAGE_ALT,
  SITE_ORIGIN,
  alternates,
  canonical,
  publicPaths,
  routeMeta,
} from '../src/lib/seo';

/**
 * Her herkese açık adres için künyesi yerine yazılmış bir HTML dosyası üretir
 * ve site haritasını yazar.
 *
 * Neden gerekiyor: site tek sayfalık bir uygulama, sunucu her adres için aynı
 * `index.html`'i veriyor. Arama motoru JavaScript'i çalıştırdığı için
 * `lib/useSeo.ts`'in bastığı künyeyi görür; **paylaşım önizlemesi üreten
 * robotlar (WhatsApp, Slack, LinkedIn, X, Facebook) çalıştırmaz.** Onlara
 * yalnızca sunucudan gelen HTML ulaşır — ön-derleme olmadan her bağlantı ana
 * sayfanın başlığıyla paylaşılır.
 *
 * Üretilen dosyalar `dist/veri-kaynaklari.html`, `dist/modul/pano.html` gibi
 * adlarla durur; Vercel `cleanUrls` ayarıyla bunları uzantısız adreste sunar
 * ve dosya sistemi kontrolü SPA yönlendirmesinden önce çalıştığı için doğru
 * dosya kazanır (bkz. vercel.json).
 *
 * Künye `src/lib/seo.ts`'ten okunur: tarayıcıdaki güncelleme ile buradaki
 * statik çıktı tek kaynaktan beslensin, ayrışmasınlar.
 */

/** Ön-derlenmiş HTML'in dili. Sunucu tarafında ziyaretçi dili bilinmez. */
const DEFAULT_LANG = 'tr' as const;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** JSON-LD gövdesi `</script>` içeremez; kapanışı kaçırmak XSS'i de kapatır. */
const escapeJsonLd = (value: string) => value.replace(/</g, '\\u003c');

function headFor(path: string): string {
  const t = (key: string) => (STRINGS[DEFAULT_LANG] as Record<string, string>)[key] ?? '';
  const meta = routeMeta(path, DEFAULT_LANG, t);
  const url = canonical(meta.path);
  const image = `${SITE_ORIGIN}${OG_IMAGE}`;

  const lines: string[] = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta data-seo name="description" content="${escapeHtml(meta.description)}" />`,
    `<link data-seo rel="canonical" href="${url}" />`,
  ];

  if (meta.noindex) {
    lines.push('<meta data-seo name="robots" content="noindex, nofollow" />');
    return lines.join('\n    ');
  }

  lines.push('<meta data-seo name="robots" content="index, follow, max-image-preview:large" />');

  for (const alt of alternates(meta.path)) {
    lines.push(
      `<link data-seo rel="alternate" hreflang="${alt.hreflang}" href="${escapeHtml(alt.href)}" />`,
    );
  }

  lines.push(
    '<meta data-seo property="og:type" content="website" />',
    '<meta data-seo property="og:site_name" content="FRAUDE" />',
    `<meta data-seo property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta data-seo property="og:description" content="${escapeHtml(meta.description)}" />`,
    `<meta data-seo property="og:url" content="${url}" />`,
    `<meta data-seo property="og:image" content="${image}" />`,
    '<meta data-seo property="og:image:width" content="1200" />',
    '<meta data-seo property="og:image:height" content="630" />',
    `<meta data-seo property="og:image:alt" content="${escapeHtml(OG_IMAGE_ALT[DEFAULT_LANG])}" />`,
    '<meta data-seo property="og:locale" content="tr_TR" />',
    '<meta data-seo property="og:locale:alternate" content="en_US" />',
    '<meta data-seo name="twitter:card" content="summary_large_image" />',
    `<meta data-seo name="twitter:title" content="${escapeHtml(meta.title)}" />`,
    `<meta data-seo name="twitter:description" content="${escapeHtml(meta.description)}" />`,
    `<meta data-seo name="twitter:image" content="${image}" />`,
    `<meta data-seo name="twitter:image:alt" content="${escapeHtml(OG_IMAGE_ALT[DEFAULT_LANG])}" />`,
  );

  for (const entry of meta.jsonLd) {
    lines.push(
      `<script data-seo type="application/ld+json">${escapeJsonLd(JSON.stringify(entry))}</script>`,
    );
  }

  return lines.join('\n    ');
}

function sitemap(paths: string[], lastmod: string): string {
  const urls = paths
    .map((path) => {
      const links = alternates(path)
        .map(
          (alt) =>
            `    <xhtml:link rel="alternate" hreflang="${alt.hreflang}" href="${escapeHtml(alt.href)}" />`,
        )
        .join('\n');
      // Ana sayfa dışındaki her sayfa aynı ürünü anlatan yardımcı içerik;
      // önceliği ana sayfanın altında tutuyoruz.
      const priority = path === '/' ? '1.0' : '0.7';
      return `  <url>\n    <loc>${canonical(path)}</loc>\n${links}\n    <lastmod>${lastmod}</lastmod>\n    <priority>${priority}</priority>\n  </url>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`;
}

/** `/modul/pano` → `modul/pano.html`, `/` → `index.html`. */
function fileFor(path: string): string {
  return path === '/' ? 'index.html' : `${path.replace(/^\//, '')}.html`;
}

export function prerender(): Plugin {
  let outDir = 'dist';

  return {
    name: 'fraude-prerender',
    apply: 'build',

    configResolved(config) {
      outDir = config.build.outDir;
    },

    async closeBundle() {
      const template = await readFile(join(outDir, 'index.html'), 'utf8');
      const marker = /<!-- seo:start -->[\s\S]*?<!-- seo:end -->/;

      if (!marker.test(template)) {
        throw new Error(
          'index.html içinde <!-- seo:start --> … <!-- seo:end --> işaretçileri yok; ' +
            'künye enjekte edilemedi.',
        );
      }

      const paths = publicPaths();

      for (const path of paths) {
        const html = template.replace(marker, headFor(path));
        const target = join(outDir, fileFor(path));
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, html, 'utf8');
      }

      const lastmod = new Date().toISOString().slice(0, 10);
      await writeFile(join(outDir, 'sitemap.xml'), sitemap(paths, lastmod), 'utf8');

      // eslint-disable-next-line no-console
      console.log(`  ✓ künye ${paths.length} adres için basıldı, sitemap.xml yazıldı`);
    },
  };
}
