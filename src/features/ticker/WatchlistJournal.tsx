import { useEffect, useState } from 'react';
import { useWatchlist } from '../../hooks/useWatchlist';

const field: React.CSSProperties = {
  background: 'var(--bg-dark)',
  border: '1px solid var(--border-color)',
  color: 'var(--text-main)',
  borderRadius: '4px',
  padding: '6px 8px',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.8rem',
  width: '100%',
};

/**
 * Takip listesindeki bir hisse için "portföy günlüğü": adet, maliyet, yatırım
 * tezi ve serbest not. Değerler yazıldıkça localStorage'a kaydedilir; anlık
 * fiyata göre kâr/zarar gösterilir. Yalnızca hisse takip listesindeyse çizilir.
 */
export default function WatchlistJournal({ ticker, price }: { ticker: string; price: number }) {
  const { isInWatchlist, getWatchlistItem, updateWatchlistItem } = useWatchlist();
  const item = getWatchlistItem(ticker);

  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [thesis, setThesis] = useState('');
  const [note, setNote] = useState('');

  // Hisse/kayıt değişince alanları senkronla.
  useEffect(() => {
    setQty(item?.quantity ? String(item.quantity) : '');
    setCost(item?.addedPrice ? String(item.addedPrice) : '');
    setThesis(item?.thesis ?? '');
    setNote(item?.note ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, item?.quantity, item?.addedPrice]);

  if (!isInWatchlist(ticker)) return null;

  const qtyN = Number(qty) || 0;
  const costN = Number(cost) || 0;
  const hasPosition = qtyN > 0 && costN > 0;
  const pnlAbs = hasPosition ? (price - costN) * qtyN : null;
  const pnlPct = hasPosition ? ((price - costN) / costN) * 100 : null;
  const pnlColor = (pnlAbs ?? 0) >= 0 ? '#3fb950' : '#f85149';

  const commit = (patch: Parameters<typeof updateWatchlistItem>[1]) => updateWatchlistItem(ticker, patch);

  return (
    <section className="panel" style={{ marginBottom: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <strong>📓 Portföy Günlüğü</strong>
        {hasPosition && (
          <span style={{ fontSize: '0.85rem', color: pnlColor, fontWeight: 700 }}>
            {pnlPct! >= 0 ? '+' : ''}{pnlPct!.toFixed(2)}% · {pnlAbs! >= 0 ? '+' : ''}{pnlAbs!.toFixed(2)} ₺
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
        <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          Adet
          <input
            style={{ ...field, width: '110px', marginTop: '3px' }}
            type="number"
            step="any"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            onBlur={() => commit({ quantity: Number(qty) || undefined })}
          />
        </label>
        <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          Maliyet (₺)
          <input
            style={{ ...field, width: '110px', marginTop: '3px' }}
            type="number"
            step="any"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            onBlur={() => commit({ addedPrice: Number(cost) || 0 })}
          />
        </label>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', alignSelf: 'flex-end', paddingBottom: '7px' }}>
          Güncel: <strong style={{ color: 'var(--text-main)' }}>{price.toFixed(2)} ₺</strong>
          {item?.addedAt && <> · eklendi: {new Date(item.addedAt).toLocaleDateString('tr-TR')}</>}
        </div>
      </div>

      <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>
        Yatırım Tezi — neden aldım / neyi bekliyorum?
        <textarea
          style={{ ...field, marginTop: '3px', minHeight: '54px', resize: 'vertical', fontFamily: 'var(--font-sans)' }}
          value={thesis}
          onChange={(e) => setThesis(e.target.value)}
          onBlur={() => commit({ thesis: thesis.trim() || undefined })}
          placeholder="Örn. 3Ç bilanço beklentisi güçlü, 45 TL hedef; 32 TL stop."
        />
      </label>

      <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>
        Not
        <input
          style={{ ...field, marginTop: '3px', fontFamily: 'var(--font-sans)' }}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => commit({ note: note.trim() || undefined })}
          placeholder="Kısa hatırlatma…"
        />
      </label>
    </section>
  );
}
