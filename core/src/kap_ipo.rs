//! KAP bildirimlerinden halka arz sürecine özgü olanları süzer.
//!
//! Mevcut `kap.rs` bildirimleri genel amaçlıdır (ticker bazlı). Bu modül
//! izahname, fiyat tespit, satış duyurusu ve sonuç bildirimlerini ayıklar.
//!
//! **Başlık tek başına halka arz kanıtı değildir.** "Tasarruf Sahiplerine
//! Satış Duyurusu" ve "Halka Arz Sonuçları" başlıkları, borsada zaten işlem
//! gören şirketlerin rüçhan haklı (bedelli) sermaye artırımlarında da
//! kullanılıyor: son iki yılda bu iki başlık altında geçen kodların tamamı —
//! FENER, HEKTS, BJKAS, TSKB … — mevcut şirketlere ait. Aynı şekilde
//! "İzahname (SPK Tarafından Onaylanan)" tahvil ve finansman bonosu ihraçları
//! için de yayımlanıyor. Bu yüzden bildirimler burada yalnız *aday* olarak
//! toplanır; halka arz olup olmadığına, SPK'nın onayladığı listeyle isim
//! eşleşmesi yapan `ipo_pipeline` karar verir.

use crate::kap::KapForm;
use reqwest::Client;
use serde::{Deserialize, Serialize};

/// Halka arz bildirim türü.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum KapIpoDisclosureType {
    /// İzahname (SPK tarafından onaylanan)
    Prospectus,
    /// İzahname (SPK onayına sunulan) — henüz onaylanmamış taslak
    ProspectusDraft,
    /// Fiyat tespit raporu ve analist değerlendirmeleri
    PriceReport,
    /// Tasarruf sahiplerine satış duyurusu
    SaleNotice,
    /// Halka arz sonuçları
    Result,
    /// Borsa İstanbul'un birincil piyasa duyurusu (pazar, kod, işlem tarihi)
    ExchangeNotice,
    /// Borsa İstanbul'un "Payların İşlem Görmeye Başlaması" duyurusu.
    ///
    /// Halka arz sürecinin **son** resmî belgesi ve ilk işlem tarihinin tek
    /// yapısal kaynağıdır. Başlığında "halka arz" geçmez; konu adıyla tanınır.
    Listing,
    /// Halka arzda payların %5'inden fazlasını alanlara ilişkin bildirim.
    MajorBuyers,
    /// Borsa İstanbul'un endeks değişikliği duyurusu — arzdan sonra hissenin
    /// hangi endekslere girdiğini verir.
    IndexChange,
    /// Halka arzla ilgili diğer bildirimler
    Other,
}

impl KapIpoDisclosureType {
    /// Bu türün gövdesi yapısal veri taşıyor mu?
    ///
    /// İzahname ve fiyat tespit raporlarının gövdesi boştur — içerik eke
    /// (PDF) konur ve export'ta yalnız "… ektedir." cümlesi kalır. Gövde
    /// ucunun kotası kıt; taşımayan türü indirmek turu boşa harcar.
    pub fn has_form_body(self) -> bool {
        matches!(
            self,
            KapIpoDisclosureType::Result
                | KapIpoDisclosureType::ExchangeNotice
                | KapIpoDisclosureType::Listing
                | KapIpoDisclosureType::MajorBuyers
                | KapIpoDisclosureType::IndexChange
        )
    }
}

/// Bir halka arz bildiriminin gövdesinden çıkan alanlar.
///
/// Tek bir bildirim bunların ancak birkaçını taşır; tür başına ayrı bir
/// ayrıştırıcı doldurur ve `ipo_pipeline` boş olan arşiv alanlarına işler.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct KapIpoExtractedData {
    /// Bildirimin konusu olan şirketin unvanı — gövdede yazar ve kodsuz
    /// arşiv kaydını eşleştirmenin tek yoludur (bildirimi aracı kurum yapar).
    pub company_name: Option<String>,
    pub price: Option<f64>,
    pub total_lots: Option<f64>,
    pub ipo_size_tl: Option<f64>,
    pub book_building_dates: Option<String>,
    pub trading_start_date: Option<String>,
    pub distribution_type: Option<String>,
    pub consortium_lead: Option<String>,
    pub participant_count: Option<String>,
    pub distribution_ratios: Option<String>,
    pub fund_usage: Option<String>,
    pub katilim_index: Option<String>,
    pub market: Option<String>,
    pub lot_amount: Option<String>,
    pub public_float_ratio: Option<String>,
    pub index_name: Option<String>,
    pub major_shareholders: Option<String>,
    /// Yatırımcı grubu bazında katılım tablosu.
    pub results_table: Option<Vec<crate::ipo_scraper::IpoResultRow>>,
}

