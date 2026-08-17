import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import type { HistoricalQuote } from '../../types';
import type { DrawingItem, DrawingPoint, DrawingToolSettings, DrawingToolType } from './drawingTypes';
import { FIBONACCI_LEVELS } from './drawingTypes';
import {
  pointToScreen,
  screenToPoint,
  distanceBetween,
  distanceToSegment,
} from './drawingCoordinates';
import i18n from '../../i18n';

interface ChartDrawingOverlayProps {
  chart: IChartApi | null;
  series: ISeriesApi<SeriesType> | null;
  quotes: HistoricalQuote[];
  drawings: DrawingItem[];
  selectedId: string | null;
  settings: DrawingToolSettings;
  onSelectId: (id: string | null) => void;
  onAddDrawing: (item: DrawingItem) => void;
  onUpdateDrawing: (id: string, patch: Partial<DrawingItem>) => void;
  onDeleteDrawing: (id: string) => void;
  onSelectTool: (tool: DrawingToolType) => void;
  onUndo: () => void;
  onRedo: () => void;
  width: number;
  height: number;
}

interface DragState {
  drawingId: string;
  handleIndex: number; // -1 for entire drawing drag, >=0 for vertex
  startPoint: DrawingPoint;
  initialPoints: DrawingPoint[];
}

