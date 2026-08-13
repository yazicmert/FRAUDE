import { useEffect, useState } from 'react';
import { useTranslation } from '../../api/i18n';
import { shortcutKeys, type ShortcutId } from '../../lib/shortcuts';
import './GuideView.css';

export interface GuideViewProps {
  onOpenModule?: (kind: string, props?: Record<string, unknown>) => void;
}

// ── İçerik tipleri ─────────────────────────────────────────────
interface ModuleCard {
  code: string;
  name: string;
  tag: string;
  desc: string;
  items: string[];
}
interface ProviderFlag { label: string; tone: 'free' | 'paid' | 'neutral'; }
interface Provider {
  id: string;
  name: string;
  badge: string;
  flags: ProviderFlag[];
  desc: string;
  steps: string[];
  baseUrl: string;
  models: string[];
  note?: { text: string; tone: 'warn' | 'ok' };
}

interface TourStep {
  title: string;
  desc: string;
  features: string[];
  previewType: 'dashboard' | 'screener' | 'ticker' | 'index' | 'kap' | 'news' | 'ai' | 'monitor' | 'research' | 'corporate' | 'funds' | 'terminal' | 'team' | 'modules' | 'updates';
}

interface ModuleTour {
  code: string;
  kind: string;
  name: string;
  tag: string;
  steps: TourStep[];
}

interface OsPlatform {
  os: 'macOS' | 'Windows';
  icon: string;
  title: string;
  badge: string;
  items: string[];
}

interface GuideContent {
  eyebrow: string;
  title: string;
  sub: string;
  startTourCTA: string;
  clickToInspectTip: string;
  chips: { label: string; value?: string }[];
  modulesHeading: string;
  modulesLead: string;
  modules: ModuleCard[];
  pluginHeading: string;
  pluginLead: string;
  dataSources: ModuleCard[];
  pluginLegalNote: string;
  pluginContribute: string;
  aiHeading: string;
  aiLead: string;
  providers: Provider[];
  baseUrlLabel: string;
  modelsLabel: string;
  inAppEyebrow: string;
  inAppPath: string[];
  inAppText: string;
  securityNote: string;
  quickHeading: string;
  quickTitle: string;
  quickSteps: string[];
  shortcutsHeading: string;
  shortcutsLead: string;
  shortcuts: { id: ShortcutId; desc: string }[];
  osHeading: string;
  osLead: string;
  osPlatforms: OsPlatform[];
  modalNext: string;
  modalPrev: string;
  modalOpenModule: string;
  modalClose: string;
  tours: Record<string, ModuleTour>;
}

