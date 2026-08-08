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

/// Unvanı karşılaştırılabilir bir anahtara indirir.
///
/// "Katılımevim Tasarruf Finansman AŞ" → `katilimevimtasarruffinansman`
///
/// Boşluklar da atıldığı için "Joy Game" ile "Joygame" aynı anahtarı verir.
pub fn company_key(name: &str) -> String {
    let folded: String = name.chars().map(fold_char).collect::<String>().to_lowercase();

    folded
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| {
            // "A.Ş." / "T.A.Ş." noktalardan bölününce tek harflik parçalara
            // ayrışıyor; bunlar unvanın parçası değil, hukuki form kırıntısı.
            // Rakam içeren tek karakter (A1 Capital'deki "a1") korunur.
            !word.is_empty()
                && !FILLER_WORDS.contains(word)
                && !(word.chars().count() == 1 && word.chars().all(char::is_alphabetic))
        })
        .collect()
}

/// Anahtar → BIST kodu dizini; BIST evreninden bir kez kurulur.
fn ticker_index() -> &'static HashMap<String, &'static str> {
    static INDEX: OnceLock<HashMap<String, &'static str>> = OnceLock::new();
    INDEX.get_or_init(|| {
        let mut map = HashMap::new();
        for (ticker, name) in crate::yahoo::BIST_TICKERS {
            // Aynı anahtara birden çok kod düşerse ilki korunur; evrende
            // yinelenen unvan pratikte yok, ama sessizce üzerine yazmak
            // yanlış kodu kalıcı hâle getirirdi.
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
}
