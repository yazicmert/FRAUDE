// Borsa İstanbul (pay piyasası) seans durumu. Kullanıcının saat dilimi ne
// olursa olsun Europe/Istanbul yerel saatine göre hesaplanır. Sürekli işlem
// yaklaşık 10:00–18:00 (Pzt–Cum) kabul edilir; açılış/kapanış seans detayları
// basitleştirilmiştir.

import { bistHolidayName } from './marketHolidays';

export type MarketState = 'open' | 'pre' | 'closed';

export interface MarketStatus {
  state: MarketState;
  label: string;
  /** Europe/Istanbul yerel "HH:MM" biçiminde şu anki saat. */
  istanbulTime: string;
  color: string;
}

const OPEN_MINUTE = 10 * 60; // 10:00
const CLOSE_MINUTE = 18 * 60; // 18:00
const PRE_OPEN_MINUTE = 9 * 60 + 40; // 09:40 açılış öncesi emir toplama

// Europe/Istanbul için gün (0=Paz..6=Cmt) ve dakika (0..1439) bileşenlerini
// güvenilir biçimde çıkarır.
function istanbulParts(now: Date): { weekday: number; minutes: number; hhmm: string; isoDate: string } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Istanbul',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdayMap[get('weekday')] ?? 1;
  let hour = parseInt(get('hour'), 10);
  const minute = parseInt(get('minute'), 10);
  if (hour === 24) hour = 0; // bazı ortamlar 24:00 döndürür
  const hhmm = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const isoDate = `${get('year')}-${get('month')}-${get('day')}`;
  return { weekday, minutes: hour * 60 + minute, hhmm, isoDate };
}

export function getMarketStatus(now: Date = new Date()): MarketStatus {
  const { weekday, minutes, hhmm, isoDate } = istanbulParts(now);

  // Resmi tatiller hafta içi olsa bile piyasa kapalıdır; saat kontrolünden önce bakılır.
  const holiday = bistHolidayName(isoDate);
  if (holiday) {
    return { state: 'closed', label: `Piyasa Kapalı · ${holiday}`, istanbulTime: hhmm, color: '#8b949e' };
  }

  const isWeekday = weekday >= 1 && weekday <= 5;

  if (isWeekday && minutes >= OPEN_MINUTE && minutes < CLOSE_MINUTE) {
    return { state: 'open', label: 'Piyasa Açık', istanbulTime: hhmm, color: '#3fb950' };
  }
  if (isWeekday && minutes >= PRE_OPEN_MINUTE && minutes < OPEN_MINUTE) {
    return { state: 'pre', label: 'Açılış Öncesi', istanbulTime: hhmm, color: '#d29922' };
  }
  return { state: 'closed', label: 'Piyasa Kapalı', istanbulTime: hhmm, color: '#8b949e' };
}
