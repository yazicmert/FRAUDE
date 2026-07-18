import { FormEvent, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { displayName } from '../lib/useSession';
import { navigate } from '../lib/router';
import { useI18n, type StringKey } from '../lib/i18n';
import NotifyPrefs from '../components/NotifyPrefs';

interface LicenseRequest {
  id: string;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  delivered_key: string | null;
  created_at: string;
  decided_at: string | null;
}

const STATUS_META: Record<LicenseRequest['status'], { label: StringKey; cls: string }> = {
  pending: { label: 'stPending', cls: 'badge-cyan' },
  approved: { label: 'stApproved', cls: 'badge-green' },
  rejected: { label: 'stRejected', cls: 'badge-red' },
};

function CopyKey({ value }: { value: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <span className="key-chip">
      {value}
      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? t('copied') : t('copy')}
      </button>
    </span>
  );
}

/** Hesap sayfası: lisans talebi oluşturma ve taleplerin durumu. */
export default function Account({ user }: { user: User }) {
  const { t, lang } = useI18n();
  const [requests, setRequests] = useState<LicenseRequest[] | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const locale = lang === 'tr' ? 'tr-TR' : 'en-US';

  const load = async () => {
    const { data, error: selectError } = await supabase
      .from('license_requests')
      .select('id, note, status, delivered_key, created_at, decided_at')
      .order('created_at', { ascending: false });
    if (!selectError) setRequests((data as LicenseRequest[]) ?? []);
  };

  useEffect(() => {
    void load();
  }, [user.id]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { error: insertError } = await supabase.from('license_requests').insert({
        user_id: user.id,
        email: user.email,
        name: displayName(user),
        note: note.trim() || null,
      });
      if (insertError) {
        setError(t('requestFailed') + insertError.message);
        return;
      }
      setNote('');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const hasPending = requests?.some((request) => request.status === 'pending') ?? false;
  const approved = requests?.filter((request) => request.status === 'approved') ?? [];

  return (
    <div className="page">
      <h1>{t('myAccount')}</h1>
      <p className="page-sub">
        {displayName(user)} · {user.email}
      </p>

      {approved.length > 0 && (
        <div className="card">
          <h2>{t('yourKeyTitle')}</h2>
          {approved.map((request) => (
            <div key={request.id} style={{ marginBottom: 12 }}>
              {request.delivered_key ? (
                <>
                  <CopyKey value={request.delivered_key} />
                  <p className="muted small" style={{ marginTop: 10 }}>
                    {t('yourKeyHint')}
                  </p>
                </>
              ) : (
                <p className="muted small">{t('approvedNoKey')}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>{t('requestTitle')}</h2>
        {hasPending ? (
          <p className="muted">{t('pendingNote')}</p>
        ) : (
          <form className="form" onSubmit={submit}>
            <label>
              {t('noteLabel')}
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t('notePlaceholder')}
                maxLength={500}
              />
            </label>
            <p className="form-error">{error ?? ''}</p>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? t('sending') : t('requestBtn')}
            </button>
          </form>
        )}
      </div>

      <div className="card">
        <h2>{t('myRequests')}</h2>
        {requests === null ? (
          <p className="muted">{t('loading')}</p>
        ) : requests.length === 0 ? (
          <p className="muted">{t('noRequests')}</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('colDate')}</th>
                  <th>{t('colStatus')}</th>
                  <th>{t('colNote')}</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id}>
                    <td>{new Date(request.created_at).toLocaleDateString(locale)}</td>
                    <td>
                      <span className={`badge ${STATUS_META[request.status].cls}`}>
                        {t(STATUS_META[request.status].label)}
                      </span>
                    </td>
                    <td className="muted" style={{ whiteSpace: 'normal', maxWidth: 420 }}>
                      {request.note ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <NotifyPrefs user={user} />

      <div className="card">
        <h2>{t('sessionTitle')}</h2>
        <button
          className="btn btn-danger"
          onClick={() => {
            void supabase.auth.signOut();
            navigate('/');
          }}
        >
          {t('signOut')}
        </button>
      </div>
    </div>
  );
}
