import { FormEvent, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { displayName } from '../lib/useSession';
import { navigate } from '../lib/router';

interface LicenseRequest {
  id: string;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  delivered_key: string | null;
  created_at: string;
  decided_at: string | null;
}

const STATUS_TR: Record<LicenseRequest['status'], { label: string; cls: string }> = {
  pending: { label: 'Bekliyor', cls: 'badge-cyan' },
  approved: { label: 'Onaylandı', cls: 'badge-green' },
  rejected: { label: 'Reddedildi', cls: 'badge-red' },
};

function CopyKey({ value }: { value: string }) {
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
        {copied ? '✓ kopyalandı' : 'kopyala'}
      </button>
    </span>
  );
}

/** Hesap sayfası: lisans talebi oluşturma ve taleplerin durumu. */
export default function Account({ user }: { user: User }) {
  const [requests, setRequests] = useState<LicenseRequest[] | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        setError('Talep gönderilemedi: ' + insertError.message);
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
      <h1>Hesabım</h1>
      <p className="page-sub">
        {displayName(user)} · {user.email}
      </p>

      {approved.length > 0 && (
        <div className="card">
          <h2>Lisans anahtarınız</h2>
          {approved.map((request) => (
            <div key={request.id} style={{ marginBottom: 12 }}>
              {request.delivered_key ? (
                <>
                  <CopyKey value={request.delivered_key} />
                  <p className="muted small" style={{ marginTop: 10 }}>
                    Bu anahtarı FRAUDE uygulamasında oturum açtıktan sonra lisans ekranına girin.
                    Anahtar hesabınıza bağlanır ve 2 cihazda kullanılabilir.
                  </p>
                </>
              ) : (
                <p className="muted small">Onaylandı — anahtar yöneticiden ayrıca iletilecek.</p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>Lisans Talebi</h2>
        {hasPending ? (
          <p className="muted">
            Bekleyen bir talebiniz var. Onaylandığında anahtarınız bu sayfada görünecek.
          </p>
        ) : (
          <form className="form" onSubmit={submit}>
            <label>
              Not (isteğe bağlı — kendinizi kısaca tanıtın)
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Örn. bireysel yatırımcıyım, fon analizi için kullanacağım."
                maxLength={500}
              />
            </label>
            <p className="form-error">{error ?? ''}</p>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? 'Gönderiliyor…' : 'Lisans Talep Et'}
            </button>
          </form>
        )}
      </div>

      <div className="card">
        <h2>Taleplerim</h2>
        {requests === null ? (
          <p className="muted">Yükleniyor…</p>
        ) : requests.length === 0 ? (
          <p className="muted">Henüz talebiniz yok.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Tarih</th>
                  <th>Durum</th>
                  <th>Not</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id}>
                    <td>{new Date(request.created_at).toLocaleDateString('tr-TR')}</td>
                    <td>
                      <span className={`badge ${STATUS_TR[request.status].cls}`}>
                        {STATUS_TR[request.status].label}
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

      <div className="card">
        <h2>Oturum</h2>
        <button
          className="btn btn-danger"
          onClick={() => {
            void supabase.auth.signOut();
            navigate('/');
          }}
        >
          Çıkış Yap
        </button>
      </div>
    </div>
  );
}
