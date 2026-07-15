import { useMemo } from 'react';
import * as d3 from 'd3-hierarchy';
import type { DashboardSnapshot, IndexConstituent } from '../../types';

interface IndexHeatmapProps {
  constituents: IndexConstituent[];
  snapshot: DashboardSnapshot | null;
  onSelectTicker: (ticker: string) => void;
  width?: number;
  height?: number;
}

interface TreemapData {
  name: string;
  ticker?: string;
  value?: number;
  change?: number;
  price?: number;
  children?: TreemapData[];
}

export default function IndexHeatmap({ constituents, snapshot, onSelectTicker, width = 800, height = 600 }: IndexHeatmapProps) {
  
  const rootNode = useMemo(() => {
    if (!constituents.length || !snapshot) return null;
    
    // Create data hierarchy
    const children = constituents.map(c => {
      const eq = snapshot.equities.find(e => e.ticker === c.ticker);
      // BIST Endekslerinde ağırlık Fiili Dolaşımdaki Pay Piyasa Değerine göre hesaplanır
      const ratio = (eq?.free_float_ratio !== undefined && eq?.free_float_ratio !== null) ? (eq.free_float_ratio / 100.0) : 1.0;
      const value = (eq?.market_cap || (eq?.volume ? eq.volume * eq.price : 1)) * ratio;
      
      return {
        name: c.name,
        ticker: c.ticker,
        value: value,
        change: eq?.change_pct || 0,
        price: eq?.price || 0,
      } as TreemapData;
    });

    const data: TreemapData = {
      name: "Index",
      children: children
    };

    const root = d3.hierarchy(data)
      .sum(d => d.value || 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    d3.treemap<TreemapData>()
      .size([width, height])
      .paddingInner(2)
      (root);

    return root;
  }, [constituents, snapshot, width, height]);

  if (!rootNode) {
    return <div style={{ padding: '20px', color: 'var(--text-muted)' }}>Isı haritası için veri bekleniyor...</div>;
  }

  const getBackgroundColor = (change: number) => {
    if (change > 3) return '#059669'; // Strong Green
    if (change > 0) return '#10B981'; // Green
    if (change === 0) return '#4B5563'; // Gray
    if (change > -3) return '#EF4444'; // Red
    return '#DC2626'; // Strong Red
  };

  return (
    <div style={{ position: 'relative', width: `${width}px`, height: `${height}px`, background: 'var(--bg-default)', borderRadius: '8px', overflow: 'hidden' }}>
      {rootNode.leaves().map(leaf => {
        const node = leaf as d3.HierarchyRectangularNode<TreemapData>;
        const { x0, x1, y0, y1, data } = node;
        const boxWidth = x1 - x0;
        const boxHeight = y1 - y0;
        
        return (
          <div
            key={data.ticker}
            onClick={() => data.ticker && onSelectTicker(data.ticker)}
            style={{
              position: 'absolute',
              left: x0,
              top: y0,
              width: boxWidth,
              height: boxHeight,
              background: getBackgroundColor(data.change || 0),
              color: 'white',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              border: '1px solid rgba(0,0,0,0.2)',
              overflow: 'hidden',
              padding: '4px',
              transition: 'transform 0.1s, z-index 0.1s',
            }}
            title={`${data.ticker}: ${data.name}\nFiyat: ${data.price?.toFixed(2)}\nDeğişim: %${data.change?.toFixed(2)}\nEndeks Ağırlığı: %${((data.value || 0) / (rootNode.value || 1) * 100).toFixed(2)}`}
            onMouseEnter={e => {
              e.currentTarget.style.transform = 'scale(1.02)';
              e.currentTarget.style.zIndex = '10';
              e.currentTarget.style.boxShadow = '0 8px 16px rgba(0,0,0,0.3)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.zIndex = '1';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <span style={{ fontSize: boxWidth > 60 && boxHeight > 40 ? '1rem' : '0.6rem', fontWeight: 'bold' }}>{data.ticker}</span>
            {boxWidth > 60 && boxHeight > 50 && (
              <>
                <span style={{ fontSize: '0.8rem' }}>%{data.change?.toFixed(2)}</span>
                {boxHeight > 65 && (
                  <span style={{ fontSize: '0.65rem', opacity: 0.8, marginTop: '2px' }}>
                    Ağırlık: %{((data.value || 0) / (rootNode.value || 1) * 100).toFixed(2)}
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
