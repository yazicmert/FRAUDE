import React, { useMemo, useState } from 'react';
import { treemap, hierarchy } from 'd3-hierarchy';
import { EquityRow } from '../../types';
import { useTranslation } from '../../api/i18n';
import { changeColor } from '../../lib/heatmapScale';

interface MarketHeatmapProps {
  data: EquityRow[];
  width?: number;
  height?: number;
  onSelect?: (ticker: string) => void;
}

interface TreeNode {
  id: string;
  value: number;
  data?: EquityRow;
  children?: TreeNode[];
}

export default function MarketHeatmap({ data, width: defaultWidth = 800, height: defaultHeight = 400, onSelect }: MarketHeatmapProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState<string | null>(null);
  // Callback-ref: kap, veri gelene kadar (boş-durum dalı) hiç render edilmeyebilir;
  // sabit ref + tek seferlik efekt o durumda gözlemciyi asla bağlayamazdı ve
  // harita varsayılan 800px genişlikte donuk kalırdı.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [dimensions, setDimensions] = useState({ width: defaultWidth, height: defaultHeight });

  React.useEffect(() => {
    if (!container) return;
    const observer = new ResizeObserver(entries => {
      for (let entry of entries) {
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          setDimensions({
            width: entry.contentRect.width,
            height: entry.contentRect.height
          });
        }
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [container]);

  const root = useMemo(() => {
    // Filter out items without market_cap or change_pct, and valid ones
    // Likidite azlığı yüzünden piyasa değeri anlamsız şişen istisnalar.
    // DİKKAT: store ticker'ları .IS eki TAŞIMAZ; eski ".IS"li liste hiçbir
    // satırla eşleşmediğinden filtre yıllarca ölüydü.
    const excludedTickers = ['ISBTR', 'ISATR', 'ISKUR'];
    const validData = data.filter(d =>
      Number.isFinite(d.change_pct) &&
      d.market_cap &&
      d.market_cap > 0 &&
      !excludedTickers.includes(d.ticker) &&
      d.market_cap < 10000000000000 // 10 Trillion TL cap to prevent rendering breakdown
    );
    
    // Sort by market cap descending so largest are rendered first (or just hierarchical)
    validData.sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0));

    // Optional: limit to top 100 for performance and visibility
    const topData = validData.slice(0, 100);

    const hierarchicalData: TreeNode = {
      id: 'root',
      value: 0,
      children: topData.map(d => {
        // Halka açıklık oranı varsa gerçek endeks ağırlığı (Fiili dolaşım piyasa değeri) kullan, yoksa toplam piyasa değeri
        const ratio = (d.free_float_ratio !== undefined && d.free_float_ratio !== null) ? (d.free_float_ratio / 100.0) : 1.0;
        const effectiveMarketCap = (d.market_cap || 0) * ratio;
        
        return {
          id: d.ticker,
          value: effectiveMarketCap,
          data: d
        };
      })
    };

    const rootNode = hierarchy(hierarchicalData)
      .sum(d => d.value)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    const layout = treemap<TreeNode>()
      .size([dimensions.width, dimensions.height])
      .paddingInner(1)
      .paddingOuter(0)
      .round(true);

    return layout(rootNode);
  }, [data, dimensions.width, dimensions.height]);

  if (!root || !root.children || root.children.length === 0) {
    return (
      <div style={{ width: '100%', height: defaultHeight, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-panel)', borderRadius: '8px', color: 'var(--text-muted)' }}>
        {t('heatmapDataNotFound')}
      </div>
    );
  }

  return (
    <div ref={setContainer} style={{ position: 'relative', width: '100%', height: defaultHeight, background: 'var(--bg-main)', borderRadius: '4px', overflow: 'hidden' }}>
      {root.children.map(leaf => {
        const d = leaf.data.data;
        if (!d) return null;
        
        const isHovered = hovered === d.ticker;
        const color = changeColor(d.change_pct);
        
        return (
          <div
            key={d.ticker}
            onMouseEnter={() => setHovered(d.ticker)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onSelect && onSelect(d.ticker)}
            style={{
              position: 'absolute',
              left: leaf.x0,
              top: leaf.y0,
              width: leaf.x1 - leaf.x0,
              height: leaf.y1 - leaf.y0,
              backgroundColor: color,
              border: isHovered ? '2px solid white' : 'none',
              cursor: onSelect ? 'pointer' : 'default',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              padding: '2px',
              boxSizing: 'border-box',
              transition: 'border 0.1s',
              zIndex: isHovered ? 10 : 1
            }}
            title={`${d.ticker.replace('.IS','')} - ${d.name}\n${t('marketCapLabel')}: ${d.market_cap?.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} TL\n${t('change')}: ${d.change_pct > 0 ? '+' : ''}${d.change_pct.toFixed(2)}%\n${t('weight')}: %${((leaf.value || 0) / (root.value || 1) * 100).toFixed(2)}`}
          >
            {(leaf.x1 - leaf.x0) > 30 && (leaf.y1 - leaf.y0) > 15 && (
              <>
                <span style={{ 
                  fontWeight: 'bold', 
                  fontSize: Math.min((leaf.x1 - leaf.x0) / 4, 12) + 'px',
                  color: '#fff',
                  textShadow: '0 1px 3px rgba(0,0,0,0.6)'
                }}>
                  {d.ticker.replace('.IS', '')}
                </span>
                {(leaf.y1 - leaf.y0) > 30 && (
                  <span style={{ 
                    fontSize: Math.min((leaf.x1 - leaf.x0) / 5, 10) + 'px',
                    color: '#fff',
                    textShadow: '0 1px 3px rgba(0,0,0,0.6)'
                  }}>
                    {d.change_pct > 0 ? '+' : ''}{d.change_pct.toFixed(2)}%
                  </span>
                )}
                {(leaf.y1 - leaf.y0) > 45 && (leaf.x1 - leaf.x0) > 40 && (
                  <span style={{ 
                    fontSize: Math.min((leaf.x1 - leaf.x0) / 6, 8) + 'px',
                    color: '#fff',
                    opacity: 0.8,
                    marginTop: '2px',
                    textShadow: '0 1px 3px rgba(0,0,0,0.6)'
                  }}>
                    {t('weight')}: %{((leaf.value || 0) / (root.value || 1) * 100).toFixed(2)}
                  </span>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
