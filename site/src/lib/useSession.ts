import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';

export interface SessionState {
  user: User | null;
  /** İlk oturum geri yüklemesi tamamlandı mı (yanıp sönmeyi önler). */
  ready: boolean;
  isAdmin: boolean;
}

/**
 * Tarayıcıda saklanmış bir supabase oturumu var mı — kütüphaneyi indirmeden.
 *
 * supabase-js oturumu `sb-<proje>-auth-token` anahtarında tutar. Anahtar yoksa
 * oturum da yoktur; 56 kB'lık paketi yalnızca "giriş yapılmamış" cevabını
 * almak için indirmenin anlamı kalmaz. Anahtar formatı sürüm değiştirirse
 * sonuç "oturum yok" olur ve tanıtım sayfası oturumsuz görünür; hesap
 * yollarına geçildiği anda (`eager`) istemci yine de yüklendiği için kullanıcı
 * hiçbir kapıda kilitli kalmaz.
 */
function hasStoredSession(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith('sb-') && key.endsWith('-auth-token')) return true;
    }
  } catch {
    // Depolama kapalıysa (gizli pencere, üçüncü taraf çerez kısıtı) emin
    // olamayız; istemciyi yükleyip gerçek cevabı alalım.
    return true;
  }
  return false;
}

/**
 * Supabase oturumunu ve admin bayrağını canlı izler.
 *
 * İstemci gecikmeli yüklenir. Bu kanca üst kabukta (App) çalıştığı için
 * statik import supabase-js'i tanıtım sayfasının açılış paketine sokuyordu:
 * ana sayfayı okumaya gelen ziyaretçinin oturumu yok ve kütüphaneyi hiç
 * kullanmıyor. Gecikmeli import ile kütüphane yalnızca oturum gerçekten
 * sorulduğunda ağdan iner; arayüz zaten `ready` false iken oturumsuz
 * görünümü çiziyordu, davranış değişmiyor.
 *
 * `eager`: oturumun kesin olarak sorulması gereken yollarda (giriş, hesap,
 * yönetim, şifre yenileme) istemci depolamaya bakılmadan yüklenir.
 *
 * Uyarı: `pages/AppHandoff.tsx` adres hash'indeki jetonu modül gövdesinde,
 * senkron olarak alır. İstemcinin geç oluşması o sırayı bozmaz, aksine
 * güvenceyi güçlendirir — supabase'in `detectSessionInUrl` işi artık daha da
 * sonra başlar.
 */
export function useSession(eager: boolean): SessionState {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    if (!eager && !hasStoredSession()) {
      setUser(null);
      setReady(true);
      return;
    }

    void (async () => {
      try {
        const { supabase } = await import('./supabase');
        if (cancelled) return;
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        setUser(data.session?.user ?? null);

        const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
          setUser(session?.user ?? null);
        });
        unsubscribe = () => sub.subscription.unsubscribe();
        if (cancelled) unsubscribe();
      } catch {
        // Ağ ya da paket hatası: oturumsuz kabul edip devam et. `ready` burada
        // da açılır, yoksa hesap sayfası sonsuza kadar "Yükleniyor…" kalır.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [eager]);

  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { supabase } = await import('./supabase');
        const { data } = await supabase.rpc('is_admin');
        if (!cancelled) setIsAdmin(data === true);
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  return { user, ready, isAdmin };
}

export function displayName(user: User | null): string {
  if (!user) return '';
  const meta = user.user_metadata ?? {};
  // E-posta kayıtları name yazar; GitHub OAuth full_name / user_name gönderir
  const name = ([meta.name, meta.full_name, meta.user_name] as (string | undefined)[])
    .map((value) => value?.trim())
    .find(Boolean);
  return (name || user.email) ?? '';
}
