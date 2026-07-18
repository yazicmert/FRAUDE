import { FormEvent, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

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
  created_at: string;
}

type Tab = 'overview' | 'requests' | 'licenses' | 'generate';

function fmtDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString('tr-TR') : '—';
}

function licenseBadge(license: AdminLicense) {
  if (license.status === 'revoked') return <span className="badge badge-red">İptal</span>;
  if (license.expired) return <span className="badge badge-red">Süresi doldu</span>;
  if (license.status === 'active') return <span className="badge badge-green">Aktif</span>;
  return <span className="badge badge-gray">Kullanılmadı</span>;
}

/** Yönetim paneli: özet, talepler, lisanslar ve toplu anahtar üretimi. */
export default function Admin() {
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

  const loadAll = async () => {
    setError(null);
    const [ov, li, re] = await Promise.all([
      supabase.rpc('admin_overview'),
      supabase.rpc('admin_list_licenses'),
      supabase.rpc('admin_list_requests'),
    ]);
    if (ov.data?.ok) setOverview(ov.data as Overview & { ok: boolean });
    else setError('Yönetici verileri alınamadı (yetkinizi kontrol edin).');
    if (li.data?.ok) setLicenses(li.data.licenses as AdminLicense[]);
    if (re.data?.ok) setRequests(re.data.requests as AdminRequest[]);
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const decideRequest = async (id: string, approve: boolean) => {
    setBusy(true);
    try {
      const { data } = approve
        ? await supabase.rpc('admin_approve_request', { p_request_id: id })
        : await supabase.rpc('admin_reject_request', { p_request_id: id });
      if (!data?.ok) setError('İşlem başarısız: ' + (data?.error ?? 'bilinmeyen hata'));
      await loadAll();
    } finally {
      setBusy(false);
    }
  };

  const revokeLicense = async (id: string) => {
    if (!window.confirm('Bu lisans iptal edilsin mi? Kullanıcının erişimi anında kesilir.')) return;
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
        setError('Üretim başarısız: ' + (data?.error ?? 'bilinmeyen hata'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h1>Yönetim Paneli</h1>
      <p className="page-sub">Lisanslar, talepler ve anahtar üretimi</p>

      <div className="tabs">
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>
          Özet
        </button>
        <button className={tab === 'requests' ? 'active' : ''} onClick={() => setTab('requests')}>
          Talepler{' '}
          {overview && overview.requests_pending > 0 && (
            <span className="badge badge-cyan">{overview.requests_pending}</span>
          )}
        </button>
        <button className={tab === 'licenses' ? 'active' : ''} onClick={() => setTab('licenses')}>
          Lisanslar
        </button>
        <button className={tab === 'generate' ? 'active' : ''} onClick={() => setTab('generate')}>
          Anahtar Üret
        </button>
      </div>

      {error && <p className="form-error">{error}</p>}

      {tab === 'overview' && (
        <div className="stat-grid">
          {overview ? (
            <>
              <div className="stat"><div className="value">{overview.users_total}</div><div className="label">Kayıtlı kullanıcı</div></div>
              <div className="stat"><div className="value">{overview.licenses_total}</div><div className="label">Toplam lisans</div></div>
              <div className="stat"><div className="value" style={{ color: 'var(--green)' }}>{overview.licenses_active}</div><div className="label">Aktif lisans</div></div>
              <div className="stat"><div className="value">{overview.licenses_unused}</div><div className="label">Kullanılmamış</div></div>
              <div className="stat"><div className="value" style={{ color: 'var(--red)' }}>{overview.licenses_expired}</div><div className="label">Süresi geçmiş</div></div>
              <div className="stat"><div className="value" style={{ color: 'var(--red)' }}>{overview.licenses_revoked}</div><div className="label">İptal edilmiş</div></div>
              <div className="stat"><div className="value">{overview.activations_total}</div><div className="label">Cihaz aktivasyonu</div></div>
              <div className="stat"><div className="value" style={{ color: 'var(--cyan)' }}>{overview.requests_pending}</div><div className="label">Bekleyen talep</div></div>
            </>
          ) : (
            <p className="muted">Yükleniyor…</p>
          )}
        </div>
      )}

      {tab === 'requests' && (
        <div className="card">
          <h2>Lisans Talepleri</h2>
          {requests === null ? (
            <p className="muted">Yükleniyor…</p>
          ) : requests.length === 0 ? (
            <p className="muted">Talep yok.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Tarih</th>
                    <th>Kullanıcı</th>
                    <th>Not</th>
                    <th>Durum</th>
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
                        {request.status === 'pending' && <span className="badge badge-cyan">Bekliyor</span>}
                        {request.status === 'approved' && <span className="badge badge-green">Onaylandı</span>}
                        {request.status === 'rejected' && <span className="badge badge-red">Reddedildi</span>}
                      </td>
                      <td>
                        {request.status === 'pending' && (
                          <span style={{ display: 'inline-flex', gap: 8 }}>
                            <button
                              className="btn btn-primary btn-sm"
                              disabled={busy}
                              onClick={() => decideRequest(request.id, true)}
                            >
                              Onayla
                            </button>
                            <button
                              className="btn btn-danger btn-sm"
                              disabled={busy}
                              onClick={() => decideRequest(request.id, false)}
                            >
                              Reddet
                            </button>
                          </span>
                        )}
                        {request.status === 'approved' && request.delivered_key && (
                          <span className="muted small" style={{ fontFamily: 'monospace' }}>
                            {request.delivered_key}
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
          <h2>Lisanslar</h2>
          {licenses === null ? (
            <p className="muted">Yükleniyor…</p>
          ) : licenses.length === 0 ? (
            <p className="muted">Lisans yok.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Durum</th>
                    <th>Plan</th>
                    <th>Kullanıcı</th>
                    <th>Cihaz</th>
                    <th>Bitiş</th>
                    <th>Not</th>
                    <th>Oluşturma</th>
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
                      <td>{license.expires_at ? fmtDate(license.expires_at) : 'Süresiz'}</td>
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
                            İptal Et
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
            <h2>Toplu Anahtar Üret</h2>
            <form className="form" onSubmit={generate}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                <label>
                  Adet (1-200)
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={genCount}
                    onChange={(event) => setGenCount(Number(event.target.value))}
                  />
                </label>
                <label>
                  Plan
                  <select value={genPlan} onChange={(event) => setGenPlan(event.target.value)}>
                    <option value="standard">standard</option>
                    <option value="pro">pro</option>
                  </select>
                </label>
                <label>
                  Cihaz limiti
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={genDevices}
                    onChange={(event) => setGenDevices(Number(event.target.value))}
                  />
                </label>
                <label>
                  Bitiş (boş = süresiz)
                  <input
                    type="date"
                    value={genExpires}
                    onChange={(event) => setGenExpires(event.target.value)}
                  />
                </label>
              </div>
              <label>
                Not (kime/niçin üretildi)
                <input value={genNote} onChange={(event) => setGenNote(event.target.value)} />
              </label>
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? 'Üretiliyor…' : 'Üret'}
              </button>
            </form>
          </div>
          {genKeys && (
            <div className="card">
              <h2>Üretilen anahtarlar — yalnız şimdi görünür</h2>
              <p className="muted small" style={{ marginBottom: 14 }}>
                Veritabanı yalnız özetleri tutar; bu listeyi kapatmadan kopyalayın.
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
                Tümünü kopyala
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
