import type { IChartApi, ISeriesApi, SeriesType, Time } from 'lightweight-charts';
import type { HistoricalQuote } from '../../types';
import type { DrawingPoint } from './drawingTypes';

/**
 * Fiyat ölçeği görünür sınırlarını ve ana panel yüksekliğini alır.
 */
function getPriceScaleMetrics(
  series: ISeriesApi<SeriesType> | null,
  sortedQuotes?: HistoricalQuote[]
): { minPrice: number; maxPrice: number; paneHeight: number } | null {
  if (!series) return null;

  try {
    const visibleRange = series.priceScale().getVisibleRange();
    let paneHeight = 440;
    try {
      const h = series.getPane().getHeight();
      if (typeof h === 'number' && h > 0) paneHeight = h;
    } catch {
      // fallback
    }

    if (visibleRange && Number.isFinite(visibleRange.from) && Number.isFinite(visibleRange.to)) {
      const minPrice = Math.min(visibleRange.from, visibleRange.to);
      const maxPrice = Math.max(visibleRange.from, visibleRange.to);
      if (maxPrice > minPrice) {
        return { minPrice, maxPrice, paneHeight };
      }
    }
  } catch {
    // getVisibleRange fail safe
  }

  // Fallback: quotes üzerinden min / max fiyat
  if (sortedQuotes && sortedQuotes.length > 0) {
    let minP = Infinity;
    let maxP = -Infinity;
    for (const q of sortedQuotes) {
      if (q.low < minP) minP = q.low;
      if (q.high > maxP) maxP = q.high;
    }
    if (Number.isFinite(minP) && Number.isFinite(maxP) && maxP > minP) {
      const padding = (maxP - minP) * 0.08;
      return { minPrice: minP - padding, maxPrice: maxP + padding, paneHeight: 440 };
    }
  }

  return null;
}

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

  // 1. X Koordinatı (Zaman -> Piksel)
  let x: number | null = chart.timeScale().timeToCoordinate(point.time as Time);

  if ((x === null || Number.isNaN(x)) && sortedQuotes && sortedQuotes.length > 0) {
    const targetTime = point.time;
    let bestIdx = 0;
    let minDiff = Math.abs((sortedQuotes[0].time as number) - targetTime);

    for (let i = 1; i < sortedQuotes.length; i++) {
      const diff = Math.abs((sortedQuotes[i].time as number) - targetTime);
      if (diff < minDiff) {
        minDiff = diff;
        bestIdx = i;
      }
    }

    const logicalCoord = chart.timeScale().logicalToCoordinate(bestIdx as any);
    if (logicalCoord !== null && Number.isFinite(logicalCoord)) {
      x = logicalCoord;
    }
  }

  // 2. Y Koordinatı (Fiyat -> Piksel)
  const metrics = getPriceScaleMetrics(series, sortedQuotes);
  let y: number | null = null;

  if (metrics) {
    const { minPrice, maxPrice, paneHeight } = metrics;
    y = ((maxPrice - point.price) / (maxPrice - minPrice)) * paneHeight;
  }

  if (x === null || y === null || Number.isNaN(x) || Number.isNaN(y)) {
    return null;
  }

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

  // 1. Fiyat Hesaplama
  const metrics = getPriceScaleMetrics(series, sortedQuotes);
  if (!metrics) return null;

  const { minPrice, maxPrice, paneHeight } = metrics;
  let rawPrice = maxPrice - (y / paneHeight) * (maxPrice - minPrice);

  if (!Number.isFinite(rawPrice)) {
    return null;
  }

  // 2. Zaman Hesaplama
  let finalTime: number | null = null;
  const rawTime = chart.timeScale().coordinateToTime(x) as number | null;

  if (typeof rawTime === 'number' && Number.isFinite(rawTime)) {
    finalTime = rawTime;
  } else if (sortedQuotes && sortedQuotes.length > 0) {
    const logical = chart.timeScale().coordinateToLogical(x);
    if (logical !== null && Number.isFinite(logical)) {
      const idx = Math.max(0, Math.min(sortedQuotes.length - 1, Math.round(logical)));
      finalTime = sortedQuotes[idx].time as number;
    } else {
      finalTime = sortedQuotes[sortedQuotes.length - 1].time as number;
    }
  }

  if (finalTime === null || !Number.isFinite(finalTime)) {
    return null;
  }

  // 3. Mıknatıs (Magnet) Modu: En yakın mumun O, H, L, C seviyesine yapış
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
