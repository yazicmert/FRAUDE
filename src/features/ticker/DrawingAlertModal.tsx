import React, { useState } from 'react';
import { Bell, X, Check, Target, ShieldAlert, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import type { DrawingItem } from './drawingTypes';
import type { AlertOp } from '../alerts/alertTypes';
import i18n from '../../i18n';

interface DrawingAlertModalProps {
  ticker: string;
  drawing: DrawingItem;
  isOpen: boolean;
  onClose: () => void;
  onCreateAlert: (rule: {
    ticker: string;
    metric: 'price';
    op: AlertOp;
    threshold: number;
    note?: string;
    repeat: boolean;
    enabled: boolean;
  }) => void;
}

export default function DrawingAlertModal({
  ticker,
  drawing,
  isOpen,
  onClose,
  onCreateAlert,
}: DrawingAlertModalProps) {
  const normTicker = ticker.replace('.IS', '').toUpperCase();

  // Çizim tipine göre varsayılan hedef fiyat
  const defaultPrice = React.useMemo(() => {
    if (drawing.points.length === 0) return 0;
    if (drawing.type === 'position_long' || drawing.type === 'position_short') {
      return drawing.points[1]?.price || drawing.points[0]?.price || 0;
    }
    return drawing.points[drawing.points.length - 1]?.price || drawing.points[0]?.price || 0;
  }, [drawing]);

  const [targetPrice, setTargetPrice] = useState<number>(() => Number(defaultPrice.toFixed(2)));
  const [op, setOp] = useState<AlertOp>('above');
  const [note, setNote] = useState<string>(() => {
    const typeLabel = i18n.t(`draw${drawing.type.charAt(0).toUpperCase() + drawing.type.slice(1)}` as any) || drawing.type;
    return `${typeLabel} Fiyat Alarmı`;
  });
  const [repeat, setRepeat] = useState<boolean>(false);
  const [createdToast, setCreatedToast] = useState(false);

  if (!isOpen) return null;

  const isPosition = drawing.type === 'position_long' || drawing.type === 'position_short';
  const entryPrice = drawing.points[0]?.price || 0;
  const tpPrice = drawing.points[1]?.price || 0;
  const slPrice = drawing.points[2]?.price || 0;

  const handleCreate = (overrideOp?: AlertOp, overridePrice?: number, overrideNote?: string) => {
    const finalOp = overrideOp ?? op;
    const finalPrice = overridePrice ?? targetPrice;
    const finalNote = overrideNote ?? note;

    onCreateAlert({
      ticker: normTicker,
      metric: 'price',
      op: finalOp,
      threshold: Number(finalPrice.toFixed(2)),
      note: finalNote,
      repeat,
      enabled: true,
    });

    setCreatedToast(true);
    setTimeout(() => {
      setCreatedToast(false);
      onClose();
    }, 1200);
  };

  const handleCreatePositionBoth = () => {
    const isLong = drawing.type === 'position_long';
    // 1. TP Alarmı
    onCreateAlert({
      ticker: normTicker,
      metric: 'price',
      op: isLong ? 'above' : 'below',
      threshold: Number(tpPrice.toFixed(2)),
      note: `${normTicker} Kâr Al (TP) Hedefi`,
      repeat: false,
      enabled: true,
    });

    // 2. SL Alarmı
    onCreateAlert({
      ticker: normTicker,
      metric: 'price',
      op: isLong ? 'below' : 'above',
      threshold: Number(slPrice.toFixed(2)),
      note: `${normTicker} Zarar Kes (SL) Seviyesi`,
      repeat: false,
      enabled: true,
    });

    setCreatedToast(true);
    setTimeout(() => {
      setCreatedToast(false);
      onClose();
    }, 1200);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
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
          maxWidth: '420px',
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: '8px',
          boxShadow: '0 16px 40px rgba(0, 0, 0, 0.7)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
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
            <Bell size={16} color="#e3b341" />
            <span style={{ fontWeight: 'bold', color: '#fff', fontSize: '0.9rem' }}>
              {normTicker} · {i18n.t('drawSetAlert')}
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

        {/* Content */}
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {createdToast ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '24px 0',
                color: '#3fb950',
                fontWeight: 'bold',
                fontSize: '0.95rem',
              }}
            >
              <Check size={20} /> {i18n.t('drawAlertCreated')}!
            </div>
          ) : isPosition ? (
            // POZİSYON RİSK/ÖDÜL KUTUSU ALARMLARI
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '0.78rem', color: '#8b949e' }}>
                Pozisyon seviyelerine göre tek tıkla otomatik alarm oluşturun:
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  background: '#0d1117',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  border: '1px solid #21262d',
                  fontSize: '0.75rem',
                }}
              >
                <div>
                  <span style={{ color: '#8b949e' }}>Giriş: </span>
                  <strong style={{ color: '#58a6ff' }}>{entryPrice.toFixed(2)} TL</strong>
                </div>
                <div>
                  <span style={{ color: '#8b949e' }}>TP: </span>
                  <strong style={{ color: '#3fb950' }}>{tpPrice.toFixed(2)} TL</strong>
                </div>
                <div>
                  <span style={{ color: '#8b949e' }}>SL: </span>
                  <strong style={{ color: '#f85149' }}>{slPrice.toFixed(2)} TL</strong>
                </div>
              </div>

              {/* TP Butonu */}
              <button
                type="button"
                onClick={() =>
                  handleCreate(
                    drawing.type === 'position_long' ? 'above' : 'below',
                    tpPrice,
                    `${normTicker} Kâr Al (TP) Seviyesi`
                  )
                }
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '9px',
                  background: 'rgba(63, 185, 80, 0.15)',
                  color: '#3fb950',
                  border: '1px solid rgba(63, 185, 80, 0.3)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '0.8rem',
                }}
              >
                <Target size={15} /> {i18n.t('drawAlertTp')} ({tpPrice.toFixed(2)} TL)
              </button>

              {/* SL Butonu */}
              <button
                type="button"
                onClick={() =>
                  handleCreate(
                    drawing.type === 'position_long' ? 'below' : 'above',
                    slPrice,
                    `${normTicker} Zarar Kes (SL) Seviyesi`
                  )
                }
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '9px',
                  background: 'rgba(248, 81, 73, 0.15)',
                  color: '#f85149',
                  border: '1px solid rgba(248, 81, 73, 0.3)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '0.8rem',
                }}
              >
                <ShieldAlert size={15} /> {i18n.t('drawAlertSl')} ({slPrice.toFixed(2)} TL)
              </button>

              {/* Hem TP Hem SL */}
              <button
                type="button"
                onClick={handleCreatePositionBoth}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '9px',
                  background: '#238636',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '0.8rem',
                  marginTop: '4px',
                }}
              >
                <Bell size={15} /> Hem Kâr Al (TP) Hem Zarar Kes (SL) Alarmı Kur
              </button>
            </div>
          ) : (
            // STANDART ÇİZGİ / SEVİYE ALARMI
            <>
              {/* Hedef Fiyat */}
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: '#8b949e', marginBottom: '6px' }}>
                  Hedef Seviye / Fiyat (TL)
                </label>
                <input
                  type="number"
                  step="any"
                  value={targetPrice}
                  onChange={(e) => setTargetPrice(parseFloat(e.target.value) || 0)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    background: '#0d1117',
                    border: '1px solid #30363d',
                    borderRadius: '6px',
                    padding: '8px 10px',
                    color: '#58a6ff',
                    fontSize: '0.9rem',
                    fontWeight: 'bold',
                    fontFamily: 'var(--font-mono)',
                    outline: 'none',
                  }}
                />
              </div>

              {/* Koşul (Yukarı / Aşağı Kırılım) */}
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: '#8b949e', marginBottom: '6px' }}>
                  Tetiklenme Koşulu
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setOp('above')}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      padding: '8px',
                      background: op === 'above' ? '#1f6feb22' : '#0d1117',
                      color: op === 'above' ? '#58a6ff' : '#c9d1d9',
                      border: `1px solid ${op === 'above' ? '#1f6feb' : '#30363d'}`,
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      fontWeight: op === 'above' ? 'bold' : 'normal',
                    }}
                  >
                    <ArrowUpRight size={14} color="#3fb950" /> {i18n.t('drawAlertAbove')}
                  </button>

                  <button
                    type="button"
                    onClick={() => setOp('below')}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      padding: '8px',
                      background: op === 'below' ? '#1f6feb22' : '#0d1117',
                      color: op === 'below' ? '#58a6ff' : '#c9d1d9',
                      border: `1px solid ${op === 'below' ? '#1f6feb' : '#30363d'}`,
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      fontWeight: op === 'below' ? 'bold' : 'normal',
                    }}
                  >
                    <ArrowDownRight size={14} color="#f85149" /> {i18n.t('drawAlertBelow')}
                  </button>
                </div>
              </div>

              {/* Açıklama Notu */}
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: '#8b949e', marginBottom: '6px' }}>
                  Alarm Açıklaması / Not
                </label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Örn: Direnç Kırılımı / Destek Seviyesi"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    background: '#0d1117',
                    border: '1px solid #30363d',
                    borderRadius: '6px',
                    padding: '8px 10px',
                    color: '#fff',
                    fontSize: '0.78rem',
                    outline: 'none',
                  }}
                />
              </div>

              {/* Tekrarlama Seçeneği */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '0.75rem',
                  color: '#c9d1d9',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={repeat}
                  onChange={(e) => setRepeat(e.target.checked)}
                  style={{ accentColor: '#1f6feb' }}
                />
                Tetiklendikten sonra alarmı açık tut (sürekli tekrarla)
              </label>

              {/* Submit */}
              <button
                type="button"
                onClick={() => handleCreate()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '10px',
                  background: '#238636',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '0.82rem',
                  marginTop: '4px',
                }}
              >
                <Bell size={15} /> Alarmı Oluştur
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
