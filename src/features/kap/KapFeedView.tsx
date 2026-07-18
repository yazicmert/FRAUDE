import { useCallback, useEffect, useState } from 'react';
import { openUrl } from '../../lib/openExternal';
import { listKapAnnouncements } from '../../api/tauriClient';
import type { KapAnnouncement } from '../../types';
import { useTranslation } from '../../api/i18n';
import { dispatchAiAsk } from '../../lib/actions';

function scoreClass(score: number): string {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

export default function KapFeedView({ initialRows }: { initialRows?: KapAnnouncement[] }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<KapAnnouncement[]>(initialRows ?? []);
  const [loading, setLoading] = useState(!initialRows);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterTicker, setFilterTicker] = useState('');

  const loadData = useCallback(async () => {
    try {
      const data = await listKapAnnouncements();
      setRows(data);
    } catch {
      // Arka plan yenilemesi başarısızsa eldeki liste korunur; boşaltmak
      // akışı gereksiz yere sıfırlayıp görünümü titretir.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialRows) {
      void loadData();
    }
  }, [initialRows, loadData]);

  // Listen for sync events to refresh data
  useEffect(() => {
    const handler = () => void loadData();
    window.addEventListener('fraude-sync-completed', handler);
    return () => window.removeEventListener('fraude-sync-completed', handler);
  }, [loadData]);

  const filtered = filterTicker
    ? rows.filter((item) =>
        item.ticker.toLowerCase().includes(filterTicker.toLowerCase())
      )
    : rows;

  const sources = [...new Set(rows.map((r) => r.category))];
  const tickerCount = [...new Set(rows.map((r) => r.ticker))].length;

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <p className="eyebrow">{t('kapFeed')}</p>
          <h1>{t('kapFeed')}</h1>
          <p style={{ fontSize: '0.82rem', color: '#8b949e', marginTop: '4px' }}>
            {t('kapFeedSubtitle')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            className="kap-filter-input"
            placeholder={t('kapFilterPlaceholder')}
            value={filterTicker}
            onChange={(e) => setFilterTicker(e.target.value)}
          />
          <button type="button" className="small-button" onClick={() => void loadData()}>
            {t('kapRefresh')}
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {rows.length > 0 && (
        <div className="feed-stats">
          <span>
            {t('records')}: <span className="stat-value">{filtered.length}</span>
            {filterTicker && ` / ${rows.length}`}
          </span>
          <span>·</span>
          <span>
            {t('ticker')}: <span className="stat-value">{tickerCount}</span>
          </span>
          <span>·</span>
          <span>
            {sources.join(' · ')}
          </span>
        </div>
      )}

      {loading && <div className="empty-state">{t('kapLoadingAnnouncements')}</div>}
      {!loading && filtered.length === 0 && (
        <div className="empty-state">{t('kapNoAnnouncements')}</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {filtered.map((item) => {
          const isExpanded = expandedId === item.id;
          return (
            <article
              key={item.id}
              className={`kap-item-enhanced${isExpanded ? ' expanded' : ''}`}
              onClick={() => setExpandedId(isExpanded ? null : item.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setExpandedId(isExpanded ? null : item.id);
                }
              }}
              role="button"
              tabIndex={0}
              aria-expanded={isExpanded}
            >
              <div className="kap-item-header">
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <span className="kap-item-ticker">{item.ticker}</span>
                    <span className="kap-item-title">{item.title}</span>
                  </div>
                  <div className="kap-item-meta">
                    <span className="kap-item-date">{item.date}</span>
                    <span className="kap-item-category">{item.category}</span>
                    <span className={`kap-item-score ${scoreClass(item.ai_importance_score)}`}>
                      AI {item.ai_importance_score}
                    </span>
                  </div>
                </div>
              </div>

              {item.summary && (
                <p className="kap-item-summary">{item.summary}</p>
              )}

              {isExpanded && item.url && (
                <div className="kap-item-footer" onClick={(e) => e.stopPropagation()}>
                  <span style={{ fontSize: '0.72rem', color: '#8b949e' }}>
                    ID: {item.id}
                  </span>
                  <button
                    type="button"
                    className="small-button"
                    style={{ fontSize: '0.72rem', padding: '5px 10px' }}
                    onClick={() => dispatchAiAsk(
                      `${item.ticker} için şu KAP bildirimini yatırımcı gözüyle 2-3 cümlede özetle ve olası etkisini belirt: "${item.title}"${item.summary ? ` — ${item.summary}` : ''}. Yatırım tavsiyesi verme.`,
                    )}
                  >
                    🤖 Özetle
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    style={{ fontSize: '0.72rem', padding: '5px 10px' }}
                    onClick={() => void openUrl(item.url)}
                  >
                    {t('kapReadMore')}
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
