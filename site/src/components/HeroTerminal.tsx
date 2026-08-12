import { useI18n } from '../lib/i18n';

/**
 * Kahraman bölümündeki imza öğesi: uygulamanın kendi yüzeyi.
 * Ekran görüntüsü değil, gerçek işaretleme — sorgu yazılır, satırlar çözülür,
 * altta bir KAP bildirimi düşer. Komut uygulamadaki FQL şablonunun aynısıdır
 * (src/features/terminal/TerminalPanel.tsx). Satırlar örnek veridir ve panel
 * bunu "örnek tarama" etiketiyle açıkça söyler.
 */

const QUERY = 'scan BIST100 where rsi < 30';

interface Row {
  ticker: string;
  last: string;
  change: string;
  rsi: number;
}

// Aşırı satım taramasının doğal sonucu: hepsi ekside, RSI 30'un altında.
const ROWS: Row[] = [
  { ticker: 'THYAO', last: '306,25', change: '−%1,61', rsi: 28.4 },
  { ticker: 'EREGL', last: '24,18', change: '−%0,74', rsi: 27.1 },
  { ticker: 'KCHOL', last: '178,90', change: '−%1,12', rsi: 29.6 },
  { ticker: 'TOASO', last: '198,40', change: '−%0,95', rsi: 26.3 },
  { ticker: 'PETKM', last: '14,77', change: '−%1,80', rsi: 22.8 },
  { ticker: 'SASA', last: '3,42', change: '−%2,28', rsi: 21.5 },
];

export default function HeroTerminal() {
  const { t } = useI18n();

  return (
    <div className="term" role="img" aria-label={t('termAria')}>
      <div className="term-bar">
        <span className="term-code">SC</span>
        <span className="term-title">{t('termTitle')}</span>
        <span className="term-flag">{t('termSample')}</span>
      </div>

      <div className="term-body">
        <div className="term-prompt">
          <span className="term-caret">$</span>
          <span className="term-typed">{QUERY}</span>
        </div>

        <div className="term-head">
          <span>{t('colTicker')}</span>
          <span className="num">{t('colLast')}</span>
          <span className="num">{t('colChange')}</span>
          <span className="term-rsi-h">RSI</span>
        </div>

        <ol className="term-rows">
          {ROWS.map((row, i) => (
            <li key={row.ticker} style={{ ['--i' as string]: i }}>
              <span className="term-tk">{row.ticker}</span>
              <span className="num">{row.last}</span>
              <span className="num down">{row.change}</span>
              <span className="term-rsi">
                <span className="term-rsi-track">
                  {/* RSI 0-100 ölçeğinde; 30 altı aşırı satım bölgesi. */}
                  <span className="term-rsi-fill" style={{ width: `${row.rsi}%` }} />
                </span>
                <span className="term-rsi-val">{row.rsi.toFixed(1).replace('.', ',')}</span>
              </span>
            </li>
          ))}
        </ol>

        <div className="term-kap">
          <span className="term-kap-src">KAP</span>
          <span className="term-kap-time">14:32</span>
          <span className="term-kap-tk">THYAO</span>
          <span className="term-kap-txt">{t('termKap')}</span>
        </div>
      </div>
    </div>
  );
}
