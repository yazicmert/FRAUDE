/**
 * Ekran görüntülerinin gerçek piksel ölçüleri.
 *
 * `<img>` etiketine width/height yazılmadığında tarayıcı dosya inene kadar
 * görüntüye yer ayıramaz ve altındaki metin indiği anda aşağı kayar (CLS).
 * Ölçüler `site/public/shots/*.webp` dosyalarından okundu; biri yeniden
 * çekilirse buradaki satırı da güncelleyin.
 */
const SIZES: Record<string, [number, number]> = {
  ai: [1600, 1029],
  ca: [1600, 1029],
  db: [1600, 1029],
  em: [1600, 1029],
  fo: [1600, 1029],
  ip: [1600, 1029],
  kb: [1600, 1029],
  kr: [1600, 463],
  nw: [1600, 1029],
  rd: [1600, 1029],
  rs: [1600, 1029],
  sc: [1600, 1029],
};

/** Bilinmeyen dosya için en yaygın ölçü; yer ayırmamaktan iyidir. */
const DEFAULT: [number, number] = [1600, 1029];

export function shotSize(shot: string): { width: number; height: number } {
  const [width, height] = SIZES[shot] ?? DEFAULT;
  return { width, height };
}

export function shotSrc(shot: string): string {
  return `/shots/${shot}.webp`;
}
