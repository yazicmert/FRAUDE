import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getAnalystReports,
  getDashboardSnapshot,
  getNewsFeed,
  listKapAnnouncements,
} from '../../api/tauriClient';
import { useTranslation } from '../../api/i18n';
import { dispatchAiAsk } from '../../lib/actions';
import KapDocumentViewerModal from '../kap/KapDocumentViewerModal';
import ReportDocumentModal, {
  documentFromReport,
  type ViewerDocument,
} from '../reports/ReportDocumentModal';
import { NewsList } from '../news/NewsFeedView';
import type { AnalystReport, KapAnnouncement, NewsItem, SpkBulletin } from '../../types';

/** Deponun beslendiği dört kaynak. */
type EntryKind = 'kap' | 'spk' | 'report' | 'news';

type TabKey = 'all' | EntryKind;

const TABS: TabKey[] = ['all', 'kap', 'spk', 'report', 'news'];

const TAB_KEY: Record<TabKey, string> = {
  all: 'knowledgeTabAll',
  kap: 'knowledgeTabKap',
  spk: 'knowledgeTabSpk',
  report: 'knowledgeTabReports',
  news: 'knowledgeTabNews',
};

const KIND_COLOR: Record<EntryKind, string> = {
  kap: '#ffb800',
  spk: '#a371f7',
  report: '#58a6ff',
  news: '#3fb950',
};

const REPORT_KIND_KEY: Record<AnalystReport['kind'], string> = {
  company: 'reportKindCompany',
  sector: 'reportKindSector',
  strategy: 'reportKindStrategy',
  bulletin: 'reportKindBulletin',
  other: 'reportKindOther',
};

/**
 * Deponun tek satırı. Dört kaynak da buna indirgenir; liste kaydın nereden
 * geldiğini yalnız `kind` üzerinden bilir, `payload` ise satır açıldığında
 * doğru okuyucuya verilmek üzere özgün kaydı taşır.
 */
interface FeedEntry {
  key: string;
  kind: EntryKind;
  title: string;
  /** Rozet metni: KAP'ta hisse kodu, SPK'da "SPK", raporda kurum, haberde kaynak. */
  badge: string;
  /** Ekranda gösterilen tarih metni. */
  date: string;
  /** Sıralama anahtarı; çözülemeyen tarih 0 olur ve listenin sonuna düşer. */
  ts: number;
  summary?: string | null;
  tickers: string[];
  payload:
    | { kind: 'kap'; item: KapAnnouncement }
    | { kind: 'spk'; item: SpkBulletin }
    | { kind: 'report'; item: AnalystReport }
    | { kind: 'news'; item: NewsItem };
}

/**
 * Dört kaynağın tarih biçimi birbirini tutmuyor; hepsini tek ölçeğe indirir.
 *
 * KAP "2026-08-10 14:32", SPK "10.08.2026", rapor "2026-08-10", haber ise ya
 * RFC 2822 ya da GDELT'in "20260810T143200Z" damgası. Çözülemeyen değer 0
 * döner — kayıt gizlenmez, yalnız sıralamada sona düşer.
 */
export function parseFeedTimestamp(value: string): number {
  const raw = (value ?? '').trim();
  if (!raw) return 0;

  const gdelt = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (gdelt) {
    const [, y, m, d, hh, mm, ss] = gdelt;
    return Date.parse(`${y}-${m}-${d}T${hh}:${mm}:${ss}Z`);
  }

  // "10.08.2026" / "10-08-2026" — gün önce gelir, Date.parse bunu ters okur.
  const dotted = raw.match(/^(\d{2})[.-](\d{2})[.-](\d{4})/);
  if (dotted) {
    const [, d, m, y] = dotted;
    return Date.parse(`${y}-${m}-${d}T00:00:00Z`);
  }

  // "2026-08-10" ve "2026-08-10 14:32" — boşluklu biçim Safari/WebKit'te
  // ayrıştırılamıyor, araya 'T' konur.
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})[ T]?(\d{2}:\d{2}(:\d{2})?)?/);
  if (iso) {
    const parsed = Date.parse(`${iso[1]}T${iso[2] ?? '00:00'}${iso[2] ? '' : ':00'}Z`);
    if (!Number.isNaN(parsed)) return parsed;
  }

  const fallback = Date.parse(raw);
  return Number.isNaN(fallback) ? 0 : fallback;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('tr');
}

