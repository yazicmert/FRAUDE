import { useMemo } from 'react';

interface Candle {
  up: boolean;
  body: number;
  wick: number;
  offset: number;
}

/** Deterministik mum yürüyüşü (uygulamadaki intro ile aynı algoritma). */
function buildCandles(seed: number, count: number, scale = 1): Candle[] {
  let state = seed >>> 0;
  const rnd = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  let level = 0;
  return Array.from({ length: count }, () => {
    const up = rnd() > 0.45;
    const body = (18 + rnd() * 46) * scale;
    level += (up ? -1 : 1) * (4 + rnd() * 16);
    level = Math.max(-70, Math.min(70, level));
    return { up, body, wick: body + (18 + rnd() * 26) * scale, offset: level * scale };
  });
}

function Strip({ candles }: { candles: Candle[] }) {
  return (
    <>
      {candles.map((candle, index) => (
        <div
          key={index}
          className={`tape-candle ${candle.up ? 'up' : 'down'}`}
          style={{ transform: `translateY(${candle.offset}px)` }}
        >
          <i style={{ height: candle.wick }} />
          <b style={{ height: candle.body }} />
        </div>
      ))}
    </>
  );
}

/**
 * Sonsuz akan mum bandı: iki eş kopya, -%50 kaydırma ile dikişsiz döngü.
 * `variant` konum/hız/parlaklık ön ayarını seçer (near = alt, far = orta).
 */
export default function CandleTape({ variant }: { variant: 'near' | 'far' }) {
  const candles = useMemo(
    () => buildCandles(variant === 'near' ? 0x42495354 : 0x46524445, variant === 'near' ? 64 : 72, variant === 'near' ? 0.9 : 0.6),
    [variant],
  );
  return (
    <div className={`tape tape-${variant}`} aria-hidden="true">
      <div className="tape-half"><Strip candles={candles} /></div>
      <div className="tape-half"><Strip candles={candles} /></div>
    </div>
  );
}
