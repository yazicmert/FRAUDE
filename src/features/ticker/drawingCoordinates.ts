import type { IChartApi, ISeriesApi, SeriesType, Time } from 'lightweight-charts';
import type { HistoricalQuote } from '../../types';
import type { DrawingPoint } from './drawingTypes';

/**
 * Veri uzayındaki (time, price) noktasını ekran koordinatlarına (x, y) dönüştürür.
 */
export function pointToScreen(
  point: DrawingPoint,
  chart: IChartApi | null,
  series: ISeriesApi<SeriesType> | null,
  sortedQuotes?: HistoricalQuote[]
): { x: number; y: number } | null {
  if (!chart || !series) return null;

  let x: number | null = chart.timeScale().timeToCoordinate(point.time as Time);

  // Eğer timeToCoordinate null döndüyse (ör. seans dışı veya aralık dışı),
  // sıralı veriden en yakın zamanı bularak x koordinatını tahmin et.
  if (x === null && sortedQuotes && sortedQuotes.length > 0) {
    const target = point.time;
    let closestQuote = sortedQuotes[0];
    let minDiff = Math.abs((closestQuote.time as number) - target);

    for (let i = 1; i < sortedQuotes.length; i++) {
      const diff = Math.abs((sortedQuotes[i].time as number) - target);
      if (diff < minDiff) {
        minDiff = diff;
        closestQuote = sortedQuotes[i];
      }
    }
    x = chart.timeScale().timeToCoordinate(closestQuote.time as Time);
  }

  const y: number | null = series.priceToCoordinate(point.price);

  if (x === null || y === null) return null;
  return { x, y };
}

/**
 * Ekrandaki (x, y) piksel noktasını veri uzayındaki (time, price) değerine dönüştürür.
 */
export function screenToPoint(
  x: number,
  y: number,
  chart: IChartApi | null,
  series: ISeriesApi<SeriesType> | null,
  sortedQuotes?: HistoricalQuote[],
  magnetEnabled = false
): DrawingPoint | null {
  if (!chart || !series) return null;

  const rawTime = chart.timeScale().coordinateToTime(x) as number | null;
  const rawPrice = series.coordinateToPrice(y);

  if (rawPrice === null || rawPrice === undefined) return null;

  let finalTime = rawTime;

  // Eğer zaman doğrudan çözülemediyse en yakın mumu bul
  if (finalTime === null && sortedQuotes && sortedQuotes.length > 0) {
    const logical = chart.timeScale().coordinateToLogical(x);
    if (logical !== null) {
      const idx = Math.max(0, Math.min(sortedQuotes.length - 1, Math.round(logical)));
      finalTime = sortedQuotes[idx].time as number;
    } else {
      finalTime = sortedQuotes[sortedQuotes.length - 1].time as number;
    }
  }

  if (finalTime === null) return null;

  // Mıknatıs (Magnet) Modu: En yakın mumun O, H, L, C seviyesine yapış
  if (magnetEnabled && sortedQuotes && sortedQuotes.length > 0) {
    let closestQuote = sortedQuotes[0];
    let minTimeDiff = Math.abs((closestQuote.time as number) - finalTime);

    for (let i = 1; i < sortedQuotes.length; i++) {
      const diff = Math.abs((sortedQuotes[i].time as number) - finalTime);
      if (diff < minTimeDiff) {
        minTimeDiff = diff;
        closestQuote = sortedQuotes[i];
      }
    }

    const levels = [
      closestQuote.open,
      closestQuote.high,
      closestQuote.low,
      closestQuote.close,
    ].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

    if (levels.length > 0) {
      let closestPrice = levels[0];
      let minPriceDiff = Math.abs(closestPrice - rawPrice);

      for (let i = 1; i < levels.length; i++) {
        const diff = Math.abs(levels[i] - rawPrice);
        if (diff < minPriceDiff) {
          minPriceDiff = diff;
          closestPrice = levels[i];
        }
      }

      return {
        time: closestQuote.time as number,
        price: closestPrice,
      };
    }
  }

  return {
    time: finalTime,
    price: rawPrice,
  };
}

/**
 * İki piksel noktası arasındaki Öklid mesafesi
 */
export function distanceBetween(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Bir noktanın doğru parçasına olan en kısa mesafesi
 */
export function distanceToSegment(
  p: { x: number; y: number },
  v: { x: number; y: number },
  w: { x: number; y: number }
): number {
  const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2;
  if (l2 === 0) return distanceBetween(p, v);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return distanceBetween(p, {
    x: v.x + t * (w.x - v.x),
    y: v.y + t * (w.y - v.y),
  });
}
