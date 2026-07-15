import { useEffect, useState } from 'react';
import { getCorporateEvents, getIpoCalendar } from '../../api/tauriClient';
import type { CorporateEventsPayload, IpoCalendarPayload } from '../../types';

type ActiveTab = 'dividends' | 'capital' | 'ipo';

interface CorporateActionsViewProps {
  onSelectTicker?: (ticker: string) => void;
}

export default function CorporateActionsView({ onSelectTicker }: CorporateActionsViewProps) {
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
    return diff <= 0 ? 'Bugün' : `${diff} gün`;
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
        Kurumsal Aksiyonlar
      </h1>

      <div style={{ display: 'flex', borderBottom: '1px solid #30363d', marginBottom: '20px' }}>
        <button type="button" style={tabStyle('dividends')} onClick={() => setActiveTab('dividends')}>
          💰 Temettü
        </button>
        <button type="button" style={tabStyle('capital')} onClick={() => setActiveTab('capital')}>
          📈 Sermaye Artırımı
        </button>
        <button type="button" style={tabStyle('ipo')} onClick={() => setActiveTab('ipo')}>
          🏛️ Halka Arz
        </button>
      </div>

      {/* Canlı filtre (temettü & sermaye sekmeleri) */}
      {activeTab !== 'ipo' && (
        <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', alignItems: 'center' }}>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrele (ör: THYAO)"
            style={{
              flex: 1, maxWidth: '300px', padding: '10px 14px',
              background: '#0d1117', border: '1px solid #30363d', borderRadius: '6px',
              color: '#c9d1d9', fontFamily: 'var(--font-mono)', fontSize: '0.85rem',
            }}
          />
          {events?.last_updated && (
            <span style={{ color: '#8b949e', fontSize: '0.72rem', fontFamily: 'var(--font-mono)' }}>
              Son güncelleme: {events.last_updated}
            </span>
          )}
        </div>
      )}

      {loading && <div className="empty-state">Yükleniyor...</div>}

      {/* Dividends Tab: piyasa geneli, en yeniden eskiye */}
      {activeTab === 'dividends' && (
        eventsLoading ? (
          <div className="empty-state">Yükleniyor...</div>
        ) : events && !events.ready ? (
          <div className="empty-state" style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: '3rem', marginBottom: '16px' }}>⏳</div>
            <div style={{ color: '#8b949e', fontSize: '0.9rem', lineHeight: 1.7 }}>
              Piyasa geneli veriler arka planda toplanıyor (~600 hisse, birkaç dakika sürebilir).<br />
              Uygulama açık kaldıkça otomatik tamamlanır; sekmeye tekrar girerek kontrol edebilirsiniz.
            </div>
          </div>
        ) : filteredDividends.length === 0 ? (
          <div className="empty-state">{normalizedFilter ? `${normalizedFilter} için son 24 ayda temettü kaydı yok.` : 'Temettü verisi bulunamadı.'}</div>
        ) : (
          <>
          {filteredUpcoming.length > 0 && (
            <div className="panel" style={{ overflow: 'auto', marginBottom: '16px', border: '1px solid #23863655' }}>
              <div style={{ marginBottom: '10px', display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                <strong style={{ color: '#3fb950', fontSize: '0.9rem' }}>📅 Yaklaşan Temettüler</strong>
                <span style={{ color: '#8b949e', fontSize: '0.72rem' }}>açıklanmış hak düşüm tarihleri · {filteredUpcoming.length} şirket</span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Hisse</th>
                    <th style={thStyle}>Hak Düşüm Tarihi</th>
                    <th style={thStyle}>Kalan</th>
                    <th style={thStyle}>Yıllık Temettü (tahmini)</th>
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
                            {u.installment}. Taksit
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
              Son 24 ayın temettüleri · {filteredDividends.length} kayıt{filteredDividends.length > 200 ? ' (ilk 200 gösteriliyor — daraltmak için filtreleyin)' : ''}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Hisse</th>
                  <th style={thStyle}>Hak Düşüm Tarihi</th>
                  <th style={thStyle}>Hisse Başı (TL)</th>
                  <th style={thStyle}>Verim (%)</th>
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
                            {d.installment}. Taksit
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
          <div className="empty-state">Yükleniyor...</div>
        ) : events && !events.ready ? (
          <div className="empty-state" style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: '3rem', marginBottom: '16px' }}>⏳</div>
            <div style={{ color: '#8b949e', fontSize: '0.9rem', lineHeight: 1.7 }}>
              Piyasa geneli veriler arka planda toplanıyor (~600 hisse, birkaç dakika sürebilir).<br />
              Uygulama açık kaldıkça otomatik tamamlanır; sekmeye tekrar girerek kontrol edebilirsiniz.
            </div>
          </div>
        ) : filteredSplits.length === 0 ? (
          <div className="empty-state">{normalizedFilter ? `${normalizedFilter} için son 5 yılda bölünme kaydı yok.` : 'Bölünme verisi bulunamadı.'}</div>
        ) : (
          <div className="panel" style={{ overflow: 'auto' }}>
            <div style={{ marginBottom: '10px', color: '#8b949e', fontSize: '0.78rem' }}>
              Son 5 yılın bedelsiz / birleştirme olayları · {filteredSplits.length} kayıt{filteredSplits.length > 200 ? ' (ilk 200 gösteriliyor — daraltmak için filtreleyin)' : ''}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Hisse</th>
                  <th style={thStyle}>Tarih</th>
                  <th style={thStyle}>Tür</th>
                  <th style={thStyle}>Oran</th>
                  <th style={thStyle}>Kaynak</th>
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
              Kaynak: Yahoo Finance bölünme olayları. Bedelsiz artırımlar ve birleştirmeler (ters bölünme)
              listelenir; bedelli (rüçhanlı) artırımlar bu kaynakta yer almaz — bedelli duyuruları için
              hisse profilindeki KAP Bildirimleri bölümüne bakın.
            </div>
          </div>
        )
      )}

      {/* IPO Tab */}
      {activeTab === 'ipo' && !loading && (
        ipos.length === 0 ? (
          <div className="empty-state">Halka arz verisi bulunamadı. İnternet bağlantınızı kontrol edip Yenile deneyin.</div>
        ) : (
          <div className="panel" style={{ overflow: 'auto' }}>
            {ipoData && !ipoData.scrape_ok && (
              <div style={{
                marginBottom: '12px', padding: '8px 14px', borderRadius: '6px',
                background: '#f0883e22', border: '1px solid #f0883e55', color: '#f0883e',
                fontSize: '0.78rem', fontFamily: 'var(--font-mono)',
              }}>
                ⚠ Canlı halka arz verisi alınamadı — yerel arşivden gösteriliyor. Yenile ile tekrar deneyebilirsiniz.
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
                Tamamlanan / Aktif
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
                Taslak Halka Arzlar
              </button>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', alignItems: 'center' }}>
                {ipoData?.last_updated && (
                  <span style={{ color: '#8b949e', fontSize: '0.72rem', fontFamily: 'var(--font-mono)' }}>
                    Son güncelleme: {ipoData.last_updated}
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
                  {ipoRefreshing ? 'Yenileniyor...' : '⟳ Yenile'}
                </button>
              </div>
            </div>
            <div style={{ marginBottom: '12px', color: '#8b949e', fontSize: '0.8rem' }}>
              Toplam {ipos.filter(i => ipoSubTab === 'taslak' ? i.status === 'TASLAK' : i.status !== 'TASLAK').length} halka arz listeleniyor
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Hisse</th>
                  <th style={thStyle}>Şirket</th>
                  <th style={thStyle}>Talep Toplama</th>
                  <th style={thStyle}>İşleme Başlama</th>
                  <th style={thStyle}>Dağıtım Türü</th>
                  <th style={thStyle}>Katılımcı</th>
                  <th style={thStyle}>Arz Fiyatı</th>
                  <th style={thStyle}>Güncel</th>
                  <th style={{ ...thStyle }} title="Arz sonrası bedelsiz/bölünme düzeltmesi uygulanır">Getiri (%) ⓘ</th>
                  <th style={thStyle}>Durum</th>
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
                            title={`${ipo.ticker} hisse profilini aç`}
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
                          <span title={`Bedelsiz/bölünme düzeltmesi: ×${ipo.split_factor!.toFixed(2)}`}
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
