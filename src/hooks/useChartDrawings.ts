import { useState, useEffect, useCallback, useRef } from 'react';
import type { DrawingItem, DrawingToolSettings, DrawingToolType } from '../features/ticker/drawingTypes';
import {
  getLocalDrawings,
  saveLocalDrawings,
  queueCloudSync,
  syncAndFetchDrawings,
} from '../features/ticker/chartDrawingStorage';

const DEFAULT_SETTINGS: DrawingToolSettings = {
  activeTool: 'select',
  color: '#58a6ff',
  lineWidth: 2,
  lineStyle: 'solid',
  fillOpacity: 0.15,
  magnetEnabled: false,
  isVisible: true,
};

export function useChartDrawings(ticker: string) {
  const normTicker = ticker.toUpperCase().trim();
  const [drawings, setDrawings] = useState<DrawingItem[]>(() => getLocalDrawings(normTicker));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settings, setSettings] = useState<DrawingToolSettings>(DEFAULT_SETTINGS);

  // Undo / Redo yığınları
  const historyRef = useRef<DrawingItem[][]>([getLocalDrawings(normTicker)]);
  const historyIndexRef = useRef<number>(0);
  const isInternalUpdateRef = useRef<boolean>(false);

  const pushHistory = useCallback((nextState: DrawingItem[]) => {
    const nextIndex = historyIndexRef.current + 1;
    const nextHistory = historyRef.current.slice(0, nextIndex);
    nextHistory.push(nextState);
    historyRef.current = nextHistory;
    historyIndexRef.current = nextIndex;
  }, []);

  // Ticker değiştiğinde çizimleri yükle ve bulutla eşle
  useEffect(() => {
    const initial = getLocalDrawings(normTicker);
    setDrawings(initial);
    historyRef.current = [initial];
    historyIndexRef.current = 0;
    setSelectedId(null);

    // Supabase bulutundan çek
    syncAndFetchDrawings(normTicker, (remote) => {
      setDrawings(remote);
      historyRef.current = [remote];
      historyIndexRef.current = 0;
    });
  }, [normTicker]);

  // Çizimleri kaydetme ve yayınlama
  const commitDrawings = useCallback(
    (nextDrawings: DrawingItem[] | ((prev: DrawingItem[]) => DrawingItem[])) => {
      setDrawings((prev) => {
        const next = typeof nextDrawings === 'function' ? nextDrawings(prev) : nextDrawings;
        saveLocalDrawings(normTicker, next);
        queueCloudSync(normTicker, next);
        if (!isInternalUpdateRef.current) {
          pushHistory(next);
        }
        return next;
      });
    },
    [normTicker, pushHistory]
  );

  const addDrawing = useCallback(
    (item: DrawingItem) => {
      commitDrawings((prev) => [...prev, item]);
      setSelectedId(item.id);
    },
    [commitDrawings]
  );

  const updateDrawing = useCallback(
    (id: string, patch: Partial<DrawingItem>) => {
      commitDrawings((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, ...patch, updatedAt: Date.now() }
            : item
        )
      );
    },
    [commitDrawings]
  );

  const deleteDrawing = useCallback(
    (id: string) => {
      commitDrawings((prev) => prev.filter((item) => item.id !== id));
      if (selectedId === id) setSelectedId(null);
    },
    [commitDrawings, selectedId]
  );

  const clearDrawings = useCallback(() => {
    commitDrawings([]);
    setSelectedId(null);
  }, [commitDrawings]);

  const undo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      historyIndexRef.current -= 1;
      const targetState = historyRef.current[historyIndexRef.current];
      isInternalUpdateRef.current = true;
      setDrawings(targetState);
      saveLocalDrawings(normTicker, targetState);
      queueCloudSync(normTicker, targetState);
      setSelectedId(null);
      isInternalUpdateRef.current = false;
    }
  }, [normTicker]);

  const redo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current += 1;
      const targetState = historyRef.current[historyIndexRef.current];
      isInternalUpdateRef.current = true;
      setDrawings(targetState);
      saveLocalDrawings(normTicker, targetState);
      queueCloudSync(normTicker, targetState);
      setSelectedId(null);
      isInternalUpdateRef.current = false;
    }
  }, [normTicker]);

  const setActiveTool = useCallback((tool: DrawingToolType) => {
    setSettings((prev) => ({ ...prev, activeTool: tool }));
    if (tool !== 'select') {
      setSelectedId(null);
    }
  }, []);

  const toggleMagnet = useCallback(() => {
    setSettings((prev) => ({ ...prev, magnetEnabled: !prev.magnetEnabled }));
  }, []);

  const toggleVisibility = useCallback(() => {
    setSettings((prev) => ({ ...prev, isVisible: !prev.isVisible }));
  }, []);

  const setColor = useCallback((color: string) => {
    setSettings((prev) => ({ ...prev, color }));
    if (selectedId) {
      updateDrawing(selectedId, { color });
    }
  }, [selectedId, updateDrawing]);

  const setLineWidth = useCallback((lineWidth: number) => {
    setSettings((prev) => ({ ...prev, lineWidth }));
    if (selectedId) {
      updateDrawing(selectedId, { lineWidth });
    }
  }, [selectedId, updateDrawing]);

  const setLineStyle = useCallback((lineStyle: 'solid' | 'dashed' | 'dotted') => {
    setSettings((prev) => ({ ...prev, lineStyle }));
    if (selectedId) {
      updateDrawing(selectedId, { lineStyle });
    }
  }, [selectedId, updateDrawing]);

  // Dış olay dinleyicisi (farklı sekmeler veya bileşenler arası senkronizasyon)
  useEffect(() => {
    const handleStorageEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ ticker: string; drawings: DrawingItem[] }>;
      if (customEvent.detail && customEvent.detail.ticker === normTicker) {
        setDrawings(customEvent.detail.drawings);
      }
    };
    window.addEventListener('fraude-chart-drawings-changed', handleStorageEvent);
    return () => window.removeEventListener('fraude-chart-drawings-changed', handleStorageEvent);
  }, [normTicker]);

  return {
    drawings,
    selectedId,
    setSelectedId,
    settings,
    setSettings,
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
    canUndo: historyIndexRef.current > 0,
    canRedo: historyIndexRef.current < historyRef.current.length - 1,
  };
}
