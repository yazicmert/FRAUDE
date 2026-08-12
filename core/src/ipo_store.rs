use crate::ipo_scraper::{IpoResultRow, ScrapedIpo};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// İlk kurulumda arşivi tohumlamak için kullanılan geçmiş halka arz verisi.
/// Çalışma zamanındaki gerçek kaynak ~/.fraude_ipos.json arşividir; scraper
/// her başarılı çekişte arşivi günceller, siteden düşen arzlar arşivde kalır.
const IPO_SEED_JSON: &str = include_str!("../data/ipo_seed.json");

/// XHARZ endeksi halka arzları yaklaşık 2 yıl taşır; sync evreni ve endeks
/// üyeliği için aynı pencereyi kullanıyoruz.
const RECENT_IPO_WINDOW_DAYS: i64 = 730;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PersistedIpo {
    pub ticker: String,
    pub name: String,
    pub ipo_date: String,
    pub price: f64,
    pub status: String,
    #[serde(default)]
    pub book_building_dates: Option<String>,
    #[serde(default)]
    pub trading_start_date: Option<String>,
    #[serde(default)]
    pub distribution_type: Option<String>,
    #[serde(default)]
    pub participant_count: Option<String>,
    #[serde(default)]
    pub last_seen: Option<String>,
    /// Arz tarihinden sonraki bölünme/bedelsiz olaylarının kümülatif çarpanı
    /// (2:1 bedelsiz = 2.0). Getiri hesabında fiyat düzeltmesi için kullanılır.
    #[serde(default)]
    pub split_factor: Option<f64>,
    /// Bölünme çarpanının en son kontrol edildiği tarih (YYYY-MM-DD).
    #[serde(default)]
    pub split_checked: Option<String>,
    #[serde(default)]
    pub fund_usage: Option<String>,
    #[serde(default)]
    pub share_structure: Option<String>,
    #[serde(default)]
    pub ipo_size: Option<String>,
    #[serde(default)]
    pub katilim_index: Option<String>,
    #[serde(default)]
    pub lockup_period: Option<String>,
    #[serde(default)]
    pub consortium_lead: Option<String>,
    #[serde(default)]
    pub t1_t2_available: Option<String>,
    #[serde(default)]
    pub distribution_ratios: Option<String>,
    #[serde(default)]
    pub data_sources: Vec<String>,
    #[serde(default)]
    pub spk_bulletin_no: Option<String>,
    #[serde(default)]
    pub spk_approval_date: Option<String>,
    #[serde(default)]
    pub kap_disclosure_index: Option<String>,
    /// "76,60 TL" veya "20,00 - 22,00 TL" — ham fiyat/aralık metni.
    #[serde(default)]
    pub price_range: Option<String>,
    /// Arza konu toplam pay: "48.312.950 Lot".
    #[serde(default)]
    pub lot_amount: Option<String>,
    #[serde(default)]
    pub market: Option<String>,
    #[serde(default)]
    pub index_name: Option<String>,
    #[serde(default)]
    pub free_float_lots: Option<String>,
    #[serde(default)]
    pub free_float_ratio: Option<String>,
    #[serde(default)]
    pub sale_method: Option<String>,
    /// Talep toplama öncesi "dağıtılacak", sonrasında "dağıtılan" pay miktarı
    /// tahmin tablosu (katılım sayısına göre lot).
    #[serde(default)]
    pub expected_lots: Option<String>,
    #[serde(default)]
    pub financials: Option<String>,
    #[serde(default)]
    pub price_stability: Option<String>,
    #[serde(default)]
    pub public_float_ratio: Option<String>,
    #[serde(default)]
    pub discount: Option<String>,
    /// Tamamlanmış arzlarda yatırımcı grubu bazında dağıtım tablosu.
    #[serde(default)]
    pub results_table: Option<Vec<IpoResultRow>>,
    /// Payların %5'inden fazlasını alan gerçek/tüzel kişilere dair dipnot.
    #[serde(default)]
    pub major_shareholders: Option<String>,
}

fn archive_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join(".fraude_ipos.json"))
}

pub fn load() -> Vec<PersistedIpo> {
    let mut ipos = if let Some(path) = archive_path() {
        if let Ok(contents) = std::fs::read_to_string(&path) {
            if let Ok(records) = serde_json::from_str::<Vec<PersistedIpo>>(&contents) {
                if !records.is_empty() {
                    records
                } else {
                    serde_json::from_str(IPO_SEED_JSON).unwrap_or_default()
                }
            } else {
                serde_json::from_str(IPO_SEED_JSON).unwrap_or_default()
            }
        } else {
            serde_json::from_str(IPO_SEED_JSON).unwrap_or_default()
        }
    } else {
        serde_json::from_str(IPO_SEED_JSON).unwrap_or_default()
    };

    let mut changed = drop_corrupt_records(&mut ipos);
    changed |= merge_duplicate_records(&mut ipos);
    changed |= drop_fabricated_values(&mut ipos);
    changed |= enrich_all_ipos(&mut ipos);
    if changed {
        save(&ipos);
    }
    ipos
}

