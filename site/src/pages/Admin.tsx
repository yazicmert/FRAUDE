import { FormEvent, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useI18n } from '../lib/i18n';

interface Overview {
  licenses_total: number;
  licenses_unused: number;
  licenses_active: number;
  licenses_revoked: number;
  licenses_expired: number;
  requests_pending: number;
  users_total: number;
  activations_total: number;
}

interface AdminLicense {
  id: string;
  status: 'unused' | 'active' | 'revoked';
  plan: string;
  max_devices: number;
  expires_at: string | null;
  expired: boolean;
  note: string | null;
  email: string | null;
  devices: number;
  activated_at: string | null;
  created_at: string;
}

interface AdminRequest {
  id: string;
  email: string;
  name: string | null;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  delivered_key: string | null;
  decided_at: string | null;
  emailed_at: string | null;
  abuse_reported_at: string | null;
  feedback_rating: number | null;
  feedback_comment: string | null;
  created_at: string;
}

type Tab = 'overview' | 'requests' | 'licenses' | 'generate';

/** Yönetim paneli: özet, talepler, lisanslar ve toplu anahtar üretimi. */
export default function Admin() {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [licenses, setLicenses] = useState<AdminLicense[] | null>(null);
  const [requests, setRequests] = useState<AdminRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Üretim formu
  const [genCount, setGenCount] = useState(5);
  const [genPlan, setGenPlan] = useState('standard');
  const [genDevices, setGenDevices] = useState(2);
  const [genExpires, setGenExpires] = useState('');
  const [genNote, setGenNote] = useState('');
  const [genKeys, setGenKeys] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const locale = lang === 'tr' ? 'tr-TR' : 'en-US';
  const fmtDate = (value: string | null) =>
    value ? new Date(value).toLocaleDateString(locale) : '—';

  const licenseBadge = (license: AdminLicense) => {
    if (license.status === 'revoked') return <span className="badge badge-red">{t('bdRevoked')}</span>;
    if (license.expired) return <span className="badge badge-red">{t('bdExpired')}</span>;
    if (license.status === 'active') return <span className="badge badge-green">{t('bdActive')}</span>;
    return <span className="badge badge-gray">{t('bdUnused')}</span>;
  };

  const loadAll = async () => {
    setError(null);
    const [ov, li, re] = await Promise.all([
      supabase.rpc('admin_overview'),
      supabase.rpc('admin_list_licenses'),
      supabase.rpc('admin_list_requests'),
    ]);
    if (ov.data?.ok) setOverview(ov.data as Overview & { ok: boolean });
    else setError(t('adminLoadFailed'));
    if (li.data?.ok) setLicenses(li.data.licenses as AdminLicense[]);
    if (re.data?.ok) setRequests(re.data.requests as AdminRequest[]);
  };

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Onaylı talebin anahtarını send-license-email Edge Function'ı ile yollar;
  // e-posta hatası onayı geri almaz, yalnız uyarı gösterilir (yeniden gönderilebilir).
  const sendLicenseEmail = async (id: string): Promise<void> => {
    const { data, error: invokeError } = await supabase.functions.invoke('send-license-email', {
      body: { requestId: id },
    });
    if (invokeError || !data?.ok) {
      setError(t('mailFailed') + (data?.error ?? invokeError?.message ?? t('unknownError')));
    }
  };

  const decideRequest = async (id: string, approve: boolean) => {
    setBusy(true);
    try {
      const { data } = approve
        ? await supabase.rpc('admin_approve_request', { p_request_id: id })
        : await supabase.rpc('admin_reject_request', { p_request_id: id });
      if (!data?.ok) setError(t('opFailed') + (data?.error ?? t('unknownError')));
      else if (approve) await sendLicenseEmail(id);
      await loadAll();
    } finally {
      setBusy(false);
    }
  };

  const resendEmail = async (id: string) => {
    setBusy(true);
    try {
      await sendLicenseEmail(id);
      await loadAll();
    } finally {
      setBusy(false);
    }
  };

  const revokeLicense = async (id: string) => {
    if (!window.confirm(t('confirmRevoke'))) return;
    setBusy(true);
    try {
      await supabase.rpc('admin_revoke_license', { p_license_id: id });
      await loadAll();
    } finally {
      setBusy(false);
    }
  };

  const generate = async (event: FormEvent) => {
    event.preventDefault();
    setGenKeys(null);
    setBusy(true);
    try {
      const { data } = await supabase.rpc('admin_generate_licenses', {
        p_count: genCount,
        p_plan: genPlan,
        p_devices: genDevices,
        p_expires: genExpires ? new Date(genExpires).toISOString() : null,
        p_note: genNote.trim() || null,
      });
      if (data?.ok) {
        setGenKeys(data.keys as string[]);
        await loadAll();
      } else {
        setError(t('genFailed') + (data?.error ?? t('unknownError')));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h1>{t('adminTitle')}</h1>
      <p className="page-sub">{t('adminSub')}</p>

      <div className="tabs">
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>
          {t('tabOverview')}
        </button>
        <button className={tab === 'requests' ? 'active' : ''} onClick={() => setTab('requests')}>
          {t('tabRequests')}{' '}
          {overview && overview.requests_pending > 0 && (
            <span className="badge badge-cyan">{overview.requests_pending}</span>
          )}
        </button>
        <button className={tab === 'licenses' ? 'active' : ''} onClick={() => setTab('licenses')}>
          {t('tabLicenses')}
        </button>
        <button className={tab === 'generate' ? 'active' : ''} onClick={() => setTab('generate')}>
          {t('tabGenerate')}
        </button>
      </div>

      {error && <p className="form-error">{error}</p>}

      {tab === 'overview' && (
        <div className="stat-grid">
          {overview ? (
            <>
              <div className="stat"><div className="value">{overview.users_total}</div><div className="label">{t('statUsers')}</div></div>
              <div className="stat"><div className="value">{overview.licenses_total}</div><div className="label">{t('statTotal')}</div></div>
              <div className="stat"><div className="value" style={{ color: 'var(--green)' }}>{overview.licenses_active}</div><div className="label">{t('statActive')}</div></div>
              <div className="stat"><div className="value">{overview.licenses_unused}</div><div className="label">{t('statUnused')}</div></div>
              <div className="stat"><div className="value" style={{ color: 'var(--red)' }}>{overview.licenses_expired}</div><div className="label">{t('statExpired')}</div></div>
              <div className="stat"><div className="value" style={{ color: 'var(--red)' }}>{overview.licenses_revoked}</div><div className="label">{t('statRevoked')}</div></div>
              <div className="stat"><div className="value">{overview.activations_total}</div><div className="label">{t('statActivations')}</div></div>
              <div className="stat"><div className="value" style={{ color: 'var(--cyan)' }}>{overview.requests_pending}</div><div className="label">{t('statPending')}</div></div>
            </>
          ) : (
            <p className="muted">{t('loading')}</p>
          )}
        </div>
      )}

      {tab === 'requests' && (
        <div className="card">
          <h2>{t('reqListTitle')}</h2>
          {requests === null ? (
            <p className="muted">{t('loading')}</p>
          ) : requests.length === 0 ? (
            <p className="muted">{t('noReqs')}</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('colDate')}</th>
                    <th>{t('colUser')}</th>
                    <th>{t('colNote')}</th>
                    <th>{t('colStatus')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {requests.map((request) => (
                    <tr key={request.id}>
                      <td>{fmtDate(request.created_at)}</td>
                      <td>
                        {request.name || '—'}
                        <div className="muted small">{request.email}</div>
                      </td>
                      <td className="muted" style={{ whiteSpace: 'normal', maxWidth: 320 }}>
                        {request.note ?? '—'}
                      </td>
                      <td>
                        {request.status === 'pending' && <span className="badge badge-cyan">{t('stPending')}</span>}
                        {request.status === 'approved' && <span className="badge badge-green">{t('stApproved')}</span>}
                        {request.status === 'rejected' && <span className="badge badge-red">{t('stRejected')}</span>}
                      </td>
                      <td>
                        {request.status === 'pending' && (
                          <span style={{ display: 'inline-flex', gap: 8 }}>
                            <button
                              className="btn btn-primary btn-sm"
                              disabled={busy}
                              onClick={() => decideRequest(request.id, true)}
                            >
                              {t('approve')}
                            </button>
                            <button
                              className="btn btn-danger btn-sm"
                              disabled={busy}
                              onClick={() => decideRequest(request.id, false)}
                            >
                              {t('reject')}
                            </button>
                          </span>
                        )}
                        {request.status === 'approved' && request.delivered_key && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <span className="muted small" style={{ fontFamily: 'monospace' }}>
                              {request.delivered_key}
                            </span>
                            {request.emailed_at && (
                              <span className="badge badge-green" title={fmtDate(request.emailed_at)}>
                                {t('mailSentBadge')}
                              </span>
                            )}
                            {request.abuse_reported_at && (
                              <span className="badge badge-red" title={fmtDate(request.abuse_reported_at)}>
                                {t('abuseBadge')}
                              </span>
                            )}
                            {request.feedback_rating != null && (
                              <span className="muted small" title={request.feedback_comment ?? ''}>
                                {t('surveyShort')} {request.feedback_rating}/5
                              </span>
                            )}
                            <button
                              className="btn btn-sm"
                              disabled={busy}
                              onClick={() => void resendEmail(request.id)}
                            >
                              {request.emailed_at ? t('mailResend') : t('mailSend')}
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'licenses' && (
        <div className="card">
          <h2>{t('licListTitle')}</h2>
          {licenses === null ? (
            <p className="muted">{t('loading')}</p>
          ) : licenses.length === 0 ? (
            <p className="muted">{t('noLicenses')}</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('colStatus')}</th>
                    <th>{t('colPlan')}</th>
                    <th>{t('colUser')}</th>
                    <th>{t('colDevices')}</th>
                    <th>{t('colExpiry')}</th>
                    <th>{t('colNote')}</th>
                    <th>{t('colCreated')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {licenses.map((license) => (
                    <tr key={license.id}>
                      <td>{licenseBadge(license)}</td>
                      <td style={{ textTransform: 'capitalize' }}>{license.plan}</td>
                      <td>{license.email ?? <span className="muted">—</span>}</td>
                      <td>
                        {license.devices} / {license.max_devices}
                      </td>
                      <td>{license.expires_at ? fmtDate(license.expires_at) : t('perpetual')}</td>
                      <td className="muted" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {license.note ?? '—'}
                      </td>
                      <td>{fmtDate(license.created_at)}</td>
                      <td>
                        {license.status !== 'revoked' && (
                          <button
                            className="btn btn-danger btn-sm"
                            disabled={busy}
                            onClick={() => revokeLicense(license.id)}
                          >
                            {t('revoke')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'generate' && (
        <>
          <div className="card">
            <h2>{t('genTitle')}</h2>
            <form className="form" onSubmit={generate}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                <label>
                  {t('genCount')}
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={genCount}
                    onChange={(event) => setGenCount(Number(event.target.value))}
                  />
                </label>
                <label>
                  {t('genPlan')}
                  <select value={genPlan} onChange={(event) => setGenPlan(event.target.value)}>
                    <option value="standard">standard</option>
                    <option value="pro">pro</option>
                  </select>
                </label>
                <label>
                  {t('genDevices')}
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={genDevices}
                    onChange={(event) => setGenDevices(Number(event.target.value))}
                  />
                </label>
                <label>
                  {t('genExpiry')}
                  <input
                    type="date"
                    value={genExpires}
                    onChange={(event) => setGenExpires(event.target.value)}
                  />
                </label>
              </div>
              <label>
                {t('genNote')}
                <input value={genNote} onChange={(event) => setGenNote(event.target.value)} />
              </label>
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? t('genBusy') : t('genBtn')}
              </button>
            </form>
          </div>
          {genKeys && (
            <div className="card">
              <h2>{t('genDoneTitle')}</h2>
              <p className="muted small" style={{ marginBottom: 14 }}>
                {t('genDoneHint')}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                {genKeys.map((key) => (
                  <span key={key} className="key-chip">{key}</span>
                ))}
              </div>
              <button
                className="btn"
                onClick={() => navigator.clipboard.writeText(genKeys.join('\n'))}
              >
                {t('copyAll')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
