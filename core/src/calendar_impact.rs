//! Takvim maddesinin piyasa karşılığı — bu veriyi hangi paylar izler?
//!
//! Ekonomik takvim satırı bir rakam gösterir ("Otomobil Üretimi %15,5"), ama o
//! rakamın kimi ilgilendirdiğini göstermez. Bu modül satırın KATEGORİSİNDEN üç
//! şey türetir:
//!
//! 1. **Etki kanalı** — veri piyasaya hangi yoldan geçer (talep, maliyet, marj).
//! 2. **Etiketlenen paylar** — BIST'te ve dünya piyasalarında o kanala en açık
//!    olanlar; her biri kendi gerekçesiyle.
//! 3. **İlgili analiz raporları** — kurum arşivinde o konuyu ya da o payları
//!    konu alan, yakın tarihli raporlar.
//!
//! YÖN İDDİASI YOK. Eşleme "bu veri açıklanınca şu pay yükselir" demez; hangi
//! payın o veriyle ilgili olduğunu söyler. Aynı sebeple `EconomicCalendar`'daki
//! sapma oku da olumlu/olumsuz yorumu taşımıyor: enflasyonda beklenti üstü
//! gelmek olumsuz, büyümede olumludur — göstergeye bakmadan renklendirmek
//! yanıltıcı olurdu.
//!
//! Eşleme YAPAY ZEKÂYA DEĞİL sabit bir tabloya dayanır: takvim çevrimdışı da
//! açılıyor, anahtar isteyen bir sağlayıcıya bağlanmak paneli kırılgan yapardı.
//! Tablo aynı zamanda sınanabilir — kaynak değişse de gerekçeler yerinde kalır.

use serde::{Deserialize, Serialize};

use crate::research_reports::{AnalystReport, ReportArchive};

/// Rapor araması bu kadar geriye bakar. Makro raporlar aylık yayımlanıyor;
/// dört ay, bir göstergenin son üç-dört yayınını kapsar.
const REPORT_WINDOW_DAYS: i64 = 120;

/// Bir takvim satırında gösterilecek en fazla rapor.
const MAX_REPORTS: usize = 6;

/// Her gün çıkan, her konuyu bir cümleyle anan yayınlar. Bunlar konu terimini
/// de hisse kodunu da taşır ama takvim satırına dair bir şey söylemez; liste
/// bunlarla dolarsa gerçek raporlar görünmez olur.
const GENERIC_TITLES: &[&str] = &[
    "piyasalarda bugün",
    "günlük bülten",
    "gunluk bulten",
    "pay geri alım",
    "takas dağılım",
    "kapanış raporu",
    "açılış raporu",
    "viop",
    "elüs",
    "yatırım fikirleri",
    "bir bakışta",
    "sabah stratejisi",
    "günlük teknik",
    "açıklanan kar rakamları",
    "haftalık bülten",
    "portföy önerileri",
];

/// İki dilde sabit metin. Takvim satırının kendi adı Türkçe geliyor, ama
/// gerekçe cümlesi kullanıcı diline uymalı: arayüz tam iki dilli.
///
/// `Copy`: ortak listelerden ("BANKS", "CONSUMER") tek tek kayıt seçilebilsin
/// diye — `CONSUMER[0]` bir sabit ifadedir ve kopyalanabilir olmalı.
#[derive(Clone, Copy)]
struct Text {
    tr: &'static str,
    en: &'static str,
}

impl Text {
    fn pick(&self, lang: &str) -> String {
        if lang == "en" { self.en.to_string() } else { self.tr.to_string() }
    }
}

/// Etiketlenen tek bir enstrüman.
#[derive(Clone, Copy)]
struct LinkSpec {
    /// BIST kodu ("FROTO") ya da sağlayıcı sembolü ("BZ=F", "STLA").
    symbol: &'static str,
    /// Ekranda görünen kısa ad.
    name: &'static str,
    /// Bu satırla ilişkisi — kanal cümlesinin pay bazındaki karşılığı.
    why: Text,
}

/// Bir takvim kategorisinin piyasa profili.
struct Profile {
    channel: Text,
    bist: &'static [LinkSpec],
    global: &'static [LinkSpec],
    /// Rapor BAŞLIĞINDA aranacak terimler.
    ///
    /// `calendar_news`'teki `must` listesinden ayrıdır ve bilerek daha geniştir:
    /// orada amaç bir haber başlığının konuyu gerçekten anlatıp anlatmadığını
    /// ölçmek (dar terim), burada amaç kurumun o konudaki raporunu bulmak —
    /// "Otomotiv Sektör Raporu" satırın konusudur ama içinde "otomobil üretimi"
    /// öbeği geçmez.
    report_terms: &'static [&'static str],
}

/* ── Sık kullanılan bağlantılar ───────────────────────────────────────────── */

macro_rules! link {
    ($symbol:expr, $name:expr, $tr:expr, $en:expr) => {
        LinkSpec { symbol: $symbol, name: $name, why: Text { tr: $tr, en: $en } }
    };
}

/// Politika faizine en açık bankalar; kredi-mevduat makası doğrudan buradan geçer.
const BANKS: &[LinkSpec] = &[
    link!("GARAN", "Garanti BBVA", "Kredi-mevduat makası politika faiziyle birlikte hareket eder", "Loan-deposit spread moves with the policy rate"),
    link!("AKBNK", "Akbank", "Menkul kıymet portföyü ve makas faize duyarlı", "Securities book and spread are rate-sensitive"),
    link!("ISCTR", "İş Bankası", "Kredi büyümesi ve fonlama maliyeti faize bağlı", "Loan growth and funding cost track the rate"),
    link!("YKBNK", "Yapı Kredi", "TÜFE'ye endeksli tahvil getirisi ve makas", "CPI-linked bond yield and spread"),
    link!("VAKBN", "VakıfBank", "Kamu bankalarında kredi hacmi faiz patikasına bağlı", "State bank loan volume follows the rate path"),
    link!("HALKB", "Halkbank", "Esnaf/KOBİ kredi hacmi faize duyarlı", "SME loan volume is rate-sensitive"),
];

/// İç talep göstergelerinin ilk durağı: organize perakende ve dayanıklı tüketim.
const CONSUMER: &[LinkSpec] = &[
    link!("BIMAS", "BİM", "Gıda perakendesinde ciro doğrudan hane halkı harcamasına bağlı", "Food retail revenue tracks household spending"),
    link!("MGROS", "Migros", "Sepet büyüklüğü ve müşteri trafiği talep göstergesiyle hareket eder", "Basket size and footfall move with demand"),
    link!("SOKM", "Şok Marketler", "İndirim perakendesi talep daralmasında öne çıkar", "Discount retail leads when demand contracts"),
    link!("ARCLK", "Arçelik", "Dayanıklı tüketim harcaması ertelenebilir kalemdir", "Durable goods spending is deferrable"),
];

/// Türkiye'ye toplu bakan dünya enstrümanları.
const TURKEY_PROXIES: &[LinkSpec] = &[
    link!("TUR", "iShares MSCI Turkey ETF", "BIST'e yurt dışından bakan fon; makro veri akışıyla fiyatlanır", "Foreign-listed fund tracking BIST; prices off the macro flow"),
    link!("USDTRY=X", "Dolar/TL", "Makro veri TL'nin seyrini doğrudan etkiler", "Macro data feeds straight into the lira"),
];

/* ── Kategori tablosu ─────────────────────────────────────────────────────── */

