import { useEffect, useMemo, useState } from 'react';
import { getNewsHtml, getReportDocument } from '../../api/tauriClient';
import { useTranslation } from '../../api/i18n';
import { openUrl } from '../../lib/openExternal';
import { prepareArticle } from '../../lib/articleReader';
import { recordCopilotAction, setCopilotActivePayload } from '../ai/userContext';
import type { AnalystReport, NewsItem } from '../../types';
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
  /**
   * Belgenin nasıl getirileceği. Varsayılan `file`: adres bir dosyaya işaret
   * eder, indirilip gömülür. `article` ise canlı bir haber sayfasıdır; sayfa
   * çekilip hem kaynak düzeniyle hem sade metin olarak gösterilir.
   */
  sourceKind?: 'file' | 'article';
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

/**
 * Haberi okuyucunun anladığı kayda çevirir.
 *
 * Tarih çağıranda biçimlenir: haber akışı ile bilgi deposu aynı listeyi
 * farklı yerelle basıyor, okuyucu ikinci bir biçimleme kuralı taşımasın.
 */
export function documentFromNews(item: NewsItem, kindLabel: string, published: string): ViewerDocument {
  const tickers = Array.from(new Set((item.tags ?? []).map((tag) => tag.ticker).filter(Boolean)));
  return {
    id: item.link,
    title: item.title,
    source: item.source,
    kindLabel,
    published,
    url: item.link,
    tickers,
    sourceKind: 'article',
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
  /** Haber sayfası: kaynak düzeni çerçevede, sade metin yanında hazır durur. */
  | { status: 'article'; objectUrl: string; readerHtml: string | null; bytes: number }
  | { status: 'error'; message: string };

/**
 * Çizim motoru.
 *
 * Dosyalarda: `native` indirilen belgeyi yerel motorla çizer, `gview` bulut
 * yedeğidir. Haberlerde: `page` kaynak sayfanın kendi düzeni, `reader` sade
 * metin.
 */
type Engine = 'native' | 'gview' | 'page' | 'reader';

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
   * Varsayılan yerel: belge zaten indirildiği için dışarıya istek gitmez.
   * Gömülü motorun PDF çizmediği durumlar için KAP okuyucusundaki Google
   * Viewer yedeği aynen burada da var. Haber gelince mod, sayfadan metin
   * çıkarılabildiyse `reader`'a çevrilir.
   */
  const [engine, setEngine] = useState<Engine>('native');

  const isArticle = target?.sourceKind === 'article';
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
    setEngine(isArticle ? 'page' : 'native');
    void (async () => {
      try {
        if (isArticle) {
          // Haber sayfası arka uçtan çekilir: kaynaklar çerçevelenmeyi
          // reddediyor, üstelik Google News bağlantıları önce çözülmeli.
          const html = await getNewsHtml(sourceUrl);
          if (cancelled) return;
          const prepared = prepareArticle(html, sourceUrl);
          const blob = new Blob([prepared.page], { type: 'text/html;charset=utf-8' });
          created = URL.createObjectURL(blob);
          setDoc({
            status: 'article',
            objectUrl: created,
            readerHtml: prepared.reader,
            bytes: blob.size,
          });
          // Sade metin çıkarılabildiyse okuma onunla başlar; sayfa düzeni
          // menüsü, reklamı ve yorum bölümüyle bir tık uzakta durur.
          setEngine(prepared.reader ? 'reader' : 'page');
          return;
        }
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
  }, [target, sourceUrl, isArticle]);

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
                {doc.status === 'ready' || doc.status === 'article' ? ` · ${formatSize(doc.bytes)}` : ''}
                {doc.status === 'loading' ? ' · ⏳' : ''}
              </span>
            </div>
          </div>

          <div className="kap-pdf-actions">
            {doc.status === 'article' && (
              <div className="kap-pdf-mode-toggle">
                <button
                  type="button"
                  className={`mode-btn ${engine === 'reader' ? 'active' : ''}`}
                  onClick={() => setEngine('reader')}
                  disabled={!doc.readerHtml}
                  title={doc.readerHtml ? t('readerModeReaderHint') : t('readerModeReaderUnavailable')}
                >
                  📖 {t('readerModeReader')}
                </button>
                <button
                  type="button"
                  className={`mode-btn ${engine === 'page' ? 'active' : ''}`}
                  onClick={() => setEngine('page')}
                  title={t('readerModePageHint')}
                >
                  🌐 {t('readerModePage')}
                </button>
              </div>
            )}

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
                {isArticle ? t('readerFetchingArticle') : t('reportsViewerLoading')}
              </div>
            )}

            {doc.status === 'error' && (
              <div className="empty-state" style={{ padding: '40px', textAlign: 'center' }}>
                <p style={{ color: '#f85149', marginBottom: '12px' }}>
                  {isArticle ? t('readerArticleFailed') : t('reportsViewerFailed')}
                </p>
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

            {doc.status === 'article' &&
              (engine === 'reader' && doc.readerHtml ? (
                // Sade metin uygulamanın kendi tipografisiyle çizilir. Burada
                // yakınlaştırma ölçek değil punto demektir; ölçeklenen bir metin
                // sütunu satır genişliğini bozar, büyüyen punto bozmaz.
                <article
                  className="reader-content kap-article-reader"
                  style={{ fontSize: `${zoom}%` }}
                  dangerouslySetInnerHTML={{ __html: doc.readerHtml }}
                />
              ) : (
                <div
                  className="kap-pdf-iframe-wrapper"
                  style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}
                >
                  {/* Sayfa betiksiz ve kökensiz bir kutuda açılır: kaynağın kendi
                      düzeni görünür, ama sayfa ne betik çalıştırabilir ne de
                      uygulamanın verisine uzanabilir. */}
                  <iframe src={doc.objectUrl} title={target.title} className="kap-pdf-iframe" sandbox="" />
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
