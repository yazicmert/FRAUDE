import { useState, useEffect } from 'react';
import type { KapAnnouncement, KapAttachment } from '../../types';
import { openUrl } from '../../lib/openExternal';
import { recordCopilotAction, setCopilotActivePayload } from '../ai/userContext';
import { askAi, getKapDisclosureDetail } from '../../api/tauriClient';
import type { KapDisclosureDetail } from '../../api/tauriClient';
import './KapDocumentViewerModal.css';

export interface TargetFocusRow {
  label: string;
  value: string;
  xbrlCode: string;
  section: string;
  page: string;
}

interface KapDocumentViewerModalProps {
  announcement: KapAnnouncement | null;
  onClose: () => void;
  onAskAi?: (prompt: string) => void;
  targetFocusRow?: TargetFocusRow | null;
}

export default function KapDocumentViewerModal({
  announcement,
  onClose,
  onAskAi,
  targetFocusRow,
}: KapDocumentViewerModalProps) {
  const [viewMode, setViewMode] = useState<'web' | 'paper'>(targetFocusRow ? 'paper' : 'web');
  const [zoom, setZoom] = useState(targetFocusRow ? 135 : 100);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [detail, setDetail] = useState<KapDisclosureDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pdfRenderEngine, setPdfRenderEngine] = useState<'gview' | 'native'>('gview');

  // KAP Bildirim ID'sinden temiz sayısal indeks çıkarımı ("KAP-1643242" → "1643242")
  const rawId = announcement ? announcement.id.replace(/[^0-9]/g, '') : '';

  const kapBildirimUrl = announcement?.url || (rawId
    ? `https://www.kap.org.tr/tr/Bildirim/${rawId}`
    : 'https://www.kap.org.tr');

  // Backend'den gelen gerçek ek sayısı
  const attachmentCount = announcement?.attachment_count ?? 0;

  // Dinamik sekme listesi: KAP sayfası + scrape edilen ekler + export linkleri
  const buildTabs = (): KapAttachment[] => {
    if (!announcement) return [];

    const tabs: KapAttachment[] = [
      {
        name: `🌐 KAP Bildirim Sayfası (${announcement.ticker})`,
        url: kapBildirimUrl,
      },
    ];

    // Scrape edilen ek dosyaları (PDF'ler)
    if (detail?.attachments) {
      for (const att of detail.attachments) {
        tabs.push({
          name: `📎 ${att.name}`,
          url: att.url,
        });
      }
    }

    // Export linkleri (sağ panel butonları)
    if (detail) {
      tabs.push(
        { name: '📊 Excel Export', url: detail.excel_url },
        { name: '📄 PDF Export', url: detail.pdf_url },
        { name: '📝 Word Export', url: detail.word_url },
      );
    }

    return tabs;
  };

  const allTabs = buildTabs();
  const fallbackTab: KapAttachment = { name: '', url: '' };
  const [activeTab, setActiveTab] = useState<KapAttachment>(allTabs[0] || fallbackTab);

  // Bildirim değiştiğinde detay sayfasını scrape et
  useEffect(() => {
    if (announcement) {
      const cleanId = announcement.id.replace(/[^0-9]/g, '');
      const mainUrl = announcement.url || (cleanId
        ? `https://www.kap.org.tr/tr/Bildirim/${cleanId}`
        : 'https://www.kap.org.tr');

      setActiveTab({ name: `🌐 KAP Bildirim Sayfası (${announcement.ticker})`, url: mainUrl });
      setViewMode('web');
      setAiSummary(null);
      setDetail(null);

      recordCopilotAction(`KAP Bildirim İncelemesi: [${announcement.ticker}] ${announcement.title}`);
      setCopilotActivePayload({
        type: 'KAP_BILDIRIM_VIEWER',
        id: announcement.id,
        ticker: announcement.ticker,
        title: announcement.title,
        category: announcement.category,
        date: announcement.date,
        summary: announcement.summary,
        attachmentCount: announcement.attachment_count,
        bildirimUrl: mainUrl,
      });

      if (cleanId) {
        setDetailLoading(true);
        getKapDisclosureDetail(cleanId)
          .then((d) => {
            setDetail(d);
          })
          .catch((err) => {
            console.warn('KAP detay scrape hatası:', err);
          })
          .finally(() => setDetailLoading(false));
      }
    } else {
      setCopilotActivePayload(null);
    }
  }, [announcement]);

  if (!announcement) return null;

  const handleAiAnalyze = async () => {
    setAiAnalyzing(true);
    setAiSummary(null);
    const attachNames = detail?.attachments?.map((a) => a.name).join(', ') || 'ek yok';
    const prompt = `${announcement.ticker} şirketinin "${announcement.title}" KAP bildirimini analiz et. Bildirim ekleri: ${attachNames}. 3 maddede yatırımcı özetini çıkar: "${announcement.summary || ''}"`;

    if (onAskAi) {
      onAskAi(prompt);
    }

    try {
      const res = await askAi(prompt);
      if (res && res.summary) {
        setAiSummary(res.summary);
      }
    } catch {
      setAiSummary('AI analizi tamamlanamadı.');
    } finally {
      setAiAnalyzing(false);
    }
  };

  // Sekmenin dosya tipi tespiti
  const isPdf = (url: string, name: string) => {
    return (
      url.includes('/api/file/download/') ||
      url.includes('/api/BildirimPdf/') ||
      url.toLowerCase().endsWith('.pdf') ||
      name.toLowerCase().includes('.pdf') ||
      name.includes('PDF Export')
    );
  };

  const isExcelOrWord = (url: string) => {
    return url.includes('/export/excel') || url.includes('/export/word');
  };

  const currentUrl = activeTab?.url || kapBildirimUrl;
  const currentName = activeTab?.name || 'KAP Bildirim';
  const isCurrentPdf = isPdf(currentUrl, currentName);
  const isCurrentBinary = isExcelOrWord(currentUrl);

  const googleDocsViewerUrl = `https://docs.google.com/gview?url=${encodeURIComponent(currentUrl)}&embedded=true`;

  return (
    <div className="kap-pdf-modal-overlay" onClick={onClose}>
      <div className="kap-pdf-modal-window" onClick={(e) => e.stopPropagation()}>
        {/* ── Üst Araç Çubuğu ── */}
        <div className="kap-pdf-toolbar">
          <div className="kap-pdf-doc-info">
            <span className="kap-pdf-ticker-badge">{announcement.ticker}</span>
            <div className="kap-pdf-doc-titles">
              <strong className="kap-pdf-title-text">{announcement.title}</strong>
              <span className="kap-pdf-meta-text">
                {announcement.category} · {announcement.date}
                {attachmentCount > 0 ? ` · 📎 ${attachmentCount} Ek` : ' · Ek Yok'}
                {detail?.attachments && detail.attachments.length > 0 && ' ✓ Yüklendi'}
                {detailLoading && ' ⏳'}
                {' · '}No: {rawId || announcement.id}
              </span>
            </div>
          </div>

          <div className="kap-pdf-actions">
            {/* Mod Geçişi */}
            <div className="kap-pdf-mode-toggle">
              <button
                type="button"
                className={`mode-btn ${viewMode === 'web' ? 'active' : ''}`}
                onClick={() => setViewMode('web')}
              >
                🌐 Önizleme
              </button>
              <button
                type="button"
                className={`mode-btn ${viewMode === 'paper' ? 'active' : ''}`}
                onClick={() => setViewMode('paper')}
              >
                📝 Evrak
              </button>
            </div>

            {/* PDF Motor Değiştirici */}
            {isCurrentPdf && viewMode === 'web' && (
              <div className="kap-pdf-mode-toggle" style={{ marginLeft: 6 }}>
                <button
                  type="button"
                  className={`mode-btn ${pdfRenderEngine === 'gview' ? 'active' : ''}`}
                  onClick={() => setPdfRenderEngine('gview')}
                  title="Google Docs Reader Altyapısı ile Göster"
                >
                  ☁ Google Viewer
                </button>
                <button
                  type="button"
                  className={`mode-btn ${pdfRenderEngine === 'native' ? 'active' : ''}`}
                  onClick={() => setPdfRenderEngine('native')}
                  title="Doğrudan WebKit PDF Motoru"
                >
                  ⚡ Yerel PDF
                </button>
              </div>
            )}

            {/* Zoom */}
            <div className="kap-pdf-zoom-ctrl">
              <button type="button" onClick={() => setZoom((z) => Math.max(50, z - 15))}>−</button>
              <span>%{zoom}</span>
              <button type="button" onClick={() => setZoom((z) => Math.min(200, z + 15))}>+</button>
            </div>

            {/* AI Analiz */}
            <button
              type="button"
              className="kap-pdf-ai-btn"
              disabled={aiAnalyzing}
              onClick={() => void handleAiAnalyze()}
            >
              ⚡ {aiAnalyzing ? 'Analiz…' : 'AI Analiz'}
            </button>

            {/* Harici Tarayıcıda Aç */}
            <button
              type="button"
              className="kap-pdf-ext-btn"
              onClick={() => void openUrl(currentUrl)}
            >
              ↗ Tarayıcıda Aç
            </button>

            {/* Kapat */}
            <button type="button" className="kap-pdf-close-btn" onClick={onClose} title="Kapat">
              ✕
            </button>
          </div>
        </div>

        {/* ── Sekme Çubuğu ── */}
        <div className="kap-attachments-bar">
          <div className="attachments-label">
            <span>
              {detail?.attachments && detail.attachments.length > 0
                ? `📎 Bildirim Ekleri (${detail.attachments.length}) + Export:`
                : attachmentCount > 0
                  ? `📎 Ekler yükleniyor (${attachmentCount})…`
                  : '📊 Bildirim Ekleri yok — Export:'}
            </span>
          </div>
          <div className="attachments-list">
            {allTabs.map((tab, index) => {
              const isActive = activeTab?.url === tab.url;
              return (
                <button
                  key={`${tab.url}-${index}`}
                  type="button"
                  className={`attachment-chip ${isActive ? 'active' : ''}`}
                  onClick={() => {
                    setActiveTab(tab);
                    setViewMode('web');
                    recordCopilotAction(`KAP sekme: ${tab.name}`);
                  }}
                  title={tab.url}
                >
                  <span className="att-icon">
                    {tab.name.includes('📎') ? '📎' : tab.name.includes('📊') ? '📊' : tab.name.includes('📄') ? '📄' : '🌐'}
                  </span>
                  <span className="att-name">{tab.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Odaklanan Bilanço Satırı Zoom Bandı ── */}
        {targetFocusRow && (
          <div className="kap-focus-row-banner">
            <div className="focus-left">
              <span className="focus-badge">🎯 ODAKLANAN BİLANÇO SATIRI (%{zoom} ZOOM)</span>
              <strong className="focus-label">{targetFocusRow.label}</strong>
              <span className="focus-section">({targetFocusRow.section} · {targetFocusRow.page})</span>
            </div>
            <div className="focus-right">
              <span>Bildirilen Tutar: <strong style={{ color: '#00ff9d' }}>{targetFocusRow.value}</strong></span>
              <span className="focus-xbrl-tag">XBRL: {targetFocusRow.xbrlCode}</span>
            </div>
          </div>
        )}

        {/* ── AI Özet Bandı ── */}
        {aiSummary && (
          <div className="kap-pdf-ai-summary-bar">
            <div className="summary-title">⚡ FRAUDE AI Analiz:</div>
            <div className="summary-body">{aiSummary}</div>
          </div>
        )}

        {/* ── Görüntüleme Alanı ── */}
        <div className="kap-pdf-viewport">
          {viewMode === 'web' ? (
            <div className="kap-pdf-iframe-container">
              {/* PDF Dosyaları İçin Görünüm */}
              {isCurrentPdf ? (
                <div
                  className="kap-pdf-iframe-wrapper"
                  style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}
                >
                  {pdfRenderEngine === 'gview' ? (
                    <iframe
                      src={googleDocsViewerUrl}
                      title={currentName}
                      className="kap-pdf-iframe"
                    />
                  ) : (
                    <object
                      data={currentUrl}
                      type="application/pdf"
                      className="kap-pdf-iframe"
                    >
                      <iframe src={googleDocsViewerUrl} title={currentName} className="kap-pdf-iframe" />
                    </object>
                  )}
                </div>
              ) : isCurrentBinary ? (
                /* Excel / Word Binary Dosya İndirme Kartı */
                <div className="kap-binary-download-card">
                  <div className="binary-card-content">
                    <div className="binary-icon">{currentUrl.includes('excel') ? '📊' : '📝'}</div>
                    <h3>{currentName}</h3>
                    <p className="binary-desc">
                      Bu dosya ({currentUrl.includes('excel') ? 'Microsoft Excel .xlsx' : 'Microsoft Word .docx'}) taranabilir veya indirilebilir formattadır.
                    </p>
                    <div className="binary-actions">
                      <button
                        type="button"
                        className="binary-dl-btn primary"
                        onClick={() => void openUrl(currentUrl)}
                      >
                        {currentUrl.includes('excel') ? '📊 Excel Dosyasını İndir & Aç ↗' : '📝 Word Dosyasını İndir & Aç ↗'}
                      </button>
                      <button
                        type="button"
                        className="binary-dl-btn secondary"
                        onClick={() => void handleAiAnalyze()}
                      >
                        ⚡ AI İle Dosya İçeriğini Analiz Et
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* Standart KAP HTML Bildirim Sayfası */
                <div
                  className="kap-pdf-iframe-wrapper"
                  style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}
                >
                  <iframe
                    src={currentUrl}
                    title={currentName}
                    className="kap-pdf-iframe"
                    sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-downloads"
                  />
                </div>
              )}
            </div>
          ) : (
            /* ── Resmî Evrak Görünümü ── */
            <div
              className="kap-paper-document"
              style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}
            >
              <div className="paper-header-banner">
                <div className="paper-kap-logo">
                  <span className="logo-symbol">⚖</span>
                  <div>
                    <strong className="logo-text">BORSA İSTANBUL — KAP BİLDİRİM BÜLTENİ</strong>
                    <div className="logo-sub">Kamuyu Aydınlatma Platformu Resmî Açıklama Evrağı</div>
                  </div>
                </div>
                <div className="paper-doc-id">
                  <span>BİLDİRİM NO: {rawId || announcement.id}</span>
                  <span>TARİH: {announcement.date}</span>
                </div>
              </div>

              <table className="paper-meta-table">
                <tbody>
                  <tr>
                    <td className="meta-lbl">Şirket Kodu:</td>
                    <td className="meta-val">
                      <b style={{ color: '#00ff9d', fontSize: '1rem' }}>{announcement.ticker}</b>
                    </td>
                  </tr>
                  <tr>
                    <td className="meta-lbl">Kategori:</td>
                    <td className="meta-val">{announcement.category}</td>
                  </tr>
                  <tr>
                    <td className="meta-lbl">Başlık:</td>
                    <td className="meta-val">
                      <b style={{ color: '#ffffff' }}>{announcement.title}</b>
                    </td>
                  </tr>
                  <tr>
                    <td className="meta-lbl">Bildirim Ekleri:</td>
                    <td className="meta-val">
                      {detail?.attachments && detail.attachments.length > 0
                        ? detail.attachments.map((att) => att.name).join(', ')
                        : attachmentCount === 0
                          ? 'Ek yok'
                          : `${attachmentCount} adet ek`}
                    </td>
                  </tr>
                  <tr>
                    <td className="meta-lbl">AI Önem Skoru:</td>
                    <td className="meta-val">
                      <span className={`importance-tag ${announcement.ai_importance_score >= 70 ? 'high' : 'normal'}`}>
                        {announcement.ai_importance_score}/100
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>

              <div className="paper-body-content">
                <h3>AÇIKLAMA METNİ</h3>
                <div className="paper-text-paragraph">
                  {announcement.summary || 'Bu bildirime ait detaylı metin KAP arşivinde sunulmuştur.'}
                </div>

                {/* Ek Listesi */}
                {detail?.attachments && detail.attachments.length > 0 && (
                  <div className="paper-attachments-list">
                    <h4>📎 Bildirim Ekleri</h4>
                    <ul>
                      {detail.attachments.map((att, i) => (
                        <li key={i}>
                          <button
                            type="button"
                            className="paper-att-link"
                            onClick={() => {
                              setActiveTab({ name: att.name, url: att.url });
                              setViewMode('web');
                            }}
                          >
                            📄 {att.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="paper-legal-note">
                  <strong>Not:</strong> Sekme çubuğundan eklere, Excel/PDF/Word export dosyalarına doğrudan
                  ulaşabilirsiniz.
                </div>
              </div>

              <div className="paper-footer-stamp">
                <span>✓ KAP Doğrulamalı Veri Akışı</span>
                <span>FRAUDE Terminal</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