impl KapIpoExtractedData {
    /// Hiçbir alan dolmadıysa bildirim işe yaramamıştır.
    pub fn is_empty(&self) -> bool {
        *self == KapIpoExtractedData::default()
    }
}

/// Halka arz adayı bir KAP bildirimi.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct KapIpoDisclosure {
    /// Bildirimin **konusu** olan şirketin unvanı — yalnız bildirimi yapan
    /// şirketin kendisi olduğunda listeden bilinir.
    ///
    /// Halka arz bildirimlerini konsorsiyum lideri ya da Borsa İstanbul yapar;
    /// o durumda unvan yalnız gövdede bulunur ve burası `None` kalır. Eskiden
    /// bu alana bildirimi yapanın unvanı yazılıyordu ve halka arz verisi aracı
    /// kurumun kaydına yapışıyordu.
    pub company_name: Option<String>,
    /// Bildirimi yapan şirketin unvanı (aracı kurum, Borsa İstanbul ya da
    /// şirketin kendisi).
    pub filer_name: String,
    /// Bildirimin konusu olan pay kodu.
    pub ticker: Option<String>,
    pub disclosure_type: KapIpoDisclosureType,
    pub publish_date: String,
    pub disclosure_index: String,
    /// Bildirimin KAP'taki kalıcı adresi — kullanıcıya resmi kaynak olarak
    /// gösterilir.
    pub url: String,
    pub extracted_data: Option<KapIpoExtractedData>,
}

/// Bildirim konusundan halka arz türünü belirler; ilgisizse `None`.
///
/// Türkçe küçültme sırası önemli: `to_lowercase` önce çalışırsa 'İ' iki koda
/// ayrışır ("i" + birleşen nokta) ve düz metin araması tutmaz.
pub fn classify_disclosure(subject: &str) -> Option<KapIpoDisclosureType> {
    let text = crate::spk::normalize_turkish(subject).to_lowercase();

    if text.contains("izahname") {
        // "SPK Onayına Sunulan" henüz onaylanmamış taslaktır; onaylanmış
        // izahnameden ayrı tutulur çünkü süreç aşamasını belirler.
        return Some(if text.contains("onayina sunulan") {
            KapIpoDisclosureType::ProspectusDraft
        } else {
            KapIpoDisclosureType::Prospectus
        });
    }
    if text.contains("fiyat tespit") || text.contains("halka arz fiyatinin belirlenmesinde") {
        return Some(KapIpoDisclosureType::PriceReport);
    }
    if text.contains("tasarruf sahiplerine satis duyurusu") {
        return Some(KapIpoDisclosureType::SaleNotice);
    }
    if text.contains("halka arz sonuclari") {
        return Some(KapIpoDisclosureType::Result);
    }
    // "%5'inden Fazlasını Satın Alanlara" — kesme işareti kaynaklar arasında
    // değişiyor ("% 5 inden" / "%5'inden"), bu yüzden ayırt edici parça
    // kesmesiz aranır.
    if text.contains("fazlasini satin alanlara") {
        return Some(KapIpoDisclosureType::MajorBuyers);
    }
    if text.contains("borsa birincil piyasada halka arz") || text.contains("birincil piyasa duyurusu")
    {
        return Some(KapIpoDisclosureType::ExchangeNotice);
    }
    // Aşağıdaki iki Borsa duyurusunda "halka arz" geçmez; ilk işlem tarihi ve
    // endeks üyeliği yalnız buralarda yapısal olarak bulunuyor. Her ikisi de
    // halka arz dışı olaylarda da yayımlanır (pazar değişimi, dönemsel endeks
    // revizyonu) — halka arza ait olup olmadığına, kaydı bilen taraf karar
    // verir.
    if text.contains("paylarin islem gormeye baslamasi") {
        return Some(KapIpoDisclosureType::Listing);
    }
    if text.contains("endeks sirketlerinde degisiklik") {
        return Some(KapIpoDisclosureType::IndexChange);
    }
    if text.contains("halka arz") {
        return Some(KapIpoDisclosureType::Other);
    }
    None
}

// ─── Gövde ayrıştırıcıları ──────────────────────────────────────────────
//
// Alan adları canlı bildirimlerden birebir alındı (MASFN 1636762/1636764/
// 1637308, SOHOE 1621219, KARCL 1639195); tahmin değil, gözlemdir. KAP
// etiketleri sabit yazdığı için birebir aranır: gevşek arama "Halka Arz
// Fiyatı (TL)" ile "Halka Arz Edilecek Payların Nominal Tutarı (TL)" gibi
// birbirine yakın adları karıştırır.

