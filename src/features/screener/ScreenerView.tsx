import { useState } from 'react';
import { runScreener } from '../../api/tauriClient';
import { useTranslation } from '../../api/i18n';
import type { EquityRow } from '../../types';

interface ScreenerViewProps {
  initialRows?: EquityRow[];
  onSelectTicker?: (ticker: string) => void;
}

export default function ScreenerView({ initialRows, onSelectTicker }: ScreenerViewProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('where rsi < 35');
  const [rows, setRows] = useState<EquityRow[]>(initialRows ?? []);
  const [message, setMessage] = useState(initialRows ? t('screenerResultStatus').replace('{{count}}', initialRows.length.toString()) : '');
  const [hasSearched, setHasSearched] = useState(!!initialRows);

  const execute = async (searchQuery: string = query) => {
    setQuery(searchQuery);
    const result = await runScreener(searchQuery);
    setRows(result.rows);
    setMessage(t('screenerResultStatus').replace('{{count}}', result.rows.length.toString()));
    setHasSearched(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      void execute();
    }
  };

  return (
    <div className="view" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="view-header" style={{ marginBottom: 0 }}>
        <div>
          <p className="eyebrow">{t('fqlScreener')}</p>
          <h1>{t('technicalScreener')}</h1>
        </div>
      </div>

      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', overflowX: 'auto', paddingBottom: '4px' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>{t('screenerPresets')}:</span>
          <button 
            type="button" 
            className="secondary-button"
            onClick={() => void execute('where rsi < 30')}
          >
            {t('presetOversold')}
          </button>
          <button 
            type="button" 
            className="secondary-button"
            onClick={() => void execute('where rsi > 70')}
          >
            {t('presetOverbought')}
          </button>
          <button 
            type="button" 
            className="secondary-button"
            onClick={() => void execute('where fk < 8 where pb < 1.5')}
          >
            {t('presetDeepValue')}
          </button>
          <button 
            type="button" 
            className="secondary-button"
            onClick={() => void execute('where sales_growth > 15 where profit_growth > 15')}
          >
            {t('presetGrowth')}
          </button>
          <button 
            type="button" 
            className="secondary-button"
            onClick={() => void execute('where roe > 15 where net_margin > 10')}
          >
            {t('presetQuality')}
          </button>
          <button 
            type="button" 
            className="secondary-button"
            onClick={() => void execute('where macd > 0 where ema20 > sma50')}
          >
            {t('presetMomentum')}
          </button>
          <button 
            type="button" 
            className="secondary-button"
            onClick={() => void execute('where dividend_yield > 5')}
          >
            {t('presetDividend')}
          </button>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <div style={{ 
            flex: 1, 
            display: 'flex', 
            alignItems: 'center', 
            background: 'var(--bg-main)', 
            border: '1px solid var(--border-color)', 
            borderRadius: '6px',
            padding: '0 12px'
          }}>
            <span style={{ color: 'var(--accent-primary)', marginRight: '8px', fontFamily: 'var(--font-mono)', fontWeight: 'bold' }}>&gt;</span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('queryPlaceholder')}
              spellCheck={false}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.9rem',
                width: '100%',
                padding: '12px 0',
                outline: 'none'
              }}
            />
          </div>
          <button 
            type="button" 
            className="primary-button" 
            onClick={() => void execute()}
            style={{ padding: '0 24px' }}
          >
            {t('runQuery')}
          </button>
        </div>
      </section>

      {hasSearched && (
        <section className="panel" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ margin: 0 }}>{t('screenerResults')}</h2>
            {message && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{message}</span>}
          </div>

          {rows.length === 0 ? (
            <div className="empty-state" style={{ margin: '40px 0' }}>
              <div style={{ fontSize: '2rem', marginBottom: '16px', opacity: 0.5 }}>🔍</div>
              <p>{t('screenerEmpty')}</p>
            </div>
          ) : (
            <div style={{ overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>{t('ticker')}</th>
                    <th>{t('price')}</th>
                    <th>{t('change')}</th>
                    <th>{t('rsi')}</th>
                    <th>{t('macd')}</th>
                    <th>{t('pe')}</th>
                    <th>{t('roe')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const isZeroChange = row.change_pct === 0;
                    return (
                      <tr 
                        key={row.ticker} 
                        onClick={() => onSelectTicker?.(row.ticker)}
                        style={{ cursor: 'pointer' }}
                        className="clickable-row"
                      >
                        <td style={{ color: 'var(--accent-primary)', fontWeight: 'bold' }}>{row.ticker}</td>
                        <td>{row.price.toFixed(2)}</td>
                        <td className={isZeroChange ? 'neutral' : row.change_pct > 0 ? 'positive' : 'negative'} style={{ fontWeight: 'bold' }}>
                          {isZeroChange ? '—' : `${row.change_pct > 0 ? '+' : ''}${row.change_pct.toFixed(2)}%`}
                        </td>
                        <td>{row.rsi.toFixed(1)}</td>
                        <td>{row.macd.toFixed(2)}</td>
                        <td>{row.pe !== null ? row.pe.toFixed(1) : '—'}</td>
                        <td>{row.roe !== null ? `${row.roe.toFixed(1)}%` : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
