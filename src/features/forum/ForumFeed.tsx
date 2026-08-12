import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../api/i18n';
import ForumComposer from './ForumComposer';
import ForumPostCard from './ForumPostCard';
import {
  blockedUserIds,
  currentUserId,
  forumErrorKey,
  isModerator,
  listPosts,
  normalizeTicker,
  subscribeForum,
  type ForumChange,
  type ForumPost,
} from './forumApi';

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
 * Yeni sayfayı ekrandakiyle birleştirir.
 *
 * Tazeleme listeyi DEĞİŞTİRMEZ: "daha fazla" ile açılmış eski sayfalar yerinde
 * kalır, yoksa 60 saniyede bir okuduğu yerden başa fırlatılırdı. Gelen sayfa
 * ilk `limit` satırdır; ondan daha yeni olup gelmeyen bir kayıt artık akışta
 * değildir (silinmiş ya da süzülmüştür), bu yüzden düşer.
 */
function mergeFeed(current: ForumPost[], incoming: ForumPost[]): ForumPost[] {
  if (incoming.length === 0) return [];
  const boundary = incoming[incoming.length - 1].createdAt;
  const seen = new Set(incoming.map((post) => post.id));
  const older = current.filter((post) => !seen.has(post.id) && post.createdAt <= boundary);
  return [...incoming, ...older];
}

/**
 * Forum akışı: modül görünümü ile hisse sayfasındaki bölüm aynı bileşeni
 * kullanır, tek fark filtre ve yoğunluktur.
 *
 * Başkalarının gönderileri canlı yayınla düşer ve yayın satırı doğrudan
 * listeye işlenir — her olayda tüm listeyi yeniden çekmek, hem sunucuyu hem de
 * okunan yeri boşuna zorluyordu. Yayın kapalıysa görünür sekmede dakikada bir
 * yoklama aynı işi (daha geç) yapar.
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
  const [moderator, setModerator] = useState(false);
  const userId = currentUserId();
  const postsRef = useRef<ForumPost[]>([]);
  const blockedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);

  useEffect(() => {
    let cancelled = false;
    void blockedUserIds().then((set) => {
      if (!cancelled) blockedRef.current = set;
    });
    void isModerator().then((flag) => {
      if (!cancelled) setModerator(flag);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const load = useCallback(async (mode: 'initial' | 'silent') => {
    if (mode === 'initial') {
      setLoading(true);
      setError(null);
    }
    try {
      const page = await listPosts({ ticker, search, limit: pageSize });
      if (mode === 'initial') {
        setPosts(page.posts);
        setHasMore(page.hasMore);
      } else {
        // Ekranda ilk sayfadan fazlası varsa kuyruğun devamı hakkındaki bilgi
        // "daha fazla"dan gelir; ilk sayfanın cevabı onu geçersizleştirmemeli.
        const hadOlder = postsRef.current.length > page.posts.length;
        setPosts((current) => mergeFeed(current, page.posts));
        if (!hadOlder) setHasMore(page.hasMore);
      }
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

  /** Yayından gelen tek satırı listeye işler. */
  const applyChange = useCallback((change: ForumChange) => {
    setPosts((current) => {
      const index = current.findIndex((post) => post.id === change.id);
      if (change.gone) return index === -1 ? current : current.filter((post) => post.id !== change.id);

      const incoming = change.post;
      if (!incoming) return current;

      if (index >= 0) {
        // Yayın satırında beğeni/bildirim işareti yoktur (kullanıcıya özeldir);
        // sayaçlar sunucudan, işaretler ekrandaki kopyadan gelir.
        const previous = current[index];
        const next = [...current];
        next[index] = {
          ...incoming,
          likedByMe: previous.likedByMe,
          reportedByMe: previous.reportedByMe,
        };
        return next;
      }

      // Listede olmayan bir satırın güncellemesi ilgisizdir; yalnız yeni kök
      // konular akışın başına eklenir.
      if (change.op !== 'INSERT' || incoming.parentId !== null) return current;
      if (blockedRef.current.has(incoming.userId)) return current;
      if (ticker && !incoming.tickers.includes(normalizeTicker(ticker))) return current;
      if (search) {
        const needle = search.toLocaleLowerCase('tr-TR');
        const haystack = `${incoming.body} ${incoming.authorName}`.toLocaleLowerCase('tr-TR');
        if (!haystack.includes(needle)) return current;
      }
      return [incoming, ...current];
    });
  }, [ticker, search]);

  useEffect(() => {
    const unsubscribe = subscribeForum(applyChange);
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load('silent');
    }, 60_000);
    return () => {
      unsubscribe();
      window.clearInterval(poll);
    };
  }, [applyChange, load]);

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

  const replacePost = (next: ForumPost) => {
    setPosts((current) => current.map((item) => (item.id === next.id ? next : item)));
  };

  const handleBlocked = (blockedId: string) => {
    setPosts((current) => current.filter((item) => item.userId !== blockedId));
    void blockedUserIds().then((set) => {
      blockedRef.current = set;
    });
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
          currentUserId={userId}
          moderator={moderator}
          compact={compact}
          onSelectTicker={onSelectTicker}
          onRemoved={(id) => setPosts((current) => current.filter((item) => item.id !== id))}
          onChanged={replacePost}
          onBlocked={handleBlocked}
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
