import { useEffect, useRef, memo } from 'react';
import { useTranslation } from '../../api/i18n';

interface TradingViewChartProps {
  ticker: string;
  height?: number | string;
  interval?: string;
  theme?: 'dark' | 'light';
}

/**
 * FRAUDE sembolünü TradingView canonical sembolüne dönüştürür.
 */
export function formatTradingViewSymbol(rawSymbol: string): string {
  const s = rawSymbol.trim().toUpperCase();

  // Endeksler
  if (s === 'XU100' || s === 'BIST100' || s === 'XU100.IS') return 'BIST:XU100';
  if (s === 'XU030' || s === 'BIST30' || s === 'XU030.IS') return 'BIST:XU030';
  if (s === 'XBANK' || s === 'XBANK.IS') return 'BIST:XBANK';
  if (s === 'XUSIN' || s === 'XUSIN.IS') return 'BIST:XUSIN';

  // Kripto
  if (s.includes('BTC') || s === 'BTC-USD' || s === 'BTCUSDT') return 'BINANCE:BTCUSDT';
  if (s.includes('ETH') || s === 'ETH-USD' || s === 'ETHUSDT') return 'BINANCE:ETHUSDT';
  if (s.includes('SOL') || s === 'SOL-USD' || s === 'SOLUSDT') return 'BINANCE:SOLUSDT';
  if (s.includes('AVAX') || s === 'AVAX-USD') return 'BINANCE:AVAXUSDT';
  if (s.includes('XRP') || s === 'XRP-USD') return 'BINANCE:XRPUSDT';

  // Döviz / Pariteler
  if (s === 'USDTRY=X' || s === 'USDTRY' || s === 'USD/TRY') return 'FX_IDC:USDTRY';
  if (s === 'EURTRY=X' || s === 'EURTRY' || s === 'EUR/TRY') return 'FX_IDC:EURTRY';
  if (s === 'EURUSD=X' || s === 'EURUSD' || s === 'EUR/USD') return 'FX:EURUSD';
  if (s === 'GBPTRY=X' || s === 'GBPTRY') return 'FX_IDC:GBPTRY';

  // Emtialar
  if (s === 'GC=F' || s === 'GOLD' || s === 'ALTIN' || s === 'XAUUSD') return 'OANDA:XAUUSD';
  if (s === 'SI=F' || s === 'SILVER' || s === 'GUMUS' || s === 'XAGUSD') return 'OANDA:XAGUSD';
  if (s === 'CL=F' || s === 'BRENT' || s === 'OIL') return 'TVC:UKOIL';

  // Standart BIST Payı (Örn: THYAO, GARAN, ASELS, EREGL)
  const clean = s.replace(/\.IS$/, '');
  return `BIST:${clean}`;
}

function TradingViewChartComponent({
  ticker,
  height = 560,
  interval = 'D',
  theme = 'dark',
}: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { lang } = useTranslation();
  const tvSymbol = formatTradingViewSymbol(ticker);
  const containerId = `tradingview_chart_${ticker.replace(/[^a-zA-Z0-9]/g, '_')}_${Math.random().toString(36).substring(2, 7)}`;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Önceki scriptleri ve widget'ı temizle
    container.innerHTML = '';

    const widgetContainer = document.createElement('div');
    widgetContainer.id = containerId;
    widgetContainer.style.width = '100%';
    widgetContainer.style.height = '100%';
    container.appendChild(widgetContainer);

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/tv.js';
    script.async = true;
    script.onload = () => {
      if (typeof (window as any).TradingView !== 'undefined' && document.getElementById(containerId)) {
        new (window as any).TradingView.widget({
          autosize: true,
          symbol: tvSymbol,
          interval: interval,
          timezone: 'Europe/Istanbul',
          theme: theme,
          style: '1', // Candlestick
          locale: lang === 'tr' ? 'tr' : 'en',
          toolbar_bg: '#161b22',
          enable_publishing: false,
          allow_symbol_change: false,
          hide_side_toolbar: false, // Profesyonel çizim araç çubuğunu göster
          withdateranges: true,
          hide_volume: false,
          save_image: true,
          container_id: containerId,
          details: true,
          hotlist: false,
          calendar: false,
          studies: [
            'MASimple@tv-basicstudies',
            'RSI@tv-basicstudies',
          ],
          loading_screen: { backgroundColor: '#161b22', foregroundColor: '#58a6ff' },
          overrides: {
            'paneProperties.background': '#161b22',
            'paneProperties.backgroundType': 'solid',
            'paneProperties.vertGridProperties.color': '#21262d',
            'paneProperties.horzGridProperties.color': '#21262d',
            'scalesProperties.textColor': '#8b949e',
            'mainSeriesProperties.candleStyle.upColor': '#3fb950',
            'mainSeriesProperties.candleStyle.downColor': '#f85149',
            'mainSeriesProperties.candleStyle.drawWick': true,
            'mainSeriesProperties.candleStyle.drawBorder': true,
            'mainSeriesProperties.candleStyle.borderColor': '#3fb950',
            'mainSeriesProperties.candleStyle.borderUpColor': '#3fb950',
            'mainSeriesProperties.candleStyle.borderDownColor': '#f85149',
            'mainSeriesProperties.candleStyle.wickUpColor': '#3fb950',
            'mainSeriesProperties.candleStyle.wickDownColor': '#f85149',
          },
        });
      }
    };

    document.head.appendChild(script);

    return () => {
      if (container) {
        container.innerHTML = '';
      }
    };
  }, [tvSymbol, interval, theme, lang, containerId]);

  return (
    <div
      style={{
        width: '100%',
        height: typeof height === 'number' ? `${height}px` : height,
        borderRadius: '6px',
        overflow: 'hidden',
        border: '1px solid #30363d',
        background: '#161b22',
        position: 'relative',
      }}
    >
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
        }}
      />
    </div>
  );
}

export const TradingViewChart = memo(TradingViewChartComponent);
export default TradingViewChart;
