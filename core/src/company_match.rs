//! Şirket unvanını BIST koduna bağlama.
//!
//! Resmî kaynaklar kod vermez, unvan verir — SPK bülteni "Katılımevim Tasarruf
//! Finansman AŞ" yazar, KTLEV demez. Üstelik her kaynak unvanı biraz farklı
//! yazar: BIST evreninde aynı şirket "AKÇANSA ÇİMENTO SANAYİ VE TİCARET A.Ş."
//! ya da "Akfen insaat Turizm ve Ticaret AS" olarak, Türkçe karakterli veya
//! harf çevrimli geçebiliyor.
//!
//! Bu yüzden eşleştirme ham metinle değil, **normalleştirilmiş anahtar**la
//! yapılır: Türkçe harfler ASCII'ye indirilir, hukuki form ekleri ve her
//! unvanda geçen ayırt edici olmayan kelimeler atılır, geriye kalan harf ve
//! rakamlar boşluksuz birleştirilir.

use std::collections::HashMap;
use std::sync::OnceLock;

/// Unvanda ayırt edici olmayan kelimeler. Bunlar atılmazsa "Karsu Tekstil
/// Sanayii ve Ticaret AŞ" ile "KARSU TEKSTİL SANAYİİ VE TİCARET A.Ş."
/// arasındaki yazım farkları anahtarı ayırıyor.
const FILLER_WORDS: &[&str] = &[
    "as", "aş", "anonim", "sirketi", "şirketi", "ve", "ile", "sanayi", "sanayii",
    "san", "ticaret", "tic", "tıc", "limited", "ltd", "sti", "şti", "t",
];

/// Türkçe harfleri ASCII eşdeğerine indirir.
fn fold_char(c: char) -> char {
    match c {
        'ç' | 'Ç' => 'c',
        'ğ' | 'Ğ' => 'g',
        'ı' | 'İ' | 'î' | 'Î' => 'i',
        'ö' | 'Ö' => 'o',
        'ş' | 'Ş' => 's',
        'ü' | 'Ü' | 'û' | 'Û' => 'u',
        'â' | 'Â' => 'a',
        _ => c,
    }
}

/// Kaynakların açık ya da kısaltılmış yazdığı unvan kalıpları.
///
/// halkarz.com "Savur GYO" derken SPK bülteni ve BIST evreni "Savur
/// Gayrimenkul Yatırım Ortaklığı AŞ" yazıyor; kısaltma açılmadan bu ikisi
/// farklı şirket görünüyor. Uzun kalıp önce denenir, kısası onun parçası.
const ABBREVIATIONS: &[(&str, &str)] = &[
    ("gayrimenkul ve girisim sermayesi yatirim ortakligi", " gsyo "),
    ("girisim sermayesi yatirim ortakligi", " gsyo "),
    ("menkul kiymet yatirim ortakligi", " mkyo "),
    ("gayrimenkul yatirim ortakligi", " gyo "),
];

/// Aynı sözcüğün kaynaklar arasında değişen yazımı. Anlam aynı, harf farklı.
const SPELLING_VARIANTS: &[(&str, &str)] = &[("makina", "makine")];

