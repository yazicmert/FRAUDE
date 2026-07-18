import { FormEvent, useState } from 'react';
import { BrandMark } from '../components/Brand';
import { supabase } from '../lib/supabase';
import { navigate } from '../lib/router';

const EMAIL_RE = /.+@.+\..+/;

/** Giriş/kayıt — uygulamadaki akışla aynı Supabase projesi ve kurallar. */
export default function SignIn() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setInfo(null);
    if (!EMAIL_RE.test(email.trim())) return setError('Geçerli bir e-posta girin.');
    if (mode === 'signup' && !name.trim()) return setError('Adınızı girin.');
    if (mode === 'signup' && password.length < 8)
      return setError('Şifre en az 8 karakter olmalı.');
    if (!password) return setError('Şifrenizi girin.');

    setBusy(true);
    try {
      if (mode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: { data: { name: name.trim() } },
        });
        if (signUpError) {
          const text = signUpError.message.toLowerCase();
          setError(
            text.includes('already')
              ? 'Bu e-posta ile zaten bir hesap var.'
              : 'Kayıt başarısız: ' + signUpError.message,
          );
          return;
        }
        if (!data.session) {
          setInfo('Doğrulama e-postası gönderildi; kutunuzu onaylayıp giriş yapın.');
          return;
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
        if (signInError) {
          setError(
            signInError.message.toLowerCase().includes('invalid')
              ? 'E-posta veya şifre hatalı.'
              : 'Giriş başarısız: ' + signInError.message,
          );
          return;
        }
      }
      navigate('/hesap');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page-narrow">
      <div className="card" style={{ textAlign: 'center', paddingTop: 34 }}>
        <BrandMark size={54} />
        <h1 style={{ marginTop: 12 }}>
          {mode === 'signin' ? 'Tekrar hoş geldiniz' : 'Hesap oluşturun'}
        </h1>
        <p className="page-sub">
          {mode === 'signin'
            ? 'FRAUDE hesabınızla oturum açın'
            : 'Lisans talebi için ücretsiz hesap açın'}
        </p>
        <form className="form" onSubmit={submit} style={{ textAlign: 'left' }}>
          {mode === 'signup' && (
            <label>
              Ad Soyad
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </label>
          )}
          <label>
            E-posta
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
            />
          </label>
          <label>
            Şifre
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
          </label>
          {info ? <p className="form-info">{info}</p> : <p className="form-error">{error ?? ''}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'İşleniyor…' : mode === 'signin' ? 'Giriş Yap' : 'Kayıt Ol'}
          </button>
        </form>
        <p className="auth-switch-line">
          {mode === 'signin' ? (
            <button onClick={() => setMode('signup')}>Hesabınız yok mu? Kayıt olun</button>
          ) : (
            <button onClick={() => setMode('signin')}>Zaten hesabınız var mı? Giriş yapın</button>
          )}
        </p>
      </div>
    </div>
  );
}