// ── TR / EN içerik ─────────────────────────────────────────────
const GUIDE: Record<'tr' | 'en', GuideContent> = {
  tr: {
    eyebrow: 'Rehber',
    title: 'FRAUDE nasıl kullanılır',
    sub: 'Modüllerin ne işe yaradığını ve AI özelliklerini açmak için kendi API anahtarını sağlayıcıya göre adım adım nasıl ekleyeceğini gösterir.',
    startTourCTA: '✨ İnteraktif Tura Başla',
    clickToInspectTip: '💡 Herhangi bir modüle tıklayarak adım adım canlı tutorial turunu açabilirsiniz.',
    chips: [
      { label: 'modül', value: '16' },
      { label: 'AI sağlayıcı', value: '5' },
      { label: 'varsayılan veri kaynağı', value: '2' },
      { label: 'BIST · XU100 · XHARZ' },
      { label: 'TR / EN' },
    ],
    modulesHeading: 'Modül turu',
    modulesLead: 'Sol kenar çubuğundan modüller arasında gezinir, üstteki arama/komut çubuğundan hisse açar veya komut çalıştırırsın. Her sekme bağımsız bir çalışma panelidir.',
    modules: [
      { code: 'DB', name: 'Pano', tag: 'Ana ekran', desc: 'Piyasanın günlük özeti ve karar destek modülleri.', items: ['Günlük Piyasa Bülteni: genişlik, BIST 100, XHARZ, lider/zayıf', 'Model Portföy: değer + kalite + momentum puanları', 'Bilanço Analizi: F/K, PD/DD, ROE, ROA, marj, büyüme', 'Filtreli Analiz: çoklu eşik taraması'] },
      { code: 'SC', name: 'Teknik Tarayıcı', tag: 'Screener', desc: 'Teknik göstergelere göre BIST/XHARZ evreninde tarama.', items: ['RSI(14), ATR(14) — Wilder/RMA', 'EMA, SMA, MACD, Bollinger', 'F/K, PD/DD, ROE, değişim eşikleri birlikte'] },
      { code: 'TK', name: 'Hisse Detayı', tag: 'Ticker', desc: 'Tek hissenin tam kartı; aramadan veya tablodan açılır.', items: ['Fiyat, OHLC, hacim, 52 hafta grafiği', 'Temel veriler: F/K, PD/DD, ROE, marj, Net Borç/FAVÖK', '⚖️ KAP Resmî Raporlar & Bilanço Arşivi (2008-2026): Yıl filtreleri (2019, 2018 vb.) ve canlı arama', '✨ Cmd+F + Tık: Ekranda 2 mali kalem seçerek KAP & AI karşılaştırma analizi', 'Ortaklık yapısı, bağlı ortaklıklar ve TEFAS fon pozisyonları'] },
      { code: 'IX', name: 'Endeks Görünümü', tag: 'Index', desc: 'Endeks seviyesi ve bileşen evreni.', items: ['BIST 100 (XU100) ve BIST Halka Arz (XHARZ)', 'Endeks OHLCV serisi ve bileşen listesi', 'Yeni halka arzlar IPO etiketiyle'] },
      { code: 'KB', name: 'Bilgi Deposu', tag: 'Depo', desc: 'KAP bildirimleri, SPK bültenleri, 12 kurumun analiz raporları ve haberler tek zaman çizgisinde; istediğin şirkete odaklanıp o şirketin her kaydına tek ekrandan ulaşırsın.', items: ['Dört kaynak tek akışta; tür sekmeleriyle (KAP / SPK / Analiz / Haber / Konsensüs) ayrılabiliyor', 'Şirket odağı: bir kod yazılınca dört kaynak da o şirkete indirgenir ve o payın rapor geçmişi kurumların hisse bazlı uçlarından yeniden çekilir (İş Yatırım etiket akışı, Garanti arama, Ziraat hisse kategorisi)', '12 kurumun analiz raporu: İş Yatırım, Garanti BBVA Yatırım, Ziraat Yatırım, Gedik Yatırım, Ahlatcı Yatırım, PhillipCapital, Integral Yatırım, Şeker Yatırım, Vakıf Yatırım, Halk Yatırım, Marbaş Menkul, A1 Capital', 'Kayıt açılınca kendi okuyucusunda: KAP bildirimi, SPK bülteni, analiz raporu ve haber uygulamadan çıkmadan okunur — kurumların PDF\'leri çerçevelenmeye kapalı yayımlandığı için belge indirilip gömülür, haber sayfası ise sade metne indirgenir veya kendi düzeniyle betiksiz gösterilir', 'Tek arama kutusu hepsinde geçerli: başlık, hisse kodu, kaynak, analist', 'Küresel kurum çağrıları: Goldman Sachs, JPMorgan, Morgan Stanley, HSBC, Citi, UBS, Bank of America gibi 22 kurumun BIST çağrıları. Bu kurumların raporları kurumsal aboneliğe kapalı olduğu için kayıt raporun kendisi değildir: çağrıyı aktaran haberden çıkarılır ve satırda \"haber kaynaklı · yayın adı\" diye işaretlenir, bağlantı habere gider', 'Küresel çağrılar dört kapıdan geçer — tanınan kurum, analiz izi (takas/akış haberi elenir), doğrulanmış BIST kodu ya da Türkiye+hisse bağlamı, ve emtia/kur elemesi; hiçbiri sağlanmazsa kayıt üretilmez. Aynı çağrıyı on yayın geçse kurum+kod+tarih+hedef imzasıyla tek kayda iner', 'Analiz sekmesinde yurt içi/küresel kapsam, kurum ve tür (şirket, sektör, strateji, bülten) çipleri', 'Rapor başlığından tavsiye (AL/TUT/Endeks Üstü) ve hedef fiyat çıkarımı', 'Konsensüs sekmesi: payı izleyen kurum sayısı, AL/TUT/SAT dağılımı, ortalama hedef ve getiri potansiyeli; yurt dışı bankaların BIST raporları aboneliğe kapalı olduğu için kapsamlarına bu toplamlardan ve haber kaynaklı küresel çağrılardan ulaşılır', 'Şirket bazlı özel durum açıklamaları, AI önem puanıyla', 'Bir kaynak düşerse depo boşalmaz, yalnız o bölüm eksik kalır ve uyarı gösterilir'] },
      { code: 'NW', name: 'Haber Akışı', tag: 'News', desc: 'Çok kaynaklı şirket ve piyasa haberi.', items: ['GDELT DOC 2.0 — küresel haber', 'Google News RSS — Türkçe haber', 'Bloomberg HT RSS — ekonomi', 'Okunabilir önizleme', '"Fraude\'da Oku": haber, analiz raporu ve KAP bildirimiyle aynı okuyucuda açılır — yakınlaştırma, sağ panele sabitleme, ilgili pay rozetleri ve yapay zekâ bağlamı', 'Okuyucuda iki mod: sade metin (menü, reklam ve yorumlar atılmış) ya da kaynak sayfanın kendi düzeni; sayfa betiksiz ve kökensiz bir kutuda açıldığından reklam ve izleyici çalışmaz', 'Haber metnindeki bağlantılar dış tarayıcıda açılır; uygulama okuduğunuz yerde kalır', 'Google News bağlantıları önce gerçek haber adresine çözülür'] },
      { code: 'FR', name: 'Forum', tag: 'Topluluk', desc: 'Kullanıcıların ortak alanı: konu aç, yanıtla, beğen. Metinde etiketlediğin hisse, konuyu o hissenin sayfasında da gösterir.', items: ['Gönderiler Supabase\'de ortaktır: birinin yazdığı konu diğer kullanıcıların uygulamasında da görünür', 'Etiketlemek için gövdeye $THYAO yazman yeter; "Hisse etiketle" kutusundan BIST evreninden de seçebilirsin', 'Gövdeye $ yazdığın anda hisse listesi açılır ve yazdığın her harfte hem koda hem şirket adına göre süzülür ($tü → TUPRS, TURSG...); ↑↓ ile gez, Enter ya da Tab ile ekle, Esc ile kapat', 'Etiketin karşılığı: aynı gönderi o hissenin sayfasındaki Forum bölümünde listelenir — hisse sayfasından yazınca etiket kendiliğinden eklenir', 'Tek seviye iş parçacığı: konu + yanıtlar, beğeni, kendi gönderini düzenleme ve silme', 'En çok konuşulanlar paneli son bir haftanın etiket sayımından; tıklayınca akış o hisseye iner', 'Yeni gönderiler canlı düşer ve listeye tek tek işlenir: okuduğun yer kaybolmaz, başkasının beğenisi anında görünür', 'Kartın ⋯ menüsünden bildir (spam/hakaret/yanlış bilgi) ya da kullanıcıyı engelle; engellediklerin sağ panelden geri alınır', 'Üç ayrı kişi bildirince gönderi moderatör bakana kadar kendiliğinden gizlenir — gövdesi durur, karar geri alınabilir', 'Moderatörler sağ paneldeki kuyruktan gizler, geri alır ya da bildirimleri temizler', 'Yazar adı sunucuda oturumdan yazılır, istemciden gelen ad yok sayılır; dakikada 8, günde 100 gönderi sınırı vardır'] },
      { code: 'AI', name: 'AI Araştırma', tag: 'Panel + yan', desc: 'Kendi anahtarınla çalışan araştırma asistanı.', items: ['Global AI Terminali: Çift dilli (TR/EN) canlı daktilo önerileri ve görsel analizi (Cmd+V)', 'Derin Düşünme & Efor ayarı (Low / Medium / High - Reasoning)', 'Özel AI ajanları (Bilanço & KAP Dedektifi, Sektör Analisti, Makroekonomi)', 'Glassmorphic matris arka plan ve Cmd+F ile anında saydamlaşma'] },
      { code: 'RD', name: 'İzleme Radarı', tag: 'Monitor', desc: 'Takip listeni arka planda tarar.', items: ['Yeni KAP bildirimlerini periyodik kontrol', 'Ortaklık / iş ilişkisi sınıflandırma', 'Zil rozeti + OS bildirimi', 'AI yorumlu uyarılar'] },
      { code: 'RS', name: 'Araştırma', tag: 'Research', desc: 'AI ajan takımıyla hisse araştırması + serbest görevler.', items: ['Hisseyi 4 role bölüp paralel araştırma (temel/KAP-haber/teknik/ortaklık)', 'Lider ajan tek rapora sentezler; her rol farklı sağlayıcı olabilir', 'Chrome eklentisinden metin/URL/görsel görevi', 'İş kuyruğu + bitince bildirim; raporlar Artifact olur'] },
      { code: 'CA', name: 'Kurumsal Olaylar', tag: 'Corporate', desc: 'Şirket aksiyonları ve halka arz takvimi.', items: ['Temettü kayıtları — KAP kar payı bildirimlerinden: pay grubu bazında brüt/net ve kesinleşen hak kullanım tarihi', 'Yaklaşan temettü takvimi de KAP kaynaklı: bildirimler arka planda sürekli taranır, taksitli dağıtımda her taksit kendi tarihi ve brüt tutarıyla ayrı satır olur; KAP kaydı olmayan hisse için sağlayıcı tahmini devrede kalır', 'Bedelli/bedelsiz sermaye artırımları — SPK bültenleri + KAP bildirimleri', 'Halka arz takvimi ve arşivi; fiyat, lot ve arz büyüklüğü SPK izahname onayından', 'Onay sonrası otomatik takip: katılımcı sayısı, ilk işlem tarihi, pazar ve endeks üyeliği KAP bildirimleri yayımlandıkça kendiliğinden dolar', 'Her satır kaynağını gösterir (SPK bülteni / KAP bildirimi)'] },
      { code: 'AR', name: 'Analist Raporları', tag: 'Hisse detayı', desc: 'Aracı kurum ve bankaların yayımladığı araştırma raporları, hisse sayfasında toplanır.', items: ['İş Yatırım, Vakıf Yatırım, Halk Yatırım araştırma akışları', 'Rapor başlığından tavsiye (AL/TUT/Endeks Üstü) ve hedef fiyat çıkarımı', 'Rapor PDF\'ine tek tıkla erişim', 'Hisse bazlı etiket akışıyla o şirketin tam rapor geçmişi'] },
      { code: 'FO', name: 'Fonlar', tag: 'TEFAS', desc: 'TEFAS fonları: getiriler, dağılım ve fon içi varlık kırılımı.', items: ['~3200 fon; tür filtreleri ve getiri sıralaması', 'KAP PDR\'den fon içi tek tek varlıklar', 'Taranmış raporları AI görüntü analiziyle çözme (kendi anahtarınla, ucuz model yeter)', 'Fon karşılaştırma grafiği'] },
      { code: '$_', name: 'Terminal (FQL)', tag: 'Komut', desc: 'Klavyeyle her şeyi süren komut satırı.', items: ['open THYAO — hisse aç', 'scan … — tarama çalıştır', 'kap · sync · ask … · help'] },
      { code: 'TM', name: 'Ekip', tag: 'Team', desc: 'Ekip çalışma alanı ve paylaşılan görünümler.', items: ['Ortak izleme ve araştırma bağlamı'] },
      { code: 'MD', name: 'Modül Merkezi', tag: 'Modules', desc: 'Modülleri açıp kapatma ve güncelleme.', items: ['Modül kataloğu ve kurulum', 'İmzalı güncelleme / geri alma', 'Kenar çubuğu sekmelerini özelleştirme'] },
      { code: 'UP', name: 'Güncellemeler', tag: 'Ayarlar ▸', desc: 'Topluluk güncellemelerini sorgula, uygula ve kendi katkını gönder (⌘, → Güncellemeler).', items: ['Güncelleme Sorgula: kayıt defteri + son paket sürümü', 'Yeni paket çıktığında tek tuşla kurulum indirme', 'Pakete girmemiş kayıtlar için AI ajan promptunu kopyala, yerel klonunda uygula', 'Güncelleme Gönder: GitHub token ile otomatik PR, tokensız önceden doldurulmuş taslak'] },
    ],
    pluginHeading: 'Eklenti mimarisi: veri ve AI senin kontrolünde',
    pluginLead:
      'FRAUDE açık kaynaklıdır ve tak-çıkar çalışır: masaüstü uygulamayı indiren herkes kendi AI sağlayıcısını kendi API anahtarıyla bağlar, kendi veri sağlayıcısını da eklenti olarak ekleyebilir. Kurulum iki hazır veri kaynağıyla gelir; ikisini de değiştirmek ya da yenisini eklemek serbesttir.',
    dataSources: [
      { code: 'Y!', name: 'Yahoo Finance', tag: 'Varsayılan', desc: 'Küresel fiyat verisi: BIST hisseleri, endeksler, emtia, döviz ve kripto.', items: ['OHLC mum + hacim serileri', '~15 dk gecikmeli kotasyon', 'Temettü ve bölünme olayları'] },
      { code: 'TV', name: 'TradingView', tag: 'Uzun dönem', desc: 'Yalnız 5 yıllık ve tüm zamanlık getiriler; tek istekte 619 BIST payı.', items: ['Bu iki dönemin başka ücretsiz kaynakta toplu karşılığı yok', 'Kısa dönemlerde otorite İş Yatırım\'da kalır — aynı dönem iki kaynaktan okunmaz', 'Kaynak düşerse senkron başarısız sayılmaz, diğer veriler gelir'] },
      { code: 'İŞ', name: 'İş Yatırım', tag: 'Varsayılan', desc: "BIST'e özgü derinlik: düzeltilmiş seriler, mali tablolar ve tarama verisi.", items: ['Düzeltilmiş kapanış (temettü/bölünme yansıtılmış)', 'Mali tablo kalemleri', 'Tarama oranları (F/K, PD/DD, ROE…)'] },
      { code: '+', name: 'Kendi kaynağın', tag: 'Eklenti', desc: 'Kendi lisanslı veri beslemen veya API\'n varsa data-adapter eklentisiyle bağlarsın.', items: ['FMUP manifest: kind "data-adapter"', 'İmzalı paket + açık izin listesi', 'Ayarlar › Güncellemeler › Güncelleme Gönder ile toplulukla paylaşılır'] },
    ],
    pluginLegalNote:
      'Varsayılan kaynaklar (Yahoo Finance ve İş Yatırım) internette herkese açık, ücretsiz uçlardan okunur; kotasyonlar ~15 dk gecikmelidir ve kişisel araştırma içindir. Veri sahiplerinin kullanım koşulları geçerlidir: veriyi yeniden yayımlamak veya ticari bir üründe kullanmak ilgili sağlayıcıdan lisans gerektirebilir. FRAUDE veri satmaz ve yatırım tavsiyesi vermez.',
    pluginContribute:
      'Geliştirdiğin sağlayıcı eklentisi güvenlik incelemesinden geçtikten sonra sitedeki Güncellemeler sayfasında ve herkesin uygulamasındaki Güncellemeler sekmesinde listelenir.',
    aiHeading: 'API anahtarını sağlayıcına göre ekle',
    aiLead: 'AI Araştırma, İzleme Radarı yorumları ve ajan analizleri senin kendi API anahtarınla çalışır — anahtarı sen alır, uygulamaya girersin, kullanım senin hesabına işler. Sağlayıcını seç; nereye gireceğini, ne alacağını ve FRAUDE\'ye nasıl gireceğini gör.',
    baseUrlLabel: 'Base URL',
    modelsLabel: 'Models',
    providers: [
      {
        id: 'openai', name: 'OpenAI', badge: 'AI',
        flags: [{ label: 'Ücretli · kullanım bazlı', tone: 'paid' }, { label: 'Kredi kartı gerekir', tone: 'neutral' }],
        desc: 'GPT modelleri. Genel amaçlı analiz için güçlü varsayılan. Anahtar sk- ile başlar ve yalnızca bir kez gösterilir.',
        steps: [
          'platform.openai.com adresine git, hesap aç veya giriş yap.',
          'Sağ üstteki hesap menüsünden API keys sayfasını aç (platform.openai.com/api-keys).',
          'Create new secret key → anahtara ad ver → oluştur.',
          'Çıkan sk-… anahtarını hemen kopyala (sayfayı kapatınca tekrar görünmez).',
          'Billing → Payment methods altından kart ekle ve bakiye tanımla (yoksa istekler reddedilir).',
        ],
        baseUrl: 'https://api.openai.com/v1',
        models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini', 'o1', 'o1-mini'],
      },
      {
        id: 'deepseek', name: 'DeepSeek', badge: 'DS',
        flags: [{ label: 'Ücretli · çok uygun', tone: 'paid' }, { label: 'Ön ödemeli bakiye', tone: 'neutral' }],
        desc: 'DeepSeek-V3 (sohbet) ve DeepSeek-R1 (akıl yürütme). Düşük maliyetle güçlü analiz. OpenAI-uyumlu API.',
        steps: [
          'platform.deepseek.com adresine git ve kayıt ol.',
          'Panelde API keys bölümünü aç.',
          'Create new API key → oluştur → sk-… anahtarını kopyala.',
          'Top up / Billing altından hesabına bakiye yükle.',
        ],
        baseUrl: 'https://api.deepseek.com/v1',
        models: ['deepseek-chat (V3)', 'deepseek-reasoner (R1)'],
      },
      {
        id: 'google', name: 'Gemini', badge: 'G',
        flags: [{ label: 'Ücretsiz katman var', tone: 'free' }, { label: 'Google hesabı yeter', tone: 'neutral' }],
        desc: 'Gemini modelleri. Ücretsiz katmanla denemeye başlamak için en kolay yol. FRAUDE Google\'ın OpenAI-uyumlu ucunu kullanır.',
        steps: [
          'aistudio.google.com (Google AI Studio) adresine Google hesabınla gir.',
          'Üstten veya sol menüden Get API key\'e tıkla.',
          'Create API key → (istenirse proje seç) → anahtarı kopyala.',
          'Daha yüksek limit için Cloud Billing\'i etkinleştir; başlangıç için ücretsiz katman yeterli.',
        ],
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
      },
      {
        id: 'qwen', name: 'Qwen', badge: 'Q',
        flags: [{ label: 'Ücretli', tone: 'paid' }, { label: 'Deneme kotası', tone: 'free' }],
        desc: 'Alibaba\'nın Qwen modelleri, DashScope üzerinden. Uzun bağlam ve çok dilli görevlerde güçlü. compatible-mode = OpenAI-uyumlu.',
        steps: [
          'Alibaba Cloud hesabı aç ve DashScope (Model Studio) servisini etkinleştir.',
          'dashscope.console.aliyun.com → API-KEY yönetimini aç.',
          'Create API Key → sk-… anahtarını kopyala.',
          'Uluslararası hesaplarda uç dashscope-intl olabilir; sağlayıcının verdiği base URL\'i esas al.',
        ],
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-long'],
      },
      {
        id: 'anthropic', name: 'Claude', badge: 'C',
        flags: [{ label: 'Ücretli · kullanım bazlı', tone: 'paid' }, { label: 'Ön ödemeli bakiye', tone: 'neutral' }],
        desc: 'Anthropic\'in Claude modelleri. FRAUDE, Anthropic\'in OpenAI-uyumluluk katmanını kullanır; anahtar aynı Bearer başlığıyla gider.',
        steps: [
          'console.anthropic.com adresine gidip hesap aç.',
          'API keys bölümünden Create key → sk-ant-… anahtarını kopyala.',
          'Plans & billing altından bakiye yükle (bakiyesiz istekler reddedilir).',
        ],
        baseUrl: 'https://api.anthropic.com/v1',
        models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
        note: { text: 'Uyumluluk katmanı temel sohbet için yeterli; uzun düşünme ve prompt önbelleği gibi Anthropic\'e özgü özellikler bu yoldan gelmez.', tone: 'warn' },
      },
      {
        id: 'custom', name: 'Custom', badge: '+',
        flags: [{ label: 'Base URL zorunlu', tone: 'neutral' }, { label: 'Llama · Mistral · ağ geçitleri', tone: 'neutral' }],
        desc: 'Custom, OpenAI-uyumlu herhangi bir uca bağlanmanı sağlar: base URL ve model kimliğini sen belirlersin. Birden çok modeli tek anahtarla sunan bir ağ geçidi (OpenRouter, Together AI) ya da kendi proxy\'in.',
        steps: [
          'Bir sağlayıcı seç — ör. openrouter.ai (tek anahtarla Claude/Llama/Mistral) veya together.ai.',
          'Hesap aç → Keys / API Keys → yeni anahtar oluştur → kopyala.',
          'Sağlayıcının Base URL\'ini not al (ör. OpenRouter: https://openrouter.ai/api/v1).',
          'Kullanmak istediğin tam model kimliğini sağlayıcının listesinden al.',
        ],
        baseUrl: 'Sağlayıcına göre — Custom alanına yapıştır',
        models: ['meta-llama/Llama-3-70b-chat-hf', 'mistralai/Mistral-7B-Instruct-v0.2'],
        note: { text: 'Custom\'da Base URL zorunludur: boş bırakılan adres anahtarını yanlış sağlayıcıya gönderir. Model kimliği de sağlayıcıya göre değişir (ör. OpenRouter\'da anthropic/claude-sonnet-4.5); doğru dizeyi belgelerden kopyala.', tone: 'warn' },
      },
    ],
    inAppEyebrow: 'Sonra: FRAUDE içinde',
    inAppPath: ['Ayarlar', 'AI Providers', 'Add key'],
    inAppText: 'Provider\'ı seç (OpenAI / DeepSeek / Google / Qwen / Claude / Custom), bir Label yaz, kopyaladığın API key\'i yapıştır, Default model\'i seç. Provider\'ı seçince Base URL otomatik dolar (Custom\'da elle girersin, zorunludur). Kaydettikten sonra Test ile doğrula — Test artık sağlayıcıya gerçek bir istek atar, yani yanlış anahtar veya model orada belli olur. Birden fazla anahtar ekleyip ajanlarına farklı anahtar atayabilir, kopilotun üst çubuğundan istek başına anahtar seçebilirsin.',
    securityNote: 'Güvenlik: Anahtar kaydedildikten sonra arayüze düz metin olarak geri dönmez; yalnızca maskeli gösterilir (sk-t••••).',
    quickHeading: 'Başla',
    quickTitle: 'Hızlı başlangıç',
    quickSteps: [
      'İlk açılışta piyasa verisi otomatik senkronlanır; Pano dolmaya başlar.',
      'Üstteki arama çubuğuna hisse kodu yaz (ör. THYAO) ya da Terminal\'de open THYAO çalıştır.',
      'AI için Ayarlar › AI Providers\'a git ve yukarıdaki adımlarla anahtarını ekle.',
      'İzleme Radarı\'na birkaç hisse ekle ve etkin yap; arka plan taraması başlasın.',
    ],
    shortcutsHeading: 'Klavye Kısayolları',
    shortcutsLead: 'FRAUDE, klavye ile hızlı kullanım için optimize edilmiştir.',
    shortcuts: [
      { id: 'palette', desc: 'Arama ve Komut Paletini aç' },
      { id: 'sidebar', desc: 'Kenar çubuğunu aç/kapat' },
      { id: 'terminal', desc: 'Terminal panelini aç/kapat' },
      { id: 'aiPanel', desc: 'YZ panelini aç/kapat' },
      { id: 'alerts', desc: 'Fiyat & teknik alarmları aç/kapat' },
      { id: 'monitor', desc: 'İzleme Radarı sekmesini aç' },
      { id: 'sync', desc: 'Verileri şimdi eşitle' },
      { id: 'settings', desc: 'Ayarlar modülünü aç' },
      { id: 'close', desc: 'Açık pencereleri veya paleti kapat' },
    ],
    osHeading: ' macOS ve ⊞ Windows Platform Farklılıkları',
    osLead: 'FRAUDE Terminal, kullandığınız işletim sistemine (macOS / Windows) göre klavye kısayollarını, yerel pencere kontrollerini ve WebView motorlarını otomatik entegre eder.',
    osPlatforms: [
      {
        os: 'macOS',
        icon: '',
        title: 'macOS (Apple Silicon M1/M2/M3/M4 & Intel)',
        badge: '.dmg Paketi',
        items: [
          'Kısayol Tuş Kombinasyonu: ⌘ (Command) tuşu kullanılır (ör. ⌘ + K, ⌘ + J, ⌘ + L, ⌘ + B).',
          'Mali Tablo / Yıl Kıyaslama: Cmd + Tık (⌘ + Tık) ile iki bilançoyu yan yana karşılaştırabilirsiniz.',
          'Pencere Kontrolleri: Sol üstte yer alan klasik macOS 🔴 🟡 🟢 trafik ışığı butonları.',
          'Yerel Grafik / Render Motoru: macOS WebKit native grafik hızlandırması.',
          'Gatekeeper İzni: İlk açılışta güvenlik uyarısı çıkarsa "Sağ Tık › Aç (Open)" ile izin verilebilir.',
        ],
      },
      {
        os: 'Windows',
        icon: '⊞',
        title: 'Windows (Windows 10 / 11 64-bit)',
        badge: '.exe Kurulumu',
        items: [
          'Kısayol Tuş Kombinasyonu: Ctrl (Control) tuşu kullanılır (ör. Ctrl + K, Ctrl + J, Ctrl + L, Ctrl + B).',
          'Mali Tablo / Yıl Kıyaslama: Ctrl + Tık ile iki bilançoyu yan yana karşılaştırabilirsiniz.',
          'Pencere Kontrolleri: Sağ üstte yer alan klasik Windows pencere kumandaları (─ □ ✕).',
          'Yerel Grafik / Render Motoru: Microsoft Edge WebView2 runtime motoru.',
          'SmartScreen İzni: İlk kurulumda koruma uyarısı çıkarsa "Ek Bilgi › Yine de Çalıştır" tıklanır.',
        ],
      },
    ],
    modalNext: 'Sonraki Adım ▸',
    modalPrev: '◂ Önceki Adım',
    modalOpenModule: '🚀 Modüle Git',
    modalClose: 'Kapat (Esc)',
    tours: {
      DB: {
        code: 'DB',
        kind: 'dashboard',
        name: 'Pano (Dashboard)',
        tag: 'Ana Ekran',
        steps: [
          {
            title: 'Piyasanın Nabzını Tek Bakışta Yakalayın',
            desc: 'Pano, BIST 100 (XU100) ve BIST Halka Arz (XHARZ) endekslerinin canlı durumunu, genişlik analizini ve piyasa liderlerini tek ekranda sunar.',
            features: ['Piyasa Genişliği: Yükselen / Düşen / Yatay hisse sayıları', 'BIST 100 ve XHARZ mini grafikleri ve günlük hacimler', 'Günün en çok yükselen, düşen ve hacimli şirketleri'],
            previewType: 'dashboard',
          },
          {
            title: 'Model Portföy ve Karar Destek Skorları',
            desc: 'Şirketlerin Değer (Value), Kalite (Quality) ve Momentum puanlamaları birleştirilerek oluşturulan algoritma destekli karar skorları.',
            features: ['F/K ve PD/DD çarpanlarına dayalı Değer skoru', 'Karlılık (ROE/ROA) ve marjlara dayalı Kalite puanı', 'Fiyat trendi ve hacim bazlı Momentum skoru'],
            previewType: 'dashboard',
          },
          {
            title: 'Çoklu Eşik ve Bilanço Özeti',
            desc: 'Pano üzerindeki filtreli alan sayesinde F/K < 10, ROE > %20 gibi temel kriterleri anında süzebilir ve şirket tablolarına hızlıca erişebilirsiniz.',
            features: ['Temel marjlar ve bilanço kalemleri', 'Tek tıkla tarama sonuçlarından hisse detayına geçiş', 'Günlük Piyasa Bülteni özet notları'],
            previewType: 'dashboard',
          },
        ],
      },
      SC: {
        code: 'SC',
        kind: 'screener',
        name: 'Teknik & Temel Tarayıcı',
        tag: 'Screener',
        steps: [
          {
            title: 'BIST Evrenini Anında Filtreleyin',
            desc: 'Teknik göstergeler ile temel oranları aynı anda harmanlayan gelişmiş tarayıcı engine.',
            features: ['Wilder RMA / Wilder Smooth RSI(14) ve ATR(14)', 'EMA(20), SMA(50), MACD kesisimleri ve Bollinger Bantları', 'F/K, PD/DD, ROE ve Günlük Değişim filtreleri'],
            previewType: 'screener',
          },
          {
            title: 'Hazır Taramalar ve FQL Entegrasyonu',
            desc: 'Aşırı satım (RSI < 30), Altın Kesişim (Golden Cross) veya yüksek büyüme gösteren şirketleri tek tıkla listeleyin.',
            features: ['Önceden tanımlı strateji şablonları', 'Sonuçları sıralama ve dışa aktarma', 'FQL terminalinden gelen tarama sorgularının otomatik açılması'],
            previewType: 'screener',
          },
        ],
      },
      TK: {
        code: 'TK',
        kind: 'ticker',
        name: 'Hisse Detay Kartı',
        tag: 'Ticker',
        steps: [
          {
            title: 'Detaylı Hisse Analiz Kartı',
            desc: 'Herhangi bir hissenin OHLC mum serileri, 52 haftalık aralığı, hacmi ve piyasa değeri tek bir dinamik görünümde.',
            features: ['İnteraktif mum grafik (Lightweight Charts)', '52 Haftalık En Yüksek / En Düşük band göstergesi', 'Anlık kotasyon ve yüzdesel değişimler'],
            previewType: 'ticker',
          },
          {
            title: 'Mali Tablolar & Ortaklık Yapısı',
            desc: 'Şirketin bilançosu, Net Borç/FAVÖK oranı, özkaynak karlılığı ve ortaklık dağılımı.',
            features: ['İş Yatırım düzeltilmiş serileri ve mali veriler', 'Şirketin bağlı ortaklıkları ve iştirakleri', 'KAP bildirimleri ve hisseye özel haberler'],
            previewType: 'ticker',
          },
          {
            title: 'TEFAS Fon Pozisyonları',
            desc: 'KAP PDR dizininden taranan verilere göre ilgili hisseyi portföyünde tutan fonlar ve ağırlık yüzdeleri.',
            features: ['Hangi fonların hisseyi tuttuğunu görme', 'Fon portföy ağırlık oranları (%3.5, %5.2 vb.)', 'AI ile KAP dipnot analizleri'],
            previewType: 'ticker',
          },
        ],
      },
      AI: {
        code: 'AI',
        kind: 'ai',
        name: 'AI Araştırma Asistanı',
        tag: 'AI Assistant',
        steps: [
          {
            title: 'Kendi API Anahtarınızla Çalışan AI',
            desc: 'OpenAI, DeepSeek, Google Gemini veya Qwen anahtarınızı ekleyerek sınırsız finansal araştırma yapın.',
            features: ['Gizli veri iletimi: API anahtarınız local makinede saklanır', 'OpenAI-uyumlu tüm sağlayıcılar desteklenir', 'Aktif sekme bağlamını (hisse, bilanço, haber) otomatik anlama'],
            previewType: 'ai',
          },
          {
            title: 'Özel Ajanlar ve Sentez Raporlar',
            desc: 'Temel analiz ajanı, haber duyarlılık ajanı veya teknik analiz ajanı gibi uzman rollere soru sorun.',
            features: ['Gelişmiş finansal sistem komutları (System Prompts)', 'Bilanço ve KAP duyurularını otomatik yorumlama', 'Sohbet geçmişi saklama ve dışa aktarma'],
            previewType: 'ai',
          },
        ],
      },
      RD: {
        code: 'RD',
        kind: 'monitor',
        name: 'İzleme Radarı',
        tag: 'Monitor',
        steps: [
          {
            title: 'Arka Planda Otomatik Piyasa Bekçisi',
            desc: 'Seçtiğiniz hisselerin KAP bildirimlerini ve fiyat hareketlerini arka planda kesintisiz izler.',
            features: ['Yeni özel durum açıklamalarını periyodik sorgulama', 'Ortaklık ve yeni iş ilişkilerini AI ile sınıflandırma', 'İşletim sistemi bildirimi ve zil rozeti uyarısı'],
            previewType: 'monitor',
          },
        ],
      },
      '$_': {
        code: '$_',
        kind: 'terminal',
        name: 'FRAUDE Terminal (FQL)',
        tag: 'FQL Terminal',
        steps: [
          {
            title: 'Klavyeden Şimşek Hızında Yönetim',
            desc: 'FQL (Fraude Query Language) komutlarıyla fareye dokunmadan tüm uygulamayı sürün.',
            features: ['open THYAO: Hisse detayını anında açar', 'scan BIST100 where rsi < 30: Aşırı satım taraması çalıştırır', 'ai <soru>: AI araştırma asistanına soru gönderir', 'clear: Terminal geçmişini temizler'],
            previewType: 'terminal',
          },
        ],
      },
    },
  },
  en: {
    eyebrow: 'Guide',
    title: 'How to use FRAUDE',
    sub: 'Shows what each module does and how to add your own API key — provider by provider — to unlock the AI features.',
    startTourCTA: '✨ Start Interactive Tour',
    clickToInspectTip: '💡 Click on any module to open its step-by-step interactive live tutorial.',
    chips: [
      { label: 'modules', value: '16' },
      { label: 'AI providers', value: '5' },
      { label: 'default data sources', value: '2' },
      { label: 'BIST · XU100 · XHARZ' },
      { label: 'TR / EN' },
    ],
    modulesHeading: 'Module tour',
    modulesLead: 'Navigate modules from the left sidebar, open tickers or run commands from the top search/command bar. Each tab is an independent workspace.',
    modules: [
      { code: 'DB', name: 'Dashboard', tag: 'Home', desc: 'Daily market summary and decision-support modules.', items: ['Daily Market Bulletin: breadth, BIST 100, XHARZ, leaders/laggards', 'Model Portfolio: value + quality + momentum scores', 'Financial Analysis: P/E, P/B, ROE, ROA, margin, growth', 'Filtered Analysis: multi-threshold screen'] },
      { code: 'SC', name: 'Technical Screener', tag: 'Screener', desc: 'Screen the BIST/XHARZ universe by technical indicators.', items: ['RSI(14), ATR(14) — Wilder/RMA', 'EMA, SMA, MACD, Bollinger', 'P/E, P/B, ROE, change thresholds together'] },
      { code: 'TK', name: 'Ticker Detail', tag: 'Ticker', desc: 'Full card for a single stock; opened from search or a table.', items: ['Price, OHLC, volume, 52-week chart', 'Fundamentals: P/E, P/B, ROE, margin, Net Debt/EBITDA', '⚖️ Official KAP Financials Archive (2008-2026): Live search & year pills (2019, 2018 etc.)', '✨ Cmd+F + Click: Select 2 financial items on screen for instant AI comparison', 'Shareholder structure, subsidiaries, and TEFAS fund holdings'] },
      { code: 'IX', name: 'Index View', tag: 'Index', desc: 'Index level and constituent universe.', items: ['BIST 100 (XU100) and BIST IPO (XHARZ)', 'Index OHLCV series and constituents', 'New IPOs tagged IPO'] },
      { code: 'KB', name: 'Knowledge Base', tag: 'Base', desc: 'KAP disclosures, SPK bulletins, research from 12 brokers and news on one timeline; focus on any company and reach every record about it from a single screen.', items: ['Four sources in one stream, separable via type tabs (KAP / SPK / Research / News / Consensus)', 'Company focus: type a ticker and all four sources narrow to that company, while its report history is re-pulled from the brokers\' per-ticker endpoints (İş Yatırım tag feed, Garanti keyword search, Ziraat per-ticker category)', 'Research reports from 12 brokers: İş Yatırım, Garanti BBVA Yatırım, Ziraat Yatırım, Gedik Yatırım, Ahlatcı Yatırım, PhillipCapital, Integral Yatırım, Şeker Yatırım, Vakıf Yatırım, Halk Yatırım, Marbaş Menkul, A1 Capital', 'Opening a record uses its own reader: KAP disclosures, SPK bulletins, research reports and news are read without leaving the app — brokers publish their PDFs with framing disabled, so the document is downloaded and embedded, while an article is reduced to clean text or shown script-free in its own layout', 'One search box across all of them: title, ticker, source, analyst', 'Global institution calls: BIST calls from 22 institutions including Goldman Sachs, JPMorgan, Morgan Stanley, HSBC, Citi, UBS and Bank of America. Their research is behind an institutional subscription, so the entry is not the report itself: it is extracted from the news story relaying the call, marked \"via news · outlet\" on the row, and the link goes to the article', 'Global calls pass four gates — a recognised institution, an analysis marker (trading-flow stories are dropped), a verified BIST code or a Turkey+equity context, and a commodity/FX filter; if none hold, no record is produced. Ten outlets relaying one call collapse into a single entry via an institution+ticker+date+target signature', 'Scope (domestic/global), broker and type (company, sector, strategy, bulletin) chips on the research tab', 'Rating (Buy/Hold/Outperform) and target price extracted from the report', 'Consensus tab: number of covering institutions, BUY/HOLD/SELL split, average target and upside; foreign banks\' BIST reports are subscription-gated, so their coverage is reached only through these aggregates', 'Company material disclosures with the AI importance score', 'If one source fails the base is not emptied — only that section is missing, and a warning is shown'] },
      { code: 'NW', name: 'News Feed', tag: 'News', desc: 'Multi-source company and market news.', items: ['GDELT DOC 2.0 — global news', 'Google News RSS — Turkish news', 'Bloomberg HT RSS — economy', 'Readable preview', '"Read in Fraude": articles open in the same reader as research reports and KAP disclosures — zoom, dock to the right panel, related-ticker chips and AI context', 'Two modes in the reader: clean text (menus, ads and comments dropped) or the source page’s own layout; the page opens in a script-less, origin-less box, so ads and trackers never run', 'Links inside the article open in the external browser; the app stays where you were reading', 'Google News links are resolved to the real article address first'] },
      { code: 'FR', name: 'Forum', tag: 'Community', desc: 'The shared space for users: start a thread, reply, like. A ticker tagged in your text also shows the thread on that ticker\'s page.', items: ['Posts are shared in Supabase: a thread one user writes shows up in every other user\'s app', 'To tag, just type $THYAO in the body; you can also pick from the BIST universe via "Tag a ticker"', 'Typing $ in the body opens a ticker list that narrows on every keystroke, matching both the code and the company name ($tu → TUPRS, TURSG...); browse with ↑↓, insert with Enter or Tab, dismiss with Esc', 'What the tag does: the same post is listed in the Forum section of that ticker\'s page — writing from a ticker page adds the tag automatically', 'Single-level threads: topic + replies, likes, editing and deleting your own post', 'A most-discussed panel from the past week\'s tag counts; clicking one narrows the feed to that ticker', 'New posts arrive live and are merged row by row: your reading position is kept and someone else\'s like shows up at once', 'The ⋯ menu on a card reports a post (spam/abuse/misinformation) or blocks the user; blocked people can be released from the side panel', 'Once three different people report a post it hides itself until a moderator looks — the body is kept, so the call is reversible', 'Moderators hide, restore or clear reports from the queue in the side panel', 'The author name is written server-side from the session, a client-supplied name is ignored; the rate limit is 8 posts per minute and 100 per day'] },
      { code: 'AI', name: 'AI Research', tag: 'Panel + side', desc: 'Research assistant powered by your own key.', items: ['Global AI Terminal: Bilingual (TR/EN) live typewriter prompt suggestions & screenshot analysis (Cmd+V)', 'Deep Reasoning & Effort control (Low / Medium / High - Reasoning)', 'Specialized AI agents (Financial & KAP Auditor, Equity & Sector Analyst, Macroeconomy)', 'Glassmorphic matrix backdrop with instant Cmd+F unblur'] },
      { code: 'RD', name: 'Watch Radar', tag: 'Monitor', desc: 'Scans your watchlist in the background.', items: ['Periodic checks for new KAP disclosures', 'Ownership / business-relation classification', 'Bell badge + OS notification', 'AI-commented alerts'] },
      { code: 'RS', name: 'Research', tag: 'Research', desc: 'AI agent-team stock research + free-form tasks.', items: ['Split a stock into 4 roles researched in parallel (fundamental/KAP-news/technical/ownership)', 'A lead agent synthesizes one report; each role can be a different provider', 'Text/URL/image tasks from the Chrome extension', 'Job queue + completion notifications; reports become Artifacts'] },
      { code: 'CA', name: 'Corporate Actions', tag: 'Corporate', desc: 'Corporate actions and IPO calendar.', items: ['Dividend records — from KAP dividend disclosures: gross/net per share class and the confirmed ex-date', 'The upcoming-dividend calendar is KAP-sourced too: disclosures are crawled continuously in the background, and each installment of a staged distribution becomes its own row with its own date and gross amount; the provider estimate stays in place for shares with no KAP record yet', 'Rights / bonus capital increases — SPK bulletins + KAP disclosures', 'IPO calendar and archive; price, lots and deal size from the SPK prospectus approval', 'Automatic follow-up after approval: investor count, first trading date, market and index membership fill themselves in as the KAP disclosures land', 'Every row shows its source (SPK bulletin / KAP disclosure)'] },
      { code: 'AR', name: 'Analyst Reports', tag: 'Stock detail', desc: 'Research reports published by brokerages and banks, collected on the stock page.', items: ['İş Yatırım, Vakıf Yatırım and Halk Yatırım research feeds', 'Rating (Buy/Hold/Outperform) and target price extracted from the report', 'One-click access to the report PDF', 'Per-ticker tag feed for a company\'s full report history'] },
      { code: 'FO', name: 'Funds', tag: 'TEFAS', desc: 'TEFAS funds: returns, allocation and per-holding breakdown.', items: ['~3200 funds; kind filters and return sorting', 'Per-security holdings from KAP PDR', 'Scanned reports solved via AI vision analysis (your own key, a cheap model suffices)', 'Fund comparison chart'] },
      { code: '$_', name: 'Terminal (FQL)', tag: 'Command', desc: 'Command line that drives everything from the keyboard.', items: ['open THYAO — open a ticker', 'scan … — run a screen', 'kap · sync · ask … · help'] },
      { code: 'TM', name: 'Team', tag: 'Team', desc: 'Team workspace and shared views.', items: ['Shared watch and research context'] },
      { code: 'MD', name: 'Module Center', tag: 'Modules', desc: 'Enable/disable and update modules.', items: ['Module catalog and install', 'Signed update / rollback', 'Customize sidebar tabs'] },
      { code: 'UP', name: 'Updates', tag: 'In Settings ▸', desc: 'Check community updates, apply them and submit your own contribution (⌘, → Updates).', items: ['Check for Updates: registry + latest package version', 'One-click installer download when a new package ships', 'Copy the AI-agent prompt for unpackaged entries, apply in your local clone', 'Submit Update: automatic PR with a GitHub token, prefilled draft without'] },
    ],
    pluginHeading: 'Plug-in architecture: your data, your AI',
    pluginLead:
      'FRAUDE is open source and plug-and-play: anyone who downloads the desktop app connects their own AI provider with their own API key, and can add their own data provider as a plug-in. The install ships with two ready data sources; both can be replaced or extended freely.',
    dataSources: [
      { code: 'Y!', name: 'Yahoo Finance', tag: 'Default', desc: 'Global price data: BIST equities, indices, commodities, FX and crypto.', items: ['OHLC candles + volume series', '~15-min delayed quotes', 'Dividend and split events'] },
      { code: 'TV', name: 'TradingView', tag: 'Long term', desc: 'Five-year and all-time returns only; 619 BIST shares in one request.', items: ['No other free source exposes these two periods in bulk', 'İş Yatırım stays authoritative for shorter periods — no period is read from two sources', 'If the source is down the sync still succeeds with the other data'] },
      { code: 'İŞ', name: 'İş Yatırım', tag: 'Default', desc: 'BIST-specific depth: adjusted series, financial statements and screening data.', items: ['Adjusted close (dividends/splits applied)', 'Financial statement items', 'Screening ratios (P/E, P/B, ROE…)'] },
      { code: '+', name: 'Your own source', tag: 'Plug-in', desc: 'If you have a licensed data feed or API, connect it as a data-adapter plug-in.', items: ['FMUP manifest: kind "data-adapter"', 'Signed bundle + explicit permission list', 'Share it with the community via Settings › Updates › Submit Update'] },
    ],
    pluginLegalNote:
      'The default sources (Yahoo Finance and İş Yatırım) are read from publicly accessible, free endpoints; quotes are ~15-min delayed and intended for personal research. The data owners\' terms of use apply: republishing the data or using it in a commercial product may require a license from the provider. FRAUDE does not sell data and does not give investment advice.',
    pluginContribute:
      'Once your provider plug-in passes security review, it is listed on the site\'s Updates page and in everyone\'s in-app Updates tab.',
    aiHeading: 'Add your API key, provider by provider',
    aiLead: 'AI Research, Watch Radar comments and agent analyses run on your own API key — you obtain it, enter it, and usage bills to your account. Pick your provider; see where to go, what to get, and how to enter it in FRAUDE.',
    baseUrlLabel: 'Base URL',
    modelsLabel: 'Models',
    providers: [
      {
        id: 'openai', name: 'OpenAI', badge: 'AI',
        flags: [{ label: 'Paid · usage-based', tone: 'paid' }, { label: 'Card required', tone: 'neutral' }],
        desc: 'GPT models. A strong general-purpose default. The key starts with sk- and is shown only once.',
        steps: [
          'Go to platform.openai.com, sign up or sign in.',
          'From the account menu open the API keys page (platform.openai.com/api-keys).',
          'Create new secret key → name it → create.',
          'Copy the sk-… key immediately (it won\'t be shown again).',
          'Under Billing → Payment methods add a card and some credit (otherwise requests are rejected).',
        ],
        baseUrl: 'https://api.openai.com/v1',
        models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini', 'o1', 'o1-mini'],
      },
      {
        id: 'deepseek', name: 'DeepSeek', badge: 'DS',
        flags: [{ label: 'Paid · very cheap', tone: 'paid' }, { label: 'Prepaid balance', tone: 'neutral' }],
        desc: 'DeepSeek-V3 (chat) and DeepSeek-R1 (reasoning). Strong analysis at low cost. OpenAI-compatible API.',
        steps: [
          'Go to platform.deepseek.com and register.',
          'Open the API keys section in the console.',
          'Create new API key → create → copy the sk-… key.',
          'Add balance under Top up / Billing.',
        ],
        baseUrl: 'https://api.deepseek.com/v1',
        models: ['deepseek-chat (V3)', 'deepseek-reasoner (R1)'],
      },
      {
        id: 'google', name: 'Gemini', badge: 'G',
        flags: [{ label: 'Free tier available', tone: 'free' }, { label: 'Google account is enough', tone: 'neutral' }],
        desc: 'Gemini models. The easiest way to start, with a free tier. FRAUDE uses Google\'s OpenAI-compatible endpoint.',
        steps: [
          'Go to aistudio.google.com (Google AI Studio) with your Google account.',
          'Click Get API key (top or left menu).',
          'Create API key → (pick a project if asked) → copy the key.',
          'For higher limits enable Cloud Billing; the free tier is enough to start.',
        ],
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
      },
      {
        id: 'qwen', name: 'Qwen', badge: 'Q',
        flags: [{ label: 'Paid', tone: 'paid' }, { label: 'Trial quota', tone: 'free' }],
        desc: 'Alibaba\'s Qwen models via DashScope. Strong at long context and multilingual tasks. compatible-mode = OpenAI-compatible.',
        steps: [
          'Create an Alibaba Cloud account and enable DashScope (Model Studio).',
          'Open dashscope.console.aliyun.com → API-KEY management.',
          'Create API Key → copy the sk-… key.',
          'International accounts may use a dashscope-intl endpoint; use the base URL the provider gives you.',
        ],
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-long'],
      },
      {
        id: 'anthropic', name: 'Claude', badge: 'C',
        flags: [{ label: 'Paid · usage-based', tone: 'paid' }, { label: 'Prepaid balance', tone: 'neutral' }],
        desc: 'Anthropic\'s Claude models. FRAUDE uses Anthropic\'s OpenAI-compatibility layer, so the key travels in the same Bearer header.',
        steps: [
          'Go to console.anthropic.com and create an account.',
          'Open API keys → Create key → copy the sk-ant-… key.',
          'Add credit under Plans & billing (requests are rejected without balance).',
        ],
        baseUrl: 'https://api.anthropic.com/v1',
        models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
        note: { text: 'The compatibility layer covers ordinary chat; Anthropic-specific features such as extended thinking and prompt caching do not come through this route.', tone: 'warn' },
      },
      {
        id: 'custom', name: 'Custom', badge: '+',
        flags: [{ label: 'Base URL required', tone: 'neutral' }, { label: 'Llama · Mistral · gateways', tone: 'neutral' }],
        desc: 'Custom lets you connect to any OpenAI-compatible endpoint: you set the base URL and model id. A gateway that serves many models with one key (OpenRouter, Together AI) or your own proxy.',
        steps: [
          'Pick a provider — e.g. openrouter.ai (Claude/Llama/Mistral with one key) or together.ai.',
          'Sign up → Keys / API Keys → create a new key → copy it.',
          'Note the provider\'s Base URL (e.g. OpenRouter: https://openrouter.ai/api/v1).',
          'Get the exact model id you want from the provider\'s model list.',
        ],
        baseUrl: 'Depends on your provider — paste into the Custom field',
        models: ['meta-llama/Llama-3-70b-chat-hf', 'mistralai/Mistral-7B-Instruct-v0.2'],
        note: { text: 'Base URL is mandatory for Custom: a blank address would send your key to the wrong provider. Model ids also vary (e.g. anthropic/claude-sonnet-4.5 on OpenRouter) — copy the exact string from the docs.', tone: 'warn' },
      },
    ],
    inAppEyebrow: 'Then: inside FRAUDE',
    inAppPath: ['Settings', 'AI Providers', 'Add key'],
    inAppText: 'Pick the Provider (OpenAI / DeepSeek / Google / Qwen / Claude / Custom), write a Label, paste the API key you copied, and choose a Default model. Selecting the provider auto-fills the Base URL (you enter it manually for Custom, where it is required). After saving, verify with Test — Test now makes a real request to the provider, so a wrong key or model shows up right there. You can add multiple keys, assign different keys to your agents, and pick a key per request from the copilot\'s top bar.',
    securityNote: 'Security: once saved, the key is never returned to the UI as plaintext; only a masked form is shown (sk-t••••).',
    quickHeading: 'Start',
    quickTitle: 'Quick start',
    quickSteps: [
      'On first launch market data syncs automatically; the Dashboard starts filling in.',
      'Type a ticker in the top search (e.g. THYAO) or run open THYAO in the Terminal.',
      'For AI, go to Settings › AI Providers and add your key with the steps above.',
      'Add a few tickers to the Watch Radar and enable it; background scanning starts.',
    ],
    shortcutsHeading: 'Keyboard Shortcuts',
    shortcutsLead: 'FRAUDE is optimized for fast keyboard navigation.',
    shortcuts: [
      { id: 'palette', desc: 'Open Search and Command Palette' },
      { id: 'sidebar', desc: 'Toggle Sidebar' },
      { id: 'terminal', desc: 'Toggle Terminal panel' },
      { id: 'aiPanel', desc: 'Toggle AI panel' },
      { id: 'alerts', desc: 'Toggle price & technical alerts' },
      { id: 'monitor', desc: 'Open Watch Radar tab' },
      { id: 'sync', desc: 'Sync data now' },
      { id: 'settings', desc: 'Open Settings module' },
      { id: 'close', desc: 'Close modals or palette' },
    ],
    osHeading: ' macOS & ⊞ Windows Platform Differences',
    osLead: 'FRAUDE Terminal automatically adapts keyboard shortcuts, native window controls, and display engines for your operating system.',
    osPlatforms: [
      {
        os: 'macOS',
        icon: '',
        title: 'macOS (Apple Silicon M1/M2/M3/M4 & Intel)',
        badge: '.dmg Package',
        items: [
          'Primary Modifier: ⌘ (Command) key is used (e.g. ⌘ + K, ⌘ + J, ⌘ + L, ⌘ + B).',
          'Financial Comparison: Cmd + Click (⌘ + Click) to compare two financial statements side-by-side.',
          'Window Controls: Native macOS 🔴 🟡 🟢 traffic light controls on top-left.',
          'Display Engine: Native macOS WebKit GPU acceleration.',
          'Gatekeeper Permission: If security prompt appears on first launch, use Right-Click › Open.',
        ],
      },
      {
        os: 'Windows',
        icon: '⊞',
        title: 'Windows (Windows 10 / 11 64-bit)',
        badge: '.exe Installer',
        items: [
          'Primary Modifier: Ctrl (Control) key is used (e.g. Ctrl + K, Ctrl + J, Ctrl + L, Ctrl + B).',
          'Financial Comparison: Ctrl + Click to compare two financial statements side-by-side.',
          'Window Controls: Native Windows controls (─ □ ✕) on top-right.',
          'Display Engine: Microsoft Edge WebView2 runtime engine.',
          'SmartScreen Permission: If protection prompt appears on install, click More Info › Run Anyway.',
        ],
      },
    ],
    modalNext: 'Next Step ▸',
    modalPrev: '◂ Previous Step',
    modalOpenModule: '🚀 Open Module',
    modalClose: 'Close (Esc)',
    tours: {
      DB: {
        code: 'DB',
        kind: 'dashboard',
        name: 'Dashboard',
        tag: 'Home View',
        steps: [
          {
            title: 'Capture Market Pulse at a Glance',
            desc: 'Dashboard provides live BIST 100 (XU100) and BIST IPO (XHARZ) indicators, breadth breakdown, and daily leaders/laggards.',
            features: ['Market Breadth: Advancing / Declining / Unchanged counts', 'BIST 100 and XHARZ mini-charts with daily volume', 'Top gainers, top losers, and volume leaders'],
            previewType: 'dashboard',
          },
          {
            title: 'Model Portfolio & Decision Support Scores',
            desc: 'Algorithm-assisted decision scores combining Value, Quality, and Momentum factors for listed companies.',
            features: ['Value score based on P/E and P/B multiples', 'Quality score from profitability (ROE/ROA) & margins', 'Momentum score from trend momentum and volume spikes'],
            previewType: 'dashboard',
          },
        ],
      },
    },
  },
};

