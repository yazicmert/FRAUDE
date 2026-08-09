/**
 * Kâr payı tutarının para birimi.
 *
 * Bir avuç şirket kâr payını lira dışında bir birimde açıklıyor ve KAP
 * bildiriminin "Para Birimi" alanı bunu söylüyor; o kayıtlarda tablodaki sayı
 * lira **değildir**. Yahoo Finance ise her zaman lira karşılığını taşır, yani
 * bu bilgi satırın kaynağına bağlı — tek bir yerde tanımlı olması gerekiyor.
 *
 * Alan eski kayıtlarda hiç bulunmaz; yokluğu lira demektir.
 */
export function isForeignDividendCurrency(currency?: string | null): boolean {
  const code = (currency ?? '').trim().toUpperCase();
  return code !== '' && code !== 'TRY' && code !== 'TL';
}

/** Tutarı kendi para biriminde yazar: `₺1,2500` ya da `2,5000 EUR`. */
export function formatDividendAmount(amount: number, currency?: string | null): string {
  const value = amount.toFixed(4);
  return isForeignDividendCurrency(currency)
    ? `${value} ${(currency ?? '').trim().toUpperCase()}`
    : `₺${value}`;
}
