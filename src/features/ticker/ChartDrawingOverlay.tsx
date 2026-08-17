import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import {
  Trash2,
  Lock,
  Unlock,
  Copy,
  Bell,
} from 'lucide-react';
import type { HistoricalQuote } from '../../types';
import type { DrawingItem, DrawingPoint, DrawingToolSettings, DrawingToolType } from './drawingTypes';
import { FIBONACCI_LEVELS, FIBONACCI_EXTENSION_LEVELS, DRAWING_PALETTE_COLORS } from './drawingTypes';
import {
  pointToScreen,
  screenToPoint,
  distanceBetween,
  distanceToSegment,
  distanceToInfiniteLine,
  pointsToSmoothSvgPath,
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
  onOpenAlertModal?: (drawing: DrawingItem) => void;
  width: number;
  height: number;
}

interface DragState {
  drawingId: string;
  handleIndex: number;
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
  onOpenAlertModal,
  width,
  height,
}: ChartDrawingOverlayProps) {
  const containerRef = useRef<SVGSVGElement>(null);
  const mouseDownPosRef = useRef<{ x: number; y: number; time: number; dataPoint: DrawingPoint } | null>(null);

  // Çizim esnasındaki ara durum (1, 2 veya 3 noktalı çizimler)
  const [inProgress, setInProgress] = useState<DrawingItem | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoverDataPoint, setHoverDataPoint] = useState<DrawingPoint | null>(null);
  const [textModal, setTextModal] = useState<{ x: number; y: number; point: DrawingPoint; isCallout?: boolean } | null>(null);
  const [textInputVal, setTextInputVal] = useState('');
  const [showColorPicker, setShowColorPicker] = useState(false);

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
          const selected = drawings.find((d) => d.id === selectedId);
          if (selected && !selected.isLocked) {
            onDeleteDrawing(selectedId);
          }
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        // Klonla (Duplicate)
        if (selectedId) {
          e.preventDefault();
          const target = drawings.find((d) => d.id === selectedId);
          if (target) {
            const clone: DrawingItem = {
              ...target,
              id: `draw_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              points: target.points.map((p) => ({ time: p.time, price: p.price * 1.01 })),
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            onAddDrawing(clone);
            onSelectId(clone.id);
          }
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) onRedo(); else onUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        onRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [textModal, selectedId, drawings, settings.activeTool, onSelectTool, onSelectId, onAddDrawing, onDeleteDrawing, onUndo, onRedo]);

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

    // 2. TEK TIKLAMALI ARAÇLAR
    if (settings.activeTool === 'horizontal' || settings.activeTool === 'horizontal_ray' || settings.activeTool === 'vertical' || settings.activeTool === 'arrow_up' || settings.activeTool === 'arrow_down') {
      const newItem: DrawingItem = {
        id: `draw_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        type: settings.activeTool,
        points: [dataPoint],
        color: settings.activeTool === 'arrow_up' ? '#3fb950' : settings.activeTool === 'arrow_down' ? '#f85149' : settings.color,
        lineWidth: settings.lineWidth,
        lineStyle: settings.lineStyle,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      onAddDrawing(newItem);
      onSelectTool('select');
      return;
    }

    // 3. METİN & BALONCUK NOTU
    if (settings.activeTool === 'text' || settings.activeTool === 'callout') {
      setTextModal({ x: mousePos.x, y: mousePos.y, point: dataPoint, isCallout: settings.activeTool === 'callout' });
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

    // 5. POZİSYON RİSK/ÖDÜL HESAPLAYICILARI (Long / Short)
    if (settings.activeTool === 'position_long' || settings.activeTool === 'position_short') {
      const isLong = settings.activeTool === 'position_long';
      const targetRatio = 2.0; // Varsayılan 1:2 R:R
      const riskDelta = dataPoint.price * 0.03; // %3 risk
      const tpPrice = isLong ? dataPoint.price + riskDelta * targetRatio : dataPoint.price - riskDelta * targetRatio;
      const slPrice = isLong ? dataPoint.price - riskDelta : dataPoint.price + riskDelta;

      // Geleceğe doğru 15 bar genişlik
      const idx = sortedQuotes.findIndex((q) => (q.time as number) === dataPoint.time);
      const endIdx = Math.min(sortedQuotes.length - 1, (idx >= 0 ? idx : sortedQuotes.length - 1) + 12);
      const endTime = sortedQuotes[endIdx]?.time ? (sortedQuotes[endIdx].time as number) : dataPoint.time + 12 * 86400;

      const newItem: DrawingItem = {
        id: `draw_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        type: settings.activeTool,
        points: [
          dataPoint, // [0]: Giriş
          { time: endTime, price: tpPrice }, // [1]: TP seviyesi & genişlik
          { time: endTime, price: slPrice }, // [2]: SL seviyesi
        ],
        color: isLong ? '#3fb950' : '#f85149',
        lineWidth: 1,
        lineStyle: 'solid',
        fillOpacity: 0.15,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      onAddDrawing(newItem);
      onSelectTool('select');
      return;
    }

    // 6. ÇOK NOKTALI ARAÇLAR (Kanal, Fibo Genişlemesi, Trend, Ray, vb.)
    if (!inProgress) {
      if (settings.activeTool === 'channel' || settings.activeTool === 'fib_extension') {
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
        // 2 Noktalı Standart Araçlar (Trend, Ray, Extended, Rectangle, Fibonacci, Measure)
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
      }
    } else {
      // Araç devam ediyor: 2. veya 3. noktayı ekle
      if (inProgress.type === 'channel' || inProgress.type === 'fib_extension') {
        if (inProgress.points.length === 2) {
          // 2. nokta sabitlendi, 3. noktaya geç
          setInProgress({
            ...inProgress,
            points: [inProgress.points[0], inProgress.points[1], dataPoint],
          });
        } else if (inProgress.points.length >= 3) {
          // 3. nokta sabitlendi, çizimi bitir
          const finishedItem: DrawingItem = {
            ...inProgress,
            points: [inProgress.points[0], inProgress.points[1], dataPoint],
            updatedAt: Date.now(),
          };
          onAddDrawing(finishedItem);
          setInProgress(null);
          onSelectTool('select');
        }
      } else {
        // 2. noktayı sabitle ve bitir
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

    // Çizim esnasındaysak son noktayı güncelle
    if (inProgress) {
      if (inProgress.type === 'brush') {
        setInProgress((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            points: [...prev.points, dataPoint],
          };
        });
      } else if (inProgress.type === 'channel' || inProgress.type === 'fib_extension') {
        if (inProgress.points.length === 2) {
          setInProgress((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              points: [prev.points[0], dataPoint],
            };
          });
        } else if (inProgress.points.length >= 3) {
          setInProgress((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              points: [prev.points[0], prev.points[1], dataPoint],
            };
          });
        }
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
      if (!targetDrawing || targetDrawing.isLocked) return;

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
          // Sürükleyip bıraktıysa (Drag-to-draw) 2 noktalı çizimleri anında tamamla
          if (dist > 6 && inProgress.type !== 'channel' && inProgress.type !== 'fib_extension' && inProgress.points.length >= 2) {
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

  const startDraggingHandle = (e: React.MouseEvent, drawingId: string, handleIndex: number) => {
    e.stopPropagation();
    const target = drawings.find((d) => d.id === drawingId);
    if (!target || target.isLocked) return;

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

    onSelectId(drawingId);
    setDragState({
      drawingId,
      handleIndex,
      startPoint: dataPoint,
      initialPoints: [...target.points],
    });
  };

  const startDraggingBody = (e: React.MouseEvent, drawingId: string) => {
    if (settings.activeTool !== 'select') return;
    e.stopPropagation();
    const target = drawings.find((d) => d.id === drawingId);
    if (!target || target.isLocked) {
      onSelectId(drawingId);
      return;
    }

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

    onSelectId(drawingId);
    setDragState({
      drawingId,
      handleIndex: -1,
      startPoint: dataPoint,
      initialPoints: [...target.points],
    });
  };

  const handleSaveText = () => {
    if (textModal && textInputVal.trim()) {
      const newItem: DrawingItem = {
        id: `draw_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        type: textModal.isCallout ? 'callout' : 'text',
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
  const selectedDrawing = drawings.find((d) => d.id === selectedId);

  // Seçili çizimin üstünde yüzen hızlı işlem çubuğu konumu
  const floatingActionPos = useMemo(() => {
    if (!selectedDrawing || settings.activeTool !== 'select') return null;
    const screens = selectedDrawing.points
      .map((p) => pointToScreen(p, chart, series, sortedQuotes))
      .filter((s): s is { x: number; y: number } => s !== null);

    if (screens.length === 0) return null;
    const minX = Math.min(...screens.map((s) => s.x));
    const maxX = Math.max(...screens.map((s) => s.x));
    const minY = Math.min(...screens.map((s) => s.y));

    return {
      x: Math.max(10, Math.min(width - 240, (minX + maxX) / 2 - 100)),
      y: Math.max(10, minY - 42),
    };
  }, [selectedDrawing, settings.activeTool, chart, series, sortedQuotes, width]);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 25,
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
          zIndex: 25,
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
                <circle cx={snapScreen.x} cy={snapScreen.y} r={6} fill="none" stroke={settings.color} strokeWidth={1.5} opacity={0.8} />
                <circle cx={snapScreen.x} cy={snapScreen.y} r={2.5} fill={settings.color} />
              </g>
            );
          })()
        )}

        {/* Çizimleri Render Et */}
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
                () => onSelectId(item.id),
                (e) => startDraggingBody(e, item.id)
              )}

              {/* Seçili Nesnenin Tutamaç Noktaları (Vertex Handles) */}
              {isSelected &&
                !item.isLocked &&
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

      {/* YÜZEN HIZLI İŞLEM ÇUBUĞU (Floating Quick Action Bar on Selection) */}
      {selectedDrawing && floatingActionPos && (
        <div
          style={{
            position: 'absolute',
            left: floatingActionPos.x,
            top: floatingActionPos.y,
            zIndex: 100,
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: '6px',
            padding: '3px 6px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
            pointerEvents: 'auto',
          }}
        >
          {/* Renk Değiştirici */}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setShowColorPicker(!showColorPicker)}
              style={{
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                background: selectedDrawing.color,
                border: '1px solid rgba(255,255,255,0.4)',
                cursor: 'pointer',
                padding: 0,
              }}
            />
            {showColorPicker && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  left: 0,
                  zIndex: 110,
                  background: '#0d1117',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '6px',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, 1fr)',
                  gap: '4px',
                  width: '110px',
                }}
              >
                {DRAWING_PALETTE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      onUpdateDrawing(selectedDrawing.id, { color: c });
                      setShowColorPicker(false);
                    }}
                    style={{
                      width: '16px',
                      height: '16px',
                      borderRadius: '50%',
                      background: c,
                      border: selectedDrawing.color === c ? '2px solid #fff' : 'none',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Kalınlık */}
          <button
            type="button"
            onClick={() => onUpdateDrawing(selectedDrawing.id, { lineWidth: (selectedDrawing.lineWidth % 4) + 1 })}
            style={{
              padding: '2px 5px',
              fontSize: '0.68rem',
              background: '#21262d',
              color: '#fff',
              border: '1px solid #30363d',
              borderRadius: '4px',
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {selectedDrawing.lineWidth}px
          </button>

          {/* Stil */}
          <button
            type="button"
            onClick={() => {
              const nextStyle = selectedDrawing.lineStyle === 'solid' ? 'dashed' : selectedDrawing.lineStyle === 'dashed' ? 'dotted' : 'solid';
              onUpdateDrawing(selectedDrawing.id, { lineStyle: nextStyle });
            }}
            style={{
              padding: '2px 5px',
              fontSize: '0.68rem',
              background: '#21262d',
              color: '#fff',
              border: '1px solid #30363d',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            {selectedDrawing.lineStyle === 'solid' ? '—' : selectedDrawing.lineStyle === 'dashed' ? '- -' : '···'}
          </button>

          {/* Alarm Kur */}
          {onOpenAlertModal && (
            <button
              type="button"
              onClick={() => onOpenAlertModal(selectedDrawing)}
              title={i18n.t('drawSetAlert')}
              style={{
                background: 'transparent',
                border: 'none',
                color: selectedDrawing.hasAlert ? '#e3b341' : '#8b949e',
                cursor: 'pointer',
                padding: '2px 4px',
                display: 'flex',
              }}
            >
              <Bell size={13} />
            </button>
          )}

          {/* Kilitle / Aç */}
          <button
            type="button"
            onClick={() => onUpdateDrawing(selectedDrawing.id, { isLocked: !selectedDrawing.isLocked })}
            title={selectedDrawing.isLocked ? i18n.t('drawUnlock') : i18n.t('drawLock')}
            style={{
              background: 'transparent',
              border: 'none',
              color: selectedDrawing.isLocked ? '#f0883e' : '#8b949e',
              cursor: 'pointer',
              padding: '2px 4px',
              display: 'flex',
            }}
          >
            {selectedDrawing.isLocked ? <Lock size={13} /> : <Unlock size={13} />}
          </button>

          {/* Çoğalt (Clone) */}
          <button
            type="button"
            onClick={() => {
              const clone: DrawingItem = {
                ...selectedDrawing,
                id: `draw_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                points: selectedDrawing.points.map((p) => ({ time: p.time, price: p.price * 1.01 })),
                createdAt: Date.now(),
                updatedAt: Date.now(),
              };
              onAddDrawing(clone);
              onSelectId(clone.id);
            }}
            title={i18n.t('drawClone')}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#8b949e',
              cursor: 'pointer',
              padding: '2px 4px',
              display: 'flex',
            }}
          >
            <Copy size={13} />
          </button>

          {/* Sil */}
          <button
            type="button"
            onClick={() => onDeleteDrawing(selectedDrawing.id)}
            title={i18n.t('drawDeleteSelected')}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#f85149',
              cursor: 'pointer',
              padding: '2px 4px',
              display: 'flex',
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}

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

    const diff = item.points[1].price - item.points[0].price;
    const pct = item.points[0].price !== 0 ? (diff / item.points[0].price) * 100 : 0;

    return (
      <g onClick={onClick} onMouseDown={onMouseDown} style={{ pointerEvents: 'auto', cursor: 'pointer' }}>
        <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="transparent" strokeWidth={14} />
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
        {/* Opsiyonel Yüzde Rozeti */}
        {isSelected && (
          <g transform={`translate(${(p1.x + p2.x) / 2}, ${(p1.y + p2.y) / 2 - 12})`}>
            <rect x={-32} y={-8} width={64} height={16} rx={3} fill="#161b22" stroke={item.color} strokeWidth={1} />
            <text x={0} y={4} fill="#fff" fontSize="9" fontFamily="var(--font-mono)" textAnchor="middle">
              {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
            </text>
          </g>
        )}
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

  // 3. EXTENDED LINE (İki Yöne Sonsuz Uzatılmış Çizgi)
  if (item.type === 'extended_line' && item.points.length >= 2) {
    const p1 = pointToScreen(item.points[0], chart, series, sortedQuotes);
    const p2 = pointToScreen(item.points[1], chart, series, sortedQuotes);
    if (!p1 || !p2) return null;

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    let x1 = p1.x;
    let y1 = p1.y;
    let x2 = p2.x;
    let y2 = p2.y;

    if (length > 0) {
      const extend = Math.max(chartWidth, chartHeight) * 2;
      x1 = p1.x - (dx / length) * extend;
      y1 = p1.y - (dy / length) * extend;
      x2 = p2.x + (dx / length) * extend;
      y2 = p2.y + (dy / length) * extend;
    }

    return (
      <g onClick={onClick} onMouseDown={onMouseDown} style={{ pointerEvents: 'auto', cursor: 'pointer' }}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={14} />
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={item.color} strokeWidth={strokeWidth} strokeDasharray={strokeDasharray} />
      </g>
    );
  }

  // 4. HORIZONTAL (Yatay Seviye)
  if (item.type === 'horizontal' && item.points.length >= 1) {
    const p = pointToScreen(item.points[0], chart, series, sortedQuotes);
    if (!p) return null;

    return (
      <g onClick={onClick} onMouseDown={onMouseDown} style={{ pointerEvents: 'auto', cursor: 'pointer' }}>
        <line x1={0} y1={p.y} x2={chartWidth} y2={p.y} stroke="transparent" strokeWidth={14} />
        <line x1={0} y1={p.y} x2={chartWidth} y2={p.y} stroke={item.color} strokeWidth={strokeWidth} strokeDasharray={strokeDasharray} />
        <g transform={`translate(${chartWidth - 65}, ${p.y - 10})`}>
          <rect width={60} height={20} rx={3} fill={item.color} opacity={0.9} />
          <text x={30} y={14} fill="#fff" fontSize="10" fontFamily="var(--font-mono)" textAnchor="middle" fontWeight="bold">
            {item.points[0].price.toFixed(2)}
          </text>
        </g>
      </g>
    );
  }

  // 5. HORIZONTAL RAY (Yatay Işın)
  if (item.type === 'horizontal_ray' && item.points.length >= 1) {
    const p = pointToScreen(item.points[0], chart, series, sortedQuotes);
    if (!p) return null;

    return (
      <g onClick={onClick} onMouseDown={onMouseDown} style={{ pointerEvents: 'auto', cursor: 'pointer' }}>
        <line x1={p.x} y1={p.y} x2={chartWidth} y2={p.y} stroke="transparent" strokeWidth={14} />
        <line x1={p.x} y1={p.y} x2={chartWidth} y2={p.y} stroke={item.color} strokeWidth={strokeWidth} strokeDasharray={strokeDasharray} />
        <g transform={`translate(${chartWidth - 65}, ${p.y - 10})`}>
          <rect width={60} height={20} rx={3} fill={item.color} opacity={0.9} />
          <text x={30} y={14} fill="#fff" fontSize="10" fontFamily="var(--font-mono)" textAnchor="middle" fontWeight="bold">
            {item.points[0].price.toFixed(2)}
          </text>
        </g>
      </g>
    );
  }

  // 6. VERTICAL (Dikey Zaman Çizgisi)
  if (item.type === 'vertical' && item.points.length >= 1) {
    const p = pointToScreen(item.points[0], chart, series, sortedQuotes);
    if (!p) return null;

    const dateStr = new Date(item.points[0].time * 1000).toLocaleDateString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
    });

    return (
      <g onClick={onClick} onMouseDown={onMouseDown} style={{ pointerEvents: 'auto', cursor: 'pointer' }}>
        <line x1={p.x} y1={0} x2={p.x} y2={chartHeight} stroke="transparent" strokeWidth={14} />
        <line x1={p.x} y1={0} x2={p.x} y2={chartHeight} stroke={item.color} strokeWidth={strokeWidth} strokeDasharray={strokeDasharray} />
        <g transform={`translate(${p.x - 25}, ${chartHeight - 24})`}>
          <rect width={50} height={20} rx={3} fill="#161b22" stroke={item.color} strokeWidth={1} />
          <text x={25} y={14} fill="#fff" fontSize="10" fontFamily="var(--font-mono)" textAnchor="middle">
            {dateStr}
          </text>
        </g>
      </g>
    );
  }

  // 7. PARALLEL CHANNEL (Paralel Trend Kanalı - 3 Noktalı)
  if (item.type === 'channel' && item.points.length >= 2) {
    const p1 = pointToScreen(item.points[0], chart, series, sortedQuotes);
    const p2 = pointToScreen(item.points[1], chart, series, sortedQuotes);
    if (!p1 || !p2) return null;

    let dy = 0;
    if (item.points.length >= 3) {
      const p3 = pointToScreen(item.points[2], chart, series, sortedQuotes);
      if (p3) {
        dy = p3.y - p1.y;
      }
    }

    const p1b = { x: p1.x, y: p1.y + dy };
    const p2b = { x: p2.x, y: p2.y + dy };
    const p1m = { x: p1.x, y: p1.y + dy / 2 };
    const p2m = { x: p2.x, y: p2.y + dy / 2 };

    const polyPoints = `${p1.x},${p1.y} ${p2.x},${p2.y} ${p2b.x},${p2b.y} ${p1b.x},${p1b.y}`;

    return (
      <g onClick={onClick} onMouseDown={onMouseDown} style={{ pointerEvents: 'auto', cursor: 'pointer' }}>
        {/* Arka Plan Şeffaf Dolgu */}
        <polygon points={polyPoints} fill={item.color} fillOpacity={item.fillOpacity || 0.12} stroke="none" />
        {/* Üst Ana Çizgi */}
        <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={item.color} strokeWidth={strokeWidth} strokeDasharray={strokeDasharray} />
        {/* Alt Paralel Çizgi */}
        <line x1={p1b.x} y1={p1b.y} x2={p2b.x} y2={p2b.y} stroke={item.color} strokeWidth={strokeWidth} strokeDasharray={strokeDasharray} />
        {/* Orta Denge Çizgisi (Kesikli) */}
        <line x1={p1m.x} y1={p1m.y} x2={p2m.x} y2={p2m.y} stroke={item.color} strokeWidth={1} strokeDasharray="4,4" opacity={0.6} />
      </g>
    );
  }

  // 8. LONG / SHORT POZİSYON RİSK/ÖDÜL HESAPLAYICISI
  if ((item.type === 'position_long' || item.type === 'position_short') && item.points.length >= 3) {
    const pEntry = pointToScreen(item.points[0], chart, series, sortedQuotes);
    const pTP = pointToScreen(item.points[1], chart, series, sortedQuotes);
    const pSL = pointToScreen(item.points[2], chart, series, sortedQuotes);
    if (!pEntry || !pTP || !pSL) return null;

    const isLong = item.type === 'position_long';
    const entryPrice = item.points[0].price;
    const tpPrice = item.points[1].price;
    const slPrice = item.points[2].price;

    const reward = Math.abs(tpPrice - entryPrice);
    const risk = Math.abs(entryPrice - slPrice);
    const rrRatio = risk > 0 ? (reward / risk) : 0;
    const tpPct = entryPrice > 0 ? (reward / entryPrice) * 100 : 0;
    const slPct = entryPrice > 0 ? (risk / entryPrice) * 100 : 0;

    const minX = Math.min(pEntry.x, pTP.x);
    const maxX = Math.max(pEntry.x, pTP.x);
    const w = Math.max(40, maxX - minX);

    const greenY = isLong ? pTP.y : pEntry.y;
    const greenH = Math.abs(pTP.y - pEntry.y);
    const redY = isLong ? pEntry.y : pSL.y;
    const redH = Math.abs(pSL.y - pEntry.y);

    return (
      <g onClick={onClick} onMouseDown={onMouseDown} style={{ pointerEvents: 'auto', cursor: 'pointer' }}>
        {/* TP Yeşil Bölge */}
        <rect x={minX} y={greenY} width={w} height={greenH} fill="#3fb950" fillOpacity={0.18} stroke="#3fb950" strokeWidth={1} />
        {/* SL Kırmızı Bölge */}
        <rect x={minX} y={redY} width={w} height={redH} fill="#f85149" fillOpacity={0.18} stroke="#f85149" strokeWidth={1} />
        {/* Giriş Çizgisi */}
        <line x1={minX} y1={pEntry.y} x2={minX + w} y2={pEntry.y} stroke="#58a6ff" strokeWidth={2} />

        {/* Rozet: Risk/Ödül Oranı */}
        <g transform={`translate(${minX + w / 2 - 60}, ${pEntry.y - 12})`}>
          <rect width={120} height={24} rx={4} fill="#161b22" stroke="#58a6ff" strokeWidth={1.5} filter="url(#shadow)" />
          <text x={60} y={16} fill="#fff" fontSize="10" fontFamily="var(--font-mono)" textAnchor="middle" fontWeight="bold">
            R:R 1:{rrRatio.toFixed(2)}
          </text>
        </g>

        {/* TP Metni */}
        <text x={minX + 6} y={isLong ? pTP.y + 12 : pTP.y - 4} fill="#3fb950" fontSize="9" fontFamily="var(--font-mono)" fontWeight="bold">
          TP: {tpPrice.toFixed(2)} (+{tpPct.toFixed(1)}%)
        </text>

        {/* SL Metni */}
        <text x={minX + 6} y={isLong ? pSL.y - 4 : pSL.y + 12} fill="#f85149" fontSize="9" fontFamily="var(--font-mono)" fontWeight="bold">
          SL: {slPrice.toFixed(2)} (-{slPct.toFixed(1)}%)
        </text>
      </g>
    );
  }

  // 9. RECTANGLE (Dikdörtgen / Arz-Talep Bölgesi)
  if (item.type === 'rectangle' && item.points.length >= 2) {
    const p1 = pointToScreen(item.points[0], chart, series, sortedQuotes);
    const p2 = pointToScreen(item.points[1], chart, series, sortedQuotes);
    if (!p1 || !p2) return null;

    const minX = Math.min(p1.x, p2.x);
    const maxX = Math.max(p1.x, p2.x);
    const minY = Math.min(p1.y, p2.y);
    const maxY = Math.max(p1.y, p2.y);
    const w = maxX - minX;
    const h = maxY - minY;

    return (
      <g onClick={onClick} onMouseDown={onMouseDown} style={{ pointerEvents: 'auto', cursor: 'pointer' }}>
        <rect
          x={minX}
          y={minY}
          width={w}
          height={h}
          fill={item.fillColor || item.color}
          fillOpacity={item.fillOpacity || 0.12}
          stroke={item.color}
          strokeWidth={strokeWidth}
          strokeDasharray={strokeDasharray}
        />
        {item.text && (
          <text x={minX + 8} y={minY + 16} fill={item.color} fontSize="11" fontWeight="bold">
            {item.text}
          </text>
        )}
      </g>
    );
  }

  // 10. FIBONACCI DÜZELTMESİ (Retracement)
  if (item.type === 'fibonacci' && item.points.length >= 2) {
    const p1 = pointToScreen(item.points[0], chart, series, sortedQuotes);
    const p2 = pointToScreen(item.points[1], chart, series, sortedQuotes);
    if (!p1 || !p2) return null;

    const startPrice = item.points[0].price;
    const endPrice = item.points[1].price;
    const priceDiff = endPrice - startPrice;
    const minX = Math.min(p1.x, p2.x);
    const maxX = Math.max(p1.x, p2.x, chartWidth - 70);

    return (
      <g onClick={onClick} onMouseDown={onMouseDown} style={{ pointerEvents: 'auto', cursor: 'pointer' }}>
        {FIBONACCI_LEVELS.map((fib) => {
          const targetPrice = startPrice + priceDiff * fib.level;
          const screen = pointToScreen({ time: item.points[0].time, price: targetPrice }, chart, series, sortedQuotes);
          if (!screen) return null;

          return (
            <g key={fib.level}>
              <line x1={minX} y1={screen.y} x2={maxX} y2={screen.y} stroke={fib.color} strokeWidth={1} opacity={0.8} />
              <text x={minX + 4} y={screen.y - 3} fill={fib.color} fontSize="10" fontFamily="var(--font-mono)">
                {fib.label} - {targetPrice.toFixed(2)}
              </text>
            </g>
          );
        })}
      </g>
    );
  }

  // 11. FIBONACCI GENİŞLEMESİ (Extension - 3 Noktalı)
  if (item.type === 'fib_extension' && item.points.length >= 3) {
    const p1 = pointToScreen(item.points[0], chart, series, sortedQuotes);
    const p2 = pointToScreen(item.points[1], chart, series, sortedQuotes);
    const p3 = pointToScreen(item.points[2], chart, series, sortedQuotes);
    if (!p1 || !p2 || !p3) return null;

    const waveHeight = item.points[1].price - item.points[0].price;
    const basePrice = item.points[2].price;
    const minX = Math.min(p1.x, p2.x, p3.x);
    const maxX = Math.max(p1.x, p2.x, p3.x, chartWidth - 70);

    return (
      <g onClick={onClick} onMouseDown={onMouseDown} style={{ pointerEvents: 'auto', cursor: 'pointer' }}>
        {/* Dalga Kılavuz Çizgileri */}
        <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={item.color} strokeWidth={1} strokeDasharray="3,3" opacity={0.6} />
        <line x1={p2.x} y1={p2.y} x2={p3.x} y2={p3.y} stroke={item.color} strokeWidth={1} strokeDasharray="3,3" opacity={0.6} />

        {FIBONACCI_EXTENSION_LEVELS.map((fib) => {
          const targetPrice = basePrice + waveHeight * fib.level;
          const screen = pointToScreen({ time: item.points[2].time, price: targetPrice }, chart, series, sortedQuotes);
          if (!screen) return null;

          return (
            <g key={fib.level}>
              <line x1={minX} y1={screen.y} x2={maxX} y2={screen.y} stroke={fib.color} strokeWidth={1} opacity={0.8} />
              <text x={minX + 4} y={screen.y - 3} fill={fib.color} fontSize="10" fontFamily="var(--font-mono)">
                Ext {fib.label} ({targetPrice.toFixed(2)})
              </text>
            </g>
          );
        })}
      </g>
    );
  }

  // 12. BRUSH (Serbest Çizim)
  if (item.type === 'brush' && item.points.length > 0) {
    const screenPoints = item.points
      .map((pt) => pointToScreen(pt, chart, series, sortedQuotes))
      .filter((p): p is { x: number; y: number } => p !== null);

    if (screenPoints.length < 2) return null;
    const d = pointsToSmoothSvgPath(screenPoints);

    return (
      <g onClick={onClick} onMouseDown={onMouseDown} style={{ pointerEvents: 'auto', cursor: 'pointer' }}>
        <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
        <path d={d} fill="none" stroke={item.color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    );
  }

  // 13. SİNYAL OKLARI (Arrow Up / Arrow Down)
  if ((item.type === 'arrow_up' || item.type === 'arrow_down') && item.points.length >= 1) {
    const p = pointToScreen(item.points[0], chart, series, sortedQuotes);
    if (!p) return null;

    const isUp = item.type === 'arrow_up';
    const color = isUp ? '#3fb950' : '#f85149';
    const size = 18;

    return (
      <g onClick={onClick} onMouseDown={onMouseDown} transform={`translate(${p.x}, ${p.y})`} style={{ pointerEvents: 'auto', cursor: 'pointer' }}>
        <polygon
          points={isUp ? `0,-${size} -${size / 2},0 ${size / 2},0` : `0,${size} -${size / 2},0 ${size / 2},0`}
          fill={color}
          stroke="#fff"
          strokeWidth={1}
          filter="url(#shadow)"
        />
      </g>
    );
  }

  // 14. TEXT & CALLOUT
  if ((item.type === 'text' || item.type === 'callout') && item.points.length >= 1) {
    const p = pointToScreen(item.points[0], chart, series, sortedQuotes);
    if (!p) return null;

    const label = item.text || 'Not';
    const textWidth = Math.max(60, label.length * 7.5 + 16);

    return (
      <g onClick={onClick} onMouseDown={onMouseDown} transform={`translate(${p.x}, ${p.y - 12})`} style={{ pointerEvents: 'auto', cursor: 'pointer' }}>
        {item.type === 'callout' && (
          <line x1={0} y1={12} x2={-10} y2={22} stroke={item.color} strokeWidth={1.5} />
        )}
        <rect x={0} y={0} width={textWidth} height={22} rx={4} fill="#161b22" stroke={item.color} strokeWidth={strokeWidth} filter="url(#shadow)" />
        <text x={textWidth / 2} y={15} fill="#fff" fontSize="11" fontFamily="var(--font-sans, system-ui)" textAnchor="middle" fontWeight="500">
          {label}
        </text>
      </g>
    );
  }

  // 15. MEASURE (Ölçüm Aracı)
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
        <rect x={minX} y={minY} width={w} height={h} fill={badgeColor} fillOpacity={0.12} stroke={badgeColor} strokeWidth={1} strokeDasharray="4,4" />
        <line x1={s1.x} y1={s1.y} x2={s2.x} y2={s2.y} stroke={badgeColor} strokeWidth={2} />
        <g transform={`translate(${(s1.x + s2.x) / 2 - 80}, ${(s1.y + s2.y) / 2 - 12})`}>
          <rect width={160} height={24} rx={4} fill="#161b22" stroke={badgeColor} strokeWidth={1.5} filter="url(#shadow)" />
          <text x={80} y={16} fill={badgeColor} fontSize="11" fontFamily="var(--font-mono)" textAnchor="middle" fontWeight="bold">
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

  if ((item.type === 'trendline' || item.type === 'ray') && item.points.length >= 2) {
    const p1 = pointToScreen(item.points[0], chart, series, sortedQuotes);
    const p2 = pointToScreen(item.points[1], chart, series, sortedQuotes);
    if (!p1 || !p2) return false;
    return distanceToSegment(mouse, p1, p2) <= THRESHOLD;
  }

  if (item.type === 'extended_line' && item.points.length >= 2) {
    const p1 = pointToScreen(item.points[0], chart, series, sortedQuotes);
    const p2 = pointToScreen(item.points[1], chart, series, sortedQuotes);
    if (!p1 || !p2) return false;
    return distanceToInfiniteLine(mouse, p1, p2) <= THRESHOLD;
  }

  if (item.type === 'horizontal' && item.points.length >= 1) {
    const p = pointToScreen(item.points[0], chart, series, sortedQuotes);
    if (!p) return false;
    return Math.abs(mouse.y - p.y) <= THRESHOLD;
  }

  if (item.type === 'horizontal_ray' && item.points.length >= 1) {
    const p = pointToScreen(item.points[0], chart, series, sortedQuotes);
    if (!p) return false;
    return mouse.x >= p.x - 4 && Math.abs(mouse.y - p.y) <= THRESHOLD;
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

  if (item.type === 'text' || item.type === 'callout' || item.type === 'arrow_up' || item.type === 'arrow_down') {
    if (item.points.length >= 1) {
      const p = pointToScreen(item.points[0], chart, series, sortedQuotes);
      if (!p) return false;
      return distanceBetween(mouse, p) <= 24;
    }
  }

  return false;
}