const CODE_TO_KIND_MAP: Record<string, string> = {
  DB: 'dashboard',
  SC: 'screener',
  TK: 'ticker',
  IX: 'index',
  KP: 'kap',
  NW: 'news',
  AI: 'ai',
  RD: 'monitor',
  RS: 'research',
  CA: 'corporate',
  FO: 'funds',
  '$_': 'terminal',
  TM: 'team',
  MD: 'modules',
  UP: 'updates',
};

export default function GuideView({ onOpenModule }: GuideViewProps) {
  const { lang } = useTranslation();
  const c = GUIDE[lang === 'en' ? 'en' : 'tr'];
  const [activeProvider, setActiveProvider] = useState<string>('openai');
  const provider = c.providers.find((p) => p.id === activeProvider) ?? c.providers[0];

  // Interactive Tour Modal State
  const [tourCode, setTourCode] = useState<string | null>(null);
  const [tourStep, setTourStep] = useState<number>(0);

  // Interactive AI Provider Step State
  const [activeAiStep, setActiveAiStep] = useState<number>(0);

  // Interactive Shortcut Pulse State
  const [pulsingShortcut, setPulsingShortcut] = useState<ShortcutId | null>(null);

  const activeTour = tourCode ? c.tours[tourCode] || c.tours['DB'] : null;

  const handleStartTour = (code: string) => {
    setTourCode(code);
    setTourStep(0);
  };

  const handleCloseTour = () => {
    setTourCode(null);
    setTourStep(0);
  };

  // Keyboard escape handler for modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && tourCode) {
        handleCloseTour();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tourCode]);

  const handleTriggerShortcut = (id: ShortcutId) => {
    setPulsingShortcut(id);
    setTimeout(() => setPulsingShortcut(null), 1200);
  };

  const handleGoToModule = (kind: string) => {
    handleCloseTour();
    if (onOpenModule) {
      onOpenModule(kind);
    }
  };

  return (
    <div className="guide-view">
      <div className="guide-inner">
        <header className="guide-hero">
          <p className="guide-eyebrow">{c.eyebrow}</p>
          <h1 className="guide-title">
            FRAUDE <span className="cur">— {c.title}</span>
          </h1>
          <p className="guide-sub">{c.sub}</p>

          <div style={{ marginTop: '20px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="guide-tour-cta-btn"
              onClick={() => handleStartTour('DB')}
            >
              {c.startTourCTA}
            </button>
            <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
              {c.clickToInspectTip}
            </span>
          </div>

          <div className="guide-chips">
            {c.chips.map((chip, i) => (
              <span className="guide-chip" key={i}>
                {chip.value ? <b>{chip.value} </b> : null}
                {chip.label}
              </span>
            ))}
          </div>
        </header>

        {/* ── Modül turu ── */}
        <section className="guide-section">
          <h2 className="guide-h2">{c.modulesHeading}</h2>
          <p className="guide-lead">{c.modulesLead}</p>
          <div className="guide-grid">
            {c.modules.map((m) => (
              <article
                className="guide-card interactive-tour-card"
                key={m.code}
                onClick={() => handleStartTour(m.code)}
                title="İnteraktif Tutorial Turunu Açmak İçin Tıklayın"
              >
                <div className="guide-card-head">
                  <span className="guide-card-ico">{m.code}</span>
                  <h3>{m.name}</h3>
                  <span className="guide-card-tag">{m.tag}</span>
                  <span className="tour-click-badge">CANLI TUR ▶</span>
                </div>
                <div className="guide-card-body">
                  {m.desc}
                  <ul>
                    {m.items.map((it, i) => (
                      <li key={i}>{it}</li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ── Eklenti mimarisi: veri kaynakları ── */}
        <section className="guide-section">
          <h2 className="guide-h2">{c.pluginHeading}</h2>
          <p className="guide-lead">{c.pluginLead}</p>
          <div className="guide-grid">
            {c.dataSources.map((source) => (
              <article className="guide-card" key={source.code}>
                <div className="guide-card-head">
                  <span className="guide-card-ico">{source.code}</span>
                  <h3>{source.name}</h3>
                  <span className="guide-card-tag">{source.tag}</span>
                </div>
                <div className="guide-card-body">
                  {source.desc}
                  <ul>
                    {source.items.map((it, i) => (
                      <li key={i}>{it}</li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
          </div>
          <p className="guide-note ok">
            <b>✓</b> {c.pluginLegalNote}
          </p>
          <p className="guide-note">
            <b>↗</b> {c.pluginContribute}
          </p>
        </section>

        {/* ── AI kurulumu ── */}
        <section className="guide-section">
          <h2 className="guide-h2">{c.aiHeading}</h2>
          <p className="guide-lead">{c.aiLead}</p>

          <div className="guide-prov">
            <div className="guide-prov-tabs" role="tablist">
              {c.providers.map((p) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={p.id === activeProvider}
                  className={`guide-prov-tab ${p.id === activeProvider ? 'active' : ''}`}
                  key={p.id}
                  onClick={() => {
                    setActiveProvider(p.id);
                    setActiveAiStep(0);
                  }}
                >
                  <span className="badge">{p.badge}</span>
                  {p.name}
                </button>
              ))}
            </div>

            <div className="guide-prov-panel" role="tabpanel">
              <div className="guide-prov-top">
                <h3>{provider.name}</h3>
                <div className="guide-flags">
                  {provider.flags.map((f, i) => (
                    <span className={`guide-flag ${f.tone}`} key={i}>
                      {f.label}
                    </span>
                  ))}
                </div>
              </div>
              <p className="guide-prov-desc">{provider.desc}</p>

              <ol className="guide-steps">
                {provider.steps.map((s, i) => (
                  <li
                    key={i}
                    className={i <= activeAiStep ? 'completed-step' : ''}
                    onClick={() => setActiveAiStep(i)}
                    style={{ cursor: 'pointer' }}
                    title="Adımı tamamlandı olarak işaretle"
                  >
                    <span>{s}</span>
                    {i <= activeAiStep && <span className="step-check">✓</span>}
                  </li>
                ))}
              </ol>

              <dl className="guide-kv">
                <dt>{c.baseUrlLabel}</dt>
                <dd>
                  <code>{provider.baseUrl}</code>
                </dd>
                <dt>{c.modelsLabel}</dt>
                <dd>
                  <div className="guide-models">
                    {provider.models.map((m, i) => (
                      <span key={i}>{m}</span>
                    ))}
                  </div>
                </dd>
              </dl>
              {provider.note ? (
                <p className={`guide-note ${provider.note.tone === 'ok' ? 'ok' : ''}`}>
                  <b>{provider.note.tone === 'ok' ? '✓' : 'Not:'}</b> {provider.note.text}
                </p>
              ) : null}
            </div>
          </div>

          <div className="guide-inapp">
            <p className="guide-eyebrow" style={{ color: 'var(--text-muted)' }}>
              {c.inAppEyebrow}
            </p>
            <p className="guide-path">
              {c.inAppPath.map((seg, i) => (
                <span key={i}>
                  <span className="b">{seg}</span>
                  {i < c.inAppPath.length - 1 ? <span className="sep">›</span> : null}
                </span>
              ))}
            </p>
            <p>{c.inAppText}</p>
            <p className="guide-note ok">
              <b>✓</b> {c.securityNote}
            </p>
          </div>
        </section>

        {/* ── Kısayollar ── */}
        <section className="guide-section">
          <h2 className="guide-h2">{c.shortcutsHeading}</h2>
          <p className="guide-lead">{c.shortcutsLead}</p>
          <div className="guide-shortcuts">
            {c.shortcuts.map((sc) => {
              const isPulsing = pulsingShortcut === sc.id;
              return (
                <div
                  key={sc.id}
                  onClick={() => handleTriggerShortcut(sc.id)}
                  className={`shortcut-interactive-row ${isPulsing ? 'pulsing' : ''}`}
                  title="Test etmek için tıklayın"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    margin: '4px 0',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: isPulsing ? 'rgba(0, 195, 255, 0.12)' : 'var(--bg-panel)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <span style={{ color: 'var(--text-color)', fontSize: '0.9rem', fontWeight: 500 }}>
                    {sc.desc}
                    {isPulsing && <span style={{ marginLeft: '10px', color: '#00ff9d', fontSize: '0.78rem', fontWeight: 700 }}>⚡ Simüle Edildi!</span>}
                  </span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {shortcutKeys(sc.id).map((k, j) => (
                      <kbd
                        key={j}
                        style={{
                          background: isPulsing ? '#00c3ff' : 'var(--bg-dark)',
                          color: isPulsing ? '#04140d' : 'var(--text-main)',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          border: '1px solid var(--border-color)',
                          fontSize: '0.8rem',
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 600,
                        }}
                      >
                        {k}
                      </kbd>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── macOS vs Windows Platform Farklılıkları ── */}
        <section className="guide-section">
          <h2 className="guide-h2">{c.osHeading}</h2>
          <p className="guide-lead">{c.osLead}</p>
          <div className="guide-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px', marginTop: '16px' }}>
            {c.osPlatforms.map((plat, idx) => (
              <div
                key={idx}
                className="guide-card"
                style={{
                  background: 'var(--bg-panel)',
                  border: plat.os === 'macOS' ? '1px solid rgba(0, 255, 157, 0.3)' : '1px solid rgba(0, 195, 255, 0.3)',
                  padding: '20px',
                  borderRadius: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>{plat.icon}</span> {plat.title}
                  </h3>
                  <span
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      padding: '3px 8px',
                      borderRadius: '6px',
                      background: plat.os === 'macOS' ? 'rgba(0, 255, 157, 0.15)' : 'rgba(0, 195, 255, 0.15)',
                      color: plat.os === 'macOS' ? '#00ff9d' : '#00c3ff',
                      border: plat.os === 'macOS' ? '1px solid #00ff9d' : '1px solid #00c3ff',
                    }}
                  >
                    {plat.badge}
                  </span>
                </div>
                <ul className="guide-card-items" style={{ margin: 0, paddingLeft: '18px' }}>
                  {plat.items.map((item, itemIdx) => (
                    <li key={itemIdx} style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '8px', lineHeight: '1.45' }}>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* ── Hızlı başlangıç ── */}
        <section className="guide-section" style={{ borderBottom: 'none' }}>
          <h2 className="guide-h2">{c.quickHeading}</h2>
          <div className="guide-quick">
            <h3>{c.quickTitle}</h3>
            <ol className="guide-quick-steps">
              {c.quickSteps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </div>
        </section>
      </div>

      {/* ── Interactive Tutorial Walkthrough Modal ── */}
      {activeTour && (
        <div className="guide-tour-backdrop" onClick={handleCloseTour}>
          <div className="guide-tour-modal" onClick={(e) => e.stopPropagation()}>
            <div className="guide-tour-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span className="guide-card-ico" style={{ width: '36px', height: '36px', fontSize: '0.95rem' }}>
                  {activeTour.code}
                </span>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.2rem', fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>
                    {activeTour.name}
                  </h2>
                  <span className="guide-card-tag" style={{ marginTop: '4px', display: 'inline-block' }}>
                    {activeTour.tag}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  Adım {tourStep + 1} / {activeTour.steps.length}
                </span>
                <button type="button" className="tour-close-btn" onClick={handleCloseTour} title={c.modalClose}>
                  ✕
                </button>
              </div>
            </div>

            <div className="guide-tour-body">
              {activeTour.steps[tourStep] && (
                <div className="tour-step-card">
                  <h3 className="tour-step-title">{activeTour.steps[tourStep].title}</h3>
                  <p className="tour-step-desc">{activeTour.steps[tourStep].desc}</p>

                  <div className="tour-features-list">
                    <h4>Öne Çıkan Özellikler:</h4>
                    <ul>
                      {activeTour.steps[tourStep].features.map((feat, idx) => (
                        <li key={idx}>
                          <span style={{ color: '#00ff9d', marginRight: '8px' }}>✓</span>
                          {feat}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Interactive Live Mockup Widget */}
                  <div className="tour-mockup-widget">
                    <div className="mockup-bar">
                      <span className="mockup-dot red" />
                      <span className="mockup-dot yellow" />
                      <span className="mockup-dot green" />
                      <span className="mockup-title">FRAUDE — {activeTour.name} (Simülasyon)</span>
                    </div>
                    <div className="mockup-content">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <span style={{ color: '#00c3ff', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                          BIST 100: 10,845.20 (+1.42%)
                        </span>
                        <span style={{ background: 'rgba(0, 255, 157, 0.15)', color: '#00ff9d', padding: '2px 8px', borderRadius: '4px', fontSize: '0.72rem', fontFamily: 'var(--font-mono)' }}>
                          ● CANLI VERİ
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                        <div style={{ background: 'var(--bg-panel)', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>THYAO</div>
                          <div style={{ fontWeight: 700, color: '#00ff9d' }}>₺312.50 (+2.1%)</div>
                        </div>
                        <div style={{ background: 'var(--bg-panel)', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>GARAN</div>
                          <div style={{ fontWeight: 700, color: '#00ff9d' }}>₺124.80 (+0.8%)</div>
                        </div>
                        <div style={{ background: 'var(--bg-panel)', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>EREGL</div>
                          <div style={{ fontWeight: 700, color: '#ff4d4d' }}>₺52.10 (-0.4%)</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="guide-tour-footer">
              <div className="tour-dots">
                {activeTour.steps.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`tour-dot ${i === tourStep ? 'active' : ''}`}
                    onClick={() => setTourStep(i)}
                  />
                ))}
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {tourStep > 0 && (
                  <button
                    type="button"
                    className="tour-btn secondary"
                    onClick={() => setTourStep((s) => s - 1)}
                  >
                    {c.modalPrev}
                  </button>
                )}

                {tourStep < activeTour.steps.length - 1 ? (
                  <button
                    type="button"
                    className="tour-btn primary"
                    onClick={() => setTourStep((s) => s + 1)}
                  >
                    {c.modalNext}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="tour-btn primary"
                    onClick={() => handleGoToModule(CODE_TO_KIND_MAP[activeTour.code] || 'dashboard')}
                  >
                    {c.modalOpenModule}
                  </button>
                )}

                <button
                  type="button"
                  className="tour-btn action"
                  onClick={() => handleGoToModule(CODE_TO_KIND_MAP[activeTour.code] || 'dashboard')}
                  title="Doğrudan bu çalışma alanına geç"
                >
                  {c.modalOpenModule}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