/// "Halka Arz Sonuçları" gövdesi.
const RESULT_COMPANY: &str = "PAYLARI İHRAÇ EDİLEN ORTAKLIĞIN ÜNVANI";
const RESULT_LOTS: &str = "SATIŞA SUNULAN PAY ADEDİ";
const RESULT_SIZE: &str = "HALKA ARZ BÜYÜKLÜĞÜ (TL)";
const RESULT_PRICE: &str = "HALKA ARZ FİYATI";
const RESULT_TOTAL_INVESTORS: &str = "HALKA ARZA KATILAN TOPLAM YATIRIMCI SAYISI";

/// Yatırımcı grubu kırılımı; tabloda değil, ayrı alanlar hâlinde geliyor.
const RESULT_GROUPS: &[(&str, &str)] = &[
    ("Yurt İçi Bireysel", "Yurt İçi Bireysel Yatırımcı Sayısı"),
    ("Yurt İçi Kurumsal", "Yurt İçi Kurumsal Yatırımcı Sayısı"),
    ("Yurt Dışı Bireysel", "Yurt Dışı Bireysel Yatırımcı Sayısı"),
    ("Yurt Dışı Kurumsal", "Yurt Dışı Kurumsal Yatırımcı Sayısı"),
    ("Diğer", "Diğer Yatırımcılar"),
];

/// "Payların İşlem Görmeye Başlaması" gövdesi.
const LISTING_COMPANY: &str = "Payları İşlem Görecek Şirket'in Ünvanı";
const LISTING_LOTS: &str = "İşlem Görecek Payların Nominal Tutarı (TL)";
const LISTING_BASE_PRICE: &str = "Baz Fiyat (TL)";
const LISTING_MARKET: &str = "İşlem Göreceği Pazar";
const LISTING_START: &str = "İşlem Görmeye Başlayacağı Tarih";
const LISTING_OFFER_DATES: &str = "Halka Arz Tarihi";

/// "Payların Borsa Birincil Piyasada Halka Arzı" gövdesi.
const EXCHANGE_COMPANY: &str = "Payları Halka Arz Edilecek Şirketin Ünvanı";
const EXCHANGE_LOTS: &str = "Halka Arz Edilecek Payların Nominal Tutarı (TL)";
const EXCHANGE_FLOAT_RATIO: &str = "Halka Arz Edilecek Payların Sermayeye Oranı (%)";
const EXCHANGE_PRICE: &str = "Halka Arz Fiyatı (TL)";
const EXCHANGE_BROKER: &str = "Aracı Kuruluş";
const EXCHANGE_MARKET: &str = "Halka Arz Sonrası İşlem Göreceği Pazar";

/// Endeks değişikliği tablosunun sütunları.
const INDEX_COLUMN_ADDED: &str = "Kapsamına Dahil Edildiği Endeks";

/// Serbest metin açıklama; %5 bildiriminde tek bilgi taşıyan alan odur.
const FIELD_COMMENTS: &str = "Açıklamalar";

/// Bildirim gövdesini türüne göre ayrıştırır.
pub fn parse_form(form: &KapForm, kind: KapIpoDisclosureType) -> KapIpoExtractedData {
    match kind {
        KapIpoDisclosureType::Result => parse_result_form(form),
        KapIpoDisclosureType::Listing => parse_listing_form(form),
        KapIpoDisclosureType::ExchangeNotice => parse_exchange_form(form),
        KapIpoDisclosureType::MajorBuyers => parse_major_buyers_form(form),
        KapIpoDisclosureType::IndexChange => parse_index_change_form(form),
        _ => KapIpoExtractedData::default(),
    }
}

/// "Halka Arz Sonuçları": kesinleşen fiyat, büyüklük ve katılımcı kırılımı.
///
/// Katılımcı sayısı halka arzın en çok sorulan sayısıdır ve gerçekleşen
/// dağıtımı belirler; başka hiçbir resmî kaynakta yapısal olarak yok.
fn parse_result_form(form: &KapForm) -> KapIpoExtractedData {
    let total = form.field(RESULT_TOTAL_INVESTORS).map(str::to_string);

    let mut rows: Vec<crate::ipo_scraper::IpoResultRow> = RESULT_GROUPS
        .iter()
        .filter_map(|(label, field)| {
            let people = form.field(field)?;
            // "0" satırı yazmak tabloyu boş sütunlarla şişirir; yurt dışı
            // katılım olmayan arzlarda dört satırın üçü sıfır geliyor.
            (number(Some(people))? > 0.0).then(|| crate::ipo_scraper::IpoResultRow {
                group: (*label).to_string(),
                people: people.to_string(),
                lots: UNKNOWN_CELL.to_string(),
                ratio: UNKNOWN_CELL.to_string(),
            })
        })
        .collect();

    if let Some(total) = &total {
        if !rows.is_empty() {
            rows.push(crate::ipo_scraper::IpoResultRow {
                group: "Toplam".to_string(),
                people: total.clone(),
                lots: UNKNOWN_CELL.to_string(),
                ratio: UNKNOWN_CELL.to_string(),
            });
        }
    }

    KapIpoExtractedData {
        company_name: text(form.field(RESULT_COMPANY)),
        price: number(form.field(RESULT_PRICE)),
        total_lots: number(form.field(RESULT_LOTS)),
        ipo_size_tl: number(form.field(RESULT_SIZE)),
        participant_count: total,
        results_table: (!rows.is_empty()).then_some(rows),
        ..KapIpoExtractedData::default()
    }
}