export default function ChartDrawingOverlay({
  chart,
  series,
  quotes,
  drawings,
  selectedId,
  settings,
  onSelectId,
  onAddDrawing,
  onUpdateDrawing,
  onDeleteDrawing,
  onSelectTool,
  onUndo,
  onRedo,
  width,
  height,
}: ChartDrawingOverlayProps) {
  const containerRef = useRef<SVGSVGElement>(null);
  const mouseDownPosRef = useRef<{ x: number; y: number; time: number; dataPoint: DrawingPoint } | null>(null);

  // Çizim esnasındaki ara durum
  const [inProgress, setInProgress] = useState<DrawingItem | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoverDataPoint, setHoverDataPoint] = useState<DrawingPoint | null>(null);
  const [textModal, setTextModal] = useState<{ x: number; y: number; point: DrawingPoint } | null>(null);
  const [textInputVal, setTextInputVal] = useState('');

  // Grafik kaydırma/yakınlaştırma tetikleyicisi
  const [, setRenderTrigger] = useState(0);

  const sortedQuotes = useMemo(() => {
    return [...quotes].sort((a, b) => (a.time as number) - (b.time as number));
  }, [quotes]);

  // Grafik görünüm değişikliklerini dinle
  useEffect(() => {
    if (!chart) return;

    const handleUpdate = () => {
      setRenderTrigger((prev) => (prev + 1) % 1_000_000);
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(handleUpdate);
    chart.timeScale().subscribeVisibleTimeRangeChange(handleUpdate);

    return () => {
      try {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleUpdate);
        chart.timeScale().unsubscribeVisibleTimeRangeChange(handleUpdate);
      } catch {
        // Unsubscribe safe cleanup
      }
    };
  }, [chart]);

  // Klavye kısayolları
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (textModal) return;

      if (e.key === 'Escape') {
        setInProgress(null);
        setDragState(null);
        onSelectId(null);
        if (settings.activeTool !== 'select') {
          onSelectTool('select');
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId) {
          onDeleteDrawing(selectedId);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          onRedo();
        } else {
          onUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        onRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [textModal, selectedId, settings.activeTool, onSelectTool, onSelectId, onDeleteDrawing, onUndo, onRedo]);

  const getSvgCoordinates = useCallback(
    (e: React.MouseEvent<any>): { x: number; y: number } | null => {
      if (!containerRef.current) return null;
      const rect = containerRef.current.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    },
    []
  );

  // Mouse Olayları (Çizim ve Taşıma)
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0 || !settings.isVisible) return;
    const mousePos = getSvgCoordinates(e);
    if (!mousePos) return;

    const dataPoint = screenToPoint(
      mousePos.x,
      mousePos.y,
      chart,
      series,
      sortedQuotes,
      settings.magnetEnabled
    );
    if (!dataPoint) return;

    // 1. SELECT Modu
    if (settings.activeTool === 'select') {
      return;
    }

    mouseDownPosRef.current = { x: mousePos.x, y: mousePos.y, time: Date.now(), dataPoint };

    // 2. TEK TIKLAMALI ARAÇLAR (Yatay / Dikey Seviyeler)
    if (settings.activeTool === 'horizontal') {
      const newItem: DrawingItem = {
        id: `draw_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        type: 'horizontal',
        points: [dataPoint],
        color: settings.color,
        lineWidth: settings.lineWidth,
        lineStyle: settings.lineStyle,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      onAddDrawing(newItem);
      onSelectTool('select');
      return;
    }

    if (settings.activeTool === 'vertical') {
      const newItem: DrawingItem = {
        id: `draw_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        type: 'vertical',
        points: [dataPoint],
        color: settings.color,
        lineWidth: settings.lineWidth,
        lineStyle: settings.lineStyle,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      onAddDrawing(newItem);
      onSelectTool('select');
      return;
    }

    // 3. METİN / NOT ARACI
    if (settings.activeTool === 'text') {
      setTextModal({ x: mousePos.x, y: mousePos.y, point: dataPoint });
      setTextInputVal('');
      return;
    }

    // 4. FIRÇA / SERBEST ÇİZİM
    if (settings.activeTool === 'brush') {
      const newItem: DrawingItem = {
        id: `draw_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        type: 'brush',
        points: [dataPoint],
        color: settings.color,
        lineWidth: settings.lineWidth,
        lineStyle: settings.lineStyle,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setInProgress(newItem);
      return;
    }

    // 5. İKİ NOKTALI ARAÇLAR (Trend, Ray, Rectangle, Fibonacci, Measure)
    if (!inProgress) {
      const newItem: DrawingItem = {
        id: `draw_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        type: settings.activeTool,
        points: [dataPoint, dataPoint],
        color: settings.color,
        lineWidth: settings.lineWidth,
        lineStyle: settings.lineStyle,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setInProgress(newItem);
    } else {
      // 2. noktayı sabitle ve bitir (Click-Move-Click modu)
      const finishedItem: DrawingItem = {
        ...inProgress,
        points: [inProgress.points[0], dataPoint],
        updatedAt: Date.now(),
      };
      onAddDrawing(finishedItem);
      setInProgress(null);
      onSelectTool('select');
    }
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!settings.isVisible) return;
    const mousePos = getSvgCoordinates(e);
    if (!mousePos) return;

    const dataPoint = screenToPoint(
      mousePos.x,
      mousePos.y,
      chart,
      series,
      sortedQuotes,
      settings.magnetEnabled
    );

    if (dataPoint) {
      setHoverDataPoint(dataPoint);
    }

    if (!dataPoint) return;

    // Çizim sürecindeysek 2. noktayı veya fırça noktalarını güncelle
    if (inProgress) {
      if (inProgress.type === 'brush') {
        setInProgress((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            points: [...prev.points, dataPoint],
          };
        });
      } else {
        setInProgress((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            points: [prev.points[0], dataPoint],
          };
        });
      }
      return;
    }

    // Sürükleme (Drag) modundaysak
    if (dragState) {
      const targetDrawing = drawings.find((d) => d.id === dragState.drawingId);
      if (!targetDrawing) return;

      if (dragState.handleIndex >= 0) {
        // Belirli bir köşeyi taşıyoruz
        const nextPoints = [...targetDrawing.points];
        nextPoints[dragState.handleIndex] = dataPoint;
        onUpdateDrawing(dragState.drawingId, { points: nextPoints });
      } else {
        // Tüm şekli taşıyoruz (delta zaman ve delta fiyat)
        const dtTime = dataPoint.time - dragState.startPoint.time;
        const dtPrice = dataPoint.price - dragState.startPoint.price;

        const nextPoints = dragState.initialPoints.map((p) => ({
          time: p.time + dtTime,
          price: p.price + dtPrice,
        }));
        onUpdateDrawing(dragState.drawingId, { points: nextPoints });
      }
      return;
    }

    // Select modunda hover tespiti
    if (settings.activeTool === 'select') {
      let foundId: string | null = null;
      for (const d of drawings) {
        if (isMouseNearDrawing(mousePos, d, chart, series, sortedQuotes)) {
          foundId = d.id;
          break;
        }
      }
      setHoveredId(foundId);
    }
  };

  const handleMouseUp = (e: React.MouseEvent<SVGSVGElement>) => {
    if (inProgress) {
      if (inProgress.type === 'brush') {
        if (inProgress.points.length > 1) {
          onAddDrawing(inProgress);
        }
        setInProgress(null);
        onSelectTool('select');
      } else if (mouseDownPosRef.current) {
        const mousePos = getSvgCoordinates(e);
        if (mousePos) {
          const dist = Math.hypot(mousePos.x - mouseDownPosRef.current.x, mousePos.y - mouseDownPosRef.current.y);
          // Sürükleyip bıraktıysa (Drag-to-draw) çizimi anında tamamla
          if (dist > 6 && inProgress.points.length >= 2) {
            const dataPoint = screenToPoint(mousePos.x, mousePos.y, chart, series, sortedQuotes, settings.magnetEnabled) || inProgress.points[1];
            const finishedItem: DrawingItem = {
              ...inProgress,
              points: [inProgress.points[0], dataPoint],
              updatedAt: Date.now(),
            };
            onAddDrawing(finishedItem);
            setInProgress(null);
            onSelectTool('select');
          }
        }
      }
    }
    mouseDownPosRef.current = null;
    if (dragState) {
      setDragState(null);
    }
  };

  const handleDrawingClick = (e: React.MouseEvent, id: string) => {
    if (settings.activeTool === 'select') {
      e.stopPropagation();
      onSelectId(id);
    }
  };

  const startDraggingHandle = (e: React.MouseEvent, drawingId: string, handleIndex: number) => {
    e.stopPropagation();
    const mousePos = getSvgCoordinates(e);
    if (!mousePos) return;

    const dataPoint = screenToPoint(
      mousePos.x,
      mousePos.y,
      chart,
      series,
      sortedQuotes,
      settings.magnetEnabled
    );
    if (!dataPoint) return;

    const drawing = drawings.find((d) => d.id === drawingId);
    if (!drawing) return;

    onSelectId(drawingId);
    setDragState({
      drawingId,
      handleIndex,
      startPoint: dataPoint,
      initialPoints: [...drawing.points],
    });
  };

  const startDraggingBody = (e: React.MouseEvent, drawingId: string) => {
    if (settings.activeTool !== 'select') return;
    e.stopPropagation();
    const mousePos = getSvgCoordinates(e);
    if (!mousePos) return;

    const dataPoint = screenToPoint(
      mousePos.x,
      mousePos.y,
      chart,
      series,
      sortedQuotes,
      settings.magnetEnabled
    );
    if (!dataPoint) return;

    const drawing = drawings.find((d) => d.id === drawingId);
    if (!drawing) return;

    onSelectId(drawingId);
    setDragState({
      drawingId,
      handleIndex: -1,
      startPoint: dataPoint,
      initialPoints: [...drawing.points],
    });
  };

  const handleSaveText = () => {
    if (textModal && textInputVal.trim()) {
      const newItem: DrawingItem = {
        id: `draw_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        type: 'text',
        points: [textModal.point],
        color: settings.color,
        lineWidth: settings.lineWidth,
        lineStyle: settings.lineStyle,
        text: textInputVal.trim(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      onAddDrawing(newItem);
    }
    setTextModal(null);
    setTextInputVal('');
    onSelectTool('select');
  };

  if (!settings.isVisible) {
    return null;
  }

  const isDrawingActive = settings.activeTool !== 'select' || inProgress !== null || dragState !== null;
  const allRenderDrawings = inProgress ? [...drawings, inProgress] : drawings;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: isDrawingActive ? 'auto' : 'none',
      }}
    >
      <svg
        ref={containerRef}
        width={width}
        height={height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          overflow: 'visible',
          pointerEvents: isDrawingActive ? 'auto' : 'none',
          cursor: isDrawingActive ? 'crosshair' : 'default',
        }}
      >
        <defs>
          <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#000" floodOpacity="0.6" />
          </filter>
        </defs>

        {/* WebKit hit-testing şeffaf yakalama katmanı */}
        <rect
          x={0}
          y={0}
          width={width || '100%'}
          height={height || '100%'}
          fill="transparent"
          style={{
            pointerEvents: isDrawingActive ? 'all' : 'none',
            cursor: isDrawingActive ? 'crosshair' : 'default',
          }}
        />

        {/* Canlı Çizim İmleç Rehberi (Snap Noktası) */}
        {settings.activeTool !== 'select' && hoverDataPoint && (
          (() => {
            const snapScreen = pointToScreen(hoverDataPoint, chart, series, sortedQuotes);
            if (!snapScreen) return null;
            return (
              <g style={{ pointerEvents: 'none' }}>
                <circle cx={snapScreen.x} cy={snapScreen.y} r={6} fill="none" stroke={settings.color} strokeWidth={1.5} opacity={0.7} />
                <circle cx={snapScreen.x} cy={snapScreen.y} r={2.5} fill={settings.color} />
              </g>
            );
          })()
        )}

        {allRenderDrawings.map((item) => {
          const isSelected = selectedId === item.id;
          const isHovered = hoveredId === item.id;

          return (
            <g key={item.id}>
              {renderSingleDrawing(
                item,
                chart,
                series,
                sortedQuotes,
                width,
                height,
                isSelected,
                isHovered,
                (e) => handleDrawingClick(e, item.id),
                (e) => startDraggingBody(e, item.id)
              )}

              {/* Seçili çizimin köşe tutamaçları */}
              {isSelected &&
                item.points.map((pt, idx) => {
                  const screen = pointToScreen(pt, chart, series, sortedQuotes);
                  if (!screen) return null;
                  return (
                    <circle
                      key={idx}
                      cx={screen.x}
                      cy={screen.y}
                      r={5}
                      fill="#ffffff"
                      stroke={item.color}
                      strokeWidth={2}
                      style={{ cursor: 'move', pointerEvents: 'auto' }}
                      onMouseDown={(e) => startDraggingHandle(e, item.id, idx)}
                    />
                  );
                })}
            </g>
          );
        })}
      </svg>

      {/* Metin / Not Ekleme Popover */}
      {textModal && (
        <div
          style={{
            position: 'absolute',
            top: Math.min(Math.max(10, textModal.y), height - 80),
            left: Math.min(Math.max(10, textModal.x), width - 220),
            zIndex: 100,
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: '6px',
            padding: '8px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
            width: '200px',
            pointerEvents: 'auto',
          }}
        >
          <input
            type="text"
            autoFocus
            value={textInputVal}
            placeholder={i18n.t('drawTextPlaceholder')}
            onChange={(e) => setTextInputVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveText();
              if (e.key === 'Escape') setTextModal(null);
            }}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: '#0d1117',
              border: '1px solid #30363d',
              borderRadius: '4px',
              padding: '6px 8px',
              color: '#fff',
              fontSize: '0.75rem',
              outline: 'none',
              marginBottom: '6px',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
            <button
              type="button"
              onClick={() => setTextModal(null)}
              style={{
                padding: '3px 8px',
                fontSize: '0.7rem',
                background: 'transparent',
                color: '#8b949e',
                border: '1px solid #30363d',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              İptal
            </button>
            <button
              type="button"
              onClick={handleSaveText}
              style={{
                padding: '3px 8px',
                fontSize: '0.7rem',
                background: '#1f6feb',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Ekle
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Tek bir çizimi SVG elementlerine dönüştürür.
 */
function renderSingleDrawing(
  item: DrawingItem,
  chart: IChartApi | null,
  series: ISeriesApi<SeriesType> | null,
  sortedQuotes: HistoricalQuote[],
  chartWidth: number,
  chartHeight: number,
  isSelected: boolean,
  isHovered: boolean,
  onClick: (e: React.MouseEvent) => void,
  onMouseDown: (e: React.MouseEvent) => void
): React.ReactNode {
  const strokeDasharray =
    item.lineStyle === 'dashed' ? '6,4' : item.lineStyle === 'dotted' ? '2,2' : undefined;
  const strokeWidth = isSelected || isHovered ? item.lineWidth + 1 : item.lineWidth;

  // 1. TRENDLINE (Trend Çizgisi)
  if (item.type === 'trendline' && item.points.length >= 2) {
    const p1 = pointToScreen(item.points[0], chart, series, sortedQuotes);
    const p2 = pointToScreen(item.points[1], chart, series, sortedQuotes);
    if (!p1 || !p2) return null;

    return (
      <g onClick={onClick} onMouseDown={onMouseDown} style={{ pointerEvents: 'auto', cursor: 'pointer' }}>
        {/* Geniş görünmez hover alanı */}
        <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="transparent" strokeWidth={14} />
        {/* Asıl çizgi */}
        <line
          x1={p1.x}
          y1={p1.y}
          x2={p2.x}
          y2={p2.y}
          stroke={item.color}
          strokeWidth={strokeWidth}
          strokeDasharray={strokeDasharray}
          filter={isSelected ? 'url(#shadow)' : undefined}
        />
      </g>
    );
  }

  // 2. RAY (Işın Çizgisi)
  if (item.type === 'ray' && item.points.length >= 2) {
    const p1 = pointToScreen(item.points[0], chart, series, sortedQuotes);
    const p2 = pointToScreen(item.points[1], chart, series, sortedQuotes);
    if (!p1 || !p2) return null;

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    let targetX = p2.x;
    let targetY = p2.y;

    if (length > 0) {
      const extend = Math.max(chartWidth, chartHeight) * 2;
      targetX = p1.x + (dx / length) * extend;
      targetY = p1.y + (dy / length) * extend;
    }

    return (
      <g onClick={onClick} onMouseDown={onMouseDown} style={{ pointerEvents: 'auto', cursor: 'pointer' }}>
        <line x1={p1.x} y1={p1.y} x2={targetX} y2={targetY} stroke="transparent" strokeWidth={14} />
        <line
          x1={p1.x}
          y1={p1.y}
          x2={targetX}
          y2={targetY}
          stroke={item.color}
          strokeWidth={strokeWidth}
          strokeDasharray={strokeDasharray}
        />
      </g>
    );
  }

  // 3. HORIZONTAL (Yatay Destek / Direnç Çizgisi)
  if (item.type === 'horizontal' && item.points.length >= 1) {
    const p = pointToScreen(item.points[0], chart, series, sortedQuotes);
    if (!p) return null;

    return (
      <g onClick={onClick} onMouseDown={onMouseDown} style={{ pointerEvents: 'auto', cursor: 'pointer' }}>
        <line x1={0} y1={p.y} x2={chartWidth} y2={p.y} stroke="transparent" strokeWidth={14} />
        <line
          x1={0}
          y1={p.y}
          x2={chartWidth}
          y2={p.y}
          stroke={item.color}
          strokeWidth={strokeWidth}
          strokeDasharray={strokeDasharray}
        />
        {/* Fiyat Etiketi */}
        <g transform={`translate(${chartWidth - 65}, ${p.y - 10})`}>
          <rect width={60} height={20} rx={3} fill={item.color} opacity={0.9} />
          <text
            x={30}
            y={14}
            fill="#fff"
            fontSize="10"
            fontFamily="var(--font-mono)"
            textAnchor="middle"
            fontWeight="bold"
          >
            {item.points[0].price.toFixed(2)}
          </text>
        </g>
      </g>
    );
  }

  // 4. VERTICAL (Dikey Zaman Çizgisi)
  if (item.type === 'vertical' && item.points.length >= 1) {
    const p = pointToScreen(item.points[0], chart, series, sortedQuotes);
    if (!p) return null;

    const dateStr = new Date(item.points[0].time * 1000).toLocaleDateString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    });

    return (
      <g onClick={onClick} onMouseDown={onMouseDown} style={{ pointerEvents: 'auto', cursor: 'pointer' }}>
        <line x1={p.x} y1={0} x2={p.x} y2={chartHeight} stroke="transparent" strokeWidth={14} />
        <line
          x1={p.x}
          y1={0}
          x2={p.x}
          y2={chartHeight}
          stroke={item.color}
          strokeWidth={strokeWidth}
          strokeDasharray={strokeDasharray}
        />
        {/* Tarih Etiketi */}
        <g transform={`translate(${p.x - 30}, ${chartHeight - 24})`}>
          <rect width={60} height={18} rx={3} fill="#21262d" stroke={item.color} strokeWidth={1} />
          <text
            x={30}
            y={13}
            fill="#c9d1d9"
            fontSize="9"
            fontFamily="var(--font-mono)"
            textAnchor="middle"
          >
            {dateStr}
          </text>
        </g>
      </g>
    );
  }

  // 5. RECTANGLE (Kutu / Alan)
  if (item.type === 'rectangle' && item.points.length >= 2) {
    const p1 = pointToScreen(item.points[0], chart, series, sortedQuotes);
    const p2 = pointToScreen(item.points[1], chart, series, sortedQuotes);
    if (!p1 || !p2) return null;

    const x = Math.min(p1.x, p2.x);
    const y = Math.min(p1.y, p2.y);
    const w = Math.abs(p2.x - p1.x);
    const h = Math.abs(p2.y - p1.y);

    return (
      <g onClick={onClick} onMouseDown={onMouseDown} style={{ pointerEvents: 'auto', cursor: 'pointer' }}>
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          fill={item.color}
          fillOpacity={0.15}
          stroke={item.color}
          strokeWidth={strokeWidth}
          strokeDasharray={strokeDasharray}
        />
      </g>
    );
  }

  // 6. FIBONACCI RETRACEMENT (Fibonacci Düzeltmesi)
  if (item.type === 'fibonacci' && item.points.length >= 2) {
    const p1 = item.points[0];
    const p2 = item.points[1];
    const s1 = pointToScreen(p1, chart, series, sortedQuotes);
    const s2 = pointToScreen(p2, chart, series, sortedQuotes);
    if (!s1 || !s2) return null;

    const minX = Math.min(s1.x, s2.x);
    const maxX = Math.max(s1.x, s2.x, chartWidth);
    const priceDiff = p2.price - p1.price;

    return (
      <g onClick={onClick} onMouseDown={onMouseDown} style={{ pointerEvents: 'auto', cursor: 'pointer' }}>
        {/* Ana Trend Çizgisi */}
        <line x1={s1.x} y1={s1.y} x2={s2.x} y2={s2.y} stroke={item.color} strokeWidth={1} strokeDasharray="3,3" opacity={0.6} />

        {/* Fibonacci Seviyeleri */}
        {FIBONACCI_LEVELS.map((fib, idx) => {
          const targetPrice = p1.price + priceDiff * fib.level;
          const levelScreen = pointToScreen({ time: p1.time, price: targetPrice }, chart, series, sortedQuotes);
          if (!levelScreen) return null;

          return (
            <g key={idx}>
              <line
                x1={minX}
                y1={levelScreen.y}
                x2={maxX}
                y2={levelScreen.y}
                stroke={fib.color}
                strokeWidth={1}
                opacity={0.8}
              />
              <text
                x={minX + 6}
                y={levelScreen.y - 4}
                fill={fib.color}
                fontSize="10"
                fontFamily="var(--font-mono)"
                fontWeight="500"
              >
                {fib.label} - {targetPrice.toFixed(2)}
              </text>
            </g>
          );
        })}
      </g>
    );
  }

  // 7. BRUSH (Serbest Kalem)
  if (item.type === 'brush' && item.points.length >= 2) {
    const screenPoints = item.points
      .map((p) => pointToScreen(p, chart, series, sortedQuotes))
      .filter((p): p is { x: number; y: number } => p !== null);

    if (screenPoints.length < 2) return null;

    const pathData = screenPoints.reduce(
      (acc, p, idx) => (idx === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`),
      ''
    );

    return (
      <g onClick={onClick} onMouseDown={onMouseDown} style={{ pointerEvents: 'auto', cursor: 'pointer' }}>
        <path d={pathData} fill="none" stroke="transparent" strokeWidth={14} />
        <path
          d={pathData}
          fill="none"
          stroke={item.color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    );
  }

  // 8. TEXT (Not / Metin)
  if (item.type === 'text' && item.points.length >= 1) {
    const p = pointToScreen(item.points[0], chart, series, sortedQuotes);
    if (!p) return null;

    const label = item.text || 'Not';
    const textWidth = Math.max(50, label.length * 7 + 16);

    return (
      <g
        onClick={onClick}
        onMouseDown={onMouseDown}
        transform={`translate(${p.x}, ${p.y - 12})`}
        style={{ pointerEvents: 'auto', cursor: 'pointer' }}
      >
        <rect
          x={0}
          y={0}
          width={textWidth}
          height={22}
          rx={4}
          fill="#161b22"
          stroke={item.color}
          strokeWidth={strokeWidth}
        />
        <text
          x={textWidth / 2}
          y={15}
          fill="#fff"
          fontSize="11"
          fontFamily="var(--font-sans, system-ui)"
          textAnchor="middle"
          fontWeight="500"
        >
          {label}
        </text>
      </g>
    );
  }

  // 9. MEASURE (Ölçüm Aracı)
  if (item.type === 'measure' && item.points.length >= 2) {
    const p1 = item.points[0];
    const p2 = item.points[1];
    const s1 = pointToScreen(p1, chart, series, sortedQuotes);
    const s2 = pointToScreen(p2, chart, series, sortedQuotes);
    if (!s1 || !s2) return null;

    const diff = p2.price - p1.price;
    const pct = p1.price !== 0 ? (diff / p1.price) * 100 : 0;
    const isUp = diff >= 0;
    const badgeColor = isUp ? '#3fb950' : '#f85149';

    // Bar farkı hesapla
    const idx1 = sortedQuotes.findIndex((q) => (q.time as number) === p1.time);
    const idx2 = sortedQuotes.findIndex((q) => (q.time as number) === p2.time);
    const bars = idx1 >= 0 && idx2 >= 0 ? Math.abs(idx2 - idx1) : 0;

    const minX = Math.min(s1.x, s2.x);
    const minY = Math.min(s1.y, s2.y);
    const w = Math.abs(s2.x - s1.x);
    const h = Math.abs(s2.y - s1.y);

    const badgeText = `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} (${diff >= 0 ? '+' : ''}${pct.toFixed(2)}%) · ${bars} ${i18n.t('drawMeasureBars')}`;

    return (
      <g onClick={onClick} onMouseDown={onMouseDown} style={{ pointerEvents: 'auto', cursor: 'pointer' }}>
        {/* Şeffaf Alan */}
        <rect x={minX} y={minY} width={w} height={h} fill={badgeColor} fillOpacity={0.12} stroke={badgeColor} strokeWidth={1} strokeDasharray="4,4" />
        {/* Köşegen Çizgi */}
        <line x1={s1.x} y1={s1.y} x2={s2.x} y2={s2.y} stroke={badgeColor} strokeWidth={2} />
        {/* Rozet */}
        <g transform={`translate(${(s1.x + s2.x) / 2 - 80}, ${(s1.y + s2.y) / 2 - 12})`}>
          <rect width={160} height={24} rx={4} fill="#161b22" stroke={badgeColor} strokeWidth={1.5} filter="url(#shadow)" />
          <text
            x={80}
            y={16}
            fill={badgeColor}
            fontSize="11"
            fontFamily="var(--font-mono)"
            textAnchor="middle"
            fontWeight="bold"
          >
            {badgeText}
          </text>
        </g>
      </g>
    );
  }

  return null;
}

