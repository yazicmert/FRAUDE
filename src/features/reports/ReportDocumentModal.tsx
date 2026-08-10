import { useEffect, useMemo, useState } from 'react';
import { getReportDocument } from '../../api/tauriClient';
import { useTranslation } from '../../api/i18n';
import { openUrl } from '../../lib/openExternal';
import { recordCopilotAction, setCopilotActivePayload } from '../ai/userContext';
import type { AnalystReport } from '../../types';
// Görüntüleyici KAP bildirim okuyucusuyla aynı kabuğu kullanır: iki ekran
// arasında araç çubuğu, yakınlaştırma ve sabitleme davranışı ayrışmasın.
import '../kap/KapDocumentViewerModal.css';

/**
 * Okuyucunun açabildiği belge.
 *
 * Kaynak-bağımsız tutulur: aracı kurum raporu da SPK haftalık bülteni de aynı
 * kayda indirgenir, okuyucu belgenin nereden geldiğini bilmez.
 */
export interface ViewerDocument {
  id: string;
  title: string;
  /** Yayımlayan: kurum adı, "SPK", haber kaynağı… */
  source: string;
  /** Ekranda gösterilecek tür etiketi — çağıran tarafından çevrilmiş gelir. */
  kindLabel: string;
  published: string;
  url: string;
  pdfUrl?: string | null;
  tickers?: string[];
  rating?: string | null;
  targetPrice?: number | null;
}

/** Analiz raporunu okuyucunun anladığı kayda çevirir. */
export function documentFromReport(
  report: AnalystReport,
  kindLabel: string,
): ViewerDocument {
  return {
    id: report.id,
    title: report.title,
    source: report.broker,
    kindLabel,
    published: report.published,
    url: report.url,
    pdfUrl: report.pdf_url,
    tickers: report.tickers,
    rating: report.rating,
    targetPrice: report.target_price,
  };
}

interface ReportDocumentModalProps {
  document: ViewerDocument | null;
  onClose: () => void;
  onSelectTicker?: (ticker: string) => void;
}

/** Belgenin indirilme durumu. */
type DocState =
  | { status: 'loading' }
  | { status: 'ready'; objectUrl: string; contentType: string; bytes: number }
  | { status: 'error'; message: string };

