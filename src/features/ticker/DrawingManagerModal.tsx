import { useState, useRef } from 'react';
import {
  X,
  Trash2,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Download,
  Upload,
  Layers,
  Search,
} from 'lucide-react';
import i18n from '../../i18n';
import type { DrawingItem } from './drawingTypes';

interface DrawingManagerModalProps {
  ticker: string;
  drawings: DrawingItem[];
  isOpen: boolean;
  onClose: () => void;
  onUpdateDrawing: (id: string, patch: Partial<DrawingItem>) => void;
  onDeleteDrawing: (id: string) => void;
  onClearAll: () => void;
  onImportDrawings: (imported: DrawingItem[]) => void;
}

export default function DrawingManagerModal({
  ticker,
  drawings,
  isOpen,
  onClose,
  onUpdateDrawing,
  onDeleteDrawing,
  onClearAll,
  onImportDrawings,
}: DrawingManagerModalProps) {
  const [filter, setFilter] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const filtered = drawings.filter((d) => {
    const term = filter.toLowerCase();
    const typeName = (i18n.t(`draw${d.type.charAt(0).toUpperCase() + d.type.slice(1)}` as any) || d.type).toLowerCase();
    const label = (d.label || d.text || '').toLowerCase();
    return typeName.includes(term) || label.includes(term);
  });

  const handleExport = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(drawings, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `fraude_${ticker}_drawings_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (Array.isArray(parsed)) {
          onImportDrawings(parsed);
        }
      } catch (err) {
        alert('Geçersiz JSON dosyası!');
      }
    };
    reader.readAsText(file);
  };

  const getToolTitle = (type: string) => {
    switch (type) {
      case 'trendline': return i18n.t('drawTrendline');
      case 'ray': return i18n.t('drawRay');
      case 'extended_line': return i18n.t('drawExtendedLine');
      case 'horizontal': return i18n.t('drawHorizontal');
      case 'horizontal_ray': return i18n.t('drawHorizontalRay');
      case 'vertical': return i18n.t('drawVertical');
      case 'channel': return i18n.t('drawChannel');
      case 'rectangle': return i18n.t('drawRectangle');
      case 'fibonacci': return i18n.t('drawFibonacci');
      case 'fib_extension': return i18n.t('drawFibExtension');
      case 'position_long': return i18n.t('drawPositionLong');
      case 'position_short': return i18n.t('drawPositionShort');
      case 'arrow_up': return i18n.t('drawArrowUp');
      case 'arrow_down': return i18n.t('drawArrowDown');
      case 'brush': return i18n.t('drawBrush');
      case 'text': return i18n.t('drawText');
      case 'callout': return i18n.t('drawCallout');
      case 'measure': return i18n.t('drawMeasure');
      default: return type;
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '520px',
          maxHeight: '80vh',
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 16px 40px rgba(0, 0, 0, 0.7)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid #30363d',
            background: '#0d1117',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Layers size={16} color="#58a6ff" />
            <span style={{ fontWeight: 'bold', color: '#fff', fontSize: '0.9rem' }}>
              {i18n.t('drawObjects')} ({ticker}) · {drawings.length} {i18n.t('drawMeasureBars') !== 'bars' ? 'çizim' : 'drawings'}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#8b949e',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Toolbar: Search & Import/Export */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #21262d', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={14} color="#8b949e" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Çizimlerde ara..."
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: '#0d1117',
                border: '1px solid #30363d',
                borderRadius: '6px',
                padding: '6px 10px 6px 30px',
                color: '#fff',
                fontSize: '0.75rem',
                outline: 'none',
              }}
            />
          </div>

          <button
            type="button"
            onClick={handleExport}
            disabled={drawings.length === 0}
            title={i18n.t('drawExport')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '6px 10px',
              fontSize: '0.72rem',
              background: '#21262d',
              color: '#c9d1d9',
              border: '1px solid #30363d',
              borderRadius: '6px',
              cursor: drawings.length > 0 ? 'pointer' : 'not-allowed',
              opacity: drawings.length > 0 ? 1 : 0.5,
            }}
          >
            <Download size={13} /> {i18n.t('drawExport')}
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title={i18n.t('drawImport')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '6px 10px',
              fontSize: '0.72rem',
              background: '#21262d',
              color: '#c9d1d9',
              border: '1px solid #30363d',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            <Upload size={13} /> {i18n.t('drawImport')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px' }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#8b949e', fontSize: '0.8rem' }}>
              Grafik üzerinde kayıtlı çizim bulunamadı.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {filtered.map((item) => {
                const isHidden = item.isVisible === false;
                const isLocked = Boolean(item.isLocked);

                return (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      background: '#0d1117',
                      border: '1px solid #21262d',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      opacity: isHidden ? 0.5 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {/* Renk Çemberi */}
                      <span
                        style={{
                          width: '10px',
                          height: '10px',
                          borderRadius: '50%',
                          background: item.color,
                          display: 'inline-block',
                          border: '1px solid rgba(255,255,255,0.2)',
                        }}
                      />
                      <div>
                        <div style={{ fontWeight: 'bold', color: '#fff' }}>
                          {getToolTitle(item.type)}
                        </div>
                        {item.text && (
                          <div style={{ color: '#8b949e', fontSize: '0.7rem' }}>"{item.text}"</div>
                        )}
                        <div style={{ color: '#58a6ff', fontSize: '0.68rem', fontFamily: 'var(--font-mono)' }}>
                          {item.points.map((p) => p.price.toFixed(2)).join(' → ')}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {/* Kilitle / Aç */}
                      <button
                        type="button"
                        onClick={() => onUpdateDrawing(item.id, { isLocked: !isLocked })}
                        title={isLocked ? i18n.t('drawUnlock') : i18n.t('drawLock')}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: isLocked ? '#f0883e' : '#8b949e',
                          cursor: 'pointer',
                          padding: '4px',
                        }}
                      >
                        {isLocked ? <Lock size={14} /> : <Unlock size={14} />}
                      </button>

                      {/* Gizle / Göster */}
                      <button
                        type="button"
                        onClick={() => onUpdateDrawing(item.id, { isVisible: isHidden })}
                        title={isHidden ? i18n.t('drawShow') : i18n.t('drawHide')}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: isHidden ? '#8b949e' : '#58a6ff',
                          cursor: 'pointer',
                          padding: '4px',
                        }}
                      >
                        {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>

                      {/* Sil */}
                      <button
                        type="button"
                        onClick={() => onDeleteDrawing(item.id)}
                        title={i18n.t('drawDeleteSelected')}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#f85149',
                          cursor: 'pointer',
                          padding: '4px',
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {drawings.length > 0 && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 16px',
              borderTop: '1px solid #21262d',
              background: '#0d1117',
            }}
          >
            <button
              type="button"
              onClick={() => {
                if (window.confirm(i18n.t('drawClearConfirm'))) {
                  onClearAll();
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '6px 10px',
                fontSize: '0.72rem',
                background: 'rgba(248, 81, 73, 0.15)',
                color: '#f85149',
                border: '1px solid rgba(248, 81, 73, 0.3)',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              <Trash2 size={13} /> {i18n.t('drawClearAll')}
            </button>

            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '6px 14px',
                fontSize: '0.75rem',
                background: '#21262d',
                color: '#fff',
                border: '1px solid #30363d',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              Kapat
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
