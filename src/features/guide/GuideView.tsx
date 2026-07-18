import { useState } from 'react';
import { useTranslation } from '../../api/i18n';
import { shortcutKeys, type ShortcutId } from '../../lib/shortcuts';
import './GuideView.css';

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
interface GuideContent {
  eyebrow: string;
  title: string;
  sub: string;
  chips: { label: string; value?: string }[];
  modulesHeading: string;
  modulesLead: string;
  modules: ModuleCard[];
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
  /** Tuşlar burada değil, shortcuts.ts'te tanımlıdır; burada yalnızca açıklama durur. */
  shortcuts: { id: ShortcutId; desc: string }[];
}

// ── TR / EN içerik ─────────────────────────────────────────────
const GUIDE: Record<'tr' | 'en', GuideContent> = {
  tr: {
    eyebrow: 'Rehber',
    title: 'FRAUDE nasıl kullanılır',
    sub: 'Modüllerin ne işe yaradığını ve AI özelliklerini açmak için kendi API anahtarını sağlayıcıya göre adım adım nasıl ekleyeceğini gösterir.',
    chips: [
      { label: 'modül', value: '13' },
      { label: 'AI sağlayıcı', value: '5' },
      { label: 'BIST · XU100 · XHARZ' },
      { label: 'TR / EN' },
    ],
    modulesHeading: 'Modül turu',
    modulesLead: 'Sol kenar çubuğundan modüller arasında gezinir, üstteki arama/komut çubuğundan hisse açar veya komut çalıştırırsın. Her sekme bağımsız bir çalışma panelidir.',
    modules: [
      { code: 'DB', name: 'Pano', tag: 'Ana ekran', desc: 'Piyasanın günlük özeti ve karar destek modülleri.', items: ['Günlük Piyasa Bülteni: genişlik, BIST 100, XHARZ, lider/zayıf', 'Model Portföy: değer + kalite + momentum puanları', 'Bilanço Analizi: F/K, PD/DD, ROE, ROA, marj, büyüme', 'Filtreli Analiz: çoklu eşik taraması'] },
      { code: 'SC', name: 'Teknik Tarayıcı', tag: 'Screener', desc: 'Teknik göstergelere göre BIST/XHARZ evreninde tarama.', items: ['RSI(14), ATR(14) — Wilder/RMA', 'EMA, SMA, MACD, Bollinger', 'F/K, PD/DD, ROE, değişim eşikleri birlikte'] },
      { code: 'TK', name: 'Hisse Detayı', tag: 'Ticker', desc: 'Tek hissenin tam kartı; aramadan veya tablodan açılır.', items: ['Fiyat, OHLC, hacim, 52 hafta grafiği', 'Temel veriler: F/K, PD/DD, ROE, marj, Net Borç/FAVÖK', 'Ortaklık yapısı ve bağlı ortaklıklar', 'Hisseye özel KAP ve haber'] },
      { code: 'IX', name: 'Endeks Görünümü', tag: 'Index', desc: 'Endeks seviyesi ve bileşen evreni.', items: ['BIST 100 (XU100) ve BIST Halka Arz (XHARZ)', 'Endeks OHLCV serisi ve bileşen listesi', 'Yeni halka arzlar IPO etiketiyle'] },
      { code: 'KP', name: 'KAP Akışı', tag: 'Bildirimler', desc: 'Kamuyu Aydınlatma Platformu bildirim akışı.', items: ['Şirket bazlı özel durum açıklamaları', 'AI önem puanıyla sıralama', 'Hisse filtreleme'] },
      { code: 'NW', name: 'Haber Akışı', tag: 'News', desc: 'Çok kaynaklı şirket ve piyasa haberi.', items: ['GDELT DOC 2.0 — küresel haber', 'Google News RSS — Türkçe haber', 'Bloomberg HT RSS — ekonomi', 'Okunabilir önizleme'] },
      { code: 'AI', name: 'AI Araştırma', tag: 'Panel + yan', desc: 'Kendi anahtarınla çalışan araştırma asistanı.', items: ['Aktif sekme bağlamıyla soru-cevap', 'Özel AI ajanları (rol + sistem komutu)', 'Ajan bazlı otomatik analiz', 'Sohbet geçmişi'] },
      { code: 'RD', name: 'İzleme Radarı', tag: 'Monitor', desc: 'Takip listeni arka planda tarar.', items: ['Yeni KAP bildirimlerini periyodik kontrol', 'Ortaklık / iş ilişkisi sınıflandırma', 'Zil rozeti + OS bildirimi', 'AI yorumlu uyarılar'] },
      { code: 'CA', name: 'Kurumsal Olaylar', tag: 'Corporate', desc: 'Şirket aksiyonları ve halka arz takvimi.', items: ['Temettü kayıtları', 'Bedelli/bedelsiz sermaye artırımları', 'Halka arz takvimi ve arşivi'] },
      { code: '$_', name: 'Terminal (FQL)', tag: 'Komut', desc: 'Klavyeyle her şeyi süren komut satırı.', items: ['open THYAO — hisse aç', 'scan … — tarama çalıştır', 'kap · sync · ask … · help'] },
      { code: 'TM', name: 'Ekip', tag: 'Team', desc: 'Ekip çalışma alanı ve paylaşılan görünümler.', items: ['Ortak izleme ve araştırma bağlamı'] },
      { code: 'MD', name: 'Modül Merkezi', tag: 'Modules', desc: 'Modülleri açıp kapatma ve güncelleme.', items: ['Modül kataloğu ve kurulum', 'İmzalı güncelleme / geri alma', 'Kenar çubuğu sekmelerini özelleştirme'] },
      { code: 'UP', name: 'Güncellemeler', tag: 'Ayarlar ▸', desc: 'Topluluk güncellemelerini sorgula, uygula ve kendi katkını gönder (⌘, → Güncellemeler).', items: ['Güncelleme Sorgula: kayıt defteri + son paket sürümü', 'Yeni paket çıktığında tek tuşla kurulum indirme', 'Pakete girmemiş kayıtlar için AI ajan promptunu kopyala, yerel klonunda uygula', 'Güncelleme Gönder: GitHub token ile otomatik PR, tokensız önceden doldurulmuş taslak'] },
    ],
    aiHeading: 'API anahtarını sağlayıcına göre ekle',
    aiLead: 'AI Araştırma, İzleme Radarı yorumları ve ajan analizleri senin kendi API anahtarınla çalışır — anahtarı sen alır, uygulamaya girersin, kullanım senin hesabına işler. Sağlayıcını seç; nereye gireceğini, ne alacağını ve FRAUDE\'ye nasıl gireceğini gör.',
    baseUrlLabel: 'Base URL',
    modelsLabel: 'Modeller',
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
        id: 'custom', name: 'Custom', badge: '+',
        flags: [{ label: 'Base URL sen girersin', tone: 'neutral' }, { label: 'Claude · Llama · Mistral', tone: 'neutral' }],
        desc: 'Custom, OpenAI-uyumlu herhangi bir uca bağlanmanı sağlar: base URL ve model kimliğini sen belirlersin. Claude, Llama, Mistral gibi modelleri tek anahtarla sunan bir ağ geçidi (OpenRouter, Together AI) ya da kendi proxy\'in.',
        steps: [
          'Bir sağlayıcı seç — ör. openrouter.ai (tek anahtarla Claude/Llama/Mistral) veya together.ai.',
          'Hesap aç → Keys / API Keys → yeni anahtar oluştur → kopyala.',
          'Sağlayıcının Base URL\'ini not al (ör. OpenRouter: https://openrouter.ai/api/v1).',
          'Kullanmak istediğin tam model kimliğini sağlayıcının listesinden al.',
        ],
        baseUrl: 'Sağlayıcına göre — Custom alanına yapıştır',
        models: ['claude-3-7-sonnet-latest', 'claude-3-5-sonnet-latest', 'meta-llama/Llama-3-70b-chat-hf', 'mistralai/Mistral-7B-Instruct-v0.2'],
        note: { text: 'Model kimliği sağlayıcıya göre değişir (ör. OpenRouter\'da anthropic/claude-3.7-sonnet). Doğru dizeyi mutlaka sağlayıcının belgelerinden kopyala.', tone: 'warn' },
      },
    ],
    inAppEyebrow: 'Sonra: FRAUDE içinde',
    inAppPath: ['Ayarlar', 'AI Providers', 'Add key'],
    inAppText: 'Provider\'ı seç (OpenAI / DeepSeek / Google / Qwen / Custom), bir Label yaz, kopyaladığın API key\'i yapıştır, Default model\'i seç. Provider\'ı seçince Base URL otomatik dolar (Custom\'da elle girersin). Kaydettikten sonra Test ile doğrula ve istersen varsayılan yap. Birden fazla anahtar ekleyip ajanlarına farklı anahtar atayabilirsin.',
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
  },
  en: {
    eyebrow: 'Guide',
    title: 'How to use FRAUDE',
    sub: 'Shows what each module does and how to add your own API key — provider by provider — to unlock the AI features.',
    chips: [
      { label: 'modules', value: '13' },
      { label: 'AI providers', value: '5' },
      { label: 'BIST · XU100 · XHARZ' },
      { label: 'TR / EN' },
    ],
    modulesHeading: 'Module tour',
    modulesLead: 'Navigate modules from the left sidebar, open tickers or run commands from the top search/command bar. Each tab is an independent workspace.',
    modules: [
      { code: 'DB', name: 'Dashboard', tag: 'Home', desc: 'Daily market summary and decision-support modules.', items: ['Daily Market Bulletin: breadth, BIST 100, XHARZ, leaders/laggards', 'Model Portfolio: value + quality + momentum scores', 'Financial Analysis: P/E, P/B, ROE, ROA, margin, growth', 'Filtered Analysis: multi-threshold screen'] },
      { code: 'SC', name: 'Technical Screener', tag: 'Screener', desc: 'Screen the BIST/XHARZ universe by technical indicators.', items: ['RSI(14), ATR(14) — Wilder/RMA', 'EMA, SMA, MACD, Bollinger', 'P/E, P/B, ROE, change thresholds together'] },
      { code: 'TK', name: 'Ticker Detail', tag: 'Ticker', desc: 'Full card for a single stock; opened from search or a table.', items: ['Price, OHLC, volume, 52-week chart', 'Fundamentals: P/E, P/B, ROE, margin, Net Debt/EBITDA', 'Shareholder structure and subsidiaries', 'Ticker-specific KAP and news'] },
      { code: 'IX', name: 'Index View', tag: 'Index', desc: 'Index level and constituent universe.', items: ['BIST 100 (XU100) and BIST IPO (XHARZ)', 'Index OHLCV series and constituents', 'New IPOs tagged IPO'] },
      { code: 'KP', name: 'KAP Feed', tag: 'Disclosures', desc: 'Public Disclosure Platform (KAP) feed.', items: ['Company material disclosures', 'Sorted by AI importance score', 'Ticker filtering'] },
      { code: 'NW', name: 'News Feed', tag: 'News', desc: 'Multi-source company and market news.', items: ['GDELT DOC 2.0 — global news', 'Google News RSS — Turkish news', 'Bloomberg HT RSS — economy', 'Readable preview'] },
      { code: 'AI', name: 'AI Research', tag: 'Panel + side', desc: 'Research assistant powered by your own key.', items: ['Q&A with active-tab context', 'Custom AI agents (role + system prompt)', 'Agent-based auto analysis', 'Chat history'] },
      { code: 'RD', name: 'Watch Radar', tag: 'Monitor', desc: 'Scans your watchlist in the background.', items: ['Periodic checks for new KAP disclosures', 'Ownership / business-relation classification', 'Bell badge + OS notification', 'AI-commented alerts'] },
      { code: 'CA', name: 'Corporate Actions', tag: 'Corporate', desc: 'Corporate actions and IPO calendar.', items: ['Dividend records', 'Rights / bonus capital increases', 'IPO calendar and archive'] },
      { code: '$_', name: 'Terminal (FQL)', tag: 'Command', desc: 'Command line that drives everything from the keyboard.', items: ['open THYAO — open a ticker', 'scan … — run a screen', 'kap · sync · ask … · help'] },
      { code: 'TM', name: 'Team', tag: 'Team', desc: 'Team workspace and shared views.', items: ['Shared watch and research context'] },
      { code: 'MD', name: 'Module Center', tag: 'Modules', desc: 'Enable/disable and update modules.', items: ['Module catalog and install', 'Signed update / rollback', 'Customize sidebar tabs'] },
      { code: 'UP', name: 'Updates', tag: 'In Settings ▸', desc: 'Check community updates, apply them and submit your own contribution (⌘, → Updates).', items: ['Check for Updates: registry + latest package version', 'One-click installer download when a new package ships', 'Copy the AI-agent prompt for unpackaged entries, apply in your local clone', 'Submit Update: automatic PR with a GitHub token, prefilled draft without'] },
    ],
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
        id: 'custom', name: 'Custom', badge: '+',
        flags: [{ label: 'You set the Base URL', tone: 'neutral' }, { label: 'Claude · Llama · Mistral', tone: 'neutral' }],
        desc: 'Custom lets you connect to any OpenAI-compatible endpoint: you set the base URL and model id. A gateway that serves Claude, Llama, Mistral with one key (OpenRouter, Together AI) or your own proxy.',
        steps: [
          'Pick a provider — e.g. openrouter.ai (Claude/Llama/Mistral with one key) or together.ai.',
          'Sign up → Keys / API Keys → create a new key → copy it.',
          'Note the provider\'s Base URL (e.g. OpenRouter: https://openrouter.ai/api/v1).',
          'Get the exact model id you want from the provider\'s model list.',
        ],
        baseUrl: 'Depends on your provider — paste into the Custom field',
        models: ['claude-3-7-sonnet-latest', 'claude-3-5-sonnet-latest', 'meta-llama/Llama-3-70b-chat-hf', 'mistralai/Mistral-7B-Instruct-v0.2'],
        note: { text: 'The model id varies by provider (e.g. anthropic/claude-3.7-sonnet on OpenRouter). Always copy the exact string from the provider\'s docs.', tone: 'warn' },
      },
    ],
    inAppEyebrow: 'Then: inside FRAUDE',
    inAppPath: ['Settings', 'AI Providers', 'Add key'],
    inAppText: 'Pick the Provider (OpenAI / DeepSeek / Google / Qwen / Custom), write a Label, paste the API key you copied, and choose a Default model. Selecting the provider auto-fills the Base URL (enter it manually for Custom). After saving, verify with Test and optionally make it the default. You can add multiple keys and assign different keys to your agents.',
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
  },
};

