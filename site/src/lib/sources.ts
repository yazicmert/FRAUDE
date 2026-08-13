/**
 * Verinin geldiği yerlerin künyesi.
 *
 * Liste uydurma değil: core/src altındaki veri katmanının gerçekten istek
 * attığı adreslerden çıkarıldı. Bir kaynak eklenip çıkarıldığında burası da
 * güncellenir — site kullanmadığı bir kaynağı listelememeli, kullandığını da
 * gizlememeli.
 */
import type { Lang } from './i18n';

export type Localized = Record<Lang, string>;

export interface SourceEntry {
  name: string;
  /** Kaynağın kendi sayfası. */
  url: string;
  /** FRAUDE'un bu kaynaktan tam olarak ne aldığı. */
  takes: Localized;
}

export interface SourceGroup {
  id: string;
  label: Localized;
  intro: Localized;
  sources: SourceEntry[];
}

export const SOURCE_GROUPS: SourceGroup[] = [
  {
    id: 'official',
    label: { tr: 'Resmî kaynaklar', en: 'Official sources' },
    intro: {
      tr: 'Bildirim, bülten ve fon verisinin birincil kaynağı. Araya veri satan bir katman girmez.',
      en: 'The primary source for disclosures, bulletins and fund data. No data reseller sits in between.',
    },
    sources: [
      {
        name: 'KAP — Kamuyu Aydınlatma Platformu',
        url: 'https://www.kap.org.tr',
        takes: {
          tr: 'Şirket bildirimleri, temettü ve sermaye artırımı kararları, ortaklık yapısı, halka arz belgeleri ve fonların aylık Portföy Dağılım Raporları.',
          en: 'Company disclosures, dividend and capital increase decisions, ownership structure, IPO documents, and funds’ monthly Portfolio Distribution Reports.',
        },
      },
      {
        name: 'SPK — Sermaye Piyasası Kurulu',
        url: 'https://spk.gov.tr',
        takes: {
          tr: 'Haftalık bültenler ve bültenlerdeki halka arz onayları; izahname ve tasarruf sahiplerine satış duyurusu kayıtları.',
          en: 'Weekly bulletins and the IPO approvals they carry, plus prospectus and public offering circular records.',
        },
      },
      {
        name: 'TEFAS — Türkiye Elektronik Fon Alım Satım Platformu',
        url: 'https://www.tefas.gov.tr',
        takes: {
          tr: 'Fon fiyatları, portföy büyüklükleri, yatırımcı sayıları, tedavüldeki pay adetleri ve dönemsel getiriler.',
          en: 'Fund prices, portfolio sizes, investor counts, units outstanding and periodic returns.',
        },
      },
      {
        name: 'Borsa İstanbul',
        url: 'https://www.borsaistanbul.com',
        takes: {
          tr: 'Endeks tanımları ve endekslerin bileşenleri.',
          en: 'Index definitions and their constituents.',
        },
      },
      {
        name: 'TCMB — Türkiye Cumhuriyet Merkez Bankası',
        url: 'https://www.tcmb.gov.tr',
        takes: {
          tr: 'Döviz kurları.',
          en: 'Foreign exchange rates.',
        },
      },
    ],
  },
  {
    id: 'market',
    label: { tr: 'Piyasa verisi', en: 'Market data' },
    intro: {
      tr: 'Fiyat serileri, göstergeler ve takvimler.',
      en: 'Price series, indicators and calendars.',
    },
    sources: [
      {
        name: 'İş Yatırım',
        url: 'https://www.isyatirim.com.tr',
        takes: {
          tr: 'Hisse fiyat serileri, tarama verileri ve mali tablolar.',
          en: 'Equity price series, screener data and financial statements.',
        },
      },
      {
        name: 'TradingView',
        url: 'https://www.tradingview.com',
        takes: {
          tr: 'Emtia, kripto ve global hisse fiyatları ile teknik göstergeler.',
          en: 'Commodity, crypto and global equity prices, plus technical indicators.',
        },
      },
      {
        name: 'Yahoo Finance',
        url: 'https://finance.yahoo.com',
        takes: {
          tr: 'Global piyasa fiyat serileri ve uzun dönem getiriler.',
          en: 'Global market price series and long-term returns.',
        },
      },
      {
        name: 'Trading Economics',
        url: 'https://tradingeconomics.com',
        takes: {
          tr: 'Ekonomik takvim.',
          en: 'The economic calendar.',
        },
      },
    ],
  },
  {
    id: 'research',
    label: { tr: 'Aracı kurum araştırmaları', en: 'Brokerage research' },
    intro: {
      tr: 'Analiz raporları ve hedef fiyatlar, kurumların kendi yayın sayfalarından okunur. Raporların içeriği ve görüşü tamamen ilgili kuruma aittir.',
      en: 'Research reports and target prices are read from each firm’s own publication pages. The content and the opinions in them belong entirely to that firm.',
    },
    sources: [
      { name: 'İş Yatırım', url: 'https://arastirma.isyatirim.com.tr', takes: { tr: 'Analiz raporları', en: 'Research reports' } },
      { name: 'Garanti BBVA Yatırım', url: 'https://www.garantibbvayatirim.com.tr', takes: { tr: 'Analiz raporları', en: 'Research reports' } },
      { name: 'Ziraat Yatırım', url: 'https://www.ziraatyatirim.com.tr', takes: { tr: 'Analiz raporları', en: 'Research reports' } },
      { name: 'Gedik Yatırım', url: 'https://www.gedik.com', takes: { tr: 'Analiz raporları', en: 'Research reports' } },
      { name: 'Şeker Yatırım', url: 'https://www.sekeryatirim.com.tr', takes: { tr: 'Analiz raporları', en: 'Research reports' } },
      { name: 'Halk Yatırım', url: 'https://www.halkyatirim.com.tr', takes: { tr: 'Analiz raporları', en: 'Research reports' } },
      { name: 'Integral Yatırım', url: 'https://integralyatirim.com.tr', takes: { tr: 'Analiz raporları', en: 'Research reports' } },
      { name: 'A1 Capital', url: 'https://a1capital.com.tr', takes: { tr: 'Analiz raporları', en: 'Research reports' } },
      { name: 'Phillip Capital', url: 'https://www.phillipcapital.com.tr', takes: { tr: 'Analiz raporları', en: 'Research reports' } },
      { name: 'Ahlatcı Yatırım', url: 'https://www.ahlatciyatirim.com.tr', takes: { tr: 'Analiz raporları', en: 'Research reports' } },
      { name: 'VKY Analiz', url: 'https://www.vkyanaliz.com', takes: { tr: 'Analiz raporları', en: 'Research reports' } },
      { name: 'Marbaş Menkul', url: 'https://marbas.com.tr', takes: { tr: 'Analiz raporları', en: 'Research reports' } },
    ],
  },
  {
    id: 'news',
    label: { tr: 'Haber', en: 'News' },
    intro: {
      tr: 'Haber tarafı herkese açık, anahtar istemeyen kaynaklardan beslenir. Başlık ve özet gösterilir; okumak istediğinizde kaynağın kendi sayfasına gidersiniz.',
      en: 'The news side runs on public, key-free sources. Headlines and summaries are shown; to read on, you go to the source’s own page.',
    },
    sources: [
      {
        name: 'Google News',
        url: 'https://news.google.com',
        takes: {
          tr: 'Şirket ve piyasa haberi araması (RSS).',
          en: 'Company and market news search (RSS).',
        },
      },
      {
        name: 'GDELT Project',
        url: 'https://www.gdeltproject.org',
        takes: {
          tr: 'Açık haber indeksi üzerinden şirket haberleri.',
          en: 'Company news via its open news index.',
        },
      },
      {
        name: 'BloombergHT',
        url: 'https://www.bloomberght.com',
        takes: { tr: 'Ekonomi haber akışı.', en: 'Economy news feed.' },
      },
      {
        name: 'NTV',
        url: 'https://www.ntv.com.tr',
        takes: { tr: 'Ekonomi haber akışı.', en: 'Economy news feed.' },
      },
    ],
  },
  {
    id: 'ipo',
    label: { tr: 'Halka arz takvimi', en: 'IPO calendar' },
    intro: {
      tr: 'SPK ve KAP kayıtlarının yanında takvimi tamamlayan topluluk kaynağı.',
      en: 'A community source that completes the calendar alongside SPK and KAP records.',
    },
    sources: [
      {
        name: 'Halka Arz (halkarz.com)',
        url: 'https://halkarz.com',
        takes: {
          tr: 'Halka arz takvimi ve taslak arz kayıtları.',
          en: 'The IPO calendar and draft offering records.',
        },
      },
    ],
  },
];