/// TradingEconomics `data-category` → piyasa profili.
///
/// Anahtarlar kaynağın kendi kategori sözlüğünden alındı (ölçüm: 2026-08-14,
/// Türkiye takvimi); `calendar_news::TOPICS` ile aynı anahtar kümesidir.
const PROFILES: &[(&str, Profile)] = &[
    ("interest rate", Profile {
        channel: Text {
            tr: "Politika faizi bankaların kredi-mevduat makasını, borçlu şirketlerin finansman maliyetini ve TL'nin seyrini aynı anda fiyatlar.",
            en: "The policy rate simultaneously prices bank spreads, the funding cost of leveraged companies and the lira.",
        },
        bist: BANKS,
        global: TURKEY_PROXIES,
        report_terms: &["faiz", "ppk", "para politikası", "policy rate", "interest rate"],
    }),
    ("lending rate", Profile {
        channel: Text {
            tr: "Borç verme faizi bankaların fonlama maliyetinin üst bandını belirler.",
            en: "The lending rate sets the ceiling of bank funding costs.",
        },
        bist: BANKS,
        global: TURKEY_PROXIES,
        report_terms: &["faiz", "ppk", "para politikası", "policy rate"],
    }),
    ("deposit interest rate", Profile {
        channel: Text {
            tr: "Mevduat faizi bankaların fonlama maliyetini ve hane halkının TL'de kalma tercihini belirler.",
            en: "Deposit rates set bank funding costs and how willingly households stay in lira.",
        },
        bist: BANKS,
        global: TURKEY_PROXIES,
        report_terms: &["mevduat", "faiz", "deposit rate"],
    }),
    ("inflation rate", Profile {
        channel: Text {
            tr: "Enflasyon hem TCMB'nin faiz patikasını hem şirketlerin fiyatlama gücünü belirler; enflasyon muhasebesi bilançoları doğrudan etkiler.",
            en: "Inflation drives both the central bank's rate path and corporate pricing power; inflation accounting hits the balance sheet directly.",
        },
        bist: &[
            link!("GARAN", "Garanti BBVA", "TÜFE'ye endeksli tahvil getirisi enflasyonla birlikte hareket eder", "CPI-linked bond income moves with inflation"),
            link!("AKBNK", "Akbank", "TÜFE'ye endeksli portföy ve faiz beklentisi", "CPI-linked portfolio and rate expectations"),
            link!("BIMAS", "BİM", "Gıda enflasyonu ciroyu büyütür, marjı sıkıştırır", "Food inflation lifts revenue, squeezes margin"),
            link!("MGROS", "Migros", "Raf fiyatlarıyla enflasyon aynı yönde ilerler", "Shelf prices move with inflation"),
            link!("TCELL", "Turkcell", "Tarife zamları enflasyon patikasına bağlı", "Tariff hikes follow the inflation path"),
        ],
        global: TURKEY_PROXIES,
        report_terms: &["enflasyon", "tüfe", "inflation", "cpi"],
    }),
    ("inflation rate mom", Profile {
        channel: Text {
            tr: "Aylık enflasyon, yıllık patikanın ve faiz beklentisinin en taze göstergesidir.",
            en: "Monthly inflation is the freshest read on the annual path and on rate expectations.",
        },
        bist: BANKS,
        global: TURKEY_PROXIES,
        report_terms: &["enflasyon", "tüfe", "inflation", "cpi"],
    }),
    ("core inflation rate", Profile {
        channel: Text {
            tr: "Çekirdek enflasyon geçici kalemlerden arındırıldığı için TCMB'nin asıl baktığı ölçüttür.",
            en: "Core inflation strips out volatile items, so it is what the central bank actually watches.",
        },
        bist: BANKS,
        global: TURKEY_PROXIES,
        report_terms: &["çekirdek enflasyon", "core inflation"],
    }),
    ("core inflation rate mom", Profile {
        channel: Text {
            tr: "Aylık çekirdek enflasyon, ana eğilimin dönüp dönmediğini ilk gösteren veridir.",
            en: "Monthly core inflation is the first sign of whether the underlying trend has turned.",
        },
        bist: BANKS,
        global: TURKEY_PROXIES,
        report_terms: &["çekirdek enflasyon", "core inflation"],
    }),
    ("producer prices change", Profile {
        channel: Text {
            tr: "Üretici fiyatları sanayinin girdi maliyetidir; tüketici enflasyonuna gecikmeli geçer ve marjları önce burada sıkıştırır.",
            en: "Producer prices are industry's input cost; they pass through to consumer inflation with a lag and squeeze margins here first.",
        },
        bist: &[
            link!("EREGL", "Ereğli Demir Çelik", "Cevher ve enerji maliyeti doğrudan ÜFE kalemidir", "Ore and energy costs are PPI line items"),
            link!("KRDMD", "Kardemir", "Girdi maliyeti ve yurt içi çelik fiyatı", "Input cost and domestic steel pricing"),
            link!("ARCLK", "Arçelik", "Hammadde maliyeti marjı belirler", "Raw material cost sets the margin"),
            link!("VESTL", "Vestel", "Panel ve bileşen maliyeti ÜFE ile hareket eder", "Panel and component costs move with PPI"),
            link!("SASA", "Sasa Polyester", "Petrokimya girdisi ÜFE'ye duyarlı", "Petrochemical inputs are PPI-sensitive"),
        ],
        global: &[
            link!("BZ=F", "Brent Petrol", "Enerji girdisi ÜFE'nin en oynak kalemi", "Energy is the most volatile PPI component"),
            link!("HG=F", "Bakır", "Sanayi metali maliyeti üretici fiyatlarını çeker", "Industrial metal costs pull producer prices"),
        ],
        report_terms: &["üfe", "üretici fiyat", "producer price", "ppi"],
    }),
    ("producer price inflation mom", Profile {
        channel: Text {
            tr: "Aylık ÜFE, maliyet baskısının hangi hızla arttığını gösterir.",
            en: "Monthly PPI shows how fast cost pressure is building.",
        },
        bist: &[
            link!("EREGL", "Ereğli Demir Çelik", "Girdi maliyeti marjın ana belirleyicisi", "Input cost is the main margin driver"),
            link!("ARCLK", "Arçelik", "Hammadde maliyeti marjı belirler", "Raw material cost sets the margin"),
            link!("SASA", "Sasa Polyester", "Petrokimya girdisi ÜFE'ye duyarlı", "Petrochemical inputs are PPI-sensitive"),
        ],
        global: &[
            link!("BZ=F", "Brent Petrol", "Enerji girdisi ÜFE'nin en oynak kalemi", "Energy is the most volatile PPI component"),
        ],
        report_terms: &["üfe", "üretici fiyat", "producer price", "ppi"],
    }),
    ("gdp growth rate", Profile {
        channel: Text {
            tr: "Çeyreklik büyüme, iç talebin hızını ve şirket kârlarının makro zeminini verir.",
            en: "Quarterly growth sets the pace of domestic demand and the macro floor under company earnings.",
        },
        bist: &[
            link!("KCHOL", "Koç Holding", "Portföyü ekonominin geneline yayılı", "Portfolio spans the whole economy"),
            link!("SAHOL", "Sabancı Holding", "Banka ve sanayi karışımı büyümeye duyarlı", "Bank and industry mix is growth-sensitive"),
            link!("GARAN", "Garanti BBVA", "Kredi talebi büyümeyle birlikte hareket eder", "Loan demand moves with growth"),
            link!("THYAO", "Türk Hava Yolları", "Yolcu ve kargo talebi ekonomik döngüyle hareket eder", "Passenger and cargo demand follow the cycle"),
        ],
        global: TURKEY_PROXIES,
        report_terms: &["gsyh", "gsyih", "gdp", "büyüme oranı", "milli gelir"],
    }),
    ("gdp annual growth rate", Profile {
        channel: Text {
            tr: "Yıllık büyüme, yabancı yatırımcının ülke tahsisinde baktığı ana ölçüttür.",
            en: "Annual growth is the headline foreign investors use for country allocation.",
        },
        bist: &[
            link!("KCHOL", "Koç Holding", "Portföyü ekonominin geneline yayılı", "Portfolio spans the whole economy"),
            link!("SAHOL", "Sabancı Holding", "Banka ve sanayi karışımı büyümeye duyarlı", "Bank and industry mix is growth-sensitive"),
            link!("ISCTR", "İş Bankası", "Kredi hacmi büyüme patikasına bağlı", "Loan volume follows the growth path"),
        ],
        global: TURKEY_PROXIES,
        report_terms: &["gsyh", "gsyih", "gdp", "büyüme oranı", "milli gelir"],
    }),
    ("unemployment rate", Profile {
        channel: Text {
            tr: "İşsizlik hem hane halkı gelirinin hem işgücü maliyetinin göstergesidir: talep tarafını ve marjı ters yönlerden etkiler.",
            en: "Unemployment reads both household income and labour cost: it hits demand and margins from opposite directions.",
        },
        bist: CONSUMER,
        global: &[TURKEY_PROXIES[0]],
        report_terms: &["işsizlik", "işgücü", "unemployment"],
    }),
    ("labor force participation rate", Profile {
        channel: Text {
            tr: "İşgücüne katılım, istihdam verisinin arka planıdır: katılım artarken işsizliğin sabit kalması talep açısından olumlu okunur.",
            en: "Participation is the backdrop to the jobs data: steady unemployment with rising participation reads better for demand.",
        },
        bist: CONSUMER,
        global: &[TURKEY_PROXIES[0]],
        report_terms: &["işgücü", "istihdam", "labor force"],
    }),
    ("current account", Profile {
        channel: Text {
            tr: "Cari denge Türkiye'nin dış finansman ihtiyacını ölçer; açığın ana kalemi enerji faturası, kapatan kalem turizm geliridir.",
            en: "The current account measures Turkey's external financing need: energy imports drive the deficit, tourism revenue offsets it.",
        },
        bist: &[
            link!("TUPRS", "Tüpraş", "Ham petrol ithalatı açığın en büyük kalemi", "Crude imports are the largest deficit item"),
            link!("THYAO", "Türk Hava Yolları", "Döviz geliri açığı kapatan kalemde", "FX revenue sits on the offsetting side"),
            link!("PGSUS", "Pegasus", "Dış hat yolcusu turizm gelirinin parçası", "International traffic feeds tourism revenue"),
            link!("TAVHL", "TAV Havalimanları", "Yolcu geliri döviz cinsinden", "Passenger revenue is FX-denominated"),
        ],
        global: &[
            link!("BZ=F", "Brent Petrol", "Enerji faturası cari açığın ana belirleyicisi", "The energy bill drives the deficit"),
            link!("GC=F", "Altın Ons", "Altın ithalatı açığın oynak kalemi", "Gold imports are a volatile deficit item"),
            link!("USDTRY=X", "Dolar/TL", "Dış finansman ihtiyacı kurda fiyatlanır", "External financing need prices into the lira"),
        ],
        report_terms: &["cari işlemler", "cari açık", "cari denge", "current account"],
    }),
    ("balance of trade", Profile {
        channel: Text {
            tr: "Dış ticaret dengesi ihracatçı sanayiyi ve enerji ithalatçısını aynı satırda buluşturur.",
            en: "The trade balance puts exporting industry and energy importers on the same line.",
        },
        bist: &[
            link!("FROTO", "Ford Otosan", "Üretiminin büyük bölümü ihracata gider", "Most of its output is exported"),
            link!("TOASO", "Tofaş", "Avrupa'ya araç ihracatı", "Vehicle exports to Europe"),
            link!("EREGL", "Ereğli Demir Çelik", "Çelik ihracatı ve ithal cevher aynı satırda", "Steel exports and imported ore both land here"),
            link!("ARCLK", "Arçelik", "Beyaz eşya ihracatı ciro payı yüksek", "White goods exports are a large revenue share"),
            link!("TUPRS", "Tüpraş", "Ham petrol ithalatı ithalat kaleminin başında", "Crude imports lead the import side"),
        ],
        global: &[
            link!("EURTRY=X", "Euro/TL", "İhracatın ana para birimi", "The main export currency"),
            link!("^GDAXI", "DAX", "En büyük ihracat pazarının sanayi barometresi", "Industrial barometer of the largest export market"),
        ],
        report_terms: &["dış ticaret", "ticaret dengesi", "trade balance"],
    }),
    ("exports", Profile {
        channel: Text {
            tr: "İhracat, döviz geliri olan sanayicinin ciro göstergesidir; Avrupa talebine bağlıdır.",
            en: "Exports are the revenue gauge for FX-earning industry, and they hang on European demand.",
        },
        bist: &[
            link!("FROTO", "Ford Otosan", "Ticari araç ihracatında ana oyuncu", "Lead player in commercial vehicle exports"),
            link!("TOASO", "Tofaş", "Avrupa'ya araç ihracatı", "Vehicle exports to Europe"),
            link!("ARCLK", "Arçelik", "Beyaz eşya ihracatı ciro payı yüksek", "White goods exports are a large revenue share"),
            link!("VESTL", "Vestel", "Televizyon ve beyaz eşya ihracatı", "TV and white goods exports"),
            link!("EREGL", "Ereğli Demir Çelik", "Çelik ihracatı fiyat ve hacimle dalgalanır", "Steel exports swing with price and volume"),
        ],
        global: &[
            link!("EURTRY=X", "Euro/TL", "İhracatın ana para birimi", "The main export currency"),
            link!("^GDAXI", "DAX", "En büyük ihracat pazarının sanayi barometresi", "Industrial barometer of the largest export market"),
        ],
        report_terms: &["ihracat", "export"],
    }),
    ("imports", Profile {
        channel: Text {
            tr: "İthalat hem iç talebin gücünü hem enerji faturasını gösterir.",
            en: "Imports show both the strength of domestic demand and the energy bill.",
        },
        bist: &[
            link!("TUPRS", "Tüpraş", "Ham petrol ithalatı ithalatın en büyük kalemi", "Crude is the largest import item"),
            link!("DOAS", "Doğuş Otomotiv", "İthal araç satışı doğrudan ithalat kalemi", "Imported vehicle sales are an import line"),
            link!("AYGAZ", "Aygaz", "LPG ithalatı maliyet tarafında", "LPG imports sit on the cost side"),
            link!("ARCLK", "Arçelik", "İthal bileşen maliyeti", "Imported component costs"),
        ],
        global: &[
            link!("BZ=F", "Brent Petrol", "Enerji ithalatının fiyat çıpası", "Price anchor of energy imports"),
            link!("USDTRY=X", "Dolar/TL", "İthalat faturası dolar cinsinden", "The import bill is dollar-denominated"),
        ],
        report_terms: &["ithalat", "import"],
    }),
    ("industrial production", Profile {
        channel: Text {
            tr: "Sanayi üretimi, üretim hacmine bağlı şirketlerin ciro göstergesidir; kapasite kullanımıyla birlikte okunur.",
            en: "Industrial production is the revenue gauge for volume-driven companies; read it next to capacity utilisation.",
        },
        bist: &[
            link!("EREGL", "Ereğli Demir Çelik", "Yurt içi çelik talebi üretim hacmine bağlı", "Domestic steel demand tracks output"),
            link!("KRDMD", "Kardemir", "Uzun ürün talebi sanayi ve inşaattan gelir", "Long-product demand comes from industry and construction"),
            link!("SISE", "Şişecam", "Cam talebi sanayi ve inşaat döngüsüyle hareket eder", "Glass demand follows the industry cycle"),
            link!("TOASO", "Tofaş", "Üretim hattı kapasitesi doğrudan bu veride", "Assembly capacity shows up directly in this data"),
            link!("FROTO", "Ford Otosan", "Üretim hacmi sanayi endeksinin ağır kalemi", "Output is a heavy component of the index"),
        ],
        global: &[
            link!("HG=F", "Bakır", "Küresel sanayi döngüsünün öncü göstergesi", "Leading gauge of the global industrial cycle"),
            link!("^GDAXI", "DAX", "Avrupa sanayi talebinin göstergesi", "Gauge of European industrial demand"),
        ],
        report_terms: &["sanayi üretim", "industrial production"],
    }),
    ("industrial production mom", Profile {
        channel: Text {
            tr: "Aylık sanayi üretimi, çeyrek büyümesinin en erken sinyalidir.",
            en: "Monthly industrial production is the earliest signal for quarterly growth.",
        },
        bist: &[
            link!("EREGL", "Ereğli Demir Çelik", "Yurt içi çelik talebi üretim hacmine bağlı", "Domestic steel demand tracks output"),
            link!("SISE", "Şişecam", "Cam talebi sanayi döngüsüyle hareket eder", "Glass demand follows the industry cycle"),
            link!("TOASO", "Tofaş", "Üretim hattı kapasitesi doğrudan bu veride", "Assembly capacity shows up directly in this data"),
        ],
        global: &[
            link!("HG=F", "Bakır", "Küresel sanayi döngüsünün öncü göstergesi", "Leading gauge of the global industrial cycle"),
        ],
        report_terms: &["sanayi üretim", "industrial production"],
    }),
    ("manufacturing pmi", Profile {
        channel: Text {
            tr: "PMI, satın alma yöneticilerinin anketidir: sanayi üretiminden önce gelen öncü göstergedir.",
            en: "PMI is a purchasing managers' survey — it leads the hard industrial production data.",
        },
        bist: &[
            link!("EREGL", "Ereğli Demir Çelik", "Yeni sipariş beklentisi çelik talebini önceler", "New orders lead steel demand"),
            link!("TOASO", "Tofaş", "İmalat siparişleri üretim planına yansır", "Manufacturing orders feed the production plan"),
            link!("ARCLK", "Arçelik", "İmalat döngüsü ciro beklentisini belirler", "The manufacturing cycle sets the revenue outlook"),
            link!("SISE", "Şişecam", "Sanayi talebi cam hacmine yansır", "Industrial demand shows in glass volumes"),
        ],
        global: &[
            link!("HG=F", "Bakır", "Küresel imalat döngüsünün fiyat göstergesi", "Price gauge of the global manufacturing cycle"),
            link!("^GDAXI", "DAX", "Avrupa imalat talebinin göstergesi", "Gauge of European manufacturing demand"),
        ],
        report_terms: &["pmi", "imalat sanayi"],
    }),
    ("capacity utilization", Profile {
        channel: Text {
            tr: "Kapasite kullanımı, mevcut fabrikaların ne kadarının çalıştığını gösterir: yatırım iştahının ve marjın ön göstergesidir.",
            en: "Capacity utilisation shows how much of existing plant is running — a lead indicator for investment appetite and margins.",
        },
        bist: &[
            link!("EREGL", "Ereğli Demir Çelik", "Yüksek kapasite sabit maliyeti seyreltir", "High utilisation dilutes fixed costs"),
            link!("SISE", "Şişecam", "Fırın kapasitesi kullanımı marjın belirleyicisi", "Furnace utilisation drives the margin"),
            link!("AKCNS", "Akçansa", "Çimento kapasitesi bölgesel talebe bağlı", "Cement capacity follows regional demand"),
            link!("TOASO", "Tofaş", "Hat kapasitesi kullanımı birim maliyeti belirler", "Line utilisation sets unit cost"),
            link!("ARCLK", "Arçelik", "Fabrika doluluğu marja doğrudan geçer", "Plant loading passes straight into the margin"),
        ],
        global: &[
            link!("HG=F", "Bakır", "Sanayi faaliyetinin küresel fiyat göstergesi", "Global price gauge of industrial activity"),
        ],
        report_terms: &["kapasite kullanım", "capacity utilization"],
    }),
    ("business confidence", Profile {
        channel: Text {
            tr: "Reel kesim güveni, sanayicinin sipariş ve yatırım beklentisini ölçer: sert verilerden önce döner.",
            en: "Business confidence measures order and investment expectations — it turns before the hard data.",
        },
        bist: &[
            link!("KCHOL", "Koç Holding", "Sanayi portföyü yatırım iştahına duyarlı", "Industrial portfolio is sensitive to investment appetite"),
            link!("EREGL", "Ereğli Demir Çelik", "Sipariş beklentisi çelik talebini önceler", "Order expectations lead steel demand"),
            link!("TKFEN", "Tekfen Holding", "Taahhüt ve yatırım döngüsüne bağlı", "Tied to the contracting and investment cycle"),
            link!("ENKAI", "Enka İnşaat", "Yatırım harcaması taahhüt hacmini belirler", "Capex sets contracting volume"),
        ],
        global: &[link!("^GDAXI", "DAX", "Avrupa sanayi beklentisiyle birlikte okunur", "Read alongside European industrial expectations")],
        report_terms: &["reel kesim", "güven endeksi", "business confidence"],
    }),
    ("consumer confidence", Profile {
        channel: Text {
            tr: "Tüketici güveni, hane halkının harcama ve büyük alım niyetini ölçer: perakende ve dayanıklı tüketimin öncüsüdür.",
            en: "Consumer confidence measures spending and big-ticket intent — the lead for retail and durables.",
        },
        bist: &[
            CONSUMER[0],
            CONSUMER[1],
            CONSUMER[3],
            link!("DOAS", "Doğuş Otomotiv", "Otomobil büyük alım kararıdır, güvenle birlikte hareket eder", "Cars are a big-ticket decision that tracks confidence"),
            link!("EKGYO", "Emlak Konut GYO", "Konut alım niyeti güven endeksiyle hareket eder", "Home-buying intent moves with confidence"),
        ],
        global: &[TURKEY_PROXIES[0]],
        report_terms: &["tüketici güven", "consumer confidence"],
    }),
    ("economic optimism index", Profile {
        channel: Text {
            tr: "Ekonomik güven endeksi, tüketici ve reel kesim anketlerinin bileşimidir: geniş talep göstergesi.",
            en: "The economic confidence index combines consumer and business surveys — a broad demand gauge.",
        },
        bist: CONSUMER,
        global: &[TURKEY_PROXIES[0]],
        report_terms: &["ekonomik güven", "economic confidence"],
    }),
    ("retail sales yoy", Profile {
        channel: Text {
            tr: "Perakende satış hacmi, iç talebin enflasyondan arındırılmış ölçüsüdür.",
            en: "Retail sales volume is the inflation-adjusted read on domestic demand.",
        },
        bist: &[
            CONSUMER[0],
            CONSUMER[1],
            CONSUMER[2],
            link!("MAVI", "Mavi Giyim", "Hazır giyim talebi harcanabilir gelire duyarlı", "Apparel demand is sensitive to disposable income"),
            link!("BIZIM", "Bizim Toptan", "Toptan hacim perakende döngüsünü izler", "Wholesale volume follows the retail cycle"),
        ],
        global: &[TURKEY_PROXIES[0]],
        report_terms: &["perakende", "retail sales"],
    }),
    ("retail sales mom", Profile {
        channel: Text {
            tr: "Aylık perakende satış, talepteki dönüşü ilk gösteren veridir.",
            en: "Monthly retail sales are the first to show a turn in demand.",
        },
        bist: &[CONSUMER[0], CONSUMER[1], CONSUMER[2], CONSUMER[3]],
        global: &[TURKEY_PROXIES[0]],
        report_terms: &["perakende", "retail sales"],
    }),
    ("foreign exchange reserves", Profile {
        channel: Text {
            tr: "Rezervler TCMB'nin kura müdahale ve dış borç ödeme kapasitesini gösterir; ülke risk primiyle birlikte okunur.",
            en: "Reserves show the central bank's capacity to defend the lira and service external debt; read with the country risk premium.",
        },
        bist: &[
            link!("GARAN", "Garanti BBVA", "Ülke risk primi bankaların fonlama maliyetine geçer", "Country risk feeds bank funding costs"),
            link!("AKBNK", "Akbank", "Dış borçlanma maliyeti rezerv görünümüne bağlı", "External borrowing cost tracks the reserve picture"),
            link!("TSKB", "TSKB", "Kalkınma finansmanı dış kaynak maliyetine duyarlı", "Development finance is sensitive to external funding costs"),
        ],
        global: &[
            link!("USDTRY=X", "Dolar/TL", "Rezerv seviyesi kur beklentisinin ana girdisi", "Reserve levels are the main input to lira expectations"),
            link!("GC=F", "Altın Ons", "Rezervlerin altın kalemi ons fiyatıyla değerlenir", "The gold leg of reserves is valued off the ounce price"),
        ],
        report_terms: &["rezerv", "reserves"],
    }),
    ("government budget value", Profile {
        channel: Text {
            tr: "Bütçe dengesi Hazine'nin borçlanma ihtiyacını belirler; tahvil faizi ve banka portföyleri buradan etkilenir.",
            en: "The budget balance sets the Treasury's borrowing need, which feeds bond yields and bank portfolios.",
        },
        bist: &[
            link!("GARAN", "Garanti BBVA", "Tahvil portföyü Hazine arzına duyarlı", "Bond book is sensitive to Treasury supply"),
            link!("AKBNK", "Akbank", "Menkul kıymet portföyü faiz seviyesine bağlı", "Securities book tracks the yield level"),
            link!("VAKBN", "VakıfBank", "Kamu kâğıdı ağırlığı yüksek", "Heavy weighting in government paper"),
            link!("HALKB", "Halkbank", "Kamu kâğıdı ve kamu destekli kredi hacmi", "Government paper and state-backed lending"),
        ],
        global: &[TURKEY_PROXIES[1], TURKEY_PROXIES[0]],
        report_terms: &["bütçe", "budget"],
    }),
    ("government debt", Profile {
        channel: Text {
            tr: "Borç stoku, kamunun borçlanma patikasını ve tahvil arzını gösterir.",
            en: "The debt stock shows the state's borrowing path and bond supply.",
        },
        bist: &[
            link!("GARAN", "Garanti BBVA", "Tahvil arzı portföy getirisini belirler", "Bond supply sets portfolio yield"),
            link!("AKBNK", "Akbank", "Menkul kıymet portföyü faiz seviyesine bağlı", "Securities book tracks the yield level"),
            link!("TSKB", "TSKB", "Kamu borçlanma maliyeti kaynak maliyetine geçer", "Sovereign cost passes into funding cost"),
        ],
        global: &[TURKEY_PROXIES[1], TURKEY_PROXIES[0]],
        report_terms: &["kamu borcu", "borç stoku", "government debt"],
    }),
    ("treasury cash balance", Profile {
        channel: Text {
            tr: "Hazine nakit dengesi, bütçe verisinden önce gelen aylık nakit görüntüsüdür.",
            en: "The Treasury cash balance is the monthly cash picture that arrives before the budget data.",
        },
        bist: &[
            link!("GARAN", "Garanti BBVA", "Hazine nakit ihtiyacı tahvil arzını belirler", "Treasury cash needs set bond supply"),
            link!("VAKBN", "VakıfBank", "Kamu kâğıdı ağırlığı yüksek", "Heavy weighting in government paper"),
        ],
        global: &[TURKEY_PROXIES[1]],
        report_terms: &["hazine nakit", "nakit denge", "treasury cash"],
    }),
    ("car production", Profile {
        channel: Text {
            tr: "Otomobil üretimi hem üreticinin hacmini hem yan sanayinin siparişini ölçer; üretimin büyük bölümü ihracata gittiği için Avrupa talebine bağlıdır.",
            en: "Car production measures both assembler volumes and supplier orders; since most output is exported, it hangs on European demand.",
        },
        bist: &[
            link!("FROTO", "Ford Otosan", "Türkiye'nin en büyük ticari araç üreticisi", "Turkey's largest commercial vehicle producer"),
            link!("TOASO", "Tofaş", "Bursa hattının üretim hacmi doğrudan bu veride", "Bursa line output shows up directly in this data"),
            link!("TTRAK", "Türk Traktör", "Traktör üretimi aynı sanayi hattında ölçülür", "Tractor output is measured in the same industry series"),
            link!("OTKAR", "Otokar", "Otobüs ve askeri araç üretim hacmi", "Bus and defence vehicle output"),
            link!("KARSN", "Karsan", "Sözleşmeli üretim hacmine bağlı", "Depends on contract manufacturing volume"),
            link!("ASUZU", "Anadolu Isuzu", "Ticari araç üretim hattı", "Commercial vehicle line"),
            link!("EGEEN", "Ege Endüstri", "Yan sanayi siparişi üretim hacmini izler", "Supplier orders follow assembler volume"),
        ],
        global: &[
            link!("F", "Ford Motor", "Ford Otosan'ın ortağı; Türkiye hattı Avrupa ticari araç arzının parçası", "Ford Otosan's partner; the Turkish line feeds European commercial vehicle supply"),
            link!("STLA", "Stellantis", "Tofaş'ın ortağı ve ana ihracat müşterisi", "Tofaş's partner and main export customer"),
            link!("TM", "Toyota Motor", "Sakarya fabrikası Türkiye üretiminin büyük kalemi", "The Sakarya plant is a large share of Turkish output"),
            link!("^GDAXI", "DAX", "Avrupa otomotiv talebinin barometresi", "Barometer of European auto demand"),
        ],
        report_terms: &["otomotiv", "otomobil", "araç üretim", "auto production", "car production"],
    }),
    ("total vehicle sales", Profile {
        channel: Text {
            tr: "İç pazar araç satışı kredi koşullarına ve tüketici güvenine bağlıdır; ithalatçı-distribütörü üreticiden daha çok etkiler.",
            en: "Domestic vehicle sales hang on credit conditions and consumer confidence, and hit importer-distributors harder than producers.",
        },
        bist: &[
            link!("DOAS", "Doğuş Otomotiv", "İç pazar satışına en açık şirket: ithalatçı-distribütör", "Most exposed to the domestic market as importer-distributor"),
            link!("FROTO", "Ford Otosan", "İç pazar payı ciro karışımını belirler", "Domestic share shapes the revenue mix"),
            link!("TOASO", "Tofaş", "Yurt içi satış hacmi marj karışımını etkiler", "Domestic volume shifts the margin mix"),
            link!("ASUZU", "Anadolu Isuzu", "Ticari araç iç pazarına bağlı", "Tied to the domestic commercial vehicle market"),
            link!("BRISA", "Brisa", "Araç parkı ve ilk montaj lastik talebi", "Vehicle park and OEM tyre demand"),
        ],
        global: &[
            link!("VOW3.DE", "Volkswagen", "Doğuş Otomotiv'in dağıttığı markaların üreticisi", "Maker of the brands Doğuş Otomotiv distributes"),
            link!("STLA", "Stellantis", "Tofaş'ın ortağı, iç pazarda da marka sahibi", "Tofaş's partner and a domestic brand owner"),
            link!("F", "Ford Motor", "Ford Otosan'ın ortağı", "Ford Otosan's partner"),
        ],
        report_terms: &["otomotiv", "otomobil", "araç sat", "vehicle sales"],
    }),
    ("tourist arrivals", Profile {
        channel: Text {
            tr: "Turist girişi, döviz geliri yaratan turizm zincirinin hacim göstergesidir: havayolu, havalimanı ve konaklama aynı veriyi izler.",
            en: "Tourist arrivals are the volume gauge of the FX-earning tourism chain: airlines, airports and hospitality all watch it.",
        },
        bist: &[
            link!("THYAO", "Türk Hava Yolları", "Dış hat yolcu sayısı doğrudan bu veriyle hareket eder", "International passenger counts move with this data"),
            link!("PGSUS", "Pegasus", "Dış hat kapasitesi turist talebine bağlı", "International capacity follows tourist demand"),
            link!("TAVHL", "TAV Havalimanları", "Yolcu başına gelir modeli", "Revenue per passenger model"),
            link!("CLEBI", "Çelebi Hava Servisi", "Yer hizmeti hacmi uçuş sayısına bağlı", "Ground handling volume tracks flight counts"),
            link!("MAALT", "Marmaris Altınyunus", "Konaklama doluluğu sezon girişlerine bağlı", "Occupancy tracks seasonal arrivals"),
        ],
        global: &[TURKEY_PROXIES[0]],
        report_terms: &["turist", "turizm geliri", "turizm sektör", "konaklama", "tourism"],
    }),
    ("tourism revenues", Profile {
        channel: Text {
            tr: "Turizm geliri cari açığı kapatan ana döviz kalemidir; kişi başı harcamayı da içerdiği için giriş sayısından daha bilgilidir.",
            en: "Tourism revenue is the main FX item offsetting the current account deficit, and it captures per-visitor spend, not just headcount.",
        },
        bist: &[
            link!("THYAO", "Türk Hava Yolları", "Döviz geliri turizm hacmine bağlı", "FX revenue follows tourism volume"),
            link!("TAVHL", "TAV Havalimanları", "Yolcu geliri döviz cinsinden", "Passenger revenue is FX-denominated"),
            link!("PGSUS", "Pegasus", "Dış hat bileti döviz geliri", "International tickets earn FX"),
            link!("MAALT", "Marmaris Altınyunus", "Konaklama geliri turizm harcamasına bağlı", "Lodging revenue tracks tourism spend"),
        ],
        global: &[TURKEY_PROXIES[0]],
        report_terms: &["turist", "turizm geliri", "turizm sektör", "konaklama", "tourism"],
    }),
];

