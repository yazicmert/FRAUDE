import { useEffect, useRef, useState } from 'react';
import { AreaSeries, CandlestickSeries, ColorType, createChart, HistogramSeries, LineSeries, PriceScaleMode, type IChartApi, type ISeriesApi, type SeriesType, type Time } from 'lightweight-charts';
// Grafik kurulumu efekt bağımlılıklarına t eklenirse her render'da yeniden
// çizilirdi; bu yüzden i18next örneği doğrudan kullanılır.
import i18n from '../../i18n';
import type { HistoricalQuote } from '../../types';
import { useChartDrawings } from '../../hooks/useChartDrawings';
import ChartDrawingToolbar from './ChartDrawingToolbar';
import ChartDrawingOverlay from './ChartDrawingOverlay';
import DrawingManagerModal from './DrawingManagerModal';
import DrawingAlertModal from './DrawingAlertModal';
import { useAlerts } from '../alerts/useAlerts';
import type { DrawingItem } from './drawingTypes';

interface PriceChartProps {
  ticker: string;
  data: HistoricalQuote[];
  range?: string;
  /** Gecikmeli canlı fiyat; verilirse son bar yerinde güncellenir. */
  livePrice?: number | null;
}

type ChartKind = 'candles' | 'line' | 'area';

/** Aralık butonu → görünür pencere (saniye). 'max' ve bilinmeyenler tam sığdırır. */
const RANGE_SECONDS: Record<string, number> = {
  '1mo': 31 * 86_400,
  '3mo': 93 * 86_400,
  '6mo': 186 * 86_400,
  '1y': 366 * 86_400,
  '5y': 1_826 * 86_400,
};

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
    result.push({ time: data[period].time, value: avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss) });
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

