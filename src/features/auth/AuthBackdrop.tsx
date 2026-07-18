import { useMemo } from 'react';
import { buildCandles, CandleStrip } from './IntroSplash';
import './auth.css';

// Kart arkasında akan stilize endeks patikası (1200x320 tuvalinde).
const SPARK_PATH =
  'M0,250 C80,242 120,192 190,200 S320,150 400,164 S540,92 620,110 ' +
  'S760,142 830,120 S980,62 1060,76 S1160,42 1200,30';

/** Mum-F logosu — uygulama ikonuyla aynı harf, kart zemininde küçük boy. */
export function BrandMark() {
  return (
    <svg width="58" height="58" viewBox="0 0 1024 1024" aria-hidden="true">
      <rect x="32" y="32" width="960" height="960" rx="212" fill="#10151d" />
      <rect x="326" y="164" width="16" height="696" rx="8" fill="#00d488" opacity="0.9" />
      <rect x="350" y="462" width="268" height="112" rx="26" fill="#f0554a" />
      <rect x="618" y="510" width="44" height="16" rx="8" fill="#f0554a" opacity="0.9" />
      <rect x="278" y="212" width="424" height="112" rx="26" fill="#00d488" />
      <rect x="702" y="260" width="44" height="16" rx="8" fill="#00d488" opacity="0.9" />
      <rect x="278" y="212" width="112" height="600" rx="26" fill="#00d488" />
    </svg>
  );
}

/**
 * Login/lisans ekranlarının canlı zemini: grafik ızgarası, akan endeks
 * çizgisi ve iki katmanlı sonsuz mum bandı. auth-screen içinde kullanılır.
 */
export default function AuthBackdrop() {
  // Bant iki eş kopyadan oluşur; -%50 kayınca döngü dikişsiz kapanır.
  const nearTape = useMemo(() => buildCandles(0x42495354, 64, 0.9), []);
  const farTape = useMemo(() => buildCandles(0x46524445, 72, 0.6), []);

  return (
    <>
      <div className="auth-grid" aria-hidden="true" />
      <svg className="auth-spark" viewBox="0 0 1200 320" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#00e896" stopOpacity="0" />
            <stop offset="0.35" stopColor="#00e896" />
            <stop offset="1" stopColor="#00c3ff" />
          </linearGradient>
        </defs>
        <path className="auth-spark-base" d={SPARK_PATH} />
        <path className="auth-spark-flow" d={SPARK_PATH} />
      </svg>
      <div className="auth-tape auth-tape-far" aria-hidden="true">
        <div className="auth-tape-half"><CandleStrip candles={farTape} /></div>
        <div className="auth-tape-half"><CandleStrip candles={farTape} /></div>
      </div>
      <div className="auth-tape auth-tape-near" aria-hidden="true">
        <div className="auth-tape-half"><CandleStrip candles={nearTape} /></div>
        <div className="auth-tape-half"><CandleStrip candles={nearTape} /></div>
      </div>
    </>
  );
}
