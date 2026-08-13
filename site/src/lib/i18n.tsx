import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Lang = 'tr' | 'en';

const STORAGE_KEY = 'fraude-site-lang';

/**
 * Dil tercihini hesaba yazar (oturum açıksa). E-posta şablonları bu değeri
 * `.Data.lang` ile okur; böylece kullanıcı arayüz dilini değiştirdiğinde
 * sonraki doğrulama/yenileme e-postaları da o dilde gelir. supabase istemcisi
 * gecikmeli yüklenir: dil değiştirmek açılış paketini büyütmemeli.
 */
async function syncLangToAccount(next: Lang): Promise<void> {
  try {
    const { supabase } = await import('./supabase');
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    await supabase.auth.updateUser({ data: { lang: next } });
  } catch {
    // Ağ/oturum hatası dil değişimini engellemez
  }
}

const STRINGS = {
  tr: {
    // Nav & genel
    navFeatures: 'Modüller',
    navStart: 'Başlangıç',
    navDownload: 'İndir',
    navUpdates: 'Güncellemeler',
    navAccess: 'Erişim',
    navMenu: 'Menü',
    navMenuClose: 'Menüyü kapat',
    signIn: 'Giriş Yap',
    adminNav: 'Yönetim',
    downloadShort: '⬇ İndir',
    loading: 'Yükleniyor…',
    working: 'İşleniyor…',

    // Hero
    heroEyebrow: '{n} modül · macOS + Windows · açık kaynak',
    heroLine1: 'KAP, TEFAS, izahname, bülten.',
    heroLine2: 'Hepsi tek terminalde.',
    // Kahraman metni kasten kısa: mobilde çağrı butonu ekranın üstünde kalsın.
    heroLead:
      "Borsa İstanbul'u izlemek için açtığınız onlarca sekme tek masaüstü uygulamasında toplanır.",
    heroNote: 'Ücretsiz. Lisans anahtarı yalnızca erişim kapısıdır.',
    heroSecondary: 'Windows sürümü',

    // Kahraman terminali
    termTitle: 'Teknik Tarayıcı',
    termSample: 'örnek tarama',
    termAria:
      "FRAUDE teknik tarayıcısı: BIST100 üzerinde RSI'si 30'un altındaki hisseleri listeleyen örnek bir tarama ve altında düşen bir KAP bildirimi.",
    termKap: 'Pay Geri Alım İşlemine İlişkin Bildirim',
    colTicker: 'KOD',
    colLast: 'SON',
    colChange: 'GÜN',

    // Kaynaklar
    srcTitle: 'Veri kaynakları',

    // Modüller
    modKicker: 'Modüller',
    modTitle: 'Tek çalışma alanı, {n} modül',
    modSub:
      'Her modül kendi sekmesinde açılır, aynı çalışma alanını paylaşır; sıralamasını ve hangilerinin yükleneceğini siz belirlersiniz.',
    modAlways: 'Ayrıca her yerden:',
    modOpen: 'Modülü incele',

    // Modül ayrıntı sayfası
    modBackAll: 'Tüm modüller',
    modShotCaption:
      'Uygulamadan alınmış ekran görüntüsü. Veriler gecikmelidir; ekrandaki değerler çekim anına aittir.',
    modNoShot:
      'Bu modül kişisel hesabınıza bağlı çalıştığı için tanıtım ekran görüntüsü yayımlamıyoruz; uygulamayı kurduğunuzda kendi verinizle açılır.',
    modDoesTitle: 'Ne yapar',
    modFeedsTitle: 'Nereden beslenir',
    modFlowTitle: 'Tipik akış',
    modPrev: 'Önceki',
    modNext: 'Sonraki',
    modCtaTitle: 'Bu modülü kendi verinizle deneyin',
    modCtaSub: 'Uygulamayı kurun; modül ilk açılışta çalışmaya hazır gelir.',
    modNotFound: 'Böyle bir modül yok',
    modNotFoundSub: 'Bağlantı eski olabilir. Tüm modüllere dönüp oradan seçin.',

    // Farklar
    whyKicker: 'Farklar',
    whyTitle: 'Üç tasarım kararı',
    p1l: 'Veri',
    p1t: 'Doğrudan resmî kaynaktan',
    p1x: "Fiyat, bildirim ve fon verisi KAP, SPK, TEFAS, Borsa İstanbul ve İş Yatırım'ın kendi uçlarından okunur. Araya veri satan bir katman girmez; her satırın kaynağına ekrandan gidersiniz.",
    p2l: 'Yapay zeka',
    p2t: 'Kendi anahtarınızla çalışır',
    p2x: 'Araştırma ajanları sizin sağlayıcı hesabınıza bağlanır. Sorgularınız bizim sunucumuzdan geçmez ve sağlayıcıyı istediğiniz zaman değiştirirsiniz.',
    p3l: 'Kaynak kodu',
    p3t: 'Açık kaynak, ajanla katkı',
    p3x: 'Depoyu klonlar, değişikliği kendi AI ajanınızla geliştirir ve PR açarsınız. Güvenlik incelemesinden geçen katkı hem bu sitede hem uygulamanın içinde listelenir.',

    // Ürün — kahramanın altındaki sekmeli ekran görüntüsü
    shotKicker: 'Uygulama',
    shotTitle: 'Ekranın kendisi',
    shotSub: 'Aşağıdakiler tanıtım çizimi değil; uygulamadan alınmış ekran görüntüleri.',
    shotCaption: 'Veriler gecikmelidir; ekrandaki değerler çekim anına aittir.',
    shotAll: 'Tüm modülleri gör',

    // Akış — ürünün nasıl kullanıldığı
    flowKicker: 'Kullanım',
    flowTitle: 'Bir sabahın işi',
    flowSub: 'Piyasa açılışından bildirim radarına kadar üç ekran.',
    f1t: 'Önce tarayın',
    f1x: 'FQL ile koşulu yazın — aşırı satım, ucuz değer, momentum. Eşleşen hisseler göstergeleriyle listelenir.',
    f2t: 'Sonra derinleşin',
    f2x: 'Bir hisseye takıldıysanız Bilgi Deposu KAP bildirimini, SPK bültenini, aracı kurum analizini ve haberi tek zaman çizgisinde önünüze koyar.',
    f3t: 'Sonra radara bağlayın',
    f3x: 'Takip listenizi radara verin; ortaklık değişimi ya da yeni sözleşme çıktığında yapay zeka yorumuyla haber verir.',

    // Adımlar (kurulum)
    stepsKicker: 'Kurulum',
    stepsTitle: 'Üç adımda başlayın',
    stepsSub: 'İndirmeden ilk taramaya birkaç dakika.',
    s1t: 'Uygulamayı indirin',
    s1x: 'macOS veya Windows sürümünü indirip kurun; uygulama açılışta sizi karşılar.',
    s2t: 'Hesap oluşturun',
    s2x: 'E-postanızla kaydolun ve bu siteden lisans talebinizi iletin.',
    s3t: 'Lisansı etkinleştirin',
    s3x: 'Onaylanan anahtarınızı uygulamaya girin; terminal tamamen açılır.',

    // Erişim
    accKicker: 'Erişim',
    accTitle: 'Ücretsiz',
    accSub: 'Ödeme yok, abonelik yok, deneme süresi yok.',
    accWhyTitle: 'Peki lisans anahtarı neden var?',
    accWhyBody:
      'Uygulama veriyi resmî kaynakların kendi uçlarından çekiyor ve bu uçların hız sınırları var. Anahtar, kapasiteyi ve kötüye kullanımı yönetmek için duruyor — ücretlendirme için değil. Talebinizi hesabınızdan iletirsiniz, onaylandığında anahtar e-postanıza gelir.',
    accY1: 'Uygulamanın tamamı, 16 modül',
    accY2: 'macOS ve Windows',
    accY3: 'Kaynak kodu açık, kendiniz derleyebilirsiniz',
    accY4: 'Yapay zeka için kendi sağlayıcı anahtarınız',
    accCta: 'Lisans talep et',

    // Veri kaynakları sayfası
    srcPageKicker: 'Şeffaflık',
    srcPageTitle: 'Veri nereden geliyor',
    srcPageLead:
      'FRAUDE kendi verisini üretmez. Ekranda gördüğünüz her satır aşağıdaki kurumlardan birinin yayımladığı veridir ve kaynağına ekrandan gidebilirsiniz.',
    srcDelayTitle: 'Veriler gecikmelidir',
    srcDelayBody:
      'FRAUDE gerçek zamanlı veri dağıtmaz. Fiyatlar ve bildirimler kaynakların herkese açık uçlarından belirli aralıklarla çekilir; ekranda gördüğünüz değer o çekimin anına aittir. Saniyelik karar gerektiren işlemler için uygun değildir.',
    srcTakesLabel: 'Alınan veri',
    srcThanksTitle: 'Teşekkür',
    srcThanksBody:
      'Bu uygulama, verisini herkese açık tutan kurumlar olmadan var olamazdı. KAP, SPK, TEFAS, Borsa İstanbul ve TCMB’ye şeffaflıkları için; analiz raporlarını yayımlayan aracı kurumlara emekleri için; açık indekslerini paylaşan haber kaynaklarına ve halka arz takvimini titizlikle tutan topluluğa teşekkür ederiz. Veriler kendi sahiplerine aittir; FRAUDE yalnızca okur, düzenler ve kaynağını gösterir.',
    srcCorrectionTitle: 'Bir yanlışlık mı var?',
    srcCorrectionBody:
      'Kurumunuza ait bir kaydın burada yanlış anlatıldığını ya da yer almasını istemediğinizi düşünüyorsanız, depodan bize ulaşın; düzeltiriz.',
    srcCorrectionCta: 'GitHub üzerinden bildir',

    // SSS
    faqKicker: 'Sık sorulanlar',
    faqTitle: 'Muhtemelen bunu soracaksınız',
    q1: 'Verilerim nerede duruyor?',
    a1: 'Fiyat ve bildirim verisi kendi bilgisayarınızdaki yerel veritabanında. Portföyünüz, izleme listeniz ve taramalarınız da orada. Bunları bize göndermiyoruz.',
    q2: 'Yapay zeka için para ödüyor muyum?',
    a2: 'Bize değil. Kendi sağlayıcı anahtarınızı giriyorsunuz ve sorgularınız doğrudan o sağlayıcıya gidiyor; faturayı onlar kesiyor. Sağlayıcıyı istediğiniz zaman değiştirebilirsiniz.',
    q3: 'Veriler nereden geliyor, güvenilir mi?',
    a3: "KAP, SPK, TEFAS, Borsa İstanbul, İş Yatırım ve TCMB'nin kendi uçlarından. Araya veri satan bir katman girmiyor ve her satırın kaynağına ekrandan gidebiliyorsunuz. Haber tarafı GDELT ve Google News gibi herkese açık kaynaklardan; modül bunu ekranında yazıyor.",
    q4: 'Yatırım tavsiyesi veriyor mu?',
    a4: 'Hayır. FRAUDE veriyi toplar, tarar ve gösterir; kararı siz verirsiniz. Yapay zeka yorumları da bir görüştür, tavsiye değildir.',
    q5: 'Hangi platformlarda çalışıyor?',
    a5: 'macOS ve Windows masaüstü. Uygulama Tauri ile paketleniyor, veri katmanı Rust.',
    q6: 'Katkıda bulunabilir miyim?',
    a6: 'Evet. Depo açık; değişikliği kendi yapay zeka ajanınızla geliştirip PR açabilirsiniz. Güvenlik incelemesinden geçen katkı hem bu sitede hem uygulamanın Güncellemeler sekmesinde listelenir.',

    // İndir bandı
    dlTitle: "FRAUDE'yi masaüstünüze kurun",
    dlSub: 'Erişim lisans anahtarıyla sağlanır; anahtarınız yoksa hesabınızdan talep edin.',
    dlMac: 'macOS için indir',
    dlWin: 'Windows için indir',
    dlRequest: 'Lisans talep et',
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
    pwWeak: 'Zayıf',
    pwMedium: 'Orta',
    pwStrong: 'Güçlü',
    orContinue: 'ya da',
    githubBtn: 'GitHub ile devam et',
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

    // Masaüstü GitHub girişinin dönüş durağı
    handoffTitle: 'Girişiniz doğrulandı',
    handoffSub:
      'FRAUDE masaüstü uygulamasına dönmek için aşağıdaki düğmeye dokunun. Tarayıcı uygulamayı yalnızca sizin onayınızla açabildiği için bu adım gerekli.',
    handoffOpenBtn: "FRAUDE'yi Aç",
    handoffOpenAgainBtn: 'Yeniden Dene',
    handoffOpened:
      'FRAUDE açılıyor. Tarayıcı izin sorarsa onaylayın; uygulama öne gelince bu sekmeyi kapatabilirsiniz.',
    handoffStalled:
      'FRAUDE öne geldiyse bu sekmeyi kapatabilirsiniz. Gelmediyse: tarayıcınız izin penceresi gösterdiyse onaylayın, uygulamayı açıp “Yeniden Dene” deyin.',
    handoffDesktopOnly:
      'FRAUDE bir masaüstü uygulamasıdır (macOS ve Windows). Bu sayfayı telefonda açtıysanız girişi bilgisayarınızdan sürdürün.',
    handoffFailTitle: 'Giriş tamamlanamadı',
    handoffError: 'GitHub girişi tamamlanamadı: ',
    handoffErrDuplicateEmail:
      'GitHub hesabınızdaki doğrulanmış e-posta adresleri FRAUDE’de birden fazla hesapla eşleşiyor; GitHub kimliğinin hangisine bağlanacağı seçilemediği için giriş durdu. Şimdilik e-posta ve şifrenizle girin — hesaplarınız tek hesapta birleştirildiğinde GitHub girişi çalışır.',
    handoffErrProviderEmail:
      'GitHub e-posta adresinizi paylaşmadı, bu yüzden hesap eşleştirilemedi. GitHub → Settings → Emails bölümünde adresinizi doğrulayıp erişime açın ya da e-posta ve şifrenizle girin.',
    handoffIdleTitle: 'Uygulama girişi',
    handoffInvalid:
      'Bu sayfa GitHub girişinden sonra uygulamaya dönmek içindir. Girişi FRAUDE uygulamasındaki “GitHub ile devam et” düğmesinden başlatın.',
    handoffTrouble: 'Uygulama açılmıyor mu?',
    handoffTroubleHelp:
      'FRAUDE’nin kurulu ve açık olduğundan emin olun. macOS’ta uygulamayı DMG penceresinden değil, Uygulamalar klasörüne taşıdıktan sonra çalıştırın; tarayıcı yalnızca kurulu uygulamayı tanır.',
    handoffDownloadMac: 'macOS için indir',
    handoffDownloadWin: 'Windows için indir',

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
    mailSend: 'E-posta gönder',
    mailResend: 'Yeniden gönder',
    mailSentBadge: 'E-posta ✓',
    mailFailed: 'Lisans e-postası gönderilemedi: ',
    abuseBadge: 'İptal bildirimi',
    abuseTitle: 'Bu talebi sen mi yapmadın?',
    abuseSentTo: 'Bu adrese gönderilen anahtar:',
    abuseWarn: 'Onaylarsan anahtar kalıcı olarak iptal edilir ve yönetici bilgilendirilir.',
    abuseConfirm: 'Evet, bu talebi ben yapmadım — anahtarı iptal et',
    abuseRevokedTitle: 'Lisans anahtarınız başarıyla iptal edildi',
    abuseRevoked: 'Bildirimin alındı: anahtar kalıcı olarak iptal edildi ve yönetici bilgilendirildi. Hesabının güvenliğinden şüpheleniyorsan şifreni de yenilemeni öneririz.',
    surveyTitle: 'Deneyimini değerlendir',
    surveyHint: 'Bu süreç ne kadar sorunsuzdu? (1 = kötü, 5 = çok iyi)',
    surveyComment: 'Eklemek istediğin bir şey var mı? (isteğe bağlı)',
    surveySend: 'Gönder',
    surveyThanks: 'Teşekkürler! Geri bildirimin alındı.',
    surveyShort: 'Anket',
    notifyTitle: 'Bildirim tercihleri',
    notifySub: 'AI ajanları KAP, SPK ve haberleri okur; takip ettiğin şirketlere dair önemli gelişmeleri önem sırasına dizip e-posta ile bildirir. Uygulama kapalıyken de çalışır.',
    notifyEnabled: 'E-posta bildirimleri açık',
    notifyKap: 'KAP bildirimleri',
    notifySpk: 'SPK bültenleri',
    notifyNews: 'Ekonomi haberleri',
    notifyTickers: 'Takip edilen hisseler',
    notifyTickerSearch: 'Hisse ara (kod ya da ad)…',
    notifyKeywords: 'Ek anahtar kelimeler (virgülle)',
    notifyKeywordsPlaceholder: 'temettü, halka arz, birleşme',
    notifyMinPriority: 'En düşük önem eşiği',
    notifyPrioAll: 'Hepsi (1+)',
    notifyPrioMed: 'Orta ve üzeri (3+)',
    notifyPrioHigh: 'Yüksek (4+)',
    notifyPrioCritical: 'Yalnız kritik (5)',
    notifySave: 'Kaydet',
    notifySaving: 'Kaydediliyor…',
    notifySaved: 'Kaydedildi ✓',
    notifyFeedTitle: 'Chrome eklentisi bildirimleri',
    notifyFeedSub: 'Bu anahtarı Fraude Chrome eklentisinin ayarlarına yapıştırın; KAP/SPK/haber bildirimleriniz masaüstü uygulaması kapalıyken bile Chrome’da görünür.',
    notifyFeedEmpty: 'Anahtar, tercihlerinizi ilk kez kaydettikten sonra burada görünür.',
    notifyFeedCopy: 'Kopyala',
    notifyFeedCopied: 'Kopyalandı ✓',
    abuseAlreadyTitle: 'Bildirim zaten alınmış',
    abuseAlready: 'Bu talep daha önce bildirilmiş ve anahtar iptal edilmişti. Ek bir şey yapmana gerek yok.',
    abuseInvalidTitle: 'Bağlantı geçersiz',
    abuseInvalid: 'Bu bağlantı hatalı, süresi dolmuş ya da daha yeni bir e-posta gönderilmiş. Sorun sürerse lisans e-postasını yanıtlayarak bize ulaş.',
    abuseErrorTitle: 'Bir sorun oluştu',
    abuseError: 'İşlem tamamlanamadı; lütfen tekrar dene ya da lisans e-postasını yanıtlayarak bize ulaş.',
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
    disclaimer: 'Veriler gecikmelidir ve yatırım tavsiyesi değildir.',
    navSources: 'Veri kaynakları',
    metaTitle: 'FRAUDE — Finansal Dostunuz',
  },
  en: {
    navFeatures: 'Modules',
    navStart: 'Getting Started',
    navDownload: 'Download',
    navUpdates: 'Updates',
    navAccess: 'Access',
    navMenu: 'Menu',
    navMenuClose: 'Close menu',
    signIn: 'Sign In',
    adminNav: 'Admin',
    downloadShort: '⬇ Download',
    loading: 'Loading…',
    working: 'Working…',

    heroEyebrow: '{n} modules · macOS + Windows · open source',
    heroLine1: 'Filings, funds, prospectuses, bulletins.',
    heroLine2: 'One terminal.',
    heroLead:
      'The dozen tabs you keep open to follow Borsa İstanbul collapse into a single desktop app.',
    heroNote: 'Free. The license key is an access gate, nothing more.',
    heroSecondary: 'Windows build',

    termTitle: 'Technical Screener',
    termSample: 'sample scan',
    termAria:
      'The FRAUDE technical screener: a sample scan listing BIST100 stocks with an RSI below 30, and a KAP disclosure arriving underneath it.',
    termKap: 'Notification on share buy-back transaction',
    colTicker: 'CODE',
    colLast: 'LAST',
    colChange: 'CHG',

    srcTitle: 'Data sources',

    modKicker: 'Modules',
    modTitle: 'One workspace, {n} modules',
    modSub:
      'Every module opens in its own tab and shares one workspace; you decide the order and which ones load.',
    modAlways: 'Also available everywhere:',
    modOpen: 'See the module',

    modBackAll: 'All modules',
    modShotCaption:
      'Screenshot taken from the app. Data is delayed; the values on screen are from the moment of capture.',
    modNoShot:
      'This module runs against your own account, so we don’t publish a marketing screenshot of it; it opens with your data once you install the app.',
    modDoesTitle: 'What it does',
    modFeedsTitle: 'What feeds it',
    modFlowTitle: 'Typical flow',
    modPrev: 'Previous',
    modNext: 'Next',
    modCtaTitle: 'Try this module on your own data',
    modCtaSub: 'Install the app; the module is ready to work on first launch.',
    modNotFound: 'No such module',
    modNotFoundSub: 'The link may be out of date. Go back to all modules and pick one there.',

    whyKicker: 'Differences',
    whyTitle: 'Three design decisions',
    p1l: 'Data',
    p1t: 'Straight from the official source',
    p1x: 'Prices, filings and fund data are read from the endpoints of KAP, SPK, TEFAS, Borsa İstanbul and İş Yatırım themselves. No data reseller sits in between, and you can reach any row’s source from the screen.',
    p2l: 'AI',
    p2t: 'Runs on your own key',
    p2x: 'Research agents connect to your provider account. Your queries never pass through our servers, and you can switch providers whenever you want.',
    p3l: 'Source code',
    p3t: 'Open source, built with agents',
    p3x: 'Clone the repository, build your change with your own AI agent and open a PR. Once it passes security review, your contribution is listed both on this site and inside the app.',

    shotKicker: 'The app',
    shotTitle: 'The screen itself',
    shotSub: 'Not illustrations — screenshots taken from the app.',
    shotCaption: 'Data is delayed; the values on screen are from the moment of capture.',
    shotAll: 'See every module',

    flowKicker: 'In use',
    flowTitle: 'One morning’s work',
    flowSub: 'Three screens, from the opening bell to the disclosure radar.',
    f1t: 'Screen first',
    f1x: 'Write the condition in FQL — oversold, cheap value, momentum. Matching stocks are listed with their indicators.',
    f2t: 'Then go deeper',
    f2x: 'When one name catches your eye, the Knowledge Base puts its KAP disclosure, SPK bulletin, broker research and news on a single timeline.',
    f3t: 'Then hand it to the radar',
    f3x: 'Give the radar your watchlist; when ownership shifts or a new contract lands, it tells you — with an AI reading attached.',

    stepsKicker: 'Setup',
    stepsTitle: 'Start in three steps',
    stepsSub: 'A few minutes from download to your first scan.',
    s1t: 'Download the app',
    s1x: 'Install the macOS or Windows build; the app greets you on first launch.',
    s2t: 'Create an account',
    s2x: 'Sign up with your email and submit a license request on this site.',
    s3t: 'Activate your license',
    s3x: 'Enter your approved key in the app; the terminal unlocks fully.',

    accKicker: 'Access',
    accTitle: 'Free',
    accSub: 'No payment, no subscription, no trial period.',
    accWhyTitle: 'Then why is there a license key?',
    accWhyBody:
      'The app reads data from the official sources’ own endpoints, and those endpoints have rate limits. The key exists to manage capacity and abuse — not to charge you. Request one from your account; once approved, it arrives by email.',
    accY1: 'The whole app, all 16 modules',
    accY2: 'macOS and Windows',
    accY3: 'Source is open — build it yourself if you prefer',
    accY4: 'Your own provider key for the AI features',
    accCta: 'Request a license',

    srcPageKicker: 'Transparency',
    srcPageTitle: 'Where the data comes from',
    srcPageLead:
      'FRAUDE produces no data of its own. Every row you see on screen was published by one of the institutions below, and you can reach its source from the screen.',
    srcDelayTitle: 'Data is delayed',
    srcDelayBody:
      'FRAUDE does not distribute real-time data. Prices and disclosures are pulled from the sources’ public endpoints at intervals; the value on screen belongs to the moment of that pull. It is not suitable for decisions that need second-by-second pricing.',
    srcTakesLabel: 'What we take',
    srcThanksTitle: 'Thank you',
    srcThanksBody:
      'This app could not exist without institutions that keep their data public. Our thanks to KAP, SPK, TEFAS, Borsa İstanbul and TCMB for their transparency; to the brokerage houses that publish research for their work; to the news sources that share open indexes, and to the community that keeps the IPO calendar with care. The data belongs to its owners; FRAUDE only reads it, arranges it and shows where it came from.',
    srcCorrectionTitle: 'Something wrong here?',
    srcCorrectionBody:
      'If a record about your institution is described incorrectly, or you would rather it were not listed, reach us through the repository and we will fix it.',
    srcCorrectionCta: 'Tell us on GitHub',

    faqKicker: 'FAQ',
    faqTitle: 'You’re probably about to ask',
    q1: 'Where does my data live?',
    a1: 'Price and disclosure data sit in a local database on your own machine, and so do your portfolio, watchlist and saved scans. We don’t ship any of it to ourselves.',
    q2: 'Am I paying for the AI?',
    a2: 'Not to us. You enter your own provider key and your queries go straight to that provider, who bills you. Switch providers whenever you like.',
    q3: 'Where does the data come from — can I trust it?',
    a3: 'From the endpoints of KAP, SPK, TEFAS, Borsa İstanbul, İş Yatırım and TCMB themselves. No data reseller sits in between, and you can reach any row’s source from the screen. News comes from public sources such as GDELT and Google News, and the module says so on screen.',
    q4: 'Is this investment advice?',
    a4: 'No. FRAUDE collects, screens and displays data; the decision is yours. AI readings are one opinion, not a recommendation.',
    q5: 'Which platforms does it run on?',
    a5: 'macOS and Windows desktop. The app is packaged with Tauri; the data layer is Rust.',
    a6: 'Yes. The repository is open — build your change with your own AI agent and open a PR. Once it passes security review it is listed both on this site and in the app’s Updates tab.',
    q6: 'Can I contribute?',

    dlTitle: 'Get FRAUDE on your desktop',
    dlSub: 'Access requires a license key; request one from your account if you don’t have it yet.',
    dlMac: 'Download for macOS',
    dlWin: 'Download for Windows',
    dlRequest: 'Request a license',
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
    pwWeak: 'Weak',
    pwMedium: 'Fair',
    pwStrong: 'Strong',
    orContinue: 'or',
    githubBtn: 'Continue with GitHub',
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

    handoffTitle: 'You are signed in',
    handoffSub:
      'Tap the button below to return to the FRAUDE desktop app. This step is needed because the browser can only open the app with your confirmation.',
    handoffOpenBtn: 'Open FRAUDE',
    handoffOpenAgainBtn: 'Try Again',
    handoffOpened:
      'Opening FRAUDE. Approve the prompt if your browser asks; once the app is in front you can close this tab.',
    handoffStalled:
      'If FRAUDE came to the front you can close this tab. If it did not: approve the prompt if your browser showed one, then launch the app and hit “Try Again”.',
    handoffDesktopOnly:
      'FRAUDE is a desktop app (macOS and Windows). If you opened this page on a phone, continue the sign-in from your computer.',
    handoffFailTitle: 'Sign-in could not be completed',
    handoffError: 'GitHub sign-in could not be completed: ',
    handoffErrDuplicateEmail:
      'The verified email addresses on your GitHub account match more than one FRAUDE account, so GitHub cannot tell which one to link to. Use your email and password for now — GitHub sign-in works once your accounts are merged into one.',
    handoffErrProviderEmail:
      'GitHub did not share your email address, so the account could not be matched. Verify and expose your address under GitHub → Settings → Emails, or sign in with your email and password.',
    handoffIdleTitle: 'App sign-in',
    handoffInvalid:
      'This page returns you to the app after a GitHub sign-in. Start the sign-in from the “Continue with GitHub” button inside the FRAUDE app.',
    handoffTrouble: 'App not opening?',
    handoffTroubleHelp:
      'Make sure FRAUDE is installed and running. On macOS, move the app to your Applications folder before launching it — the browser only recognises an installed app, not one running from the DMG window.',
    handoffDownloadMac: 'Download for macOS',
    handoffDownloadWin: 'Download for Windows',

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
    mailSend: 'Send email',
    mailResend: 'Resend',
    mailSentBadge: 'Emailed ✓',
    mailFailed: 'License email failed: ',
    abuseBadge: 'Abuse reported',
    abuseTitle: "Didn't you make this request?",
    abuseSentTo: 'Key delivered to:',
    abuseWarn: 'If you confirm, the key is permanently revoked and the admin is notified.',
    abuseConfirm: "Yes, this wasn't me — revoke the key",
    abuseRevokedTitle: 'Your license key was successfully revoked',
    abuseRevoked: 'Your report was received: the key has been permanently revoked and the admin notified. If you suspect your account was compromised, we also recommend resetting your password.',
    surveyTitle: 'Rate your experience',
    surveyHint: 'How smooth was this process? (1 = poor, 5 = excellent)',
    surveyComment: 'Anything to add? (optional)',
    surveySend: 'Submit',
    surveyThanks: 'Thanks! Your feedback was recorded.',
    surveyShort: 'Survey',
    notifyTitle: 'Notification preferences',
    notifySub: 'AI agents read KAP, SPK, and news; they rank the developments relevant to the companies you follow by importance and email them to you. Works even when the app is closed.',
    notifyEnabled: 'Email notifications on',
    notifyKap: 'KAP disclosures',
    notifySpk: 'SPK bulletins',
    notifyNews: 'Economy news',
    notifyTickers: 'Followed tickers',
    notifyTickerSearch: 'Search a ticker (code or name)…',
    notifyKeywords: 'Extra keywords (comma-separated)',
    notifyKeywordsPlaceholder: 'dividend, IPO, merger',
    notifyMinPriority: 'Minimum importance threshold',
    notifyPrioAll: 'All (1+)',
    notifyPrioMed: 'Medium and up (3+)',
    notifyPrioHigh: 'High (4+)',
    notifyPrioCritical: 'Critical only (5)',
    notifySave: 'Save',
    notifySaving: 'Saving…',
    notifySaved: 'Saved ✓',
    notifyFeedTitle: 'Chrome extension notifications',
    notifyFeedSub: 'Paste this key into the Fraude Chrome extension settings; your KAP/SPK/news alerts appear in Chrome even when the desktop app is closed.',
    notifyFeedEmpty: 'The key appears here once you save your preferences for the first time.',
    notifyFeedCopy: 'Copy',
    notifyFeedCopied: 'Copied ✓',
    abuseAlreadyTitle: 'Already reported',
    abuseAlready: 'This request was reported earlier and the key has already been revoked. No further action is needed.',
    abuseInvalidTitle: 'Invalid link',
    abuseInvalid: 'This link is invalid, expired, or superseded by a newer email. If the problem persists, reply to the license email to reach us.',
    abuseErrorTitle: 'Something went wrong',
    abuseError: 'The operation could not be completed; please try again or reply to the license email to reach us.',
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
    disclaimer: 'Data is delayed and is not investment advice.',
    navSources: 'Data sources',
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
    // Tercih hesapta da saklanır: kayıt doğrulama ve şifre yenileme
    // e-postaları bu değere bakar (bkz. docs/email-templates/*.html). Oturum
    // yoksa ya da yazılamazsa akış etkilenmez — dil arayüzde zaten değişti.
    void syncLangToAccount(next);
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