export default function GuideView() {
  const { lang } = useTranslation();
  const c = GUIDE[lang === 'en' ? 'en' : 'tr'];
  const [activeProvider, setActiveProvider] = useState<string>('openai');
  const provider = c.providers.find((p) => p.id === activeProvider) ?? c.providers[0];

  return (
    <div className="guide-view">
      <div className="guide-inner">
        <header className="guide-hero">
          <p className="guide-eyebrow">{c.eyebrow}</p>
          <h1 className="guide-title">FRAUDE <span className="cur">— {c.title}</span></h1>
          <p className="guide-sub">{c.sub}</p>
          <div className="guide-chips">
            {c.chips.map((chip, i) => (
              <span className="guide-chip" key={i}>
                {chip.value ? <b>{chip.value} </b> : null}{chip.label}
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
              <article className="guide-card" key={m.code}>
                <div className="guide-card-head">
                  <span className="guide-card-ico">{m.code}</span>
                  <h3>{m.name}</h3>
                  <span className="guide-card-tag">{m.tag}</span>
                </div>
                <div className="guide-card-body">
                  {m.desc}
                  <ul>
                    {m.items.map((it, i) => <li key={i}>{it}</li>)}
                  </ul>
                </div>
              </article>
            ))}
          </div>
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
                  onClick={() => setActiveProvider(p.id)}
                >
                  <span className="badge">{p.badge}</span>{p.name}
                </button>
              ))}
            </div>

            <div className="guide-prov-panel" role="tabpanel">
              <div className="guide-prov-top">
                <h3>{provider.name}</h3>
                <div className="guide-flags">
                  {provider.flags.map((f, i) => (
                    <span className={`guide-flag ${f.tone}`} key={i}>{f.label}</span>
                  ))}
                </div>
              </div>
              <p className="guide-prov-desc">{provider.desc}</p>
              <ol className="guide-steps">
                {provider.steps.map((s, i) => <li key={i}>{s}</li>)}
              </ol>
              <dl className="guide-kv">
                <dt>{c.baseUrlLabel}</dt>
                <dd><code>{provider.baseUrl}</code></dd>
                <dt>{c.modelsLabel}</dt>
                <dd>
                  <div className="guide-models">
                    {provider.models.map((m, i) => <span key={i}>{m}</span>)}
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
            <p className="guide-eyebrow" style={{ color: 'var(--text-muted)' }}>{c.inAppEyebrow}</p>
            <p className="guide-path">
              {c.inAppPath.map((seg, i) => (
                <span key={i}>
                  <span className="b">{seg}</span>
                  {i < c.inAppPath.length - 1 ? <span className="sep">›</span> : null}
                </span>
              ))}
            </p>
            <p>{c.inAppText}</p>
            <p className="guide-note ok"><b>✓</b> {c.securityNote}</p>
          </div>
        </section>

        {/* ── Kısayollar ── */}
        <section className="guide-section">
          <h2 className="guide-h2">{c.shortcutsHeading}</h2>
          <p className="guide-lead">{c.shortcutsLead}</p>
          <div className="guide-shortcuts">
            {c.shortcuts.map((sc) => (
              <div key={sc.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
                <span style={{ color: 'var(--text-color)', fontSize: '0.9rem' }}>{sc.desc}</span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {shortcutKeys(sc.id).map((k, j) => (
                    <kbd key={j} style={{ background: 'var(--bg-dark)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
                      {k}
                    </kbd>
                  ))}
                </div>
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
              {c.quickSteps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </div>
        </section>
      </div>
    </div>
  );
}
