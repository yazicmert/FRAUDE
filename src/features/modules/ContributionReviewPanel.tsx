import { useState } from 'react';
import { useTranslation } from '../../api/i18n';
import {
  listReviewContributions,
  reviewContribution,
  type ReviewContribution,
} from '../../modules/contributionClient';

export default function ContributionReviewPanel() {
  const { t } = useTranslation();
  const [token, setToken] = useState('');
  const [rows, setRows] = useState<ReviewContribution[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadQueue = async () => {
    setBusy(true);
    setError('');
    try {
      setRows(await listReviewContributions(token));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (id: string, status: 'accepted' | 'rejected') => {
    setBusy(true);
    setError('');
    try {
      await reviewContribution(token, id, status, notes[id] ?? '');
      setRows((current) => current.filter((item) => item.id !== id));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="contribution-review-panel">
      <summary>{t('contributionReview')}</summary>
      <p>{t('contributionReviewSecurity')}</p>
      <div className="review-auth-row">
        <input
          type="password"
          value={token}
          autoComplete="off"
          placeholder={t('reviewToken')}
          onChange={(event) => setToken(event.target.value)}
        />
        <button type="button" className="secondary-button" disabled={!token || busy} onClick={() => void loadQueue()}>
          {busy ? t('loadingReviewQueue') : t('loadReviewQueue')}
        </button>
      </div>
      {error && <p className="negative">{error}</p>}
      {!busy && token && rows.length === 0 && !error && <p className="muted">{t('reviewQueueEmpty')}</p>}
      <div className="review-contribution-list">
        {rows.map((row) => (
          <article key={row.id}>
            <div><strong>{row.moduleId}</strong><code>{row.id}</code></div>
            <small>{row.changedPaths.join(', ')} · {row.testsPassed} {t('testsPassed')}</small>
            <textarea
              value={notes[row.id] ?? ''}
              maxLength={2000}
              placeholder={t('reviewNote')}
              onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))}
            />
            <div className="review-actions">
              <button type="button" className="secondary-button" disabled={busy} onClick={() => void decide(row.id, 'rejected')}>
                {t('rejectContribution')}
              </button>
              <button type="button" className="primary-button" disabled={busy} onClick={() => void decide(row.id, 'accepted')}>
                {t('acceptContribution')}
              </button>
            </div>
          </article>
        ))}
      </div>
    </details>
  );
}
