/**
 * Uygulama genelinde aranabilir hazır varlık kataloğu: BIST endeksleri,
 * döviz, emtia, global endeksler ve kripto. Hem üst çubuk araması hem de
 * karşılaştırma grafiği bu listeyi kullanır.
 */
export interface PresetSymbol {
  /** Veri sembolü (Yahoo/backend formatı) */
  symbol: string;
  label: string;
  group: string;
  /** Etiket/sembolde geçmeyen yaygın arama terimleri (XAU, gold, bitcoin...) */
  keywords?: string[];
  /** BIST endeksleri için IndexView'in beklediği ad; varsa endeks sekmesi açılır */
  indexName?: string;
}

export const PRESET_SYMBOLS: PresetSymbol[] = [
  { symbol: 'XU100.IS', label: 'BIST 100', group: 'Endeks', keywords: ['xu100', 'bist100'], indexName: 'BIST 100' },
  { symbol: 'XU030.IS', label: 'BIST 30', group: 'Endeks', keywords: ['xu030', 'bist30'], indexName: 'BIST 30' },
  { symbol: 'XBANK.IS', label: 'BIST Banka', group: 'Endeks', indexName: 'BIST BANKA' },
  { symbol: 'XUSIN.IS', label: 'BIST Sınai', group: 'Endeks', indexName: 'BIST SINAI' },
  { symbol: 'XUTEK.IS', label: 'BIST Teknoloji', group: 'Endeks', indexName: 'BIST TEKNOLOJI' },
  { symbol: 'XHARZ.IS', label: 'BIST Halka Arz', group: 'Endeks', keywords: ['ipo'], indexName: 'BIST HALKA ARZ' },
  { symbol: 'USDTRY=X', label: 'Dolar/TL', group: 'Döviz', keywords: ['usd', 'usdtry', 'dolar', 'dollar'] },
  { symbol: 'EURTRY=X', label: 'Euro/TL', group: 'Döviz', keywords: ['eur', 'eurtry', 'euro'] },
  { symbol: 'GBPTRY=X', label: 'Sterlin/TL', group: 'Döviz', keywords: ['gbp', 'pound'] },
  { symbol: 'GRAM ALTIN', label: 'Gram Altın (TL)', group: 'Emtia', keywords: ['xau', 'gold', 'altin'] },
  { symbol: 'GRAM GÜMÜŞ', label: 'Gram Gümüş (TL)', group: 'Emtia', keywords: ['xag', 'silver', 'gumus'] },
  { symbol: 'GC=F', label: 'Altın Ons ($)', group: 'Emtia', keywords: ['xau', 'gold', 'altin', 'ons'] },
  { symbol: 'SI=F', label: 'Gümüş Ons ($)', group: 'Emtia', keywords: ['xag', 'silver', 'gumus', 'ons'] },
  { symbol: 'BZ=F', label: 'Brent Petrol ($)', group: 'Emtia', keywords: ['oil', 'petrol'] },
  { symbol: 'CL=F', label: 'WTI Petrol ($)', group: 'Emtia', keywords: ['oil', 'petrol', 'wti'] },
  { symbol: 'NG=F', label: 'Doğalgaz ($)', group: 'Emtia', keywords: ['gas', 'dogalgaz'] },
  { symbol: 'HG=F', label: 'Bakır ($)', group: 'Emtia', keywords: ['copper', 'bakir'] },
  { symbol: '^GSPC', label: 'S&P 500', group: 'Global', keywords: ['sp500', 'spx'] },
  { symbol: '^IXIC', label: 'Nasdaq', group: 'Global' },
  { symbol: '^GDAXI', label: 'DAX', group: 'Global' },
  { symbol: 'BTC-USD', label: 'Bitcoin ($)', group: 'Kripto', keywords: ['btc', 'kripto', 'crypto'] },
  { symbol: 'ETH-USD', label: 'Ethereum ($)', group: 'Kripto', keywords: ['eth', 'kripto', 'crypto'] },
  { symbol: 'SOL-USD', label: 'Solana ($)', group: 'Kripto', keywords: ['sol', 'kripto', 'crypto'] },
  { symbol: 'XRP-USD', label: 'Ripple ($)', group: 'Kripto', keywords: ['xrp', 'kripto', 'crypto'] },
];

/** Aksan ve Türkçe ı/i farklarını düzleştirerek arama eşleştirmesi yapar. */
export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .trim();
}

/** Katalog kaydının sorguyla eşleşip eşleşmediğini döndürür. */
export function presetMatchesQuery(preset: PresetSymbol, query: string): boolean {
  return (
    normalizeSearch(preset.label).includes(query) ||
    normalizeSearch(preset.symbol).includes(query) ||
    (preset.keywords ?? []).some(k => k.includes(query) || query.includes(k))
  );
}