/** base64 gövdeyi tarayıcının doğrudan gösterebileceği bir blob'a çevirir. */
function toObjectUrl(base64: string, contentType: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return URL.createObjectURL(new Blob([bytes], { type: contentType }));
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Belgeyi uygulamanın içinde açar (analiz raporu, SPK bülteni…).
 *
 * Kaynakların PDF'leri `X-Frame-Options: SAMEORIGIN` ile yayımlanıyor;
 * adres doğrudan bir çerçeveye verilse ekran boş kalırdı. Belge bu yüzden
 * arka uçtan indirilip blob olarak gömülür — rapor, KAP bildirimleri gibi
 * uygulamadan çıkmadan okunur. İndirme başarısız olursa (kurum kaldırmış,
 * ağ kapalı) tarayıcıda açma yolu açık bırakılır.
 */
export default function ReportDocumentModal({ document: target, onClose, onSelectTicker }: ReportDocumentModalProps) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(100);
  const [isDockedRight, setIsDockedRight] = useState(false);
  const [doc, setDoc] = useState<DocState>({ status: 'loading' });
  /**
   * Çizim motoru. Varsayılan yerel: belge zaten indirildiği için dışarıya
   * istek gitmez. Gömülü motorun PDF çizmediği durumlar için KAP okuyucusundaki
   * Google Viewer yedeği aynen burada da var.
   */
  const [engine, setEngine] = useState<'native' | 'gview'>('native');

  const sourceUrl = target?.pdfUrl || target?.url || '';

  const handleClose = () => {
    document.body.classList.remove('kap-docked-open');
    setIsDockedRight(false);
    onClose();
  };

  useEffect(() => {
    if (isDockedRight) document.body.classList.add('kap-docked-open');
    else document.body.classList.remove('kap-docked-open');
    return () => document.body.classList.remove('kap-docked-open');
  }, [isDockedRight]);

  // Belge her rapor değişiminde yeniden indirilir; önceki blob serbest
  // bırakılmazsa pencere kapansa da bellek elde kalır.
  useEffect(() => {
    if (!target || !sourceUrl) return;
    let cancelled = false;
    let created: string | null = null;

    setDoc({ status: 'loading' });
    setZoom(100);
    setEngine('native');
    void (async () => {
      try {
        const payload = await getReportDocument(sourceUrl);
        if (cancelled) return;
        created = toObjectUrl(payload.base64, payload.content_type);
        setDoc({
          status: 'ready',
          objectUrl: created,
          contentType: payload.content_type,
          bytes: payload.bytes,
        });
      } catch (cause) {
        if (!cancelled) setDoc({ status: 'error', message: String(cause) });
      }
    })();

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [target, sourceUrl]);

  // Belge açıkken yapay zekâ bağlamı ona bakar; KAP okuyucusuyla aynı sözleşme.
  useEffect(() => {
    if (!target) return;
    recordCopilotAction(`Belge incelemesi: [${target.source}] ${target.title}`);
    setCopilotActivePayload({
      type: 'BELGE_VIEWER',
      id: target.id,
      source: target.source,
      title: target.title,
      published: target.published,
      tickers: target.tickers ?? [],
      rating: target.rating ?? null,
      target_price: target.targetPrice ?? null,
      url: sourceUrl,
    });
  }, [target, sourceUrl]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const isPdf = useMemo(
    () => doc.status === 'ready' && doc.contentType.includes('pdf'),
    [doc],
  );

  if (!target) return null;

  const tickers = target.tickers ?? [];

  return (
    <div
      className={`kap-pdf-modal-overlay ${isDockedRight ? 'docked' : ''}`}
      onClick={isDockedRight ? undefined : handleClose}
    >
      <div
        className={`kap-pdf-modal-window ${isDockedRight ? 'docked' : ''}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="kap-pdf-toolbar">
          <div className="kap-pdf-doc-info">
            <span className="kap-pdf-ticker-badge">{tickers[0] ?? target.source.slice(0, 6)}</span>
            <div className="kap-pdf-doc-titles">
              <strong className="kap-pdf-title-text">{target.title}</strong>
              <span className="kap-pdf-meta-text">
                {target.source} · {target.kindLabel} · {target.published}
                {target.rating ? ` · ${target.rating}` : ''}
                {target.targetPrice != null
                  ? ` · ${t('targetPriceLabel')}: ₺${target.targetPrice.toLocaleString('tr-TR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}`
                  : ''}
                {doc.status === 'ready' ? ` · ${formatSize(doc.bytes)}` : ''}
                {doc.status === 'loading' ? ' · ⏳' : ''}
              </span>
            </div>
          </div>

          <div className="kap-pdf-actions">
            {isPdf && (
              <div className="kap-pdf-mode-toggle">
                <button
                  type="button"
                  className={`mode-btn ${engine === 'native' ? 'active' : ''}`}
                  onClick={() => setEngine('native')}
                  title={t('reportsViewerEngineNativeHint')}
                >
                  ⚡ {t('reportsViewerEngineNative')}
                </button>
                <button
                  type="button"
                  className={`mode-btn ${engine === 'gview' ? 'active' : ''}`}
                  onClick={() => setEngine('gview')}
                  title={t('reportsViewerEngineCloudHint')}
                >
                  ☁ {t('reportsViewerEngineCloud')}
                </button>
              </div>
            )}

            <div className="kap-pdf-zoom-ctrl">
              <button type="button" onClick={() => setZoom((z) => Math.max(50, z - 15))}>−</button>
              <span>%{zoom}</span>
              <button type="button" onClick={() => setZoom((z) => Math.min(200, z + 15))}>+</button>
            </div>

            <button
              type="button"
              className={`mode-btn ${isDockedRight ? 'active' : ''}`}
              onClick={() => setIsDockedRight((docked) => !docked)}
              title={isDockedRight ? t('reportsViewerUndock') : t('reportsViewerDock')}
            >
              {isDockedRight ? '📑' : '📌'}
            </button>

            <button type="button" className="kap-pdf-ext-btn" onClick={() => void openUrl(sourceUrl)}>
              ↗ {t('reportsViewerOpenExternal')}
            </button>

            <button type="button" className="kap-pdf-close-btn" onClick={handleClose} title={t('close')}>
              ✕
            </button>
          </div>
        </div>

        {tickers.length > 0 && (
          <div className="kap-attachments-bar">
            <div className="attachments-label">
              <span>{t('reportsViewerRelated')}</span>
            </div>
            <div className="attachments-list">
              {tickers.map((code) => (
                <button
                  key={code}
                  type="button"
                  className="attachment-chip"
                  onClick={() => {
                    onSelectTicker?.(code);
                    handleClose();
                  }}
                >
                  <span className="att-name">{code}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="kap-pdf-viewport">
          <div className="kap-pdf-iframe-container">
            {doc.status === 'loading' && (
              <div className="empty-state" style={{ padding: '40px', textAlign: 'center' }}>
                {t('reportsViewerLoading')}
              </div>
            )}

            {doc.status === 'error' && (
              <div className="empty-state" style={{ padding: '40px', textAlign: 'center' }}>
                <p style={{ color: '#f85149', marginBottom: '12px' }}>{t('reportsViewerFailed')}</p>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                  {doc.message}
                </p>
                <button type="button" className="tab-button" onClick={() => void openUrl(sourceUrl)}>
                  ↗ {t('reportsViewerOpenExternal')}
                </button>
              </div>
            )}

            {doc.status === 'ready' && (
              <div
                className="kap-pdf-iframe-wrapper"
                style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}
              >
                {isPdf ? (
                  engine === 'native' ? (
                    // Blob aynı köken sayılır; kurumun çerçeveleme kısıtı burada
                    // geçerli değildir ve yerel PDF motoru doğrudan çizer.
                    <object data={doc.objectUrl} type={doc.contentType} className="kap-pdf-iframe">
                      <iframe src={doc.objectUrl} title={target.title} className="kap-pdf-iframe" />
                    </object>
                  ) : (
                    // Yedek motor belgeyi kaynağından kendisi çeker; blob'u
                    // dışarı veremeyeceğimiz için özgün adres kullanılır.
                    <iframe
                      src={`https://docs.google.com/gview?url=${encodeURIComponent(sourceUrl)}&embedded=true`}
                      title={target.title}
                      className="kap-pdf-iframe"
                    />
                  )
                ) : (
                  <iframe
                    src={doc.objectUrl}
                    title={target.title}
                    className="kap-pdf-iframe"
                    sandbox="allow-same-origin"
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
