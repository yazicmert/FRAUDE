import { useEffect, useState } from 'react';
import type { ToastKind } from '../lib/notify';

interface ToastItem {
  id: number;
  title: string;
  body: string;
  kind: ToastKind;
}

const KIND_ACCENT: Record<ToastKind, string> = {
  info: '#58a6ff',
  success: '#3fb950',
  warning: '#d29922',
  danger: '#f85149',
};

let counter = 0;

/**
 * `fraude-toast` olaylarını dinleyip sağ altta geçici bildirim kartları
 * gösterir. Uygulama kabuğunda bir kez monte edilir; OS bildirimi görünmese
 * bile kullanıcı görsel geri bildirim alır.
 */
export default function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<{ title: string; body: string; kind: ToastKind }>).detail;
      if (!detail) return;
      const id = ++counter;
      setItems((prev) => [...prev, { id, title: detail.title, body: detail.body, kind: detail.kind ?? 'info' }]);
      setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== id));
      }, 6000);
    };
    window.addEventListener('fraude-toast', onToast);
    return () => window.removeEventListener('fraude-toast', onToast);
  }, []);

  if (items.length === 0) return null;

  return (
    <div style={{ position: 'fixed', right: '16px', bottom: '16px', zIndex: 1100, display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '340px' }}>
      {items.map((t) => (
        <div
          key={t.id}
          onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
          style={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-color)',
            borderLeft: `3px solid ${KIND_ACCENT[t.kind]}`,
            borderRadius: '8px',
            padding: '10px 12px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
            cursor: 'pointer',
            animation: 'toast-in 0.22s ease',
          }}
        >
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)' }}>{t.title}</div>
          {t.body && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '3px' }}>{t.body}</div>}
        </div>
      ))}
    </div>
  );
}
