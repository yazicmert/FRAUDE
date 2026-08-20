import { useEffect, useState } from 'react';
import { DOWNLOAD_MAC, DOWNLOAD_WIN } from './download';
import type { StringKey } from './strings';

export type Platform = 'mac' | 'windows' | 'other';

/**
 * Ziyaretçinin masaüstü platformu. İndirme çağrısı buna göre sıralanır:
 * Windows'tan gelen birine önce macOS paketini göstermek, doğru paketi
 * bulmayı okuyucunun işi hâline getiriyor.
 *
 * `userAgentData` yalnız Chromium'da var; yoksa aracı dizgesine düşülür.
 * iPadOS masaüstü modunda kendini Macintosh gibi tanıtır — dokunmatik
 * kontrolü olan bir Mac aslında iPad'dir ve orada uygulama çalışmaz, o yüzden
 * "other" sayılır ve iki paket de eşit görünür.
 */
export function detectPlatform(): Platform {
  const data = (navigator as { userAgentData?: { platform?: string } }).userAgentData;
  const raw = (data?.platform || navigator.userAgent || '').toLowerCase();

  if (raw.includes('win')) return 'windows';
  if (raw.includes('mac')) {
    const touch = navigator.maxTouchPoints > 1;
    return touch ? 'other' : 'mac';
  }
  return 'other';
}

export interface DownloadChoice {
  /** Birincil düğme — ziyaretçinin platformu. */
  primary: { href: string; label: StringKey };
  /** İkincil bağlantı — diğer platform. */
  secondary: { href: string; label: StringKey; short: StringKey };
  /** Platform anlaşılamadıysa iki paket de eşit ağırlıkta gösterilir. */
  ambiguous: boolean;
}

const MAC = {
  href: DOWNLOAD_MAC,
  label: 'dlMac' as StringKey,
  short: 'heroSecondaryMac' as StringKey,
};
const WIN = {
  href: DOWNLOAD_WIN,
  label: 'dlWin' as StringKey,
  short: 'heroSecondary' as StringKey,
};

/**
 * Sunucudan gelen HTML her ziyaretçi için aynı olduğundan ilk çizimde
 * macOS varsayılır; platform tespiti bağlandıktan sonra sıralama düzelir.
 * Bu, ön-derlenmiş HTML ile ilk çizimin uyuşmasını da korur.
 */
export function useDownloadChoice(): DownloadChoice {
  const [platform, setPlatform] = useState<Platform>('mac');

  useEffect(() => setPlatform(detectPlatform()), []);

  if (platform === 'windows') {
    return { primary: WIN, secondary: MAC, ambiguous: false };
  }
  return { primary: MAC, secondary: WIN, ambiguous: platform === 'other' };
}
