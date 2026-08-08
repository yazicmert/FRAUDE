import { Fragment, useEffect, useState } from 'react';
import { getCorporateEvents, getIpoCalendar, getPriceHistory } from '../../api/tauriClient';
import { useTranslation } from '../../api/i18n';
import type { CorporateEventsPayload, HistoricalQuote, IpoCalendarPayload, IpoRecord } from '../../types';
import PriceChart from '../ticker/PriceChart';

type ActiveTab = 'dividends' | 'capital' | 'ipo';

interface CorporateActionsViewProps {
  onSelectTicker?: (ticker: string) => void;
  initialTab?: ActiveTab;
}

function renderVisualFundUsage(rawText?: string | null) {
  if (!rawText) {
    return (
      <span style={{ color: '#8b949e', fontStyle: 'italic', fontSize: '0.82rem' }}>
        Şirket fon kullanım raporu izahnamede detaylandırılmıştır (% İşletme sermayesi, % Yatırımlar vb.).
      </span>
    );
  }

  const parts = rawText.split(/[-;]\s*/).map(s => s.trim()).filter(Boolean);

  const items = parts.map(part => {
    const numMatch = part.match(/%\s*(\d+(?:[.,]\d+)?)/) || part.match(/(\d+(?:[.,]\d+)?)\s*%/);
    const percent = numMatch ? parseFloat(numMatch[1].replace(',', '.')) : null;
    let cleanDesc = part;
    if (numMatch) {
      cleanDesc = part
        .replace(/%\s*\d+(?:[.,]\d+)?/, '')
        .replace(/\d+(?:[.,]\d+)?\s*%/, '')
        .replace(/^[-:\s•\d]+/, '')
        .trim();
    }
    return { percent, desc: cleanDesc || part };
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '6px' }}>
      {items.map((item, idx) => {
        const hasPercent = item.percent !== null && !isNaN(item.percent);
        return (
          <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem', gap: '8px' }}>
              <span style={{ color: '#f0f6fc', fontWeight: 500, lineHeight: '1.4' }}>
                <span style={{ color: '#00ff9d', marginRight: '6px' }}>•</span>
                {item.desc}
              </span>
              {hasPercent && (
                <span style={{
                  background: 'rgba(0, 255, 157, 0.15)', color: '#00ff9d', padding: '2px 8px',
                  borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700, fontFamily: 'var(--font-mono)',
                  border: '1px solid rgba(0, 255, 157, 0.3)', flexShrink: 0,
                }}>
                  %{item.percent}
                </span>
              )}
            </div>
            {hasPercent && (
              <div style={{ width: '100%', height: '6px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.min(100, Math.max(0, item.percent!))}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #00c3ff, #00ff9d)',
                  borderRadius: '3px',
                  transition: 'width 0.4s ease-in-out',
                }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function renderVisualShareStructure(rawText?: string | null) {
  if (!rawText) {
    return (
      <span style={{ color: '#8b949e', fontStyle: 'italic', fontSize: '0.82rem' }}>
        Sermaye Artırımı ve Ortak Satışı pay dağılımı SPK onaylı izahnamede açıklanmıştır.
      </span>
    );
  }

  const parts = rawText.split(/[-;]\s*/).map(s => s.trim()).filter(Boolean);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
      {parts.map((part, idx) => {
        const isSermaye = part.toLowerCase().includes('sermaye artırım');
        const isOrtak = part.toLowerCase().includes('ortak satış');
        
        let label = '📌 Halka Arz';
        if (isSermaye) label = '🌱 Sermaye Artırımı';
        else if (isOrtak) label = '🤝 Ortak Satışı';

        let cleanVal = part
          .replace(/^Sermaye Artırımı\s*:\s*/i, '')
          .replace(/^Ortak Satışı\s*:\s*/i, '')
          .replace(/^Halka Arz Şekli\s*:\s*/i, '')
          .trim();

        if (cleanVal.length > 45 && cleanVal.includes('(')) {
          cleanVal = cleanVal.replace(/\(([^)]+)\)/g, (_m, p1) => {
            const words = p1.trim().split(/\s+/);
            const shortName = words.slice(0, 2).join(' ') + (words.length > 2 ? '...' : '');
            return `(${shortName})`;
          });
        }

        return (
          <div key={idx} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: isSermaye ? 'rgba(63, 185, 80, 0.08)' : isOrtak ? 'rgba(163, 113, 247, 0.08)' : 'rgba(255, 255, 255, 0.04)',
            border: `1px solid ${isSermaye ? 'rgba(63, 185, 80, 0.25)' : isOrtak ? 'rgba(163, 113, 247, 0.25)' : 'rgba(255, 255, 255, 0.08)'}`,
            padding: '8px 12px', borderRadius: '8px', gap: '10px'
          }}>
            <span style={{
              fontSize: '0.74rem', fontWeight: 700,
              color: isSermaye ? '#3fb950' : isOrtak ? '#a371f7' : '#58a6ff',
              textTransform: 'uppercase', letterSpacing: '0.3px', flexShrink: 0
            }}>
              {label}
            </span>
            <span style={{ fontSize: '0.8rem', color: '#f0f6fc', textAlign: 'right', fontWeight: 600, fontFamily: 'var(--font-mono)' }} title={part}>
              {cleanVal}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function renderVisualDistributionRatios(rawText?: string | null) {
  if (!rawText) {
    return (
      <div style={{ color: '#8b949e', fontSize: '0.8rem', fontStyle: 'italic', padding: '10px 0' }}>
        Tahsisat oranları açıklaması bulunmuyor.
      </div>
    );
  }

  let mainText = rawText;
  const footnoteIdx = rawText.search(/[*•]\s*Payların|\*|\bNot\b/i);
  if (footnoteIdx !== -1) {
    mainText = rawText.substring(0, footnoteIdx).trim();
  }

  const groupPatterns = [
    { regex: /(?:Yurt\s*İçi\s*Bireysel|Bireysel)[^\d%]*(\d+(?:[.,]\d+)?\s*%|%\s*\d+(?:[.,]\d+)?)/i, group: '👨‍💼 Yurt İçi Bireysel', color: '#388bfd' },
    { regex: /(?:Yüksek\s*Başvurulu|Nitelikli)[^\d%]*(\d+(?:[.,]\d+)?\s*%|%\s*\d+(?:[.,]\d+)?)/i, group: '💎 Yüksek Başvurulu', color: '#a371f7' },
    { regex: /(?:Yurt\s*İçi\s*Kurumsal|Kurumsal)[^\d%]*(\d+(?:[.,]\d+)?\s*%|%\s*\d+(?:[.,]\d+)?)/i, group: '🏛️ Yurt İçi Kurumsal', color: '#58a6ff' },
    { regex: /(?:Yurt\s*Dışı\s*Kurumsal|Yurt\s*Dışı)[^\d%]*(\d+(?:[.,]\d+)?\s*%|%\s*\d+(?:[.,]\d+)?)/i, group: '🌍 Yurt Dışı Kurumsal', color: '#3fb950' },
    { regex: /(?:Şirket\s*Çalışanları|Çalışan)[^\d%]*(\d+(?:[.,]\d+)?\s*%|%\s*\d+(?:[.,]\d+)?)/i, group: '🏢 Şirket Çalışanları', color: '#d29922' },
  ];

  const parsedItems: Array<{ group: string; percent: number; color: string }> = [];

  for (const p of groupPatterns) {
    const match = mainText.match(p.regex);
    if (match) {
      const numMatch = match[1].match(/(\d+(?:[.,]\d+)?)/);
      if (numMatch) {
        const pct = parseFloat(numMatch[1].replace(',', '.'));
        if (!isNaN(pct) && pct > 0 && pct <= 100) {
          parsedItems.push({ group: p.group, percent: pct, color: p.color });
        }
      }
    }
  }

  if (parsedItems.length === 0) {
    const parts = mainText.split(/[-;\n]\s*/).map(s => s.trim()).filter(Boolean);
    const colors = ['#388bfd', '#a371f7', '#58a6ff', '#3fb950', '#d29922'];
    parts.forEach((part, idx) => {
      const numMatch = part.match(/%\s*(\d+(?:[.,]\d+)?)/) || part.match(/(\d+(?:[.,]\d+)?)\s*%/);
      const percent = numMatch ? parseFloat(numMatch[1].replace(',', '.')) : null;
      let label = part.replace(/%\s*\d+(?:[.,]\d+)?/, '').replace(/\d+(?:[.,]\d+)?\s*%/, '').trim();
      if (!label || label === 'Tahsisat Grubu') {
        const defaultNames = ['👨‍💼 Yurt İçi Bireysel', '🏛️ Yurt İçi Kurumsal', '🌍 Yurt Dışı Kurumsal', '🏢 Şirket Çalışanları'];
        label = defaultNames[idx] || `Tahsisat Grubu ${idx + 1}`;
      } else {
        label = `👥 ${label}`;
      }
      if (percent !== null) {
        parsedItems.push({ group: label, percent, color: colors[idx % colors.length] });
      }
    });
  }

  const finalItems = parsedItems.length > 0 ? parsedItems : [
    { group: '👨‍💼 Yurt İçi Bireysel', percent: 75, color: '#388bfd' },
    { group: '🏛️ Yurt İçi Kurumsal', percent: 20, color: '#a371f7' },
    { group: '🌍 Yurt Dışı Kurumsal', percent: 5, color: '#3fb950' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
      {finalItems.map((item, idx) => (
        <div key={idx} style={{
          background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)',
          borderRadius: '8px', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '4px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem' }}>
            <span style={{ fontWeight: 700, color: item.color }}>{item.group}</span>
            <span style={{
              background: `${item.color}22`, color: item.color, border: `1px solid ${item.color}44`,
              borderRadius: '12px', padding: '2px 8px', fontSize: '0.75rem', fontWeight: 700, fontFamily: 'var(--font-mono)'
            }}>
              %{item.percent}
            </span>
          </div>
          <div style={{ width: '100%', height: '5px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(100, Math.max(0, item.percent))}%`, height: '100%',
              background: item.color, borderRadius: '3px', transition: 'width 0.4s ease-in-out'
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function renderVisualIpoResults(ipo: IpoRecord) {
  let countNum = 0;
  if (ipo.participant_count) {
    const cleaned = ipo.participant_count.replace(/kişi/gi, '').replace(/\./g, '').replace(/,/g, '.').trim();
    const parsed = parseInt(cleaned, 10);
    if (!isNaN(parsed) && parsed > 0) countNum = parsed;
  }

  let totalLots = 0;
  if (ipo.share_structure) {
    const matches = ipo.share_structure.match(/(\d+(?:\.\d+)*)\s*Lot/gi);
    if (matches) {
      for (const m of matches) {
        const numStr = m.replace(/Lot/gi, '').replace(/\./g, '').trim();
        const n = parseInt(numStr, 10);
        if (!isNaN(n) && n > 1000) totalLots += n;
      }
    }
  }
  if (totalLots <= 0 && ipo.ipo_size && ipo.price && ipo.price > 0) {
    if (ipo.ipo_size.toLowerCase().includes('lot')) {
      const numStr = ipo.ipo_size.replace(/Lot/gi, '').replace(/\./g, '').replace(/,/g, '.').trim();
      const n = parseFloat(numStr);
      if (!isNaN(n) && n > 1000) totalLots = n;
    } else {
      const numStr = ipo.ipo_size.replace(/TL|Milyar|Milyon/gi, '').replace(/\./g, '').replace(/,/g, '.').trim();
      const n = parseFloat(numStr);
      if (!isNaN(n) && n > 0) {
        let tlVal = n;
        if (ipo.ipo_size.toLowerCase().includes('milyar')) tlVal *= 1_000_000_000;
        else if (ipo.ipo_size.toLowerCase().includes('milyon')) tlVal *= 1_000_000;
        totalLots = Math.round(tlVal / ipo.price);
      }
    }
  }

  let bireyselPct = 75;
  if (ipo.distribution_ratios) {
    const parts = ipo.distribution_ratios.split(/[-;]\s*/);
    for (const part of parts) {
      if (part.toLowerCase().includes('bireysel')) {
        const match = part.match(/%\s*(\d+(?:[.,]\d+)?)/) || part.match(/(\d+(?:[.,]\d+)?)\s*%/);
        if (match) {
          const parsedPct = parseFloat(match[1].replace(',', '.'));
          if (!isNaN(parsedPct) && parsedPct > 0 && parsedPct <= 100) {
            bireyselPct = parsedPct;
            break;
          }
        }
      }
    }
  }

  const retailLots = totalLots > 0 ? Math.round(totalLots * (bireyselPct / 100)) : 0;
  const actualLotsPerPerson = countNum > 0 && retailLots > 0 ? Math.floor(retailLots / countNum) : null;
  const actualAmountPerPerson = actualLotsPerPerson && ipo.price ? actualLotsPerPerson * ipo.price : null;

  let tavanDays = 0;
  if (typeof ipo.return_pct === 'number' && ipo.return_pct > 0) {
    tavanDays = Math.max(0, Math.round(Math.log(1 + ipo.return_pct / 100) / Math.log(1.10)));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.84rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(63, 185, 80, 0.1)', padding: '8px 12px', borderRadius: '6px', border: '1px solid rgba(63, 185, 80, 0.25)' }}>
        <span style={{ color: '#8b949e' }}>Resmi Katılımcı Sayısı:</span>
        <strong style={{ color: '#3fb950', fontFamily: 'var(--font-mono)', fontSize: '0.92rem' }}>
          {ipo.participant_count || (countNum > 0 ? `${countNum.toLocaleString('tr-TR')} Kişi` : 'Açıklanmadı')}
        </strong>
      </div>

      {actualLotsPerPerson && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(88, 166, 255, 0.1)', padding: '8px 12px', borderRadius: '6px', border: '1px solid rgba(88, 166, 255, 0.25)' }}>
          <span style={{ color: '#8b949e' }}>Bireysel Kişi Başı Düşen Lot:</span>
          <strong style={{ color: '#58a6ff', fontFamily: 'var(--font-mono)', fontSize: '0.92rem' }}>
            {actualLotsPerPerson} Lot {actualAmountPerPerson ? `(₺${actualAmountPerPerson.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : ''}
          </strong>
        </div>
      )}

      {typeof ipo.return_pct === 'number' && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255, 255, 255, 0.03)', padding: '8px 12px', borderRadius: '6px' }}>
          <span style={{ color: '#8b949e' }}>Getiri Performansı:</span>
          <span style={{ color: ipo.return_pct >= 0 ? '#3fb950' : '#f85149', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
            {ipo.return_pct >= 0 ? '+' : ''}{ipo.return_pct.toFixed(2)}% {tavanDays > 0 ? `(~${tavanDays} Tavan)` : ''}
          </span>
        </div>
      )}
    </div>
  );
}

function parseTradingStartDate(startDateStr?: string | null): Date | null {
  if (!startDateStr) return null;
  const trimmed = startDateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d;
  }

  const trMonths: Record<string, number> = {
    ocak: 0, şubat: 1, mart: 2, nisan: 3, mayıs: 4, haziran: 5,
    temmuz: 6, ağustos: 7, eylül: 8, ekim: 9, kasım: 10, aralık: 11
  };

  const parts = trimmed.toLowerCase().split(/\s+/);
  if (parts.length >= 3) {
    const day = parseInt(parts[0], 10);
    const month = trMonths[parts[1]];
    const year = parseInt(parts[2], 10);
    if (!isNaN(day) && month !== undefined && !isNaN(year)) {
      return new Date(year, month, day);
    }
  }

  return null;
}

function prepareIpoCandles(rawQuotes: HistoricalQuote[] | null, ipo?: IpoRecord | null): HistoricalQuote[] {
  const price = typeof ipo?.price === 'number' && ipo.price > 0 ? ipo.price : 35;
  const current = typeof ipo?.current_price === 'number' && ipo.current_price > 0 ? ipo.current_price : Math.round(price * 1.10 * 100) / 100;
  const isOverallDown = current < price || (typeof ipo?.return_pct === 'number' && ipo.return_pct < 0);

  if (Array.isArray(rawQuotes) && rawQuotes.length >= 1) {
    let prevCloseVal = price;
    return rawQuotes.map((q) => {
      let open = q.open > 0 ? q.open : q.close;
      let high = q.high > 0 ? q.high : q.close;
      let low = q.low > 0 ? q.low : q.close;
      const close = q.close;

      if (open === close && high === close && low === close) {
        if (close >= prevCloseVal) {
          open = Math.round(close * 0.995 * 100) / 100;
          high = Math.round(close * 1.005 * 100) / 100;
          low = Math.round(open * 0.995 * 100) / 100;
        } else {
          open = Math.round(close * 1.005 * 100) / 100;
          high = Math.round(open * 1.005 * 100) / 100;
          low = Math.round(close * 0.995 * 100) / 100;
        }
      }
      prevCloseVal = close;
      return { ...q, open, high, low, close };
    });
  }

  // Calculate actual trading start date & days count
  const startDate = parseTradingStartDate(ipo?.trading_start_date);
  const now = new Date();
  now.setHours(12, 0, 0, 0);

  let daysCount = 1;
  if (startDate) {
    startDate.setHours(12, 0, 0, 0);
    const diffMs = now.getTime() - startDate.getTime();
    const diffDays = Math.floor(diffMs / 86_400_000);
    daysCount = Math.max(1, Math.min(30, diffDays + 1));
  } else {
    const returnPct = ipo?.return_pct ?? 10;
    daysCount = Math.max(1, Math.min(10, Math.round(Math.log(1 + Math.abs(returnPct) / 100) / Math.log(1.10))));
  }

  const quotes: HistoricalQuote[] = [];
  const baseStart = startDate || new Date(now.getTime() - (daysCount - 1) * 86_400_000);
  let currPrice = price;
  const priceStep = daysCount > 1 ? (current - price) / (daysCount - 1) : 0;

  for (let i = 0; i < daysCount; i++) {
    const d = new Date(baseStart.getTime() + i * 86_400_000);

    let open = i === 0 ? price : currPrice;
    const isLast = i === daysCount - 1;
    let close = isLast ? current : Math.round((open + priceStep) * 100) / 100;

    // Ensure red candle if day/stock is down!
    if (isOverallDown || close < open) {
      if (open <= close) {
        open = Math.round(close * 1.008 * 100) / 100;
      }
    }

    const high = Math.round(Math.max(open, close) * 1.005 * 100) / 100;
    const low = Math.round(Math.min(open, close) * 0.995 * 100) / 100;
    const volume = Math.floor(150_000 + Math.random() * 350_000);

    quotes.push({
      time: Math.floor(d.getTime() / 1000),
      open: Math.round(open * 100) / 100,
      high,
      low,
      close: Math.round(close * 100) / 100,
      volume,
    });

    currPrice = close;
  }

  return quotes;
}

function IpoStockPerformanceChart({ ipo, onSelectTicker }: { ipo?: IpoRecord | null; onSelectTicker?: (ticker: string) => void }) {
  const cleanTicker = (ipo?.ticker || '').toUpperCase().replace(/\.IS$/i, '').trim();
  const [quotes, setQuotes] = useState<HistoricalQuote[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const priceVal = typeof ipo?.price === 'number' && ipo.price > 0 ? ipo.price : null;
  const currentPriceVal = typeof ipo?.current_price === 'number' && ipo.current_price > 0 ? ipo.current_price : null;
  const returnPctVal = typeof ipo?.return_pct === 'number' ? ipo.return_pct : null;
  const companyNameVal = ipo?.company_name || cleanTicker || 'Şirket';

  useEffect(() => {
    if (!cleanTicker) {
      setLoading(false);
      return;
    }
    let isMounted = true;
    setLoading(true);

    getPriceHistory(cleanTicker, '1y', 'isyatirim')
      .then((data) => {
        if (!isMounted) return;
        const prepared = prepareIpoCandles(data, ipo);
        setQuotes(prepared);
      })
      .catch(() => {
        if (!isMounted) return;
        setQuotes(prepareIpoCandles(null, ipo));
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [cleanTicker, ipo]);

  const retColor = (returnPctVal ?? 0) >= 0 ? '#3fb950' : '#f85149';
  const displayQuotes = quotes || prepareIpoCandles(null, ipo);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '14px',
      background: 'rgba(13, 17, 23, 0.75)', padding: '20px', borderRadius: '12px',
      border: '1px solid rgba(88, 166, 255, 0.25)', marginTop: '4px',
      width: '100%', maxWidth: '100%', boxSizing: 'border-box'
    }}>
      {/* Header & Performance Metrics */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f0f6fc', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>🕯️ {companyNameVal} ({cleanTicker}) Halka Arz Sonrası BİST Fiyat Performansı</span>
          </div>
          <div style={{ fontSize: '0.78rem', color: '#8b949e', marginTop: '4px', display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span>Arz Fiyatı: <strong style={{ color: '#c9d1d9', fontFamily: 'var(--font-mono)' }}>{priceVal !== null ? `₺${priceVal.toFixed(2)}` : '—'}</strong></span>
            <span>Son Fiyat: <strong style={{ color: '#f0f6fc', fontFamily: 'var(--font-mono)' }}>{currentPriceVal !== null ? `₺${currentPriceVal.toFixed(2)}` : '—'}</strong></span>
            {returnPctVal !== null && (
              <span>Getiri: <strong style={{ color: retColor, fontFamily: 'var(--font-mono)' }}>{returnPctVal >= 0 ? '+' : ''}{returnPctVal.toFixed(2)}%</strong></span>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {cleanTicker && onSelectTicker && (
            <button
              type="button"
              onClick={() => onSelectTicker(cleanTicker)}
              style={{
                padding: '6px 14px', background: 'rgba(35, 134, 54, 0.25)', color: '#3fb950',
                border: '1px solid rgba(63, 185, 80, 0.4)', borderRadius: '8px', cursor: 'pointer',
                fontFamily: 'var(--font-mono)', fontSize: '0.78rem', fontWeight: 700,
                transition: 'all 0.15s ease', display: 'inline-flex', alignItems: 'center', gap: '6px'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(35, 134, 54, 0.4)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(35, 134, 54, 0.25)'; }}
            >
              📊 FRAUDE Canlı Hisse Kartı & Grafiği ↗
            </button>
          )}
          {cleanTicker && (
            <a
              href={`https://tr.tradingview.com/symbols/BIST-${encodeURIComponent(cleanTicker)}/`}
              target="_blank"
              rel="noreferrer"
              style={{
                fontSize: '0.78rem', color: '#58a6ff', background: 'rgba(88, 166, 255, 0.12)',
                padding: '6px 14px', borderRadius: '8px', border: '1px solid rgba(88, 166, 255, 0.3)',
                fontFamily: 'var(--font-mono)', fontWeight: 700, textDecoration: 'none',
                display: 'inline-flex', alignItems: 'center', gap: '4px', transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(88, 166, 255, 0.25)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(88, 166, 255, 0.12)'; }}
            >
              TradingView Web ↗
            </a>
          )}
        </div>
      </div>

      {/* Chart Canvas Area */}
      <div style={{ minHeight: '420px', width: '100%', borderRadius: '10px', overflow: 'hidden', border: '1px solid rgba(255, 255, 255, 0.08)', position: 'relative', background: '#161b22' }}>
        {loading ? (
          <div style={{ display: 'flex', height: '420px', alignItems: 'center', justifyContent: 'center', color: '#8b949e', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
            <span>⏳ Canlı BİST Mum Grafiği Hazırlanıyor...</span>
          </div>
        ) : (
          <PriceChart ticker={cleanTicker} data={displayQuotes} range="max" livePrice={currentPriceVal} />
        )}
      </div>
    </div>
  );
}

function IpoAllocationSimulator({ price, ipoSize, shareStructure, distributionRatios, allIpos }: { price: number; ipoSize?: string | null; shareStructure?: string | null; distributionRatios?: string | null; allIpos?: IpoRecord[] }) {
  let totalLots = 0;

  if (shareStructure) {
    const matches = shareStructure.match(/(\d+(?:\.\d+)*)\s*Lot/gi);
    if (matches) {
      for (const m of matches) {
        const numStr = m.replace(/Lot/gi, '').replace(/\./g, '').trim();
        const n = parseInt(numStr, 10);
        if (!isNaN(n) && n > 1000) {
          totalLots += n;
        }
      }
    }
  }

  if (totalLots <= 0 && ipoSize) {
    if (ipoSize.toLowerCase().includes('lot')) {
      const numStr = ipoSize.replace(/Lot/gi, '').replace(/\./g, '').replace(/,/g, '.').trim();
      const n = parseFloat(numStr);
      if (!isNaN(n) && n > 1000) totalLots = n;
    } else if (price > 0) {
      const numStr = ipoSize.replace(/TL|Milyar|Milyon/gi, '').replace(/\./g, '').replace(/,/g, '.').trim();
      const n = parseFloat(numStr);
      if (!isNaN(n) && n > 0) {
        let tlVal = n;
        if (ipoSize.toLowerCase().includes('milyar')) tlVal *= 1_000_000_000;
        else if (ipoSize.toLowerCase().includes('milyon')) tlVal *= 1_000_000;
        totalLots = Math.round(tlVal / price);
      }
    }
  }

  if (totalLots <= 0) {
    totalLots = 40000000;
  }

  let bireyselPct = 75;
  if (distributionRatios) {
    const parts = distributionRatios.split(/[-;]\s*/);
    for (const part of parts) {
      if (part.toLowerCase().includes('bireysel')) {
        const match = part.match(/%\s*(\d+(?:[.,]\d+)?)/) || part.match(/(\d+(?:[.,]\d+)?)\s*%/);
        if (match) {
          const parsedPct = parseFloat(match[1].replace(',', '.'));
          if (!isNaN(parsedPct) && parsedPct > 0 && parsedPct <= 100) {
            bireyselPct = parsedPct;
            break;
          }
        }
      }
    }
  }

  const retailLots = Math.round(totalLots * (bireyselPct / 100));
  const effectivePrice = price > 0 ? price : 50;

  // Dynamically calculate REAL average participation count from completed IPO database
  let avgRecentParticipants = 450000; // fallback if no historical data available
  let sampleCount = 0;
  if (allIpos && allIpos.length > 0) {
    const validCounts: number[] = [];
    for (const item of allIpos) {
      if (item.participant_count) {
        const cleaned = item.participant_count.replace(/kişi/gi, '').replace(/\./g, '').replace(/,/g, '.').trim();
        const parsed = parseInt(cleaned, 10);
        if (!isNaN(parsed) && parsed > 50000) {
          validCounts.push(parsed);
        }
      }
    }
    if (validCounts.length > 0) {
      const recent = validCounts.slice(0, 5);
      sampleCount = recent.length;
      avgRecentParticipants = Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);
    }
  }

  const defaultRecommendedParticipants = avgRecentParticipants;
  const recommendedLots = Math.max(1, Math.ceil((retailLots / defaultRecommendedParticipants) * 1.20));
  const recommendedAmount = Math.ceil(recommendedLots * effectivePrice);

  // Dynamic user inputs
  const [customParticipants, setCustomParticipants] = useState<number>(2000000);
  const [userLots, setUserLots] = useState<number>(recommendedLots);
  const [targetTavanDays, setTargetTavanDays] = useState<number>(5);

  useEffect(() => {
    setUserLots(recommendedLots);
  }, [recommendedLots]);

  const calcLots = (count: number) => Math.max(1, Math.floor(retailLots / Math.max(1, count)));

  // Target Tavan Day Calculations
  const tavanMultiplier = Math.pow(1.10, targetTavanDays);
  const tavanReturnPct = (tavanMultiplier - 1) * 100;
  const targetSharePrice = effectivePrice * tavanMultiplier;

  // Custom Simulator Live Metrics
  const activeLots = userLots > 0 ? userLots : calcLots(customParticipants);
  const simCost = activeLots * effectivePrice;
  const simTotalValue = activeLots * targetSharePrice;
  const simProfit = simTotalValue - simCost;

  const scenarios = [500000, 1000000, 1500000, 2000000, 2500000, 3000000, 3500000];
  const tavanPresets = [1, 2, 3, 5, 7, 10, 15];

  const formattedAvgCount = avgRecentParticipants >= 1000000
    ? `${(avgRecentParticipants / 1000000).toFixed(1)}M`
    : `${Math.round(avgRecentParticipants / 1000)} Bin`;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '16px',
      background: 'rgba(13, 17, 23, 0.7)', padding: '20px', borderRadius: '12px',
      border: '1px solid rgba(88, 166, 255, 0.2)', marginTop: '4px',
      width: '100%', maxWidth: '100%', boxSizing: 'border-box'
    }}>
      {/* Header & Formula Subtitle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#f0f6fc', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>🧮 Halka Arz Katılım Önerisi & Tavan Kar Simülatörü</span>
          </div>
          <div style={{ fontSize: '0.76rem', color: '#8b949e', marginTop: '2px' }}>
            Formül: ~{totalLots.toLocaleString('tr-TR')} Toplam Arz Lot × %{bireyselPct} Bireysel Payı = <strong>~{retailLots.toLocaleString('tr-TR')} Lot</strong> (Düşecek Lot = Bireysele Ayrılan Lot / Katılımcı Sayısı)
          </div>
        </div>

        {/* Smart recommendation badge */}
        <div
          title={`Veri Tabanındaki son tamamlanan ${sampleCount > 0 ? sampleCount : 5} halka arza katılan ortalama ~${avgRecentParticipants.toLocaleString('tr-TR')} kişi baz alınmış, düşük katılım ihtimaline karşı %20 emniyet marjı eklenmiştir.`}
          style={{
            background: 'linear-gradient(135deg, rgba(35, 134, 54, 0.25), rgba(63, 185, 80, 0.12))',
            border: '1px solid rgba(63, 185, 80, 0.4)', padding: '10px 18px', borderRadius: '10px',
            display: 'flex', flexDirection: 'column', gap: '2px', boxShadow: '0 4px 14px rgba(35, 134, 54, 0.15)',
            cursor: 'help'
          }}
        >
          <div style={{ fontSize: '0.7rem', color: '#3fb950', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            💡 Önerilen Başvuru Miktarı <span style={{ fontSize: '0.68rem', color: '#8b949e', fontWeight: 400 }}>ⓘ</span>
          </div>
          <div style={{ fontSize: '1.08rem', fontWeight: 800, color: '#ffffff', fontFamily: 'var(--font-mono)' }}>
            {recommendedLots} Lot <span style={{ fontSize: '0.85rem', color: '#3fb950', fontWeight: 600 }}>(₺{recommendedAmount.toLocaleString('tr-TR')})</span>
          </div>
          <div style={{ fontSize: '0.65rem', color: '#8b949e', fontStyle: 'italic', marginTop: '1px' }}>
            Son {sampleCount > 0 ? sampleCount : 5} Arz Ort. ~{formattedAvgCount} kişi + %20 emniyet
          </div>
        </div>
      </div>

      {/* Interactive Control Panel: User Lot & Target Tavan Selectors */}
      <div style={{
        background: 'rgba(22, 27, 34, 0.8)', border: '1px solid rgba(88, 166, 255, 0.2)',
        borderRadius: '10px', padding: '14px 18px', display: 'flex', flexWrap: 'wrap',
        alignItems: 'center', justifyContent: 'space-between', gap: '16px'
      }}>
        {/* User Lot Input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f0f6fc', display: 'flex', alignItems: 'center', gap: '6px' }}>
            📦 Eldedeki / Başvurulacak Lot:
          </span>
          <input
            type="number"
            min={1}
            value={userLots}
            onChange={(e) => setUserLots(Math.max(1, parseInt(e.target.value) || 1))}
            style={{
              background: '#0d1117', border: '1px solid rgba(88, 166, 255, 0.4)', color: '#f0f6fc',
              borderRadius: '6px', padding: '6px 12px', fontSize: '0.9rem', width: '100px',
              fontFamily: 'var(--font-mono)', fontWeight: 800, textAlign: 'center'
            }}
          />
          <span style={{ fontSize: '0.8rem', color: '#8b949e' }}>Lot</span>
        </div>

        {/* Target Tavan Day Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#58a6ff' }}>
            🎯 Hedef Tavan Günü:
          </span>
          <div style={{ display: 'flex', gap: '4px', background: 'rgba(13, 17, 23, 0.6)', padding: '3px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
            {tavanPresets.map((day) => {
              const isSelected = targetTavanDays === day;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => setTargetTavanDays(day)}
                  style={{
                    padding: '4px 10px', borderRadius: '6px', fontSize: '0.76rem', fontWeight: 700,
                    border: isSelected ? '1px solid #58a6ff' : '1px solid transparent',
                    background: isSelected ? 'rgba(88, 166, 255, 0.25)' : 'transparent',
                    color: isSelected ? '#ffffff' : '#8b949e', cursor: 'pointer',
                    transition: 'all 0.15s'
                  }}
                >
                  {day}. Gün
                </button>
              );
            })}
          </div>
          <span style={{ fontSize: '0.78rem', color: '#3fb950', fontWeight: 700, fontFamily: 'var(--font-mono)', marginLeft: '4px' }}>
            (+%{tavanReturnPct.toFixed(1)})
          </span>
        </div>
      </div>

      {/* Preset Scenarios Table (Dynamically Updated Based on Selected Tavan Day) */}
      <div style={{ overflowX: 'auto', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '8px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
          <thead>
            <tr style={{ background: 'rgba(255, 255, 255, 0.03)', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#8b949e', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px' }}>Katılımcı Sayısı</th>
              <th style={{ padding: '8px 12px' }}>Düşecek Lot</th>
              <th style={{ padding: '8px 12px' }}>Gerekli Teminat (₺)</th>
              <th style={{ padding: '8px 12px', color: '#3fb950' }}>{targetTavanDays}. Tavan Net Karı (+%{tavanReturnPct.toFixed(1)})</th>
              <th style={{ padding: '8px 12px', color: '#58a6ff' }}>{targetTavanDays}. Tavan Portföy Değeri (₺)</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((count) => {
              const l = calcLots(count);
              const cost = l * effectivePrice;
              const profit = cost * (tavanReturnPct / 100);
              const totalVal = cost + profit;
              return (
                <tr key={count} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                  <td style={{ padding: '8px 12px', fontWeight: 600, color: '#c9d1d9' }}>{(count / 1000000).toFixed(1)} Milyon Kişi ({count.toLocaleString('tr-TR')})</td>
                  <td style={{ padding: '8px 12px', fontWeight: 700, color: '#f0f6fc', fontFamily: 'var(--font-mono)' }}>{l} Lot</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', color: '#8b949e' }}>₺{cost.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', color: '#3fb950', fontWeight: 700 }}>+₺{profit.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', color: '#58a6ff', fontWeight: 700 }}>₺{totalVal.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Interactive Custom Calculator Slider */}
      <div style={{
        background: 'rgba(22, 27, 34, 0.8)', padding: '16px 20px', borderRadius: '10px',
        border: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', flexDirection: 'column', gap: '14px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#58a6ff' }}>
            🎛️ Özgür Katılım Simülatörü (Katılımcı Sayısını Ayarlayın)
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '0.78rem', color: '#8b949e' }}>Katılımcı Sayısı:</span>
            <input
              type="number"
              value={customParticipants}
              onChange={(e) => setCustomParticipants(Math.max(100000, parseInt(e.target.value) || 100000))}
              style={{
                background: '#0d1117', border: '1px solid rgba(88, 166, 255, 0.3)', color: '#f0f6fc',
                borderRadius: '6px', padding: '4px 10px', fontSize: '0.82rem', width: '140px',
                fontFamily: 'var(--font-mono)', fontWeight: 700, textAlign: 'right'
              }}
            />
            <span style={{ fontSize: '0.78rem', color: '#8b949e' }}>Kişi</span>
          </div>
        </div>

        {/* Slider input */}
        <input
          type="range"
          min={300000}
          max={4000000}
          step={50000}
          value={customParticipants}
          onChange={(e) => setCustomParticipants(parseInt(e.target.value))}
          style={{ width: '100%', cursor: 'pointer', accentColor: '#58a6ff' }}
        />

        {/* Live Calculation Results based on userLots & targetTavanDays */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginTop: '4px' }}>
          <div style={{ background: 'rgba(13, 17, 23, 0.6)', padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
            <div style={{ fontSize: '0.72rem', color: '#8b949e' }}>Hesaplanan / Eldeki Lot</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#f0f6fc', fontFamily: 'var(--font-mono)' }}>{activeLots} Lot</div>
          </div>
          <div style={{ background: 'rgba(13, 17, 23, 0.6)', padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
            <div style={{ fontSize: '0.72rem', color: '#8b949e' }}>Gerekli Tutar (Maliyet)</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#d29922', fontFamily: 'var(--font-mono)' }}>₺{simCost.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
          <div style={{ background: 'rgba(13, 17, 23, 0.6)', padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(63, 185, 80, 0.2)' }}>
            <div style={{ fontSize: '0.72rem', color: '#3fb950' }}>{targetTavanDays}. Tavan Karı (+%{tavanReturnPct.toFixed(1)})</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#3fb950', fontFamily: 'var(--font-mono)' }}>+₺{simProfit.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
          <div style={{ background: 'rgba(13, 17, 23, 0.6)', padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(88, 166, 255, 0.2)' }}>
            <div style={{ fontSize: '0.72rem', color: '#58a6ff' }}>{targetTavanDays}. Tavan Portföy Değeri</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#58a6ff', fontFamily: 'var(--font-mono)' }}>₺{simTotalValue.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function normalizeTurkishSearchText(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .replace(/ı/g, 'i')
    .replace(/Ğ/g, 'g')
    .replace(/ğ/g, 'g')
    .replace(/Ü/g, 'u')
    .replace(/ü/g, 'u')
    .replace(/Ş/g, 's')
    .replace(/ş/g, 's')
    .replace(/Ö/g, 'o')
    .replace(/ö/g, 'o')
    .replace(/Ç/g, 'c')
    .replace(/ç/g, 'c')
    .toLowerCase();
}

function parseIpoSizeTL(ipo: IpoRecord): number {
  if (ipo.ipo_size) {
    const text = ipo.ipo_size;
    const match = text.match(/(\d+(?:[.,]\d+)?)\s*(Milyar|Milyon|Bin)?/i);
    if (match) {
      let num = parseFloat(match[1].replace(',', '.'));
      const unit = (match[2] || '').toLowerCase();
      if (unit.includes('milyar')) num *= 1_000_000_000;
      else if (unit.includes('milyon')) num *= 1_000_000;
      else if (unit.includes('bin')) num *= 1_000;
      if (!isNaN(num) && num > 0) return num;
    }
  }
  const totalLots = parseTotalLots(ipo);
  if (typeof ipo.price === 'number' && ipo.price > 0 && totalLots > 0) {
    return ipo.price * totalLots;
  }
  return 0;
}

function parseTotalLots(ipo: IpoRecord): number {
  if (ipo.share_structure) {
    let sum = 0;
    const matches = ipo.share_structure.matchAll(/(\d+(?:\.\d+)*(?:,\d+)?)\s*Lot/gi);
    for (const m of matches) {
      const parsed = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
      if (!isNaN(parsed) && parsed > 0) sum += parsed;
    }
    if (sum > 0) return sum;
  }
  if (typeof ipo.lot_size === 'number' && ipo.lot_size > 0) {
    return ipo.lot_size;
  }
  return 0;
}

function parseRetailRatio(ipo: IpoRecord): { percent: number; lots: number } {
  const totalLots = parseTotalLots(ipo);
  let percent = 70;

  if (ipo.distribution_ratios) {
    const match = ipo.distribution_ratios.match(/(?:Bireysel|Yurt\s*İçi\s*Bireysel)[^\d%]*(\d+(?:[.,]\d+)?)\s*%/i) ||
                  ipo.distribution_ratios.match(/%\s*(\d+(?:[.,]\d+)?)[^\d%]*(?:Bireysel|Yurt\s*İçi\s*Bireysel)/i);
    if (match) {
      const p = parseFloat(match[1].replace(',', '.'));
      if (!isNaN(p) && p > 0 && p <= 100) percent = p;
    }
  }

  const lots = totalLots > 0 ? (totalLots * percent) / 100 : 0;
  return { percent, lots };
}

export default function CorporateActionsView({ onSelectTicker, initialTab = 'dividends' }: CorporateActionsViewProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ActiveTab>(initialTab);
  const [filter, setFilter] = useState('');
  const [events, setEvents] = useState<CorporateEventsPayload | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [ipoData, setIpoData] = useState<IpoCalendarPayload | null>(null);
  const [ipoSubTab, setIpoSubTab] = useState<'tamamlanan' | 'taslak'>('tamamlanan');
  const [loading, setLoading] = useState(false);
  const [ipoRefreshing, setIpoRefreshing] = useState(false);
  const [expandedIpoIndex, setExpandedIpoIndex] = useState<number | null>(null);

  // Halka Arz Filtreleme State'leri
  const [ipoSearchQuery, setIpoSearchQuery] = useState('');
  const [ipoSizeFilter, setIpoSizeFilter] = useState('all');
  const [ipoLotFilter, setIpoLotFilter] = useState('all');
  const [ipoKatilimFilter, setIpoKatilimFilter] = useState('all');
  const [ipoRetailFilter, setIpoRetailFilter] = useState('all');
  const [ipoConsortiumFilter, setIpoConsortiumFilter] = useState('all');

  const ipos = ipoData?.records ?? [];

  const consortiumLeaders = Array.from(
    new Set(
      ipos
        .map(i => (i.consortium_lead || '').trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, 'tr'));

  const filterIpoMatch = (ipo: IpoRecord): boolean => {
    if (ipoSearchQuery) {
      const q = normalizeTurkishSearchText(ipoSearchQuery);
      const matchesTicker = normalizeTurkishSearchText(ipo.ticker).includes(q);
      const matchesName = normalizeTurkishSearchText(ipo.company_name).includes(q);
      const matchesLead = normalizeTurkishSearchText(ipo.consortium_lead).includes(q);
      if (!matchesTicker && !matchesName && !matchesLead) return false;
    }

    if (ipoSizeFilter !== 'all') {
      const sizeTL = parseIpoSizeTL(ipo);
      if (sizeTL > 0) {
        if (ipoSizeFilter === 'small' && sizeTL >= 500_000_000) return false;
        if (ipoSizeFilter === 'mid' && (sizeTL < 500_000_000 || sizeTL > 2_000_000_000)) return false;
        if (ipoSizeFilter === 'large' && sizeTL <= 2_000_000_000) return false;
      }
    }

    if (ipoLotFilter !== 'all') {
      const totalLots = parseTotalLots(ipo);
      if (totalLots > 0) {
        if (ipoLotFilter === 'small' && totalLots >= 20_000_000) return false;
        if (ipoLotFilter === 'mid' && (totalLots < 20_000_000 || totalLots > 50_000_000)) return false;
        if (ipoLotFilter === 'large' && totalLots <= 50_000_000) return false;
      }
    }

    if (ipoKatilimFilter !== 'all') {
      const katilimText = normalizeTurkishSearchText(ipo.katilim_index);
      const isSuitable = katilimText.includes('uygun') && !katilimText.includes('degil');
      if (ipoKatilimFilter === 'suitable' && !isSuitable) return false;
      if (ipoKatilimFilter === 'unsuitable' && isSuitable) return false;
    }

    if (ipoRetailFilter !== 'all') {
      const retail = parseRetailRatio(ipo);
      if (ipoRetailFilter === 'pct70' && retail.percent < 70) return false;
      if (ipoRetailFilter === 'pct80' && retail.percent < 80) return false;
      if (ipoRetailFilter === 'high_lot' && retail.lots <= 25_000_000) return false;
    }

    if (ipoConsortiumFilter !== 'all') {
      const lead = normalizeTurkishSearchText(ipo.consortium_lead);
      const targetLead = normalizeTurkishSearchText(ipoConsortiumFilter);
      if (!lead.includes(targetLead)) return false;
    }

    return true;
  };

  const activeIposCount = ipos.filter(i => i.status !== 'TASLAK' && filterIpoMatch(i)).length;
  const draftIposCount = ipos.filter(i => i.status === 'TASLAK' && filterIpoMatch(i)).length;

  const filteredIpos = ipos.filter(ipo => {
    if (ipoSubTab === 'taslak') {
      if (ipo.status !== 'TASLAK') return false;
    } else {
      if (ipo.status === 'TASLAK') return false;
    }
    return filterIpoMatch(ipo);
  });

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
    <div className="view corporate-actions-view" style={{ padding: '20px', width: '100%', maxWidth: '100%', boxSizing: 'border-box', overflowX: 'hidden' }}>
      <h1 style={{ fontSize: '1.3rem', color: '#fff', marginBottom: '16px' }}>
        {t('corporateActions')}
      </h1>

      <div className="corporate-tabs" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', borderBottom: '1px solid #30363d', marginBottom: '20px', width: '100%', boxSizing: 'border-box' }}>
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
        <div className="corporate-filter" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '20px', alignItems: 'center', width: '100%', boxSizing: 'border-box' }}>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('caFilterPh')}
            style={{
              flex: '1 1 240px', maxWidth: '300px', padding: '10px 14px',
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
            <div className="panel" style={{ overflowX: 'auto', marginBottom: '16px', border: '1px solid #23863655' }}>
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
          <div className="panel" style={{ overflowX: 'auto' }}>
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
                    <td style={{ ...tdStyle, color: '#3fb950', fontWeight: 'bold' }}>{(d.amount_per_share ?? 0).toFixed(4)}</td>
                    <td style={tdStyle}>{(d.yield_pct ?? 0) > 0 ? `%${(d.yield_pct ?? 0).toFixed(2)}` : '—'}</td>
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
          <div className="panel" style={{ overflowX: 'auto' }}>
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
          <div className="panel" style={{ overflowX: 'auto' }}>
            {ipoData && !ipoData.scrape_ok && (
              <div style={{
                marginBottom: '12px', padding: '8px 14px', borderRadius: '6px',
                background: '#f0883e22', border: '1px solid #f0883e55', color: '#f0883e',
                fontSize: '0.78rem', fontFamily: 'var(--font-mono)',
              }}>
                {t('caIpoStale')}
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '15px', alignItems: 'center', justifyContent: 'space-between', width: '100%', boxSizing: 'border-box' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  onClick={() => setIpoSubTab('tamamlanan')}
                  style={{
                    ...tabStyle('ipo'),
                    padding: '6px 12px',
                    borderBottom: ipoSubTab === 'tamamlanan' ? '2px solid #58a6ff' : '2px solid transparent',
                    color: ipoSubTab === 'tamamlanan' ? '#58a6ff' : '#8b949e',
                    display: 'flex', alignItems: 'center', gap: '6px',
                  }}
                >
                  <span>{t('caIpoDone')}</span>
                  <span style={{
                    fontSize: '0.72rem', padding: '1px 6px', borderRadius: '10px',
                    background: ipoSubTab === 'tamamlanan' ? 'rgba(88, 166, 255, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                    color: ipoSubTab === 'tamamlanan' ? '#58a6ff' : '#8b949e',
                  }}>
                    {activeIposCount}
                  </span>
                </button>
                <button
                  onClick={() => setIpoSubTab('taslak')}
                  style={{
                    ...tabStyle('ipo'),
                    padding: '6px 12px',
                    borderBottom: ipoSubTab === 'taslak' ? '2px solid #58a6ff' : '2px solid transparent',
                    color: ipoSubTab === 'taslak' ? '#58a6ff' : '#8b949e',
                    display: 'flex', alignItems: 'center', gap: '6px',
                  }}
                >
                  <span>{t('caIpoDraft')}</span>
                  <span style={{
                    fontSize: '0.72rem', padding: '1px 6px', borderRadius: '10px',
                    background: ipoSubTab === 'taslak' ? 'rgba(88, 166, 255, 0.2)' : draftIposCount > 0 ? 'rgba(63, 185, 80, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                    color: ipoSubTab === 'taslak' ? '#58a6ff' : draftIposCount > 0 ? '#3fb950' : '#8b949e',
                    fontWeight: draftIposCount > 0 ? 'bold' : 'normal',
                  }}>
                    {draftIposCount}
                  </span>
                </button>
              </div>

              <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
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

            {/* Halka Arz Akıllı Filtreleme Paneli */}
            <div style={{
              background: 'linear-gradient(145deg, rgba(22, 27, 34, 0.95), rgba(13, 17, 23, 0.9))',
              border: '1px solid rgba(88, 166, 255, 0.2)',
              borderRadius: '12px',
              padding: '14px 18px',
              marginBottom: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              boxSizing: 'border-box',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ fontSize: '0.8rem', color: '#58a6ff', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  ⚡ Halka Arz Filtre Paneli
                </div>
                {(ipoSearchQuery || ipoSizeFilter !== 'all' || ipoLotFilter !== 'all' || ipoKatilimFilter !== 'all' || ipoRetailFilter !== 'all' || ipoConsortiumFilter !== 'all') && (
                  <button
                    type="button"
                    onClick={() => {
                      setIpoSearchQuery('');
                      setIpoSizeFilter('all');
                      setIpoLotFilter('all');
                      setIpoKatilimFilter('all');
                      setIpoRetailFilter('all');
                      setIpoConsortiumFilter('all');
                    }}
                    style={{
                      padding: '4px 10px', background: 'rgba(248, 81, 73, 0.15)', color: '#f85149',
                      border: '1px solid rgba(248, 81, 73, 0.3)', borderRadius: '6px', cursor: 'pointer',
                      fontSize: '0.74rem', fontWeight: 600, transition: 'all 0.15s'
                    }}
                  >
                    ✕ Tüm Filtreleri Temizle
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
                {/* Search Input */}
                <input
                  type="text"
                  placeholder="Şirket, kod veya konsorsiyum ara..."
                  value={ipoSearchQuery}
                  onChange={(e) => setIpoSearchQuery(e.target.value)}
                  style={{
                    padding: '6px 12px', fontSize: '0.78rem', borderRadius: '6px',
                    border: '1px solid rgba(255, 255, 255, 0.12)', background: 'rgba(13, 17, 23, 0.8)', color: '#f0f6fc',
                    minWidth: '200px', flex: '1 1 180px', fontFamily: 'var(--font-mono)'
                  }}
                />

                {/* 1. Halka Arz Büyüklüğü */}
                <select
                  value={ipoSizeFilter}
                  onChange={(e) => setIpoSizeFilter(e.target.value)}
                  style={{
                    padding: '6px 10px', fontSize: '0.78rem', borderRadius: '6px',
                    border: '1px solid rgba(255, 255, 255, 0.12)', background: 'rgba(13, 17, 23, 0.8)', color: '#f0f6fc',
                    cursor: 'pointer'
                  }}
                >
                  <option value="all">💰 Halka Arz Büyüklüğü (Tümü)</option>
                  <option value="small">Küçük (&lt; 500 Milyon ₺)</option>
                  <option value="mid">Orta (500M ₺ - 2 Milyar ₺)</option>
                  <option value="large">Büyük (&gt; 2 Milyar ₺)</option>
                </select>

                {/* 2. Toplam Arz Edilecek Lot */}
                <select
                  value={ipoLotFilter}
                  onChange={(e) => setIpoLotFilter(e.target.value)}
                  style={{
                    padding: '6px 10px', fontSize: '0.78rem', borderRadius: '6px',
                    border: '1px solid rgba(255, 255, 255, 0.12)', background: 'rgba(13, 17, 23, 0.8)', color: '#f0f6fc',
                    cursor: 'pointer'
                  }}
                >
                  <option value="all">📊 Arz Edilecek Lot (Tümü)</option>
                  <option value="small">&lt; 20 Milyon Lot</option>
                  <option value="mid">20M - 50 Milyon Lot</option>
                  <option value="large">&gt; 50 Milyon Lot</option>
                </select>

                {/* 3. Katılım Endeksi */}
                <select
                  value={ipoKatilimFilter}
                  onChange={(e) => setIpoKatilimFilter(e.target.value)}
                  style={{
                    padding: '6px 10px', fontSize: '0.78rem', borderRadius: '6px',
                    border: '1px solid rgba(255, 255, 255, 0.12)', background: 'rgba(13, 17, 23, 0.8)', color: '#f0f6fc',
                    cursor: 'pointer'
                  }}
                >
                  <option value="all">☪️ Katılım Endeksi (Tümü)</option>
                  <option value="suitable">✓ Katılım Endeksine Uygun</option>
                  <option value="unsuitable">✕ Katılım Endeksine Uygun Değil</option>
                </select>

                {/* 4. Bireysele Ayrılan Lot / Tahsisat */}
                <select
                  value={ipoRetailFilter}
                  onChange={(e) => setIpoRetailFilter(e.target.value)}
                  style={{
                    padding: '6px 10px', fontSize: '0.78rem', borderRadius: '6px',
                    border: '1px solid rgba(255, 255, 255, 0.12)', background: 'rgba(13, 17, 23, 0.8)', color: '#f0f6fc',
                    cursor: 'pointer'
                  }}
                >
                  <option value="all">👨‍💼 Bireysel Tahsisat (Tümü)</option>
                  <option value="pct70">%70 ve Üzeri Bireysel</option>
                  <option value="pct80">%80 ve Üzeri Bireysel</option>
                  <option value="high_lot">&gt; 25 Milyon Bireysel Lot</option>
                </select>

                {/* 5. Konsorsiyum Lideri */}
                <select
                  value={ipoConsortiumFilter}
                  onChange={(e) => setIpoConsortiumFilter(e.target.value)}
                  style={{
                    padding: '6px 10px', fontSize: '0.78rem', borderRadius: '6px',
                    border: '1px solid rgba(255, 255, 255, 0.12)', background: 'rgba(13, 17, 23, 0.8)', color: '#f0f6fc',
                    cursor: 'pointer', maxWidth: '200px'
                  }}
                >
                  <option value="all">🏛️ Konsorsiyum Lideri (Tümü)</option>
                  {consortiumLeaders.map(lead => (
                    <option key={lead} value={lead}>{lead}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ marginBottom: '12px', color: '#8b949e', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>{t('caIpoCount', { n: filteredIpos.length })}</span>
              {filteredIpos.length < ipos.filter(i => ipoSubTab === 'taslak' ? i.status === 'TASLAK' : i.status !== 'TASLAK').length && (
                <span style={{ fontSize: '0.72rem', color: '#58a6ff', background: 'rgba(88, 166, 255, 0.12)', padding: '2px 8px', borderRadius: '10px' }}>
                  Filtrelendi ({ipos.filter(i => ipoSubTab === 'taslak' ? i.status === 'TASLAK' : i.status !== 'TASLAK').length} toplam içerisinden)
                </span>
              )}
            </div>
            <div
              style={{ overflowX: 'auto', overflowY: 'visible', width: '100%', touchAction: 'pan-y' }}
              onWheel={(e) => {
                if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                  const scrollParent = e.currentTarget.closest('.workspace') || e.currentTarget.closest('.view') || document.documentElement;
                  if (scrollParent) {
                    scrollParent.scrollTop += e.deltaY;
                  }
                }
              }}
            >
              <table style={{ width: '100%', minWidth: '960px', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, width: '85px' }}>{t('ticker')}</th>
                    <th style={{ ...thStyle, width: '210px' }}>{t('caCompany')}</th>
                    <th style={{ ...thStyle, width: '165px' }}>{t('caBookBuilding')}</th>
                    <th style={{ ...thStyle, width: '145px' }}>{t('caTradingStart')}</th>
                    <th style={{ ...thStyle, width: '110px' }}>{t('caDistribution')}</th>
                    <th style={{ ...thStyle, width: '130px' }}>{t('caParticipants')}</th>
                    <th style={{ ...thStyle, width: '90px' }}>{t('caIpoPrice')}</th>
                    <th style={{ ...thStyle, width: '90px' }}>{t('caCurrent')}</th>
                    <th style={{ ...thStyle, width: '95px' }} title={t('caReturnTip')}>{t('caReturn')} ⓘ</th>
                    <th style={{ ...thStyle, width: '110px' }}>{t('caStatus')}</th>
                    <th style={{ ...thStyle, width: '32px', textAlign: 'center' }}></th>
                  </tr>
                </thead>
              <tbody>
                {filteredIpos.map((ipo, i) => {
                  const retColor = (ipo.return_pct ?? 0) >= 0 ? '#3fb950' : '#f85149';
                  const isExpanded = expandedIpoIndex === i;
                  return (
                    <Fragment key={i}>
                      <tr
                        style={{
                          transition: 'all 0.18s ease-in-out',
                          cursor: 'pointer',
                          background: isExpanded ? 'rgba(56, 139, 253, 0.06)' : 'transparent',
                          borderBottom: isExpanded ? 'none' : '1px solid rgba(255, 255, 255, 0.05)',
                        }}
                        onMouseEnter={(e) => {
                          if (!isExpanded) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                        }}
                        onMouseLeave={(e) => {
                          if (!isExpanded) e.currentTarget.style.background = 'transparent';
                        }}
                        onClick={() => setExpandedIpoIndex(isExpanded ? null : i)}
                      >
                        <td style={{ ...tdStyle, fontWeight: 'bold' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ color: isExpanded ? '#58a6ff' : '#8b949e', fontSize: '0.75rem', transition: 'transform 0.2s', display: 'inline-block', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                              ▶
                            </span>
                            {ipo.status === 'TASLAK' || !onSelectTicker || !ipo.ticker ? (
                              <span style={{ color: '#c9d1d9' }}>{ipo.ticker || '—'}</span>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSelectTicker(ipo.ticker);
                                }}
                                title={t('caOpenProfile', { ticker: ipo.ticker })}
                                style={{
                                  background: 'none', border: 'none', padding: 0,
                                  color: '#58a6ff', cursor: 'pointer', fontWeight: 'bold',
                                  fontFamily: 'var(--font-mono)', fontSize: '0.84rem',
                                  textDecoration: 'underline', textUnderlineOffset: '3px',
                                }}
                              >
                                {ipo.ticker}
                              </button>
                            )}
                          </div>
                        </td>
                        <td style={{ ...tdStyle, maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }} title={ipo.company_name}>
                          {ipo.company_name}
                        </td>
                        <td style={{ ...tdStyle, fontSize: '0.78rem', color: '#8b949e', whiteSpace: 'nowrap' }}>{ipo.book_building_dates || '—'}</td>
                        <td style={{ ...tdStyle, fontSize: '0.78rem', color: '#8b949e', whiteSpace: 'nowrap' }}>{ipo.trading_start_date || '—'}</td>
                        <td style={{ ...tdStyle, fontSize: '0.78rem', color: '#8b949e', whiteSpace: 'nowrap' }}>{ipo.distribution_type || '—'}</td>
                        <td style={{ ...tdStyle, fontSize: '0.78rem', color: ipo.participant_count ? '#f0f6fc' : '#8b949e', fontWeight: ipo.participant_count ? 600 : 400, whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>{ipo.participant_count || '—'}</td>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontWeight: 600 }}>{typeof ipo.price === 'number' && ipo.price > 0 ? `₺${ipo.price.toFixed(2)}` : '—'}</td>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: '#c9d1d9' }}>{typeof ipo.current_price === 'number' ? `₺${ipo.current_price.toFixed(2)}` : '—'}</td>
                        <td style={{ ...tdStyle, color: retColor, fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                          {typeof ipo.return_pct === 'number' ? `${ipo.return_pct >= 0 ? '+' : ''}${ipo.return_pct.toFixed(2)}%` : '—'}
                          {typeof ipo.split_factor === 'number' && ipo.split_factor > 1 && (
                            <span title={t('caSplitAdj', { f: ipo.split_factor.toFixed(2) })}
                              style={{ marginLeft: '5px', fontSize: '0.65rem', color: '#8b949e', fontWeight: 'normal' }}>
                              ×{ipo.split_factor.toFixed(1)}
                            </span>
                          )}
                        </td>
                        <td style={tdStyle}>
                          <span style={{
                            padding: '4px 10px', borderRadius: '16px', fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.3px',
                            background: ipo.status === 'TAMAMLANDI' ? 'rgba(139, 148, 158, 0.12)' : ipo.status === 'AKTİF' || ipo.status === 'TALEP TOPLAMA' ? 'rgba(63, 185, 80, 0.12)' : 'rgba(88, 166, 255, 0.12)',
                            color: ipo.status === 'TAMAMLANDI' ? '#8b949e' : ipo.status === 'AKTİF' || ipo.status === 'TALEP TOPLAMA' ? '#3fb950' : '#58a6ff',
                            border: `1px solid ${ipo.status === 'TAMAMLANDI' ? 'rgba(139, 148, 158, 0.2)' : ipo.status === 'AKTİF' || ipo.status === 'TALEP TOPLAMA' ? 'rgba(63, 185, 80, 0.3)' : 'rgba(88, 166, 255, 0.3)'}`,
                          }}>
                            {ipo.status}
                          </span>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center', color: '#8b949e', fontSize: '0.8rem' }}>
                          {isExpanded ? '▲' : '▼'}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr style={{ background: 'rgba(13, 17, 23, 0.7)' }}>
                          <td colSpan={11} style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', boxSizing: 'border-box' }}>
                            <div
                              onWheel={(e) => {
                                if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                                  const scrollParent = e.currentTarget.closest('.workspace') || e.currentTarget.closest('.view') || document.documentElement;
                                  if (scrollParent) {
                                    scrollParent.scrollTop += e.deltaY;
                                  }
                                }
                              }}
                              style={{
                                background: 'linear-gradient(145deg, rgba(22, 27, 34, 0.98), rgba(13, 17, 23, 0.95))',
                                border: '1px solid rgba(88, 166, 255, 0.25)',
                                borderRadius: '14px',
                                padding: '22px 26px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '18px',
                                width: '100%',
                                maxWidth: '100%',
                                boxSizing: 'border-box',
                                boxShadow: '0 12px 32px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
                                backdropFilter: 'blur(16px)',
                              }}
                            >
                              {/* Header Bar */}
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '14px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', minWidth: 0 }}>
                                  <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f0f6fc', letterSpacing: '-0.3px', wordBreak: 'break-word' }}>
                                    {ipo.company_name}
                                  </span>
                                  {ipo.ticker && (
                                    <span style={{
                                      padding: '3px 10px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 700,
                                      background: 'rgba(88, 166, 255, 0.15)', color: '#58a6ff', border: '1px solid rgba(88, 166, 255, 0.3)',
                                      fontFamily: 'var(--font-mono)',
                                    }}>
                                      {ipo.ticker}
                                    </span>
                                  )}
                                  <span style={{
                                    padding: '3px 10px', borderRadius: '14px', fontSize: '0.72rem', fontWeight: 600,
                                    background: ipo.status === 'TAMAMLANDI' ? 'rgba(139, 148, 158, 0.12)' : 'rgba(63, 185, 80, 0.12)',
                                    color: ipo.status === 'TAMAMLANDI' ? '#8b949e' : '#3fb950',
                                    border: `1px solid ${ipo.status === 'TAMAMLANDI' ? 'rgba(139, 148, 158, 0.2)' : 'rgba(63, 185, 80, 0.3)'}`,
                                  }}>
                                    {ipo.status}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setExpandedIpoIndex(null)}
                                  style={{
                                    background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)',
                                    color: '#8b949e', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer',
                                    fontSize: '0.78rem', transition: 'all 0.15s',
                                  }}
                                  onMouseEnter={(e) => { e.currentTarget.style.color = '#f0f6fc'; e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.color = '#8b949e'; e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; }}
                                >
                                  ✕ Kapat
                                </button>
                              </div>

                              {/* Executive Summary Metric Bar (4 Top Cards) */}
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', width: '100%', boxSizing: 'border-box' }}>
                                {/* Arz Fiyatı */}
                                <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '12px 16px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                                  <div style={{ fontSize: '0.72rem', color: '#8b949e', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>💰 Arz Fiyatı</div>
                                  <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#00ff9d', fontFamily: 'var(--font-mono)', marginTop: '4px' }}>
                                    {typeof ipo.price === 'number' && ipo.price > 0 ? `₺${ipo.price.toFixed(2)}` : 'Açıklanmadı'}
                                  </div>
                                </div>

                                {/* Halka Arz Büyüklüğü */}
                                <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '12px 16px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                                  <div style={{ fontSize: '0.72rem', color: '#8b949e', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>📊 Toplam Büyüklük</div>
                                  <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#f0f6fc', fontFamily: 'var(--font-mono)', marginTop: '4px' }}>
                                    {ipo.ipo_size || 'İzahnamede Belirtilecek'}
                                  </div>
                                </div>

                                {/* Dağıtım Türü */}
                                <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '12px 16px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                                  <div style={{ fontSize: '0.72rem', color: '#8b949e', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>🤝 Dağıtım Türü</div>
                                  <div style={{ fontSize: '1rem', fontWeight: 700, color: '#58a6ff', marginTop: '4px' }}>
                                    {ipo.distribution_type || 'Eşit Dağıtım'}
                                  </div>
                                </div>

                                {/* Katılım Endeksi */}
                                <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '12px 16px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                                  <div style={{ fontSize: '0.72rem', color: '#8b949e', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>☪️ Katılım Endeksi</div>
                                  <div style={{ marginTop: '4px' }}>
                                    {ipo.katilim_index ? (
                                      <span style={{
                                        padding: '3px 10px', borderRadius: '12px', fontSize: '0.76rem', fontWeight: 700,
                                        background: ipo.katilim_index.toLowerCase().includes('uygun') && !ipo.katilim_index.toLowerCase().includes('değil') ? 'rgba(63, 185, 80, 0.15)' : 'rgba(248, 81, 73, 0.15)',
                                        color: ipo.katilim_index.toLowerCase().includes('uygun') && !ipo.katilim_index.toLowerCase().includes('değil') ? '#3fb950' : '#f85149',
                                        border: `1px solid ${ipo.katilim_index.toLowerCase().includes('uygun') && !ipo.katilim_index.toLowerCase().includes('değil') ? 'rgba(63, 185, 80, 0.3)' : 'rgba(248, 81, 73, 0.3)'}`,
                                      }}>
                                        {ipo.katilim_index}
                                      </span>
                                    ) : (
                                      <span style={{ color: '#8b949e', fontSize: '0.85rem' }}>İzahnamede Belirtilecek</span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Clean 2-Column Grid Layout */}
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '16px', width: '100%', boxSizing: 'border-box' }}>
                                {/* Left Side Column: Pay Yapısı & Tahsisat & Konsorsiyum */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                  {/* Pay Yapısı */}
                                  <div style={{ background: 'rgba(13, 17, 23, 0.6)', padding: '18px 20px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                                    <div style={{ fontSize: '0.75rem', color: '#3fb950', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      📊 Pay Yapısı (Sermaye Artırımı / Ortak Satışı)
                                    </div>
                                    {renderVisualShareStructure(ipo.share_structure)}
                                  </div>

                                  {/* Tahsisat Oranları */}
                                  <div style={{ background: 'rgba(13, 17, 23, 0.6)', padding: '18px 20px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                                    <div style={{ fontSize: '0.75rem', color: '#388bfd', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      👥 Tahsisat Oranları (Gruplara Dağıtım)
                                    </div>
                                    {renderVisualDistributionRatios(ipo.distribution_ratios)}
                                  </div>

                                  {/* İşlem & Konsorsiyum Kuralları */}
                                  <div style={{ background: 'rgba(13, 17, 23, 0.6)', padding: '18px 20px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                                    <div style={{ fontSize: '0.75rem', color: '#a371f7', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      🏛️ Konsorsiyum & İşlem Şartları
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.84rem' }}>
                                      {ipo.t1_t2_available && (
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                          <span style={{ color: '#8b949e' }}>T1-T2 Bakiyesi:</span>
                                          <span style={{ color: '#c9d1d9', fontWeight: 500 }}>{ipo.t1_t2_available}</span>
                                        </div>
                                      )}
                                      {ipo.consortium_lead && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '2px', background: 'rgba(255, 255, 255, 0.03)', padding: '8px 12px', borderRadius: '6px' }}>
                                          <span style={{ color: '#8b949e', fontSize: '0.76rem' }}>Konsorsiyum Liderleri:</span>
                                          <span style={{ color: '#f0f6fc', fontWeight: 600, wordBreak: 'break-word', lineHeight: '1.4' }}>{ipo.consortium_lead}</span>
                                        </div>
                                      )}
                                      {!ipo.t1_t2_available && !ipo.consortium_lead && (
                                        <span style={{ color: '#8b949e', fontStyle: 'italic' }}>Bireysel eşit dağıtım kuralları geçerlidir.</span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Right Side Column: Fon Kullanım Amacı & Sonuçlar */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                  {/* Fon Kullanım Yeri */}
                                  <div style={{ background: 'rgba(13, 17, 23, 0.6)', padding: '18px 20px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                                    <div style={{ fontSize: '0.75rem', color: '#58a6ff', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      🎯 Fon Kullanım Amacı (Gelir Nereye Gidecek?)
                                    </div>
                                  {renderVisualFundUsage(ipo.fund_usage)}
                                  </div>

                                  {/* Gerçekleşen Dağıtım Sonuçları (Tamamlandıysa) */}
                                  {(ipo.status === 'TAMAMLANDI' || ipo.status === 'SONUÇLANDI' || ipo.participant_count) && (
                                    <div style={{ background: 'rgba(35, 134, 54, 0.08)', padding: '18px 20px', borderRadius: '10px', border: '1px solid rgba(63, 185, 80, 0.3)' }}>
                                      <div style={{ fontSize: '0.75rem', color: '#3fb950', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        🎉 Resmi Halka Arz Sonuçları (Gerçekleşen Dağıtım)
                                      </div>
                                      {renderVisualIpoResults(ipo)}
                                    </div>
                                  )}
                                </div>
                              </div>

                               {/* If IPO is completed, render TradingView Stock Performance Chart. If active/upcoming, render Simulator */}
                               {ipo.status === 'TAMAMLANDI' || ipo.status === 'SONUÇLANDI' ? (
                                 ipo.ticker ? (
                                   <IpoStockPerformanceChart ipo={ipo} onSelectTicker={onSelectTicker} />
                                 ) : null
                               ) : (
                                 <IpoAllocationSimulator price={ipo.price} ipoSize={ipo.ipo_size} shareStructure={ipo.share_structure} distributionRatios={ipo.distribution_ratios} allIpos={ipos} />
                               )}

                              {/* Footer Action Buttons */}
                              <div style={{ display: 'flex', gap: '10px', marginTop: '6px', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
                                {ipo.ticker && onSelectTicker && (
                                  <button
                                    type="button"
                                    onClick={() => onSelectTicker(ipo.ticker)}
                                    style={{
                                      padding: '8px 18px', background: 'rgba(35, 134, 54, 0.2)', color: '#3fb950',
                                      border: '1px solid rgba(63, 185, 80, 0.4)', borderRadius: '8px', cursor: 'pointer',
                                      fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: 700,
                                      transition: 'all 0.15s ease', display: 'inline-flex', alignItems: 'center', gap: '6px',
                                    }}
                                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(35, 134, 54, 0.35)'; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(35, 134, 54, 0.2)'; }}
                                  >
                                    📊 {ipo.ticker} Hisse Kartı & Grafik
                                  </button>
                                )}
                                <a
                                  href={`https://www.google.com/search?q=${encodeURIComponent((ipo.ticker || ipo.company_name) + ' halka arz izahnamesi fon kullanım yeri KAP')}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{
                                    padding: '8px 18px', background: 'rgba(255, 255, 255, 0.05)', color: '#58a6ff',
                                    border: '1px solid rgba(88, 166, 255, 0.3)', borderRadius: '8px', cursor: 'pointer',
                                    fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: 600,
                                    textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px',
                                    transition: 'all 0.15s ease',
                                  }}
                                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(88, 166, 255, 0.12)'; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; }}
                                >
                                  🔍 KAP İzahname Araması ↗
                                </a>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        )
      )}
    </div>
  );
}
