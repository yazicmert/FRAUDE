import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { STRINGS, type Lang, type StringKey } from './strings';

export type { Lang, StringKey };

const STORAGE_KEY = 'fraude-site-lang';

/**
 * Dil tercihini hesaba yazar (oturum açıksa). E-posta şablonları bu değeri
 * `.Data.lang` ile okur; böylece kullanıcı arayüz dilini değiştirdiğinde
 * sonraki doğrulama/yenileme e-postaları da o dilde gelir. supabase istemcisi
 * gecikmeli yüklenir: dil değiştirmek açılış paketini büyütmemeli.
 */
async function syncLangToAccount(next: Lang): Promise<void> {
  try {
    const { supabase } = await import('./supabase');
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    await supabase.auth.updateUser({ data: { lang: next } });
  } catch {
    // Ağ/oturum hatası dil değişimini engellemez
  }
}


interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: StringKey) => string;
}

const I18nContext = createContext<I18n | null>(null);

function initialLang(): Lang {
  // ?lang=tr|en adresi hem test hem paylaşım için tercihi geçersiz kılar.
  const fromUrl = new URLSearchParams(window.location.search).get('lang');
  if (fromUrl === 'tr' || fromUrl === 'en') {
    localStorage.setItem(STORAGE_KEY, fromUrl);
    return fromUrl;
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'tr' || stored === 'en') return stored;
  return navigator.language?.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const setLang = useCallback((next: Lang) => {
    localStorage.setItem(STORAGE_KEY, next);
    setLangState(next);
    // Tercih hesapta da saklanır: kayıt doğrulama ve şifre yenileme
    // e-postaları bu değere bakar (bkz. docs/email-templates/*.html). Oturum
    // yoksa ya da yazılamazsa akış etkilenmez — dil arayüzde zaten değişti.
    void syncLangToAccount(next);
  }, []);

  // Belge dili ekran okuyucunun sesletimini ve arama motorunun dil tespitini
  // belirler. Başlık burada değil useSeo'da: o adrese göre de değişir.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // `t` ve bağlam değeri sabit kimlikte kalmalı: künyeyi yazan efekt (useSeo)
  // bunları bağımlılık listesinde tutuyor, her render'da yenilenirse künye
  // gereksiz yere baştan basılır.
  const t = useCallback((key: StringKey) => STRINGS[lang][key], [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n, I18nProvider içinde kullanılmalı');
  return ctx;
}
