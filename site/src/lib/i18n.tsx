import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Lang = 'tr' | 'en';

const STORAGE_KEY = 'fraude-site-lang';

const STRINGS = {
  tr: {
    // Nav & genel
    navFeatures: 'Özellikler',
    navStart: 'Başlangıç',
    navDownload: 'İndir',
    navUpdates: 'Güncellemeler',
    signIn: 'Giriş Yap',
    adminNav: 'Yönetim',
    downloadShort: '⬇ İndir',
    loading: 'Yükleniyor…',
    working: 'İşleniyor…',

    // Hero
    heroTitleTop: 'Finansal dostunuz',
    heroTitleAccent: 'tüm piyasalar tek ekranda',
    heroLead:
      "Borsa İstanbul'dan küresel endekslere, fonlardan emtia ve dövize — canlı veri, KAP izleme ve yapay zeka destekli araştırma tek masaüstü uygulamasında.",
    heroDownload: '⬇ Uygulamayı İndir',
    heroRequest: 'Lisans Talep Et',
    heroNote: 'macOS ve Windows için hazır · Lisans anahtarıyla etkinleştirilir',

    // Özellikler
    featuresTitle: 'Araştırma masanız, tek uygulamada',
    featuresSub:
      'FRAUDE, dağınık sekmeler yerine tek bir çalışma alanında piyasaları izlemeniz, taramanız ve araştırmanız için tasarlandı.',
    f1t: 'Canlı Piyasa Verisi',
    f1x: 'BIST hisseleri, küresel endeksler, emtia, döviz ve kripto — ~15 dk gecikmeli kotasyon şeridiyle.',
    f2t: 'Teknik Tarayıcı',
    f2x: 'RSI, hacim ve temel oranlarla FQL sorgu dili üzerinden tüm evreni saniyeler içinde tarayın.',
    f3t: 'KAP İzleme Radarı',
    f3x: 'Takip listenizdeki şirketlerin KAP bildirimlerini arka planda izler; önemli değişimlerde anında bildirim üretir.',
    f4t: 'Fon Analizi',
    f4x: 'TEFAS fonlarının getirileri, varlık dağılımları ve portföy raporlarından fon içi tek tek varlık kırılımı.',
    f5t: 'Yapay Zeka Araştırma',
    f5x: 'Kendi API anahtarınızla çalışan AI ajanları: bildirimleri, haberleri ve fiyatları okuyup Türkçe özet notlar hazırlar.',
    f6t: 'Ekonomik Takvim',
    f6x: 'TCMB faiz kararları, enflasyon ve makro veriler; temettü, bedelli/bedelsiz ve halka arz takvimiyle birlikte.',

    // Adımlar
    stepsTitle: 'Üç adımda başlayın',
    stepsSub: 'Kurulumdan ilk taramaya birkaç dakika.',
    s1t: 'Uygulamayı indirin',
    s1x: 'macOS veya Windows sürümünü indirip kurun; uygulama açılışta sizi karşılar.',
    s2t: 'Hesap oluşturun',
    s2x: 'E-postanızla kaydolun ve bu siteden lisans talebinizi iletin.',
    s3t: 'Lisansı etkinleştirin',
    s3x: 'Onaylanan anahtarınızı uygulamaya girin; terminal tamamen açılır.',

    // İndir bandı
    dlTitle: "FRAUDE'yi masaüstünüze kurun",
    dlSub: 'Erişim lisans anahtarıyla sağlanır; anahtarınız yoksa hesabınızdan talep edin.',
    dlMac: ' macOS için indir',
    dlWin: '⊞ Windows için indir',
    dlRequest: 'Lisans Talep Et →',
    dlGatekeeper:
      'macOS ilk açılışta uyarı verirse uygulamaya sağ tıklayıp "Aç" seçin; Windows SmartScreen\'de "Yine de çalıştır" deyin.',

    // Giriş / kayıt
    welcomeBack: 'Tekrar hoş geldiniz',
    createAccount: 'Hesap oluşturun',
    signInSub: 'FRAUDE hesabınızla oturum açın',
    signUpSub: 'Lisans talebi için ücretsiz hesap açın',
    nameLabel: 'Ad Soyad',
    emailLabel: 'E-posta',
    passwordLabel: 'Şifre',
    signUpBtn: 'Kayıt Ol',
    noAccount: 'Hesabınız yok mu? Kayıt olun',
    haveAccount: 'Zaten hesabınız var mı? Giriş yapın',
    errEmail: 'Geçerli bir e-posta girin.',
    errName: 'Adınızı girin.',
    errPwShort: 'Şifre en az 8 karakter olmalı.',
    errPwRequired: 'Şifrenizi girin.',
    errEmailTaken: 'Bu e-posta ile zaten bir hesap var.',
    errInvalidCreds: 'E-posta veya şifre hatalı.',
    errSignUp: 'Kayıt başarısız: ',
    errSignIn: 'Giriş başarısız: ',
    confirmEmail: 'Doğrulama e-postası gönderildi; kutunuzu onaylayıp giriş yapın.',

    // Şifre yenileme
    forgotPw: 'Şifrenizi mi unuttunuz?',
    backToSignIn: '← Girişe dön',
    forgotTitle: 'Şifre yenileme',
    forgotSub: 'E-postanıza bir yenileme bağlantısı gönderelim.',
    sendResetBtn: 'Yenileme Bağlantısı Gönder',
    resetSent: 'Yenileme bağlantısı gönderildi; e-posta kutunuzu kontrol edin.',
    resetFailed: 'Bağlantı gönderilemedi: ',
    resetTitle: 'Yeni şifre belirleyin',
    resetSub: 'Hesabınız için yeni bir şifre girin.',
    newPwLabel: 'Yeni şifre',
    newPwAgainLabel: 'Yeni şifre (tekrar)',
    errPwMatch: 'Şifreler eşleşmiyor.',
    resetSaveBtn: 'Şifreyi Güncelle',
    resetSaveFailed: 'Güncelleme başarısız: ',
    resetDone: 'Şifreniz güncellendi; hesabınıza yönlendiriliyorsunuz…',
    resetLinkInvalid:
      'Bağlantı geçersiz veya süresi dolmuş. Giriş sayfasından yeni bir yenileme bağlantısı isteyin.',

    // Hesap
    myAccount: 'Hesabım',
    yourKeyTitle: 'Lisans anahtarınız',
    yourKeyHint:
      'Bu anahtarı FRAUDE uygulamasında oturum açtıktan sonra lisans ekranına girin. Anahtar hesabınıza bağlanır ve 2 cihazda kullanılabilir.',
    approvedNoKey: 'Onaylandı — anahtar yöneticiden ayrıca iletilecek.',
    requestTitle: 'Lisans Talebi',
    pendingNote: 'Bekleyen bir talebiniz var. Onaylandığında anahtarınız bu sayfada görünecek.',
    noteLabel: 'Not (isteğe bağlı — kendinizi kısaca tanıtın)',
    notePlaceholder: 'Örn. bireysel yatırımcıyım, fon analizi için kullanacağım.',
    requestBtn: 'Lisans Talep Et',
    sending: 'Gönderiliyor…',
    requestFailed: 'Talep gönderilemedi: ',
    myRequests: 'Taleplerim',
    noRequests: 'Henüz talebiniz yok.',
    colDate: 'Tarih',
    colStatus: 'Durum',
    colNote: 'Not',
    stPending: 'Bekliyor',
    stApproved: 'Onaylandı',
    stRejected: 'Reddedildi',
    sessionTitle: 'Oturum',
    signOut: 'Çıkış Yap',
    copy: 'kopyala',
    copied: '✓ kopyalandı',

    // Admin
    adminTitle: 'Yönetim Paneli',
    adminSub: 'Lisanslar, talepler ve anahtar üretimi',
    tabOverview: 'Özet',
    tabRequests: 'Talepler',
    tabLicenses: 'Lisanslar',
    tabGenerate: 'Anahtar Üret',
    adminLoadFailed: 'Yönetici verileri alınamadı (yetkinizi kontrol edin).',
    opFailed: 'İşlem başarısız: ',
    unknownError: 'bilinmeyen hata',
    statUsers: 'Kayıtlı kullanıcı',
    statTotal: 'Toplam lisans',
    statActive: 'Aktif lisans',
    statUnused: 'Kullanılmamış',
    statExpired: 'Süresi geçmiş',
    statRevoked: 'İptal edilmiş',
    statActivations: 'Cihaz aktivasyonu',
    statPending: 'Bekleyen talep',
    reqListTitle: 'Lisans Talepleri',
    noReqs: 'Talep yok.',
    colUser: 'Kullanıcı',
    approve: 'Onayla',
    reject: 'Reddet',
    licListTitle: 'Lisanslar',
    noLicenses: 'Lisans yok.',
    colPlan: 'Plan',
    colDevices: 'Cihaz',
    colExpiry: 'Bitiş',
    colCreated: 'Oluşturma',
    perpetual: 'Süresiz',
    revoke: 'İptal Et',
    bdRevoked: 'İptal',
    bdExpired: 'Süresi doldu',
    bdActive: 'Aktif',
    bdUnused: 'Kullanılmadı',
    confirmRevoke: 'Bu lisans iptal edilsin mi? Kullanıcının erişimi anında kesilir.',
    genTitle: 'Toplu Anahtar Üret',
    genCount: 'Adet (1-200)',
    genPlan: 'Plan',
    genDevices: 'Cihaz limiti',
    genExpiry: 'Bitiş (boş = süresiz)',
    genNote: 'Not (kime/niçin üretildi)',
    genBtn: 'Üret',
    genBusy: 'Üretiliyor…',
    genFailed: 'Üretim başarısız: ',
    genDoneTitle: 'Üretilen anahtarlar — yalnız şimdi görünür',
    genDoneHint: 'Veritabanı yalnız özetleri tutar; bu listeyi kapatmadan kopyalayın.',
    copyAll: 'Tümünü kopyala',
    accessDenied: 'Bu sayfaya erişim yetkiniz yok.',

    // Güncellemeler
    updTitle: 'Güncellemeler',
    updSub:
      'FRAUDE açık kaynaklıdır: uygulamayı indiren herkes kaynak kodu klonlayıp AI ajanıyla geliştirebilir ve katkısını gönderebilir. Güvenlik incelemesinden geçip depoya alınan güncellemeler burada listelenir.',
    updHowTitle: 'Nasıl katkı verilir?',
    updHow1: 'Depoyu klonlayın veya fork edin.',
    updHow2: 'Değişikliği AI ajanınızla (örn. Claude Code) geliştirin, testleri çalıştırın.',
    updHow3: 'updates/registry.json dosyasına kaydınızı ekleyip PR açın.',
    updHow4: 'Güvenlik incelemesi sonrası merge edilen katkı burada ve uygulamada görünür.',
    updGuideLink: 'Katkı rehberi ↗',
    updLoading: 'Güncellemeler yükleniyor…',
    updLoadFailed: 'Güncellemeler alınamadı; sayfayı yenileyin.',
    updEmpty: 'Henüz yayınlanmış güncelleme yok.',
    updKindFix: 'Düzeltme',
    updKindFeature: 'Özellik',
    updSecurityOk: '✓ güvenlik incelemesi',
    updViewCommit: 'Değişikliği görüntüle ↗',
    updShippedIn: 'v{v} paketinde',
    updNotShipped: 'Henüz resmî pakete girmedi',
    updPromptTitle: 'AI ajanı için uygulama promptu',
    updPromptHint:
      'Kendi FRAUDE kopyanıza uygulamak için bu promptu yerel klonunuzda AI ajanınıza yapıştırın; ajan değişikliği sürümünüze uyarlar.',
    updCopy: 'Promptu kopyala',
    updCopied: '✓ kopyalandı',
    updManualNotes: 'Elle yapılacaklar',

    // Footer & meta
    footerTag: 'finansal dostunuz',
    disclaimer: 'Veriler yatırım tavsiyesi değildir.',
    metaTitle: 'FRAUDE — Finansal Dostunuz',
  },
  en: {
    navFeatures: 'Features',
    navStart: 'Getting Started',
    navDownload: 'Download',
    navUpdates: 'Updates',
    signIn: 'Sign In',
    adminNav: 'Admin',
    downloadShort: '⬇ Download',
    loading: 'Loading…',
    working: 'Working…',

    heroTitleTop: 'Your financial companion',
    heroTitleAccent: 'every market on one screen',
    heroLead:
      'From Borsa Istanbul to global indices, funds to commodities and FX — live data, disclosure monitoring and AI-powered research in a single desktop app.',
    heroDownload: '⬇ Download the App',
    heroRequest: 'Request a License',
    heroNote: 'Ready for macOS & Windows · Activated with a license key',

    featuresTitle: 'Your research desk, in one app',
    featuresSub:
      'FRAUDE is built for watching, screening and researching the markets in a single workspace instead of scattered tabs.',
    f1t: 'Live Market Data',
    f1x: 'BIST equities, global indices, commodities, FX and crypto — with a ~15-min delayed quote tape.',
    f2t: 'Technical Screener',
    f2x: 'Scan the entire universe in seconds with the FQL query language over RSI, volume and fundamentals.',
    f3t: 'Disclosure Radar',
    f3x: 'Monitors KAP filings for your watchlist in the background and alerts you instantly on material changes.',
    f4t: 'Fund Analytics',
    f4x: 'TEFAS fund returns, asset allocations and per-holding breakdowns extracted from portfolio reports.',
    f5t: 'AI Research',
    f5x: 'AI agents running on your own API key read filings, news and prices to draft concise summary notes.',
    f6t: 'Economic Calendar',
    f6x: 'Central bank decisions, inflation and macro data — alongside dividend, rights and IPO calendars.',

    stepsTitle: 'Start in three steps',
    stepsSub: 'A few minutes from install to your first scan.',
    s1t: 'Download the app',
    s1x: 'Install the macOS or Windows build; the app greets you on first launch.',
    s2t: 'Create an account',
    s2x: 'Sign up with your email and submit a license request on this site.',
    s3t: 'Activate your license',
    s3x: 'Enter your approved key in the app; the terminal unlocks fully.',

    dlTitle: 'Get FRAUDE on your desktop',
    dlSub: 'Access requires a license key; request one from your account if you don’t have it yet.',
    dlMac: ' Download for macOS',
    dlWin: '⊞ Download for Windows',
    dlRequest: 'Request a License →',
    dlGatekeeper:
      'If macOS warns on first launch, right-click the app and choose "Open"; on Windows SmartScreen pick "Run anyway".',

    welcomeBack: 'Welcome back',
    createAccount: 'Create your account',
    signInSub: 'Sign in with your FRAUDE account',
    signUpSub: 'Open a free account to request a license',
    nameLabel: 'Full Name',
    emailLabel: 'Email',
    passwordLabel: 'Password',
    signUpBtn: 'Sign Up',
    noAccount: "Don't have an account? Sign up",
    haveAccount: 'Already have an account? Sign in',
    errEmail: 'Enter a valid email address.',
    errName: 'Enter your name.',
    errPwShort: 'Password must be at least 8 characters.',
    errPwRequired: 'Enter your password.',
    errEmailTaken: 'An account with this email already exists.',
    errInvalidCreds: 'Incorrect email or password.',
    errSignUp: 'Sign-up failed: ',
    errSignIn: 'Sign-in failed: ',
    confirmEmail: 'A confirmation email has been sent; verify your inbox and sign in.',

    // Password reset
    forgotPw: 'Forgot your password?',
    backToSignIn: '← Back to sign in',
    forgotTitle: 'Reset your password',
    forgotSub: "We'll email you a reset link.",
    sendResetBtn: 'Send Reset Link',
    resetSent: 'Reset link sent; check your inbox.',
    resetFailed: 'Could not send the link: ',
    resetTitle: 'Set a new password',
    resetSub: 'Enter a new password for your account.',
    newPwLabel: 'New password',
    newPwAgainLabel: 'New password (again)',
    errPwMatch: 'Passwords do not match.',
    resetSaveBtn: 'Update Password',
    resetSaveFailed: 'Update failed: ',
    resetDone: 'Password updated; taking you to your account…',
    resetLinkInvalid:
      'This link is invalid or has expired. Request a new reset link from the sign-in page.',

    myAccount: 'My Account',
    yourKeyTitle: 'Your license key',
    yourKeyHint:
      'Enter this key on the license screen after signing in to the FRAUDE app. It binds to your account and works on 2 devices.',
    approvedNoKey: 'Approved — the key will be delivered separately by the admin.',
    requestTitle: 'License Request',
    pendingNote: 'You have a pending request. Your key will appear here once approved.',
    noteLabel: 'Note (optional — briefly introduce yourself)',
    notePlaceholder: 'E.g. retail investor, planning to use it for fund analysis.',
    requestBtn: 'Request a License',
    sending: 'Sending…',
    requestFailed: 'Request failed: ',
    myRequests: 'My Requests',
    noRequests: 'No requests yet.',
    colDate: 'Date',
    colStatus: 'Status',
    colNote: 'Note',
    stPending: 'Pending',
    stApproved: 'Approved',
    stRejected: 'Rejected',
    sessionTitle: 'Session',
    signOut: 'Sign Out',
    copy: 'copy',
    copied: '✓ copied',

    adminTitle: 'Admin Panel',
    adminSub: 'Licenses, requests and key generation',
    tabOverview: 'Overview',
    tabRequests: 'Requests',
    tabLicenses: 'Licenses',
    tabGenerate: 'Generate',
    adminLoadFailed: 'Could not load admin data (check your permissions).',
    opFailed: 'Operation failed: ',
    unknownError: 'unknown error',
    statUsers: 'Registered users',
    statTotal: 'Total licenses',
    statActive: 'Active licenses',
    statUnused: 'Unused',
    statExpired: 'Expired',
    statRevoked: 'Revoked',
    statActivations: 'Device activations',
    statPending: 'Pending requests',
    reqListTitle: 'License Requests',
    noReqs: 'No requests.',
    colUser: 'User',
    approve: 'Approve',
    reject: 'Reject',
    licListTitle: 'Licenses',
    noLicenses: 'No licenses.',
    colPlan: 'Plan',
    colDevices: 'Devices',
    colExpiry: 'Expires',
    colCreated: 'Created',
    perpetual: 'Perpetual',
    revoke: 'Revoke',
    bdRevoked: 'Revoked',
    bdExpired: 'Expired',
    bdActive: 'Active',
    bdUnused: 'Unused',
    confirmRevoke: 'Revoke this license? The user loses access immediately.',
    genTitle: 'Batch Key Generation',
    genCount: 'Count (1-200)',
    genPlan: 'Plan',
    genDevices: 'Device limit',
    genExpiry: 'Expiry (empty = perpetual)',
    genNote: 'Note (who/why)',
    genBtn: 'Generate',
    genBusy: 'Generating…',
    genFailed: 'Generation failed: ',
    genDoneTitle: 'Generated keys — visible only now',
    genDoneHint: 'The database stores only hashes; copy this list before leaving.',
    copyAll: 'Copy all',
    accessDenied: 'You are not authorized to view this page.',

    updTitle: 'Updates',
    updSub:
      'FRAUDE is open source: anyone who downloads the app can clone the source, build with an AI agent and submit their contribution. Updates merged into the repo after security review are listed here.',
    updHowTitle: 'How to contribute',
    updHow1: 'Clone or fork the repository.',
    updHow2: 'Build the change with your AI agent (e.g. Claude Code) and run the tests.',
    updHow3: 'Add your entry to updates/registry.json and open a PR.',
    updHow4: 'Once merged after security review, your contribution appears here and in the app.',
    updGuideLink: 'Contribution guide ↗',
    updLoading: 'Loading updates…',
    updLoadFailed: 'Could not fetch updates; refresh the page.',
    updEmpty: 'No published updates yet.',
    updKindFix: 'Fix',
    updKindFeature: 'Feature',
    updSecurityOk: '✓ security reviewed',
    updViewCommit: 'View change ↗',
    updShippedIn: 'in package v{v}',
    updNotShipped: 'Not in an official package yet',
    updPromptTitle: 'Apply prompt for your AI agent',
    updPromptHint:
      'To apply this to your own FRAUDE copy, paste this prompt to your AI agent in your local clone; the agent adapts the change to your version.',
    updCopy: 'Copy prompt',
    updCopied: '✓ copied',
    updManualNotes: 'Manual steps',

    footerTag: 'your financial companion',
    disclaimer: 'Data is not investment advice.',
    metaTitle: 'FRAUDE — Your Financial Companion',
  },
} as const;

export type StringKey = keyof (typeof STRINGS)['tr'];

interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: StringKey) => string;
}

const I18nContext = createContext<I18n | null>(null);

function initialLang(): Lang {
  // ?lang=tr|en adresi hem test hem paylaşım için tercihi geçersiz kılar.
  const fromUrl = new URLSearchParams(window.location.search).get('lang');
  if (fromUrl === 'tr' || fromUrl === 'en') {
    localStorage.setItem(STORAGE_KEY, fromUrl);
    return fromUrl;
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'tr' || stored === 'en') return stored;
  return navigator.language?.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const setLang = (next: Lang) => {
    localStorage.setItem(STORAGE_KEY, next);
    setLangState(next);
  };

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = STRINGS[lang].metaTitle;
  }, [lang]);

  const t = (key: StringKey) => STRINGS[lang][key];

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n, I18nProvider içinde kullanılmalı');
  return ctx;
}
