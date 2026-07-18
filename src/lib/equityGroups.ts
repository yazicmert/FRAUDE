import type { EquityRow } from '../types';

/**
 * BIST evrenine ait olmayan grup etiketleri. Backend karşılıkları: yahoo.rs
 * `GLOBAL_GROUP` ("Global" — ABD/küresel hisseler) ve emtia/döviz satırlarının
 * "Emtialar" etiketi. BIST'e özel listeler (yükselen/düşen, risk radarı,
 * bülten, şerit) bu etiketleri taşıyan satırlar olmadan kurulur.
 */
export const GLOBAL_GROUP = 'Global';
export const COMMODITY_GROUP = 'Emtialar';
export const NON_BIST_GROUPS = [GLOBAL_GROUP, COMMODITY_GROUP];

/** Satır BIST evrenine mi ait? Etiketsiz satırlar BIST sayılır. */
export function isBistEquity(row: Pick<EquityRow, 'index_memberships'>): boolean {
  return !(row.index_memberships ?? []).some((group) => NON_BIST_GROUPS.includes(group));
}
