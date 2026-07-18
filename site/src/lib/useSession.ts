import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';

export interface SessionState {
  user: User | null;
  /** İlk oturum geri yüklemesi tamamlandı mı (yanıp sönmeyi önler). */
  ready: boolean;
  isAdmin: boolean;
}

/** Supabase oturumunu ve admin bayrağını canlı izler. */
export function useSession(): SessionState {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      return;
    }
    let cancelled = false;
    supabase.rpc('is_admin').then(({ data }) => {
      if (!cancelled) setIsAdmin(data === true);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  return { user, ready, isAdmin };
}

export function displayName(user: User | null): string {
  if (!user) return '';
  return ((user.user_metadata?.name as string | undefined)?.trim() || user.email) ?? '';
}
