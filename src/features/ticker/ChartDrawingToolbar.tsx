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
  Layers,
  ArrowUp,
  ArrowDown,
  MessageSquare,
  Target,
  Maximize2,
  ChevronDown,
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
  onOpenManager: () => void;
  drawingsCount: number;
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
  onOpenManager,
  drawingsCount,
}: ChartDrawingToolbarProps) {
  const [showColorMenu, setShowColorMenu] = useState(false);
  const [showWidthMenu, setShowWidthMenu] = useState(false);
  const [showLinesMenu, setShowLinesMenu] = useState(false);
  const [showFiboMenu, setShowFiboMenu] = useState(false);
  const [showPosMenu, setShowPosMenu] = useState(false);
  const [showAnnoMenu, setShowAnnoMenu] = useState(false);

  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setShowColorMenu(false);
        setShowWidthMenu(false);
        setShowLinesMenu(false);
        setShowFiboMenu(false);
        setShowPosMenu(false);
        setShowAnnoMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isToolActive = (t: DrawingToolType) => settings.activeTool === t;

  return (
    <div
      ref={toolbarRef}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        background: '#161b22',
        border: '1px solid #30363d',
        borderRadius: '6px',
        padding: '4px 8px',
        fontSize: '0.75rem',
        color: '#c9d1d9',
        flexWrap: 'wrap',
        position: 'relative',
        boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
      }}
    >
      {/* 1. SEÇ / İMLEÇ */}
      <button
        type="button"
        style={btnStyle(isToolActive('select'))}
        onClick={() => onSelectTool('select')}
        title={`${i18n.t('drawSelect')} (V / Esc)`}
      >
        <MousePointer2 size={14} />
      </button>

      <span style={dividerStyle} />

      {/* 2. ÇİZGİLER (Trend, Işın, Sonsuz, Yatay, Dikey) */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          style={btnStyle(
            isToolActive('trendline') ||
            isToolActive('ray') ||
            isToolActive('extended_line') ||
            isToolActive('horizontal') ||
            isToolActive('horizontal_ray') ||
            isToolActive('vertical')
          )}
          onClick={() => setShowLinesMenu(!showLinesMenu)}
          title="Çizgiler & Işınlar"
        >
          {isToolActive('ray') ? <MoveUpRight size={14} /> :
           isToolActive('horizontal') ? <Minus size={14} /> :
           isToolActive('vertical') ? <Split size={14} style={{ transform: 'rotate(90deg)' }} /> :
           isToolActive('extended_line') ? <Maximize2 size={14} /> :
           <TrendingUp size={14} />}
          <ChevronDown size={10} style={{ marginLeft: 2, opacity: 0.7 }} />
        </button>

        {showLinesMenu && (
          <div style={dropdownMenuStyle}>
            <div style={dropdownItemStyle(isToolActive('trendline'))} onClick={() => { onSelectTool('trendline'); setShowLinesMenu(false); }}>
              <TrendingUp size={14} /> <span>{i18n.t('drawTrendline')} (T)</span>
            </div>
            <div style={dropdownItemStyle(isToolActive('ray'))} onClick={() => { onSelectTool('ray'); setShowLinesMenu(false); }}>
              <MoveUpRight size={14} /> <span>{i18n.t('drawRay')} (R)</span>
            </div>
            <div style={dropdownItemStyle(isToolActive('extended_line'))} onClick={() => { onSelectTool('extended_line'); setShowLinesMenu(false); }}>
              <Maximize2 size={14} /> <span>{i18n.t('drawExtendedLine')}</span>
            </div>
            <div style={dropdownItemStyle(isToolActive('horizontal'))} onClick={() => { onSelectTool('horizontal'); setShowLinesMenu(false); }}>
              <Minus size={14} /> <span>{i18n.t('drawHorizontal')} (H)</span>
            </div>
            <div style={dropdownItemStyle(isToolActive('horizontal_ray'))} onClick={() => { onSelectTool('horizontal_ray'); setShowLinesMenu(false); }}>
              <MoveUpRight size={14} style={{ transform: 'rotate(-45deg)' }} /> <span>{i18n.t('drawHorizontalRay')}</span>
            </div>
            <div style={dropdownItemStyle(isToolActive('vertical'))} onClick={() => { onSelectTool('vertical'); setShowLinesMenu(false); }}>
              <Split size={14} style={{ transform: 'rotate(90deg)' }} /> <span>{i18n.t('drawVertical')} (D)</span>
            </div>
          </div>
        )}
      </div>

      {/* 3. KANALLAR & FIBONACCI */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          style={btnStyle(isToolActive('channel') || isToolActive('fibonacci') || isToolActive('fib_extension'))}
          onClick={() => setShowFiboMenu(!showFiboMenu)}
          title="Kanal & Fibonacci"
        >
          {isToolActive('channel') ? <Layers size={14} /> : <Percent size={14} />}
          <ChevronDown size={10} style={{ marginLeft: 2, opacity: 0.7 }} />
        </button>

        {showFiboMenu && (
          <div style={dropdownMenuStyle}>
            <div style={dropdownItemStyle(isToolActive('channel'))} onClick={() => { onSelectTool('channel'); setShowFiboMenu(false); }}>
              <Layers size={14} /> <span>{i18n.t('drawChannel')} (C)</span>
            </div>
            <div style={dropdownItemStyle(isToolActive('fibonacci'))} onClick={() => { onSelectTool('fibonacci'); setShowFiboMenu(false); }}>
              <Percent size={14} /> <span>{i18n.t('drawFibonacci')} (F)</span>
            </div>
            <div style={dropdownItemStyle(isToolActive('fib_extension'))} onClick={() => { onSelectTool('fib_extension'); setShowFiboMenu(false); }}>
              <Target size={14} /> <span>{i18n.t('drawFibExtension')} (E)</span>
            </div>
          </div>
        )}
      </div>

      {/* 4. POZİSYON RİSK/ÖDÜL & ÖLÇÜM */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          style={btnStyle(isToolActive('position_long') || isToolActive('position_short') || isToolActive('measure'))}
          onClick={() => setShowPosMenu(!showPosMenu)}
          title="Risk/Ödül Pozisyon & Ölçüm"
        >
          {isToolActive('position_long') ? <Target size={14} color="#3fb950" /> :
           isToolActive('position_short') ? <Target size={14} color="#f85149" /> :
           <Ruler size={14} />}
          <ChevronDown size={10} style={{ marginLeft: 2, opacity: 0.7 }} />
        </button>

        {showPosMenu && (
          <div style={dropdownMenuStyle}>
            <div style={dropdownItemStyle(isToolActive('position_long'))} onClick={() => { onSelectTool('position_long'); setShowPosMenu(false); }}>
              <Target size={14} color="#3fb950" /> <span>{i18n.t('drawPositionLong')} (L)</span>
            </div>
            <div style={dropdownItemStyle(isToolActive('position_short'))} onClick={() => { onSelectTool('position_short'); setShowPosMenu(false); }}>
              <Target size={14} color="#f85149" /> <span>{i18n.t('drawPositionShort')} (S)</span>
            </div>
            <div style={dropdownItemStyle(isToolActive('measure'))} onClick={() => { onSelectTool('measure'); setShowPosMenu(false); }}>
              <Ruler size={14} /> <span>{i18n.t('drawMeasure')} (M)</span>
            </div>
          </div>
        )}
      </div>

      {/* 5. ŞEKİLLER & ALAN (Kutu) */}
      <button
        type="button"
        style={btnStyle(isToolActive('rectangle'))}
        onClick={() => onSelectTool('rectangle')}
        title={`${i18n.t('drawRectangle')} (B)`}
      >
        <Square size={14} />
      </button>

      {/* 6. İŞARETLEYİCİLER & NOTLAR */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          style={btnStyle(
            isToolActive('brush') ||
            isToolActive('text') ||
            isToolActive('callout') ||
            isToolActive('arrow_up') ||
            isToolActive('arrow_down')
          )}
          onClick={() => setShowAnnoMenu(!showAnnoMenu)}
          title="Notlar, İşaretçiler & Fırça"
        >
          {isToolActive('text') ? <Type size={14} /> :
           isToolActive('callout') ? <MessageSquare size={14} /> :
           isToolActive('arrow_up') ? <ArrowUp size={14} color="#3fb950" /> :
           isToolActive('arrow_down') ? <ArrowDown size={14} color="#f85149" /> :
           <Pencil size={14} />}
          <ChevronDown size={10} style={{ marginLeft: 2, opacity: 0.7 }} />
        </button>

        {showAnnoMenu && (
          <div style={dropdownMenuStyle}>
            <div style={dropdownItemStyle(isToolActive('brush'))} onClick={() => { onSelectTool('brush'); setShowAnnoMenu(false); }}>
              <Pencil size={14} /> <span>{i18n.t('drawBrush')} (P)</span>
            </div>
            <div style={dropdownItemStyle(isToolActive('text'))} onClick={() => { onSelectTool('text'); setShowAnnoMenu(false); }}>
              <Type size={14} /> <span>{i18n.t('drawText')} (N)</span>
            </div>
            <div style={dropdownItemStyle(isToolActive('callout'))} onClick={() => { onSelectTool('callout'); setShowAnnoMenu(false); }}>
              <MessageSquare size={14} /> <span>{i18n.t('drawCallout')}</span>
            </div>
            <div style={dropdownItemStyle(isToolActive('arrow_up'))} onClick={() => { onSelectTool('arrow_up'); setShowAnnoMenu(false); }}>
              <ArrowUp size={14} color="#3fb950" /> <span>{i18n.t('drawArrowUp')}</span>
            </div>
            <div style={dropdownItemStyle(isToolActive('arrow_down'))} onClick={() => { onSelectTool('arrow_down'); setShowAnnoMenu(false); }}>
              <ArrowDown size={14} color="#f85149" /> <span>{i18n.t('drawArrowDown')}</span>
            </div>
          </div>
        )}
      </div>

      <span style={dividerStyle} />

      {/* 7. MIKNATIS (Magnet Snap) */}
      <button
        type="button"
        style={btnStyle(settings.magnetEnabled)}
        onClick={onToggleMagnet}
        title={i18n.t('drawMagnet')}
      >
        <Magnet size={14} />
      </button>

      {/* 8. RENK SEÇİCİ */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          style={{
            ...btnStyle(false),
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
          onClick={() => setShowColorMenu(!showColorMenu)}
          title={i18n.t('drawColor')}
        >
          <span
            style={{
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              background: settings.color,
              display: 'inline-block',
              border: '1px solid rgba(255,255,255,0.4)',
            }}
          />
        </button>

        {showColorMenu && (
          <div
            style={{
              ...dropdownMenuStyle,
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: '6px',
              padding: '8px',
              width: '120px',
            }}
          >
            {DRAWING_PALETTE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  onSetColor(c);
                  setShowColorMenu(false);
                }}
                style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  background: c,
                  border: settings.color === c ? '2px solid #fff' : '1px solid rgba(0,0,0,0.5)',
                  cursor: 'pointer',
                  padding: 0,
                  outline: 'none',
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* 9. ÇİZGİ KALINLIĞI & STİL */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          style={{
            ...btnStyle(false),
            fontFamily: 'var(--font-mono)',
            fontSize: '0.7rem',
            padding: '4px 6px',
          }}
          onClick={() => setShowWidthMenu(!showWidthMenu)}
          title={`${i18n.t('drawLineWidth')} & ${i18n.t('drawLineStyle')}`}
        >
          {settings.lineWidth}px
        </button>

        {showWidthMenu && (
          <div style={{ ...dropdownMenuStyle, width: '130px', padding: '6px' }}>
            <div style={{ fontSize: '0.68rem', color: '#8b949e', marginBottom: '4px' }}>
              {i18n.t('drawLineWidth')}
            </div>
            <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
              {[1, 2, 3, 4].map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => onSetLineWidth(w)}
                  style={{
                    flex: 1,
                    padding: '3px 0',
                    background: settings.lineWidth === w ? '#1f6feb' : '#21262d',
                    color: '#fff',
                    border: '1px solid #30363d',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    fontSize: '0.7rem',
                  }}
                >
                  {w}px
                </button>
              ))}
            </div>

            <div style={{ fontSize: '0.68rem', color: '#8b949e', marginBottom: '4px' }}>
              {i18n.t('drawLineStyle')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {(['solid', 'dashed', 'dotted'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => onSetLineStyle(st)}
                  style={{
                    padding: '3px 6px',
                    textAlign: 'left',
                    background: settings.lineStyle === st ? '#1f6feb' : 'transparent',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    fontSize: '0.7rem',
                  }}
                >
                  {st === 'solid' ? '— Düz' : st === 'dashed' ? '- - Kesikli' : '··· Noktalı'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <span style={dividerStyle} />

      {/* 10. GERİ AL / İLERİ AL */}
      <button
        type="button"
        style={actionBtnStyle(!canUndo)}
        onClick={onUndo}
        disabled={!canUndo}
        title={`${i18n.t('drawUndo')} (Ctrl+Z)`}
      >
        <Undo2 size={14} />
      </button>

      <button
        type="button"
        style={actionBtnStyle(!canRedo)}
        onClick={onRedo}
        disabled={!canRedo}
        title={`${i18n.t('drawRedo')} (Ctrl+Y)`}
      >
        <Redo2 size={14} />
      </button>

      {/* 11. GÖSTER / GİZLE */}
      <button
        type="button"
        style={btnStyle(!settings.isVisible)}
        onClick={onToggleVisibility}
        title={settings.isVisible ? i18n.t('drawHide') : i18n.t('drawShow')}
      >
        {settings.isVisible ? <Eye size={14} /> : <EyeOff size={14} />}
      </button>

      {/* 12. ÇİZİM AĞACI / YÖNETİCİ */}
      <button
        type="button"
        style={{
          ...btnStyle(false),
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '4px 8px',
        }}
        onClick={onOpenManager}
        title={i18n.t('drawObjects')}
      >
        <Layers size={14} />
        {drawingsCount > 0 && (
          <span
            style={{
              background: '#1f6feb',
              color: '#fff',
              fontSize: '0.65rem',
              borderRadius: '8px',
              padding: '1px 5px',
              fontWeight: 'bold',
            }}
          >
            {drawingsCount}
          </span>
        )}
      </button>

      {/* 13. SEÇİLİ OLAN SİL / TÜMÜNÜ SİL */}
      {selectedId ? (
        <button
          type="button"
          style={{
            ...btnStyle(false),
            color: '#f85149',
          }}
          onClick={onDeleteSelected}
          title={i18n.t('drawDeleteSelected')}
        >
          <Trash2 size={14} />
        </button>
      ) : drawingsCount > 0 ? (
        <button
          type="button"
          style={{
            ...btnStyle(false),
            color: '#8b949e',
          }}
          onClick={() => {
            if (window.confirm(i18n.t('drawClearConfirm'))) {
              onClearAll();
            }
          }}
          title={i18n.t('drawClearAll')}
        >
          <Trash2 size={14} />
        </button>
      ) : null}
    </div>
  );
}

const btnStyle = (active: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '5px 7px',
  background: active ? '#1f6feb33' : 'transparent',
  color: active ? '#58a6ff' : '#c9d1d9',
  border: `1px solid ${active ? '#1f6feb66' : 'transparent'}`,
  borderRadius: '4px',
  cursor: 'pointer',
  transition: 'all 0.15s ease',
});

const actionBtnStyle = (disabled: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '5px 7px',
  background: 'transparent',
  color: disabled ? '#484f58' : '#c9d1d9',
  border: 'none',
  borderRadius: '4px',
  cursor: disabled ? 'not-allowed' : 'pointer',
});

const dividerStyle: React.CSSProperties = {
  width: '1px',
  height: '16px',
  background: '#30363d',
  margin: '0 2px',
};

const dropdownMenuStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  left: 0,
  zIndex: 100,
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: '6px',
  padding: '4px',
  boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
  minWidth: '160px',
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
};

const dropdownItemStyle = (active: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '6px 8px',
  borderRadius: '4px',
  background: active ? '#1f6feb22' : 'transparent',
  color: active ? '#58a6ff' : '#c9d1d9',
  cursor: 'pointer',
  fontSize: '0.72rem',
});
