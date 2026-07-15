import { useEffect, useRef, useState } from 'react';
import { AreaSeries, CandlestickSeries, ColorType, createChart, HistogramSeries, LineSeries, PriceScaleMode, type Time } from 'lightweight-charts';
import type { HistoricalQuote } from '../../types';

interface PriceChartProps {
  ticker: string;
  data: HistoricalQuote[];
  range?: string;
}

type ChartKind = 'candles' | 'line' | 'area';

interface Point { time: Time; value: number }

function calculateSMA(data: Point[], count: number): Point[] {
  const result: Point[] = [];
  for (let i = count - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < count; j++) sum += data[i - j].value;
    result.push({ time: data[i].time, value: sum / count });
  }
  return result;
}

function calculateEMA(data: Point[], count: number): Point[] {
  if (data.length < count) return [];
  const k = 2 / (count + 1);
  const result: Point[] = [];
  let ema = data.slice(0, count).reduce((s, p) => s + p.value, 0) / count;
  result.push({ time: data[count - 1].time, value: ema });
  for (let i = count; i < data.length; i++) {
    ema = data[i].value * k + ema * (1 - k);
    result.push({ time: data[i].time, value: ema });
  }
  return result;
}

function calculateRSI(data: Point[], period = 14): Point[] {
  if (data.length <= period) return [];
  const result: Point[] = [];
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = data[i].value - data[i - 1].value;
    if (diff >= 0) gain += diff; else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  result.push({ time: data[period].time, value: avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss) });
  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i].value - data[i - 1].value;
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    result.push({ time: data[i].time, value: avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss) });
  }
  return result;
}

function calculateMACD(data: Point[]): { macd: Point[]; signal: Point[]; hist: Point[] } {
  const ema12 = calculateEMA(data, 12);
  const ema26 = calculateEMA(data, 26);
  const macd: Point[] = [];
  const byTime = new Map(ema12.map((p) => [p.time as number, p.value]));
  for (const p of ema26) {
    const fast = byTime.get(p.time as number);
    if (fast !== undefined) macd.push({ time: p.time, value: fast - p.value });
  }
  const signal = calculateEMA(macd, 9);
  const signalByTime = new Map(signal.map((p) => [p.time as number, p.value]));
  const hist: Point[] = [];
  for (const p of macd) {
    const s = signalByTime.get(p.time as number);
    if (s !== undefined) hist.push({ time: p.time, value: p.value - s });
  }
  return { macd, signal, hist };
}

function calculateBollinger(data: Point[], period = 20, mult = 2): { upper: Point[]; middle: Point[]; lower: Point[] } {
  const upper: Point[] = [];
  const middle: Point[] = [];
  const lower: Point[] = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += data[i - j].value;
    const mean = sum / period;
    let variance = 0;
    for (let j = 0; j < period; j++) {
      const d = data[i - j].value - mean;
      variance += d * d;
    }
    const sd = Math.sqrt(variance / period);
    middle.push({ time: data[i].time, value: mean });
    upper.push({ time: data[i].time, value: mean + mult * sd });
    lower.push({ time: data[i].time, value: mean - mult * sd });
  }
  return { upper, middle, lower };
}

const toggleStyle = (active: boolean): React.CSSProperties => ({
  padding: '3px 9px',
  fontSize: '0.7rem',
  fontFamily: 'var(--font-mono)',
  background: active ? '#1f6feb33' : 'transparent',
  color: active ? '#58a6ff' : '#8b949e',
  border: `1px solid ${active ? '#1f6feb66' : '#30363d'}`,
  borderRadius: '4px',
  cursor: 'pointer',
});