/// SPK bülteninin kullandığı unvanın BIST evreninde karşılığı bulunamayan
/// **doğrulanmış** durumlar: şirket ad değiştirmiş ya da bülten marka/eski
/// unvanı kullanıyor.
///
/// Bunlar elle derlendi ve her biri KAP listesiyle karşılaştırılarak
/// doğrulandı; sezgisel bir kural değil. Kapsama ("bir anahtar diğerini
/// içeriyorsa aynı şirkettir") denendi ve **reddedildi**: üç eşleşmenin ikisi
/// yanlıştı — "Dagi Yatırım Holding" ile "Pera Yatırım Holding" ikisi de
/// "Q Yatırım Holding"e bağlanıyordu. Kod uydurmaktansa boş bırakmak yeğdir.
const NAME_ALIASES: &[(&str, &str)] = &[
    // Bülten marka adını, KAP tescilli unvanı yazıyor.
    ("Erdemir Demir ve Çelik Fabrikaları TAŞ", "EREGL"),
    ("Türkiye Petrol Rafinerileri AŞ", "TUPRS"),
    // Şirket sonradan ad değiştirdi.
    ("QNB Finans Finansal Kiralama AŞ", "QNBFK"),
    ("Matriks Bilgi Dağıtım Hizmetleri AŞ", "MTRKS"),
    ("Dagi Yatırım Holding AŞ", "DAGI"),
    ("Mondi Tire Kutsan Kağıt ve Ambalaj Sanayi AŞ", "MNDTR"),
    ("ATP Ticari Bilgisayar Ağı ve Elektrik Güç Kaynakları Üretim Pazarlama ve Ticaret AŞ", "ATATP"),
    // KAP listesindeki dizgi hatası ("KOYUNLULULAR").
    ("Birko Birleşik Koyunlular Mensucat Ticaret ve Sanayi AŞ", "BRKO"),
];

/// Unvanı karşılaştırılabilir bir anahtara indirir.
///
/// "Katılımevim Tasarruf Finansman AŞ" → `katilimevimtasarruffinansman`
///
/// Boşluklar da atıldığı için "Joy Game" ile "Joygame" aynı anahtarı verir.
pub fn company_key(name: &str) -> String {
    let folded: String = name.chars().map(fold_char).collect::<String>().to_lowercase();
    let folded = ABBREVIATIONS
        .iter()
        .fold(folded, |acc, (long, short)| acc.replace(long, short));

    let folded = SPELLING_VARIANTS
        .iter()
        .fold(folded, |acc, (from, to)| acc.replace(from, to));

    let mut words: Vec<&str> = folded
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| {
            // "A.Ş." / "T.A.Ş." noktalardan bölününce tek harflik parçalara
            // ayrışıyor; bunlar unvanın parçası değil, hukuki form kırıntısı.
            // Rakam içeren tek karakter (A1 Capital'deki "a1") korunur.
            !word.is_empty()
                && !FILLER_WORDS.contains(word)
                && !(word.chars().count() == 1 && word.chars().all(char::is_alphabetic))
        })
        .collect();

    // Sondaki hukuki form kalıntıları elenir. "Türk Anonim Şirketi" üç ayrı
    // yazımla geliyor ve kaynaklar üçünü de kullanıyor:
    //
    //   KAP           "GOODYEAR LASTİKLERİ T.A.Ş."   → noktalar bölünür, kalıntı yok
    //   SPK bülteni   "Goodyear Lastikleri Türk AŞ"  → "türk" kalır
    //   pdf_extract   "Ereğli … Fabrikaları TAŞ"     → "taş" kalır
    //
    // Yalnız **son** kelime elenir: baştaki "Türk" ayırt edicidir (Türk Hava
    // Yolları, Türk Telekom, Türk Traktör), "Taş" da unvan içinde geçebilir
    // (Akıllı Taş Madencilik).
    if words.len() > 1 && matches!(words.last(), Some(&"turk") | Some(&"tas")) {
        words.pop();
    }

    words.concat()
}

