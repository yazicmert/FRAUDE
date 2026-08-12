import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '../../api/i18n';
import {
  currentUserId,
  forumErrorKey,
  isModerator,
  listBlockedUsers,
  moderatePost,
  reportQueue,
  unblockUser,
  type BlockedUser,
  type ModerationAction,
  type ReportedPost,
} from './forumApi';

const REASON_KEYS: Record<string, string> = {
  spam: 'forumReasonSpam',
  abuse: 'forumReasonAbuse',
  misinfo: 'forumReasonMisinfo',
  other: 'forumReasonOther',
};

/**
 * Forum yan araçları: moderasyon kuyruğu ve engellenenler listesi.
 *
 * İkisi de "kendi kendini yöneten topluluk" yüzeyidir ve yalnız gereken
 * kullanıcıya çizilir — moderatör olmayan kuyruğu, kimseyi engellememiş
 * kullanıcı engel listesini hiç görmez.
 */
export default function ForumTools({ onChanged }: { onChanged?: () => void }) {
  const { t } = useTranslation();
  const [moderator, setModerator] = useState(false);
  const [queue, setQueue] = useState<ReportedPost[]>([]);
  const [blocked, setBlocked] = useState<BlockedUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const userId = currentUserId();

  const refreshQueue = useCallback(async () => {
    try {
      setQueue(await reportQueue(20));
      setError(null);
    } catch (err) {
      setError(t(forumErrorKey(err)));
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    void isModerator().then((flag) => {
      if (cancelled) return;
      setModerator(flag);
      if (flag) void refreshQueue();
    });
    void listBlockedUsers().then((rows) => {
      if (!cancelled) setBlocked(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, refreshQueue]);

  const decide = async (postId: string, action: ModerationAction) => {
    setBusy(postId);
    try {
      await moderatePost(postId, action);
      // Karar sonrası kuyruk sunucudan yeniden okunur: "geri al" bildirimleri
      // de sildiği için satırın kuyrukta kalıp kalmayacağına sunucu karar verir.
      await refreshQueue();
      onChanged?.();
    } catch (err) {
      setError(t(forumErrorKey(err)));
    } finally {
      setBusy(null);
    }
  };

  const release = async (blockedId: string) => {
    setBusy(blockedId);
    try {
      await unblockUser(blockedId);
      setBlocked((current) => current.filter((row) => row.userId !== blockedId));
      onChanged?.();
    } catch (err) {
      setError(t(forumErrorKey(err)));
    } finally {
      setBusy(null);
    }
  };

  if (!moderator && blocked.length === 0) return null;

  return (
    <>
      {moderator && (
        <section className="frm-tools">
          <h2>
            {t('forumModQueue')}
            {queue.length > 0 && <em>{queue.length}</em>}
          </h2>
          {queue.length === 0 && <p className="frm-note small">{t('forumModQueueEmpty')}</p>}
          {queue.map((row) => (
            <div key={row.id} className="frm-queue-item">
              <div className="frm-queue-head">
                <strong>{row.authorName}</strong>
                <span className="frm-badge warn">{t('forumReportCount', { count: row.reportCount })}</span>
              </div>
              <p className="frm-queue-body">{row.body.slice(0, 220)}</p>
              <div className="frm-queue-reasons">
                {row.reasons.map((reason) => (
                  <span key={reason} className="frm-badge">{t(REASON_KEYS[reason] ?? 'forumReasonOther')}</span>
                ))}
              </div>
              <div className="frm-queue-actions">
                {row.hiddenAt ? (
                  <button type="button" className="small-button" disabled={busy === row.id} onClick={() => void decide(row.id, 'restore')}>
                    {t('forumModRestore')}
                  </button>
                ) : (
                  <button type="button" className="small-button" disabled={busy === row.id} onClick={() => void decide(row.id, 'hide')}>
                    {t('forumModHide')}
                  </button>
                )}
                <button type="button" className="small-button" disabled={busy === row.id} onClick={() => void decide(row.id, 'dismiss')}>
                  {t('forumModDismiss')}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {blocked.length > 0 && (
        <section className="frm-tools">
          <h2>{t('forumBlockedList')}</h2>
          {blocked.map((row) => (
            <div key={row.userId} className="frm-blocked-item">
              <span>{row.name}</span>
              <button type="button" className="small-button" disabled={busy === row.userId} onClick={() => void release(row.userId)}>
                {t('forumUnblock')}
              </button>
            </div>
          ))}
        </section>
      )}

      {error && <div className="frm-error">{error}</div>}
    </>
  );
}
