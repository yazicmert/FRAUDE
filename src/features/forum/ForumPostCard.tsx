import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../api/i18n';
import ForumComposer from './ForumComposer';
import { useTickerMention } from './useTickerMention';
import {
  blockUser,
  deletePost,
  forumErrorKey,
  listReplies,
  moderatePost,
  reportPost,
  setLike,
  splitBody,
  updatePost,
  MAX_BODY_LENGTH,
  REPORT_REASONS,
  type ForumPost,
  type ReportReason,
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

const REASON_KEYS: Record<ReportReason, string> = {
  spam: 'forumReasonSpam',
  abuse: 'forumReasonAbuse',
  misinfo: 'forumReasonMisinfo',
  other: 'forumReasonOther',
};

interface Props {
  post: ForumPost;
  currentUserId: string | null;
  /** Oturum sahibi moderatörse gizle/geri al düğmeleri açılır. */
  moderator?: boolean;
  compact?: boolean;
  onSelectTicker?: (ticker: string) => void;
  /** Gönderi silindiğinde listeyi tazelemek için. */
  onRemoved: (id: string) => void;
  /** Düzenleme/moderasyon sonrası güncel satır. */
  onChanged?: (post: ForumPost) => void;
  /** Yazar engellendiğinde listeden düşürmek için. */
  onBlocked?: (userId: string) => void;
}

export default function ForumPostCard({
  post,
  currentUserId,
  moderator = false,
  compact = false,
  onSelectTicker,
  onRemoved,
  onChanged,
  onBlocked,
}: Props) {
  const { t, lang } = useTranslation();
  const [liked, setLiked] = useState(post.likedByMe);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [replyCount, setReplyCount] = useState(post.replyCount);
  const [reported, setReported] = useState(post.reportedByMe);
  const [replies, setReplies] = useState<ForumPost[] | null>(null);
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [editDraft, setEditDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editRef = useRef<HTMLTextAreaElement | null>(null);
  const mention = useTickerMention((next) => setEditDraft(next), editRef);

  // Satır yayından ya da tazelemeden güncel gelince ekrandaki sayaçlar da
  // tazelenmeli: aksi hâlde başkasının beğenisi ilk çizimden sonra hiç
  // görünmez, kart açıldığı andaki sayıda donup kalırdı.
  useEffect(() => {
    setLiked(post.likedByMe);
    setLikeCount(post.likeCount);
    setReplyCount(post.replyCount);
    setReported(post.reportedByMe);
  }, [post.likedByMe, post.likeCount, post.replyCount, post.reportedByMe]);

  const isOwn = currentUserId != null && currentUserId === post.userId;
  const hidden = post.hiddenAt !== null;

  const guard = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(t(forumErrorKey(err)));
    } finally {
      setBusy(false);
    }
  };

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

  const remove = () => guard(async () => {
    await deletePost(post.id);
    onRemoved(post.id);
  });

  const saveEdit = () => guard(async () => {
    const body = (editDraft ?? '').trim();
    if (!body) return;
    const next = await updatePost(post.id, body);
    setEditDraft(null);
    onChanged?.(next);
  });

  const sendReport = (reason: ReportReason) => guard(async () => {
    await reportPost(post.id, reason);
    setReported(true);
    setReportOpen(false);
    setMenuOpen(false);
  });

  const block = () => guard(async () => {
    await blockUser(post.userId);
    setMenuOpen(false);
    onBlocked?.(post.userId);
  });

  const moderate = (action: 'hide' | 'restore') => guard(async () => {
    await moderatePost(post.id, action);
    setMenuOpen(false);
    onChanged?.({
      ...post,
      hiddenAt: action === 'hide' ? new Date().toISOString() : null,
      reportCount: action === 'hide' ? post.reportCount : 0,
    });
  });

  return (
    <article className={`frm-post${compact ? ' compact' : ''}${hidden ? ' hidden' : ''}`}>
      <div className="frm-avatar" style={{ background: avatarColor(post.userId) }}>
        {initials(post.authorName)}
      </div>

      <div className="frm-body">
        <header className="frm-post-head">
          <strong>{post.authorName}</strong>
          <span className="frm-time">{timeAgo(post.createdAt, t, lang)}</span>
          {post.editedAt && <span className="frm-time">· {t('forumEdited')}</span>}
          {hidden && <span className="frm-badge warn">{t('forumHidden')}</span>}
          {moderator && post.reportCount > 0 && (
            <span className="frm-badge">{t('forumReportCount', { count: post.reportCount })}</span>
          )}
          <span className="frm-spacer" />
          <button
            type="button"
            className="frm-menu-button"
            title={t('forumMore')}
            onClick={() => {
              setMenuOpen((open) => !open);
              setReportOpen(false);
            }}
          >
            ⋯
          </button>
        </header>

        {menuOpen && (
          <div className="frm-menu">
            {isOwn ? (
              <button
                type="button"
                disabled={hidden}
                title={hidden ? t('forumHiddenNote') : undefined}
                onClick={() => {
                  setEditDraft(post.body);
                  setMenuOpen(false);
                }}
              >
                {t('forumEdit')}
              </button>
            ) : (
              <>
                <button type="button" disabled={reported} onClick={() => setReportOpen((open) => !open)}>
                  {reported ? t('forumReported') : t('forumReport')}
                </button>
                <button type="button" onClick={() => void block()}>{t('forumBlock')}</button>
              </>
            )}
            {moderator && (
              hidden ? (
                <button type="button" className="danger" onClick={() => void moderate('restore')}>
                  {t('forumModRestore')}
                </button>
              ) : (
                <button type="button" className="danger" onClick={() => void moderate('hide')}>
                  {t('forumModHide')}
                </button>
              )
            )}
          </div>
        )}

        {reportOpen && !reported && (
          <div className="frm-report">
            <span className="frm-note small">{t('forumReportTitle')}</span>
            <div className="frm-report-reasons">
              {REPORT_REASONS.map((reason) => (
                <button key={reason} type="button" className="small-button" onClick={() => void sendReport(reason)}>
                  {t(REASON_KEYS[reason])}
                </button>
              ))}
            </div>
          </div>
        )}

        {hidden && isOwn && <div className="frm-note small">{t('forumHiddenNote')}</div>}

        {editDraft !== null ? (
          <div className="frm-edit">
            <div className="frm-input-wrap">
              <textarea
                ref={editRef}
                className="frm-input"
                value={editDraft}
                maxLength={MAX_BODY_LENGTH}
                rows={3}
                autoFocus
                onChange={(event) => {
                  setEditDraft(event.target.value);
                  mention.sync(event.target);
                }}
                onSelect={(event) => mention.sync(event.currentTarget)}
                onBlur={() => mention.close()}
                onKeyDown={(event) => mention.handleKeyDown(event)}
              />
              {mention.open && (
                <ul className="frm-suggest frm-mention">
                  {mention.items.map((row, index) => (
                    <li
                      key={row.ticker}
                      className={index === mention.activeIndex ? 'active' : ''}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        mention.accept(row);
                      }}
                    >
                      <strong>${row.ticker}</strong>
                      <span>{row.name}</span>
                    </li>
                  ))}
                  <li className="frm-mention-hint">{t('forumMentionHint')}</li>
                </ul>
              )}
            </div>
            <div className="frm-composer-actions">
              <button type="button" className="small-button" onClick={() => setEditDraft(null)}>
                {t('forumCancel')}
              </button>
              <button
                type="button"
                className="frm-send"
                disabled={busy || editDraft.trim().length === 0}
                onClick={() => void saveEdit()}
              >
                {t('forumSave')}
              </button>
            </div>
          </div>
        ) : (
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
        )}

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
                moderator={moderator}
                compact
                onSelectTicker={onSelectTicker}
                onChanged={(next) => setReplies((current) => (current ?? []).map((item) => (item.id === next.id ? next : item)))}
                onBlocked={(blockedId) => setReplies((current) => (current ?? []).filter((item) => item.userId !== blockedId))}
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
