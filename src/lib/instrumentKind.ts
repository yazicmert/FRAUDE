/**
 * Sembolün enstrüman türü — tek kaynak. Kurumsal bölümler (ortaklık yapısı,
 * KAP bildirimleri, iştirakler, temettü/bedelsiz, mali tablolar, İş Yatırım
 * fiyat kaynağı) yalnız BIST hisselerinde anlamlıdır; emtia/döviz/endeks/
 * kripto sayfaları bu türe göre otomatik sadeleşir.
 *
 * Yeni bir emtia eklerken ekstra iş gerekmez: sembol ya katalogda
 * (symbolCatalog, grup "Emtia") yer alır, ya backend "Emtialar" etiketi
 * taşır, ya da =F / boşluklu TL kotasyon ("GRAM ...") desenine uyar —
 * üç yol da burada yakalanır.
 */
import { PRESET_SYMBOLS } from '../components/symbolCatalog';
import { COMMODITY_GROUP, GLOBAL_GROUP } from './equityGroups';

export type InstrumentKind =
  | 'bist-equity'
  | 'bist-index'
  | 'commodity'
  | 'fx'
  | 'crypto'
  | 'global-equity'
  | 'global-index';

/** Katalog grubu → tür. Katalogda yeni bir grup açılırsa buraya eklenir. */
const GROUP_TO_KIND: Record<string, InstrumentKind> = {
  Endeks: 'bist-index',
  Döviz: 'fx',
  Emtia: 'commodity',
  Global: 'global-index',
  Kripto: 'crypto',
};

/** Backend index_memberships etiketi → tür (yahoo.rs ile aynı adlar). */
const MEMBERSHIP_TO_KIND: Record<string, InstrumentKind> = {
  [COMMODITY_GROUP]: 'commodity',
  [GLOBAL_GROUP]: 'global-equity',
};

const normalize = (symbol: string) => symbol.trim().toLocaleUpperCase('tr-TR');

/**
 * Sembolü sınıflandırır. Satırın backend etiketi (`memberships`) verilirse
 * desenden güvenilir olduğu için önce ona bakılır — ör. AAPL desen olarak
 * BIST koduna benzer, ayırt eden şey "Global" etiketidir.
 */
export function classifyInstrument(symbol: string, memberships?: string[] | null): InstrumentKind {
  for (const group of memberships ?? []) {
    const kind = MEMBERSHIP_TO_KIND[group];
    if (kind) return kind;
  }

  const upper = normalize(symbol);
  const preset = PRESET_SYMBOLS.find((item) => normalize(item.symbol) === upper);
  if (preset) {
    const kind = GROUP_TO_KIND[preset.group];
    if (kind) return kind;
  }

  // Katalogda olmayan semboller için Yahoo adlandırma desenleri.
  if (upper.endsWith('=F')) return 'commodity';
  if (upper.endsWith('=X')) return 'fx';
  if (upper.startsWith('^')) return 'global-index';
  if (/-(USD|USDT|TRY)$/.test(upper)) return 'crypto';
  // TL emtia kotasyonları boşluklu özel adlardır ("GRAM ALTIN"); BIST
  // kodlarında boşluk olmaz.
  if (upper.includes(' ')) return 'commodity';

  // Borsa İstanbul'da X ile başlayan kodlar endekslere ayrılmıştır.
  const bare = upper.replace(/\.IS$/, '');
  if (bare.startsWith('X')) return 'bist-index';
  return 'bist-equity';
}

/**
 * Kurumsal veri (KAP bildirimi, ortaklık yapısı, iştirakler, temettü,
 * bedelsiz, mali tablolar, İş Yatırım fiyat kaynağı) yalnız BIST
 * hisselerinde vardır; emtia/endeks/döviz/kripto bu bölümleri hiç
 * yüklemez ve göstermez.
 */
export function hasCorporateData(symbol: string, memberships?: string[] | null): boolean {
  return classifyInstrument(symbol, memberships) === 'bist-equity';
}