/**
 * Fare imlecinin çizim nesnesine yakın olup olmadığını belirler.
 */
function isMouseNearDrawing(
  mouse: { x: number; y: number },
  item: DrawingItem,
  chart: IChartApi | null,
  series: ISeriesApi<SeriesType> | null,
  sortedQuotes: HistoricalQuote[]
): boolean {
  const THRESHOLD = 8;

  if (item.type === 'trendline' && item.points.length >= 2) {
    const p1 = pointToScreen(item.points[0], chart, series, sortedQuotes);
    const p2 = pointToScreen(item.points[1], chart, series, sortedQuotes);
    if (!p1 || !p2) return false;
    return distanceToSegment(mouse, p1, p2) <= THRESHOLD;
  }

  if (item.type === 'ray' && item.points.length >= 2) {
    const p1 = pointToScreen(item.points[0], chart, series, sortedQuotes);
    const p2 = pointToScreen(item.points[1], chart, series, sortedQuotes);
    if (!p1 || !p2) return false;
    return distanceToSegment(mouse, p1, p2) <= THRESHOLD;
  }

  if (item.type === 'horizontal' && item.points.length >= 1) {
    const p = pointToScreen(item.points[0], chart, series, sortedQuotes);
    if (!p) return false;
    return Math.abs(mouse.y - p.y) <= THRESHOLD;
  }

  if (item.type === 'vertical' && item.points.length >= 1) {
    const p = pointToScreen(item.points[0], chart, series, sortedQuotes);
    if (!p) return false;
    return Math.abs(mouse.x - p.x) <= THRESHOLD;
  }

  if (item.type === 'rectangle' && item.points.length >= 2) {
    const p1 = pointToScreen(item.points[0], chart, series, sortedQuotes);
    const p2 = pointToScreen(item.points[1], chart, series, sortedQuotes);
    if (!p1 || !p2) return false;
    const minX = Math.min(p1.x, p2.x);
    const maxX = Math.max(p1.x, p2.x);
    const minY = Math.min(p1.y, p2.y);
    const maxY = Math.max(p1.y, p2.y);
    return mouse.x >= minX - 4 && mouse.x <= maxX + 4 && mouse.y >= minY - 4 && mouse.y <= maxY + 4;
  }

  if (item.type === 'text' && item.points.length >= 1) {
    const p = pointToScreen(item.points[0], chart, series, sortedQuotes);
    if (!p) return false;
    return distanceBetween(mouse, p) <= 24;
  }

  return false;
}
