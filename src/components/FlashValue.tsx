import { useEffect, useRef, useState } from 'react';

/**
 * Sayısal değeri gösterir ve değer değiştiğinde kısa bir yeşil/kırmızı arka
 * plan flaşı oynatır — senkron sonrası "canlı" piyasa hissi verir.
 */
export default function FlashValue({
  value,
  format,
  className,
  style,
}: {
  value: number;
  format?: (v: number) => string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const prev = useRef(value);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    if (value === prev.current) return;
    setFlash(value > prev.current ? 'up' : 'down');
    prev.current = value;
    const timer = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(timer);
  }, [value]);

  const flashClass = flash === 'up' ? 'flash-up' : flash === 'down' ? 'flash-down' : '';
  return (
    <span className={`${className ?? ''} ${flashClass}`.trim()} style={style}>
      {format ? format(value) : value}
    </span>
  );
}
