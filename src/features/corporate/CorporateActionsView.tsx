import { useEffect, useState } from 'react';
import { getCorporateEvents, getIpoCalendar } from '../../api/tauriClient';
import { useTranslation } from '../../api/i18n';
import type { CorporateEventsPayload, IpoCalendarPayload } from '../../types';

type ActiveTab = 'dividends' | 'capital' | 'ipo';

interface CorporateActionsViewProps {
  onSelectTicker?: (ticker: string) => void;
}

export default function CorporateActionsView({ onSelectTicker }: CorporateActionsViewProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ActiveTab>('dividends');
  const [filter, setFilter] = useState('');
  const [events, setEvents] = useState<CorporateEventsPayload | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [ipoData, setIpoData] = useState<IpoCalendarPayload | null>(null);
  const [ipoSubTab, setIpoSubTab] = useState<'tamamlanan' | 'taslak'>('tamamlanan');
  const [loading, setLoading] = useState(false);
  const [ipoRefreshing, setIpoRefreshing] = useState(false);

  const ipos = ipoData?.records ?? [];

  const normalizedFilter = filter.trim().toUpperCase();
  const filteredDividends = (events?.dividends ?? []).filter(
    (d) => !normalizedFilter || d.ticker.startsWith(normalizedFilter)
  );
  const filteredUpcoming = (events?.upcoming ?? []).filter(
    (u) => !normalizedFilter || u.ticker.startsWith(normalizedFilter)
  );
  const daysUntil = (iso: string) => {
    const diff = Math.round((new Date(iso).getTime() - Date.now()) / 86400000);
    return diff <= 0 ? t('today') : t('caDaysLeft', { n: diff });
  };
  const filteredSplits = (events?.splits ?? []).filter(
    (c) => !normalizedFilter || c.ticker.startsWith(normalizedFilter)
  );

  const loadEvents = async () => {
    setEventsLoading(true);
    try {
      setEvents(await getCorporateEvents());
    } catch (err) {
      console.error(err);
    } finally {
      setEventsLoading(false);
    }
  };

  const loadIpos = async (forceRefresh = false) => {
    if (forceRefresh) setIpoRefreshing(true);
    else setLoading(true);
    try {
      setIpoData(await getIpoCalendar(forceRefresh));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setIpoRefreshing(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'ipo') {
      loadIpos();
    } else if (events === null) {
      loadEvents();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const tabStyle = (tab: ActiveTab) => ({
    padding: '10px 20px',
    background: 'transparent',
    color: activeTab === tab ? '#58a6ff' : '#8b949e',
    border: 'none',
    borderBottom: activeTab === tab ? '2px solid #58a6ff' : '2px solid transparent',
    cursor: 'pointer',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.85rem',
    fontWeight: activeTab === tab ? 'bold' as const : 'normal' as const,
    transition: 'all 0.2s',
  });

  const thStyle: React.CSSProperties = {
    padding: '12px 18px', textAlign: 'left', borderBottom: '1px solid #30363d',
    color: '#8b949e', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase',
    letterSpacing: '0.5px', whiteSpace: 'nowrap',
  };

  const tdStyle: React.CSSProperties = {
    padding: '12px 18px', borderBottom: '1px solid #21262d',
    fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: '#c9d1d9',
  };

  return (
    <div style={{ padding: '20px', overflow: 'auto', flex: 1 }}>
      <h1 style={{ fontSize: '1.3rem', color: '#fff', marginBottom: '16px' }}>
        {t('corporateActions')}
      </h1>

      <div style={{ display: 'flex', borderBottom: '1px solid #30363d', marginBottom: '20px' }}>
        <button type="button" style={tabStyle('dividends')} onClick={() => setActiveTab('dividends')}>
          💰 {t('caDividends')}
        </button>
        <button type="button" style={tabStyle('capital')} onClick={() => setActiveTab('capital')}>
          📈 {t('caCapital')}
        </button>
        <button type="button" style={tabStyle('ipo')} onClick={() => setActiveTab('ipo')}>
          🏛️ {t('caIpo')}
        </button>
      </div>

      {/* Canlı filtre (temettü & sermaye sekmeleri) */}
      {activeTab !== 'ipo' && (
        <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', alignItems: 'center' }}>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('caFilterPh')}
            style={{
              flex: 1, maxWidth: '300px', padding: '10px 14px',
              background: '#0d1117', border: '1px solid #30363d', borderRadius: '6px',
              color: '#c9d1d9', fontFamily: 'var(--font-mono)', fontSize: '0.85rem',
            }}
          />
          {events?.last_updated && (
            <span style={{ color: '#8b949e', fontSize: '0.72rem', fontFamily: 'var(--font-mono)' }}>
              {t('lastUpdatedLabel')}: {events.last_updated}
            </span>
          )}
        </div>
      )}

      {loading && <div className="empty-state">{t('loadingData')}</div>}

      {/* Dividends Tab: piyasa geneli, en yeniden eskiye */}
      {activeTab === 'dividends' && (
        eventsLoading ? (
          <div className="empty-state">{t('loadingData')}</div>
        ) : events && !events.ready ? (
          <div className="empty-state" style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: '3rem', marginBottom: '16px' }}>⏳</div>
            <div style={{ color: '#8b949e', fontSize: '0.9rem', lineHeight: 1.7 }}>
              {t('caCollectingL1')}<br />
              {t('caCollectingL2')}
            </div>
          </div>
        ) : filteredDividends.length === 0 ? (
          <div className="empty-state">{normalizedFilter ? t('caNoDivFiltered', { f: normalizedFilter }) : t('caNoDividends')}</div>
        ) : (
          <>
          {filteredUpcoming.length > 0 && (
            <div className="panel" style={{ overflow: 'auto', marginBottom: '16px', border: '1px solid #23863655' }}>
              <div style={{ marginBottom: '10px', display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                <strong style={{ color: '#3fb950', fontSize: '0.9rem' }}>📅 {t('caUpcoming')}</strong>
                <span style={{ color: '#8b949e', fontSize: '0.72rem' }}>{t('caUpcomingSub', { n: filteredUpcoming.length })}</span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>{t('ticker')}</th>
                    <th style={thStyle}>{t('caExDate')}</th>
                    <th style={thStyle}>{t('caRemaining')}</th>
                    <th style={thStyle}>{t('caAnnualDividend')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUpcoming.map((u, i) => (
                    <tr key={i} style={{ transition: 'background 0.15s' }} onMouseEnter={(e) => (e.currentTarget.style.background = '#161b22')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                      <td style={{ ...tdStyle, fontWeight: 'bold' }}>
                        {onSelectTicker ? (
                          <button type="button" onClick={() => onSelectTicker(u.ticker)}
                            style={{ background: 'none', border: 'none', padding: 0, color: '#58a6ff', cursor: 'pointer', fontWeight: 'bold', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', textDecoration: 'underline', textUnderlineOffset: '3px' }}>
                            {u.ticker}
                          </button>
                        ) : u.ticker}
                      </td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                        {u.ex_date}
                        {u.installment >= 2 && (
                          <span style={{ marginLeft: '8px', padding: '2px 8px', borderRadius: '10px', fontSize: '0.65rem', fontWeight: 'bold', background: '#58a6ff22', color: '#58a6ff' }}>
                            {t('installmentN', { n: u.installment })}
                          </span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <span style={{ padding: '2px 10px', borderRadius: '10px', fontSize: '0.7rem', fontWeight: 'bold', background: '#23863622', color: '#3fb950' }}>
                          {daysUntil(u.ex_date)}
                        </span>
                      </td>
                      <td style={tdStyle}>{u.annual_rate ? `₺${u.annual_rate.toFixed(2)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="panel" style={{ overflow: 'auto' }}>
            <div style={{ marginBottom: '10px', color: '#8b949e', fontSize: '0.78rem' }}>
              {t('caLast24', { n: filteredDividends.length })}{filteredDividends.length > 200 ? t('caTruncated') : ''}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t('ticker')}</th>
                  <th style={thStyle}>{t('caExDate')}</th>
                  <th style={thStyle}>{t('caPerShareTl')}</th>
                  <th style={thStyle}>{t('caYieldPct')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredDividends.slice(0, 200).map((d, i) => (
                  <tr key={i} style={{ transition: 'background 0.15s' }} onMouseEnter={(e) => (e.currentTarget.style.background = '#161b22')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ ...tdStyle, fontWeight: 'bold' }}>
                      {onSelectTicker ? (
                        <button type="button" onClick={() => onSelectTicker(d.ticker)}
                          style={{ background: 'none', border: 'none', padding: 0, color: '#58a6ff', cursor: 'pointer', fontWeight: 'bold', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', textDecoration: 'underline', textUnderlineOffset: '3px' }}>
                          {d.ticker}
                        </button>
                      ) : d.ticker}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      {d.ex_date}
                      {d.installment >= 2 && (
                          <span style={{ marginLeft: '8px', padding: '2px 8px', borderRadius: '10px', fontSize: '0.65rem', fontWeight: 'bold', background: '#58a6ff22', color: '#58a6ff' }}>
                            {t('installmentN', { n: d.installment })}
                          </span>
                        )}
                    </td>
                    <td style={{ ...tdStyle, color: '#3fb950', fontWeight: 'bold' }}>{d.amount_per_share.toFixed(4)}</td>
                    <td style={tdStyle}>{d.yield_pct > 0 ? `%${d.yield_pct.toFixed(2)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )
      )}

      {/* Capital Increases Tab: piyasa geneli, en yeniden eskiye */}
      {activeTab === 'capital' && (
        eventsLoading ? (
          <div className="empty-state">{t('loadingData')}</div>
        ) : events && !events.ready ? (
          <div className="empty-state" style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: '3rem', marginBottom: '16px' }}>⏳</div>
            <div style={{ color: '#8b949e', fontSize: '0.9rem', lineHeight: 1.7 }}>
              {t('caCollectingL1')}<br />
              {t('caCollectingL2')}
            </div>
          </div>
        ) : filteredSplits.length === 0 ? (
          <div className="empty-state">{normalizedFilter ? t('caNoSplitFiltered', { f: normalizedFilter }) : t('caNoSplits')}</div>
        ) : (
          <div className="panel" style={{ overflow: 'auto' }}>
            <div style={{ marginBottom: '10px', color: '#8b949e', fontSize: '0.78rem' }}>
              {t('caLast5y', { n: filteredSplits.length })}{filteredSplits.length > 200 ? t('caTruncated') : ''}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t('ticker')}</th>
                  <th style={thStyle}>{t('dateLabel')}</th>
                  <th style={thStyle}>{t('typeLabel')}</th>
                  <th style={thStyle}>{t('ratioLabel')}</th>
                  <th style={thStyle}>{t('caSource')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredSplits.slice(0, 200).map((c, i) => {
                  const typeColor = c.increase_type === 'BEDELSİZ' ? '#3fb950' : c.increase_type === 'BİRLEŞTİRME' ? '#f0883e' : '#58a6ff';
                  return (
                    <tr key={i} style={{ transition: 'background 0.15s' }} onMouseEnter={(e) => (e.currentTarget.style.background = '#161b22')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                      <td style={{ ...tdStyle, fontWeight: 'bold' }}>
                        {onSelectTicker ? (
                          <button type="button" onClick={() => onSelectTicker(c.ticker)}
                            style={{ background: 'none', border: 'none', padding: 0, color: '#58a6ff', cursor: 'pointer', fontWeight: 'bold', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', textDecoration: 'underline', textUnderlineOffset: '3px' }}>
                            {c.ticker}
                          </button>
                        ) : c.ticker}
                      </td>
                      <td style={tdStyle}>{c.date}</td>
                      <td style={tdStyle}>
                        <span style={{
                          padding: '3px 10px', borderRadius: '12px', fontSize: '0.72rem',
                          fontWeight: 'bold', background: `${typeColor}22`, color: typeColor, border: `1px solid ${typeColor}44`,
                        }}>
                          {c.increase_type}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 'bold' }}>{c.ratio}</td>
                      <td style={{ ...tdStyle, color: '#8b949e' }}>{c.source}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ marginTop: '10px', fontSize: '0.7rem', color: '#8b949e' }}>
              {t('caSplitSourceNote')}
            </div>
          </div>
        )
      )}

      {/* IPO Tab */}
      {activeTab === 'ipo' && !loading && (
        ipos.length === 0 ? (
          <div className="empty-state">{t('caNoIpo')}</div>
        ) : (
          <div className="panel" style={{ overflow: 'auto' }}>
            {ipoData && !ipoData.scrape_ok && (
              <div style={{
                marginBottom: '12px', padding: '8px 14px', borderRadius: '6px',
                background: '#f0883e22', border: '1px solid #f0883e55', color: '#f0883e',
                fontSize: '0.78rem', fontFamily: 'var(--font-mono)',
              }}>
                {t('caIpoStale')}
              </div>
            )}
            <div style={{ display: 'flex', gap: '15px', marginBottom: '15px', alignItems: 'center' }}>
              <button
                onClick={() => setIpoSubTab('tamamlanan')}
                style={{
                  ...tabStyle('ipo'),
                  padding: '6px 12px',
                  borderBottom: ipoSubTab === 'tamamlanan' ? '2px solid #58a6ff' : '2px solid transparent',
                  color: ipoSubTab === 'tamamlanan' ? '#58a6ff' : '#8b949e',
                }}
              >
                {t('caIpoDone')}
              </button>
              <button
                onClick={() => setIpoSubTab('taslak')}
                style={{
                  ...tabStyle('ipo'),
                  padding: '6px 12px',
                  borderBottom: ipoSubTab === 'taslak' ? '2px solid #58a6ff' : '2px solid transparent',
                  color: ipoSubTab === 'taslak' ? '#58a6ff' : '#8b949e',
                }}
              >
                {t('caIpoDraft')}
              </button>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', alignItems: 'center' }}>
                {ipoData?.last_updated && (
                  <span style={{ color: '#8b949e', fontSize: '0.72rem', fontFamily: 'var(--font-mono)' }}>
                    {t('lastUpdatedLabel')}: {ipoData.last_updated}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => loadIpos(true)}
                  disabled={ipoRefreshing}
                  style={{
                    padding: '6px 14px', background: ipoRefreshing ? '#30363d' : '#238636',
                    color: '#fff', border: 'none', borderRadius: '6px',
                    cursor: ipoRefreshing ? 'default' : 'pointer',
                    fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 'bold',
                  }}
                >
                  {ipoRefreshing ? t('caRefreshing') : `⟳ ${t('kapRefresh')}`}
                </button>
              </div>
            </div>
            <div style={{ marginBottom: '12px', color: '#8b949e', fontSize: '0.8rem' }}>
              {t('caIpoCount', { n: ipos.filter(i => ipoSubTab === 'taslak' ? i.status === 'TASLAK' : i.status !== 'TASLAK').length })}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t('ticker')}</th>
                  <th style={thStyle}>{t('caCompany')}</th>
                  <th style={thStyle}>{t('caBookBuilding')}</th>
                  <th style={thStyle}>{t('caTradingStart')}</th>
                  <th style={thStyle}>{t('caDistribution')}</th>
                  <th style={thStyle}>{t('caParticipants')}</th>
                  <th style={thStyle}>{t('caIpoPrice')}</th>
                  <th style={thStyle}>{t('caCurrent')}</th>
                  <th style={{ ...thStyle }} title={t('caReturnTip')}>{t('caReturn')} ⓘ</th>
                  <th style={thStyle}>{t('caStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {ipos.filter(i => ipoSubTab === 'taslak' ? i.status === 'TASLAK' : i.status !== 'TASLAK').map((ipo, i) => {
                  const retColor = (ipo.return_pct ?? 0) >= 0 ? '#3fb950' : '#f85149';
                  return (
                    <tr key={i} style={{ transition: 'background 0.15s' }} onMouseEnter={(e) => (e.currentTarget.style.background = '#161b22')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                      <td style={{ ...tdStyle, fontWeight: 'bold' }}>
                        {ipo.status === 'TASLAK' || !onSelectTicker ? (
                          <span style={{ color: '#c9d1d9' }}>{ipo.ticker}</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onSelectTicker(ipo.ticker)}
                            title={t('caOpenProfile', { ticker: ipo.ticker })}
                            style={{
                              background: 'none', border: 'none', padding: 0,
                              color: '#58a6ff', cursor: 'pointer', fontWeight: 'bold',
                              fontFamily: 'var(--font-mono)', fontSize: '0.82rem',
                              textDecoration: 'underline', textUnderlineOffset: '3px',
                            }}
                          >
                            {ipo.ticker}
                          </button>
                        )}
                      </td>
                      <td style={{ ...tdStyle, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ipo.company_name}>{ipo.company_name}</td>
                      <td style={{ ...tdStyle, fontSize: '0.75rem', color: '#8b949e', whiteSpace: 'nowrap' }}>{ipo.book_building_dates || '—'}</td>
                      <td style={{ ...tdStyle, fontSize: '0.75rem', color: '#8b949e', whiteSpace: 'nowrap' }}>{ipo.trading_start_date || '—'}</td>
                      <td style={{ ...tdStyle, fontSize: '0.75rem', color: '#8b949e', whiteSpace: 'nowrap' }}>{ipo.distribution_type || '—'}</td>
                      <td style={{ ...tdStyle, fontSize: '0.75rem', color: '#8b949e', whiteSpace: 'nowrap' }}>{ipo.participant_count || '—'}</td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>₺{ipo.price.toFixed(2)}</td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{ipo.current_price ? `₺${ipo.current_price.toFixed(2)}` : '—'}</td>
                      <td style={{ ...tdStyle, color: retColor, fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                        {ipo.return_pct !== null ? `${ipo.return_pct >= 0 ? '+' : ''}${ipo.return_pct.toFixed(2)}%` : '—'}
                        {(ipo.split_factor ?? 1) > 1 && (
                          <span title={t('caSplitAdj', { f: ipo.split_factor!.toFixed(2) })}
                            style={{ marginLeft: '5px', fontSize: '0.65rem', color: '#8b949e', fontWeight: 'normal' }}>
                            ×{ipo.split_factor!.toFixed(1)}
                          </span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <span style={{
                          padding: '3px 10px', borderRadius: '12px', fontSize: '0.72rem', fontWeight: 'bold',
                          background: ipo.status === 'TAMAMLANDI' ? '#30363d' : ipo.status === 'AKTİF' || ipo.status === 'TALEP TOPLAMA' ? '#23863622' : '#58a6ff22',
                          color: ipo.status === 'TAMAMLANDI' ? '#8b949e' : ipo.status === 'AKTİF' || ipo.status === 'TALEP TOPLAMA' ? '#3fb950' : '#58a6ff',
                        }}>
                          {ipo.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