fn profile_for(category: &str) -> Option<&'static Profile> {
    let key = category.trim().to_lowercase();
    PROFILES.iter().find(|(name, _)| *name == key).map(|(_, profile)| profile)
}

/* ── Dış dünyaya açılan kayıtlar ──────────────────────────────────────────── */

/// Takvim satırına etiketlenen tek bir enstrüman.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ImpactLink {
    /// BIST kodu ya da sağlayıcı sembolü. Arayüz bunu tanıyabildiğinde
    /// tıklanabilir yapar, tanımadığında düz etiket olarak gösterir.
    pub symbol: String,
    pub name: String,
    /// Bu satırla ilişkisinin gerekçesi. Yön değil, kanal anlatır.
    pub why: String,
}

/// Takvim satırının piyasa karşılığı.
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct CalendarImpact {
    /// Verinin piyasaya hangi yoldan geçtiğini anlatan tek cümle. Profil
    /// bulunamadıysa boş — arayüz bölümü hiç göstermez.
    pub channel: String,
    pub bist: Vec<ImpactLink>,
    pub global: Vec<ImpactLink>,
    /// Konuyla ya da etiketlenen paylarla ilgili yakın tarihli raporlar.
    pub reports: Vec<AnalystReport>,
    /// Rapor arşivi kurulmuş mu? Boş liste iki farklı şey demek olabiliyor:
    /// "bu konuda rapor yok" ile "arşiv henüz indirilmedi". Arayüz ikisini
    /// ayırmadan doğru bir şey söyleyemez.
    pub archive_ready: bool,
}