/// Aynı şirketin farklı kaynaklardan gelmiş iki kaydını tek kayda indirir.
///
/// SPK başvuru listesi ile halkarz.com taslak listesi aynı şirketi biraz
/// farklı yazıyor ("Joy Game" / "Joygame", "Tarım Hayvancılık" / "Tarım ve
/// Hayvancılık"); kod atanmadığı için isim dışında eşleşecek bir anahtar da
/// yok. Sonuçta tabloda aynı şirket iki satır, biri kodsuz ve boş sütunlarla
/// görünüyordu. Kodlu/dolu kayıt taban alınır, eksik alanları diğerinden
/// tamamlanır.
fn merge_duplicate_records(ipos: &mut Vec<PersistedIpo>) -> bool {
    let before = ipos.len();
    let mut kept: Vec<PersistedIpo> = Vec::with_capacity(before);

    for ipo in std::mem::take(ipos) {
        let key = normalized_company_key(&ipo.name);
        // Anahtar anlamlı uzunlukta değilse eşleştirme yapılmaz
        let existing = (key.len() >= 6)
            .then(|| kept.iter().position(|k| normalized_company_key(&k.name) == key))
            .flatten();

        match existing {
            Some(idx) => {
                let (base, extra) = if record_rank(&kept[idx]) >= record_rank(&ipo) {
                    (kept[idx].clone(), ipo)
                } else {
                    (ipo, kept[idx].clone())
                };
                kept[idx] = combine_records(base, extra);
            }
            None => kept.push(ipo),
        }
    }

    let merged_any = kept.len() != before;
    *ipos = kept;
    merged_any
}

/// Çakışmada hangi kaydın taban alınacağını belirler: kodu olan, tarihi
/// çözülmüş ve daha çok alanı dolu olan kayıt kazanır.
fn record_rank(ipo: &PersistedIpo) -> u32 {
    let mut rank = 0;
    if !ipo.ticker.is_empty() {
        rank += 100;
    }
    if looks_like_iso_date(&ipo.ipo_date) {
        rank += 50;
    }
    if ipo.price > 0.0 {
        rank += 10;
    }
    rank + filled_field_count(ipo)
}

fn filled_field_count(ipo: &PersistedIpo) -> u32 {
    [
        &ipo.book_building_dates,
        &ipo.trading_start_date,
        &ipo.distribution_type,
        &ipo.participant_count,
        &ipo.fund_usage,
        &ipo.share_structure,
        &ipo.ipo_size,
        &ipo.consortium_lead,
        &ipo.distribution_ratios,
        &ipo.market,
        &ipo.lot_amount,
    ]
    .iter()
    .filter(|f| f.is_some())
    .count() as u32
}

/// `base` kaydını korur, yalnız boş alanlarını `extra`dan doldurur.
fn combine_records(mut base: PersistedIpo, extra: PersistedIpo) -> PersistedIpo {
    if base.ticker.is_empty() {
        base.ticker = extra.ticker;
    }
    if base.price <= 0.0 {
        base.price = extra.price;
    }
    if !looks_like_iso_date(&base.ipo_date) && looks_like_iso_date(&extra.ipo_date) {
        base.ipo_date = extra.ipo_date;
    }

    let pairs: [(&mut Option<String>, Option<String>); 24] = [
        (&mut base.book_building_dates, extra.book_building_dates),
        (&mut base.trading_start_date, extra.trading_start_date),
        (&mut base.distribution_type, extra.distribution_type),
        (&mut base.participant_count, extra.participant_count),
        (&mut base.fund_usage, extra.fund_usage),
        (&mut base.share_structure, extra.share_structure),
        (&mut base.ipo_size, extra.ipo_size),
        (&mut base.katilim_index, extra.katilim_index),
        (&mut base.lockup_period, extra.lockup_period),
        (&mut base.consortium_lead, extra.consortium_lead),
        (&mut base.t1_t2_available, extra.t1_t2_available),
        (&mut base.distribution_ratios, extra.distribution_ratios),
        (&mut base.spk_bulletin_no, extra.spk_bulletin_no),
        (&mut base.spk_approval_date, extra.spk_approval_date),
        (&mut base.kap_disclosure_index, extra.kap_disclosure_index),
        (&mut base.price_range, extra.price_range),
        (&mut base.lot_amount, extra.lot_amount),
        (&mut base.market, extra.market),
        (&mut base.index_name, extra.index_name),
        (&mut base.free_float_lots, extra.free_float_lots),
        (&mut base.free_float_ratio, extra.free_float_ratio),
        (&mut base.sale_method, extra.sale_method),
        (&mut base.expected_lots, extra.expected_lots),
        (&mut base.financials, extra.financials),
    ];
    for (target, source) in pairs {
        if target.is_none() {
            *target = source;
        }
    }

    if base.price_stability.is_none() {
        base.price_stability = extra.price_stability;
    }
    if base.public_float_ratio.is_none() {
        base.public_float_ratio = extra.public_float_ratio;
    }
    if base.discount.is_none() {
        base.discount = extra.discount;
    }
    if base.results_table.is_none() {
        base.results_table = extra.results_table;
    }
    if base.major_shareholders.is_none() {
        base.major_shareholders = extra.major_shareholders;
    }
    if base.split_factor.is_none() {
        base.split_factor = extra.split_factor;
    }

    for source in extra.data_sources {
        if !base.data_sources.contains(&source) {
            base.data_sources.push(source);
        }
    }

    base
}

/// Şirket unvanını karşılaştırılabilir bir anahtara indirir; tek kaynak
/// `company_match`.
///
/// Yerel bir kopya duruyordu ve "sanayii" (çift i) ekini ayırt edici sayıyordu:
/// "Pilsan Plastik ve Oyuncak Sanayii A.Ş." ile "… Sanayi A.Ş." arşivde iki
/// ayrı kayıt olarak kalıyordu.
fn normalized_company_key(name: &str) -> String {
    crate::company_match::company_key(name)
}

/// Unvanı hiç harf içermeyen kayıtları düşürür ve düşürdüyse `true` döner.
///
/// SPK başvuru tablosu üç sütunludur (`sıra no | unvan | tarih`); konuma bağlı
/// eski ayrıştırıcı sıra numarasını unvan sanıyor ve arşive "1", "2", "3" adlı
/// yüzlerce sahte TASLAK yazıyordu. Ayrıştırıcı düzeltildi, ama bozuk kayıtlar
/// kullanıcıların diskindeki arşivde kalıyor — burada kendiliğinden temizlenir.
/// Harf içermeyen bir unvan meşru olamayacağı için ölçüt güvenlidir.
fn drop_corrupt_records(ipos: &mut Vec<PersistedIpo>) -> bool {
    let before = ipos.len();
    ipos.retain(|ipo| ipo.name.chars().any(char::is_alphabetic));
    before != ipos.len()
}

