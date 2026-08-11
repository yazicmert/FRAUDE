import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getAnalystReports,
  getKapForTicker,
  getNewsFeed,
  getSpkBulletins,
  listKapAnnouncements,
} from '../../api/tauriClient';
import { useTranslation } from '../../api/i18n';
import { dispatchAiAsk } from '../../lib/actions';
import KapDocumentViewerModal from '../kap/KapDocumentViewerModal';
import ReportDocumentModal, {
  documentFromReport,
  type ViewerDocument,
} from '../reports/ReportDocumentModal';
import ConsensusTable, { formatPrice } from '../reports/ConsensusTable';
import { NewsList } from '../news/NewsFeedView';
import type {
  AnalystConsensus,
  AnalystReport,
  KapAnnouncement,
  NewsItem,
  SpkBulletin,
} from '../../types';

/** Deponun beslendiği dört kaynak. */
type EntryKind = 'kap' | 'spk' | 'report' | 'news';

/** Dört kaynağın sekmeleri + kurum toplamlarının kendi sekmesi. */
type TabKey = 'all' | EntryKind | 'consensus';

const TABS: TabKey[] = ['all', 'kap', 'spk', 'report', 'news', 'consensus'];

const TAB_KEY: Record<TabKey, string> = {
  all: 'knowledgeTabAll',
  kap: 'knowledgeTabKap',
  spk: 'knowledgeTabSpk',
  report: 'knowledgeTabReports',
  news: 'knowledgeTabNews',
  consensus: 'reportsTabConsensus',
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
 * Rapor türlerinin ekran sırası. Şirket raporları en değerlisi olduğu için
 * başta; bültenler günlük akışta çok sayıda olduğundan sonda.
 */
const REPORT_KIND_ORDER: AnalystReport['kind'][] = [
  'company',
  'sector',
  'strategy',
  'bulletin',
  'other',
];

/** "Hepsi" seçeneği için süzgeç değeri. */
const ALL = '__all__';

/** Bir seferde çizilen kayıt sayısı. */
const PAGE_SIZE = 80;

/**
 * Depodan istenen KAP bildirim sayısı.
 *
 * Depo canlı akışın son kayıtlarını tutuyor (şu an 40); sınır onun üstünde
 * tutulur ki uç derinleştiğinde burayı değiştirmek gerekmesin.
 */
const KAP_WINDOW = 500;

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

/** Türkçe ay adları — SPK bülten tarihleri "08 Temmuz 2026 Çarşamba" gelir. */
const TR_MONTHS = [
  'ocak', 'şubat', 'mart', 'nisan', 'mayıs', 'haziran',
  'temmuz', 'ağustos', 'eylül', 'ekim', 'kasım', 'aralık',
];

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

  // "08 Temmuz 2026 Çarşamba" — SPK bültenlerinin güncel blok düzeni tarihi
  // Türkçe uzun biçimde veriyor. `Date.parse` bunu NaN okuyordu: bütün SPK
  // kayıtları ts=0 ile akışın en dibine düşüyor, zaman çizgisine hiç
  // karışmıyordu. (Eski tablo düzeni ISO verir, o yukarıda çözülür.)
  const turkish = raw.match(/^(\d{1,2})\s+(\p{L}+)\s+(\d{4})/u);
  if (turkish) {
    const month = TR_MONTHS.indexOf(turkish[2].toLocaleLowerCase('tr'));
    if (month >= 0) {
      const day = turkish[1].padStart(2, '0');
      const parsed = Date.parse(`${turkish[3]}-${String(month + 1).padStart(2, '0')}-${day}T00:00:00Z`);
      if (!Number.isNaN(parsed)) return parsed;
    }
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

/**
 * Kaydın odaklanılan şirkete ait olup olmadığını söyler.
 *
 * KAP, rapor ve haber kayıtları hisse kodu taşır. SPK bültenleri taşımaz —
 * haftalık bülten tek bir şirkete ait değil — bu yüzden onlar yalnız başlıkta
 * kod geçiyorsa listeye girer. Kodu uydurup bülteni şirkete bağlamak, olmayan
 * bir ilişki göstermek olur.
 */
function belongsToCompany(entry: FeedEntry, code: string): boolean {
  if (entry.tickers.some((ticker) => ticker.toUpperCase() === code)) return true;
  if (entry.kind === 'spk') return entry.title.toUpperCase().includes(code);
  return false;
}

interface KnowledgeBaseViewProps {
  initialRows?: KapAnnouncement[];
  /** Açılışta seçili sekme; eski "Analiz Raporları" kimliği buraya yönlendirilir. */
  initialTab?: TabKey;
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
 *
 * **Şirket odağı** deponun ana kullanımıdır: bir kod yazıldığında dört kaynak
 * da o şirkete indirgenir ve o şirketin rapor geçmişi kurumların hisse bazlı
 * uçlarından **yeniden çekilir** — arşiv taraması geriye doğru sınırlı olduğu
 * için depoda duran kayıtlar tek başına yetmez.
 */
export default function KnowledgeBaseView({
  initialRows,
  initialTab,
  onSelectTicker,
}: KnowledgeBaseViewProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabKey>(initialTab ?? 'all');
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);

  /** Odaklanılan şirket kodu (büyük harf) ya da boş. */
  const [company, setCompany] = useState('');
  /** Arama kutusundaki ham metin; Enter'a basılınca odak olur. */
  const [companyDraft, setCompanyDraft] = useState('');

  const [broker, setBroker] = useState<string>(ALL);
  const [reportKind, setReportKind] = useState<string>(ALL);

  const [kap, setKap] = useState<KapAnnouncement[]>(initialRows ?? []);
  const [spk, setSpk] = useState<SpkBulletin[]>([]);
  const [reports, setReports] = useState<AnalystReport[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [consensus, setConsensus] = useState<AnalystConsensus[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [sourceErrors, setSourceErrors] = useState<string[]>([]);
  /**
   * Hangi kaynaklar hâlâ yolda. Dört kaynak tek `await`te toplanırken en yavaş
   * olan (analiz raporları — kaynakların tazelenmesi saniyeler sürüyor) diğer
   * üçünü de bekletiyor, ekran o süre boyunca bomboş kalıyordu. Artık her
   * kaynak geldiği anda çiziliyor ve eksik olanlar burada işaretli duruyor.
   */
  const [pending, setPending] = useState<Set<EntryKind>>(new Set());
  /** Elle tazeleme sürüyor mu — derin tarama uzun sürer, düğme bunu söyler. */
  const [refreshing, setRefreshing] = useState(false);

  /** Şirket odağında kurumların hisse bazlı uçlarından gelen ek raporlar. */
  const [companyReports, setCompanyReports] = useState<AnalystReport[]>([]);
  /** Şirket odağında o payın KAP geçmişi (depo yalnız son bildirimleri tutar). */
  const [companyKap, setCompanyKap] = useState<KapAnnouncement[]>([]);
  const [companyLoading, setCompanyLoading] = useState(false);

  const [openKap, setOpenKap] = useState<KapAnnouncement | null>(null);
  const [openDocument, setOpenDocument] = useState<ViewerDocument | null>(null);

  /**
   * Dört kaynak paralel çekilir ve **her biri kendi başına** değerlendirilir:
   * birinin düşmesi depoyu boşaltmaz, yalnız o bölüm eksik kalır. Sonuçlar
   * beklenmez de: her kaynak kendi `then`inde ekrana düşer, böylece hızlı
   * gelenler (KAP yerel depodan) yavaş olanı (analiz raporları ağdan) beklemez.
   */
  const load = useCallback((forceRefresh = false) => {
    const sources: EntryKind[] = ['kap', 'spk', 'report', 'news'];
    setPending(new Set(sources));
    if (forceRefresh) setRefreshing(true);

    const settle = (kind: EntryKind) =>
      setPending((current) => {
        const next = new Set(current);
        next.delete(kind);
        return next;
      });

    // Deponun tamamı istenir: istemcinin varsayılan 25'lik penceresi akışı
    // birkaç güne indiriyordu.
    void listKapAnnouncements(undefined, KAP_WINDOW)
      .then(setKap)
      .catch(() => {})
      .finally(() => settle('kap'));

    // Pano anlık görüntüsü yerine bülten dizini: panoda yalnız son 10 bülten
    // var ve o çağrı ayrıca deponun hiç kullanmadığı piyasa göstergelerini de
    // ağdan topluyordu — ilk boyamayı boşuna bekletiyordu.
    void getSpkBulletins()
      .then(setSpk)
      .catch(() => {})
      .finally(() => settle('spk'));

    void getNewsFeed()
      .then(setNews)
      .catch(() => {})
      .finally(() => settle('news'));

    void getAnalystReports(undefined, forceRefresh)
      .then((payload) => {
        setReports(payload.reports);
        setConsensus(payload.consensus);
        setLastUpdated(payload.last_updated);
        setSourceErrors(payload.errors);
      })
      .catch(() => {})
      .finally(() => {
        settle('report');
        setRefreshing(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Senkron bittiğinde depo da tazelensin; KAP akışıyla aynı sözleşme.
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('fraude-sync-completed', handler);
    return () => window.removeEventListener('fraude-sync-completed', handler);
  }, [load]);

  /**
   * Şirket odaklanınca o şirketin geçmişi **kendi uçlarından** istenir; depo
   * yalnız son kayıtları tuttuğu için süzmek yetmez.
   *
   * - Raporlar: kurumların hisse bazlı uçları (İş Yatırım etiket akışı,
   *   Garanti arama, Ziraat hisse kategorisi) — arşiv sınırlı derinlikte
   *   tarandığı için depodaki kayıtlar bir şirketin tam geçmişini vermez.
   * - KAP: depo canlı akışın yalnız son ~40 bildirimini tutuyor, yani odakta
   *   o şirkete ait bildirim çoğu zaman hiç bulunmuyordu. `getKapForTicker`
   *   şirketin kendi bildirim geçmişini çekiyor.
   *
   * İkisi bağımsız çekilir: biri düşerse diğeri yine gelir.
   */
  useEffect(() => {
    if (!company) {
      setCompanyReports([]);
      setCompanyKap([]);
      return;
    }
    let cancelled = false;
    let outstanding = 2;
    setCompanyLoading(true);
    const settle = () => {
      outstanding -= 1;
      if (!cancelled && outstanding === 0) setCompanyLoading(false);
    };

    getAnalystReports(company, false)
      .then((payload) => {
        if (cancelled) return;
        setCompanyReports(payload.reports);
        // Hisse istendiğinde uç tek konsensüs kaydı döner; listedekiyle
        // birleştirilir ki odak kapatılınca tablo boşalmasın.
        if (payload.consensus.length > 0) {
          setConsensus((current) => {
            const rest = current.filter((row) => row.ticker !== company);
            return [...payload.consensus, ...rest];
          });
        }
      })
      .catch(() => {
        // Uç düşerse depodaki kayıtlarla devam edilir; ekran boşalmaz.
        if (!cancelled) setCompanyReports([]);
      })
      .finally(settle);

    getKapForTicker(company)
      .then((items) => {
        if (!cancelled) setCompanyKap(items);
      })
      .catch(() => {
        if (!cancelled) setCompanyKap([]);
      })
      .finally(settle);

    return () => {
      cancelled = true;
    };
  }, [company]);

  /**
   * Depodaki raporlar ile şirket odağında gelen raporlar tek listede
   * birleşir; aynı rapor iki uçtan gelebildiği için kimlikle teklenir.
   */
  const allReports = useMemo(() => {
    if (companyReports.length === 0) return reports;
    const seen = new Set(reports.map((report) => report.id));
    return [...reports, ...companyReports.filter((report) => !seen.has(report.id))];
  }, [reports, companyReports]);

  /** Depodaki KAP bildirimleri ile odaktaki şirketin geçmişi birleşir. */
  const allKap = useMemo(() => {
    if (companyKap.length === 0) return kap;
    const seen = new Set(kap.map((item) => item.id));
    return [...kap, ...companyKap.filter((item) => !seen.has(item.id))];
  }, [kap, companyKap]);

  const entries = useMemo<FeedEntry[]>(() => {
    const all: FeedEntry[] = [];

    for (const item of allKap) {
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

    for (const item of allReports) {
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
  }, [allKap, spk, allReports, news]);

  /** Şirket odağı uygulanmış akış; sekme ve arama bunun üzerine biner. */
  const scoped = useMemo(() => {
    if (!company) return entries;
    return entries.filter((entry) => belongsToCompany(entry, company));
  }, [entries, company]);

  const counts = useMemo(() => {
    const map: Record<TabKey, number> = {
      all: scoped.length,
      kap: 0,
      spk: 0,
      report: 0,
      news: 0,
      consensus: 0,
    };
    for (const entry of scoped) map[entry.kind] += 1;
    map.consensus = company
      ? consensus.filter((row) => row.ticker === company).length
      : consensus.length;
    return map;
  }, [scoped, consensus, company]);

  /** Odaktaki akışta gerçekten kaydı olan kurumlar; boş çip gösterilmez. */
  const brokers = useMemo(() => {
    const seen = new Map<string, number>();
    for (const entry of scoped) {
      if (entry.kind !== 'report') continue;
      seen.set(entry.badge, (seen.get(entry.badge) ?? 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]);
  }, [scoped]);

  const reportKinds = useMemo(() => {
    const seen = new Set(
      scoped
        .filter((entry) => entry.payload.kind === 'report')
        .map((entry) => (entry.payload as { kind: 'report'; item: AnalystReport }).item.kind),
    );
    return REPORT_KIND_ORDER.filter((value) => seen.has(value));
  }, [scoped]);

  const filtered = useMemo(() => {
    const needle = normalize(query.trim());
    return scoped.filter((entry) => {
      if (tab !== 'all' && entry.kind !== tab) return false;
      // Kurum ve tür süzgeci yalnız raporlara uygulanır; "Tümü" sekmesinde
      // seçili bir kurum diğer kaynakları gizlemez.
      if (entry.payload.kind === 'report') {
        if (broker !== ALL && entry.badge !== broker) return false;
        if (reportKind !== ALL && entry.payload.item.kind !== reportKind) return false;
      }
      if (!needle) return true;
      return (
        normalize(entry.title).includes(needle) ||
        normalize(entry.badge).includes(needle) ||
        entry.tickers.some((code) => normalize(code).includes(needle))
      );
    });
  }, [scoped, tab, query, broker, reportKind]);

  const consensusRows = useMemo(() => {
    const rows = company ? consensus.filter((row) => row.ticker === company) : consensus;
    const needle = query.trim().toLocaleLowerCase('tr');
    if (!needle) return rows;
    return rows.filter((row) => row.ticker.toLocaleLowerCase('tr').includes(needle));
  }, [consensus, company, query]);

  /** Odaktaki şirketin konsensüs kaydı — özet şeridinde gösterilir. */
  const companyConsensus = useMemo(
    () => (company ? consensus.find((row) => row.ticker === company) : undefined),
    [consensus, company],
  );

  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [tab, query, company, broker, reportKind]);

  const focusCompany = (raw: string) => {
    const code = raw.trim().toUpperCase().replace(/\.IS$/, '');
    setCompany(code);
    setCompanyDraft(code);
  };

  const clearCompany = () => {
    setCompany('');
    setCompanyDraft('');
  };

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

  const chip = (active: boolean, label: string, onClick: () => void, key: string) => (
    <button
      key={key}
      type="button"
      className={`tab-button${active ? ' active' : ''}`}
      onClick={onClick}
      style={{ borderRadius: '12px', border: '1px solid var(--border-color)' }}
    >
      {label}
    </button>
  );

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
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {lastUpdated && (
            <span style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
              {t('lastUpdatedLabel')}: {lastUpdated.slice(0, 10)}
            </span>
          )}
          <input
            className="kap-filter-input"
            placeholder={t('knowledgeSearchPlaceholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {/* Elle yenileme derin tarama demektir: kaynakların arşivi sonuna
              kadar taranır ve dakikalar sürebilir. Örtük tazeleme sığdır. */}
          <button
            type="button"
            className="small-button"
            onClick={() => load(true)}
            disabled={refreshing}
          >
            {refreshing ? t('refreshing') : t('kapRefresh')}
          </button>
        </div>
      </div>

      {/* Şirket odağı: deponun ana kullanımı. Kod yazılıp Enter'a basılınca
          dört kaynak da o şirkete indirgenir. */}
      <div
        className="panel"
        style={{ padding: '10px 12px', margin: '10px 0 12px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}
      >
        <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{t('knowledgeCompanyLabel')}</span>
        <input
          className="kap-filter-input"
          style={{ maxWidth: '160px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}
          placeholder={t('knowledgeCompanyPlaceholder')}
          value={companyDraft}
          onChange={(event) => setCompanyDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') focusCompany(companyDraft);
          }}
        />
        <button type="button" className="small-button" onClick={() => focusCompany(companyDraft)}>
          {t('knowledgeCompanyApply')}
        </button>
        {company && (
          <>
            <span
              style={{
                padding: '3px 10px', borderRadius: '10px', fontSize: '0.72rem', fontWeight: 700,
                background: '#58a6ff22', color: '#58a6ff', fontFamily: 'var(--font-mono)',
              }}
            >
              {company}
            </span>
            {companyConsensus && (
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {companyConsensus.rating ?? '—'} · {companyConsensus.total} {t('consensusAnalysts')} ·{' '}
                {t('consensusTargetAvg')}: {formatPrice(companyConsensus.target_average)}
              </span>
            )}
            {companyLoading && (
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t('loadingData')}</span>
            )}
            <button type="button" className="small-button" onClick={clearCompany}>
              {t('knowledgeCompanyClear')}
            </button>
            <button type="button" className="small-button" onClick={() => onSelectTicker?.(company)}>
              {t('knowledgeCompanyOpen')}
            </button>
          </>
        )}
      </div>

      <div className="tabs" style={{ width: 'fit-content', margin: '0 0 14px' }}>
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

      {/* Bir kurumun düşmesi listeyi gizlemez; uyarı olarak gösterilir. */}
      {sourceErrors.length > 0 && (
        <div className="panel" style={{ padding: '8px 12px', marginBottom: '12px', borderColor: '#d2992255' }}>
          <span style={{ fontSize: '0.72rem', color: '#d29922' }}>
            {t('reportsPartialSources')}: {sourceErrors.join(' · ')}
          </span>
        </div>
      )}

      {/* Kurum ve tür çipleri yalnız rapor sekmesinde; başka sekmede
          rapora özel süzgeç göstermek yanıltıcı olur. */}
      {tab === 'report' && (brokers.length > 0 || reportKinds.length > 0) && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
          {chip(broker === ALL, t('reportsAllBrokers'), () => setBroker(ALL), 'broker-all')}
          {brokers.map(([name, count]) =>
            chip(broker === name, `${name} (${count})`, () => setBroker(name), `broker-${name}`),
          )}
          <span style={{ width: '1px', height: '18px', background: 'var(--border-color)' }} />
          {chip(reportKind === ALL, t('reportsAllKinds'), () => setReportKind(ALL), 'kind-all')}
          {reportKinds.map((value) =>
            chip(reportKind === value, t(REPORT_KIND_KEY[value]), () => setReportKind(value), `kind-${value}`),
          )}
        </div>
      )}

      {/* Hangi kaynakların beklendiği tek tek söylenir: liste dolmaya
          başlamışken "yükleniyor" demek, eksik kaynağı gizlemek olur. */}
      {pending.size > 0 && (
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '10px' }}>
          {t('loadingData')} — {[...pending].map((kind) => t(TAB_KEY[kind])).join(' · ')}
        </div>
      )}

      {tab === 'consensus' ? (
        consensusRows.length === 0 ? (
          <div className="empty-state">{t('reportsConsensusEmpty')}</div>
        ) : (
          <ConsensusTable rows={consensusRows} onSelectTicker={onSelectTicker} />
        )
      ) : (
        <>
          {pending.size === 0 && filtered.length === 0 && (
            <div className="empty-state">{t('knowledgeEmpty')}</div>
          )}

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
                        {entry.payload.kind === 'report' && (
                          <>
                            <span className="kap-item-category">
                              {t(REPORT_KIND_KEY[entry.payload.item.kind])}
                            </span>
                            {entry.payload.item.rating && (
                              <span className="kap-item-category">{entry.payload.item.rating}</span>
                            )}
                            {entry.payload.item.target_price != null && (
                              <span className="kap-item-category">
                                {t('targetPriceLabel')}: {formatPrice(entry.payload.item.target_price)}
                              </span>
                            )}
                            {entry.payload.item.analyst && (
                              <span className="kap-item-category">{entry.payload.item.analyst}</span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {entry.summary && <p className="kap-item-summary">{entry.summary}</p>}

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
                        onClick={() => focusCompany(code)}
                        title={t('knowledgeCompanyFocusHint')}
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
                </article>
              ),
            )}

            {filtered.length > visible && (
              <button
                type="button"
                className="tab-button"
                onClick={() => setVisible((current) => current + PAGE_SIZE)}
                style={{ alignSelf: 'center', padding: '8px 18px', marginTop: '4px' }}
              >
                {t('reportsShowMore')} ({filtered.length - visible})
              </button>
            )}
          </div>
        </>
      )}

      <p style={{ marginTop: '14px', fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
        {tab === 'consensus' ? t('consensusSourcesNote') : t('reportsSourcesNote')}
      </p>

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
