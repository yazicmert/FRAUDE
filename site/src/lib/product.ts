/**
 * Uygulamanın gerçek modül künyesi. Adlar ve açıklamalar
 * src/modules/workspaceRegistry.tsx içindeki manifest'lerle, kısa kodlar da
 * src/features/guide/GuideView.tsx'teki rehber kartlarıyla birebir aynıdır.
 * Site burada özellik uydurmaz; uygulamada gerçekten açılan modülleri sayar.
 * Modül eklendiğinde/çıkarıldığında bu dosya ve MODULE_COUNT birlikte güncellenir.
 */
import type { Lang } from './i18n';

export type Localized = Record<Lang, string>;

export interface ModuleEntry {
  /** Rehberdeki iki harfli modül kodu. */
  code: string;
  name: Localized;
  desc: Localized;
}

export interface ModuleGroup {
  id: string;
  label: Localized;
  modules: ModuleEntry[];
}

/**
 * Manifest yayımlayan modül sayısı = workspaceRegistry'deki benzersiz
 * `fraude.*` kimlikleri. Aşağıdaki 14 kart + Rehber ve Ayarlar.
 */
export const MODULE_COUNT = 16;

export const MODULE_GROUPS: ModuleGroup[] = [
  {
    id: 'equities',
    label: { tr: 'Pano ve hisse', en: 'Dashboard and equities' },
    modules: [
      {
        code: 'DB',
        name: { tr: 'Pano', en: 'Dashboard' },
        desc: {
          tr: 'Piyasa özeti ve karar destek panelleri.',
          en: 'Market overview and decision-support panels.',
        },
      },
      {
        code: 'SC',
        name: { tr: 'Teknik Tarayıcı', en: 'Technical Screener' },
        desc: {
          tr: 'FQL ile teknik ve temel analiz taramaları.',
          en: 'Technical and fundamental scans with FQL.',
        },
      },
      {
        code: 'KB',
        name: { tr: 'Bilgi Deposu', en: 'Knowledge Base' },
        desc: {
          tr: 'KAP bildirimleri, SPK bültenleri, aracı kurum analizleri ve haberler tek akışta.',
          en: 'KAP disclosures, SPK bulletins, broker research and news in a single stream.',
        },
      },
      {
        code: 'CA',
        name: { tr: 'Kurumsal Aksiyonlar', en: 'Corporate Actions' },
        desc: {
          tr: 'Temettü, sermaye artırımı ve halka arz takibi.',
          en: 'Dividend, capital increase and IPO tracking.',
        },
      },
      {
        code: 'IP',
        name: { tr: 'Halka Arz', en: 'IPOs' },
        desc: {
          tr: 'Canlı ve taslak halka arz takibi.',
          en: 'Live and draft IPO tracking.',
        },
      },
      {
        code: 'RD',
        name: { tr: 'İzleme Radarı', en: 'Monitor Radar' },
        desc: {
          tr: 'Fiyat ve bildirim uyarıları için canlı izleme radarı.',
          en: 'Live radar for price and disclosure alerts.',
        },
      },
    ],
  },
  {
    id: 'other-markets',
    label: { tr: 'Fon, emtia, kripto', en: 'Funds, commodities, crypto' },
    modules: [
      {
        code: 'FO',
        name: { tr: 'Fonlar', en: 'Funds' },
        desc: {
          tr: 'TEFAS yatırım, emeklilik ve borsa yatırım fonları; portföy dağılımı ve kurucu künyesi.',
          en: 'TEFAS mutual, pension and exchange-traded funds; portfolio breakdown and issuer profile.',
        },
      },
      {
        code: 'EM',
        name: { tr: 'Emtia & Değerli Metaller', en: 'Commodities & Metals' },
        desc: {
          tr: 'Ons/gram altın, gümüş, petrol ve sanayi metalleri için canlı ısı haritası ve hesaplayıcı.',
          en: 'Live heatmap, gainers and converter for gold, silver, oil and industrial metals.',
        },
      },
      {
        code: 'KR',
        name: { tr: 'Kripto Piyasaları', en: 'Crypto Markets' },
        desc: {
          tr: '7/24 kripto para piyasa değeri ısı haritası, sıralama ve teknik görünüm.',
          en: '24/7 crypto market cap heatmap, rankings and technical view.',
        },
      },
    ],
  },
  {
    id: 'tools',
    label: { tr: 'Araçlar', en: 'Tools' },
    modules: [
      {
        code: 'NW',
        name: { tr: 'Haber Akışı', en: 'News Feed' },
        desc: {
          tr: 'Şirket haberleri, kısa özetler ve kaynak bağlantıları.',
          en: 'Company news, short summaries and source links.',
        },
      },
      {
        code: 'AI',
        name: { tr: 'Yapay Zeka Araştırma', en: 'AI Research' },
        desc: {
          tr: 'Seçili bağlam üzerinde sağlayıcı bağımsız araştırma.',
          en: 'Provider-independent research on the selected context.',
        },
      },
      {
        code: 'RS',
        name: { tr: 'Araştırma', en: 'Research' },
        desc: {
          tr: 'AI ajan takımıyla hisse araştırması ve serbest görevler.',
          en: 'AI agent-team stock research and free-form tasks.',
        },
      },
      {
        code: 'TM',
        name: { tr: 'Ekip', en: 'Team' },
        desc: {
          tr: 'Ekip çalışma alanı ve paylaşılan izleme listeleri.',
          en: 'Team workspace and shared watchlists.',
        },
      },
      {
        code: 'BL',
        name: { tr: 'Bildirimler', en: 'Notifications' },
        desc: {
          tr: 'KAP/SPK/haber e-posta bildirimleri: kaynaklar, takip hisseleri, anahtar kelimeler ve önem eşiği.',
          en: 'KAP/SPK/news email alerts: sources, followed tickers, keywords and importance threshold.',
        },
      },
    ],
  },
];

/** Sekme açmadan her yerden erişilen yüzeyler. */
export const ALWAYS_ON: { code: string; label: Localized }[] = [
  { code: 'TK', label: { tr: 'Hisse Detayı', en: 'Ticker Detail' } },
  { code: 'IX', label: { tr: 'Endeks Görünümü', en: 'Index View' } },
  { code: '$_', label: { tr: 'Terminal (FQL)', en: 'Terminal (FQL)' } },
  { code: 'MD', label: { tr: 'Modül Merkezi', en: 'Module Center' } },
  { code: 'UP', label: { tr: 'Güncellemeler', en: 'Updates' } },
];

/** Verinin geldiği resmî/birincil kaynaklar. */
export const SOURCES = [
  'KAP',
  'SPK',
  'TEFAS',
  'Borsa İstanbul',
  'İş Yatırım',
  'TCMB',
  'TradingView',
  'Yahoo Finance',
];