/// Elle derlenmiş, kaynağı doğrulanmış alanlar. Yalnız burada adı geçen
/// kodlara uygulanır — listede olmayan hisseye varsayılan **yazılmaz**.
///
/// Eskiden bu işlev listede bulunmayan her kayda da bir değer basıyordu:
/// arz büyüklüğü `fiyat × 45.000.000` diye hesaplanıyor, her tamamlanmış arza
/// "854.320 Katılımcı", her şirkete aynı fon kullanım metni ve aynı tahsisat
/// oranı yazılıyordu. Uydurma değerler ekranda gerçek veriden ayırt edilemiyor,
/// üstelik SPK/KAP'tan gelen doğru veriyi de "alan zaten dolu" diye engelliyordu.
const CURATED_LEAD: &[(&str, &str)] = &[
    ("AAGYO", "Tacirler Yatırım Menkul Değerler A.Ş."),
    ("SVGYO", "Tera Yatırım Menkul Değerler A.Ş."),
    ("SARAE", "Tera Yatırım Menkul Değerler A.Ş."),
    ("SSAAT", "Deniz Yatırım Menkul Değerler A.Ş."),
    ("ISVEA", "İş Yatırım Menkul Değerler A.Ş."),
    ("EKIM", "Garanti BBVA Yatırım"),
    ("GOLDA", "Halk Yatırım Menkul Değerler A.Ş."),
    ("SOHOE", "QNB Finans Yatırım"),
    ("ORZAX", "Vakıf Yatırım Menkul Değerler A.Ş."),
    ("BETAE", "Ak Yatırım Menkul Değerler A.Ş."),
    ("EKDMR", "Ziraat Yatırım Menkul Değerler A.Ş."),
    ("ENPRA", "QNB Finans Yatırım / İş Yatırım"),
    ("MCARD", "Tera Yatırım Menkul Değerler A.Ş."),
    ("LXGYO", "Tera Yatırım Menkul Değerler A.Ş."),
    ("ALBTN", "Tera Yatırım Menkul Değerler A.Ş."),
    ("QUICK", "İş Yatırım Menkul Değerler A.Ş."),
    ("KARCL", "Halk Yatırım Menkul Değerler A.Ş."),
    ("MASFN", "Deniz Yatırım Menkul Değerler A.Ş."),
    ("METEN", "OYAK Yatırım Menkul Değerler A.Ş."),
    ("VEYAS", "Ziraat Yatırım / Halk Yatırım"),
];

const CURATED_KATILIM: &[(&str, &str)] = &[
    ("SVGYO", "Katılım Endeksine Uygun Değil"),
    ("EKIM", "Katılım Endeksine Uygun Değil"),
    ("ENPRA", "Katılım Endeksine Uygun Değil"),
    ("SSAAT", "Katılım Endeksine Uygun Değil"),
];

const CURATED_SIZE: &[(&str, &str)] = &[
    ("AAGYO", "2.110.000.000 TL (2,11 Milyar ₺)"),
    ("SVGYO", "1.100.000.000 TL (1,1 Milyar ₺)"),
    ("SARAE", "3.500.000.000 TL (3,5 Milyar ₺)"),
    ("SSAAT", "1.680.000.000 TL (1,68 Milyar ₺)"),
    ("ISVEA", "836.000.000 TL (836 Milyon ₺)"),
    ("EKIM", "1.513.000.000 TL (1,51 Milyar ₺)"),
    ("GOLDA", "920.000.000 TL (920 Milyon ₺)"),
    ("ENPRA", "4.750.000.000 TL (4,75 Milyar ₺)"),
];

const CURATED_FUND_USAGE: &[(&str, &str)] = &[
    ("AAGYO", "%50 Gayrimenkul Projeleri Geliştirme, %35 Portföy Yatırımları, %15 İşletme Sermayesi"),
    ("SVGYO", "%25-40 Kandilli Projesi maliyetlerinin finansmanı, %60-75 Yeni gayrimenkul yatırımları, %0-15 İşletme sermayesi"),
    ("SARAE", "%50 Üretim ve Fabrika Yatırımları, %30 İhracat İşletme Sermayesi, %20 Yenilenebilir GES Yatırımı"),
    ("SSAAT", "%40 Mağaza Ağı Genişletme & Lojistik, %40 Dijital ve E-Ticaret Altyapısı, %20 Finansman Borç Ödemesi"),
    ("ISVEA", "%60 Yeni Fırın ve Üretim Tesisi Kapasite Artışı, %25 GES Güneş Enerjisi Yatırımı, %15 İşletme Sermayesi"),
];

const CURATED_SHARE_STRUCTURE: &[(&str, &str)] = &[
    ("AAGYO", "100.000.000 Lot (%22,50 Halka Açıklık Oranı)"),
    ("SVGYO", "295.400.000 Lot (%27,28 Halka Açıklık Oranı)"),
    ("SARAE", "50.000.000 Lot Sermaye Artırımı (%20 Halka Açıklık)"),
    ("ISVEA", "40.000.000 Lot Sermaye Artırımı (%25 Halka Açıklık)"),
];

/// Eski sürümlerin ürettiği uydurma değerler. Kullanıcıların diskindeki
/// arşivde kaldıkları için yükleme sırasında silinirler; aksi halde gerçek
/// kaynaklardan gelen veri "alan dolu" diye hiç yazılamaz.
const FABRICATED_VALUES: &[&str] = &[
    "Bireysele Eşit Dağıtım",
    "İş Yatırım / Garanti BBVA Yatırım",
    "Katılım Endeksine Uygun (XKTUM)",
    "%45 Üretim Kapasitesi Artırımı ve Tesis Yatırımları, %35 İşletme Sermayesi Finansmanı, %20 Yenilenebilir Enerji Yatırımları",
    "45.000.000 Lot Sermaye Artırımı - Ortak Satışı Yok (%20 Halka Açıklık)",
    "Yurt İçi Bireysel: %80 (Eşit Dağıtım) - Yurt İçi Kurumsal: %20 (Orantısal)",
    "854.320 Katılımcı",
];

