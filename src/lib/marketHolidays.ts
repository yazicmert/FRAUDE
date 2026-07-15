// Borsa İstanbul pay piyasasının kapalı olduğu resmi tatiller (Europe/Istanbul).
// Sabit tarihli ulusal bayramlar her yıl aynı ay-gün olduğundan koddan
// hesaplanır ve güncelleme gerektirmez. Dini bayramlar (Ramazan/Kurban) hicri
// takvimle her yıl ~11 gün kaydığından yıl bazında açık listelenir.
//
// ⚠️ Dini bayram tarihleri BIST'in resmi tatil takvimiyle DOĞRULANMALI ve her
// yıl güncellenmelidir; aşağıdaki tarihler en iyi tahmindir. Sabit ulusal
// bayramlar kesindir. Yarım gün seanslar (arife öğleden sonra, 28 Ekim) burada
// tam tatil sayılmaz; ileride ayrı ele alınabilir.

// Ay-gün (MM-DD) → bayram adı. Her yıl geçerli sabit ulusal bayramlar.
const FIXED_HOLIDAYS: Record<string, string> = {
  '01-01': 'Yılbaşı',
  '04-23': 'Ulusal Egemenlik ve Çocuk Bayramı',
  '05-01': 'Emek ve Dayanışma Günü',
  '05-19': "Atatürk'ü Anma, Gençlik ve Spor Bayramı",
  '07-15': 'Demokrasi ve Milli Birlik Günü',
  '08-30': 'Zafer Bayramı',
  '10-29': 'Cumhuriyet Bayramı',
};

// Tam tarih (YYYY-MM-DD) → bayram adı. Dini bayramların tam kapanış günleri.
// ⚠️ BIST resmi takvimiyle doğrulanmalı.
const RELIGIOUS_HOLIDAYS: Record<string, string> = {
  // 2025 Ramazan Bayramı (arife 29.03 yarım) · 30.03 Pazar
  '2025-03-31': 'Ramazan Bayramı', '2025-04-01': 'Ramazan Bayramı',
  // 2025 Kurban Bayramı (arife 05.06 yarım) · 07-08 hafta sonu
  '2025-06-06': 'Kurban Bayramı', '2025-06-07': 'Kurban Bayramı',
  '2025-06-08': 'Kurban Bayramı', '2025-06-09': 'Kurban Bayramı',
  // 2026 Ramazan Bayramı (arife 19.03 yarım) · 21-22 hafta sonu
  '2026-03-20': 'Ramazan Bayramı', '2026-03-21': 'Ramazan Bayramı', '2026-03-22': 'Ramazan Bayramı',
  // 2026 Kurban Bayramı (arife 26.05 yarım) · 30.05 Cumartesi
  '2026-05-27': 'Kurban Bayramı', '2026-05-28': 'Kurban Bayramı',
  '2026-05-29': 'Kurban Bayramı', '2026-05-30': 'Kurban Bayramı',
  // 2027 Ramazan Bayramı (arife 09.03 yarım)
  '2027-03-10': 'Ramazan Bayramı', '2027-03-11': 'Ramazan Bayramı', '2027-03-12': 'Ramazan Bayramı',
  // 2027 Kurban Bayramı (arife 15.05 yarım)
  '2027-05-16': 'Kurban Bayramı', '2027-05-17': 'Kurban Bayramı',
  '2027-05-18': 'Kurban Bayramı', '2027-05-19': 'Kurban Bayramı',
};

// Sağlam kaynaktan (Nager.Date, Rust get_market_holidays) çekilen tam tarihli
// tatiller. Uygulama açılışında doldurulur ve localStorage'a yazılır; böylece
// sonraki açılışlarda (fetch tamamlanmadan) ve çevrimdışıyken de kullanılır.
// Bu liste hem sabit hem dini bayramları doğru tarihlerle içerir ve gömülü
// tahmini listenin önüne geçer.
const FETCHED_KEY = 'fraude-bist-holidays';
let fetchedHolidays: Record<string, string> | null = readFetchedFromStorage();

function readFetchedFromStorage(): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(FETCHED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Sağlam kaynaktan çekilen tatilleri yerleştirir (Rust `get_market_holidays`).
 * Çekilen liste hem canlı kullanılır hem localStorage'a yazılır.
 */
export function setFetchedHolidays(list: { date: string; name: string }[]): void {
  if (!list.length) return;
  const map: Record<string, string> = {};
  for (const h of list) if (h.date && h.name) map[h.date] = h.name;
  fetchedHolidays = map;
  try {
    localStorage.setItem(FETCHED_KEY, JSON.stringify(map));
  } catch {
    /* kota/erişim yoksa yok say */
  }
}

/**
 * Verilen Europe/Istanbul tarihinin (YYYY-MM-DD) resmi tatil olup olmadığını
 * döndürür: tatilse bayram adı, değilse null. Önce sağlam kaynaktan çekilen
 * liste, sonra gömülü yedek (dini + sabit) kullanılır. Hafta sonu buraya dahil
 * değildir (o kontrol seans saatleri tarafında yapılır).
 */
export function bistHolidayName(isoDate: string): string | null {
  const fetched = fetchedHolidays?.[isoDate];
  if (fetched) return fetched;
  const religious = RELIGIOUS_HOLIDAYS[isoDate];
  if (religious) return religious;
  const mmdd = isoDate.slice(5); // 'YYYY-MM-DD' → 'MM-DD'
  return FIXED_HOLIDAYS[mmdd] ?? null;
}
