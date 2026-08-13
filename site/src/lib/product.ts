/**
 * Uygulamanın gerçek modül künyesi. Adlar ve açıklamalar
 * src/modules/workspaceRegistry.tsx içindeki manifest'lerle, kısa kodlar da
 * src/features/guide/GuideView.tsx'teki rehber kartlarıyla birebir aynıdır.
 * Site burada özellik uydurmaz; uygulamada gerçekten açılan modülleri sayar.
 * Modül eklendiğinde/çıkarıldığında bu dosya ve MODULE_COUNT birlikte güncellenir.
 *
 * Her modülün ayrıntı sayfası (/modul/<slug>) da buradan beslenir: `lead`,
 * `does`, `feeds` ve `flow` alanları uygulamada gördüğümüz gerçek yüzeyi
 * anlatır. `shot`, site/public/shots altındaki ekran görüntüsünün adıdır ve
 * uygulamanın kendisinden çekilmiştir; görüntüsü olmayan modülde null'dur.
 */
import type { Lang } from './i18n';

export type Localized = Record<Lang, string>;

export interface ModuleEntry {
  /** Rehberdeki iki harfli modül kodu. */
  code: string;
  /** /modul/<slug> adresindeki parça. */
  slug: string;
  name: Localized;
  desc: Localized;
  /** Modül sayfasının tek cümlelik konumlandırması. */
  lead: Localized;
  /** Ekran görüntüsü dosya adı (site/public/shots/<shot>.webp) ya da null. */
  shot: string | null;
  /** Görüntü kırpılmış ya da özel bir durumu varsa okuyucuya not. */
  shotNote?: Localized;
  /** Modülün gerçekten yaptıkları. */
  does: Localized[];
  /** Bu modülü besleyen kaynaklar. */
  feeds: Localized[];
  /** Tipik kullanım sırası — gerçek bir sıra olduğu için numaralı. */
  flow: Localized[];
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
        slug: 'pano',
        name: { tr: 'Pano', en: 'Dashboard' },
        desc: {
          tr: 'Piyasa özeti ve karar destek panelleri.',
          en: 'Market overview and decision-support panels.',
        },
        lead: {
          tr: 'Piyasa açılırken bakılacak tek ekran.',
          en: 'The one screen to check when the market opens.',
        },
        shot: 'db',
        does: [
          {
            tr: 'Gün özeti tek satırda: BIST 100 seviyesi, piyasa genişliği (kaç hisse arttı, kaç düştü), günün lideri, RSI 30 altındaki hisse sayısı ve bekleyen KAP bildirimi.',
            en: 'The day in one line: BIST 100 level, market breadth (advancers vs. decliners), the day’s leader, how many stocks sit below RSI 30, and pending KAP disclosures.',
          },
          {
            tr: 'Kripto ve emtia panelleri aynı ekranda: Bitcoin ve altcoinler, gram/ons altın ve gümüş, Brent ve WTI.',
            en: 'Crypto and commodity panels on the same screen: Bitcoin and altcoins, gold and silver by gram and ounce, Brent and WTI.',
          },
          {
            tr: 'Çalışma alanını seçersiniz ve panoyu özelleştirerek hangi panellerin görüneceğini belirlersiniz.',
            en: 'Pick a market workspace and customise the dashboard to choose which panels appear.',
          },
          {
            tr: 'Verileri Eşitle yerel veritabanını tazeler; artımlı senkron yalnız değişeni çeker.',
            en: 'Sync refreshes the local database; incremental sync pulls only what changed.',
          },
        ],
        feeds: [
          { tr: 'Borsa İstanbul', en: 'Borsa İstanbul' },
          { tr: 'İş Yatırım', en: 'İş Yatırım' },
          { tr: 'TCMB', en: 'TCMB' },
          { tr: 'TradingView', en: 'TradingView' },
        ],
        flow: [
          {
            tr: 'Uygulamayı açın; pano gün özetiyle karşılar.',
            en: 'Open the app; the dashboard greets you with the day’s summary.',
          },
          {
            tr: 'Bir panelden hisseye tıklayın, detay kendi sekmesinde açılır.',
            en: 'Click a ticker in any panel and its detail opens in its own tab.',
          },
          {
            tr: 'Verileri Eşitle ile seriyi güncel tutun.',
            en: 'Keep the series current with Sync.',
          },
        ],
      },
      {
        code: 'SC',
        slug: 'teknik-tarayici',
        name: { tr: 'Teknik Tarayıcı', en: 'Technical Screener' },
        desc: {
          tr: 'FQL ile teknik ve temel analiz taramaları.',
          en: 'Technical and fundamental scans with FQL.',
        },
        lead: {
          tr: 'Koşulu yazın, eşleşen hisseler tabloya düşsün.',
          en: 'Write the condition; matching stocks drop into the table.',
        },
        shot: 'sc',
        does: [
          {
            tr: 'FQL ile kendi koşulunuzu yazarsınız: where rsi < 35 ya da scan BIST100 where rsi < 30.',
            en: 'Write your own condition in FQL: where rsi < 35, or scan BIST100 where rsi < 30.',
          },
          {
            tr: 'Hazır taramalar bir tıkla: Aşırı Satım (RSI<30), Aşırı Alım (RSI>70), Ucuz Değer (F/K<8 & PD/DD<1.5), Değer Hisseleri (F/K<10 & ROE>20), Momentum (MACD>0 & Golden Cross), Temettü Verimi (>%5).',
            en: 'Presets in one click: Oversold (RSI<30), Overbought (RSI>70), Cheap Value (P/E<8 & P/B<1.5), Value Stocks (P/E<10 & ROE>20), Momentum (MACD>0 & Golden Cross), Dividend Yield (>5%).',
          },
          {
            tr: 'Kategori seçersiniz: tüm varlıklar, BIST hisse, global hisse, emtia ya da kripto.',
            en: 'Choose a category: all assets, BIST equities, global equities, commodities or crypto.',
          },
          {
            tr: 'Sonuç tablosunda fiyat, günlük değişim, RSI, MACD, F/K ve ROE yan yana durur; kendi taramanızı isimlendirip kaydedersiniz.',
            en: 'Results line up price, daily change, RSI, MACD, P/E and ROE side by side; name a scan and save it.',
          },
        ],
        feeds: [
          { tr: 'Borsa İstanbul', en: 'Borsa İstanbul' },
          { tr: 'İş Yatırım', en: 'İş Yatırım' },
          { tr: 'TradingView', en: 'TradingView' },
          { tr: 'Yahoo Finance', en: 'Yahoo Finance' },
        ],
        flow: [
          {
            tr: 'Bir hazır taramayla başlayın ya da koşulu kendiniz yazın.',
            en: 'Start from a preset or write the condition yourself.',
          },
          {
            tr: 'Çalıştır deyin; eşleşen hisseler göstergeleriyle listelenir.',
            en: 'Run it; matching stocks are listed with their indicators.',
          },
          {
            tr: 'Sık kullandığınız taramayı kaydedin, ertesi gün tek tıkla tekrarlayın.',
            en: 'Save the scan you use often and repeat it with one click the next day.',
          },
        ],
      },
      {
        code: 'KB',
        slug: 'bilgi-deposu',
        name: { tr: 'Bilgi Deposu', en: 'Knowledge Base' },
        desc: {
          tr: 'KAP bildirimleri, SPK bültenleri, aracı kurum analizleri ve haberler tek akışta.',
          en: 'KAP disclosures, SPK bulletins, broker research and news in a single stream.',
        },
        lead: {
          tr: 'Dört ayrı kaynak, tek zaman çizgisi.',
          en: 'Four separate sources, one timeline.',
        },
        shot: 'kb',
        does: [
          {
            tr: 'KAP bildirimleri, SPK bültenleri, aracı kurum analiz raporları ve haberler tek listede, tarihe göre sıralı.',
            en: 'KAP disclosures, SPK bulletins, broker research reports and news in one list, ordered by date.',
          },
          {
            tr: 'Kaynak sekmeleriyle daraltırsınız: KAP, SPK, Analiz, Haber, Konsensüs — her sekmede kayıt sayısı yazar.',
            en: 'Narrow by source tab: KAP, SPK, Research, News, Consensus — each tab shows its record count.',
          },
          {
            tr: 'Şirket odağı: bir hisse kodu yazıp odaklandığınızda o şirketin kayıtları canlı çekilir.',
            en: 'Company focus: type a ticker and focus, and that company’s records are fetched live.',
          },
          {
            tr: 'Her satırda kaynak künyesi ve ilgili hisse kodları durur; belgeyi uygulamanın içindeki okuyucuda açarsınız.',
            en: 'Every row carries its source badge and related tickers; documents open in the app’s own reader.',
          },
        ],
        feeds: [
          { tr: 'KAP', en: 'KAP' },
          { tr: 'SPK', en: 'SPK' },
          { tr: 'Aracı kurumlar', en: 'Brokerage houses' },
          { tr: 'Google News', en: 'Google News' },
          { tr: 'GDELT', en: 'GDELT' },
        ],
        flow: [
          {
            tr: 'Bilgi Deposu’nu açın; dört kaynak birleşik akışta gelir.',
            en: 'Open the Knowledge Base; all four sources arrive in one merged stream.',
          },
          {
            tr: 'Bir şirkete odaklanın ya da kaynak sekmesiyle daraltın.',
            en: 'Focus on a company, or narrow down with a source tab.',
          },
          {
            tr: 'İlgilendiğiniz kaydı okuyucuda açın, oradan hisse detayına geçin.',
            en: 'Open the record you care about in the reader, then jump to the ticker detail.',
          },
        ],
      },
      {
        code: 'CA',
        slug: 'kurumsal-aksiyonlar',
        name: { tr: 'Kurumsal Aksiyonlar', en: 'Corporate Actions' },
        desc: {
          tr: 'Temettü, sermaye artırımı ve halka arz takibi.',
          en: 'Dividend, capital increase and IPO tracking.',
        },
        lead: {
          tr: 'Hak düşüm tarihini kaçırmayın.',
          en: 'Don’t miss an ex-dividend date.',
        },
        shot: 'ca',
        does: [
          {
            tr: 'Yaklaşan temettüler: açıklanmış hak düşüm tarihleri, o güne kalan gün sayısı ve tahmini yıllık temettü.',
            en: 'Upcoming dividends: announced ex-dividend dates, days remaining, and estimated annual dividend.',
          },
          {
            tr: 'Taksitli dağıtımlar ayrı satırlarda ve taksit numarasıyla görünür.',
            en: 'Instalment payouts appear on their own rows, labelled with the instalment number.',
          },
          {
            tr: 'Sermaye artırımı ve halka arz aynı ekranın diğer sekmelerinde.',
            en: 'Capital increases and IPOs sit in the other tabs of the same screen.',
          },
          {
            tr: 'Hisse koduyla filtrelersiniz; verinin son güncellenme zamanı ekranda yazar.',
            en: 'Filter by ticker; the last update timestamp is shown on screen.',
          },
        ],
        feeds: [
          { tr: 'KAP', en: 'KAP' },
          { tr: 'İş Yatırım', en: 'İş Yatırım' },
        ],
        flow: [
          {
            tr: 'Temettü sekmesinde yaklaşan hak düşüm tarihlerini görün.',
            en: 'See upcoming ex-dividend dates on the Dividend tab.',
          },
          {
            tr: 'İlgilendiğiniz hisseyi filtreleyin.',
            en: 'Filter down to the ticker you care about.',
          },
          {
            tr: 'Sermaye artırımı ve halka arz sekmelerine geçerek aynı şirketin diğer aksiyonlarına bakın.',
            en: 'Switch to the capital increase and IPO tabs for the same company’s other actions.',
          },
        ],
      },
      {
        code: 'IP',
        slug: 'halka-arz',
        name: { tr: 'Halka Arz', en: 'IPOs' },
        desc: {
          tr: 'Canlı ve taslak halka arz takibi.',
          en: 'Live and draft IPO tracking.',
        },
        lead: {
          tr: 'SPK onayından işlem gününe kadar tek künye.',
          en: 'One record, from SPK approval to the first trading day.',
        },
        shot: 'ip',
        does: [
          {
            tr: 'Tamamlanan ve aktif arzlar ile taslak arzlar ayrı sekmelerde, yüzlerce kayıt.',
            en: 'Completed and active offerings sit in one tab, drafts in another — hundreds of records.',
          },
          {
            tr: 'Filtre paneli: halka arz büyüklüğü, arz edilecek lot, katılım endeksi, bireysel tahsisat ve konsorsiyum lideri.',
            en: 'Filter panel: offering size, lots on offer, participation index, retail allocation and consortium leader.',
          },
          {
            tr: 'Her satırda talep toplama tarihleri, işleme başlama günü, dağıtım türü, katılımcı sayısı ve arz fiyatı.',
            en: 'Each row carries the book-building dates, first trading day, allocation method, participant count and offer price.',
          },
          {
            tr: 'SPK onayından sonra künye, ilgili KAP bildirimlerinden kendiliğinden dolar.',
            en: 'After SPK approval the record fills itself in from the related KAP disclosures.',
          },
        ],
        feeds: [
          { tr: 'SPK bültenleri', en: 'SPK bulletins' },
          { tr: 'KAP', en: 'KAP' },
        ],
        flow: [
          {
            tr: 'Aktif sekmesinde talep toplaması süren arzları görün.',
            en: 'See offerings currently collecting demand on the active tab.',
          },
          {
            tr: 'Filtre paneliyle büyüklüğe ya da konsorsiyum liderine göre daraltın.',
            en: 'Narrow by size or consortium leader in the filter panel.',
          },
          {
            tr: 'Bir satırı açıp künyenin tamamını ve kaynak belgelerini inceleyin.',
            en: 'Expand a row to review the full record and its source documents.',
          },
        ],
      },
      {
        code: 'RD',
        slug: 'izleme-radari',
        name: { tr: 'İzleme Radarı', en: 'Monitor Radar' },
        desc: {
          tr: 'Fiyat ve bildirim uyarıları için canlı izleme radarı.',
          en: 'Live radar for price and disclosure alerts.',
        },
        lead: {
          tr: 'Takip listenizin KAP bildirimlerini arka planda tarar.',
          en: 'Scans KAP disclosures for your watchlist in the background.',
        },
        shot: 'rd',
        does: [
          {
            tr: 'Takip listenizdeki hisselerin KAP bildirimleri seçtiğiniz aralıkla taranır: 5 dakika, 15 dakika, 30 dakika ya da 1 saat.',
            en: 'KAP disclosures for your watchlist are scanned at the interval you pick: 5, 15 or 30 minutes, or hourly.',
          },
          {
            tr: 'Ortaklık ve pay değişimi, yeni iş ilişkisi, sermaye ve kâr payı gibi materyal gelişmeler ayrı ayrı filtrelenir.',
            en: 'Material developments — ownership and share changes, new business relationships, capital and dividends — filter separately.',
          },
          {
            tr: 'Önemli bulunanlar seçtiğiniz yapay zeka ajanına yorumlatılır; faaliyet raporu gibi rutin bildirimler elenir.',
            en: 'The important ones are interpreted by the AI agent you choose; routine filings such as annual reports are filtered out.',
          },
          {
            tr: 'Masaüstü bildirimi açılabilir. İlk tarama mevcut KAP geçmişini temel alır ve uyarı üretmez; sayaç oradan başlar.',
            en: 'Desktop notifications are optional. The first scan baselines existing KAP history without raising alerts; counting starts from there.',
          },
        ],
        feeds: [{ tr: 'KAP', en: 'KAP' }],
        flow: [
          {
            tr: 'Hisse detayında Portföye Ekle deyip takip listenizi kurun.',
            en: 'Build your watchlist by adding tickers from their detail page.',
          },
          {
            tr: 'Tarama aralığını ve yorumlayacak ajanı seçin.',
            en: 'Choose the scan interval and the agent that will interpret findings.',
          },
          {
            tr: 'Radar çalışsın; materyal bir gelişme çıktığında uyarı listesine düşer.',
            en: 'Let the radar run; when something material lands, it drops into the alert list.',
          },
        ],
      },
    ],
  },
  {
    id: 'other-markets',
    label: { tr: 'Fon, emtia, kripto', en: 'Funds, commodities, crypto' },
    modules: [
      {
        code: 'FO',
        slug: 'fonlar',
        name: { tr: 'Fonlar', en: 'Funds' },
        desc: {
          tr: 'TEFAS yatırım, emeklilik ve borsa yatırım fonları; portföy dağılımı ve kurucu künyesi.',
          en: 'TEFAS mutual, pension and exchange-traded funds; portfolio breakdown and issuer profile.',
        },
        lead: {
          tr: 'TEFAS’ın tamamı, fonun içine bakarak.',
          en: 'All of TEFAS — and what each fund actually holds.',
        },
        shot: 'fo',
        does: [
          {
            tr: 'Binlerce TEFAS fonu tek listede; yatırım, emeklilik, borsa yatırım, gayrimenkul ve girişim sermayesi olarak ayrılır.',
            en: 'Thousands of TEFAS funds in one list, split into mutual, pension, exchange-traded, real-estate and venture capital.',
          },
          {
            tr: 'Büyüklüğe, günlük ve 1 aylık / 3 aylık / 1 yıllık getiriye, yatırımcı sayısına ya da koda göre sıralarsınız.',
            en: 'Sort by size, daily and 1-month / 3-month / 1-year return, investor count or code.',
          },
          {
            tr: 'Fon detayında fiyat, portföy büyüklüğü, yatırımcı sayısı ve tedavüldeki pay adedi.',
            en: 'The detail pane shows price, portfolio size, investor count and units outstanding.',
          },
          {
            tr: 'Portföy dağılımı ve içindeki varlıklar, KAP’ın aylık Portföy Dağılım Raporu’ndan çözülür; fonun KAP bildirimleri aynı ekranda durur.',
            en: 'Allocation and holdings are resolved from KAP’s monthly Portfolio Distribution Report; the fund’s KAP disclosures sit on the same screen.',
          },
        ],
        feeds: [
          { tr: 'TEFAS', en: 'TEFAS' },
          { tr: 'KAP', en: 'KAP' },
        ],
        flow: [
          {
            tr: 'Kategoriyi seçin, listeyi büyüklüğe ya da getiriye göre sıralayın.',
            en: 'Pick a category and sort the list by size or return.',
          },
          {
            tr: 'Bir fona tıklayın; künyesi ve fiyat grafiği sağda açılır.',
            en: 'Click a fund; its profile and price chart open on the right.',
          },
          {
            tr: 'Portföy dağılımına inip fonun hangi varlıkları tuttuğunu görün.',
            en: 'Drill into the allocation to see what the fund actually holds.',
          },
        ],
      },
      {
        code: 'EM',
        slug: 'emtia',
        name: { tr: 'Emtia & Değerli Metaller', en: 'Commodities & Metals' },
        desc: {
          tr: 'Ons/gram altın, gümüş, petrol ve sanayi metalleri için canlı ısı haritası ve hesaplayıcı.',
          en: 'Live heatmap, gainers and converter for gold, silver, oil and industrial metals.',
        },
        lead: {
          tr: 'Altın, gümüş, enerji ve sanayi metali tek panelde.',
          en: 'Gold, silver, energy and industrial metals in one panel.',
        },
        shot: 'em',
        does: [
          {
            tr: 'Isı haritası: gram altın ve gümüş (TL), ons altın ve gümüş ($), Brent, WTI, doğalgaz ve bakır günlük değişimleriyle.',
            en: 'Heatmap: gold and silver by gram (TRY) and ounce (USD), Brent, WTI, natural gas and copper with their daily change.',
          },
          {
            tr: 'Değerli metal, enerji ve sanayi metali olarak filtrelenir.',
            en: 'Filter by precious metal, energy or industrial metal.',
          },
          {
            tr: 'Ons–gram dönüştürücü: ons fiyatı ile USD/TRY kurundan gram altın karşılığını hesaplar.',
            en: 'Ounce-to-gram converter: works out gram gold in TRY from the ounce price and the USD/TRY rate.',
          },
          {
            tr: 'Günün en çok yükselen ve en çok düşen emtiaları ayrı tablolarda.',
            en: 'The day’s biggest gainers and losers in separate tables.',
          },
        ],
        feeds: [
          { tr: 'TCMB', en: 'TCMB' },
          { tr: 'TradingView', en: 'TradingView' },
          { tr: 'Yahoo Finance', en: 'Yahoo Finance' },
        ],
        flow: [
          {
            tr: 'Isı haritasında günün yönünü bir bakışta görün.',
            en: 'Read the day’s direction off the heatmap at a glance.',
          },
          {
            tr: 'Kategoriye göre daraltın.',
            en: 'Narrow down by category.',
          },
          {
            tr: 'Dönüştürücüyle ons fiyatını gram karşılığına çevirin.',
            en: 'Convert the ounce price into its gram equivalent with the converter.',
          },
        ],
      },
      {
        code: 'KR',
        slug: 'kripto',
        name: { tr: 'Kripto Piyasaları', en: 'Crypto Markets' },
        desc: {
          tr: '7/24 kripto para piyasa değeri ısı haritası, sıralama ve teknik görünüm.',
          en: '24/7 crypto market cap heatmap, rankings and technical view.',
        },
        lead: {
          tr: 'Kapanmayan piyasa, aynı terminalde.',
          en: 'The market that never closes, in the same terminal.',
        },
        shot: 'kr',
        shotNote: {
          tr: 'Görüntü modülün “günün kazandıranları ve gerileyenleri” bölümünden kırpılmıştır.',
          en: 'Cropped from the module’s “biggest gainers and losers” section.',
        },
        does: [
          {
            tr: 'Piyasa değeri ısı haritası: dominasyon payı ve 24 saatlik değişim.',
            en: 'Market cap heatmap: dominance share and 24-hour change.',
          },
          {
            tr: 'Varlık sıralaması ve teknik görünüm tablosu, RSI (14) dahil.',
            en: 'Asset ranking and technical view table, RSI (14) included.',
          },
          {
            tr: 'Günün en çok kazandıran ve en çok gerileyen kriptoları, fiyat ve RSI ile.',
            en: 'The day’s biggest gainers and losers, with price and RSI.',
          },
          {
            tr: '7/24 kripto haber akışı aynı ekranın altında.',
            en: 'A 24/7 crypto news feed sits at the bottom of the same screen.',
          },
        ],
        feeds: [
          { tr: 'TradingView', en: 'TradingView' },
          { tr: 'Yahoo Finance', en: 'Yahoo Finance' },
        ],
        flow: [
          {
            tr: 'Isı haritasında dominasyon ve 24 saatlik değişimi görün.',
            en: 'Check dominance and 24-hour change on the heatmap.',
          },
          {
            tr: 'Sıralama tablosunda RSI’ye bakarak aşırı alım/satımı süzün.',
            en: 'Use RSI in the ranking table to sift overbought and oversold names.',
          },
          {
            tr: 'Bir varlığa tıklayıp teknik görünümüne geçin.',
            en: 'Click an asset to open its technical view.',
          },
        ],
      },
    ],
  },
  {
    id: 'tools',
    label: { tr: 'Araçlar', en: 'Tools' },
    modules: [
      {
        code: 'NW',
        slug: 'haber-akisi',
        name: { tr: 'Haber Akışı', en: 'News Feed' },
        desc: {
          tr: 'Şirket haberleri, kısa özetler ve kaynak bağlantıları.',
          en: 'Company news, short summaries and source links.',
        },
        lead: {
          tr: 'Anahtarsız şirket haberleri, kaynağıyla birlikte.',
          en: 'Company news without an API key — sources attached.',
        },
        shot: 'nw',
        does: [
          {
            tr: 'GDELT, Google News RSS ve KAP’a yönlenen herkese açık sonuçlar; hiçbir API anahtarı istemez.',
            en: 'Publicly available results from GDELT, Google News RSS and links pointing to KAP — no API key required.',
          },
          {
            tr: 'Hisse kodu yazıp yalnızca o şirketin haberlerini süzersiniz.',
            en: 'Type a ticker to see only that company’s news.',
          },
          {
            tr: 'Her kayıtta kaynak künyesi (yayın adı ve dili), tarih, ilgili hisse kodları ve konu etiketleri.',
            en: 'Every item carries a source badge (publication and language), date, related tickers and topic tags.',
          },
          {
            tr: 'Modül sınırını kendi ekranında yazar: KAP etiketi resmî ücretli KAP API’sinden değil, KAP sayfalarını indeksleyen ücretsiz haber aramasından gelir.',
            en: 'The module states its own limit on screen: the KAP tag comes from free news search indexing KAP pages, not from the paid official KAP API.',
          },
        ],
        feeds: [
          { tr: 'GDELT', en: 'GDELT' },
          { tr: 'Google News', en: 'Google News' },
        ],
        flow: [
          {
            tr: 'Akışı açın; Türkçe ve İngilizce kaynaklar birlikte gelir.',
            en: 'Open the feed; Turkish and English sources arrive together.',
          },
          {
            tr: 'Bir ya da birkaç hisse kodu girip daraltın.',
            en: 'Enter one or more tickers to narrow it down.',
          },
          {
            tr: 'Haberi uygulama içindeki okuyucuda açın; sade metin ya da kaynak sayfası olarak okuyun.',
            en: 'Open an article in the in-app reader — as clean text or as the source page.',
          },
        ],
      },
      {
        code: 'AI',
        slug: 'yapay-zeka-arastirma',
        name: { tr: 'Yapay Zeka Araştırma', en: 'AI Research' },
        desc: {
          tr: 'Seçili bağlam üzerinde sağlayıcı bağımsız araştırma.',
          en: 'Provider-independent research on the selected context.',
        },
        lead: {
          tr: 'Kendi anahtarınızla çalışan analist.',
          en: 'An analyst that runs on your own API key.',
        },
        shot: 'ai',
        does: [
          {
            tr: 'Piyasa ve şirketlerle ilgili sorularınızı sorarsınız; sohbet boyunca önceki mesajlar hatırlanır.',
            en: 'Ask questions about markets and companies; earlier messages are remembered through the conversation.',
          },
          {
            tr: 'Açık olan sekme bağlam olarak geçer: hangi modüldeyseniz soru o bağlamda yanıtlanır.',
            en: 'The open tab travels as context: your question is answered against whichever module you are in.',
          },
          {
            tr: 'Sağlayıcıyı siz seçersiniz ve anahtarınız sizde kalır; sorgularınız bizim sunucumuzdan geçmez.',
            en: 'You choose the provider and your key stays with you; queries never pass through our servers.',
          },
          {
            tr: 'Geçmiş konuşmalar yanda listelenir; yeni konuya geçerken yeni sohbet açarsınız.',
            en: 'Past conversations are listed alongside; start a new chat when you move to a new topic.',
          },
        ],
        feeds: [{ tr: 'Kendi AI sağlayıcınız', en: 'Your own AI provider' }],
        flow: [
          {
            tr: 'Ayarlardan sağlayıcı anahtarınızı girin.',
            en: 'Enter your provider key in Settings.',
          },
          {
            tr: 'İncelediğiniz modülü açık bırakıp sorunuzu yazın.',
            en: 'Leave the module you are studying open and type your question.',
          },
          {
            tr: 'Yanıtı okuyun; aynı sohbette derinleştirin.',
            en: 'Read the answer and go deeper in the same conversation.',
          },
        ],
      },
      {
        code: 'RS',
        slug: 'arastirma',
        name: { tr: 'Araştırma', en: 'Research' },
        desc: {
          tr: 'AI ajan takımıyla hisse araştırması ve serbest görevler.',
          en: 'AI agent-team stock research and free-form tasks.',
        },
        lead: {
          tr: 'Bir hisseyi ajan takımına araştırtın.',
          en: 'Hand a stock to a team of agents.',
        },
        shot: 'rs',
        does: [
          {
            tr: 'Yeni araştırma başlatırsınız; işler listede birikir, tamamlananları açıp okursunuz.',
            en: 'Start a new piece of research; jobs collect in a list and you open the finished ones.',
          },
          {
            tr: 'Takım sekmesinden araştırmayı yürütecek ajanları düzenlersiniz.',
            en: 'Configure the agents that will carry out the research from the Team tab.',
          },
          {
            tr: 'Chrome eklentisi köprüsüyle tarayıcıdaki sayfaları araştırmaya dahil edebilirsiniz.',
            en: 'The Chrome extension bridge lets you pull pages from your browser into the research.',
          },
        ],
        feeds: [
          { tr: 'Kendi AI sağlayıcınız', en: 'Your own AI provider' },
          { tr: 'Web', en: 'The web' },
        ],
        flow: [
          {
            tr: 'Yeni Araştırma sekmesinde konuyu ve hisseyi belirtin.',
            en: 'Set the topic and ticker on the New Research tab.',
          },
          {
            tr: 'Takım çalışırken başka modüllere geçebilirsiniz.',
            en: 'Move on to other modules while the team works.',
          },
          {
            tr: 'İş bittiğinde listeden açıp sonucu okuyun.',
            en: 'Open the finished job from the list and read the result.',
          },
        ],
      },
      {
        code: 'TM',
        slug: 'ekip',
        name: { tr: 'Ekip', en: 'Team' },
        desc: {
          tr: 'Ekip çalışma alanı ve paylaşılan izleme listeleri.',
          en: 'Team workspace and shared watchlists.',
        },
        lead: {
          tr: 'Ajanları tanımlayın, ürettikleri belgeleri saklayın.',
          en: 'Define your agents and keep what they produce.',
        },
        shot: null,
        does: [
          {
            tr: 'Araştırmaları yürüten yapay zeka ajanlarını tanımlar, aktif ya da pasif yaparsınız.',
            en: 'Define the AI agents that run your research and switch them active or passive.',
          },
          {
            tr: 'Her ajana hisse bağlarsınız; analizi o ajanın üzerinden çalıştırırsınız.',
            en: 'Link tickers to each agent and run the analysis through that agent.',
          },
          {
            tr: 'Artifact deposu: başlık ve içerikten belge oluşturur, ajanlara bağlarsınız.',
            en: 'Artifact store: create documents from a title and body, then link them to agents.',
          },
        ],
        feeds: [{ tr: 'Kendi AI sağlayıcınız', en: 'Your own AI provider' }],
        flow: [
          {
            tr: 'Bir ajan tanımlayın ve ilgilendiği hisseleri bağlayın.',
            en: 'Define an agent and link the tickers it covers.',
          },
          {
            tr: 'Belgeleri artifact deposuna ekleyip ajanla ilişkilendirin.',
            en: 'Add documents to the artifact store and associate them with the agent.',
          },
          {
            tr: 'Analizi çalıştırın; sonuç ajanın altında birikir.',
            en: 'Run the analysis; results accumulate under that agent.',
          },
        ],
      },
      {
        code: 'BL',
        slug: 'bildirimler',
        name: { tr: 'Bildirimler', en: 'Notifications' },
        desc: {
          tr: 'KAP/SPK/haber e-posta bildirimleri: kaynaklar, takip hisseleri, anahtar kelimeler ve önem eşiği.',
          en: 'KAP/SPK/news email alerts: sources, followed tickers, keywords and importance threshold.',
        },
        lead: {
          tr: 'Uygulama kapalıyken de çalışır.',
          en: 'Keeps working while the app is closed.',
        },
        shot: null,
        does: [
          {
            tr: 'Kaynakları seçersiniz: KAP bildirimleri, SPK bültenleri ve ekonomi haberleri.',
            en: 'Pick your sources: KAP disclosures, SPK bulletins and economy news.',
          },
          {
            tr: 'Takip ettiğiniz hisse kodlarına dair gelişmeler önceliklendirilir; başlıkta ya da özette geçen anahtar kelimeler de bildirim tetikler.',
            en: 'Developments on the tickers you follow are prioritised; keywords appearing in a title or summary also trigger alerts.',
          },
          {
            tr: 'Yapay zeka her bildirime 1–5 arası önem puanı verir; yalnız eşiği geçenler e-posta olur.',
            en: 'AI scores every item 1–5 for importance; only those above your threshold become email.',
          },
          {
            tr: 'Değerlendirme sunucu tarafında yapılır, bu yüzden uygulama kapalıyken de sürer.',
            en: 'Scoring runs server-side, so it continues even when the app is closed.',
          },
        ],
        feeds: [
          { tr: 'KAP', en: 'KAP' },
          { tr: 'SPK', en: 'SPK' },
          { tr: 'Ekonomi haberleri', en: 'Economy news' },
        ],
        flow: [
          {
            tr: 'Kaynakları açın ve takip hisselerinizi ekleyin.',
            en: 'Turn on your sources and add the tickers you follow.',
          },
          {
            tr: 'Anahtar kelime ve önem eşiğini belirleyin.',
            en: 'Set your keywords and importance threshold.',
          },
          {
            tr: 'Kaydedin; bildirimler hesabınızın e-posta adresine gelir.',
            en: 'Save; alerts arrive at your account’s email address.',
          },
        ],
      },
    ],
  },
];

/** Tüm modüller tek düzlemde — sayfa yönlendirmesi ve önceki/sonraki için. */
export const ALL_MODULES: ModuleEntry[] = MODULE_GROUPS.flatMap((g) => g.modules);

export function findModule(slug: string): ModuleEntry | undefined {
  return ALL_MODULES.find((m) => m.slug === slug);
}

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
