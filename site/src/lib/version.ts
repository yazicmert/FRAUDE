import { useEffect, useState } from 'react';

/**
 * Yayımlanan son sürüm etiketi. İndirme bağlantıları `releases/latest`e
 * gittiği için sitedeki sürüm numarası da elle güncellenmemeli; yoksa
 * depo sürümü ile yayımlanan sürüm ayrışır (2026-08: depo 0.1.18, yayın v0.1.19).
 *
 * GitHub API kimliksiz istekte IP başına saatte 60 çağrıya izin verir; sınır
 * aşılır ya da istek düşerse yedek değer gösterilir, sayfa hiç kırılmaz.
 */
const RELEASES_API = 'https://api.github.com/repos/yazicmert/FRAUDE/releases/latest';

/** İstek düşerse gösterilecek değer — bilinen son yayın. */
const FALLBACK = 'v0.1.19';

const CACHE_KEY = 'fraude-site-latest-version';

export function useLatestVersion(): string {
  const [version, setVersion] = useState<string>(
    () => sessionStorage.getItem(CACHE_KEY) ?? FALLBACK,
  );

  useEffect(() => {
    let alive = true;
    fetch(RELEASES_API, { headers: { accept: 'application/vnd.github+json' } })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((release: { tag_name?: string }) => {
        const tag = release.tag_name?.trim();
        if (!alive || !tag) return;
        sessionStorage.setItem(CACHE_KEY, tag);
        setVersion(tag);
      })
      .catch(() => {
        /* Yedek değer zaten ekranda; sessizce geç. */
      });
    return () => {
      alive = false;
    };
  }, []);

  return version;
}
