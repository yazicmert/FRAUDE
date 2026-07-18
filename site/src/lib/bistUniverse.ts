import { supabase } from './supabase';
import { BIST_TICKERS } from './bistTickers';

export type TickerPair = readonly [string, string];

// Canlı BIST evreni Supabase `bist_tickers` tablosundan gelir (sunucuda KAP'tan
// günlük tazelenir; yeni halka arzlar otomatik girer). Tablo boş/erişilemezse
// gömülü statik anlık görüntüye düşülür. Sonuç modül düzeyinde bir kez önbelleğe
// alınır, sekme boyunca yeniden çekilmez.
let cache: Promise<readonly TickerPair[]> | null = null;

async function fetchUniverse(): Promise<readonly TickerPair[]> {
  try {
    const { data, error } = await supabase.from('bist_tickers').select('code, name').order('code');
    if (error || !data || data.length === 0) return BIST_TICKERS;
    return data.map((r) => [r.code as string, (r.name as string) ?? ''] as TickerPair);
  } catch {
    return BIST_TICKERS;
  }
}

export function loadBistUniverse(): Promise<readonly TickerPair[]> {
  if (!cache) cache = fetchUniverse();
  return cache;
}
