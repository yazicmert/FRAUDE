import type { ReactNode } from 'react';

interface HotkeyTipProps {
  /** İpucunda gösterilen özellik adı. */
  label: string;
  /** Kısayol tuş parçaları (shortcutKeys çıktısı); boşsa yalnız ad gösterilir. */
  keys?: string[];
  /** Ekranın sağ kenarına yakın öğelerde taşmayı önlemek için sağa hizala. */
  align?: 'center' | 'right';
  children: ReactNode;
}

/**
 * Üst çubuk denetimlerini saran ipucu: fare üstüne gelince (veya klavye
 * odağında) özelliğin adını ve varsa kısayol tuşlarını rozet olarak gösterir.
 */
export default function HotkeyTip({ label, keys, align = 'center', children }: HotkeyTipProps) {
  return (
    <span className={`hk-wrap${align === 'right' ? ' hk-right' : ''}`}>
      {children}
      <span className="hk-tip" role="tooltip">
        {label}
        {keys && keys.length > 0 && (
          <span className="hk-keys">
            {keys.map((key) => <kbd key={key}>{key}</kbd>)}
          </span>
        )}
      </span>
    </span>
  );
}
