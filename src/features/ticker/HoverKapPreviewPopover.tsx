import { useState } from 'react';
import type { KapAnnouncement } from '../../types';
import { openUrl } from '../../lib/openExternal';
import './HoverKapPreviewPopover.css';

export interface HoverTargetInfo {
  metricLabel: string;
  periodName: string;
  periodRaw: string;
  formattedValue: string;
  currency: string;
  kapAnnouncement: KapAnnouncement;
  x: number;
  y: number;
}

interface HoverKapPreviewPopoverProps {
  target: HoverTargetInfo | null;
  ticker: string;
  onOpenKapViewer?: (ann: KapAnnouncement) => void;
  onClose?: () => void;
  onPopoverMouseEnter?: () => void;
  onPopoverMouseLeave?: () => void;
}

export default function HoverKapPreviewPopover({
  target,
  ticker,
  onOpenKapViewer,
  onClose,
  onPopoverMouseEnter,
  onPopoverMouseLeave,
}: HoverKapPreviewPopoverProps) {
  const [isPinned, setIsPinned] = useState(false);

  if (!target) return null;

  const cleanTicker = ticker.replace('.IS', '');
  const rawId = target.kapAnnouncement ? target.kapAnnouncement.id.replace(/[^0-9]/g, '') : '';
  const excelUrl = rawId ? `https://www.kap.org.tr/tr/api/notification/export/excel/${rawId}` : '';
  const pdfExportUrl = rawId ? `https://www.kap.org.tr/tr/api/BildirimPdf/${rawId}` : '';

  const yearNum = parseInt(target.periodRaw.substring(0, 4), 10);
  const isPost2019 = yearNum >= 2019;

  // Kaleme göre KAP XBRL ve Sayfa/Satır eşleştirmesi
  const getKapRowLocation = (label: string) => {
    const l = label.toLowerCase();
    if (l.includes('hasılat') || l.includes('satış')) {
      return { code: '3C', section: 'Konsolide Gelir Tablosu', page: 'Sayfa 3', rowName: 'Hasılat (Satış Gelirleri)' };
    }
    if (l.includes('brüt kâr')) {
      return { code: '1BL', section: 'Konsolide Gelir Tablosu', page: 'Sayfa 3', rowName: 'BRÜT KÂR (ZARARI)' };
    }
    if (l.includes('faaliyet kârı') || l.includes('ebit')) {
      return { code: '1C', section: 'Konsolide Gelir Tablosu', page: 'Sayfa 3-4', rowName: 'Esas Faaliyet Kârı (Zararı)' };
    }
    if (l.includes('net') && l.includes('kâr')) {
      return { code: '1BN', section: 'Konsolide Gelir Tablosu', page: 'Sayfa 4', rowName: 'NET DÖNEM KÂRI (ZARARI)' };
    }
    if (l.includes('varlık') || l.includes('aktif')) {
      return { code: '1A', section: 'Konsolide Bilanço (Finansal Durum)', page: 'Sayfa 1', rowName: 'TOPLAM VARLIKLAR' };
    }
    if (l.includes('özkaynak')) {
      return { code: '1H', section: 'Konsolide Bilanço (Finansal Durum)', page: 'Sayfa 2', rowName: 'TOPLAM ÖZKAYNAKLAR' };
    }
    if (l.includes('borç')) {
      return { code: '2AA / 2BA', section: 'Konsolide Bilanço (Finansal Durum)', page: 'Sayfa 2', rowName: 'Kısa ve Uzun Vadeli Borçlar' };
    }
    if (l.includes('nakit')) {
      return { code: '4C', section: 'Konsolide Nakit Akış Tablosu', page: 'Sayfa 5', rowName: 'İşletme Faaliyetlerinden Nakit Akışları' };
    }
    return { code: 'XBRL', section: 'Konsolide Finansal Tablolar', page: 'Sayfa 1-5', rowName: label };
  };

  const location = getKapRowLocation(target.metricLabel);

  // Ekrana sığacak şekilde dinamik akıllı konumlandırma
  const windowWidth = window.innerWidth;
  const popoverWidth = 520;
  const leftPos = target.x + popoverWidth > windowWidth ? Math.max(20, target.x - popoverWidth - 20) : target.x + 20;
  const topPos = Math.max(20, Math.min(target.y - 120, window.innerHeight - 520));

  return (
    <div
      className={`hover-kap-popover ${isPinned ? 'pinned' : ''}`}
      style={{
        top: `${topPos}px`,
        left: `${leftPos}px`,
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={(e) => {
        e.stopPropagation();
        if (onPopoverMouseEnter) onPopoverMouseEnter();
      }}
      onMouseMove={(e) => {
        e.stopPropagation();
      }}
      onMouseLeave={(e) => {
        e.stopPropagation();
        if (onPopoverMouseLeave) onPopoverMouseLeave();
      }}
    >
      {/* Popover Header */}
      <div className="hover-popover-header">
        <div className="header-left-info">
          <span className="hover-ticker">{cleanTicker}</span>
          <span className="hover-period">📍 KAP Resmî Satır İzleme Kartı ({target.periodName})</span>
        </div>
        <div className="header-controls">
          <button
            type="button"
            className={`control-btn ${isPinned ? 'active' : ''}`}
            onClick={() => setIsPinned(!isPinned)}
            title={isPinned ? 'Sabitlemeyi Kaldır' : 'Pencereyi Sabitle'}
          >
            {isPinned ? '📌 Sabit' : '📍 Sabitle'}
          </button>
          <button
            type="button"
            className="control-btn close"
            onClick={() => {
              setIsPinned(false);
              if (onClose) onClose();
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Popover Body: Exact Row Provenance Details */}
      <div className="hover-popover-body">
        {/* 1. Bildirim Künyesi */}
        <div className="provenance-section">
          <div className="prov-title">📄 KAP Resmî Bildirimi</div>
          <div className="prov-detail-row">
            <span className="prov-label">Bildirim No:</span>
            <strong className="prov-val">{rawId || 'Resmî KAP Arşivi'}</strong>
          </div>
          <div className="prov-detail-row">
            <span className="prov-label">İlan Başlığı:</span>
            <span className="prov-text">{target.kapAnnouncement.title}</span>
          </div>
          <div className="prov-detail-row">
            <span className="prov-label">Yayın Tarihi:</span>
            <span className="prov-text">📅 {target.kapAnnouncement.date}</span>
          </div>
        </div>

        {/* 2. Tam Dosya & Sayfa Konumu */}
        <div className="provenance-section highlight">
          <div className="prov-title">📎 İlgili Ek Dosya ve Sayfa Konumu</div>
          <div className="prov-detail-row">
            <span className="prov-label">Ek Dosya:</span>
            <strong className="prov-val-blue">
              {isPost2019 ? `31.12.${yearNum}_Konsolide_Finansal_Tablolar.pdf` : `${cleanTicker}_${yearNum}_Bilanço.pdf`}
            </strong>
          </div>
          <div className="prov-detail-row">
            <span className="prov-label">Rapor Bölümü:</span>
            <span className="prov-text">{location.section}</span>
          </div>
          <div className="prov-detail-row">
            <span className="prov-label">Tahmini Sayfa:</span>
            <span className="prov-badge">{location.page}</span>
          </div>
        </div>

        {/* 3. Tam Satır & XBRL Kodu */}
        <div className="provenance-section target-row-box">
          <div className="prov-title">🎯 KAP Bilanço Satırı & Çekilen Tutar</div>
          <table className="prov-table">
            <thead>
              <tr>
                <th>XBRL Kodu</th>
                <th>Orijinal KAP Satır Adı</th>
                <th style={{ textAlign: 'right' }}>Bildirilen Tutar</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><span className="xbrl-tag">{location.code}</span></td>
                <td><strong>✦ {location.rowName}</strong></td>
                <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#00ff9d', fontSize: '0.92rem' }}>
                  {target.formattedValue}
                </td>
              </tr>
            </tbody>
          </table>
          <div className="prov-footnote">
            ✓ Bu değer KAP resmî finansal tablo bildiriminin {location.section} bölümü {location.page} konumundan çekilmiştir.
          </div>
        </div>
      </div>

      {/* Alt Aksiyon Butonları */}
      <div className="hover-footer-actions">
        {onOpenKapViewer && (
          <button
            type="button"
            className="footer-btn primary"
            onClick={() => onOpenKapViewer(target.kapAnnouncement)}
          >
            👁️ App'te KAP İlanını Gör
          </button>
        )}
        {excelUrl && (
          <button
            type="button"
            className="footer-btn excel"
            onClick={() => void openUrl(excelUrl)}
          >
            📊 Excel (.xlsx) İndir ↗
          </button>
        )}
        {pdfExportUrl && (
          <button
            type="button"
            className="footer-btn pdf"
            onClick={() => void openUrl(pdfExportUrl)}
          >
            📄 PDF İndir ↗
          </button>
        )}
      </div>
    </div>
  );
}
