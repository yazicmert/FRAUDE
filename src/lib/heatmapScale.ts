/**
 * Isı haritalarının ortak çift kutuplu (diverging) renk skalası.
 *
 * Tek kaynak: MarketHeatmap ve IndexHeatmap daha önce iki farklı ad-hoc palet
 * kullanıyordu; üstelik bazı dolgular beyaz hücre etiketiyle 1.45:1'e kadar
 * düşen kontrast veriyordu. Buradaki adımların tamamı beyaz metinle ≥4.75:1
 * (WCAG AA) doğrulanmıştır; büyüklük arttıkça ton koyulaşır.
 *
 * Eşikler: ±0.5 nötr bant (gün içi gürültü renklendirilmez), ±3 güçlü hareket.
 */

/** Güçlü yükseliş (≥ +3%). Beyazla 6.6:1. */
const STRONG_UP = '#116b34';
/** Yükseliş (+0.5 … +3%). Beyazla 4.75:1. */
const UP = '#25834a';
/** Nötr bant (±0.5%). Beyazla 8.4:1. */
const NEUTRAL = '#454e59';
/** Düşüş (−0.5 … −3%). Beyazla 5.7:1. */
const DOWN = '#b3403b';
/** Güçlü düşüş (≤ −3%). Beyazla 9.1:1. */
const STRONG_DOWN = '#8a1f1f';

/** Günlük değişim yüzdesini hücre dolgu rengine çevirir. */
export function changeColor(pct: number): string {
  if (!Number.isFinite(pct)) return NEUTRAL;
  if (pct >= 3) return STRONG_UP;
  if (pct > 0.5) return UP;
  if (pct >= -0.5) return NEUTRAL;
  if (pct > -3) return DOWN;
  return STRONG_DOWN;
}
