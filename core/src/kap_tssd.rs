//! Tasarruf Sahiplerine Satış Duyurusu (TSSD) okuyucu.
//!
//! TSSD, halka arzın **fiyatını ve talep toplama tarihlerini taşıyan tek
//! resmî belgedir ve arzdan önce yayımlanır**. İzahname onayı bunları
//! içermez: fiyat izahname onaylandıktan sonra belirlenir ve izahname
//! "EK 8: Fiyat Tespit Raporu"na havale eder. KAP'ın yapısal bildirimleri de
//! geç kalır — talep toplama tarihi ancak arz bitip pay işleme açıldığında
//! ("Payların İşlem Görmeye Başlaması") yapısal alan olarak geliyor. Yani
//! yaklaşan bir arzın tarihini bugüne kadar yalnız halkarz.com söylüyordu.
//!
//! **Bildirim gövdesi boştur; içerik PDF ekindedir.** Zincir `kap_pdr` ile
//! aynı: `notification/attachment-detail/{index}` → `objId` →
//! `file/download/{objId}`; dosya Java-serialization sargısıyla gelir, gerçek
//! içerik `%PDF` imzasından başlar.
//!
//! **PDF'lerin çoğu taranmıştır ve okunamaz.** 210 günlük 45 duyurunun 22'si
//! ölçüldü: 18'i görüntü, 4'ü metin; güncel dört halka arz duyurusunda oran
//! daha da kötü (yalnız TKNKA metin, CITAS/VEYAS/KPEKS taranmış). Taranmış
//! duyuru **sessizce boş dönmez**: ayırt edilir, numarası
//! [`crate::ipo_follow::FollowState::scanned_notices`] listesine yazılır ve
//! günlüğe düşer, yani kaç arzın bu yüzden eksik kaldığı görünür.
//!
//! Görüntüden okuma (OCR/AI) buraya **bilerek konmadı**: `kap_pdr`'nin PDR
//! raporları için yazdığı sayfa görüntüsü çıkarıcısı bu belgelerde çalışmıyor
//! (duyuru taramaları sayfayı tek JPEG olarak gömmüyor; CCITTFax parçaları ve
//! Flate sarmalı JPEG'ler geliyor, çıkarıcı sıfır görüntü buluyor). Çalışmayan
//! bir yolu "destekleniyor" diye bırakmaktansa eksiklik açıkça raporlanıyor.
//!
//! **Duyuru başlığı halka arza özgü değildir.** Borsada işlem gören
//! şirketlerin rüçhan haklı sermaye artırımları da aynı başlığı kullanıyor
//! (210 günlük örneklemin çoğunluğu böyleydi: FENER, DİTAŞ, KENT…). Bu yüzden
//! ayrıştırıcı yalnız *halka arz* kalıplarını okur ve rüçhan duyurusundan boş
//! döner; hangi kaydın izlendiğine `ipo_follow` karar verir.

use crate::kap_ipo::KapIpoExtractedData;
use serde::Deserialize;

const BASE_URL: &str = "https://www.kap.org.tr/tr";
const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(45);

/// Sayfa başına bu kadar karakterin altındaki PDF taranmış sayılır.
///
/// Ölçüm: metin katmanlı duyurular 1.600-1.800 krk/sayfa, taranmışlar 0-200
/// (imza damgası ve doğrulama bağlantısı metin katmanında kalıyor, gövde
/// görüntüde). Eşik ikisinin ortasında.
const TEXT_LAYER_MIN_CHARS_PER_PAGE: usize = 400;

/// Ekin indirilmiş hâli.
pub enum TssdSource {
    Text(String),
    /// Metin katmanı yok; gövde sayfa görüntülerinde ve okunamıyor.
    Scanned { pages: usize },
}

#[derive(Deserialize)]
struct AttachmentDetail {
    #[serde(default)]
    attachments: Vec<Attachment>,
}

#[derive(Deserialize)]
struct Attachment {
    #[serde(rename = "objId")]
    obj_id: String,
}