/// Lot ve oran sütunu bu bildirimde yok; boş bırakmak yerine işaretlenir ki
/// tabloda "veri gelmedi" ile "sıfır" karışmasın.
const UNKNOWN_CELL: &str = "—";

/// "Payların İşlem Görmeye Başlaması": ilk işlem tarihi ve pazar.
fn parse_listing_form(form: &KapForm) -> KapIpoExtractedData {
    KapIpoExtractedData {
        company_name: text(form.field(LISTING_COMPANY)),
        price: number(form.field(LISTING_BASE_PRICE)),
        trading_start_date: iso_date(form.field(LISTING_START)),
        market: text(form.field(LISTING_MARKET)),
        lot_amount: lots(form.field(LISTING_LOTS)),
        book_building_dates: text(form.field(LISTING_OFFER_DATES)),
        ..KapIpoExtractedData::default()
    }
}

/// "Payların Borsa Birincil Piyasada Halka Arzı": borsada satış yöntemiyle
/// yapılan arzların fiyat/aracı kurum/pazar bilgisi.
fn parse_exchange_form(form: &KapForm) -> KapIpoExtractedData {
    KapIpoExtractedData {
        company_name: text(form.field(EXCHANGE_COMPANY)),
        price: number(form.field(EXCHANGE_PRICE)),
        consortium_lead: text(form.field(EXCHANGE_BROKER)),
        market: text(form.field(EXCHANGE_MARKET)),
        lot_amount: lots(form.field(EXCHANGE_LOTS)),
        public_float_ratio: text(form.field(EXCHANGE_FLOAT_RATIO)).map(|r| format!("%{r}")),
        ..KapIpoExtractedData::default()
    }
}

/// "%5'inden Fazlasını Satın Alanlara İlişkin Bildirim".
///
/// Tablo çoğu arzda `0 | 0 | % 0` ile doldurulmuş boş bir iskelet; anlamlı
/// bilgi serbest metindedir ("… %5'inden fazlasını alan gerçek/tüzel kişi
/// yoktur" ya da alanların adı). Bu yüzden metin okunur.
fn parse_major_buyers_form(form: &KapForm) -> KapIpoExtractedData {
    KapIpoExtractedData {
        major_shareholders: form
            .rows
            .iter()
            .find(|row| row.len() == 2 && row[0].is_empty() && row[1].len() > 40)
            .map(|row| row[1].clone())
            .or_else(|| text(form.field(FIELD_COMMENTS))),
        ..KapIpoExtractedData::default()
    }
}

/// "Endeks Şirketlerinde Değişiklik": hissenin girdiği endeksler.
fn parse_index_change_form(form: &KapForm) -> KapIpoExtractedData {
    let Some(table) = form.table(INDEX_COLUMN_ADDED) else {
        return KapIpoExtractedData::default();
    };
    let indices: Vec<String> = table
        .rows
        .iter()
        .filter_map(|row| table.cell(row, INDEX_COLUMN_ADDED))
        .filter(|cell| !cell.is_empty())
        .map(str::to_string)
        .collect();

    KapIpoExtractedData {
        index_name: (!indices.is_empty()).then(|| indices.join(", ")),
        ..KapIpoExtractedData::default()
    }
}

/// Boş ve "-" değerleri düşen metin okuma.
fn text(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    (!value.is_empty() && value != "-").then(|| value.to_string())
}

/// Türkçe biçimli sayı: "3.882.800.000" → 3882800000, "45,68" → 45.68.
fn number(value: Option<&str>) -> Option<f64> {
    text(value)?.replace('.', "").replace(',', ".").parse().ok()
}

/// Nominal tutar, arşivin lot biçiminde. 1 TL nominal = 1 lot.
fn lots(value: Option<&str>) -> Option<String> {
    Some(format!("{} Lot", text(value)?))
}