fn links(specs: &'static [LinkSpec], lang: &str) -> Vec<ImpactLink> {
    specs
        .iter()
        .map(|spec| ImpactLink {
            symbol: spec.symbol.to_string(),
            name: spec.name.to_string(),
            why: spec.why.pick(lang),
        })
        .collect()
}

/// Başlık her gün çıkan bir yayına mı ait?
fn is_generic(title_key: &str) -> bool {
    GENERIC_TITLES.iter().any(|marker| title_key.contains(&crate::calendar_news::fingerprint(marker)))
}

/// `haystack` içinde `term` bir SÖZCÜĞÜN BAŞINDAN itibaren geçiyor mu?
///
/// Düz `contains` kısa terimlerde yanlış eşleşiyor: "tüfe" içinde "üfe" geçtiği
/// için tüketici enflasyonu raporu üretici fiyatları satırına düşüyordu
/// (ölçüldü: "Aylık TÜFE Verileri İncelemesi"). Terimin SOLU harf/rakam
/// olmamalı.
///
/// Sağ uç bilerek serbest: terimler Türkçe ekleri yakalasın diye gövde olarak
/// yazılıyor ("sanayi üretim" → "Sanayi Üretimi"). Sağa da sınır koymak bu
/// eşlemelerin hepsini bozardı.
fn word_starts_with_term(haystack: &str, term: &str) -> bool {
    if term.is_empty() {
        return false;
    }
    haystack.match_indices(term).any(|(index, _)| {
        haystack[..index].chars().next_back().is_none_or(|c| !c.is_alphanumeric())
    })
}

