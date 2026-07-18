import { useCallback, useEffect, useState } from 'react';
import { openUrl } from '../../lib/openExternal';
import { Readability } from '@mozilla/readability';
import DOMPurify from 'dompurify';
import { getNewsFeed, getNewsPreview, getNewsHtml } from '../../api/tauriClient';
import type { NewsItem } from '../../types';
import { useTranslation } from '../../api/i18n';
// Modül düzeyi yardımcılar bileşen dışı çalıştığından hook yerine i18next
// örneği kullanılır.
import i18n from '../../i18n';

function formatDate(value: string) {
  if (!value) return i18n.t('noDate');
  const gdeltMatch = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  const normalized = gdeltMatch
    ? `${gdeltMatch[1]}-${gdeltMatch[2]}-${gdeltMatch[3]}T${gdeltMatch[4]}:${gdeltMatch[5]}:${gdeltMatch[6]}Z`
    : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(i18n.language === 'tr' ? 'tr-TR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function fallbackSummary(item: NewsItem) {
  const publisher = item.source.replace(/^Google News\s*\/\s*/i, '').replace(/^GDELT\s*\/\s*/i, '');
  const escapedPublisher = publisher.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headline = item.title
    .replace(new RegExp(`\\s+-\\s+${escapedPublisher}$`, 'i'), '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return i18n.t('newsFallbackSummary', { publisher, headline: `${headline}${/[.!?]$/.test(headline) ? '' : '.'}` });
}

export function NewsList({ news }: { news: NewsItem[] }) {
  const { t } = useTranslation();
  const [expandedLink, setExpandedLink] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [readerLoading, setReaderLoading] = useState<string | null>(null);
  const [activeArticle, setActiveArticle] = useState<{ title: string; html: string; link: string } | null>(null);

  const toggleArticle = async (item: NewsItem) => {
    if (expandedLink === item.link) {
      setExpandedLink(null);
      return;
    }
    setExpandedLink(item.link);
    if (item.summary || previews[item.link]) return;

    if (item.link.includes('news.google.com/')) {
      setPreviews((current) => ({ ...current, [item.link]: fallbackSummary(item) }));
      return;
    }

    setPreviewLoading(item.link);
    try {
      const summary = await getNewsPreview(item.link);
      setPreviews((current) => ({ ...current, [item.link]: summary }));
    } catch {
      setPreviews((current) => ({
        ...current,
        [item.link]: fallbackSummary(item),
      }));
    } finally {
      setPreviewLoading(null);
    }
  };

  return (
    <div className="kap-list" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {news.map((item) => (
        <article
          className="news-article"
          key={`${item.source}-${item.link}`}
          onClick={() => void toggleArticle(item)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              void toggleArticle(item);
            }
          }}
          role="button"
          tabIndex={0}
          aria-expanded={expandedLink === item.link}
          style={{
            cursor: 'pointer',
            background: '#0d1117',
            border: `1px solid ${item.is_kap ? 'rgba(255, 184, 0, 0.45)' : '#21262d'}`,
            padding: '16px',
            borderRadius: '6px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
            <strong style={{ fontSize: '1.05rem', color: '#fff', lineHeight: '1.4' }}>{item.title}</strong>
            <span
              style={{
                fontSize: '0.7rem',
                background: item.is_kap ? 'rgba(255, 184, 0, 0.14)' : 'rgba(0, 255, 157, 0.12)',
                color: item.is_kap ? '#ffb800' : 'var(--accent-primary)',
                padding: '3px 8px',
                borderRadius: '10px',
                fontWeight: 'bold',
                whiteSpace: 'nowrap',
              }}
            >
              {item.is_kap ? 'KAP' : item.source}
            </span>
          </div>
          <span style={{ fontSize: '0.75rem', color: '#8b949e', marginBottom: '8px', display: 'block' }}>
            {formatDate(item.pub_date)}
          </span>
          {((item.tags && item.tags.length > 0) || (item.sector_tags && item.sector_tags.length > 0)) && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
              {item.tags?.map((t, idx) => {
                const isPositive = t.sentiment === 'POSITIVE';
                const isNegative = t.sentiment === 'NEGATIVE';
                const bg = isPositive ? '#23863622' : isNegative ? '#da363322' : '#30363d';
                const color = isPositive ? '#3fb950' : isNegative ? '#ff7b72' : '#8b949e';
                return (
                  <span key={idx} title={t.reason} style={{
                    padding: '2px 8px', borderRadius: '12px', fontSize: '0.7rem',
                    fontWeight: 'bold', background: bg, color, border: `1px solid ${bg.replace('22', '44')}`,
                  }}>
                    {t.ticker}
                  </span>
                );
              })}
              {item.sector_tags?.map((sector, idx) => (
                <span key={`s-${idx}`} style={{
                  padding: '2px 8px', borderRadius: '12px', fontSize: '0.7rem',
                  background: '#58a6ff22', color: '#58a6ff', border: '1px solid #58a6ff44',
                }}>
                  #{sector}
                </span>
              ))}
            </div>
          )}
          {expandedLink === item.link && (
            <div
              style={{
                marginTop: '12px',
                paddingTop: '12px',
                borderTop: '1px solid #21262d',
                cursor: 'default',
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <p style={{ margin: '0 0 12px', color: '#c9d1d9', lineHeight: 1.6 }}>
                {item.summary
                  ?? previews[item.link]
                  ?? (previewLoading === item.link ? t('newsLoadingPreview') : t('newsNoSummary'))}
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void openUrl(item.link)}
                >
                  {t('newsReadAtSource')}
                </button>
                {!item.is_kap && (
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ padding: '6px 12px', background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer' }}
                    disabled={readerLoading === item.link}
                    onClick={async (e) => {
                      e.stopPropagation();
                      setReaderLoading(item.link);
                      try {
                        const html = await getNewsHtml(item.link);
                        const doc = new DOMParser().parseFromString(html, 'text/html');
                        const reader = new Readability(doc).parse();
                        if (reader && reader.content) {
                          const cleanHtml = DOMPurify.sanitize(reader.content, { USE_PROFILES: { html: true } });
                          setActiveArticle({ title: reader.title || item.title, html: cleanHtml, link: item.link });
                        } else {
                          // Tauri'nin macOS WebView'ü alert() desteklemez; hata okuyucuda gösterilir.
                          setActiveArticle({
                            title: t('readerUnreadableTitle'),
                            html: t('readerUnreadableBody'),
                            link: item.link,
                          });
                        }
                      } catch (err) {
                        const detail = err instanceof Error ? err.message : String(err);
                        setActiveArticle({
                          title: t('readerFailedTitle'),
                          html: DOMPurify.sanitize(`<p>${detail || t('readerFailedFallback')}</p>`, { USE_PROFILES: { html: true } }),
                          link: item.link,
                        });
                      } finally {
                        setReaderLoading(null);
                      }
                    }}
                  >
                    {readerLoading === item.link ? t('loadingData') : t('readInFraude')}
                  </button>
                )}
              </div>
            </div>
          )}
        </article>
      ))}

      {/* Reader Modal */}
      {activeArticle && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex',
          justifyContent: 'center', padding: '40px 20px'
        }} onClick={() => setActiveArticle(null)}>
          <div style={{
            background: '#0d1117', border: '1px solid #30363d', borderRadius: '12px',
            width: '100%', maxWidth: '800px', maxHeight: '100%', overflow: 'auto',
            position: 'relative', display: 'flex', flexDirection: 'column'
          }} onClick={e => e.stopPropagation()}>
            <div style={{
              padding: '16px 24px', borderBottom: '1px solid #30363d',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              position: 'sticky', top: 0, background: '#0d1117', zIndex: 10
            }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem', color: '#fff', paddingRight: '20px' }}>{activeArticle.title}</h2>
              <button
                type="button"
                onClick={() => setActiveArticle(null)}
                style={{ background: 'transparent', border: 'none', color: '#8b949e', fontSize: '1.5rem', cursor: 'pointer' }}
              >
                &times;
              </button>
            </div>
            <div
              style={{ padding: '30px 24px', color: '#c9d1d9', fontSize: '1.05rem', lineHeight: 1.6, fontFamily: 'Georgia, serif' }}
              className="reader-content"
              dangerouslySetInnerHTML={{ __html: activeArticle.html }}
            />
            <div style={{ padding: '20px 24px', borderTop: '1px solid #30363d', textAlign: 'center' }}>
              <button type="button" className="primary-button" onClick={() => void openUrl(activeArticle.link)}>
                {t('openOriginal')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SourceBreakdown({ news }: { news: NewsItem[] }) {
  const sources = news.reduce<Record<string, number>>((acc, item) => {
    const src = item.is_kap ? 'KAP' : item.source.split('/')[0].trim();
    acc[src] = (acc[src] || 0) + 1;
    return acc;
  }, {});

  return (
    <>
      {Object.entries(sources).map(([src, count]) => (
        <span key={src}>
          {src}: <span className="stat-value">{count}</span>
        </span>
      ))}
    </>
  );
}

export default function NewsFeedView() {
  const { t } = useTranslation();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [tickerInput, setTickerInput] = useState('');
  const [activeTicker, setActiveTicker] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadNews = useCallback(async (ticker = activeTicker) => {
    setLoading(true);
    setError(null);
    try {
      setNews(await getNewsFeed(ticker || undefined));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [activeTicker]);

  useEffect(() => {
    void loadNews('');
    
    // Otomatik güncelleme: Her 3 dakikada bir haberleri yenile
    const interval = setInterval(() => {
      void loadNews();
    }, 3 * 60 * 1000);
    
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submitTicker = (event: React.FormEvent) => {
    event.preventDefault();
    const ticker = tickerInput.trim().toUpperCase();
    setActiveTicker(ticker);
    void loadNews(ticker);
  };

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <p className="eyebrow">{t('newsEyebrow')}</p>
          <h1>{t('newsFeed')}{activeTicker ? ` · ${activeTicker}` : ''}</h1>
          <p>{t('newsHeaderDesc')}</p>
        </div>
        <form onSubmit={submitTicker} style={{ display: 'flex', gap: '8px' }}>
          <input
            className="top-input"
            aria-label={t('tickerCodeLabel')}
            placeholder="ASELS, THYAO..."
            value={tickerInput}
            onChange={(event) => setTickerInput(event.target.value)}
            style={{ width: '170px' }}
          />
          <button type="submit" className="primary-button">{t('tickerNewsBtn')}</button>
          <button type="button" className="small-button" onClick={() => void loadNews()}>{t('kapRefresh')}</button>
        </form>
      </div>

      <div className="panel" style={{ marginBottom: '12px', padding: '10px 14px' }}>
        <span style={{ fontSize: '0.75rem', color: '#8b949e' }}>
          {t('kapSearchDisclaimer')}
        </span>
      </div>

      {loading && <div className="empty-state">{t('kapLoadingAnnouncements')}</div>}
      {!loading && error && <div className="empty-state error">{error}</div>}
      {!loading && !error && news.length === 0 && <div className="empty-state">{t('kapNoAnnouncements')}</div>}
      {!loading && !error && news.length > 0 && (
        <>
          <div className="feed-stats">
            <span>{t('records')}: <span className="stat-value">{news.length}</span></span>
            <span>·</span>
            <SourceBreakdown news={news} />
          </div>
          <NewsList news={news} />
        </>
      )}
    </div>
  );
}