fn curated(table: &[(&str, &str)], ticker: &str) -> Option<String> {
    if ticker.is_empty() {
        return None;
    }
    table
        .iter()
        .find(|(code, _)| *code == ticker)
        .map(|(_, value)| (*value).to_string())
}

/// Boş alanları elle derlenmiş değerlerle doldurur. Karşılığı olmayan kayda
/// hiçbir şey yazılmaz: alanın boş kalması, uydurulmuş bir değerden iyidir.
fn enrich_all_ipos(ipos: &mut [PersistedIpo]) -> bool {
    let mut changed = false;

    for ipo in ipos.iter_mut() {
        let fills: [(&mut Option<String>, Option<String>); 5] = [
            (&mut ipo.consortium_lead, curated(CURATED_LEAD, &ipo.ticker)),
            (&mut ipo.katilim_index, curated(CURATED_KATILIM, &ipo.ticker)),
            (&mut ipo.ipo_size, curated(CURATED_SIZE, &ipo.ticker)),
            (&mut ipo.fund_usage, curated(CURATED_FUND_USAGE, &ipo.ticker)),
            (
                &mut ipo.share_structure,
                curated(CURATED_SHARE_STRUCTURE, &ipo.ticker),
            ),
        ];

        for (field, value) in fills {
            let empty = field.as_deref().is_none_or(str::is_empty);
            if empty {
                if let Some(value) = value {
                    *field = Some(value);
                    changed = true;
                }
            }
        }
    }

    changed
}

/// Eski sürümlerin yazdığı uydurma değerleri arşivden siler.
fn drop_fabricated_values(ipos: &mut [PersistedIpo]) -> bool {
    let mut changed = false;

    for ipo in ipos.iter_mut() {
        let fields = [
            &mut ipo.distribution_type,
            &mut ipo.consortium_lead,
            &mut ipo.katilim_index,
            &mut ipo.fund_usage,
            &mut ipo.share_structure,
            &mut ipo.distribution_ratios,
            &mut ipo.participant_count,
        ];
        for field in fields {
            if field
                .as_deref()
                .is_some_and(|value| FABRICATED_VALUES.contains(&value))
            {
                *field = None;
                changed = true;
            }
        }

        // İlk işlem tarihi henüz açıklanmadığında kaynak sayfa yer tutucu
        // yazıyor ("Hazırlanıyor…"). Bu değer alanda kalırsa iki zarar verir:
        // arayüz onu tarih gibi gösterir ve `detail_is_complete` kaydı DOLU
        // sayıp künyeyi bir daha tazelemez — gerçek tarih yayımlandığında
        // kayda hiç işlenmez. Yükleme sırasında temizlenir ki eski arşivler
        // de kendiliğinden düzelsin.
        if ipo
            .trading_start_date
            .as_deref()
            .is_some_and(|value| !value.chars().any(|c| c.is_ascii_digit()))
        {
            ipo.trading_start_date = None;
            changed = true;
        }

        // "<tarih> Dönemi" gerçek bir talep toplama aralığı değil, arz
        // tarihinden türetilmiş bir dolgudur.
        if ipo
            .book_building_dates
            .as_deref()
            .is_some_and(|value| value == format!("{} Dönemi", ipo.ipo_date))
        {
            ipo.book_building_dates = None;
            changed = true;
        }

        // Uydurma büyüklük fiyattan türetiliyordu: fiyat × 45.000.000.
        if ipo.price > 0.0 {
            let fabricated = (ipo.price * 45_000_000.0) as i64;
            if ipo
                .ipo_size
                .as_deref()
                .is_some_and(|value| value.starts_with(&format!("{fabricated} TL")))
            {
                ipo.ipo_size = None;
                changed = true;
            }
        }
    }

    changed
}

pub fn save(ipos: &[PersistedIpo]) {
    if let Some(path) = archive_path() {
        if let Ok(json) = serde_json::to_string_pretty(ipos) {
            let _ = std::fs::write(&path, json);
        }
    }
}

pub fn looks_like_iso_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && value.chars().take(4).all(|c| c.is_ascii_digit())
}