/// "30/07/2026" → "2026-07-30". Borsa duyuruları eğik çizgi kullanıyor.
fn iso_date(value: Option<&str>) -> Option<String> {
    let raw = text(value)?;
    let head = raw.split_whitespace().next()?;
    chrono::NaiveDate::parse_from_str(head, "%d/%m/%Y")
        .or_else(|_| chrono::NaiveDate::parse_from_str(head, "%d.%m.%Y"))
        .ok()
        .map(|date| date.format("%Y-%m-%d").to_string())
}

/// Tek istekte sorulan gün sayısı.
///
/// Uç yanıt başına 2.000 kayıt döndürür ve **sayfalama tanımıyor**: sınıra
/// dayanan pencerede en eski günler sessizce düşer. Ölçüm: 30 günlük pencere
/// her ay sınıra dayanıyor, 7 günlük pencere genelde dayanmıyor. Yine de
/// dayanırsa `kap::disclosures_in_range` pencereyi özyinelemeli böler.
const WINDOW_DAYS: i64 = 7;

/// Ardışık pencere istekleri arasındaki bekleme.
///
/// Listeleme ucunun da hız sınırı var ve 90 günlük tarama 13 pencere demek:
/// aralıksız gönderildiğinde sınıra dayanıp **tarama tamamen boş dönüyordu**
/// (`error sending request`, gövde ucundaki 429 ile aynı görünüm). Aralık,
/// taramayı sınırın altında tutar; tarama artımlı olduğu için maliyeti bir
/// kereliktir.
const WINDOW_SPACING: std::time::Duration = std::time::Duration::from_millis(1200);

/// Bir taramanın sonucu.
pub struct IpoScan {
    pub rows: Vec<crate::kap::RawDisclosure>,
    /// Bütün pencereler başarıyla indi mi?
    ///
    /// Eksik tarama üzerine ilerleme kaydedilemez: atlanan pencere bir daha
    /// istenmezse o günlerin bildirimleri kalıcı olarak kaybolur.
    pub complete: bool,
}

/// Son N günlük KAP bildirimlerinden halka arzla ilgili olanların **ham**
/// satırlarını çeker.
///
/// Ham döner çünkü iki tüketici var ve ihtiyaçları farklı: `ipo_pipeline`
/// sadeleştirilmiş görünümü, `ipo_follow` ise gövde indirmek için satırın
/// kendisini istiyor. Tarama pahalı ve iki kez yapmanın anlamı yok.
///
/// Bir pencere hata verirse o pencere atlanır ve tarama sürer: eksik veri,
/// hiç veri olmamasından iyidir. Eksiklik `complete` ile bildirilir.
pub async fn fetch_ipo_rows(client: &Client, days_back: u32) -> IpoScan {
    let today = crate::kap::istanbul_today();
    let start = today - chrono::Duration::days(days_back as i64);

    let mut scan = IpoScan {
        rows: Vec::new(),
        complete: true,
    };
    let mut cursor = start;
    let mut first = true;
    while cursor <= today {
        let window_end = (cursor + chrono::Duration::days(WINDOW_DAYS - 1)).min(today);
        if !first {
            tokio::time::sleep(WINDOW_SPACING).await;
        }
        first = false;

        match crate::kap::disclosures_in_range(client, cursor, window_end).await {
            Ok(window) => scan.rows.extend(
                window
                    .into_iter()
                    .filter(|row| classify_disclosure(&row.subject).is_some()),
            ),
            Err(error) => {
                eprintln!("[kap_ipo] {cursor}..{window_end} atlandı: {error}");
                scan.complete = false;
            }
        }
        cursor = window_end + chrono::Duration::days(1);
    }

    scan
}


pub(crate) fn to_ipo_disclosure(row: &crate::kap::RawDisclosure) -> Option<KapIpoDisclosure> {
    let disclosure_type = classify_disclosure(&row.subject)?;
    let filed_by_someone_else = !row.related_stocks.is_empty();

    Some(KapIpoDisclosure {
        // Bildirimi başkası yaptıysa `kapTitle` aracı kurumun ya da Borsa
        // İstanbul'un unvanıdır; arzın sahibi değildir ve isimle eşleştirmede
        // kullanılamaz.
        company_name: (!filed_by_someone_else).then(|| row.kap_title.clone()),
        filer_name: row.kap_title.clone(),
        ticker: subject_ticker(row),
        disclosure_type,
        publish_date: row.publish_date.clone(),
        disclosure_index: row.disclosure_index.to_string(),
        url: format!("https://www.kap.org.tr/tr/Bildirim/{}", row.disclosure_index),
        extracted_data: None,
    })
}