/** KAP bildiriminin yapay zekâ önem puanını renk sınıfına çevirir. */
function scoreClass(score: number): string {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

interface KnowledgeBaseViewProps {
  initialRows?: KapAnnouncement[];
  onSelectTicker?: (ticker: string) => void;
}

/**
 * Bilgi Deposu — KAP, SPK, aracı kurum analizleri ve haberler tek akışta.
 *
 * Dört kaynak ayrı ekranlarda dururken bir şirket hakkında ne olduğunu görmek
 * için dört yere bakmak gerekiyordu. Burada hepsi tek zaman çizgisinde
 * birleşir; arama ve tür süzgeci akışın tamamına uygulanır. Kayıt açıldığında
 * kendi okuyucusuna gider: KAP bildirimi KAP okuyucusuna, SPK bülteni ve
 * analiz raporu gömülü belge okuyucusuna, haber ise haber okuyucusuna —
 * hiçbiri uygulamadan çıkmaz.
 */
export default function KnowledgeBaseView({ initialRows, onSelectTicker }: KnowledgeBaseViewProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabKey>('all');
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(80);

  const [kap, setKap] = useState<KapAnnouncement[]>(initialRows ?? []);
  const [spk, setSpk] = useState<SpkBulletin[]>([]);
  const [reports, setReports] = useState<AnalystReport[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [openKap, setOpenKap] = useState<KapAnnouncement | null>(null);
  const [openDocument, setOpenDocument] = useState<ViewerDocument | null>(null);

  /**
   * Dört kaynak paralel çekilir ve **her biri kendi başına** değerlendirilir:
   * birinin düşmesi depoyu boşaltmaz, yalnız o bölüm eksik kalır.
   */
  const load = useCallback(async () => {
    setLoading(true);
    const [kapResult, snapshotResult, reportResult, newsResult] = await Promise.allSettled([
      listKapAnnouncements(),
      getDashboardSnapshot(),
      getAnalystReports(undefined, false),
      getNewsFeed(),
    ]);
    if (kapResult.status === 'fulfilled') setKap(kapResult.value);
    if (snapshotResult.status === 'fulfilled') setSpk(snapshotResult.value.spk_bulletins ?? []);
    if (reportResult.status === 'fulfilled') setReports(reportResult.value.reports);
    if (newsResult.status === 'fulfilled') setNews(newsResult.value);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Senkron bittiğinde depo da tazelensin; KAP akışıyla aynı sözleşme.
  useEffect(() => {
    const handler = () => void load();
    window.addEventListener('fraude-sync-completed', handler);
    return () => window.removeEventListener('fraude-sync-completed', handler);
  }, [load]);

  const entries = useMemo<FeedEntry[]>(() => {
    const all: FeedEntry[] = [];

    for (const item of kap) {
      all.push({
        key: `kap-${item.id}`,
        kind: 'kap',
        title: item.title,
        badge: item.ticker,
        date: item.date,
        ts: parseFeedTimestamp(item.date),
        summary: item.summary,
        tickers: item.ticker ? [item.ticker] : [],
        payload: { kind: 'kap', item },
      });
    }

    for (const item of spk) {
      all.push({
        key: `spk-${item.url}`,
        kind: 'spk',
        title: item.title,
        badge: 'SPK',
        date: item.date,
        ts: parseFeedTimestamp(item.date),
        tickers: [],
        payload: { kind: 'spk', item },
      });
    }

    for (const item of reports) {
      all.push({
        key: `report-${item.id}`,
        kind: 'report',
        title: item.title,
        badge: item.broker,
        date: item.published,
        ts: parseFeedTimestamp(item.published),
        summary: item.summary,
        tickers: item.tickers,
        payload: { kind: 'report', item },
      });
    }

    for (const item of news) {
      all.push({
        key: `news-${item.link}`,
        kind: 'news',
        title: item.title,
        badge: item.is_kap ? 'KAP' : item.source,
        date: item.pub_date,
        ts: parseFeedTimestamp(item.pub_date),
        summary: item.summary,
        tickers: item.ticker ? [item.ticker] : [],
        payload: { kind: 'news', item },
      });
    }

    return all.sort((a, b) => b.ts - a.ts);
  }, [kap, spk, reports, news]);

  const counts = useMemo(() => {
    const map: Record<TabKey, number> = { all: entries.length, kap: 0, spk: 0, report: 0, news: 0 };
    for (const entry of entries) map[entry.kind] += 1;
    return map;
  }, [entries]);

  const filtered = useMemo(() => {
    const needle = normalize(query.trim());
    return entries.filter((entry) => {
      if (tab !== 'all' && entry.kind !== tab) return false;
      if (!needle) return true;
      return (
        normalize(entry.title).includes(needle) ||
        normalize(entry.badge).includes(needle) ||
        entry.tickers.some((code) => normalize(code).includes(needle))
      );
    });
  }, [entries, tab, query]);

  useEffect(() => {
    setVisible(80);
  }, [tab, query]);

  const openEntry = (entry: FeedEntry) => {
    const { payload } = entry;
    if (payload.kind === 'kap') {
      setOpenKap(payload.item);
      return;
    }
    if (payload.kind === 'spk') {
      setOpenDocument({
        id: payload.item.url,
        title: payload.item.title,
        source: 'SPK',
        kindLabel: t('knowledgeTabSpk'),
        published: payload.item.date,
        url: payload.item.url,
        pdfUrl: payload.item.url,
      });
      return;
    }
    if (payload.kind === 'report') {
      setOpenDocument(documentFromReport(payload.item, t(REPORT_KIND_KEY[payload.item.kind])));
    }
    // Haber kaydı kendi okuyucusunu satırın içinde açar; burada bir iş yok.
  };

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <p className="eyebrow">{t('knowledgeBase')}</p>
          <h1>{t('knowledgeBase')}</h1>
          <p style={{ fontSize: '0.82rem', color: '#8b949e', marginTop: '4px' }}>
            {t('knowledgeBaseSubtitle')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            className="kap-filter-input"
            placeholder={t('knowledgeSearchPlaceholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="button" className="small-button" onClick={() => void load()}>
            {t('kapRefresh')}
          </button>
        </div>
      </div>

      <div className="tabs" style={{ width: 'fit-content', margin: '10px 0 14px' }}>
        {TABS.map((value) => (
          <button
            key={value}
            type="button"
            className={`tab-button${tab === value ? ' active' : ''}`}
            onClick={() => setTab(value)}
          >
            {t(TAB_KEY[value])} ({counts[value]})
          </button>
        ))}
      </div>

      {loading && entries.length === 0 && <div className="empty-state">{t('loadingData')}</div>}
      {!loading && filtered.length === 0 && <div className="empty-state">{t('knowledgeEmpty')}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {filtered.slice(0, visible).map((entry) =>
          entry.payload.kind === 'news' ? (
            // Haber satırı kendi bileşeniyle çizilir; okuyucusu ve önizleme
            // getirmesi orada yaşıyor, burada kopyalanmaz.
            <NewsList key={entry.key} news={[entry.payload.item]} />
          ) : (
            <article
              key={entry.key}
              className="kap-item-enhanced"
              role="button"
              tabIndex={0}
              onClick={() => openEntry(entry)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openEntry(entry);
                }
              }}
            >
              <div className="kap-item-header">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '10px',
                        fontSize: '0.66rem',
                        fontWeight: 'bold',
                        background: `${KIND_COLOR[entry.kind]}22`,
                        color: KIND_COLOR[entry.kind],
                      }}
                    >
                      {t(TAB_KEY[entry.kind])}
                    </span>
                    <span className="kap-item-ticker">{entry.badge}</span>
                    <span className="kap-item-title">{entry.title}</span>
                  </div>
                  <div className="kap-item-meta">
                    <span className="kap-item-date">{entry.date}</span>
                    {entry.payload.kind === 'kap' && (
                      <>
                        <span className="kap-item-category">{entry.payload.item.category}</span>
                        <span className={`kap-item-score ${scoreClass(entry.payload.item.ai_importance_score)}`}>
                          AI {entry.payload.item.ai_importance_score}
                        </span>
                      </>
                    )}
                    {entry.payload.kind === 'report' && entry.payload.item.rating && (
                      <span className="kap-item-category">{entry.payload.item.rating}</span>
                    )}
                  </div>
                </div>
              </div>

              {entry.summary && <p className="kap-item-summary">{entry.summary}</p>}

              {entry.tickers.length > 0 && (
                <div
                  style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}
                  onClick={(event) => event.stopPropagation()}
                >
                  {entry.tickers.map((code) => (
                    <button
                      key={code}
                      type="button"
                      className="small-button"
                      style={{ fontSize: '0.68rem', padding: '3px 9px' }}
                      onClick={() => onSelectTicker?.(code)}
                    >
                      {code}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="small-button"
                    style={{ fontSize: '0.68rem', padding: '3px 9px' }}
                    onClick={() =>
                      dispatchAiAsk(
                        `${entry.badge} — "${entry.title}" başlıklı kaydı yatırımcı gözüyle 2-3 cümlede özetle ve olası etkisini belirt. Yatırım tavsiyesi verme.`,
                      )
                    }
                  >
                    🤖 {t('knowledgeSummarize')}
                  </button>
                </div>
              )}
            </article>
          ),
        )}

        {filtered.length > visible && (
          <button
            type="button"
            className="tab-button"
            onClick={() => setVisible((current) => current + 80)}
            style={{ alignSelf: 'center', padding: '8px 18px', marginTop: '4px' }}
          >
            {t('reportsShowMore')} ({filtered.length - visible})
          </button>
        )}
      </div>

      <KapDocumentViewerModal
        announcement={openKap}
        onClose={() => setOpenKap(null)}
        onAskAi={(prompt) => dispatchAiAsk(prompt)}
      />

      <ReportDocumentModal
        document={openDocument}
        onClose={() => setOpenDocument(null)}
        onSelectTicker={onSelectTicker}
      />
    </div>
  );
}