/// Duyuru ekini indirir ve metin katmanı olup olmadığına karar verir.
pub async fn fetch_tssd(
    client: &reqwest::Client,
    disclosure_index: &str,
) -> Result<TssdSource, String> {
    // İzin iki adım boyunca tutulur: ek listesi ile dosya aynı kotadan geçiyor
    // ve arada bırakmak bağlantıyı iki kez açmak olurdu (bkz. kap_pdr).
    let _permit = crate::retry::kap_permit().await;

    let detail = client
        .get(format!("{BASE_URL}/api/notification/attachment-detail/{disclosure_index}"))
        .timeout(REQUEST_TIMEOUT)
        .header("User-Agent", crate::yahoo::YAHOO_USER_AGENT)
        .send()
        .await
        .map_err(|error| format!("TSSD ek listesi: {error}"))
        .and_then(|response| crate::retry::check_status(response, "TSSD ek listesi"))?
        .json::<Vec<AttachmentDetail>>()
        .await
        .map_err(|error| format!("TSSD ek listesi çözümlenemedi: {error}"))?;

    let obj_id = detail
        .first()
        .and_then(|d| d.attachments.first())
        .map(|a| a.obj_id.clone())
        .ok_or("TSSD bildiriminde ek bulunamadı.")?;

    let raw = client
        .get(format!("{BASE_URL}/api/file/download/{obj_id}"))
        .timeout(REQUEST_TIMEOUT)
        .header("User-Agent", crate::yahoo::YAHOO_USER_AGENT)
        .send()
        .await
        .map_err(|error| format!("TSSD dosya indirme: {error}"))
        .and_then(|response| crate::retry::check_status(response, "TSSD dosya indirme"))?
        .bytes()
        .await
        .map_err(|error| format!("TSSD dosyası okunamadı: {error}"))?;

    let pdf = strip_java_wrapper(&raw).ok_or("İndirilen TSSD dosyası PDF değil.")?;
    Ok(classify_pdf(pdf))
}

/// KAP'ın dosya ucu içeriği Java-serialization sargısında döndürür; gerçek
/// dosya `%PDF` imzasından başlar.
fn strip_java_wrapper(raw: &[u8]) -> Option<&[u8]> {
    let start = raw.windows(4).position(|window| window == b"%PDF")?;
    Some(&raw[start..])
}

/// Metin katmanı yeterli mi?
///
/// Eşik sayfa **başına** bakar: taranmış duyurularda da imza damgası ve SPK
/// doğrulama bağlantısı metin katmanında kalıyor, yani "hiç metin yok" diye
/// bakmak taranmışları metin sanardı (ölçüm: taranmışlarda 0-200, metin
/// katmanlılarda 1.600-1.800 karakter/sayfa).
fn classify_pdf(pdf: &[u8]) -> TssdSource {
    let text = pdf_extract::extract_text_from_mem(pdf).unwrap_or_default();
    let pages = page_count(pdf).max(1);
    if text.chars().count() / pages >= TEXT_LAYER_MIN_CHARS_PER_PAGE {
        TssdSource::Text(text)
    } else {
        TssdSource::Scanned { pages }
    }
}

fn page_count(pdf: &[u8]) -> usize {
    pdf_extract::Document::load_mem(pdf)
        .map(|document| document.get_pages().len())
        .unwrap_or(1)
}

// ─── Metin ayrıştırıcı ────────────────────────────────────────────────────
//
// Kalıplar canlı belgeden alındı (TKNKA, bildirim 1645150). Değerler
// **etiketli alan değil, cümle içindedir**: "Halka arz fiyatı: 85,40" diye
// aramak sıfır sonuç verir, belgede "85,40 TL'den satışa sunulacaktır" yazar.
// Bu yüzden alanlar etiketle değil cümle kalıbıyla okunur.

/// Duyuru metnini arşiv alanlarına çevirir.
///
/// Metin **önce normalleştirilir**: PDF satır sonlarını cümlenin ortasına
/// atıyor ("…31.000.000 TL nominal\ndeğerli…") ve boşluğa duyarlı her kalıp
/// bu yüzden tutmuyordu. Kesme işareti de belgeden belgeye değişiyor
/// (U+2019 / ASCII / ters tırnak).
pub fn parse_tssd(raw_text: &str) -> KapIpoExtractedData {
    let text = normalize(raw_text);

    let mut data = KapIpoExtractedData {
        price: parse_price(&text),
        book_building_dates: parse_dates(&text),
        consortium_lead: parse_broker(&text),
        company_name: parse_company(raw_text),
        ..KapIpoExtractedData::default()
    };

    let structure = parse_share_structure(&text);
    data.lot_amount = structure.total_lots.map(|lots| format!("{} Lot", group_thousands(lots)));
    data.total_lots = structure.total_lots.map(|lots| lots as f64);
    data.share_structure = structure.description;

    data
}

