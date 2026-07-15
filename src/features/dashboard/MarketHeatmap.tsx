import React, { useMemo, useState } from 'react';
import { treemap, hierarchy } from 'd3-hierarchy';
import { EquityRow } from '../../types';

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
  const [hovered, setHovered] = useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: defaultWidth, height: defaultHeight });

  React.useEffect(() => {
    if (!containerRef.current) return;
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
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const root = useMemo(() => {
    // Filter out items without market_cap or change_pct, and valid ones
    // Filter out extreme anomalies like ISBTR/ISATR/ISKUR which have mathematically absurd market caps due to illiquidity
    const excludedTickers = ['ISBTR.IS', 'ISATR.IS', 'ISKUR.IS'];
    const validData = data.filter(d => 
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

  const getColor = (pct: number) => {
    if (pct >= 3) return '#00b894';
    if (pct > 0.5) return '#55efc4';
    if (pct > -0.5 && pct <= 0.5) return '#636e72'; // neutral
    if (pct <= -3) return '#d63031';
    return '#ff7675';
  };

  if (!root || !root.children || root.children.length === 0) {
    return (
      <div style={{ width: '100%', height: defaultHeight, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-panel)', borderRadius: '8px', color: 'var(--text-muted)' }}>
        Isı haritası için veri bulunamadı veya hesaplanıyor...
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: defaultHeight, background: 'var(--bg-main)', borderRadius: '4px', overflow: 'hidden' }}>
      {root.children.map(leaf => {
        const d = leaf.data.data;
        if (!d) return null;
        
        const isHovered = hovered === d.ticker;
        const color = getColor(d.change_pct);
        
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
            title={`${d.ticker.replace('.IS','')} - ${d.name}\nPiyasa Değeri: ${d.market_cap?.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} TL\nDeğişim: ${d.change_pct > 0 ? '+' : ''}${d.change_pct.toFixed(2)}%\nAğırlık: %${((leaf.value || 0) / (root.value || 1) * 100).toFixed(2)}`}
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
                    Ağırlık: %{((leaf.value || 0) / (root.value || 1) * 100).toFixed(2)}
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
