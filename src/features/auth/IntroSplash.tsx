import { useEffect, useMemo, useRef, useState } from 'react';
import './auth.css';

export interface IntroCandle {
  up: boolean;
  body: number;
  wick: number;
  offset: number;
}

/**
 * Deterministik "rastgele" mum yürüyüşü üretir (LCG). Her açılışta aynı
 * şerit çizilir; böylece intro her seferinde aynı karakterde görünür.
 */
export function buildCandles(seed: number, count: number, scale = 1): IntroCandle[] {
  let state = seed >>> 0;
  const rnd = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  let level = 0;
  return Array.from({ length: count }, () => {
    const up = rnd() > 0.45;
    const body = (18 + rnd() * 46) * scale;
    // Yükselen mum fiyat seviyesini yukarı taşır (ekranda offset küçülür).
    level += (up ? -1 : 1) * (4 + rnd() * 16);
    level = Math.max(-70, Math.min(70, level));
    return { up, body, wick: body + (18 + rnd() * 26) * scale, offset: level * scale };
  });
}

export function CandleStrip({ candles }: { candles: IntroCandle[] }) {
  return (
    <>
      {candles.map((candle, index) => (
        <div
          key={index}
          className={`intro-candle ${candle.up ? 'up' : 'down'}`}
          style={{ transform: `translateY(${candle.offset}px)` }}
        >
          <i style={{ height: candle.wick }} />
          <b style={{ height: candle.body }} />
        </div>
      ))}
    </>
  );
}

const BRAND = 'FRAUDE';

/**
 * Açılış introsu: mum şeritleri ekranı sağdan sola süpürür, ardından FRAUDE
 * yazısı harf harf belirir ve tümü sönümlenip onDone çağrılır. Tıklama ya da
 * herhangi bir tuş introyu atlar.
 */
export default function IntroSplash({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<'sweep' | 'brand' | 'out'>('sweep');
  const near = useMemo(() => buildCandles(0x46524155, 30), []);
  const far = useMemo(() => buildCandles(0x44453235, 36, 0.62), []);
  const finished = useRef(false);

  useEffect(() => {
    const finish = () => {
      if (!finished.current) {
        finished.current = true;
        onDone();
      }
    };
    const timers = [
      setTimeout(() => setPhase('brand'), 1500),
      setTimeout(() => setPhase('out'), 3200),
      setTimeout(finish, 3700),
    ];
    const skip = () => finish();
    window.addEventListener('keydown', skip);
    window.addEventListener('pointerdown', skip);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('keydown', skip);
      window.removeEventListener('pointerdown', skip);
    };
  }, [onDone]);

  return (
    // Faz sınıfı "intro-phase-*" önekiyle verilir: "intro-brand" fazı, aynı
    // adlı yazı kapsayıcısının (.intro-brand) stilini ezmesin (ortalama kaybı).
    <div className={`intro-splash intro-phase-${phase}`} role="presentation">
      <div className="intro-strip intro-strip-far">
        <CandleStrip candles={far} />
      </div>
      <div className="intro-strip intro-strip-near">
        <CandleStrip candles={near} />
      </div>
      {phase !== 'sweep' && (
        <div className="intro-brand">
          {BRAND.split('').map((letter, index) => (
            <span
              key={index}
              className={`intro-letter${index === 0 ? ' green' : ''}`}
              style={{ animationDelay: `${0.05 + index * 0.08}s` }}
            >
              {letter}
            </span>
          ))}
          <span className="intro-tagline">TERMINAL</span>
        </div>
      )}
    </div>
  );
}
