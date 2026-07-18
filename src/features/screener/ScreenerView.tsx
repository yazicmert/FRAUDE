import { useEffect, useState } from 'react';
import { runScreener } from '../../api/tauriClient';
import { useTranslation } from '../../api/i18n';
import type { EquityRow } from '../../types';
import {
  type ScreenerPreset,
  loadScreenerPresets,
  addScreenerPreset,
  removeScreenerPreset,
  SCREENER_PRESETS_EVENT,
} from '../../lib/screenerPresets';

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
  const [presets, setPresets] = useState<ScreenerPreset[]>(() => loadScreenerPresets());
  const [presetName, setPresetName] = useState('');

  useEffect(() => {
    const onUpdate = (e: Event) => setPresets((e as CustomEvent<ScreenerPreset[]>).detail);
    window.addEventListener(SCREENER_PRESETS_EVENT, onUpdate);
    return () => window.removeEventListener(SCREENER_PRESETS_EVENT, onUpdate);
  }, []);

  const savePreset = () => {
    const name = presetName.trim();
    if (!name || !query.trim()) return;
    setPresets(addScreenerPreset({ name, query: query.trim() }));
    setPresetName('');
  };

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
          {/* "Büyüme" ve "Kalite (marj)" presetleri kaldırıldı: satış/kâr
              büyümesi ve marj alanları evren düzeyinde hiçbir kaynaktan
              dolmuyor (İş Yatırım screener yalnız tahmin verir), bu filtreler
              her zaman boş sonuç üretiyordu. Yerine gerçek veriyle çalışan
              Değer taraması kondu (F/K + ROE İş Yatırım Cari'den gelir). */}
          <button
            type="button"
            className="secondary-button"
            onClick={() => void execute('where fk < 10 where roe > 20')}
          >
            {t('presetValue')}
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

        {/* Kullanıcının kaydettiği preset'ler + kaydetme */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>Kayıtlı:</span>
          {presets.length === 0 && (
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', opacity: 0.7 }}>henüz yok</span>
          )}
          {presets.map((p) => (
            <span key={p.name} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '2px 4px 2px 10px' }}>
              <button type="button" onClick={() => void execute(p.query)} title={p.query} style={{ background: 'transparent', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold' }}>{p.name}</button>
              <button type="button" onClick={() => setPresets(removeScreenerPreset(p.name))} title="Sil" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.75rem' }}>✕</button>
            </span>
          ))}
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
            <input
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') savePreset(); }}
              placeholder="Preset adı"
              style={{ background: 'var(--bg-main)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: '6px', padding: '5px 8px', fontSize: '0.8rem', width: '120px' }}
            />
            <button type="button" className="secondary-button" onClick={savePreset} disabled={!presetName.trim() || !query.trim()}>💾 Kaydet</button>
          </span>
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