/// Bildirimin konusu olan pay kodu.
///
/// Genel akışın tersine **önce `relatedStocks`** okunur: halka arz
/// bildirimlerini konsorsiyum lideri yapıyor, yani `stockCodes` aracı kurumun
/// kodudur ("DZY, DZYMK") ve arz edilen şirket ("MASFN") yalnız ilgili
/// paylarda görünür.
pub(crate) fn subject_ticker(row: &crate::kap::RawDisclosure) -> Option<String> {
    row.related_stocks
        .first()
        .or_else(|| row.stock_codes.first())
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_approved_and_draft_prospectus() {
        assert_eq!(
            classify_disclosure("İzahname (SPK Tarafından Onaylanan)"),
            Some(KapIpoDisclosureType::Prospectus)
        );
        assert_eq!(
            classify_disclosure("İzahname (SPK Onayına Sunulan)"),
            Some(KapIpoDisclosureType::ProspectusDraft)
        );
    }

    /// Gerçek KAP başlıkları — fiyat raporu iki ayrı adla yayımlanıyor.
    #[test]
    fn classifies_price_reports() {
        assert_eq!(
            classify_disclosure("Fiyat Tespit Raporu"),
            Some(KapIpoDisclosureType::PriceReport)
        );
        assert_eq!(
            classify_disclosure(
                "Halka Arz Fiyatının Belirlenmesinde Esas Alınan Varsayımlara İlişkin Değerlendirme Raporu"
            ),
            Some(KapIpoDisclosureType::PriceReport)
        );
    }

    #[test]
    fn classifies_exchange_notice() {
        assert_eq!(
            classify_disclosure("Payların Borsa Birincil Piyasada Halka Arzı"),
            Some(KapIpoDisclosureType::ExchangeNotice)
        );
    }

    #[test]
    fn classifies_sale_notice_and_result() {
        assert_eq!(
            classify_disclosure("Tasarruf Sahiplerine Satış Duyurusu"),
            Some(KapIpoDisclosureType::SaleNotice)
        );
        assert_eq!(
            classify_disclosure("Halka Arz Sonuçları"),
            Some(KapIpoDisclosureType::Result)
        );
    }

    /// Borsa duyurularının başlığında "halka arz" **geçmez**; ilk işlem tarihi
    /// ve endeks üyeliği yalnız bu iki bildirimde yapısal olarak var.
    #[test]
    fn classifies_exchange_announcements_without_the_ipo_keyword() {
        assert_eq!(
            classify_disclosure("Payların İşlem Görmeye Başlaması"),
            Some(KapIpoDisclosureType::Listing)
        );
        assert_eq!(
            classify_disclosure("Endeks Şirketlerinde Değişiklik"),
            Some(KapIpoDisclosureType::IndexChange)
        );
    }

    /// Kesme işareti kaynaklar arasında değişiyor ("% 5 inden" / "%5'inden");
    /// ikisi de aynı türe düşmeli.
    #[test]
    fn classifies_major_buyers_in_both_spellings() {
        assert_eq!(
            classify_disclosure(
                "Halka Arz İşlemlerinde Sermaye Piyasası Aracının % 5 inden Fazlasını Satın Alanlara İlişkin Bildirim"
            ),
            Some(KapIpoDisclosureType::MajorBuyers)
        );
        assert_eq!(
            classify_disclosure(
                "Halka Arz İşlemlerinde Sermaye Piyasası Aracının %5'inden Fazlasını Satın Alanlara İlişkin Bildirim"
            ),
            Some(KapIpoDisclosureType::MajorBuyers)
        );
    }

    #[test]
    fn ignores_unrelated() {
        assert_eq!(classify_disclosure("Kar Dağıtımına İlişkin Bildirim"), None);
        assert_eq!(classify_disclosure("Finansal Rapor"), None);
    }

    /// İzahname ve fiyat raporunun gövdesi boştur — içerik ekte. Kota kıt
    /// olduğu için bu türler hiç indirilmemeli.
    #[test]
    fn only_structured_types_have_a_body() {
        assert!(KapIpoDisclosureType::Result.has_form_body());
        assert!(KapIpoDisclosureType::Listing.has_form_body());
        assert!(!KapIpoDisclosureType::Prospectus.has_form_body());
        assert!(!KapIpoDisclosureType::PriceReport.has_form_body());
        assert!(!KapIpoDisclosureType::SaleNotice.has_form_body());
    }

    fn form(rows: &[&[&str]]) -> KapForm {
        KapForm {
            rows: rows
                .iter()
                .map(|row| row.iter().map(|c| c.to_string()).collect())
                .collect(),
        }
    }

    /// MASFN, bildirim 1636762 — gövdesi birebir alındı.
    ///
    /// Katılımcı kırılımı **tablo değil**, alan alan geliyor; tablo bekleyen
    /// bir ayrıştırıcı hiçbir şey bulamaz.
    #[test]
    fn reads_ipo_results() {
        let data = parse_form(
            &form(&[
                &["PAYLARI İHRAÇ EDİLEN ORTAKLIĞIN ÜNVANI", "Masfen Enerji A.Ş."],
                &["SATIŞA SUNULAN PAY ADEDİ", "85.000.000"],
                &["HALKA ARZ BÜYÜKLÜĞÜ (TL)", "3.882.800.000"],
                &["HALKA ARZ FİYATI", "45,68"],
                &["HALKA ARZA KATILAN TOPLAM YATIRIMCI SAYISI", "1.093.898"],
                &["Yurt İçi Kurumsal Yatırımcı Sayısı", "48"],
                &["Yurt İçi Bireysel Yatırımcı Sayısı", "1.089.645"],
                &["Yurt Dışı Kurumsal Yatırımcı Sayısı", "0"],
                &["Yurt Dışı Bireysel Yatırımcı Sayısı", "0"],
                &["Diğer Yatırımcılar", "4.205"],
            ]),
            KapIpoDisclosureType::Result,
        );

        assert_eq!(data.company_name.as_deref(), Some("Masfen Enerji A.Ş."));
        assert_eq!(data.price, Some(45.68));
        assert_eq!(data.total_lots, Some(85_000_000.0));
        assert_eq!(data.ipo_size_tl, Some(3_882_800_000.0));
        assert_eq!(data.participant_count.as_deref(), Some("1.093.898"));

        // Yurt dışı katılım yok; sıfır satırlar tabloyu şişirmemeli.
        let rows = data.results_table.expect("kırılım tablosu üretilmeli");
        let groups: Vec<&str> = rows.iter().map(|r| r.group.as_str()).collect();
        assert_eq!(
            groups,
            ["Yurt İçi Bireysel", "Yurt İçi Kurumsal", "Diğer", "Toplam"]
        );
        assert_eq!(rows[0].people, "1.089.645");
        assert_eq!(rows[3].people, "1.093.898");
    }

    /// MASFN, bildirim 1637308. İlk işlem tarihinin tek yapısal kaynağı budur
    /// ve tarih eğik çizgili yazılıyor.
    #[test]
    fn reads_listing_notice() {
        let data = parse_form(
            &form(&[
                &["Borsa Karar Tarihi", "27/07/2026"],
                &["Payları İşlem Görecek Şirket'in Ünvanı", "Masfen Enerji A.Ş."],
                &["İşlem Görecek Payların Nominal Tutarı (TL)", "85.000.000"],
                &["Baz Fiyat (TL)", "45,68"],
                &["İşlem Göreceği Pazar", "Yıldız Pazar"],
                &["İşlem Görmeye Başlayacağı Tarih", "30/07/2026"],
                &["Halka Arz Tarihi", "22-23-24/07/2026"],
            ]),
            KapIpoDisclosureType::Listing,
        );

        assert_eq!(data.trading_start_date.as_deref(), Some("2026-07-30"));
        assert_eq!(data.market.as_deref(), Some("Yıldız Pazar"));
        assert_eq!(data.lot_amount.as_deref(), Some("85.000.000 Lot"));
        assert_eq!(data.company_name.as_deref(), Some("Masfen Enerji A.Ş."));
        assert_eq!(data.book_building_dates.as_deref(), Some("22-23-24/07/2026"));
    }

    /// SOHOE, bildirim 1621219 — borsada satış yöntemiyle yapılan arz.
    #[test]
    fn reads_exchange_offer_notice() {
        let data = parse_form(
            &form(&[
                &["Payları Halka Arz Edilecek Şirketin Ünvanı", "Soho Giyim ve Enerji A.Ş."],
                &["Halka Arz Edilecek Payların Nominal Tutarı (TL)", "100.000.000"],
                &["Halka Arz Edilecek Payların Sermayeye Oranı (%)", "32,6"],
                &["Halka Arz Fiyatı (TL)", "15"],
                &["Aracı Kuruluş", "İntegral Yatırım Menkul Değerler A.Ş."],
                &["Halka Arz Sonrası İşlem Göreceği Pazar", "Ana Pazar"],
            ]),
            KapIpoDisclosureType::ExchangeNotice,
        );

        assert_eq!(data.price, Some(15.0));
        assert_eq!(data.public_float_ratio.as_deref(), Some("%32,6"));
        assert_eq!(
            data.consortium_lead.as_deref(),
            Some("İntegral Yatırım Menkul Değerler A.Ş.")
        );
        assert_eq!(data.market.as_deref(), Some("Ana Pazar"));
    }

    /// KARCL, bildirim 1639195. Tabloda hissenin girdiği endeksler var;
    /// çıkarıldığı endeks sütunu arzlarda boş.
    #[test]
    fn reads_index_membership() {
        let data = parse_form(
            &form(&[
                &["Pay Adı", "Kapsamına Dahil Edildiği Endeks", "Kapsamından Çıkarıldığı Endeks", "Geçerlilik Tarihi"],
                &["KARDEMIR CELIK", "XUTUM", "", "31/07/2026"],
                &["KARDEMIR CELIK", "XYLDZ", "", "31/07/2026"],
                &["KARDEMIR CELIK", "XHARZ", "", "31/07/2026"],
            ]),
            KapIpoDisclosureType::IndexChange,
        );

        assert_eq!(data.index_name.as_deref(), Some("XUTUM, XYLDZ, XHARZ"));
    }

    /// %5 bildiriminin tablosu çoğu arzda `0 | 0 | % 0` iskeleti; anlamlı
    /// bilgi serbest metindedir.
    #[test]
    fn reads_major_buyers_note_from_free_text() {
        let data = parse_form(
            &form(&[
                &["", "Masfen Enerji A.Ş. halka arzında satışa sunulan 85.000.000 TL nominal değerli payların %5'inden fazlasını alan gerçek/tüzel kişi yoktur."],
                &["Adı veya Ünvanı", "Satın Alınan Nominal Tutar (TL)"],
                &["0", "0"],
            ]),
            KapIpoDisclosureType::MajorBuyers,
        );

        assert!(data
            .major_shareholders
            .as_deref()
            .is_some_and(|note| note.contains("yoktur")));
    }

    /// Gövdesi tanınmayan bildirim boş dönmeli; `is_empty` bunu görmeli ki
    /// tur boş veriyle kayda dokunmasın.
    #[test]
    fn unknown_body_yields_nothing() {
        let data = parse_form(&form(&[&["Konu", "Bilinmeyen"]]), KapIpoDisclosureType::Result);
        assert!(data.is_empty());
    }

    /// Türkçe biçimli sayı ve eğik çizgili tarih dönüşümleri.
    #[test]
    fn turkish_numbers_and_slash_dates_round_trip() {
        assert_eq!(number(Some("3.882.800.000")), Some(3_882_800_000.0));
        assert_eq!(number(Some("45,68")), Some(45.68));
        assert_eq!(number(Some("-")), None);
        assert_eq!(iso_date(Some("30/07/2026")).as_deref(), Some("2026-07-30"));
        assert_eq!(iso_date(Some("30.07.2026")).as_deref(), Some("2026-07-30"));
        assert_eq!(iso_date(Some("-")), None);
    }

    /// Canlı uçla sözleşme sınaması: gövde biçimi ya da alan adları değişirse
    /// modül sessizce boş dönmesin. Eski gövde (`startDate`/`endDate` +
    /// `disclosureClass`) HTTP 500 alıyor ve hata yutulduğu için KAP kolu
    /// aylarca hiç veri getirmemişti.
    ///
    /// Ayrıca **yapısal gövdesi olan** türlerin gerçekten aktığını doğrular:
    /// halka arz izleme turu yalnız onlarla çalışıyor ve hiç çıkmazlarsa
    /// künye sessizce boş kalır.
    #[tokio::test]
    #[ignore = "canlı KAP erişimi gerektirir"]
    async fn live_ipo_disclosures_are_returned() {
        let client = crate::http_client();
        let scan = fetch_ipo_rows(&client, 90).await;
        assert!(scan.complete, "tarama eksik döndü (hız sınırı?)");
        assert!(!scan.rows.is_empty(), "90 günde hiç halka arz bildirimi çıkmadı");

        let disclosures: Vec<KapIpoDisclosure> =
            scan.rows.iter().filter_map(to_ipo_disclosure).collect();
        assert_eq!(disclosures.len(), scan.rows.len(), "her satır sınıflanmalı");

        for row in disclosures.iter().take(5) {
            assert!(!row.filer_name.is_empty(), "bildirimi yapan boş: {row:?}");
            assert!(
                row.disclosure_index.parse::<u64>().is_ok(),
                "bildirim numarası sayısal olmalı: {row:?}"
            );
        }

        let structured: Vec<&KapIpoDisclosure> = disclosures
            .iter()
            .filter(|row| row.disclosure_type.has_form_body())
            .collect();
        assert!(
            !structured.is_empty(),
            "90 günde yapısal gövdeli hiç bildirim çıkmadı — sınıflandırma kopmuş olabilir"
        );
        println!(
            "{} bildirim, {} yapısal gövdeli; ilki: {:?}",
            disclosures.len(),
            structured.len(),
            structured.first()
        );
    }
}
