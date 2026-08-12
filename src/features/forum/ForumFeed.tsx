import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../api/i18n';
import { getSession } from '../auth/session';
import ForumComposer from './ForumComposer';
import ForumPostCard from './ForumPostCard';
import { forumErrorKey, listPosts, subscribeForum, type ForumPost } from './forumApi';

interface Props {
  /** Dolu ise yalnız bu hisseyi etiketleyen konular; yazma kutusu da etiketler. */
  ticker?: string | null;
  search?: string;
  pageSize?: number;
  compact?: boolean;
  showComposer?: boolean;
  onSelectTicker?: (ticker: string) => void;
  emptyText?: string;
  composerPlaceholder?: string;
}

/**
 * Forum akışı: modül görünümü ile hisse sayfasındaki bölüm aynı bileşeni
 * kullanır, tek fark filtre ve yoğunluktur. Başkalarının gönderileri canlı
 * yayınla düşer; yayın kapalıysa görünür sekmede dakikada bir yoklanır.
 */
export default function ForumFeed({
  ticker = null,
  search = '',
  pageSize = 25,
  compact = false,
  showComposer = true,
  onSelectTicker,
  emptyText,
  composerPlaceholder,
}: Props) {
  const { t } = useTranslation();
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentUserId = getSession()?.id ?? null;
  const refreshTimer = useRef<number | null>(null);

  const load = useCallback(async (mode: 'initial' | 'silent') => {
    if (mode === 'initial') {
      setLoading(true);
      setError(null);
    }
    try {
      const page = await listPosts({ ticker, search, limit: pageSize });
      setPosts(page.posts);
      setHasMore(page.hasMore);
      setError(null);
    } catch (err) {
      // Sessiz tazelemede hata ekrandaki listeyi silmez: geçici bir kopukluk
      // okunan akışı boşaltmamalı.
      if (mode === 'initial') setError(t(forumErrorKey(err)));
    } finally {
      if (mode === 'initial') setLoading(false);
    }
  }, [ticker, search, pageSize, t]);

  useEffect(() => {
    void load('initial');
  }, [load]);

  useEffect(() => {
    const schedule = () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      // Canlı yayın olayları küme hâlinde gelir (yanıt + sayaç güncellemesi);
      // tek tazelemede toplanır.
      refreshTimer.current = window.setTimeout(() => void load('silent'), 1200);
    };
    const unsubscribe = subscribeForum(schedule);
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load('silent');
    }, 60_000);
    return () => {
      unsubscribe();
      window.clearInterval(poll);
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, [load]);

  const loadMore = async () => {
    const last = posts[posts.length - 1];
    if (!last || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listPosts({ ticker, search, limit: pageSize, before: last.createdAt });
      setPosts((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...page.posts.filter((item) => !seen.has(item.id))];
      });
      setHasMore(page.hasMore);
    } catch (err) {
      setError(t(forumErrorKey(err)));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className={`frm-feed${compact ? ' compact' : ''}`}>
      {showComposer && (
        <ForumComposer
          compact={compact}
          presetTickers={ticker ? [ticker] : []}
          placeholder={composerPlaceholder}
          onPosted={(post) => setPosts((current) => [post, ...current.filter((item) => item.id !== post.id)])}
        />
      )}

      {loading && <div className="frm-note">{t('forumLoading')}</div>}
      {!loading && error && <div className="frm-error block">{error}</div>}
      {!loading && !error && posts.length === 0 && (
        <div className="frm-note">{emptyText ?? t('forumEmpty')}</div>
      )}

      {posts.map((post) => (
        <ForumPostCard
          key={post.id}
          post={post}
          currentUserId={currentUserId}
          compact={compact}
          onSelectTicker={onSelectTicker}
          onRemoved={(id) => setPosts((current) => current.filter((item) => item.id !== id))}
        />
      ))}

      {hasMore && !loading && (
        <button type="button" className="small-button frm-more" onClick={() => void loadMore()} disabled={loadingMore}>
          {loadingMore ? t('forumLoading') : t('forumLoadMore')}
        </button>
      )}
    </div>
  );
}
