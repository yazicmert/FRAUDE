import React, { useState, useRef, useEffect } from 'react';
import {
  MousePointer2,
  TrendingUp,
  MoveUpRight,
  Minus,
  Split,
  Square,
  Percent,
  Pencil,
  Type,
  Ruler,
  Magnet,
  Undo2,
  Redo2,
  Eye,
  EyeOff,
  Trash2,
  RotateCcw,
} from 'lucide-react';
import i18n from '../../i18n';
import type { DrawingToolType, DrawingToolSettings, LineStyle } from './drawingTypes';
import { DRAWING_PALETTE_COLORS } from './drawingTypes';

interface ChartDrawingToolbarProps {
  settings: DrawingToolSettings;
  onSelectTool: (tool: DrawingToolType) => void;
  onToggleMagnet: () => void;
  onToggleVisibility: () => void;
  onSetColor: (color: string) => void;
  onSetLineWidth: (width: number) => void;
  onSetLineStyle: (style: LineStyle) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  selectedId: string | null;
  onDeleteSelected: () => void;
  onClearAll: () => void;
}

export default function ChartDrawingToolbar({
  settings,
  onSelectTool,
  onToggleMagnet,
  onToggleVisibility,
  onSetColor,
  onSetLineWidth,
  onSetLineStyle,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  selectedId,
  onDeleteSelected,
  onClearAll,
}: ChartDrawingToolbarProps) {
  const [showColorMenu, setShowColorMenu] = useState(false);
  const colorMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (colorMenuRef.current && !colorMenuRef.current.contains(e.target as Node)) {
        setShowColorMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const tools: Array<{
    id: DrawingToolType;
    icon: React.ReactNode;
    title: string;
    shortcut?: string;
  }> = [
    { id: 'select', icon: <MousePointer2 size={14} />, title: i18n.t('drawSelect'), shortcut: 'V' },
    { id: 'trendline', icon: <TrendingUp size={14} />, title: i18n.t('drawTrendline'), shortcut: 'T' },
    { id: 'ray', icon: <MoveUpRight size={14} />, title: i18n.t('drawRay'), shortcut: 'R' },
    { id: 'horizontal', icon: <Minus size={14} />, title: i18n.t('drawHorizontal'), shortcut: 'H' },
    { id: 'vertical', icon: <Split size={14} style={{ transform: 'rotate(90deg)' }} />, title: i18n.t('drawVertical'), shortcut: 'D' },
    { id: 'rectangle', icon: <Square size={14} />, title: i18n.t('drawRectangle'), shortcut: 'B' },
    { id: 'fibonacci', icon: <Percent size={14} />, title: i18n.t('drawFibonacci'), shortcut: 'F' },
    { id: 'brush', icon: <Pencil size={14} />, title: i18n.t('drawBrush'), shortcut: 'P' },
    { id: 'text', icon: <Type size={14} />, title: i18n.t('drawText'), shortcut: 'N' },
    { id: 'measure', icon: <Ruler size={14} />, title: i18n.t('drawMeasure'), shortcut: 'M' },
  ];

  const handleClearAllWithConfirm = () => {
    if (window.confirm(i18n.t('drawClearConfirm'))) {
      onClearAll();
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        background: '#161b22',
        border: '1px solid #30363d',
        borderRadius: '6px',
        padding: '3px 6px',
        fontSize: '0.75rem',
        userSelect: 'none',
        flexWrap: 'wrap',
      }}
    >
      {/* Çizim Araçları */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
        {tools.map((t) => {
          const isActive = settings.activeTool === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelectTool(t.id)}
              title={`${t.title}${t.shortcut ? ` (${t.shortcut})` : ''}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '26px',
                height: '26px',
                padding: 0,
                background: isActive ? '#1f6feb33' : 'transparent',
                color: isActive ? '#58a6ff' : '#8b949e',
                border: `1px solid ${isActive ? '#1f6feb66' : 'transparent'}`,
                borderRadius: '4px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {t.icon}
            </button>
          );
        })}
      </div>

      <div style={{ width: '1px', height: '18px', background: '#30363d', margin: '0 4px' }} />

      {/* Mıknatıs (Magnet) */}
      <button
        type="button"
        onClick={onToggleMagnet}
        title={i18n.t('drawMagnet')}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '26px',
          height: '26px',
          padding: 0,
          background: settings.magnetEnabled ? '#23863633' : 'transparent',
          color: settings.magnetEnabled ? '#3fb950' : '#8b949e',
          border: `1px solid ${settings.magnetEnabled ? '#23863666' : 'transparent'}`,
          borderRadius: '4px',
          cursor: 'pointer',
        }}
      >
        <Magnet size={14} />
      </button>

      {/* Renk ve Çizgi Kalınlığı Paleti */}
      <div style={{ position: 'relative' }} ref={colorMenuRef}>
        <button
          type="button"
          onClick={() => setShowColorMenu((prev) => !prev)}
          title={i18n.t('drawColor')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            height: '26px',
            padding: '0 6px',
            background: '#21262d',
            color: '#c9d1d9',
            border: '1px solid #30363d',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              background: settings.color,
              border: '1px solid rgba(255,255,255,0.3)',
            }}
          />
          <span style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)' }}>{settings.lineWidth}px</span>
        </button>

        {showColorMenu && (
          <div
            style={{
              position: 'absolute',
              top: '32px',
              left: 0,
              zIndex: 100,
              background: '#161b22',
              border: '1px solid #30363d',
              borderRadius: '6px',
              padding: '8px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
              minWidth: '160px',
            }}
          >
            <div style={{ fontSize: '0.68rem', color: '#8b949e', marginBottom: '6px' }}>{i18n.t('drawColor')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', marginBottom: '10px' }}>
              {DRAWING_PALETTE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    onSetColor(c);
                    setShowColorMenu(false);
                  }}
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    background: c,
                    border: settings.color === c ? '2px solid #fff' : '1px solid rgba(255,255,255,0.2)',
                    cursor: 'pointer',
                  }}
                />
              ))}
            </div>

            <div style={{ fontSize: '0.68rem', color: '#8b949e', marginBottom: '4px' }}>{i18n.t('drawLineWidth')}</div>
            <div style={{ display: 'flex', gap: '4px', marginBottom: '10px' }}>
              {[1, 2, 3, 4].map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => {
                    onSetLineWidth(w);
                    setShowColorMenu(false);
                  }}
                  style={{
                    flex: 1,
                    padding: '2px 0',
                    fontSize: '0.68rem',
                    background: settings.lineWidth === w ? '#1f6feb33' : '#21262d',
                    color: settings.lineWidth === w ? '#58a6ff' : '#8b949e',
                    border: `1px solid ${settings.lineWidth === w ? '#1f6feb66' : '#30363d'}`,
                    borderRadius: '3px',
                    cursor: 'pointer',
                  }}
                >
                  {w}px
                </button>
              ))}
            </div>

            <div style={{ fontSize: '0.68rem', color: '#8b949e', marginBottom: '4px' }}>{i18n.t('drawLineStyle')}</div>
            <div style={{ display: 'flex', gap: '4px' }}>
              {(['solid', 'dashed', 'dotted'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => {
                    onSetLineStyle(st);
                    setShowColorMenu(false);
                  }}
                  style={{
                    flex: 1,
                    padding: '2px 0',
                    fontSize: '0.65rem',
                    background: settings.lineStyle === st ? '#1f6feb33' : '#21262d',
                    color: settings.lineStyle === st ? '#58a6ff' : '#8b949e',
                    border: `1px solid ${settings.lineStyle === st ? '#1f6feb66' : '#30363d'}`,
                    borderRadius: '3px',
                    cursor: 'pointer',
                  }}
                >
                  {st === 'solid' ? i18n.t('drawStyleSolid') : st === 'dashed' ? i18n.t('drawStyleDashed') : i18n.t('drawStyleDotted')}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ width: '1px', height: '18px', background: '#30363d', margin: '0 4px' }} />

      {/* Geri Al / İleri Al */}
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        title={i18n.t('drawUndo')}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '26px',
          height: '26px',
          padding: 0,
          background: 'transparent',
          color: canUndo ? '#c9d1d9' : '#484f58',
          border: 'none',
          borderRadius: '4px',
          cursor: canUndo ? 'pointer' : 'default',
        }}
      >
        <Undo2 size={14} />
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        title={i18n.t('drawRedo')}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '26px',
          height: '26px',
          padding: 0,
          background: 'transparent',
          color: canRedo ? '#c9d1d9' : '#484f58',
          border: 'none',
          borderRadius: '4px',
          cursor: canRedo ? 'pointer' : 'default',
        }}
      >
        <Redo2 size={14} />
      </button>

      {/* Gizle / Göster */}
      <button
        type="button"
        onClick={onToggleVisibility}
        title={settings.isVisible ? i18n.t('drawHide') : i18n.t('drawShow')}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '26px',
          height: '26px',
          padding: 0,
          background: 'transparent',
          color: settings.isVisible ? '#c9d1d9' : '#e3b341',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
        }}
      >
        {settings.isVisible ? <Eye size={14} /> : <EyeOff size={14} />}
      </button>

      {/* Seçileni Sil */}
      {selectedId && (
        <button
          type="button"
          onClick={onDeleteSelected}
          title={i18n.t('drawDeleteSelected')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '26px',
            height: '26px',
            padding: 0,
            background: '#f8514922',
            color: '#f85149',
            border: '1px solid #f8514955',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          <Trash2 size={14} />
        </button>
      )}

      {/* Tümünü Temizle */}
      <button
        type="button"
        onClick={handleClearAllWithConfirm}
        title={i18n.t('drawClearAll')}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '26px',
          height: '26px',
          padding: 0,
          background: 'transparent',
          color: '#8b949e',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
        }}
      >
        <RotateCcw size={14} />
      </button>
    </div>
  );
}