/// Boşlukları teke indirir ve kesme işaretlerini tekleştirir.
fn normalize(text: &str) -> String {
    let unified: String = text
        .chars()
        .map(|c| match c {
            '\u{2019}' | '\u{2018}' | '`' | '\u{00B4}' => '\'',
            c => c,
        })
        .collect();
    unified.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn regex(pattern: &str) -> regex::Regex {
    regex::Regex::new(pattern).expect("geçerli regex")
}

/// "1 TL nominal değerli paylar 85,40 TL'den satışa sunulacaktır."
fn parse_price(text: &str) -> Option<f64> {
    let re = regex(r"([\d.]+,\d{1,2})\s*TL'?\s*den\s+sat[ıi]şa\s+sunul");
    let captures = re.captures(text)?;
    decimal(captures.get(1)?.as_str())
}

/// "12.08.2026 ile 14.08.2026 tarihleri arasında 3 iş günü süreyle satışa"
///
/// Arşivin biçimi gün listesidir ("12-13-14 Ağustos 2026"); listede
/// gösterilen bütün kayıtlar böyle yazılmış ve arayüz onu bekliyor. Aralık
/// beş günü aşarsa (rüçhan hakkı kullanımı 15 gün sürebiliyor) gün listesi
/// anlamını yitirir, aralık olduğu gibi yazılır.
fn parse_dates(text: &str) -> Option<String> {
    let re = regex(
        r"(\d{2}\.\d{2}\.\d{4})\s*(?:ile|ila|-|—)\s*(\d{2}\.\d{2}\.\d{4})\s*tarihleri\s+aras[ıi]nda",
    );
    let captures = re.captures(text)?;
    let start = date(captures.get(1)?.as_str())?;
    let end = date(captures.get(2)?.as_str())?;
    if end < start {
        return None;
    }

    let days = (end - start).num_days();
    if days > 4 {
        return Some(format!("{} - {}", turkish_date(start), turkish_date(end)));
    }

    let mut cursor = start;
    let mut list = Vec::new();
    while cursor <= end {
        list.push(cursor.format("%-d").to_string());
        cursor += chrono::Duration::days(1);
    }
    Some(format!("{} {}", list.join("-"), turkish_month_year(end)))
}

/// "halka arzda satışa aracılık edecek Tera Yatırım Menkul Değerler Anonim
/// Şirketi'nin (www…)" — unvan aracı kurumun kendi internet sitesinden önce
/// biter.
fn parse_broker(text: &str) -> Option<String> {
    let re = regex(
        r"(?:sat[ıi]şa\s+arac[ıi]l[ıi]k\s+ede(?:cek|n)|halka\s+arza\s+arac[ıi]l[ıi]k\s+eden(?:\s+yetkili\s+kuruluş)?)\s+([^(]{6,120}?)\s*(?:'?n[ıi]n)?\s*\(",
    );
    let captures = re.captures(text)?;
    let name = captures.get(1)?.as_str().trim().trim_end_matches('\'').trim();
    (name.len() > 6).then(|| name.to_string())
}

/// İlk satır bloğu şirketin unvanıdır; hemen ardından belge adı gelir.
fn parse_company(raw_text: &str) -> Option<String> {
    let head: Vec<&str> = raw_text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(6)
        .collect();
    let stop = head
        .iter()
        .position(|line| line.to_uppercase().contains("TASARRUF SAHİPLERİNE"))?;
    let name = head[..stop].join(" ").trim().to_string();
    (name.len() > 8).then_some(name)
}

#[derive(Default)]
struct ShareStructure {
    total_lots: Option<u64>,
    description: Option<String>,
}

/// Sermaye artırımı + ortak satışı kırılımı.
///
/// Duyuru bunu tek cümlede anlatıyor: "çıkarılmış sermayesinin 100.000.000
/// TL'den 125.000.000 TL'ye çıkarılması nedeniyle artırılacak 25.000.000 TL
/// nominal değerli … pay ile mevcut pay sahiplerinden Kemal Yaralı'ya ait
/// toplam 3.000.000 TL nominal değerli … pay ve Ali Kutay Yaralı'ya ait …
/// olmak üzere toplam 31.000.000 TL nominal değerli … payın halka arzı".
///
/// Satan ortakların **adı da** okunur: arşivdeki pay yapısı alanı ortağı
/// parantez içinde gösteriyor ve kimin sattığı halka arzın en çok sorulan
/// ayrıntılarından biri.
fn parse_share_structure(text: &str) -> ShareStructure {
    let mut lines = Vec::new();

    let increase_match = regex(r"art[ıi]r[ıi]lacak\s+([\d.]+)\s*TL\s+nominal").captures(text);
    let increase = increase_match
        .as_ref()
        .and_then(|c| thousands(c.get(1)?.as_str()));
    if let Some(lots) = increase {
        lines.push(format!("Sermaye Artırımı : {} Lot", group_thousands(lots)));
    }

    let total_match = regex(r"olmak\s+üzere\s+toplam\s+([\d.]+)\s*TL\s+nominal").captures(text);

    // Satıcılar **yalnız arzı anlatan cümlenin içinde** aranır. Duyuru bu
    // cümleyi bir de giriş paragrafında tekrarlıyor (TKNKA 1645150 böyle) ve
    // metnin tamamını taramak her ortağı iki kez yazıyordu — sabit veriyle
    // yazılmış bir test bunu göremezdi, canlı belge gösterdi.
    let sentence_start = increase_match
        .as_ref()
        .and_then(|c| c.get(0))
        .map(|m| m.end())
        .unwrap_or(0);
    let sentence_end = total_match
        .as_ref()
        .and_then(|c| c.get(0))
        .map(|m| m.start())
        .filter(|end| *end > sentence_start)
        .unwrap_or(text.len());
    let sellers_segment = &text[sentence_start..sentence_end];

    // "mevcut pay sahiplerinden X'ya ait toplam N TL" ve ardından gelen
    // "ve Y'ya ait toplam M TL" — her satan ortak ayrı satır olur.
    //
    // Ad, kalıbın **öncesinden** geriye doğru okunur. Adı regex'in içinde
    // yakalamak işe yaramıyor: en soldan eşleşme cümlenin yarısını ada
    // katıyor ("B Grubu pay ve Ali Kutay Yaralı") ve hangi kelimenin adın
    // başladığı yer olduğu ancak büyük harf dizisine bakılarak bilinir.
    let seller = regex(r"'(?:y?[ae]|n[ıi]n)\s+ait\s+toplam\s+([\d.]+)\s*TL\s+nominal");
    let mut cursor = 0;
    for capture in seller.captures_iter(sellers_segment) {
        let whole = capture.get(0).expect("tam eşleşme");
        let Some(lots) = capture.get(1).and_then(|m| thousands(m.as_str())) else { continue };
        let name = trailing_proper_name(&sellers_segment[cursor..whole.start()]);
        cursor = whole.end();
        let line = match name {
            Some(name) => format!("Ortak Satışı : {} Lot ({name})", group_thousands(lots)),
            None => format!("Ortak Satışı : {} Lot", group_thousands(lots)),
        };
        // Cümle sınırı bulunamadıysa (tek satıcılı duyuruda "olmak üzere"
        // kurulmuyor) tekrar hâlâ mümkün; birebir aynı satır bilgi eklemez.
        if !lines.contains(&line) {
            lines.push(line);
        }
    }

    let total = total_match
        .and_then(|c| thousands(c.get(1)?.as_str()))
        // Tek kalemli arzda "olmak üzere" cümlesi kurulmuyor; toplam tek
        // rakamdır ve artırımın kendisidir.
        .or(increase.filter(|_| lines.len() == 1));

    ShareStructure {
        total_lots: total,
        description: (!lines.is_empty()).then(|| lines.join("\n")),
    }
}

/// Metnin sonundaki özel adı ayıklar.
///
/// Kural, Türkçe unvan yazımından çıkıyor: ad büyük harfle başlayan
/// kelimelerden oluşur ve cümlenin kalıp sözcükleri ("mevcut pay
/// sahiplerinden", "pay ve", "adet") küçük harflidir. Sondan geriye doğru
/// büyük harfli kelimeler alınır; "ve" yalnız **iki büyük harfli kelimenin
/// arasındaysa** ada dâhildir — böylece "Tic. ve San. A.Ş." bütün kalırken
/// "pay ve Ali Kutay Yaralı"nın başındaki bağlaç dışarıda kalır.
fn trailing_proper_name(before: &str) -> Option<String> {
    let words: Vec<&str> = before.split_whitespace().collect();
    let capitalized = |word: &str| word.chars().next().is_some_and(char::is_uppercase);

    let mut start = words.len();
    while start > 0 {
        let word = words[start - 1];
        if capitalized(word) {
            start -= 1;
            continue;
        }
        // Bağlaç: ancak iki yanı da adın parçasıysa geçilir.
        if word.eq_ignore_ascii_case("ve")
            && start < words.len()
            && start >= 2
            && capitalized(words[start - 2])
        {
            start -= 1;
            continue;
        }
        break;
    }

    let name = words[start..].join(" ");
    // Tek harflik "B" (pay grubu) ya da rakam içeren parça ad değildir; adsız
    // satır yazmak yanlış ad yazmaktan iyidir.
    let plausible = name.chars().count() > 3 && !name.chars().any(|c| c.is_ascii_digit());
    plausible.then_some(name)
}

fn thousands(raw: &str) -> Option<u64> {
    raw.replace('.', "").parse().ok()
}

fn decimal(raw: &str) -> Option<f64> {
    raw.replace('.', "").replace(',', ".").parse().ok()
}

fn group_thousands(value: u64) -> String {
    let digits = value.to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push('.');
        }
        out.push(c);
    }
    out
}

