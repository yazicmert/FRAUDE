import { useEffect, useRef, useState } from 'react';
import { getLiveQuotes, type LiveQuote } from '../api/tauriClient';
import { isDataRuntimeConfigured } from '../api/platformClient';
import { getMarketStatus } from '../lib/marketHours';
import { classifyInstrument } from '../lib/instrumentKind';

/**
 * Ekranda görünen sembollerin yönlendirilmiş sağlayıcı fiyatlarını periyodik
 * tazeler. BIST paylarında sağlayıcının yaklaşık 15 dakikalık gecikmesi vardır.
 *
 * Ağır pano anlık görüntüsünden (haberler, KAP, temel veriler, göstergeler)
 * bilerek ayrıdır: yalnızca fiyat çeker, yalnızca fiyat gösteren bileşenleri
 * yeniden çizer. Böylece fiyat saniyeler mertebesinde akarken sayfanın geri
 * kalanı yerinde kalır.
 *
 * Yalnızca BIST paylarından oluşan bir kümede BIST seansı kapalıyken yoklama
 * durur. Kripto, global piyasa ve vadeli emtia BIST saatine bağlı değildir.
 */
export function useLiveQuotes(tickers: string[], intervalMs = 15_000): Map<string, LiveQuote> {
  const [quotes, setQuotes] = useState<Map<string, LiveQuote>>(new Map());

  // Sembol listesi her render'da yeni dizi olarak gelse bile efekt yeniden
  // kurulmasın; yalnızca içerik değiştiğinde tetiklensin.
  const key = tickers.join(',');
  const tickersRef = useRef(tickers);
  tickersRef.current = tickers;

  useEffect(() => {
    if (!isDataRuntimeConfigured()) return;
    const symbols = tickersRef.current;
    if (symbols.length === 0) return;
    const onlyBistEquities = symbols.every(
      (symbol) => classifyInstrument(symbol) === 'bist-equity',
    );

    let cancelled = false;

    const poll = async () => {
      // Seans kapalıyken fiyat sabit; sağlayıcıyı yormaya gerek yok.
      if (onlyBistEquities && getMarketStatus().state === 'closed') return;
      try {
        const rows = await getLiveQuotes(symbols);
        if (cancelled || rows.length === 0) return;
        setQuotes((current) => {
          const next = new Map(current);
          for (const row of rows) next.set(row.ticker, row);
          return next;
        });
      } catch {
        // Tek bir hatada eldeki fiyatlar korunur; ekran boşalmaz.
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [key, intervalMs]);

  return quotes;
}
