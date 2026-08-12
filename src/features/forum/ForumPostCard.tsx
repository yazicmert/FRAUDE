import { useState } from 'react';
import { useTranslation } from '../../api/i18n';
import ForumComposer from './ForumComposer';
import {
  deletePost,
  forumErrorKey,
  listReplies,
  setLike,
  splitBody,
  type ForumPost,
} from './forumApi';

const AVATAR_COLORS = ['#58a6ff', '#3fb950', '#d29922', '#a371f7', '#ff7b72', '#00c3ff', '#f0883e', '#7ee787'];

/** Kullanıcı kimliğinden değişmez bir avatar rengi türetir. */
function avatarColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toLocaleUpperCase('tr-TR')).join('') || '?';
}

/** Göreli zaman; bir günden eskisi tarih olarak yazılır (App.formatSyncTime deseni). */
export function timeAgo(iso: string, t: (key: string) => string, lang: string): string {
  const stamp = new Date(iso).getTime();
  if (Number.isNaN(stamp)) return '';
  const diff = Math.floor((Date.now() - stamp) / 1000);
  if (diff < 60) return t('justNow');
  if (diff < 3600) return `${Math.floor(diff / 60)} ${t('minutesAgo')}`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ${t('hoursAgo')}`;
  return new Date(stamp).toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface Props {
  post: ForumPost;
  currentUserId: string | null;
  compact?: boolean;
  onSelectTicker?: (ticker: string) => void;
  /** Gönderi silindiğinde listeyi tazelemek için. */
  onRemoved: (id: string) => void;
}

export default function ForumPostCard({ post, currentUserId, compact = false, onSelectTicker, onRemoved }: Props) {
  const { t, lang } = useTranslation();
  const [liked, setLiked] = useState(post.likedByMe);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [replies, setReplies] = useState<ForumPost[] | null>(null);
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyCount, setReplyCount] = useState(post.replyCount);

  const isOwn = currentUserId != null && currentUserId === post.userId;

  const toggleLike = async () => {
    const next = !liked;
    // İyimser güncelleme: sunucudaki sayaç tetikleyicisi aynı yönde işler,
    // hata dönerse geri alınır.
    setLiked(next);
    setLikeCount((count) => Math.max(0, count + (next ? 1 : -1)));
    try {
      await setLike(post.id, next);
    } catch (err) {
      setLiked(!next);
      setLikeCount((count) => Math.max(0, count + (next ? -1 : 1)));
      setError(t(forumErrorKey(err)));
    }
  };

  const openReplies = async () => {
    const next = !repliesOpen;
    setRepliesOpen(next);
    if (!next || replies) return;
    try {
      setReplies(await listReplies(post.id));
    } catch (err) {
      setError(t(forumErrorKey(err)));
    }
  };

  const remove = async () => {
    try {
      await deletePost(post.id);
      onRemoved(post.id);
    } catch (err) {
      setError(t(forumErrorKey(err)));
      setConfirmDelete(false);
    }
  };

  return (
    <article className={`frm-post${compact ? ' compact' : ''}`}>
      <div className="frm-avatar" style={{ background: avatarColor(post.userId) }}>
        {initials(post.authorName)}
      </div>

      <div className="frm-body">
        <header className="frm-post-head">
          <strong>{post.authorName}</strong>
          <span className="frm-time">{timeAgo(post.createdAt, t, lang)}</span>
          {post.editedAt && <span className="frm-time">· {t('forumEdited')}</span>}
        </header>

        <p className="frm-text">
          {splitBody(post.body).map((token, index) => (
            token.kind === 'ticker' ? (
              <button
                key={`${token.symbol}-${index}`}
                type="button"
                className="frm-inline-tag"
                onClick={() => onSelectTicker?.(token.symbol)}
                title={t('forumOpenTicker')}
              >
                {token.value}
              </button>
            ) : (
              <span key={`text-${index}`}>{token.value}</span>
            )
          ))}
        </p>

        {post.tickers.length > 0 && (
          <div className="frm-post-tags">
            {post.tickers.map((symbol) => (
              <button
                key={symbol}
                type="button"
                className="frm-tag clickable"
                onClick={() => onSelectTicker?.(symbol)}
                title={t('forumOpenTicker')}
              >
                {symbol}
              </button>
            ))}
          </div>
        )}

        <footer className="frm-actions">
          <button type="button" className={`frm-action${liked ? ' on' : ''}`} onClick={() => void toggleLike()}>
            ♥ {likeCount > 0 ? likeCount : ''} <span>{t('forumLike')}</span>
          </button>
          <button type="button" className="frm-action" onClick={() => setReplyOpen((open) => !open)}>
            ↩ <span>{t('forumReply')}</span>
          </button>
          {replyCount > 0 && (
            <button type="button" className="frm-action" onClick={() => void openReplies()}>
              {repliesOpen ? '▾' : '▸'} {replyCount} <span>{t('forumReplies')}</span>
            </button>
          )}
          {isOwn && (
            confirmDelete ? (
              <span className="frm-confirm">
                <button type="button" className="frm-action danger" onClick={() => void remove()}>
                  {t('forumDeleteConfirm')}
                </button>
                <button type="button" className="frm-action" onClick={() => setConfirmDelete(false)}>
                  {t('forumCancel')}
                </button>
              </span>
            ) : (
              <button type="button" className="frm-action" onClick={() => setConfirmDelete(true)}>
                {t('forumDelete')}
              </button>
            )
          )}
        </footer>

        {error && <div className="frm-error">{error}</div>}

        {replyOpen && (
          <ForumComposer
            parentId={post.id}
            compact
            autoFocus
            placeholder={t('forumReplyPlaceholder')}
            submitLabel={t('forumReply')}
            onCancel={() => setReplyOpen(false)}
            onPosted={(reply) => {
              setReplyOpen(false);
              setRepliesOpen(true);
              setReplies((current) => [...(current ?? []), reply]);
              setReplyCount((count) => count + 1);
            }}
          />
        )}

        {repliesOpen && (
          <div className="frm-replies">
            {replies == null && <div className="frm-note">{t('forumLoading')}</div>}
            {replies?.map((reply) => (
              <ForumPostCard
                key={reply.id}
                post={reply}
                currentUserId={currentUserId}
                compact
                onSelectTicker={onSelectTicker}
                onRemoved={(id) => {
                  setReplies((current) => (current ?? []).filter((item) => item.id !== id));
                  setReplyCount((count) => Math.max(0, count - 1));
                }}
              />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
