import type { KapAnnouncement } from '../../types';
import { openUrl } from '../../lib/openExternal';
import './FinancialAuditInspectorModal.css';

export interface AuditTarget {
  metricKey: string;
  metricLabel: string;
  periodName: string;
  periodRaw: string;
  value: number | null | undefined;
  formattedValue: string;
  currency: string;
  periodType: 'annual' | 'quarterly';
  colData: any;
  prevColData?: any;
  kapAnnouncement?: KapAnnouncement | null;
}

interface FinancialAuditInspectorModalProps {
  target: AuditTarget | null;
  ticker: string;
  onClose: () => void;
  onOpenKapViewer?: (ann: KapAnnouncement) => void;
}

export default function FinancialAuditInspectorModal({
  target,
  ticker,
  onClose,
  onOpenKapViewer,
}: FinancialAuditInspectorModalProps) {
  if (!target) return null;

  const cleanTicker = ticker.replace('.IS', '');
  const rawId = target.kapAnnouncement ? target.kapAnnouncement.id.replace(/[^0-9]/g, '') : '';
  const isValidKapId = rawId.length >= 5;
  const excelUrl = isValidKapId ? `https://www.kap.org.tr/tr/api/notification/export/excel/${rawId}` : '';
  const pdfUrl = isValidKapId ? `https://www.kap.org.tr/tr/api/BildirimPdf/${rawId}` : '';

  // Hesaplama ve İzlenebilirlik Detayı Üretimi
  const renderAuditExplanation = () => {
    const { metricKey, periodName, periodType, colData, prevColData } = target;

    if (metricKey === 'revenue') {
      if (periodType === 'quarterly' && prevColData) {
        return (
          <div className="audit-formula-box">
            <div className="formula-title">🧮 Çeyreklik Ayrıştırma Formülü:</div>
            <div className="formula-step">
              <span>{periodName} Çeyreklik Hasılat</span> = <span>{periodName} Kümülatif ({target.formattedValue})</span> − <span>Önceki Çeyrek Kümülatif</span>
            </div>
            <p className="formula-note">
              KAP'ta yayımlanan 3, 6, 9 ve 12 aylık kümülatif bildirimlerden tekil 3 aylık çeyrek satışı türetilmiştir.
            </p>
          </div>
        );
      }
      return (
        <div className="audit-formula-box">
          <div className="formula-title">📜 Resmî KAP Bilanço Kalemi:</div>
          <div className="formula-step">
            <span>KAP Kalem Kodu: <b>3C (Satış Gelirleri / Hasılat)</b></span>
          </div>
          <p className="formula-note">
            Şirketin KAP'a bildirdiği SPK/UFRS UMS 21 standartlarındaki Hasılat tutarıdır.
          </p>
        </div>
      );
    }

    if (metricKey === 'net_income') {
      return (
        <div className="audit-formula-box">
          <div className="formula-title">📜 Resmî KAP Bilanço Kalemi:</div>
          <div className="formula-step">
            <span>KAP Kalem Kodu: <b>1BN (Net Dönem Kârı / Zararı)</b></span>
          </div>
          <p className="formula-note">
            Konsolide net kâr tutarıdır. Ana ortaklık paylarına düşen kâr kalemi esas alınır.
          </p>
        </div>
      );
    }

    if (metricKey.includes('margin')) {
      return (
        <div className="audit-formula-box">
          <div className="formula-title">🧮 Kârlılık Marjı Formülü:</div>
          <div className="formula-step">
            <span>Marj %</span> = (<span>İlgili Kâr Kalemi</span> / <span>Hasılat ({colData.revenue ? `${colData.revenue.toFixed(0)} M` : '—'})</span>) × 100 = <b>{target.formattedValue}</b>
          </div>
          <p className="formula-note">
            Şirketin her 100 TL'lik satışından elde ettiği kâr oranını gösterir.
          </p>
        </div>
      );
    }

    if (metricKey === 'roe') {
      return (
        <div className="audit-formula-box">
          <div className="formula-title">🧮 Özsermaye Kârlılığı (ROE) Formülü:</div>
          <div className="formula-step">
            <span>ROE %</span> = (<span>Son 4 Çeyrek Net Kâr Toplamı</span> / <span>Özkaynaklar ({colData.equity ? `${colData.equity.toFixed(0)} M` : '—'})</span>) × 100 = <b>{target.formattedValue}</b>
          </div>
          <p className="formula-note">
            Şirketin özkaynaklarını ne oranda verimli kullandığını gösteren yıllıklandırılmış kârlılık rasyosudur.
          </p>
        </div>
      );
    }

    return (
      <div className="audit-formula-box">
        <div className="formula-title">📜 Resmî Bilanço Veri Kaynağı:</div>
        <div className="formula-step">
          <span>{cleanTicker} {periodName} Dönemi KAP Finansal Tabloları</span>
        </div>
        <p className="formula-note">
          İlgili tutar Borsa İstanbul ve KAP resmî finansal rapor bildiriminden doğrulanmıştır.
        </p>
      </div>
    );
  };

  return (
    <div className="audit-modal-overlay" onClick={onClose}>
      <div className="audit-modal-window" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="audit-modal-header">
          <div className="audit-header-title">
            <span className="audit-ticker-badge">{cleanTicker}</span>
            <div>
              <h3>🔍 Rakam Doğrulama & KAP İspat Kartı</h3>
              <span className="audit-subtitle">{target.metricLabel} · {target.periodName} Dönemi</span>
            </div>
          </div>
          <button type="button" className="audit-close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Body Content */}
        <div className="audit-modal-body">
          {/* Ana Rakam Göstergesi */}
          <div className="audit-value-card">
            <div className="value-label">{target.metricLabel} ({target.periodName})</div>
            <div className="value-main-amount">{target.formattedValue}</div>
            <div className="value-currency-tag">
              {target.currency} · {target.periodType === 'quarterly' ? 'Çeyreklik Rapor' : 'Yıllık Konsolide Rapor'}
            </div>
          </div>

          {/* Orijinal KAP Bilanço Satırı Önizlemesi (İstediğiniz Satır) */}
          <div className="audit-raw-line-preview">
            <div className="preview-header">
              <span>⚖️ KAP Resmî Finansal Tablo Satırı ({target.periodName})</span>
              <span className="kap-index-tag">{rawId ? `Bildirim No: ${rawId}` : cleanTicker}</span>
            </div>
            <table className="preview-table">
              <thead>
                <tr>
                  <th>KAP Finansal Tablo Kalemi (XBRL Standardı)</th>
                  <th style={{ textAlign: 'right' }}>KAP Bildirilen Tutar ({target.currency})</th>
                </tr>
              </thead>
              <tbody>
                <tr className="active-target-row">
                  <td>
                    <span className="row-bullet">▶</span>
                    <strong>{target.metricLabel}</strong>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#00ff9d' }}>
                    {target.formattedValue}
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="preview-footer-note">
              ✓ Borsa İstanbul KAP arşivinden çekilen resmi bilanço satırı.
            </div>
          </div>

          {/* Formül & Türetim Kutusu */}
          {renderAuditExplanation()}

          {/* Kur Çevirim Bilgisi */}
          {target.currency === 'USD' && (
            <div className="audit-fx-info">
              💱 <b>UMS 21 Uyumlu Kur Çevirimi:</b> Gelir tablosu kalemleri ilgili dönemin ortalama USD/TRY kuruyla, bilanço kalemleri ise dönem sonu kapanış kuruyla çevrilmiştir.
            </div>
          )}

          {/* KAP İlanı ve Dosya İspat Aksiyonları */}
          <div className="audit-kap-source-section">
            <h4>⚖️ KAP Resmî Kaynak Dosyaları & Sayfa Erişimi:</h4>
            {target.kapAnnouncement ? (
              <div className="audit-kap-ann-card">
                <div className="ann-title">📄 {target.kapAnnouncement.title}</div>
                <div className="ann-meta">📅 Tarih: {target.kapAnnouncement.date} · Bildirim No: {rawId || '—'}</div>
                <p className="ann-summary">{target.kapAnnouncement.summary || 'KAP Finansal Rapor İlanı'}</p>

                <div className="ann-actions">
                  {excelUrl && (
                    <button
                      type="button"
                      className="audit-action-btn excel"
                      onClick={() => void openUrl(excelUrl)}
                    >
                      📊 Excel (.xlsx) İndir ve Bu Satırı Aç ↗
                    </button>
                  )}
                  {pdfUrl && (
                    <button
                      type="button"
                      className="audit-action-btn pdf"
                      onClick={() => void openUrl(pdfUrl)}
                    >
                      📄 Orijinal PDF Raporu İndir & Aç ↗
                    </button>
                  )}
                  {onOpenKapViewer && (
                    <button
                      type="button"
                      className="audit-action-btn primary"
                      onClick={() => {
                        onClose();
                        onOpenKapViewer(target.kapAnnouncement!);
                      }}
                    >
                      👁️ App İçinde Orijinal KAP Bildirim Sayfasını Önizle ↗
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="audit-kap-ann-card">
                <div className="ann-title">🌐 {cleanTicker} KAP Şirket Arşivi</div>
                <p className="ann-summary">Bu döneme ait orijinal bilanço KAP arşivindedir.</p>
                <button
                  type="button"
                  className="audit-action-btn primary"
                  onClick={() => void openUrl(`https://www.kap.org.tr/tr/sirket-bilgileri/ozet/${cleanTicker}`)}
                >
                  🌐 KAP Şirket Sayfasında İncele ↗
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