export default function PriceChart({ ticker, data, range = '6mo' }: PriceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);

  const [kind, setKind] = useState<ChartKind>('candles');
  const [showSMA20, setShowSMA20] = useState(true);
  const [showSMA50, setShowSMA50] = useState(true);
  const [showEMA20, setShowEMA20] = useState(false);
  const [showBB, setShowBB] = useState(false);
  const [showVolume, setShowVolume] = useState(true);
  const [showRSI, setShowRSI] = useState(false);
  const [showMACD, setShowMACD] = useState(false);
  const [logScale, setLogScale] = useState(false);

  const baseHeight = 400;
  const paneHeight = 110;
  const totalHeight = baseHeight + (showRSI ? paneHeight : 0) + (showMACD ? paneHeight : 0);

  useEffect(() => {
    if (!chartContainerRef.current || data.length === 0) return;
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#161b22' },
        textColor: '#c9d1d9',
        panes: { separatorColor: '#30363d', separatorHoverColor: '#58a6ff55', enableResize: true },
      },
      grid: { vertLines: { color: '#30363d' }, horzLines: { color: '#30363d' } },
      width: chartContainerRef.current.clientWidth,
      height: totalHeight,
      timeScale: {
        borderColor: '#30363d',
        timeVisible: false,
        secondsVisible: false,
        minBarSpacing: 0.05,
      },
      rightPriceScale: {
        borderColor: '#30363d',
        mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
      },
    });

    const chartData = data
      .map((item) => ({
        time: item.time as Time, open: item.open, high: item.high, low: item.low, close: item.close, volume: item.volume,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));

    const closeData: Point[] = chartData.map((item) => ({ time: item.time, value: item.close }));
    const closeOnly = chartData.every((item) => item.open === item.high && item.high === item.low && item.low === item.close);
    const effectiveKind: ChartKind = closeOnly && kind === 'candles' ? 'line' : kind;

    // Hacim (ana panelde alt bant)
    let volumeSeries: ReturnType<typeof chart.addSeries> | null = null;
    if (showVolume) {
      volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: '',
      });
      volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      volumeSeries.setData(chartData.map((item) => ({
        time: item.time,
        value: item.volume,
        color: item.close >= item.open ? 'rgba(63, 185, 80, 0.45)' : 'rgba(248, 81, 73, 0.45)',
      })));
    }

    // Ana seri
    let activeSeries: any;
    if (effectiveKind === 'candles') {
      activeSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#3fb950', downColor: '#f85149', borderVisible: false,
        wickUpColor: '#3fb950', wickDownColor: '#f85149',
      });
      activeSeries.setData(chartData);
    } else if (effectiveKind === 'area') {
      activeSeries = chart.addSeries(AreaSeries, {
        lineColor: '#58a6ff', lineWidth: 2,
        topColor: 'rgba(88, 166, 255, 0.30)', bottomColor: 'rgba(88, 166, 255, 0.02)',
      });
      activeSeries.setData(closeData);
    } else {
      activeSeries = chart.addSeries(LineSeries, { color: '#58a6ff', lineWidth: 2 });
      activeSeries.setData(closeData);
    }

    // Hareketli ortalamalar
    if (showSMA20) {
      const s = chart.addSeries(LineSeries, { color: 'rgba(255, 215, 0, 0.75)', lineWidth: 1, title: 'SMA 20', priceLineVisible: false, lastValueVisible: false });
      s.setData(calculateSMA(closeData, 20));
    }
    if (showSMA50) {
      const s = chart.addSeries(LineSeries, { color: 'rgba(186, 104, 255, 0.75)', lineWidth: 1, title: 'SMA 50', priceLineVisible: false, lastValueVisible: false });
      s.setData(calculateSMA(closeData, 50));
    }
    if (showEMA20) {
      const s = chart.addSeries(LineSeries, { color: 'rgba(0, 200, 255, 0.85)', lineWidth: 1, title: 'EMA 20', priceLineVisible: false, lastValueVisible: false });
      s.setData(calculateEMA(closeData, 20));
    }
    // Bollinger Bantları (20, 2)
    if (showBB) {
      const { upper, middle, lower } = calculateBollinger(closeData, 20, 2);
      const bandColor = 'rgba(130, 170, 255, 0.55)';
      const up = chart.addSeries(LineSeries, { color: bandColor, lineWidth: 1, lineStyle: 2, title: 'BB Üst', priceLineVisible: false, lastValueVisible: false });
      up.setData(upper);
      const lo = chart.addSeries(LineSeries, { color: bandColor, lineWidth: 1, lineStyle: 2, title: 'BB Alt', priceLineVisible: false, lastValueVisible: false });
      lo.setData(lower);
      const mid = chart.addSeries(LineSeries, { color: 'rgba(130, 170, 255, 0.3)', lineWidth: 1, title: 'BB Orta', priceLineVisible: false, lastValueVisible: false });
      mid.setData(middle);
    }

    // Alt paneller: RSI ve MACD
    let paneIndex = 0;
    let rsiSeries: any = null;
    if (showRSI) {
      paneIndex += 1;
      rsiSeries = chart.addSeries(LineSeries, {
        color: '#f0883e', lineWidth: 2, title: 'RSI 14',
        priceLineVisible: false, lastValueVisible: true,
      }, paneIndex);
      rsiSeries.setData(calculateRSI(closeData, 14));
      // 30/70 seviye çizgileri
      rsiSeries.createPriceLine({ price: 70, color: '#f8514966', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
      rsiSeries.createPriceLine({ price: 30, color: '#3fb95066', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
    }
    if (showMACD) {
      paneIndex += 1;
      const { macd, signal, hist } = calculateMACD(closeData);
      const histSeries = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, paneIndex);
      histSeries.setData(hist.map((p) => ({ ...p, color: p.value >= 0 ? 'rgba(63, 185, 80, 0.5)' : 'rgba(248, 81, 73, 0.5)' })));
      const macdSeries = chart.addSeries(LineSeries, { color: '#58a6ff', lineWidth: 1, title: 'MACD', priceLineVisible: false, lastValueVisible: false }, paneIndex);
      macdSeries.setData(macd);
      const sigSeries = chart.addSeries(LineSeries, { color: '#f0883e', lineWidth: 1, title: 'Sinyal', priceLineVisible: false, lastValueVisible: false }, paneIndex);
      sigSeries.setData(signal);
    }

    // Panel yükseklikleri
    const panes = chart.panes();
    if (panes.length > 1) {
      panes[0].setHeight(baseHeight - 40);
      for (let i = 1; i < panes.length; i++) panes[i].setHeight(paneHeight);
    }

    if (range === 'max') {
      chart.timeScale().fitContent();
    } else {
      const barsByRange: Record<string, number> = { '1mo': 22, '3mo': 65, '6mo': 130, '1y': 250, '5y': 1250 };
      const barsToShow = Math.min(chartData.length, barsByRange[range] ?? chartData.length);
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, chartData.length - barsToShow), to: Math.max(0, chartData.length - 1),
      });
    }

    // Önceki kapanışa göre değişim için hızlı erişim
    const prevCloseByTime = new Map<number, number>();
    for (let i = 1; i < chartData.length; i++) {
      prevCloseByTime.set(chartData[i].time as number, chartData[i - 1].close);
    }

    chart.subscribeCrosshairMove((param) => {
      if (!legendRef.current) return;
      if (
        param.point === undefined || !param.time ||
        param.point.x < 0 || param.point.x > chartContainerRef.current!.clientWidth ||
        param.point.y < 0 || param.point.y > chartContainerRef.current!.clientHeight
      ) {
        legendRef.current.style.display = 'none';
        return;
      }
      const dataPoint = param.seriesData.get(activeSeries) as any;
      const volPoint = volumeSeries ? (param.seriesData.get(volumeSeries) as any) : null;
      const rsiPoint = rsiSeries ? (param.seriesData.get(rsiSeries) as any) : null;
      if (!dataPoint) return;

      const dateStr = new Date((param.time as number) * 1000).toLocaleDateString('tr-TR');
      let html = `<div style="font-size: 13px; font-weight: bold; margin-bottom: 4px; color: #fff;">${dateStr} · ${ticker}</div>`;

      const close = dataPoint.value !== undefined ? dataPoint.value : dataPoint.close;
      const prev = prevCloseByTime.get(param.time as number);
      const changePct = prev ? ((close - prev) / prev) * 100 : null;
      const changeHtml = changePct !== null
        ? ` <span style="color: ${changePct >= 0 ? '#3fb950' : '#f85149'};">(${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)</span>`
        : '';

      if (dataPoint.value !== undefined) {
        html += `<div style="color: #c9d1d9;">Kapanış: <span style="font-weight: bold; color: #fff;">${close.toFixed(2)}</span>${changeHtml}</div>`;
      } else {
        const color = dataPoint.close >= dataPoint.open ? '#3fb950' : '#f85149';
        html += `
          <div style="display: grid; grid-template-columns: auto auto; gap: 4px 12px; color: #c9d1d9; font-size: 12px;">
            <div>Açılış: <span style="font-weight: bold; color: ${color};">${dataPoint.open.toFixed(2)}</span></div>
            <div>Yüksek: <span style="font-weight: bold; color: #fff;">${dataPoint.high.toFixed(2)}</span></div>
            <div>Kapanış: <span style="font-weight: bold; color: ${color};">${dataPoint.close.toFixed(2)}</span>${changeHtml}</div>
            <div>Düşük: <span style="font-weight: bold; color: #fff;">${dataPoint.low.toFixed(2)}</span></div>
          </div>`;
      }
      if (volPoint && volPoint.value) {
        const vol = volPoint.value;
        const formattedVol = vol > 1000000 ? (vol / 1000000).toFixed(2) + 'M' : vol > 1000 ? (vol / 1000).toFixed(1) + 'K' : String(vol);
        html += `<div style="margin-top: 4px; font-size: 12px; color: #8b949e;">Hacim: <span style="color: #c9d1d9;">${formattedVol}</span></div>`;
      }
      if (rsiPoint && rsiPoint.value !== undefined) {
        const rsiColor = rsiPoint.value > 70 ? '#f85149' : rsiPoint.value < 30 ? '#3fb950' : '#c9d1d9';
        html += `<div style="font-size: 12px; color: #8b949e;">RSI: <span style="color: ${rsiColor}; font-weight: bold;">${rsiPoint.value.toFixed(1)}</span></div>`;
      }
      legendRef.current.innerHTML = html;
      legendRef.current.style.display = 'block';
    });

    const handleResize = () => {
      if (chartContainerRef.current) chart.applyOptions({ width: chartContainerRef.current.clientWidth });
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [data, ticker, range, kind, showSMA20, showSMA50, showEMA20, showBB, showVolume, showRSI, showMACD, logScale, totalHeight]);

  return (
    <div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '4px', marginRight: '10px' }}>
          {(['candles', 'line', 'area'] as const).map((k) => (
            <button key={k} type="button" style={toggleStyle(kind === k)} onClick={() => setKind(k)}>
              {k === 'candles' ? 'Mum' : k === 'line' ? 'Çizgi' : 'Alan'}
            </button>
          ))}
        </div>
        <button type="button" style={toggleStyle(showSMA20)} onClick={() => setShowSMA20(!showSMA20)}>SMA 20</button>
        <button type="button" style={toggleStyle(showSMA50)} onClick={() => setShowSMA50(!showSMA50)}>SMA 50</button>
        <button type="button" style={toggleStyle(showEMA20)} onClick={() => setShowEMA20(!showEMA20)}>EMA 20</button>
        <button type="button" style={toggleStyle(showBB)} onClick={() => setShowBB(!showBB)} title="Bollinger Bantları (20, 2)">BB</button>
        <button type="button" style={toggleStyle(showVolume)} onClick={() => setShowVolume(!showVolume)}>Hacim</button>
        <button type="button" style={toggleStyle(showRSI)} onClick={() => setShowRSI(!showRSI)}>RSI</button>
        <button type="button" style={toggleStyle(showMACD)} onClick={() => setShowMACD(!showMACD)}>MACD</button>
        <button type="button" style={toggleStyle(logScale)} onClick={() => setLogScale(!logScale)} title="Logaritmik fiyat ölçeği">Log</button>
      </div>
      <div style={{ position: 'relative', width: '100%', height: totalHeight }}>
        <div
          ref={legendRef}
          style={{
            position: 'absolute',
            top: '12px',
            left: '12px',
            zIndex: 10,
            background: 'rgba(22, 27, 34, 0.90)',
            border: '1px solid #30363d',
            padding: '10px 14px',
            borderRadius: '6px',
            color: '#c9d1d9',
            display: 'none',
            pointerEvents: 'none',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            minWidth: '150px',
          }}
        />
        <div ref={chartContainerRef} style={{ width: '100%', height: '100%', border: '1px solid #30363d', borderRadius: 4, overflow: 'hidden' }} />
      </div>
    </div>
  );
}