export default function PriceChart({ ticker, data, range = '6mo', livePrice }: PriceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const activeSeriesRef = useRef<any>(null);
  const lastBarRef = useRef<{ time: Time; open: number; high: number; low: number; close: number } | null>(null);
  const kindRef = useRef<ChartKind>('candles');

  const [chartApi, setChartApi] = useState<IChartApi | null>(null);
  const [activeSeriesApi, setActiveSeriesApi] = useState<ISeriesApi<SeriesType> | null>(null);
  const [chartWidth, setChartWidth] = useState<number>(800);
  const [showDrawingTools, setShowDrawingTools] = useState<boolean>(true);
  const [showDrawingManager, setShowDrawingManager] = useState<boolean>(false);
  const [alertModalDrawing, setAlertModalDrawing] = useState<DrawingItem | null>(null);

  const { addRule } = useAlerts();

  const [kind, setKind] = useState<ChartKind>('candles');
  const [showSMA20, setShowSMA20] = useState(true);
  const [showSMA50, setShowSMA50] = useState(true);
  const [showEMA20, setShowEMA20] = useState(false);
  const [showBB, setShowBB] = useState(false);
  const [showVolume, setShowVolume] = useState(true);
  const [showRSI, setShowRSI] = useState(false);
  const [showMACD, setShowMACD] = useState(false);
  const [logScale, setLogScale] = useState(false);

  const {
    drawings,
    selectedId,
    setSelectedId,
    settings: drawingSettings,
    setActiveTool,
    toggleMagnet,
    toggleVisibility,
    setColor,
    setLineWidth,
    setLineStyle,
    addDrawing,
    updateDrawing,
    deleteDrawing,
    clearDrawings,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useChartDrawings(ticker);

  const baseHeight = 440;
  const paneHeight = 90;
  const totalHeight = baseHeight + (showRSI ? paneHeight : 0) + (showMACD ? paneHeight : 0);

  useEffect(() => {
    if (!chartContainerRef.current || data.length === 0) return;
    const initialWidth = chartContainerRef.current.clientWidth || 800;
    setChartWidth(initialWidth);

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#161b22' },
        textColor: '#c9d1d9',
        panes: { separatorColor: '#30363d', separatorHoverColor: '#58a6ff55', enableResize: true },
      },
      grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
      width: initialWidth,
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
      const s = chart.addSeries(LineSeries, { color: 'rgba(163, 113, 247, 0.75)', lineWidth: 1, title: 'SMA 50', priceLineVisible: false, lastValueVisible: false });
      s.setData(calculateSMA(closeData, 50));
    }
    if (showEMA20) {
      const s = chart.addSeries(LineSeries, { color: '#f0883e', lineWidth: 1, title: 'EMA 20', priceLineVisible: false, lastValueVisible: false });
      s.setData(calculateEMA(closeData, 20));
    }
    if (showBB) {
      const bb = calculateBollinger(closeData);
      const bbU = chart.addSeries(LineSeries, { color: 'rgba(56, 139, 253, 0.45)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
      const bbM = chart.addSeries(LineSeries, { color: 'rgba(56, 139, 253, 0.65)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      const bbL = chart.addSeries(LineSeries, { color: 'rgba(56, 139, 253, 0.45)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
      bbU.setData(bb.upper);
      bbM.setData(bb.middle);
      bbL.setData(bb.lower);
    }

    // Ayrı paneller
    let rsiSeries: ReturnType<typeof chart.addSeries> | null = null;
    let macdSeries: ReturnType<typeof chart.addSeries> | null = null;

    if (showRSI) {
      rsiSeries = chart.addSeries(LineSeries, { color: '#a371f7', lineWidth: 2, title: 'RSI 14' }, 1);
      rsiSeries.setData(calculateRSI(closeData));
      const ob = chart.addSeries(LineSeries, { color: '#f8514966', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false }, 1);
      const os = chart.addSeries(LineSeries, { color: '#3fb95066', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false }, 1);
      ob.setData(closeData.map((p) => ({ time: p.time, value: 70 })));
      os.setData(closeData.map((p) => ({ time: p.time, value: 30 })));
    }

    if (showMACD) {
      const macdPaneIndex = showRSI ? 2 : 1;
      const macdData = calculateMACD(closeData);
      macdSeries = chart.addSeries(LineSeries, { color: '#58a6ff', lineWidth: 2, title: 'MACD' }, macdPaneIndex);
      const signalSeries = chart.addSeries(LineSeries, { color: '#f0883e', lineWidth: 1, title: 'Signal' }, macdPaneIndex);
      const histSeries = chart.addSeries(HistogramSeries, { title: 'Histogram' }, macdPaneIndex);
      macdSeries.setData(macdData.macd);
      signalSeries.setData(macdData.signal);
      histSeries.setData(macdData.hist.map((p) => ({
        time: p.time,
        value: p.value,
        color: p.value >= 0 ? 'rgba(63, 185, 80, 0.6)' : 'rgba(248, 81, 73, 0.6)',
      })));
    }

    // Panel yüksekliklerini sabitle
    const panes = chart.panes();
    if (panes.length > 1) {
      panes[0].setHeight(baseHeight);
      for (let i = 1; i < panes.length; i++) panes[i].setHeight(paneHeight);
    }

    const span = RANGE_SECONDS[range];
    if (span && chartData.length > 1) {
      const to = chartData[chartData.length - 1].time as number;
      const from = Math.max(to - span, chartData[0].time as number);
      chart.timeScale().setVisibleRange({ from: from as Time, to: to as Time });
    } else {
      chart.timeScale().fitContent();
    }

    activeSeriesRef.current = activeSeries;
    kindRef.current = effectiveKind;
    lastBarRef.current = chartData.length > 0 ? { ...chartData[chartData.length - 1] } : null;

    setChartApi(chart);
    setActiveSeriesApi(activeSeries);

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

      const dateStr = new Date((param.time as number) * 1000).toLocaleDateString(i18n.language === 'tr' ? 'tr-TR' : 'en-US');
      let html = `<div style="font-size: 13px; font-weight: bold; margin-bottom: 4px; color: #fff;">${dateStr} · ${ticker}</div>`;

      const close = dataPoint.value !== undefined ? dataPoint.value : dataPoint.close;
      const prev = prevCloseByTime.get(param.time as number);
      const changePct = prev ? ((close - prev) / prev) * 100 : null;
      const changeHtml = changePct !== null
        ? ` <span style="color: ${changePct >= 0 ? '#3fb950' : '#f85149'};">(${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)</span>`
        : '';

      if (dataPoint.value !== undefined) {
        html += `<div style="color: #c9d1d9;">${i18n.t('chartClose')}: <span style="font-weight: bold; color: #fff;">${close.toFixed(2)}</span>${changeHtml}</div>`;
      } else {
        const color = dataPoint.close >= dataPoint.open ? '#3fb950' : '#f85149';
        html += `
          <div style="display: grid; grid-template-columns: auto auto; gap: 4px 12px; color: #c9d1d9; font-size: 12px;">
            <div>${i18n.t('chartOpen')}: <span style="font-weight: bold; color: ${color};">${dataPoint.open.toFixed(2)}</span></div>
            <div>${i18n.t('chartHigh')}: <span style="font-weight: bold; color: #fff;">${dataPoint.high.toFixed(2)}</span></div>
            <div>${i18n.t('chartClose')}: <span style="font-weight: bold; color: ${color};">${dataPoint.close.toFixed(2)}</span>${changeHtml}</div>
            <div>${i18n.t('chartLow')}: <span style="font-weight: bold; color: #fff;">${dataPoint.low.toFixed(2)}</span></div>
          </div>`;
      }
      if (volPoint && volPoint.value) {
        const vol = volPoint.value;
        const formattedVol = vol > 1000000 ? (vol / 1000000).toFixed(2) + 'M' : vol > 1000 ? (vol / 1000).toFixed(1) + 'K' : String(vol);
        html += `<div style="margin-top: 4px; font-size: 12px; color: #8b949e;">${i18n.t('volumeLabel')}: <span style="color: #c9d1d9;">${formattedVol}</span></div>`;
      }
      if (rsiPoint && rsiPoint.value !== undefined) {
        const rsiColor = rsiPoint.value > 70 ? '#f85149' : rsiPoint.value < 30 ? '#3fb950' : '#c9d1d9';
        html += `<div style="font-size: 12px; color: #8b949e;">RSI: <span style="color: ${rsiColor}; font-weight: bold;">${rsiPoint.value.toFixed(1)}</span></div>`;
      }
      legendRef.current.innerHTML = html;
      legendRef.current.style.display = 'block';
    });

    const handleResize = () => {
      if (chartContainerRef.current) {
        const newWidth = chartContainerRef.current.clientWidth;
        setChartWidth(newWidth);
        chart.applyOptions({ width: newWidth });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      activeSeriesRef.current = null;
      lastBarRef.current = null;
      setChartApi(null);
      setActiveSeriesApi(null);
      chart.remove();
    };
  }, [data, ticker, range, kind, showSMA20, showSMA50, showEMA20, showBB, showVolume, showRSI, showMACD, logScale, totalHeight]);

  useEffect(() => {
    const series = activeSeriesRef.current;
    const last = lastBarRef.current;
    if (!series || !last || !livePrice || livePrice <= 0) return;
    last.high = Math.max(last.high, livePrice);
    last.low = Math.min(last.low, livePrice);
    last.close = livePrice;
    if (kindRef.current === 'candles') {
      series.update({ time: last.time, open: last.open, high: last.high, low: last.low, close: last.close });
    } else {
      series.update({ time: last.time, value: livePrice });
    }
  }, [livePrice]);

  return (
    <div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '4px', marginRight: '6px' }}>
            {(['candles', 'line', 'area'] as const).map((k) => (
              <button key={k} type="button" style={toggleStyle(kind === k)} onClick={() => setKind(k)}>
                {k === 'candles' ? i18n.t('chartCandles') : k === 'line' ? i18n.t('chartLine') : i18n.t('chartArea')}
              </button>
            ))}
          </div>
          <button type="button" style={toggleStyle(showSMA20)} onClick={() => setShowSMA20(!showSMA20)}>SMA 20</button>
          <button type="button" style={toggleStyle(showSMA50)} onClick={() => setShowSMA50(!showSMA50)}>SMA 50</button>
          <button type="button" style={toggleStyle(showEMA20)} onClick={() => setShowEMA20(!showEMA20)}>EMA 20</button>
          <button type="button" style={toggleStyle(showBB)} onClick={() => setShowBB(!showBB)} title={i18n.t('bbHint')}>BB</button>
          <button type="button" style={toggleStyle(showVolume)} onClick={() => setShowVolume(!showVolume)}>{i18n.t('volumeLabel')}</button>
          <button type="button" style={toggleStyle(showRSI)} onClick={() => setShowRSI(!showRSI)}>RSI</button>
          <button type="button" style={toggleStyle(showMACD)} onClick={() => setShowMACD(!showMACD)}>MACD</button>
          <button type="button" style={toggleStyle(logScale)} onClick={() => setLogScale(!logScale)} title={i18n.t('logHint')}>Log</button>
        </div>

        {/* Çizim Araçları Açma / Kapatma Butonu */}
        <button
          type="button"
          style={toggleStyle(showDrawingTools)}
          onClick={() => setShowDrawingTools(!showDrawingTools)}
          title={i18n.t('drawTools')}
        >
          ✏️ {i18n.t('drawTools')}
        </button>
      </div>

      {/* Çizim Araç Çubuğu */}
      {showDrawingTools && (
        <div style={{ marginBottom: '8px' }}>
          <ChartDrawingToolbar
            settings={drawingSettings}
            onSelectTool={setActiveTool}
            onToggleMagnet={toggleMagnet}
            onToggleVisibility={toggleVisibility}
            onSetColor={setColor}
            onSetLineWidth={setLineWidth}
            onSetLineStyle={setLineStyle}
            onUndo={undo}
            onRedo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
            selectedId={selectedId}
            onDeleteSelected={() => selectedId && deleteDrawing(selectedId)}
            onClearAll={clearDrawings}
            onOpenManager={() => setShowDrawingManager(true)}
            drawingsCount={drawings.length}
          />
        </div>
      )}

      {/* Çizim Yöneticisi ve Katman Ağacı Modalı */}
      <DrawingManagerModal
        ticker={ticker}
        drawings={drawings}
        isOpen={showDrawingManager}
        onClose={() => setShowDrawingManager(false)}
        onUpdateDrawing={updateDrawing}
        onDeleteDrawing={deleteDrawing}
        onClearAll={clearDrawings}
        onOpenAlertModal={(drawing) => setAlertModalDrawing(drawing)}
        onImportDrawings={(imported) => {
          for (const item of imported) {
            addDrawing(item);
          }
          setShowDrawingManager(false);
        }}
      />

      {/* Çizim Üzerinden Alarm Kurma Modalı */}
      {alertModalDrawing && (
        <DrawingAlertModal
          ticker={ticker}
          drawing={alertModalDrawing}
          isOpen={Boolean(alertModalDrawing)}
          onClose={() => setAlertModalDrawing(null)}
          onCreateAlert={(rule) => {
            const created = addRule(rule);
            if (alertModalDrawing) {
              updateDrawing(alertModalDrawing.id, {
                hasAlert: true,
                alertRuleId: created.id,
              });
            }
          }}
        />
      )}

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

        {/* Grafik Üzeri İnteraktif Çizim Katmanı */}
        <ChartDrawingOverlay
          chart={chartApi}
          series={activeSeriesApi}
          quotes={data}
          drawings={drawings}
          selectedId={selectedId}
          settings={drawingSettings}
          onSelectId={setSelectedId}
          onAddDrawing={addDrawing}
          onUpdateDrawing={updateDrawing}
          onDeleteDrawing={deleteDrawing}
          onSelectTool={setActiveTool}
          onUndo={undo}
          onRedo={redo}
          onOpenAlertModal={(drawing) => setAlertModalDrawing(drawing)}
          width={chartWidth}
          height={totalHeight}
        />
      </div>
    </div>
  );
}