fn date(raw: &str) -> Option<chrono::NaiveDate> {
    chrono::NaiveDate::parse_from_str(raw, "%d.%m.%Y").ok()
}

const MONTHS: [&str; 12] = [
    "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
    "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

fn turkish_month_year(date: chrono::NaiveDate) -> String {
    use chrono::Datelike as _;
    format!("{} {}", MONTHS[date.month0() as usize], date.year())
}

fn turkish_date(date: chrono::NaiveDate) -> String {
    use chrono::Datelike as _;
    format!("{} {}", date.day(), turkish_month_year(date))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// TKNKA, bildirim 1645150 — PDF'ten çıkarılan metin birebir alındı
    /// (satır sonları dâhil: kalıpların satır ortasına düşen kırılmalara
    /// dayanması gerekiyor).
    const TKNKA: &str = "  \n \n \n \nTEKNİKA PLAST TEKNİK KALIP PLASTİK SANAYİ VE TİCARET ANONİM \nŞİRKETİ  \nTASARRUF SAHİPLERİNE SATIŞ DUYURUSU \n \nBu Tasarruf Sahiplerine Satış Duyurusu (“Duyuru”), Sermaye Piyasası Kurulu \n(Kurul)’nca 05.08.2026 tarihinde onaylanmıştır. \nOrtaklığımızın çıkarılmış sermayesinin 100.000.000 TL’den 125.000.000 TL’ye çıkarılması \nnedeniyle artırılacak 25.000.000 TL nominal değerli 25.000.000 adet B Grubu pay ile \nmevcut pay sahiplerinden Kemal Yaralı’ya ait toplam 3.000.000 TL nominal değerli \n3.000.000 adet B Grubu pay ve Ali Kutay Yaralı’ya ait toplam 3.000.000 TL nominal \ndeğerli 3.000.000 adet B Grubu pay olmak üzere toplam 31.000.000 TL nominal değerli \n31.000.000 adet B Grubu hamiline yazılı payın halka arzı için hazırlanan İzahname, \nKurulca 05.08.2026 tarihinde onaylanmış olup, ortaklığımız ve halka arz edilecek paylar \nile ilgili ayrıntılı bilgileri içeren İzahname ortaklığımızın (www.teknikaplast.com.tr) ve \nhalka arzda satışa aracılık edecek Tera Yatırım Menkul Değerler Anonim Şirketi’nin \n(www.terayatirim.com) adresli internet siteleri ile Kamuyu Aydınlatma Platformu \n(“KAP”)’nda (www.kap.org.tr) tarihinde yayımlanmıştır. \n1. PAYLARIN HALKA ARZINA İLİŞKİN BİLGİ \na) Halka Arz Süresi: Halka arz edilecek olan 31.000.000 TL nominal değerli 31.000.000 adet \nB Grubu hamiline yazılı paylar 12.08.2026 ile 14.08.2026 tarihleri arasında 3 iş günü süreyle \nsatışa sunulacaktır. \nBir payın nominal değeri 1 TL olup, 1 TL nominal değerli paylar 85,40 TL’den satışa \nsunulacaktır. \n";

    /// Duyurunun taşıdığı her alan tek geçişte çıkmalı. Arşivdeki TKNKA
    /// kaydıyla karşılaştırıldı: fiyat 85,40 ve tarihler birebir tutuyor.
    #[test]
    fn reads_every_field_from_a_real_notice() {
        let data = parse_tssd(TKNKA);

        assert_eq!(data.price, Some(85.40));
        assert_eq!(data.book_building_dates.as_deref(), Some("12-13-14 Ağustos 2026"));
        assert_eq!(data.lot_amount.as_deref(), Some("31.000.000 Lot"));
        assert_eq!(data.total_lots, Some(31_000_000.0));
        assert_eq!(
            data.consortium_lead.as_deref(),
            Some("Tera Yatırım Menkul Değerler Anonim Şirketi")
        );
        assert!(data
            .company_name
            .as_deref()
            .is_some_and(|name| name.starts_with("TEKNİKA PLAST")));
    }

    /// Pay yapısı arşivin biçiminde ve satan ortakların adıyla çıkmalı.
    #[test]
    fn reads_the_share_structure_with_seller_names() {
        let structure = parse_tssd(TKNKA).share_structure.expect("pay yapısı okunmalı");
        let lines: Vec<&str> = structure.lines().collect();

        assert_eq!(lines[0], "Sermaye Artırımı : 25.000.000 Lot");
        assert_eq!(lines[1], "Ortak Satışı : 3.000.000 Lot (Kemal Yaralı)");
        assert_eq!(lines[2], "Ortak Satışı : 3.000.000 Lot (Ali Kutay Yaralı)");
        // Kırılım toplamı duyurunun yazdığı toplamla tutmalı.
        assert_eq!(25_000_000 + 3_000_000 + 3_000_000, 31_000_000);
    }

    /// Satan ortak çoğu arzda bir şirket ve unvanı "Tic. ve San. A.Ş." diye
    /// bitiyor: içindeki "ve" adın parçası, cümlenin bağlacı değil. Metin
    /// VEYAS duyurusunun yazımından alındı.
    #[test]
    fn a_corporate_seller_keeps_the_ve_inside_its_title() {
        let text = "Ortaklığımızın çıkarılmış sermayesinin artırılması nedeniyle artırılacak \
                    37.500.000 TL nominal değerli 37.500.000 adet pay ile mevcut pay \
                    sahiplerinden Türkerler İnşaat Turizm Madencilik Enerji Üretim Tic. ve San. \
                    A.Ş.'ye ait toplam 27.500.000 TL nominal değerli 27.500.000 adet pay olmak \
                    üzere toplam 65.000.000 TL nominal değerli payın halka arzı";
        let structure = parse_tssd(text).share_structure.expect("pay yapısı okunmalı");
        let lines: Vec<&str> = structure.lines().collect();

        assert_eq!(lines[0], "Sermaye Artırımı : 37.500.000 Lot");
        assert_eq!(
            lines[1],
            "Ortak Satışı : 27.500.000 Lot (Türkerler İnşaat Turizm Madencilik Enerji Üretim Tic. ve San. A.Ş.)"
        );
        assert_eq!(parse_tssd(text).lot_amount.as_deref(), Some("65.000.000 Lot"));
    }

    /// Adı okunamayan satıcıda satır **adsız** yazılır; yanlış ad yazmak
    /// (cümlenin yarısını ada katmak) sessizce yanlış veri üretirdi.
    #[test]
    fn an_unreadable_seller_name_is_left_out() {
        assert_eq!(trailing_proper_name("adet B Grubu pay ve 3.000.000"), None);
        assert_eq!(trailing_proper_name("mevcut pay sahiplerinden"), None);
        assert_eq!(
            trailing_proper_name("adet B Grubu pay ve Ali Kutay Yaralı").as_deref(),
            Some("Ali Kutay Yaralı")
        );
    }

    /// Aynı başlık rüçhan haklı sermaye artırımlarında da kullanılıyor (210
    /// günlük örneklemin çoğunluğu). Halka arz kalıpları tutmadığı için
    /// ayrıştırıcı **boş** dönmeli; yarım okunmuş bir duyuru arşive rüçhan
    /// verisini halka arz gibi yazardı.
    #[test]
    fn a_rights_issue_notice_yields_nothing() {
        let text = "ARÇELİK A.Ş.\nTASARRUF SAHİPLERİNE SATIŞ DUYURUSU\n\
                    Ortaklığımızın çıkarılmış sermayesinin artırılması nedeniyle ihraç edilecek \
                    paylardan yeni pay alma haklarının kullanılmasından sonra kalan paylar \
                    01.09.2026 ile 15.09.2026 tarihleri arasında Borsa'da satışa sunulacaktır.";
        let data = parse_tssd(text);
        assert_eq!(data.price, None, "rüçhan duyurusunda halka arz fiyatı yok");
        assert_eq!(data.share_structure, None);
    }

    /// Beş günü aşan satış süresi gün listesi olarak yazılmamalı: rüçhan
    /// kullanımı 15 gün sürebiliyor ve "1-2-3-…-15 Eylül" okunaksız.
    #[test]
    fn a_long_window_is_written_as_a_range() {
        let text = "paylar 01.09.2026 ile 15.09.2026 tarihleri arasında satışa sunulacaktır.";
        assert_eq!(
            parse_dates(&normalize(text)).as_deref(),
            Some("1 Eylül 2026 - 15 Eylül 2026")
        );
    }

    /// Satır sonu cümlenin ortasına düştüğünde de okunmalı — PDF metni her
    /// zaman böyle geliyor ve normalleştirme olmadan kalıpların hiçbiri
    /// tutmuyordu.
    #[test]
    fn line_breaks_inside_a_sentence_do_not_break_the_patterns() {
        let text = "1 TL nominal değerli paylar 73,70\nTL’den satışa\nsunulacaktır.";
        assert_eq!(parse_tssd(text).price, Some(73.70));
    }

    /// Binlik ayracı arşivin biçiminde yazılır.
    #[test]
    fn thousands_round_trip() {
        assert_eq!(group_thousands(31_000_000), "31.000.000");
        assert_eq!(group_thousands(850), "850");
        assert_eq!(thousands("25.000.000"), Some(25_000_000));
        assert_eq!(decimal("85,40"), Some(85.40));
        assert_eq!(decimal("1.234,50"), Some(1234.50));
    }

    /// Canlı uçla sözleşme sınaması: ek zinciri (`attachment-detail` → `objId`
    /// → `file/download`), Java sargısının soyulması, metin/taranmış ayrımı ve
    /// alan kalıpları birlikte doğrulanır. Zincirin herhangi bir halkası
    /// değişirse modül sessizce boş dönmesin.
    ///
    /// TKNKA (1645150) örneklemdeki tek metin katmanlı halka arz duyurusu;
    /// kalıpların gerçek bir belgede tuttuğunun kanıtı.
    #[tokio::test]
    #[ignore = "canlı KAP erişimi gerektirir"]
    async fn live_notice_is_read_end_to_end() {
        let client = crate::http_client();
        let source = fetch_tssd(&client, "1645150").await.expect("duyuru indirilmeli");
        let TssdSource::Text(text) = source else {
            panic!("1645150'in metin katmanı vardı; taranmış görünüyorsa sınıflandırma kopmuş");
        };

        let data = parse_tssd(&text);
        println!("{data:#?}");
        assert_eq!(data.price, Some(85.40), "arşivdeki TKNKA fiyatı 85,40");
        assert_eq!(data.book_building_dates.as_deref(), Some("12-13-14 Ağustos 2026"));
        assert_eq!(data.lot_amount.as_deref(), Some("31.000.000 Lot"));
        assert!(data.share_structure.is_some_and(|s| s.lines().count() == 3));
    }

    /// Taranmış duyuru **metin sanılmamalı**. Ayrım yanlış tarafa düşerse
    /// boş metin ayrıştırılır, duyuru "okundu" sayılır ve eksiklik görünmez
    /// olur; oysa taranmışların açıkça raporlanması gerekiyor.
    #[tokio::test]
    #[ignore = "canlı KAP erişimi gerektirir"]
    async fn live_scanned_notice_is_recognised_as_scanned() {
        let client = crate::http_client();
        // VEYAS (1644892): örneklemdeki taranmış duyurulardan biri.
        match fetch_tssd(&client, "1644892").await.expect("duyuru indirilmeli") {
            TssdSource::Scanned { pages } => {
                println!("taranmış, {pages} sayfa");
                assert!(pages > 0);
            }
            TssdSource::Text(text) => {
                panic!("taranmış bekleniyordu, {} karakter metin geldi", text.len())
            }
        }
    }
}