/// Taze scrape sonucunu arşive işler. Yeni ticker eklenir, mevcut kayıt
/// güncellenir; scrape'in boş döndürdüğü alanlar arşivdeki dolu değeri ezmez.
/// BIST kodu atanmamış (ticker'ı boş) kayıtlar isimle eşleştirilir; kod
/// sonradan atandığında aynı kayıt güncellenir, mükerrer oluşmaz.
pub fn merge_scraped(archive: &mut Vec<PersistedIpo>, scraped: &[ScrapedIpo]) -> bool {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut changed = false;

    for ipo in scraped {
        if ipo.ticker.is_empty() && ipo.name.is_empty() {
            continue;
        }
        // İsim eşleşmesi birebir değil normalleştirilmiş anahtarla yapılır:
        // SPK bülteni "Kapeks Kimya Sanayi AŞ", halkarz.com "Kapeks Kimya
        // Sanayi A.Ş." yazıyor ve birebir kıyas ikisini ayrı kayıt sanıyordu.
        let name_match = |p: &PersistedIpo| crate::company_match::same_company(&p.name, &ipo.name);
        let idx = if ipo.ticker.is_empty() {
            archive.iter().position(name_match)
        } else {
            archive
                .iter()
                .position(|p| p.ticker == ipo.ticker)
                .or_else(|| {
                    archive
                        .iter()
                        .position(|p| p.ticker.is_empty() && name_match(p))
                })
        };
        if let Some(i) = idx {
            let existing = &mut archive[i];
            // Kodsuz taslak scrape'i, kod atanmış arşiv kaydını geriletmesin
            if ipo.ticker.is_empty() && !existing.ticker.is_empty() {
                existing.last_seen = Some(today.clone());
                changed = true;
                continue;
            }
            if !ipo.ticker.is_empty() {
                existing.ticker = ipo.ticker.clone();
            }
            if ipo.price > 0.0 {
                existing.price = ipo.price;
            }
            if !ipo.name.is_empty() {
                existing.name = ipo.name.clone();
            }
            // Kazınan durum aşamayı geri almamalı. SPK onayı halka arzın
            // kesinleştiğinin resmî kanıtı; halkarz.com aynı şirketi hâlâ
            // "Hazırlanıyor" listesinde tutuyor olabilir ve kaydı taslağa
            // düşürüp onay bilgisini görünmez kılıyordu.
            if !(existing.status == "SPK ONAYLI" && ipo.status == "TASLAK") {
                existing.status = ipo.status.clone();
            }
            if looks_like_iso_date(&ipo.ipo_date) {
                existing.ipo_date = ipo.ipo_date.clone();
            }
            if ipo.book_building_dates.is_some() {
                existing.book_building_dates = ipo.book_building_dates.clone();
            }
            if ipo.trading_start_date.is_some() {
                existing.trading_start_date = ipo.trading_start_date.clone();
            }
            if ipo.distribution_type.is_some() {
                existing.distribution_type = ipo.distribution_type.clone();
            }
            if ipo.participant_count.is_some() {
                existing.participant_count = ipo.participant_count.clone();
            }
            if ipo.fund_usage.is_some() {
                existing.fund_usage = ipo.fund_usage.clone();
            }
            if ipo.share_structure.is_some() {
                existing.share_structure = ipo.share_structure.clone();
            }
            if ipo.ipo_size.is_some() {
                existing.ipo_size = ipo.ipo_size.clone();
            }
            if ipo.katilim_index.is_some() {
                existing.katilim_index = ipo.katilim_index.clone();
            }
            if ipo.lockup_period.is_some() {
                existing.lockup_period = ipo.lockup_period.clone();
            }
            if ipo.consortium_lead.is_some() {
                existing.consortium_lead = ipo.consortium_lead.clone();
            }
            if ipo.t1_t2_available.is_some() {
                existing.t1_t2_available = ipo.t1_t2_available.clone();
            }
            if ipo.distribution_ratios.is_some() {
                existing.distribution_ratios = ipo.distribution_ratios.clone();
            }
            overwrite_if_present(&mut existing.price_range, &ipo.price_range);
            overwrite_if_present(&mut existing.lot_amount, &ipo.lot_amount);
            overwrite_if_present(&mut existing.market, &ipo.market);
            overwrite_if_present(&mut existing.index_name, &ipo.index_name);
            overwrite_if_present(&mut existing.free_float_lots, &ipo.free_float_lots);
            overwrite_if_present(&mut existing.free_float_ratio, &ipo.free_float_ratio);
            overwrite_if_present(&mut existing.sale_method, &ipo.sale_method);
            overwrite_if_present(&mut existing.expected_lots, &ipo.expected_lots);
            overwrite_if_present(&mut existing.financials, &ipo.financials);
            overwrite_if_present(&mut existing.price_stability, &ipo.price_stability);
            overwrite_if_present(&mut existing.public_float_ratio, &ipo.public_float_ratio);
            overwrite_if_present(&mut existing.discount, &ipo.discount);
            overwrite_if_present(&mut existing.major_shareholders, &ipo.major_shareholders);
            if ipo.results_table.is_some() {
                existing.results_table = ipo.results_table.clone();
            }
            existing.last_seen = Some(today.clone());
        } else {
            archive.push(PersistedIpo {
                ticker: ipo.ticker.clone(),
                name: ipo.name.clone(),
                ipo_date: ipo.ipo_date.clone(),
                price: ipo.price,
                status: ipo.status.clone(),
                book_building_dates: ipo.book_building_dates.clone(),
                trading_start_date: ipo.trading_start_date.clone(),
                distribution_type: ipo.distribution_type.clone(),
                participant_count: ipo.participant_count.clone(),
                last_seen: Some(today.clone()),
                split_factor: None,
                split_checked: None,
                fund_usage: ipo.fund_usage.clone(),
                share_structure: ipo.share_structure.clone(),
                ipo_size: ipo.ipo_size.clone(),
                katilim_index: ipo.katilim_index.clone(),
                lockup_period: ipo.lockup_period.clone(),
                consortium_lead: ipo.consortium_lead.clone(),
                t1_t2_available: ipo.t1_t2_available.clone(),
                distribution_ratios: ipo.distribution_ratios.clone(),
                data_sources: Vec::new(),
                spk_bulletin_no: None,
                spk_approval_date: None,
                kap_disclosure_index: None,
                price_range: ipo.price_range.clone(),
                lot_amount: ipo.lot_amount.clone(),
                market: ipo.market.clone(),
                index_name: ipo.index_name.clone(),
                free_float_lots: ipo.free_float_lots.clone(),
                free_float_ratio: ipo.free_float_ratio.clone(),
                sale_method: ipo.sale_method.clone(),
                expected_lots: ipo.expected_lots.clone(),
                financials: ipo.financials.clone(),
                price_stability: ipo.price_stability.clone(),
                public_float_ratio: ipo.public_float_ratio.clone(),
                discount: ipo.discount.clone(),
                results_table: ipo.results_table.clone(),
                major_shareholders: ipo.major_shareholders.clone(),
            });
        }
        changed = true;
    }

    changed
}

