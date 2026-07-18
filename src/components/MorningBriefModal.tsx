import { useEffect, useMemo, useState } from 'react';
import { getDashboardSnapshot } from '../api/tauriClient';
import { isBistEquity } from '../lib/equityGroups';
import { watchlistSummary } from '../hooks/useMorningBrief';
import { useTranslation } from '../api/i18n';
import type { DashboardSnapshot, EquityRow } from '../types';

interface MorningBriefModalProps {
  open: boolean;
  onClose: () => void;
  /** Satıra tıklanınca hisse sekmesi açılır; popup kapanır. */
  onSelectTicker: (ticker: string) => void;
  onOpenDashboard: () => void;
}

/**
 * Günlük özet popup'ı: banner'a (veya paletteki komuta) tıklanınca açılır.
 *
 * Banner'daki satırlar uygulama açılışında bir kez derlendiği için gün içinde
 * eskiyebilir; popup ise her açılışta anlık görüntüden taze derlenir. Veri
 * store'dan okunduğundan açılışı ağ beklemez.
 */
export default function MorningBriefModal({ open, onClose, onSelectTicker, onOpenDashboard }: MorningBriefModalProps) {
  const { t, lang } = useTranslation();
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getDashboardSnapshot()
      .then((snap) => { if (!cancelled) setSnapshot(snap); })
      .catch(() => { /* store boşsa bölümler boş durumlarını gösterir */ });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const stats = useMemo(() => {
    if (!snapshot) return null;
    const bist = (snapshot.equities ?? []).filter(
      (row) => isBistEquity(row) && row.price > 0 && Number.isFinite(row.change_pct),
    );
    const up = bist.filter((row) => row.change_pct > 0).length;
    const down = bist.filter((row) => row.change_pct < 0).length;
    const flat = Math.max(bist.length - up - down, 0);
    const sorted = [...bist].sort((a, b) => b.change_pct - a.change_pct);
    const gainers = sorted.filter((row) => row.change_pct > 0).slice(0, 5);
    const losers = sorted.filter((row) => row.change_pct < 0).slice(-5).reverse();
    const oversold = bist
      .filter((row) => row.rsi > 0 && row.rsi < 30)
      .sort((a, b) => a.rsi - b.rsi)
      .slice(0, 5);
    const metrics = (snapshot.market_metrics ?? []).filter((metric) =>
      ['BIST 100', 'USD/TRY', 'Altın Ons ($)', 'Bitcoin ($)'].includes(metric.symbol),
    );
    const kap = (snapshot.kap_announcements ?? []).slice(0, 4);
    const kapCount = snapshot.kap_announcements?.length ?? 0;
    const headline = up + down > 0
      ? (up >= down ? t('briefHeadlinePositive', { up, down }) : t('briefHeadlineNegative', { up, down }))
      : t('briefTitlePlain');
    return { up, down, flat, total: bist.length, gainers, losers, oversold, metrics, kap, kapCount, headline, wl: watchlistSummary(snapshot) };
  }, [snapshot, t]);

  if (!open) return null;

  const dateLabel = new Date().toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  const equityRow = (row: EquityRow, valueLabel: string, positive: boolean) => (
    <button
      key={row.ticker}
      type="button"
      className="brief-row"
      onClick={() => { onSelectTicker(row.ticker); onClose(); }}
    >
      <span className="brief-row-ticker">{row.ticker}</span>
      <span className="brief-row-name">{row.name}</span>
      <span className={`brief-row-val ${positive ? 'positive' : 'negative'}`}>{valueLabel}</span>
    </button>
  );

  return (
    <div className="brief-backdrop" onClick={onClose}>
      <div className="brief-modal" onClick={(event) => event.stopPropagation()}>
        <div className="brief-head">
          <div>
            <h2>☀️ {t('briefTitle')}</h2>
            <span className="brief-sub">{dateLabel}{stats ? ` · ${stats.headline}` : ''}</span>
          </div>
          <button type="button" className="brief-close" onClick={onClose} title={t('closeEsc')}>×</button>
        </div>

        {!stats ? (
          <div className="eco-cal-empty">{t('briefCompiling')}</div>
        ) : (
          <>
            {stats.metrics.length > 0 && (
              <div className="brief-metrics">
                {stats.metrics.map((metric) => (
                  <div key={metric.symbol} className="brief-metric">
                    <span>{metric.symbol}</span>
                    <strong>{metric.value}</strong>
                    <em className={metric.positive ? 'positive' : 'negative'}>{metric.change}</em>
                  </div>
                ))}
              </div>
            )}

            {stats.total > 0 && (
              <div className="brief-breadth" title={t('briefBreadth', { up: stats.up, flat: stats.flat, down: stats.down })}>
                <div className="brief-breadth-bar">
                  <i className="up" style={{ width: `${(stats.up / stats.total) * 100}%` }} />
                  <i className="flat" style={{ width: `${(stats.flat / stats.total) * 100}%` }} />
                  <i className="down" style={{ width: `${(stats.down / stats.total) * 100}%` }} />
                </div>
                <span>{t('briefBreadth', { up: stats.up, flat: stats.flat, down: stats.down })}</span>
              </div>
            )}

            <div className="brief-grid">
              <section>
                <h3>{t('gainers')}</h3>
                {stats.gainers.length === 0 ? <span className="brief-empty">{t('noData')}</span>
                  : stats.gainers.map((row) => equityRow(row, `+${row.change_pct.toFixed(2)}%`, true))}
              </section>
              <section>
                <h3>{t('losers')}</h3>
                {stats.losers.length === 0 ? <span className="brief-empty">{t('noData')}</span>
                  : stats.losers.map((row) => equityRow(row, `${row.change_pct.toFixed(2)}%`, false))}
              </section>
              <section>
                <h3>{t('briefOversold')}</h3>
                {stats.oversold.length === 0 ? <span className="brief-empty">{t('briefNoOversold')}</span>
                  : stats.oversold.map((row) => equityRow(row, `RSI ${row.rsi.toFixed(1)}`, false))}
              </section>
              <section>
                <h3>{t('briefKapCount', { n: stats.kapCount })}</h3>
                {stats.kap.length === 0 ? <span className="brief-empty">{t('briefNoKap')}</span>
                  : stats.kap.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="brief-row"
                      onClick={() => { onSelectTicker(item.ticker); onClose(); }}
                      title={item.title}
                    >
                      <span className="brief-row-ticker">{item.ticker}</span>
                      <span className="brief-row-name">{item.title}</span>
                    </button>
                  ))}
              </section>
            </div>

            {stats.wl && <div className="brief-watchlist">{stats.wl}</div>}
          </>
        )}

        <div className="brief-foot">
          <button
            type="button"
            className="small-button"
            onClick={() => { onOpenDashboard(); onClose(); }}
          >
            {t('goToDashboard')} →
          </button>
        </div>
      </div>
    </div>
  );
}
