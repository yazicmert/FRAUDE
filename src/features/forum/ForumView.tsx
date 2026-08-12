import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../../api/i18n';
import { useWatchlist } from '../../hooks/useWatchlist';
import ForumFeed from './ForumFeed';
import { normalizeTicker, trendingTickers, type TrendingTicker } from './forumApi';
import './Forum.css';

interface Props {
  /** Sekme yükünden gelen hisse filtresi (hisse sayfasındaki "Forumda aç"). */
  initialTicker?: string | null;
  onSelectTicker?: (ticker: string) => void;
}

/**
 * Topluluk forumu. Gönderiler Supabase'te ortaktır: bir kullanıcının yazdığı
 * konu diğerlerinin uygulamasında da görünür. Metinde $KOD ile etiketlenen
 * hisseler kaydın `tickers` dizisine yazılır ve aynı gönderi o hissenin
 * sayfasındaki forum bölümünde de listelenir.
 */
export default function ForumView({ initialTicker = null, onSelectTicker }: Props) {
  const { t } = useTranslation();
  const { watchlist } = useWatchlist();
  const [ticker, setTicker] = useState<string | null>(initialTicker ? normalizeTicker(initialTicker) : null);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [trending, setTrending] = useState<TrendingTicker[]>([]);

  // Hisse sayfasından "Forumda aç" ile gelindiğinde sekme zaten açıksa yalnız
  // yük değişir; filtre bu yüzden prop'u izler.
  useEffect(() => {
    if (initialTicker) setTicker(normalizeTicker(initialTicker));
  }, [initialTicker]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchDraft.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => {
    let cancelled = false;
    void trendingTickers(168, 10)
      .then((rows) => {
        if (!cancelled) setTrending(rows);
      })
      .catch(() => {
        /* şema kurulmamışsa akıştaki uyarı yeterli */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const watchlistTickers = useMemo(
    () => Array.from(new Set(watchlist.map((item) => item.ticker.toUpperCase()))).slice(0, 12),
    [watchlist],
  );

  return (
    <div className="frm-view">
      <header className="frm-head">
        <div>
          <h1>{t('forum')}</h1>
          <p className="frm-sub">{t('forumSubtitle')}</p>
        </div>
        <input
          className="frm-search"
          value={searchDraft}
          placeholder={t('forumSearchPlaceholder')}
          onChange={(event) => setSearchDraft(event.target.value)}
        />
      </header>

      <div className="frm-filters">
        <button
          type="button"
          className={`frm-filter${ticker ? '' : ' on'}`}
          onClick={() => setTicker(null)}
        >
          {t('forumAll')}
        </button>
        {ticker && !watchlistTickers.includes(ticker) && (
          <button type="button" className="frm-filter on" onClick={() => setTicker(null)}>
            {ticker} ×
          </button>
        )}
        {watchlistTickers.map((symbol) => (
          <button
            key={symbol}
            type="button"
            className={`frm-filter${ticker === symbol ? ' on' : ''}`}
            onClick={() => setTicker(ticker === symbol ? null : symbol)}
          >
            {symbol}
          </button>
        ))}
      </div>

      <div className="frm-columns">
        <div className="frm-main">
          {ticker && (
            <div className="frm-context">
              <span>{t('forumFilterActive', { ticker })}</span>
              <div>
                {onSelectTicker && (
                  <button type="button" className="small-button" onClick={() => onSelectTicker(ticker)}>
                    {t('forumOpenTicker')}
                  </button>
                )}
                <button type="button" className="small-button" onClick={() => setTicker(null)}>
                  {t('forumClearFilter')}
                </button>
              </div>
            </div>
          )}

          <ForumFeed
            ticker={ticker}
            search={search}
            onSelectTicker={onSelectTicker}
            emptyText={ticker ? t('forumEmptyTicker', { ticker }) : t('forumEmpty')}
            composerPlaceholder={ticker ? t('forumComposerTickerPlaceholder', { ticker }) : undefined}
          />
        </div>

        <aside className="frm-rail">
          <h2>{t('forumTrending')}</h2>
          {trending.length === 0 && <p className="frm-note">{t('forumTrendingEmpty')}</p>}
          {trending.map((row) => (
            <button
              key={row.ticker}
              type="button"
              className={`frm-trend${ticker === row.ticker ? ' on' : ''}`}
              onClick={() => setTicker(row.ticker)}
            >
              <strong>{row.ticker}</strong>
              <span>{t('forumTrendCount', { count: row.posts })}</span>
            </button>
          ))}
          <p className="frm-note small">{t('forumTagHelp')}</p>
        </aside>
      </div>
    </div>
  );
}