/// Anahtar → BIST kodu dizini.
///
/// İki evren birleştirilir: derlemeye gömülü statik liste ve KAP'tan günlük
/// çekilen tam liste (`bist_universe` önbelleği, ~795 kod). Statik liste 613
/// kodla sınırlı ve elle güncelleniyor; yalnız ona bakan eşleştirme yeni
/// listelenen şirketleri göremiyordu — SPK arşivindeki 720 sermaye
/// artırımının 78'i koda bağlanamıyor, dolayısıyla kurumsal olaylar akışında
/// hiç görünmüyordu.
///
/// Önbellek dosyası uygulama açılışında tazelenir; burada yalnız okunur, ağ
/// erişimi yapılmaz.
fn ticker_index() -> &'static HashMap<String, &'static str> {
    static INDEX: OnceLock<HashMap<String, &'static str>> = OnceLock::new();
    INDEX.get_or_init(|| {
        let mut map: HashMap<String, &'static str> = HashMap::new();

        // Aynı anahtara birden çok kod düşerse ilki korunur; evrende
        // yinelenen unvan pratikte yok, ama sessizce üzerine yazmak
        // yanlış kodu kalıcı hâle getirirdi.
        for (ticker, name) in crate::yahoo::BIST_TICKERS {
            map.entry(company_key(name)).or_insert(*ticker);
        }

        for (ticker, name) in crate::bist_universe::cached_symbols() {
            let key = company_key(&name);
            if key.is_empty() || map.contains_key(&key) {
                continue;
            }
            // Dizin `'static` tutuyor; önbellekten gelen kodlar çalışma
            // boyunca yaşadığı için sızdırmak güvenli ve tek seferliktir.
            map.insert(key, Box::leak(ticker.into_boxed_str()));
        }

        // Takma adlar en sona: gerçek bir unvanla çakışırlarsa evrenin kaydı
        // korunur.
        for (name, ticker) in NAME_ALIASES {
            map.entry(company_key(name)).or_insert(*ticker);
        }

        map
    })
}

/// Unvana karşılık gelen BIST kodu. Eşleşme yoksa `None` — kod uydurulmaz.
pub fn bist_ticker_for(company_name: &str) -> Option<&'static str> {
    let key = company_key(company_name);
    // Çok kısa anahtar ayırt edici değildir; yanlış eşleşme riski taşır.
    if key.len() < 5 {
        return None;
    }
    ticker_index().get(&key).copied()
}

/// Aynı şirketin bütün pay grubu kodları — verilen kod da listede olur.
///
/// İş Bankası borsada ISATR, ISBTR ve ISCTR olarak işlem görür; sermaye
/// artırımı **şirkete** aittir, üç kodu da ilgilendirir. Unvan → kod dizini
/// tek kod tuttuğu için resmî kayıt yalnız birine bağlanıyor, kardeş kodlar
/// Yahoo satırıyla kalıyor ve aynı artırım listede iki kez, iki ayrı tarih ve
/// kaynakla görünüyordu.
///
/// Kod dizinde yoksa yalnız kendisi döner; uydurma akrabalık kurulmaz.
pub fn sibling_tickers(ticker: &str) -> Vec<&'static str> {
    static GROUPS: OnceLock<HashMap<String, Vec<&'static str>>> = OnceLock::new();
    static OF_TICKER: OnceLock<HashMap<String, String>> = OnceLock::new();

    let groups = GROUPS.get_or_init(|| {
        let mut map: HashMap<String, Vec<&'static str>> = HashMap::new();
        for (code, name) in crate::yahoo::BIST_TICKERS {
            map.entry(company_key(name)).or_default().push(code);
        }
        for (code, name) in crate::bist_universe::cached_symbols() {
            let key = company_key(&name);
            let codes = map.entry(key).or_default();
            let code: &'static str = Box::leak(code.into_boxed_str());
            if !codes.contains(&code) {
                codes.push(code);
            }
        }
        map.retain(|key, _| !key.is_empty());
        map
    });

    let of_ticker = OF_TICKER.get_or_init(|| {
        let mut map = HashMap::new();
        for (key, codes) in groups {
            for code in codes {
                map.insert((*code).to_string(), key.clone());
            }
        }
        map
    });

    match of_ticker.get(ticker).and_then(|key| groups.get(key)) {
        Some(codes) => codes.clone(),
        None => Vec::new(),
    }
}