/// Arşivden satırla ilgili raporları seçer.
///
/// İki yol var: (1) rapor BAŞLIĞI konunun terimini taşıyor — kurumun o veriye
/// ayırdığı makro not; (2) rapor etiketlenen paylardan birini konu alıyor —
/// şirket araştırması. Birincisi önce sıralanır: takvim satırının doğrudan
/// karşılığı odur.
///
/// Ayrı ve saf fonksiyon: ağ ya da diske dokunmadan sınanabilsin.
fn pick_reports(
    archive: &ReportArchive,
    tickers: &[String],
    terms: &[&str],
    today: chrono::NaiveDate,
) -> Vec<AnalystReport> {
    let cutoff = (today - chrono::Duration::days(REPORT_WINDOW_DAYS)).to_string();
    let term_keys: Vec<String> = terms.iter().map(|term| crate::calendar_news::fingerprint(term)).collect();

    let mut scored: Vec<(u8, i64, AnalystReport)> = Vec::new();
    for report in &archive.reports {
        if report.published < cutoff {
            continue;
        }
        let title_key = crate::calendar_news::fingerprint(&report.title);
        if is_generic(&title_key) {
            continue;
        }

        let on_topic = term_keys.iter().any(|term| word_starts_with_term(&title_key, term));
        let on_ticker = report.tickers.iter().any(|code| tickers.iter().any(|wanted| wanted == code));
        if !on_topic && !on_ticker {
            continue;
        }

        // 0 = konunun kendi raporu, 1 = etiketlenen payın raporu.
        scored.push((u8::from(!on_topic), report.published_ts, report.clone()));
    }

    scored.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| b.1.cmp(&a.1)));
    scored.into_iter().take(MAX_REPORTS).map(|(_, _, report)| report).collect()
}

