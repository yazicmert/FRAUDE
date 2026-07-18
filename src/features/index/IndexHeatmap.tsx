import { useEffect, useMemo, useState } from 'react';
import * as d3 from 'd3-hierarchy';
import type { DashboardSnapshot, IndexConstituent } from '../../types';
import { useTranslation } from '../../api/i18n';
import { changeColor } from '../../lib/heatmapScale';

interface IndexHeatmapProps {
  constituents: IndexConstituent[];
  snapshot: DashboardSnapshot | null;
  onSelectTicker: (ticker: string) => void;
  /** Ölçüm gelene kadarki ilk yerleşim genişliği; sonrası kabın gerçek ölçüsü. */
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
  const { t } = useTranslation();
  // Kap genişliği pencereyle/panelle birlikte değişir; yerleşim ölçülen gerçek
  // boyutla kurulur. Callback-ref kullanılır: kap, veri gelene kadar hiç render
  // edilmeyebilir; sabit ref + tek seferlik efekt o durumda gözlemciyi asla
  // bağlayamazdı.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [dimensions, setDimensions] = useState({ width, height });

  useEffect(() => {
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          setDimensions({ width: entry.contentRect.width, height: entry.contentRect.height });
        }
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [container]);

  const rootNode = useMemo(() => {
    if (!constituents.length || !snapshot) return null;
    
    // Create data hierarchy
    // Ağırlık yalnızca piyasa değerinden gelir (BIST kuralına uygun olarak
    // fiili dolaşım oranıyla çarpılır). Eski hacim×fiyat yedeği elmalarla
    // armutları karıştırıyordu: piyasa değeri eksik bir hisse, o günkü işlem
    // hacmine göre absürt büyük/küçük kutu alabiliyordu. Değeri olmayan satır
    // haritada hiç yer almaz; ağırlık yüzdeleri böylece gerçek kalır.
    const children = constituents.flatMap(c => {
      const eq = snapshot.equities.find(e => e.ticker === c.ticker);
      if (!eq?.market_cap || eq.market_cap <= 0) return [];
      const ratio = (eq.free_float_ratio !== undefined && eq.free_float_ratio !== null) ? (eq.free_float_ratio / 100.0) : 1.0;

      return [{
        name: c.name,
        ticker: c.ticker,
        value: eq.market_cap * ratio,
        change: eq.change_pct || 0,
        price: eq.price || 0,
      } as TreemapData];
    });
    if (children.length === 0) return null;

    const data: TreemapData = {
      name: "Index",
      children: children
    };

    const root = d3.hierarchy(data)
      .sum(d => d.value || 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    d3.treemap<TreemapData>()
      .size([dimensions.width, dimensions.height])
      .paddingInner(2)
      (root);

    return root;
  }, [constituents, snapshot, dimensions.width, dimensions.height]);

  if (!rootNode) {
    return <div style={{ padding: '20px', color: 'var(--text-muted)' }}>{t('heatmapDataWaiting')}</div>;
  }

  return (
    <div ref={setContainer} style={{ position: 'relative', width: '100%', height: `${height}px`, background: 'var(--bg-default)', borderRadius: '8px', overflow: 'hidden' }}>
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
              background: changeColor(data.change ?? 0),
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
            title={`${data.ticker}: ${data.name}\n${t('price')}: ${data.price?.toFixed(2)}\n${t('change')}: %${data.change?.toFixed(2)}\n${t('indexWeight')}: %${((data.value || 0) / (rootNode.value || 1) * 100).toFixed(2)}`}
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
                    {t('weight')}: %{((data.value || 0) / (rootNode.value || 1) * 100).toFixed(2)}
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