/// İki unvan aynı şirkete mi ait?
///
/// Tek eşleştirme ölçütü budur; modüller kendi normalleştirmesini yazmamalı.
/// Üç ayrı sürüm dolaşırken biri "sanayii"yi (çift i) ayırt edici sayıyor ve
/// "Pilsan Plastik ve Oyuncak Sanayii" ile "… Sanayi" arşivde iki ayrı kayıt
/// olarak duruyordu.
pub fn same_company(a: &str, b: &str) -> bool {
    let key = company_key(a);
    if !key.is_empty() {
        return key == company_key(b);
    }
    // Anahtar tamamen eriyorsa (unvan yalnız hukuki form ekinden ibaretse)
    // ham metne düşülür. Boş anahtarı eşleşme saymak her unvanı birbirine
    // bağlar; eşleşmez saymak ise kaydın **kendisiyle** de eşleşmemesi
    // demektir ve her turda arşive bir kopya daha eklenirdi.
    a.trim().eq_ignore_ascii_case(b.trim())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_ignores_legal_form_spacing_and_turkish_letters() {
        assert_eq!(company_key("Joy Game Oyun ve Teknoloji A.Ş."), company_key("Joygame Oyun ve Teknoloji AŞ"));
        assert_eq!(company_key("KARSU TEKSTİL SANAYİİ VE TİCARET A.Ş."), company_key("Karsu Tekstil Sanayii ve Ticaret AŞ"));
        assert_eq!(company_key("Katılımevim Tasarruf Finansman AŞ"), "katilimevimtasarruffinansman");
    }

    #[test]
    fn different_companies_keep_different_keys() {
        assert_ne!(company_key("Akfen İnşaat Turizm ve Ticaret AŞ"), company_key("Akfen Yenilenebilir Enerji AŞ"));
    }

    /// SPK bülteninde geçen gerçek unvanlar BIST kodlarına bağlanmalı.
    #[test]
    fn real_bulletin_names_resolve_to_tickers() {
        let cases = [
            ("Derlüks Yatırım Holding AŞ", "DERHL"),
            ("Dinamik Isı Makina Yalıtım Malzemeleri Sanayi ve Ticaret AŞ", "DNISI"),
            ("Vişne Madencilik Üretim Sanayi ve Ticaret AŞ", "VSNMD"),
            ("CVK Maden İşletmeleri Sanayi ve Ticaret AŞ", "CVKMD"),
            ("Karsu Tekstil Sanayii ve Ticaret AŞ", "KRTEK"),
            ("Katılımevim Tasarruf Finansman AŞ", "KTLEV"),
        ];
        for (name, expected) in cases {
            assert_eq!(bist_ticker_for(name), Some(expected), "{name}");
        }
    }

    #[test]
    fn unknown_and_too_short_names_do_not_match() {
        assert_eq!(bist_ticker_for("Hiç Olmayan Bir Şirket AŞ"), None);
        assert_eq!(bist_ticker_for("AŞ"), None);
    }

    /// Kaynaklar aynı ortaklığı hem açık hem kısaltılmış yazıyor.
    #[test]
    fn abbreviated_and_spelled_out_forms_match() {
        assert!(same_company(
            "Savur Gayrimenkul Yatırım Ortaklığı A.Ş.",
            "Savur GYO"
        ));
        assert!(same_company(
            "Tera Girişim Sermayesi Yatırım Ortaklığı AŞ",
            "Tera GSYO"
        ));
        // Kısaltma açılırken farklı ortaklık türleri birbirine karışmamalı.
        assert!(!same_company("Örnek Gayrimenkul Yatırım Ortaklığı AŞ", "Örnek GSYO"));
    }

    /// Regresyon: "… Türk A.Ş." ile "… T.A.Ş." aynı unvanın iki yazımı.
    /// Ayırt edici sayılınca GOODY'nin bedelsizi SPK kaydına bağlanamıyor ve
    /// listede "Yahoo Finance" kaynaklı görünüyordu — oysa her sermaye artırımı
    /// SPK onayıyla yapılır.
    #[test]
    fn trailing_turk_is_a_legal_form_suffix() {
        assert!(same_company("Goodyear Lastikleri Türk AŞ", "GOODYEAR LASTİKLERİ T.A.Ş."));
        assert_eq!(bist_ticker_for("Goodyear Lastikleri Türk AŞ"), Some("GOODY"));
        assert_eq!(bist_ticker_for("Şekerbank Türk AŞ"), Some("SKBNK"));
    }

    /// `pdf_extract` "T.A.Ş."yi "TAŞ" olarak veriyor; bu kalıntı da elenmeli
    /// yoksa bültendeki unvan KAP'takine bağlanamaz.
    #[test]
    fn pdf_extracted_tas_suffix_matches_the_dotted_form() {
        assert!(same_company(
            "Ereğli Demir ve Çelik Fabrikaları TAŞ",
            "EREĞLİ DEMİR VE ÇELİK FABRİKALARI T.A.Ş."
        ));
        assert_eq!(bist_ticker_for("Hektaş Ticaret TAŞ"), Some("HEKTS"));
        assert_eq!(bist_ticker_for("Ereğli Demir ve Çelik Fabrikaları TAŞ"), Some("EREGL"));
    }

    /// Bültenin marka/eski unvanı kullandığı doğrulanmış durumlar.
    #[test]
    fn verified_aliases_resolve() {
        assert_eq!(bist_ticker_for("Erdemir Demir ve Çelik Fabrikaları TAŞ"), Some("EREGL"));
        assert_eq!(bist_ticker_for("Türkiye Petrol Rafinerileri AŞ"), Some("TUPRS"));
        assert_eq!(bist_ticker_for("Matriks Bilgi Dağıtım Hizmetleri AŞ"), Some("MTRKS"));
        // Takma ad listesi bir kural değil; listede olmayan benzer unvan
        // yine de kod uydurmamalı.
        assert_eq!(bist_ticker_for("Pera Yatırım Holding AŞ"), None);
    }

    /// "Makina"/"Makine" aynı sözcüğün iki yazımı.
    #[test]
    fn spelling_variants_are_folded() {
        assert!(same_company("İmaş Makine Sanayi AŞ", "İMAŞ MAKİNA SANAYİ A.Ş."));
        assert_eq!(bist_ticker_for("Makim Makine Teknolojileri Sanayi ve Ticaret AŞ"), Some("MAKIM"));
    }

    /// Baştaki "Türk" ve unvan içindeki "Taş" ayırt edicidir; elenirse farklı
    /// şirketler birbirine karışır.
    #[test]
    fn leading_turk_and_inner_tas_are_kept() {
        assert!(company_key("Türk Hava Yolları A.O.").starts_with("turk"));
        assert!(!same_company("Türk Traktör ve Ziraat Makineleri AŞ", "Ziraat Makineleri AŞ"));
        assert!(company_key("Akıllı Taş Madencilik Sanayi AŞ").contains("tas"));
        assert!(!same_company("Akıllı Taş Madencilik AŞ", "Akıllı Madencilik AŞ"));
        // Tek kelimelik unvan boşalmamalı.
        assert_eq!(company_key("Türk A.Ş."), "turk");
    }

    /// Regresyon: "sanayii" (çift i) ayırt edici sayıldığında aynı şirket
    /// arşivde iki kayıt olarak duruyordu.
    #[test]
    fn spelling_variants_of_the_same_company_match() {
        assert!(same_company(
            "Pilsan Plastik ve Oyuncak Sanayii A.Ş.",
            "Pilsan Plastik ve Oyuncak Sanayi A.Ş."
        ));
        assert!(same_company("Kapeks Kimya Sanayi AŞ", "Kapeks Kimya Sanayi A.Ş."));
        assert!(!same_company("Kapeks Kimya Sanayi AŞ", "Orzaks İlaç Sanayi AŞ"));
    }

    /// Anahtarı tamamen eriyen unvan **kendisiyle** eşleşmeli; yoksa arşiv
    /// her turda bir kopya daha biriktirir.
    #[test]
    fn a_name_that_reduces_to_nothing_still_matches_itself() {
        assert_eq!(company_key("Ve A.Ş."), "");
        assert!(same_company("Ve A.Ş.", "Ve A.Ş."));
        assert!(!same_company("Ve A.Ş.", "Ticaret Ltd. Şti."));
    }
}