/// Scrape'ten dolu bir değer geldiyse arşivdekini günceller; boş geldiyse
/// mevcut değere dokunmaz (detay sayfası çekilmemiş olabilir).
fn overwrite_if_present(target: &mut Option<String>, source: &Option<String>) {
    if source.is_some() {
        *target = source.clone();
    }
}

fn recent_cutoff() -> String {
    (chrono::Local::now() - chrono::Duration::days(RECENT_IPO_WINDOW_DAYS))
        .format("%Y-%m-%d")
        .to_string()
}

fn is_valid_bist_code(ticker: &str) -> bool {
    (3..=6).contains(&ticker.len())
        && ticker.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
}

/// Son 2 yıl içinde işlem görmeye başlamış (taslak olmayan) halka arz kodları.
/// XHARZ / "BIST HALKA ARZ" endeks üyeliği bu kümeden türetilir.
pub fn recent_ipo_tickers(archive: &[PersistedIpo]) -> HashSet<String> {
    let cutoff = recent_cutoff();
    archive
        .iter()
        .filter(|p| p.status != "TASLAK")
        .filter(|p| looks_like_iso_date(&p.ipo_date) && p.ipo_date.as_str() >= cutoff.as_str())
        .filter(|p| is_valid_bist_code(&p.ticker))
        .map(|p| p.ticker.clone())
        .collect()
}