/// Takvim satırının piyasa karşılığını kurar.
///
/// Arşiv çağıran tarafından verilir: disk okuması burada değil, komut
/// katmanında yapılır ki fonksiyon sınanabilir kalsın.
pub fn build(
    category: &str,
    lang: &str,
    archive: &ReportArchive,
    today: chrono::NaiveDate,
) -> CalendarImpact {
    let archive_ready = !archive.reports.is_empty();
    let Some(profile) = profile_for(category) else {
        // Sözlükte olmayan kategori: uydurma bir eşleme göstermektense hiç
        // gösterme. Arayüz boş kanalda bölümü çizmez.
        return CalendarImpact { archive_ready, ..Default::default() };
    };

    let bist = links(profile.bist, lang);
    let codes: Vec<String> = bist.iter().map(|link| link.symbol.clone()).collect();

    CalendarImpact {
        channel: profile.channel.pick(lang),
        reports: pick_reports(archive, &codes, profile.report_terms, today),
        bist,
        global: links(profile.global, lang),
        archive_ready,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::research_reports::{BrokerScope, ReportKind};

    fn report(title: &str, published: &str, tickers: &[&str]) -> AnalystReport {
        AnalystReport {
            id: format!("{title}|{published}"),
            broker: "Test Yatırım".into(),
            scope: BrokerScope::Domestic,
            kind: ReportKind::Other,
            title: title.into(),
            url: format!("https://ornek/{title}"),
            published: published.into(),
            published_ts: chrono::NaiveDate::parse_from_str(published, "%Y-%m-%d")
                .unwrap()
                .and_hms_opt(0, 0, 0)
                .unwrap()
                .and_utc()
                .timestamp(),
            tickers: tickers.iter().map(|code| code.to_string()).collect(),
            ..Default::default()
        }
    }

    fn archive(reports: Vec<AnalystReport>) -> ReportArchive {
        ReportArchive { reports, ..Default::default() }
    }

    fn today() -> chrono::NaiveDate {
        chrono::NaiveDate::from_ymd_opt(2026, 8, 14).unwrap()
    }

    /// Takvimde GERÇEKTEN görünen kategorilerin hepsi tabloda olmalı: eksik
    /// anahtar, o satırda etki bölümünün sessizce hiç çizilmemesi demek.
    /// Liste, uygulamanın disk önbelleğinden okunan canlı kategorilerdir.
    #[test]
    fn every_live_calendar_category_has_a_profile() {
        for category in [
            "interest rate", "inflation rate", "inflation rate mom",
            "producer prices change", "producer price inflation mom",
            "gdp growth rate", "gdp annual growth rate", "unemployment rate",
            "labor force participation rate", "current account", "balance of trade",
            "exports", "imports", "industrial production", "manufacturing pmi",
            "capacity utilization", "business confidence", "consumer confidence",
            "economic optimism index", "retail sales yoy", "retail sales mom",
            "foreign exchange reserves", "government budget value", "government debt",
            "treasury cash balance", "car production", "total vehicle sales",
            "tourist arrivals",
        ] {
            assert!(profile_for(category).is_some(), "canlı kategori tabloda yok: {category}");
        }
        assert!(profile_for("Car Production").is_some(), "eşleme büyük/küçük harften etkilenmemeli");
        assert!(profile_for(" current account ").is_some(), "boşluk kırpılmalı");
    }

    /// Her etiket bir sembol, bir ad ve bir GEREKÇE taşımalı. Gerekçesiz etiket
    /// "bu pay neden burada?" sorusunu cevapsız bırakır — panelin tek işi bu.
    #[test]
    fn every_link_carries_a_symbol_name_and_reason() {
        for (category, profile) in PROFILES {
            assert!(!profile.channel.tr.is_empty(), "{category}: kanal cümlesi boş");
            assert!(!profile.channel.en.is_empty(), "{category}: İngilizce kanal cümlesi boş");
            assert!(!profile.bist.is_empty(), "{category}: hiç BIST etiketi yok");
            assert!(!profile.report_terms.is_empty(), "{category}: rapor terimi yok");
            for spec in profile.bist.iter().chain(profile.global.iter()) {
                assert!(!spec.symbol.trim().is_empty(), "{category}: sembolsüz etiket");
                assert!(!spec.name.trim().is_empty(), "{category}/{}: adsız etiket", spec.symbol);
                assert!(!spec.why.tr.trim().is_empty(), "{category}/{}: gerekçe yok", spec.symbol);
                assert!(!spec.why.en.trim().is_empty(), "{category}/{}: İngilizce gerekçe yok", spec.symbol);
            }
        }
    }

    /// Aynı pay bir satırda iki kez görünmemeli.
    #[test]
    fn links_are_unique_within_a_row() {
        for (category, profile) in PROFILES {
            let mut seen = std::collections::HashSet::new();
            for spec in profile.bist.iter().chain(profile.global.iter()) {
                assert!(seen.insert(spec.symbol), "{category}: {} iki kez etiketlenmiş", spec.symbol);
            }
        }
    }

    /// BIST listesine dünya sembolü karışmamalı: arayüz o listedeki her kodu
    /// tıklanınca hisse sekmesi açan bir BIST kodu sayıyor. Borsa İstanbul
    /// kodları dört ya da beş harflidir — "TUR" (ETF) ya da "BZ=F" (vadeli)
    /// buraya düşerse ölü bir sekme açılır.
    #[test]
    fn bist_list_holds_only_bist_codes() {
        for (category, profile) in PROFILES {
            for spec in profile.bist {
                let looks_like_bist = (4..=5).contains(&spec.symbol.len())
                    && spec.symbol.chars().all(|c| c.is_ascii_uppercase());
                assert!(looks_like_bist, "{category}: {} BIST kodu değil", spec.symbol);
            }
        }
    }

    /// Dil seçimi hem kanal cümlesine hem gerekçelere işlemeli.
    #[test]
    fn language_switches_channel_and_reasons() {
        let empty = archive(Vec::new());
        let tr = build("car production", "tr", &empty, today());
        let en = build("car production", "en", &empty, today());
        assert!(tr.channel.contains("üretim"), "Türkçe kanal cümlesi gelmedi: {}", tr.channel);
        assert!(en.channel.contains("production"), "İngilizce kanal cümlesi gelmedi: {}", en.channel);
        assert_eq!(tr.bist[0].symbol, en.bist[0].symbol, "semboller dile göre değişmemeli");
        assert_ne!(tr.bist[0].why, en.bist[0].why, "gerekçe dile göre değişmeli");
    }

    /// Sözlükte olmayan kategori uydurma eşleme üretmemeli.
    #[test]
    fn unknown_category_produces_no_tags() {
        let impact = build("bilinmeyen kategori", "tr", &archive(Vec::new()), today());
        assert!(impact.channel.is_empty());
        assert!(impact.bist.is_empty());
        assert!(impact.global.is_empty());
    }

    /// Boş arşiv ile "bu konuda rapor yok" aynı şey değil: arayüz ikisini
    /// ayırabilmeli.
    #[test]
    fn empty_archive_is_reported_as_not_ready() {
        let empty = build("car production", "tr", &archive(Vec::new()), today());
        assert!(!empty.archive_ready, "boş arşiv kurulmuş sayılmamalı");

        let stocked = build(
            "car production",
            "tr",
            &archive(vec![report("Alakasız Rapor", "2026-08-01", &["THYAO"])]),
            today(),
        );
        assert!(stocked.archive_ready, "dolu arşiv kurulmuş sayılmalı");
        assert!(stocked.reports.is_empty(), "konuyla ilgisi olmayan rapor listeye girmemeli");
    }

    /// Konunun kendi raporu, etiketlenen payın raporundan önce gelmeli.
    #[test]
    fn topic_reports_outrank_ticker_reports() {
        let archive = archive(vec![
            report("FROTO 2Ç26 Bilanço Analizi", "2026-08-05", &["FROTO"]),
            report("Otomotiv Sektör Raporu / Temmuz 2026", "2026-08-04", &[]),
        ]);
        let impact = build("car production", "tr", &archive, today());
        assert_eq!(impact.reports.len(), 2);
        assert!(
            impact.reports[0].title.contains("Otomotiv Sektör"),
            "konunun raporu başa gelmeli: {:?}",
            impact.reports.iter().map(|r| &r.title).collect::<Vec<_>>()
        );
    }

    /// Ölçülen gerçek gürültü: günlük bültenler her konuyu bir cümleyle anıyor
    /// ve konu terimini taşıdıkları için listeyi dolduruyordu.
    #[test]
    fn daily_bulletins_never_fill_the_list() {
        let archive = archive(vec![
            report("Piyasalarda Bugün 14/08/2026", "2026-08-14", &[]),
            report("Günlük Bülten – 14 Ağustos 2026", "2026-08-14", &[]),
            report("Pay Geri Alımları 13/08/2026", "2026-08-13", &["FROTO"]),
            report("Bir Bakışta Yurt Dışı: Gözler Enflasyon Raporunda", "2026-08-12", &[]),
            report("TCMB Enflasyon Raporu - Ağustos 2026", "2026-08-13", &[]),
        ]);
        let impact = build("inflation rate", "tr", &archive, today());
        assert_eq!(impact.reports.len(), 1, "yalnız gerçek makro not kalmalı");
        assert!(impact.reports[0].title.contains("TCMB Enflasyon Raporu"));
    }

    /// Eski rapor takvim satırını anlatmaz; pencere dışındakiler elenmeli.
    #[test]
    fn reports_older_than_the_window_are_dropped() {
        let archive = archive(vec![
            report("Cari İşlemler Dengesi - Ocak 2026", "2026-01-13", &[]),
            report("Cari İşlemler Dengesi - Temmuz 2026", "2026-08-13", &[]),
        ]);
        let impact = build("current account", "tr", &archive, today());
        assert_eq!(impact.reports.len(), 1, "pencere dışındaki rapor kalmamalı");
        assert!(impact.reports[0].title.contains("Temmuz"));
    }

    /// Liste sınırı: bir satırda onlarca şirket raporu olabiliyor, panel
    /// takvimi ezmemeli.
    #[test]
    fn report_list_is_capped() {
        let reports: Vec<_> = (1..=20)
            .map(|day| report(&format!("FROTO Değerlendirme {day}"), &format!("2026-08-{day:02}"), &["FROTO"]))
            .collect();
        let impact = build("car production", "tr", &archive(reports), today());
        assert_eq!(impact.reports.len(), MAX_REPORTS);
        // En yenisi başta olmalı.
        assert!(impact.reports[0].published > impact.reports[1].published);
    }

    /// Ölçülen gerçek yanlış eşleşme: "tüfe" içinde "üfe" geçtiği için tüketici
    /// enflasyonu raporu üretici fiyatları satırına düşüyordu.
    #[test]
    fn a_term_inside_another_word_does_not_match() {
        let archive = archive(vec![
            report("Aylık TÜFE Verileri İncelemesi", "2026-08-04", &[]),
            report("Aylık ÜFE Verileri İncelemesi", "2026-08-04", &[]),
        ]);
        let impact = build("producer prices change", "tr", &archive, today());
        assert_eq!(impact.reports.len(), 1, "yalnız ÜFE raporu kalmalı");
        assert!(impact.reports[0].title.contains("ÜFE Verileri"));
        assert!(!impact.reports[0].title.contains("TÜFE"));

        // Sağ uç serbest: terimler Türkçe ekleri yakalasın diye gövde yazılıyor.
        assert!(word_starts_with_term("sanayi üretimi haziran", "sanayi üretim"));
        assert!(!word_starts_with_term("tüfe temmuz", "üfe"));
        assert!(word_starts_with_term("aylık üfe verileri", "üfe"));
    }

    /// Eşleme GERÇEK arşivde ne getiriyor? Diskteki kurum arşivini gerektirir,
    /// bu yüzden varsayılan koşuda atlanır; tablo değiştiğinde elle çalıştırılır:
    ///   cargo test -p fraude-core calendar_impact -- --ignored --nocapture
    #[test]
    #[ignore = "diskteki rapor arşivini gerektirir"]
    fn live_archive_yields_relevant_reports() {
        let archive = crate::research_reports::load();
        println!("arşiv: {} rapor", archive.reports.len());
        let today = chrono::Utc::now().date_naive();
        for (category, _) in PROFILES {
            let impact = build(category, "tr", &archive, today);
            println!("\n== {category} → {} rapor", impact.reports.len());
            for report in &impact.reports {
                println!("   [{}] {} | {}", report.published, report.broker, report.title);
            }
        }
    }

    /// Türkçe'nin noktalı/noktasız i'si: rapor başlığı "İŞSİZLİK" diye yazılmış
    /// olabilir. Eşleme `fingerprint` üzerinden gittiği için tutmalı.
    #[test]
    fn matching_survives_turkish_case_folding() {
        let archive = archive(vec![report("İŞSİZLİK ORANI - HAZİRAN 2026", "2026-08-11", &[])]);
        let impact = build("unemployment rate", "tr", &archive, today());
        assert_eq!(impact.reports.len(), 1, "büyük harfli başlık eşleşmeli");
    }
}