/// Statik evrende bulunmayan güncel IPO ticker'ları; Yahoo sync evrenine
/// eklenerek güncel fiyat/getiri verisinin otomatik dolması sağlanır.
pub fn sync_universe_additions(
    archive: &[PersistedIpo],
    known: &HashSet<&str>,
) -> Vec<(String, String)> {
    let recent = recent_ipo_tickers(archive);
    archive
        .iter()
        .filter(|p| recent.contains(&p.ticker) && !known.contains(p.ticker.as_str()))
        .map(|p| (p.ticker.clone(), p.name.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scraped(ticker: &str, price: f64, status: &str) -> ScrapedIpo {
        ScrapedIpo {
            ticker: ticker.into(),
            name: format!("{ticker} A.Ş."),
            ipo_date: "2027-01-15".into(),
            price,
            status: status.into(),
            ..Default::default()
        }
    }

    /// İlk işlem tarihi açıklanmadan önce kaynak sayfa yer tutucu yazıyor
    /// ("Hazırlanıyor…"). Bu değer alanda kalırsa kayıt "tamam" sayılır ve
    /// gerçek tarih yayımlandığında künye bir daha tazelenmez.
    #[test]
    fn placeholder_trading_start_date_is_cleared_on_load() {
        let mut archive = vec![
            PersistedIpo {
                ticker: "CITAS".into(),
                trading_start_date: Some("Hazırlanıyor…".into()),
                ..Default::default()
            },
            PersistedIpo {
                ticker: "THYAO".into(),
                trading_start_date: Some("2026-08-12".into()),
                ..Default::default()
            },
        ];

        assert!(drop_fabricated_values(&mut archive), "temizlik değişiklik bildirmeli");
        assert_eq!(archive[0].trading_start_date, None, "yer tutucu silinmeli");
        assert_eq!(
            archive[1].trading_start_date.as_deref(),
            Some("2026-08-12"),
            "gerçek tarihe dokunulmamalı"
        );
    }

    /// SPK onayı halka arzın kesinleştiğinin resmî kanıtı; halkarz.com aynı
    /// şirketi hâlâ "Hazırlanıyor" listesinde tutuyor olabilir. Kazınan durum
    /// aşamayı geri alıp onay bilgisini görünmez kılıyordu.
    #[test]
    fn a_scraped_draft_does_not_undo_spk_approval() {
        let mut archive = vec![PersistedIpo {
            name: "KPEKS A.Ş.".into(),
            ticker: "KPEKS".into(),
            status: "SPK ONAYLI".into(),
            spk_bulletin_no: Some("2026/49".into()),
            ..Default::default()
        }];

        merge_scraped(&mut archive, &[scraped("KPEKS", 0.0, "TASLAK")]);
        assert_eq!(archive[0].status, "SPK ONAYLI");

        // Gerçek ilerleme yine de yazılmalı.
        merge_scraped(&mut archive, &[scraped("KPEKS", 94.0, "TALEP TOPLAMA")]);
        assert_eq!(archive[0].status, "TALEP TOPLAMA");
    }

    /// İsim eşleşmesi birebir değil normalleştirilmiş anahtarla yapılmalı:
    /// SPK "Kapeks Kimya Sanayi AŞ", halkarz.com "Kapeks Kimya Sanayi A.Ş."
    /// yazıyor ve birebir kıyas ikisini ayrı kayıt sanıyordu.
    #[test]
    fn scrape_matches_a_codeless_record_across_spellings() {
        let mut archive = vec![PersistedIpo {
            name: "Kapeks Kimya Sanayi AŞ".into(),
            status: "SPK ONAYLI".into(),
            ..Default::default()
        }];

        let mut row = scraped("KPEKS", 94.0, "TALEP TOPLAMA");
        row.name = "Kapeks Kimya Sanayi A.Ş.".into();
        merge_scraped(&mut archive, &[row]);

        assert_eq!(archive.len(), 1, "{archive:#?}");
        assert_eq!(archive[0].ticker, "KPEKS");
        assert_eq!(archive[0].price, 94.0);
    }

    /// Aynı şirket, iki kaynaktan iki yazımla: SPK başvuru listesi ("Joy Game
    /// Oyun ve Teknoloji A.Ş.") ile halkarz.com taslağı ("Joygame Oyun ve
    /// Teknoloji A.Ş.") tek satırda birleşmeli.
    #[test]
    fn same_company_from_two_sources_becomes_one_record() {
        let mut ipos = vec![
            PersistedIpo {
                name: "Joygame Oyun ve Teknoloji A.Ş.".into(),
                ipo_date: "Hazırlanıyor...".into(),
                status: "TASLAK".into(),
                data_sources: vec!["halkarz.com".into()],
                ..Default::default()
            },
            PersistedIpo {
                name: "Joy Game Oyun ve Teknoloji A.Ş.".into(),
                ipo_date: "2025-08-08".into(),
                status: "TASLAK".into(),
                spk_bulletin_no: Some("2025/40".into()),
                data_sources: vec!["SPK".into()],
                ..Default::default()
            },
        ];

        assert!(merge_duplicate_records(&mut ipos));
        assert_eq!(ipos.len(), 1);
        // Tarihi çözülmüş kayıt taban alınır, diğerinin kaynağı eklenir
        assert_eq!(ipos[0].ipo_date, "2025-08-08");
        assert_eq!(ipos[0].spk_bulletin_no.as_deref(), Some("2025/40"));
        assert_eq!(ipos[0].data_sources.len(), 2);
    }

    /// Kodlu kayıt taban alınmalı ve kodsuz kaydın doldurduğu alanlar
    /// korunmalı — ekrandaki "—" satırının kaynağı buydu.
    #[test]
    fn coded_record_wins_and_absorbs_missing_fields() {
        let mut ipos = vec![
            PersistedIpo {
                name: "Teknika Plast Teknik Plastik San. ve Tic. A.Ş.".into(),
                ipo_date: "2026-08-14".into(),
                status: "TASLAK".into(),
                consortium_lead: Some("Ahlatcı Yatırım".into()),
                ..Default::default()
            },
            PersistedIpo {
                ticker: "TKNKA".into(),
                name: "Teknika Plast Teknik Plastik Sanayi ve Ticaret A.Ş.".into(),
                ipo_date: "2026-08-14".into(),
                price: 85.4,
                status: "AKTİF".into(),
                market: Some("Yıldız Pazar".into()),
                ..Default::default()
            },
        ];

        assert!(merge_duplicate_records(&mut ipos));
        assert_eq!(ipos.len(), 1);
        assert_eq!(ipos[0].ticker, "TKNKA");
        assert_eq!(ipos[0].price, 85.4);
        assert_eq!(ipos[0].market.as_deref(), Some("Yıldız Pazar"));
        assert_eq!(ipos[0].consortium_lead.as_deref(), Some("Ahlatcı Yatırım"));
    }

    /// Farklı şirketler birleşmemeli; anahtar yalnız hukuki form eklerini atar.
    #[test]
    fn different_companies_are_left_alone() {
        let mut ipos = vec![
            PersistedIpo {
                ticker: "AAAAA".into(),
                name: "Akfen İnşaat Turizm ve Ticaret A.Ş.".into(),
                ..Default::default()
            },
            PersistedIpo {
                ticker: "BBBBB".into(),
                name: "Akfen Yenilenebilir Enerji A.Ş.".into(),
                ..Default::default()
            },
        ];

        assert!(!merge_duplicate_records(&mut ipos));
        assert_eq!(ipos.len(), 2);
    }

    #[test]
    fn company_key_ignores_legal_form_and_spacing() {
        assert_eq!(
            normalized_company_key("Joy Game Oyun ve Teknoloji A.Ş."),
            normalized_company_key("Joygame Oyun ve Teknoloji A.Ş."),
        );
        assert_eq!(
            normalized_company_key("Hastavuk Gıda Tarım Hayvancılık A.Ş."),
            normalized_company_key("Hastavuk Gıda Tarım ve Hayvancılık A.Ş."),
        );
        assert_ne!(
            normalized_company_key("Akfen İnşaat A.Ş."),
            normalized_company_key("Akfen Enerji A.Ş."),
        );
    }

    fn persisted(ticker: &str, price: f64) -> PersistedIpo {
        PersistedIpo {
            ticker: ticker.into(),
            name: format!("{ticker} A.Ş."),
            ipo_date: "2026-05-01".into(),
            price,
            status: "TAMAMLANDI".into(),
            book_building_dates: Some("1-2 Mayıs 2026".into()),
            ..Default::default()
        }
    }

    /// Regresyon: bozuk SPK ayrıştırması arşive "1", "2" adlı kayıtlar yazmıştı;
    /// yükleme bunları kendiliğinden temizlemeli, gerçek kayıtlara dokunmamalı.
    #[test]
    fn corrupt_numeric_names_are_dropped_on_load() {
        let mut archive = vec![persisted("AAAA", 10.0)];
        let mut junk = persisted("", 0.0);
        junk.name = "17".into();
        archive.push(junk);

        assert!(drop_corrupt_records(&mut archive));
        assert_eq!(archive.len(), 1);
        assert_eq!(archive[0].ticker, "AAAA");
    }

    #[test]
    fn clean_archive_is_left_untouched() {
        let mut archive = vec![persisted("AAAA", 10.0), persisted("BBBB", 20.0)];
        assert!(!drop_corrupt_records(&mut archive));
        assert_eq!(archive.len(), 2);
    }

    /// Regresyon: her tamamlanmış arza "854.320 Katılımcı", her şirkete aynı
    /// tahsisat oranı ve `fiyat × 45.000.000` arz büyüklüğü yazılıyordu.
    #[test]
    fn fabricated_values_are_purged_on_load() {
        let mut ipo = persisted("AAAA", 20.0);
        ipo.participant_count = Some("854.320 Katılımcı".into());
        ipo.distribution_ratios =
            Some("Yurt İçi Bireysel: %80 (Eşit Dağıtım) - Yurt İçi Kurumsal: %20 (Orantısal)".into());
        ipo.consortium_lead = Some("İş Yatırım / Garanti BBVA Yatırım".into());
        ipo.ipo_size = Some("900000000 TL (0,90 Milyar ₺)".into()); // 20,0 × 45.000.000
        ipo.book_building_dates = Some("2026-05-01 Dönemi".into());
        let mut archive = vec![ipo];

        assert!(drop_fabricated_values(&mut archive));
        let cleaned = &archive[0];
        assert!(cleaned.participant_count.is_none());
        assert!(cleaned.distribution_ratios.is_none());
        assert!(cleaned.consortium_lead.is_none());
        assert!(cleaned.ipo_size.is_none());
        assert!(cleaned.book_building_dates.is_none());
    }

    #[test]
    fn real_values_survive_the_purge() {
        let mut ipo = persisted("AAAA", 20.0);
        ipo.participant_count = Some("1.234.567 Katılımcı".into());
        ipo.consortium_lead = Some("Ak Yatırım Menkul Değerler A.Ş.".into());
        let mut archive = vec![ipo];

        assert!(!drop_fabricated_values(&mut archive));
        assert!(archive[0].participant_count.is_some());
        assert!(archive[0].consortium_lead.is_some());
    }

    /// Listede olmayan hisseye varsayılan yazılmamalı — boş alan, uydurma
    /// değerden iyidir.
    #[test]
    fn enrichment_only_touches_curated_tickers() {
        let mut archive = vec![persisted("ZZZZ", 10.0), persisted("AAGYO", 10.0)];
        for ipo in archive.iter_mut() {
            ipo.consortium_lead = None;
            ipo.ipo_size = None;
        }

        assert!(enrich_all_ipos(&mut archive));
        assert!(archive[0].consortium_lead.is_none(), "listede olmayan koda yazıldı");
        assert!(archive[0].ipo_size.is_none(), "listede olmayan koda yazıldı");
        assert_eq!(
            archive[1].consortium_lead.as_deref(),
            Some("Tacirler Yatırım Menkul Değerler A.Ş.")
        );
    }

    #[test]
    fn merge_adds_new_tickers() {
        let mut archive = vec![persisted("AAAA", 10.0)];
        let changed = merge_scraped(&mut archive, &[scraped("BBBB", 25.0, "AKTİF")]);
        assert!(changed);
        assert_eq!(archive.len(), 2);
        assert_eq!(archive[1].ticker, "BBBB");
        assert!(archive[1].last_seen.is_some());
    }

    #[test]
    fn merge_does_not_erase_known_values_with_empty_scrape() {
        let mut archive = vec![persisted("AAAA", 10.0)];
        merge_scraped(&mut archive, &[scraped("AAAA", 0.0, "TAMAMLANDI")]);
        assert_eq!(archive[0].price, 10.0);
        assert_eq!(
            archive[0].book_building_dates.as_deref(),
            Some("1-2 Mayıs 2026")
        );
    }

    #[test]
    fn merge_updates_status_and_price() {
        let mut archive = vec![persisted("AAAA", 10.0)];
        merge_scraped(&mut archive, &[scraped("AAAA", 12.5, "AKTİF")]);
        assert_eq!(archive[0].price, 12.5);
        assert_eq!(archive[0].status, "AKTİF");
        assert_eq!(archive[0].ipo_date, "2027-01-15");
    }

    #[test]
    fn merge_matches_codeless_draft_by_name_and_assigns_code_later() {
        let mut archive = Vec::new();
        // İlk scrape: kod atanmamış taslak
        let mut draft = scraped("", 0.0, "TASLAK");
        draft.name = "Albayrak Hazır Beton A.Ş.".into();
        draft.ipo_date = "Hazırlanıyor...".into();
        merge_scraped(&mut archive, &[draft.clone()]);
        assert_eq!(archive.len(), 1);
        assert_eq!(archive[0].ticker, "");

        // Aynı taslak tekrar gelirse mükerrer oluşmamalı
        merge_scraped(&mut archive, &[draft]);
        assert_eq!(archive.len(), 1);

        // Kod atanınca aynı kayıt güncellenmeli
        let mut coded = scraped("ALBHB", 25.0, "AKTİF");
        coded.name = "Albayrak Hazır Beton A.Ş.".into();
        merge_scraped(&mut archive, &[coded]);
        assert_eq!(archive.len(), 1);
        assert_eq!(archive[0].ticker, "ALBHB");
        assert_eq!(archive[0].status, "AKTİF");
    }

    #[test]
    fn codeless_scrape_does_not_downgrade_coded_record() {
        let mut archive = vec![persisted("SAMET", 30.0)];
        archive[0].name = "Samet Kalıp A.Ş.".into();
        let mut draft = scraped("", 0.0, "TASLAK");
        draft.name = "Samet Kalıp A.Ş.".into();
        merge_scraped(&mut archive, &[draft]);
        assert_eq!(archive.len(), 1);
        assert_eq!(archive[0].ticker, "SAMET");
        assert_eq!(archive[0].status, "TAMAMLANDI");
    }

    #[test]
    fn recent_tickers_exclude_drafts_and_old_ipos() {
        let recent_date = chrono::Local::now().format("%Y-%m-%d").to_string();
        let mut fresh = persisted("FRSH", 5.0);
        fresh.ipo_date = recent_date;
        let mut old = persisted("OLDD", 5.0);
        old.ipo_date = "2019-01-01".into();
        let mut draft = persisted("DRFT", 5.0);
        draft.ipo_date = chrono::Local::now().format("%Y-%m-%d").to_string();
        draft.status = "TASLAK".into();

        let set = recent_ipo_tickers(&[fresh, old, draft]);
        assert!(set.contains("FRSH"));
        assert!(!set.contains("OLDD"));
        assert!(!set.contains("DRFT"));
    }

    #[test]
    fn seed_json_parses() {
        let seeded: Vec<PersistedIpo> = serde_json::from_str(IPO_SEED_JSON).unwrap();
        assert!(seeded.len() >= 30);
        assert!(seeded.iter().all(|p| !p.ticker.is_empty()));
    }
}
