//! SPK (Sermaye Piyasası Kurulu) haftalık bülten listesi.
//!
//! Bültenler yıl bazlı sayfalarda yayımlanır:
//! `spk.gov.tr/spk-bultenleri/<yıl>-yili-spk-bultenleri`. Sayfa sunucu tarafında
//! üretilir ve JSON ucu yoktur, bu yüzden liste bloğu HTML'den ayrıştırılır.

use serde::Serialize;
use reqwest::Client;
use std::error::Error;

#[derive(Clone, Debug, Serialize, serde::Deserialize)]
pub struct SpkBulletin {
    pub title: String,
    pub date: String,
    pub url: String,
}

#[derive(Clone, Debug, Serialize, serde::Deserialize)]
pub struct SpkApplication {
    pub company_name: String,
    pub application_date: String,
    pub status: String,
    pub source: String,
}

pub async fn fetch_spk_applications(client: &Client) -> Result<Vec<SpkApplication>, Box<dyn Error + Send + Sync>> {
    let url = "https://spk.gov.tr/istatistikler/basvurular/ilk-halka-arz-basvurusu";
    let resp = client
        .get(url)
        .header("User-Agent", crate::yahoo::YAHOO_USER_AGENT)
        .send()
        .await?;

    if !resp.status().is_success() {
        return Ok(Vec::new());
    }

    Ok(parse_spk_applications(&resp.text().await?))
}

/// SPK başvuru tablosunu ayrıştırır.
///
/// Tablo üç sütunludur: `sıra no | şirket unvanı | başvuru tarihi`. Sütunlar
/// **konumdan değil içerikten** tanınır — tarih hücresi `gg.aa.yyyy` kalıbıyla,
/// unvan geriye kalan metinsel hücrelerin en uzunundan seçilir. Konuma bağlı
/// ayrıştırma sıra sütununu unvan sanıyor ve arşive "1", "2", "3" adlı kayıtlar
/// yazıyordu; SPK sütun eklediğinde/çıkardığında da aynı hata tekrarlardı.
fn parse_spk_applications(html: &str) -> Vec<SpkApplication> {
    let re_row = regex::Regex::new(r"(?is)<tr[^>]*>(.*?)</tr>").expect("geçerli regex");
    let re_cell = regex::Regex::new(r"(?is)<t[dh][^>]*>(.*?)</t[dh]>").expect("geçerli regex");

    let mut applications = Vec::new();
    for row in re_row.captures_iter(html) {
        let cells: Vec<String> = re_cell
            .captures_iter(&row[1])
            .map(|cell| clean_cell(&cell[1]))
            .collect();

        // Tarihsiz satırlar başlık ya da ayraçtır.
        let Some(date) = cells.iter().find(|cell| looks_like_tr_date(cell)) else {
            continue;
        };

        let name = cells
            .iter()
            .filter(|cell| !looks_like_tr_date(cell) && cell.chars().any(char::is_alphabetic))
            .max_by_key(|cell| cell.chars().count());

        let Some(name) = name else { continue };
        if name.chars().count() < 3 {
            continue;
        }

        applications.push(SpkApplication {
            company_name: name.clone(),
            application_date: date.clone(),
            status: "SPK_APPLICATION".to_string(),
            source: "SPK".to_string(),
        });
    }

    applications
}

/// Hücre içeriğini düz metne indirger: iç etiketleri atar, varlıkları çözer,
/// satır sonu ve sekmelerden oluşan boşlukları tek boşluğa indirir.
fn clean_cell(raw: &str) -> String {
    let re_tag = regex::Regex::new(r"(?is)<[^>]+>").expect("geçerli regex");
    decode_entities(&re_tag.replace_all(raw, " "))
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// `gg.aa.yyyy` biçimli bir tarih mi?
fn looks_like_tr_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[2] == b'.'
        && bytes[5] == b'.'
        && bytes
            .iter()
            .enumerate()
            .all(|(i, b)| matches!(i, 2 | 5) || b.is_ascii_digit())
}

#[derive(Clone, Debug, Serialize, serde::Deserialize)]
pub struct SpkIpoApproval {
    pub company_name: String,
    pub ticker: Option<String>,
    pub capital_increase_lots: f64,
    pub share_sale_lots: f64,
    /// Fazla talep gelirse devreye giren ek pay satışı; taban arz büyüklüğüne
    /// dahil değildir.
    pub extra_sale_lots: f64,
    pub total_lots: f64,
    pub price: f64,
    pub ipo_size_tl: f64,
    pub consortium_lead: Option<String>,
    pub bulletin_no: String,
    pub approval_date: String,
}

/// Türkçe karakterleri ASCII eşdeğerlerine dönüştürür (fuzzy matching için).
pub fn normalize_turkish(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'ç' | 'Ç' => 'c',
            'ğ' | 'Ğ' => 'g',
            'ı' | 'İ' => 'i',
            'ö' | 'Ö' => 'o',
            'ş' | 'Ş' => 's',
            'ü' | 'Ü' => 'u',
            _ => c,
        })
        .collect()
}

/// Listede tutulan en fazla bülten.
const BULLETIN_LIMIT: usize = 10;

fn year_url(year: i32) -> String {
    format!("https://spk.gov.tr/spk-bultenleri/{year}-yili-spk-bultenleri")
}

/// Geçmiş yıllar bir alt dizine taşınır. Güncel yol da ayakta kalır ama
/// **boş** döner; içerik yalnız arşiv yolundadır.
fn archived_year_url(year: i32) -> String {
    format!("https://spk.gov.tr/spk-bultenleri/gecmis-yillara-ait-bultenler/{year}-yili-spk-bultenleri")
}

/// Yıl sayfası otuzar bültenlik sayfalara bölünür (`?s=2`, `?s=3`). Bir yılda
/// ~70 bülten yayımlanır; üst sınır sonsuz döngüye karşı korumadır.
const MAX_YEAR_PAGES: u32 = 12;

/// Bir yılın **tüm** bültenleri; geçmişe dönük tarama buradan geçer.
///
/// Sayfalama gezilir ve yıl güncel dizinde boş dönerse arşiv dizinine düşülür.
/// İlk sayfayla yetinen eski davranış 2025 için 68 bültenin yalnız 30'unu,
/// 2024 için hiçbirini görüyordu.
pub async fn fetch_year_bulletins(
    client: &Client,
    year: i32,
) -> Result<Vec<SpkBulletin>, Box<dyn Error + Send + Sync>> {
    for base in [year_url(year), archived_year_url(year)] {
        let mut bulletins = Vec::new();
        for page in 1..=MAX_YEAR_PAGES {
            let url = if page == 1 {
                base.clone()
            } else {
                format!("{base}?s={page}")
            };
            let rows = fetch_bulletin_page(client, &url).await?;
            if rows.is_empty() {
                break;
            }
            bulletins.extend(rows);
        }
        if !bulletins.is_empty() {
            return Ok(bulletins);
        }

        // Blok yapısı yoksa (2021 ve öncesi) düz bağlantı listesine düşülür.
        let html = fetch_page_html(client, &base).await?;
        let links = parse_bulletin_links(&html, year);
        if !links.is_empty() {
            return Ok(links);
        }
    }
    Ok(Vec::new())
}

async fn fetch_page_html(client: &Client, url: &str) -> Result<String, Box<dyn Error + Send + Sync>> {
    let response = client
        .get(url)
        .header("User-Agent", crate::yahoo::YAHOO_USER_AGENT)
        .send()
        .await?;
    if !response.status().is_success() {
        return Ok(String::new());
    }
    Ok(response.text().await?)
}

/// Tek bir liste sayfasını çeker ve ayrıştırır. Sayfa yoksa (SPK yeni yıl
/// sayfasını henüz açmamışsa 302 döner) boş liste verir — hata değildir.
async fn fetch_bulletin_page(
    client: &Client,
    url: &str,
) -> Result<Vec<SpkBulletin>, Box<dyn Error + Send + Sync>> {
    let response = client
        .get(url)
        .header("User-Agent", crate::yahoo::YAHOO_USER_AGENT)
        .send()
        .await?;

    if !response.status().is_success() {
        return Ok(Vec::new());
    }

    Ok(parse_bulletins(&response.text().await?))
}

/// En güncel bültenler.
///
/// Yıl **takvimden** türetilir; sabit yazılmış bir yıl 1 Ocak'ta sessizce boş
/// liste döndürmeye başlar (SPK o tarihte yeni yıl sayfasını henüz açmamış
/// olur). Bu yüzden içinde bulunulan yıl boş gelirse bir önceki yıla düşülür:
/// yıl başında son bültenler hâlâ görünür.
pub async fn fetch_latest_bulletins(client: &Client) -> Result<Vec<SpkBulletin>, Box<dyn Error + Send + Sync>> {
    let year = crate::kap::istanbul_today().format("%Y").to_string().parse::<i32>()?;

    // En yeni bültenler ilk sayfadadır; sayfalamayı gezmeye gerek yok.
    let mut current = fetch_bulletin_page(client, &year_url(year)).await?;
    if !current.is_empty() {
        current.truncate(BULLETIN_LIMIT);
        return Ok(current);
    }

    let mut previous = fetch_bulletin_page(client, &year_url(year - 1)).await?;
    if previous.is_empty() {
        return Err(format!("SPK bülten listesi {year} ve {} için boş döndü.", year - 1).into());
    }
    previous.truncate(BULLETIN_LIMIT);
    Ok(previous)
}

/// Türkçe karakterlerin sayısal HTML varlıklarını çözer. Sayfa bunları
/// kodlanmış gönderir ve ham haliyle "Ç&#305;kar&#305;lm&#305;ş" gibi görünür.
fn decode_entities(value: &str) -> String {
    const MAP: &[(&str, &str)] = &[
        ("&#199;", "Ç"), ("&#231;", "ç"), ("&#286;", "Ğ"), ("&#287;", "ğ"),
        ("&#304;", "İ"), ("&#305;", "ı"), ("&#214;", "Ö"), ("&#246;", "ö"),
        ("&#350;", "Ş"), ("&#351;", "ş"), ("&#220;", "Ü"), ("&#252;", "ü"),
        ("&amp;", "&"), ("&quot;", "\""), ("&#39;", "'"),
    ];
    MAP.iter().fold(value.to_string(), |acc, (from, to)| acc.replace(from, to))
}

fn parse_bulletins(html: &str) -> Vec<SpkBulletin> {
    // Blok deseni:
    // <a href="https://spk.gov.tr/data/<oid>/2026-44.pdf" class="link">
    //   <div class="liste-item">
    //     <div class="liste-baslik">Bülten No : 2026/44</div>
    //     <div class="liste-icerik ...">Yayımlanma : 08 Temmuz 2026 Çarşamba</div>
    let re_item = regex::Regex::new(
        r#"(?is)<a href="([^"]+\.pdf)"[^>]*>\s*<div class="liste-item">.*?<div class="liste-baslik[^"]*">\s*(.*?)\s*</div>.*?<div class="liste-icerik[^>]*>\s*(?:<[^>]*>\s*)*Yayımlanma :\s*(.*?)\s*</div>"#
    ).expect("geçerli regex");

    let mut bulletins = Vec::new();
    for capture in re_item.captures_iter(html) {
        let url = capture[1].trim().to_string();
        // Bülten dışı PDF'ler (stratejik plan, aydınlatma metni) aynı listede geçer.
        if url.contains("STRATEJİK PLAN") || url.contains("Aydınlatma Metni") {
            continue;
        }
        bulletins.push(SpkBulletin {
            title: decode_entities(capture[2].trim()),
            date: decode_entities(capture[3].trim()),
            url,
        });
    }
    bulletins
}

/// Eski yıl arşivleri için yedek liste ayrıştırıcı.
///
/// 2022 ve sonrası `<div class="liste-item">` blokları taşır; 2021 ve öncesi
/// arşiv sayfaları ise yalnız düz bağlantı listesidir (`.../2020-5.pdf`).
/// Blok arayan ayrıştırıcı orada sessizce boş dönüyor ve o yıllar hiç
/// taranmıyordu. Burada dosya adından yıl ve bülten numarası okunur; tarih
/// sayfada bulunmadığı için boş bırakılır, PDF başlığından tamamlanır.
fn parse_bulletin_links(html: &str, year: i32) -> Vec<SpkBulletin> {
    let pattern = format!(r#"href="([^"]*/{year}-(\d+)\.pdf)""#);
    let re = regex::Regex::new(&pattern).expect("geçerli regex");

    let mut seen = std::collections::HashSet::new();
    let mut bulletins = Vec::new();
    for capture in re.captures_iter(html) {
        let url = capture[1].to_string();
        if !seen.insert(url.clone()) {
            continue;
        }
        bulletins.push(SpkBulletin {
            title: format!("Bülten No : {year}/{}", &capture[2]),
            date: String::new(),
            url,
        });
    }
    bulletins
}

/// PDF başlığındaki "2020/50    13/08/2020" satırından bülten numarası ve
/// ISO tarihi okur. Eski arşiv sayfaları tarih vermediği için tek kaynak budur.
fn bulletin_header(text: &str) -> Option<(String, String)> {
    let re = regex::Regex::new(r"(\d{4}/\d+)\s+(\d{2})/(\d{2})/(\d{4})").expect("geçerli regex");
    let capture = text.lines().take(40).find_map(|line| re.captures(line))?;
    Some((
        capture[1].to_string(),
        format!("{}-{}-{}", &capture[4], &capture[3], &capture[2]),
    ))
}

// ---------- Bülten PDF İndirme ve Halka Arz Onay Tablosu Çıkarma ----------

/// Taranacak en fazla bülten sayısı. Son birkaç bültende halka arz onayı
/// olma olasılığı yüksektir; hepsini taramak gereksiz ağ yükü yaratır.
const SCAN_BULLETINS: usize = 4;

/// Bir SPK bülten PDF'ini indirir ve ham byte olarak döndürür.
async fn fetch_bulletin_pdf(
    client: &Client,
    url: &str,
) -> Result<Vec<u8>, Box<dyn Error + Send + Sync>> {
    let resp = client
        .get(url)
        .header("User-Agent", crate::yahoo::YAHOO_USER_AGENT)
        .send()
        .await?;

    if !resp.status().is_success() {
        return Err(format!("SPK PDF indirilemedi: HTTP {}", resp.status()).into());
    }

    Ok(resp.bytes().await?.to_vec())
}

/// PDF metninden halka arz onay tablosunu ayrıştırır.
///
/// SPK bültenleri tipik olarak şu yapıdadır:
/// - "İlk Halka Arz" veya "Sermaye Artırımı Suretiyle Halka Arz" başlığı
/// - Tablo satırları: Şirket Adı, Sermaye Artırımı (Lot), Pay Satışı (Lot), Fiyat (TL)
///
/// PDF metin çıkarma satır düzenini her zaman korumaz; bu yüzden regex ile
/// esnek ayrıştırma yapılır.
pub fn extract_ipo_approvals_from_pdf(
    pdf_bytes: &[u8],
    bulletin_no: &str,
    approval_date: &str,
) -> Vec<SpkIpoApproval> {
    let text = match pdf_extract::extract_text_from_mem(pdf_bytes) {
        Ok(t) => t,
        Err(_) => return Vec::new(),
    };

    extract_ipo_approvals_from_text(&text, bulletin_no, approval_date)
}

/// PDF'den çıkarılmış düz metinden halka arz onay kayıtlarını çıkarır.
///
/// Bülten üç bölümlüdür ve üçü de aynı görünümlü tablolar taşır:
///
/// ```text
/// A.  İZAHNAME / İHRAÇ BELGESİ ONAYLANAN SERMAYE PİYASASI ARAÇLARI
/// 1.  İlk Halka Arzlar                        ← halka arz
/// 2.  Halka Açık Ortaklıkların Pay İhraçları  ← bedelli/bedelsiz artırım
/// 3.  Borçlanma Araçları                      ← tahvil/finansman bonosu
/// ```
///
/// Yalnız 1. bölüm okunur. Bölüm sınırı gözetilmediğinde 2. bölümdeki sermaye
/// artırımları halka arz sanılıyordu: zaten borsada olan şirketler "yeni halka
/// arz" olarak görünüyor, fiyat sütunu bulunmadığı için lot sayısı fiyat yerine
/// geçiyor ve arşive katrilyon TL'lik arz büyüklükleri yazılıyordu.
fn extract_ipo_approvals_from_text(
    text: &str,
    bulletin_no: &str,
    approval_date: &str,
) -> Vec<SpkIpoApproval> {
    let lines: Vec<&str> = text.lines().collect();
    let Some(section) = ipo_section(&lines) else {
        return Vec::new();
    };

    section
        .split(|line| line.trim().is_empty())
        .filter_map(|block| parse_approval_block(block, bulletin_no, approval_date))
        .collect()
}

/// Bültenin yalnız "İlk Halka Arzlar" bölümündeki tablo satırlarını verir.
///
/// Bölüm, bir sonraki numaralı/harfli başlıkta ya da dipnot bloğunda biter.
/// Tablo birden çok sayfaya yayılabildiği için araya giren sayfa başlık ve
/// altlıkları (kurum adresi, sayfa numarası, ayraç çizgisi) ayıklanır.
fn ipo_section<'a>(lines: &[&'a str]) -> Option<Vec<&'a str>> {
    let start = lines.iter().position(|line| is_ipo_heading(line))?;

    let mut section = Vec::new();
    for line in &lines[start + 1..] {
        if is_section_heading(line) || is_footnote(line) {
            break;
        }
        if !is_page_furniture(line) {
            section.push(*line);
        }
    }
    Some(section)
}

/// "1.  İlk Halka Arzlar" başlığı mı?
///
/// Sıralama önemli: `to_lowercase` önce çalıştırılırsa 'İ' iki koda ayrışır
/// ("i" + birleşen nokta) ve düz metin araması tutmaz. Önce ASCII'ye indirgenir.
fn is_ipo_heading(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.starts_with(|c: char| c.is_ascii_digit())
        && normalize_turkish(trimmed).to_lowercase().contains("ilk halka arz")
}

/// "2.  Halka Açık Ortaklıkların Pay İhraçları" ya da "B.  ..." gibi bir
/// bölüm başlığı mı? Ölçüt: rakam/büyük harf, nokta, ardından boşluk.
fn is_section_heading(line: &str) -> bool {
    let trimmed = line.trim();
    let mut chars = trimmed.chars();
    match (chars.next(), chars.next(), chars.next()) {
        (Some(first), Some('.'), Some(third)) => {
            (first.is_ascii_digit() || first.is_uppercase()) && third.is_whitespace()
        }
        _ => false,
    }
}

/// Dipnot açıklaması mı — "(1)  Mevcut ortaklardan …"?
///
/// Tablo hücreleri de dipnot işaretiyle başlayabilir ("(1)  -  73,70"); ayrım
/// işaretten sonra düzyazı gelip gelmemesidir.
fn is_footnote(line: &str) -> bool {
    let trimmed = line.trim();
    let Some((marker, rest)) = trimmed.strip_prefix('(').and_then(|r| r.split_once(')')) else {
        return false;
    };
    if marker.is_empty() || !marker.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }

    // Ölçüt harf **sayısı** değil kelime sayısıdır. Sermaye artırımı
    // tablosunun son sütunu metindir ve satır sarınca dipnot işaretiyle
    // başlayan bir hücre satırı doğuyor:
    //
    //     (1)  -  -  Halka
    //
    // "Halka" tek başına üç harf eşiğini aşıyor, satır dipnot sanılıyor ve
    // bölüm o noktada kesiliyordu — 2026/48'de üç şirketin tamamı kayboldu.
    // Hücre devamında en fazla satış türü (bir-iki kelime) bulunur; gerçek
    // dipnot ise cümledir.
    const MIN_FOOTNOTE_WORDS: usize = 3;
    rest.split_whitespace()
        .filter(|token| token.chars().filter(|c| c.is_alphabetic()).count() >= 3)
        .count()
        >= MIN_FOOTNOTE_WORDS
}

/// Sayfa başlığı/altlığı mı? Bunlar tablonun ortasına girebilir.
fn is_page_furniture(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false;
    }
    // Ayraç çizgisi ve yalnız sayfa numarasından oluşan satırlar.
    if trimmed.bytes().all(|b| b == b'_') {
        return true;
    }
    if trimmed.len() <= 3 && trimmed.bytes().all(|b| b.is_ascii_digit()) {
        return true;
    }
    const MARKERS: [&str; 5] = [
        "MERKEZ Eskişehir",
        "İSTANBUL TEMSİLCİLİĞİ",
        "SERMAYE PİYASASI KURULU",
        "BÜLTENİ",
        "NOT :",
    ];
    MARKERS.iter().any(|marker| trimmed.starts_with(marker))
}

/// 1. bölüm tablosunun sütun düzeni:
/// `mevcut sermaye | yeni sermaye | bedelli artırım | bedelsiz artırım |
///  mevcut pay satışı | ek pay satışı | satış fiyatı`
///
/// `pdf_extract` boş hücreyi çoğunlukla tire olarak verir ama bazen hiç
/// üretmez, bu yüzden hücre sayısı yediden az olabilir. Sabit sayı dayatmak
/// (Best Brands Grup Enerji, 2026/5) geçerli satırları düşürüyordu. Baştaki
/// dört sermaye sütunu her zaman dolu, fiyat her zaman sonuncudur; arada
/// kalanlar pay satışı sütunlarıdır.
const MIN_COLUMNS: usize = 5;
const MAX_COLUMNS: usize = 7;
const COL_EXISTING_CAPITAL: usize = 0;
const COL_NEW_CAPITAL: usize = 1;
const COL_PAID_INCREASE: usize = 2;
const COL_BONUS_INCREASE: usize = 3;
/// Pay satışı sütunlarının başladığı yer; fiyat sondan okunur.
const COL_FIRST_SALE: usize = 4;

/// Sermaye özdeşliğinde kabul edilen yuvarlama payı (TL).
const CAPITAL_TOLERANCE: f64 = 1.0;

/// Kabul edilen en yüksek pay fiyatı. Sütun düzeni değişip lot sayısı fiyat
/// hücresine kayarsa kayıt sessizce geçmesin diye üst sınır konur.
const PRICE_CEILING: f64 = 10_000.0;

/// Tek bir şirket bloğunu onay kaydına çevirir.
///
/// Unvan birden çok satıra sarar ve sayısal hücreler unvanın bittiği "AŞ"
/// ekinden sonra başlayıp sonraki satırlara taşar:
///
/// ```text
/// Çitlekçi  Mağazacılık
/// Gıda AŞ  150.000.000  180.000.000  30.000.000  -  6.500.000
/// (1)  -  73,70
/// (2)
/// ```
fn parse_approval_block(
    block: &[&str],
    bulletin_no: &str,
    approval_date: &str,
) -> Option<SpkIpoApproval> {
    let anchor = block
        .iter()
        .position(|line| find_company_as_boundary(line.trim()).is_some())?;
    let anchor_line = block[anchor].trim();
    let name_end = find_company_as_boundary(anchor_line)?;

    let mut name_parts: Vec<&str> = block[..anchor].iter().map(|line| line.trim()).collect();
    name_parts.push(anchor_line[..name_end].trim());
    let company_name = collapse_spaces(&name_parts.join(" "));
    if company_name.chars().filter(|c| c.is_alphabetic()).count() < 3 {
        return None;
    }

    let mut cell_text = anchor_line[name_end..].to_string();
    for line in &block[anchor + 1..] {
        cell_text.push(' ');
        cell_text.push_str(line.trim());
    }

    // Her düşen satır uyarı bırakır: sessiz kayıp, ayrıştırıcı bozulduğunda
    // "bu hafta halka arz yokmuş" gibi görünüyor ve fark edilmiyordu.
    let Some(cells) = parse_row_cells(&cell_text) else {
        eprintln!("[spk] {bulletin_no}: {company_name} — hücreler çözülemedi ({cell_text:?}); atlandı");
        return None;
    };
    if !(MIN_COLUMNS..=MAX_COLUMNS).contains(&cells.len()) {
        eprintln!(
            "[spk] {bulletin_no}: {company_name} — {}-{} sütun bekleniyordu, {} bulundu; atlandı",
            MIN_COLUMNS,
            MAX_COLUMNS,
            cells.len()
        );
        return None;
    }

    // Fiyat son sütundur; okunamıyorsa satır ayrıştırılamamış demektir ve
    // uydurmak yerine atlanır.
    let price = cells[cells.len() - 1].filter(|p| *p > 0.0 && *p < PRICE_CEILING)?;

    let existing_capital = cells[COL_EXISTING_CAPITAL]?;
    let new_capital = cells[COL_NEW_CAPITAL]?;
    let capital_increase_lots = cells[COL_PAID_INCREASE].unwrap_or(0.0);
    let bonus_increase = cells[COL_BONUS_INCREASE].unwrap_or(0.0);

    // Sermaye özdeşliği baştaki dört sütunun doğru okunduğunu kanıtlar:
    // boş hücre yüzünden sütunlar kaymışsa bu sınamada yakalanır.
    if (existing_capital + capital_increase_lots + bonus_increase - new_capital).abs()
        > CAPITAL_TOLERANCE
    {
        eprintln!(
            "[spk] {bulletin_no}: {company_name} — sermaye özdeşliği tutmadı ({existing_capital} + {capital_increase_lots} + {bonus_increase} ≠ {new_capital}); atlandı"
        );
        return None;
    }

    // Sermaye sütunlarıyla fiyat arasında kalanlar pay satışı sütunlarıdır.
    let sale_columns = &cells[COL_FIRST_SALE..cells.len() - 1];
    let share_sale_lots = sale_columns.first().copied().flatten().unwrap_or(0.0);
    let extra_sale_lots = sale_columns.get(1).copied().flatten().unwrap_or(0.0);

    // Halka arz edilen pay = bedelli artırım + mevcut ortakların pay satışı.
    // Bedelsiz artırım mevcut ortaklara dağıtılır, arza konu değildir; ek pay
    // satışı yalnız fazla talep gelirse devreye girer, taban büyüklüğe girmez.
    let total_lots = capital_increase_lots + share_sale_lots;
    if total_lots <= 0.0 {
        return None;
    }

    Some(SpkIpoApproval {
        company_name,
        ticker: None,
        capital_increase_lots,
        share_sale_lots,
        extra_sale_lots,
        total_lots,
        price,
        ipo_size_tl: total_lots * price,
        consortium_lead: None,
        bulletin_no: bulletin_no.to_string(),
        approval_date: approval_date.to_string(),
    })
}

/// Satırın sayısal bölümünü hücrelere ayırır; boş hücre (`-`) `None` olur.
///
/// Dipnot işaretleri hücrelerin arasına serpiştiği için atılır. Numaralıların
/// yanında yıldız da kullanılıyor: unvanın hemen ardından gelen `(*)`, yalnız
/// numaralı işaretleri silen bir desende çözülemeyen bir belirteç olarak kalıp
/// satırın tamamını düşürüyordu (Bahadır Kimya, 2024/37).
///
/// Hücrelerden biri sayı da tire de değilse ayrıştırma başarısız sayılır —
/// yarım okunmuş bir satırı yanlış sütuna yazmaktansa kaydı hiç üretmemek yeğdir.
fn parse_row_cells(text: &str) -> Option<Vec<Option<f64>>> {
    let re_footnote = regex::Regex::new(r"\((?:\d+|\*+)\)").expect("geçerli regex");
    re_footnote
        .replace_all(text, " ")
        .split_whitespace()
        .map(|token| match token {
            "-" => Some(None),
            _ => parse_turkish_number(token).map(Some),
        })
        .collect()
}

/// "150.000.000" → 150000000, "73,70" → 73.7. Biçime uymayan metin `None`.
fn parse_turkish_number(token: &str) -> Option<f64> {
    let (integer, fraction) = match token.split_once(',') {
        Some((integer, fraction)) => (integer, Some(fraction)),
        None => (token, None),
    };

    let groups_valid = !integer.is_empty()
        && integer
            .split('.')
            .all(|group| !group.is_empty() && group.bytes().all(|b| b.is_ascii_digit()));
    let fraction_valid = fraction
        .is_none_or(|f| !f.is_empty() && f.bytes().all(|b| b.is_ascii_digit()));

    if !groups_valid || !fraction_valid {
        return None;
    }

    let mut normalized = integer.replace('.', "");
    if let Some(fraction) = fraction {
        normalized.push('.');
        normalized.push_str(fraction);
    }
    normalized.parse().ok()
}

/// Ardışık boşlukları teke indirir; PDF metni sütun hizası için çok boşluk taşır.
fn collapse_spaces(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// "AŞ" ekinin şirket adını bitirdiği konumu (ekten hemen sonrası) verir.
///
/// Yalnız bağımsız kelime olarak aranır; "AŞ'ye", "AŞ'nin" gibi çekimli
/// kullanımlar dipnot metnindedir ve unvan sonu değildir.
fn find_company_as_boundary(line: &str) -> Option<usize> {
    for form in ["AŞ", "A.Ş.", "A.Ş"] {
        let mut from = 0;
        while let Some(offset) = line[from..].find(form) {
            let start = from + offset;
            let end = start + form.len();
            // Unvan bir üst satıra sarmışsa ek satır başında olabilir
            // ("AŞ  100.000.000  …"), bu yüzden başlangıç da sınır sayılır.
            let opens_word = start == 0
                || line[..start]
                    .chars()
                    .next_back()
                    .is_some_and(char::is_whitespace);
            let closes_word = line[end..].chars().next().is_none_or(char::is_whitespace);
            if opens_word && closes_word {
                return Some(end);
            }
            from = end;
        }
    }
    None
}

// ---------- Bölüm: Halka Açık Ortaklıkların Pay İhraçları ----------

/// Bültenin "Halka Açık Ortaklıkların Pay İhraçları" bölümünden çıkarılan
/// sermaye artırımı kaydı — borsada işlem gören şirketlerin bedelli/bedelsiz
/// artırımlarının resmî kaynağı.
///
/// Yahoo'nun split akışı bedelliyi hiç taşımaz ve bedelsizde de bozuk
/// kayıtlar üretebiliyor; bu tablo tutarları TL cinsinden kesin verir.
#[derive(Clone, Debug, Serialize, serde::Deserialize, PartialEq)]
pub struct SpkCapitalIncrease {
    pub company_name: String,
    pub existing_capital: f64,
    pub new_capital: f64,
    /// Rüçhan haklı (bedelli) artırım: ortaklar pay başına bedel öder.
    pub rights_amount: f64,
    /// Bedelsiz, iç kaynaklardan (emisyon primi, yeniden değerleme fonu…).
    pub bonus_internal: f64,
    /// Bedelsiz, kâr payından.
    pub bonus_profit: f64,
    /// "Halka Arz", "Tahsisli" gibi satış türü; çoğu satırda boştur.
    pub sale_type: Option<String>,
    pub bulletin_no: String,
    pub approval_date: String,
}

impl SpkCapitalIncrease {
    /// Toplam bedelsiz artırım tutarı.
    pub fn bonus_amount(&self) -> f64 {
        self.bonus_internal + self.bonus_profit
    }

    /// Bedelsiz artırımın pay sayısına etkisi: 1 pay kaç paya dönüşür.
    ///
    /// Bedelsizde ortak para ödemez, eldeki pay adedi `(mevcut + bedelsiz) /
    /// mevcut` oranında artar ve fiyat aynı oranda düşer. Getiri düzeltmesi
    /// doğrudan bu çarpanla yapılır.
    pub fn bonus_factor(&self) -> f64 {
        if self.existing_capital <= 0.0 {
            return 1.0;
        }
        1.0 + self.bonus_amount() / self.existing_capital
    }

    /// Bedelli artırımın mevcut sermayeye oranı (%100 bedelli → 1.0).
    ///
    /// Bedelli bir bölünme değildir: ortak yeni payları bedelini ödeyerek
    /// alır. Pay adedi artar ama karşılığında nakit çıkar, bu yüzden
    /// `bonus_factor` gibi doğrudan getiriye uygulanamaz.
    pub fn rights_ratio(&self) -> f64 {
        if self.existing_capital <= 0.0 {
            return 0.0;
        }
        self.rights_amount / self.existing_capital
    }

    pub fn is_bonus(&self) -> bool {
        self.bonus_amount() > 0.0
    }

    pub fn is_rights(&self) -> bool {
        self.rights_amount > 0.0
    }
}

/// Sermaye artırımı tablosunun sütun düzeni:
/// `mevcut sermaye | yeni sermaye | bedelli | bedelsiz iç kaynaklardan |
///  bedelsiz kâr payından | satış türü`
///
/// İlk beş sütun sayısal (boş hücre tire), altıncı metindir ve çoğu satırda
/// tire olarak gelir.
const CAPITAL_COLUMNS: usize = 5;
const COL_EXISTING: usize = 0;
const COL_NEW: usize = 1;
const COL_RIGHTS: usize = 2;
const COL_BONUS_INTERNAL: usize = 3;
const COL_BONUS_PROFIT: usize = 4;

/// Sermaye özdeşliğinde kabul edilen kuruş farkı.
const CAPITAL_IDENTITY_TOLERANCE: f64 = 1.0;

pub fn extract_capital_increases_from_pdf(
    pdf_bytes: &[u8],
    bulletin_no: &str,
    approval_date: &str,
) -> Vec<SpkCapitalIncrease> {
    match pdf_extract::extract_text_from_mem(pdf_bytes) {
        Ok(text) => extract_capital_increases_from_text(&text, bulletin_no, approval_date),
        Err(e) => {
            eprintln!("[spk] {bulletin_no}: PDF metni çıkarılamadı: {e}");
            Vec::new()
        }
    }
}

fn extract_capital_increases_from_text(
    text: &str,
    bulletin_no: &str,
    approval_date: &str,
) -> Vec<SpkCapitalIncrease> {
    let lines: Vec<&str> = text.lines().collect();
    let Some(section) = capital_increase_section(&lines) else {
        return Vec::new();
    };

    section
        .split(|line| line.trim().is_empty())
        .filter_map(|block| parse_capital_block(block, bulletin_no, approval_date))
        .collect()
}

/// "Halka Açık Ortaklıkların Pay İhraçları" bölümünün tablo satırları.
///
/// Bölüm **numarasına göre aranmaz**: o hafta halka arz onayı yoksa bu bölüm
/// "1." olur (2026/48), varsa "2." (2026/49). Başlık metni sabittir, numara
/// değildir.
fn capital_increase_section<'a>(lines: &[&'a str]) -> Option<Vec<&'a str>> {
    let start = lines.iter().position(|line| is_capital_heading(line))?;

    let mut section = Vec::new();
    for line in &lines[start + 1..] {
        if is_section_heading(line) || is_footnote(line) {
            break;
        }
        if !is_page_furniture(line) {
            section.push(*line);
        }
    }
    Some(section)
}

fn is_capital_heading(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.starts_with(|c: char| c.is_ascii_digit())
        && normalize_turkish(trimmed)
            .to_lowercase()
            .contains("pay ihraclari")
}

/// Tek bir şirket bloğunu sermaye artırımı kaydına çevirir.
///
/// Unvan birden çok satıra sarar, sayısal hücreler unvanın bittiği "AŞ"
/// ekinden sonra başlar:
///
/// ```text
/// Katılımevim  Tasarruf
/// Finansman AŞ  2.070.000.000  7.000.000.000  -  -  4.930.000.000  -
/// ```
fn parse_capital_block(
    block: &[&str],
    bulletin_no: &str,
    approval_date: &str,
) -> Option<SpkCapitalIncrease> {
    let mut company_name = String::new();
    let mut cell_text = String::new();

    for line in block {
        if cell_text.is_empty() {
            if let Some(boundary) = find_company_as_boundary(line) {
                company_name.push(' ');
                company_name.push_str(line[..boundary].trim());
                cell_text.push_str(line[boundary..].trim());
                continue;
            }
            company_name.push(' ');
            company_name.push_str(line.trim());
            continue;
        }
        cell_text.push(' ');
        cell_text.push_str(line.trim());
    }

    let company_name = collapse_spaces(&company_name);
    if company_name.is_empty() || cell_text.is_empty() {
        return None;
    }

    let (cells, sale_type) = parse_capital_cells(&cell_text)?;

    let existing = cells[COL_EXISTING]?;
    let new_capital = cells[COL_NEW]?;
    let rights = cells[COL_RIGHTS].unwrap_or(0.0);
    let bonus_internal = cells[COL_BONUS_INTERNAL].unwrap_or(0.0);
    let bonus_profit = cells[COL_BONUS_PROFIT].unwrap_or(0.0);

    // Sermaye özdeşliği: yeni = mevcut + bedelli + bedelsiz. Tutmuyorsa
    // sütunlar kaymış demektir; uydurma oran üretmektense satır atlanır.
    let expected = existing + rights + bonus_internal + bonus_profit;
    if (expected - new_capital).abs() > CAPITAL_IDENTITY_TOLERANCE {
        eprintln!(
            "[spk] {bulletin_no}: {company_name} — sermaye özdeşliği tutmadı \
             ({existing} + {rights} + {bonus_internal} + {bonus_profit} ≠ {new_capital}); atlandı"
        );
        return None;
    }

    if existing <= 0.0 || new_capital <= existing {
        return None;
    }

    Some(SpkCapitalIncrease {
        company_name,
        existing_capital: existing,
        new_capital,
        rights_amount: rights,
        bonus_internal,
        bonus_profit,
        sale_type,
        bulletin_no: bulletin_no.to_string(),
        approval_date: approval_date.to_string(),
    })
}

/// Hücre metnini beş sayısal sütun + satış türü olarak çözer.
///
/// `parse_row_cells` burada kullanılamaz: o, her tokenin sayı ya da tire
/// olmasını bekler ve "Halka Arz" gibi metin sütunu görünce tüm satırı
/// düşürür.
fn parse_capital_cells(text: &str) -> Option<([Option<f64>; CAPITAL_COLUMNS], Option<String>)> {
    let re_footnote = regex::Regex::new(r"\((?:\d+|\*+)\)").expect("geçerli regex");
    let cleaned = re_footnote.replace_all(text, " ");

    let mut cells: [Option<f64>; CAPITAL_COLUMNS] = [None; CAPITAL_COLUMNS];
    let mut filled = 0usize;
    let mut rest: Vec<&str> = Vec::new();

    for token in cleaned.split_whitespace() {
        if filled < CAPITAL_COLUMNS {
            if token == "-" {
                filled += 1;
                continue;
            }
            match parse_turkish_number(token) {
                Some(value) => {
                    cells[filled] = Some(value);
                    filled += 1;
                }
                // Sayısal sütunlar dolmadan metin geldiyse satır bozuktur.
                None => return None,
            }
            continue;
        }
        rest.push(token);
    }

    if filled < CAPITAL_COLUMNS {
        return None;
    }

    let sale_type = match collapse_spaces(&rest.join(" ")) {
        s if s.is_empty() || s == "-" => None,
        s => Some(s),
    };
    Some((cells, sale_type))
}

/// Bülten başlığından numarayı çıkarır: "Bülten No : 2026/47" → "2026/47".
fn bulletin_number(title: &str) -> String {
    title.split(':').next_back().unwrap_or(title).trim().to_string()
}

/// Sermaye artırımı arşivinin kaç yıl geriye taranacağı.
const CAPITAL_BACKFILL_YEARS: i32 = 10;

/// Aynı anda indirilecek bülten PDF'i sayısı. SPK sunucusu yavaş; yüksek
/// eşzamanlılık bağlantı hatası üretiyor.
const CAPITAL_FETCH_CONCURRENCY: usize = 4;

/// Son on yılın bültenlerini tarayarak bedelli/bedelsiz sermaye artırımı
/// arşivini kurar. Eklenen kayıt sayısını döner.
///
/// İşlenen bültenlerin adresleri arşivde tutulur; ikinci çalıştırmada yalnız
/// yeni bültenler indirilir. Her yıl bitiminde arşiv diske yazılır, böylece
/// yarıda kesilen bir tarama baştan başlamaz.
pub async fn backfill_capital_increases(client: &Client) -> usize {
    use futures::future::join_all;
    use std::sync::Arc;
    use tokio::sync::Semaphore;

    let mut archive = crate::capital_store::load();
    let current_year = chrono::Datelike::year(&chrono::Local::now());
    let mut total_added = 0usize;

    for year in (current_year - CAPITAL_BACKFILL_YEARS + 1)..=current_year {
        let bulletins = match fetch_year_bulletins(client, year).await {
            Ok(list) => list,
            Err(e) => {
                eprintln!("[spk] {year} bülten listesi alınamadı: {e}");
                continue;
            }
        };

        let pending: Vec<SpkBulletin> = bulletins
            .into_iter()
            .filter(|b| !archive.processed_bulletins.contains(&b.url))
            .collect();
        if pending.is_empty() {
            continue;
        }

        let semaphore = Arc::new(Semaphore::new(CAPITAL_FETCH_CONCURRENCY));
        let mut tasks = Vec::new();
        for bulletin in pending {
            let client = client.clone();
            let permit = semaphore.clone();
            tasks.push(tokio::spawn(async move {
                let _permit = permit.acquire().await.ok()?;
                let bytes = fetch_bulletin_pdf(&client, &bulletin.url).await.ok()?;

                let listing_no = bulletin_number(&bulletin.title);
                let listing_date = crate::ipo_scraper::parse_turkish_date(&bulletin.date);

                // pdf_extract işlemciye bağlıdır; çalışma zamanını bloklamasın.
                let increases = tokio::task::spawn_blocking(move || {
                    let text = match pdf_extract::extract_text_from_mem(&bytes) {
                        Ok(text) => text,
                        Err(e) => {
                            eprintln!("[spk] {listing_no}: PDF metni çıkarılamadı: {e}");
                            return Vec::new();
                        }
                    };
                    // Eski arşiv sayfaları tarih vermiyor; PDF başlığı hem
                    // numarayı hem tarihi taşıdığı için önceliklidir.
                    let (no, date) = bulletin_header(&text)
                        .unwrap_or((listing_no.clone(), listing_date.clone()));

                    // Tarih arşivde "arz sonrası mı" kıyasının anahtarı; bozuk
                    // bir tarih bedelsizi yanlış tarafa düşürüp getiriyi
                    // sessizce kaydırır. Liste sayfasından gelen metin bazen
                    // "2026-03-2022" gibi çözülüyordu — böyle bir bülten
                    // yarım veri yazmaktansa atlanır.
                    if !crate::ipo_store::looks_like_iso_date(&date) {
                        eprintln!("[spk] {no}: tarih çözülemedi ({date:?}); bülten atlandı");
                        return Vec::new();
                    }

                    extract_capital_increases_from_text(&text, &no, &date)
                })
                .await
                .ok()?;

                Some((bulletin.url, increases))
            }));
        }

        let mut year_added = 0usize;
        let mut year_bulletins = 0usize;
        for res in join_all(tasks).await {
            let Ok(Some((url, increases))) = res else { continue };
            year_bulletins += 1;
            year_added += crate::capital_store::merge(&mut archive, increases);
            archive.processed_bulletins.insert(url);
        }

        total_added += year_added;
        eprintln!("[spk] {year}: {year_bulletins} bülten tarandı, {year_added} sermaye artırımı eklendi");

        archive.last_updated = Some(chrono::Local::now().format("%Y-%m-%d").to_string());
        crate::capital_store::save(&archive);
    }

    total_added
}

/// En son SPK bültenlerini tarayarak halka arz onaylarını çıkarır.
///
/// Son `SCAN_BULLETINS` bülteni sırayla indirir, PDF metnini çıkarır ve
/// halka arz onay tablosunu ayrıştırır. Halka arz içermeyen bültenler
/// sessizce atlanır.
pub async fn fetch_and_parse_latest_approvals(
    client: &Client,
) -> Result<Vec<SpkIpoApproval>, Box<dyn Error + Send + Sync>> {
    let bulletins = fetch_latest_bulletins(client).await?;
    let mut all_approvals = Vec::new();

    for bulletin in bulletins.iter().take(SCAN_BULLETINS) {
        let pdf_bytes = match fetch_bulletin_pdf(client, &bulletin.url).await {
            Ok(bytes) => bytes,
            Err(e) => {
                eprintln!("[spk] PDF indirilemedi {}: {e}", bulletin.url);
                continue;
            }
        };

        // Bülten numarasını title'dan çıkar: "Bülten No : 2026/47" → "2026/47"
        let bulletin_no = bulletin
            .title
            .split(':')
            .last()
            .unwrap_or(&bulletin.title)
            .trim()
            .to_string();

        let approvals = extract_ipo_approvals_from_pdf(
            &pdf_bytes,
            &bulletin_no,
            &bulletin.date,
        );

        if !approvals.is_empty() {
            eprintln!(
                "[spk] {} bülteninden {} halka arz onayı çıkarıldı",
                bulletin_no,
                approvals.len()
            );
        }

        all_approvals.extend(approvals);
    }

    Ok(all_approvals)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 2026/49 ve 2026/48 bültenlerinin "Halka Açık Ortaklıkların Pay
    /// İhraçları" bölümleri, `pdf_extract` çıktısından birebir alındı.
    const CAPITAL_SECTION: &str = include_str!("../data/spk_capital_section.txt");

    fn capital_of(label: &str) -> Vec<SpkCapitalIncrease> {
        let block = CAPITAL_SECTION
            .split("### ")
            .find(|b| b.starts_with(label))
            .expect("bülten bloğu");
        extract_capital_increases_from_text(block, label, "2026-08-05")
    }

    #[test]
    fn reads_bonus_increase_rows() {
        let rows = capital_of("2026/49");
        assert_eq!(rows.len(), 3, "{rows:#?}");

        let derluks = &rows[0];
        assert_eq!(derluks.company_name, "Derlüks Yatırım Holding AŞ");
        assert_eq!(derluks.existing_capital, 197_281_323.0);
        assert_eq!(derluks.new_capital, 989_179_083.0);
        assert_eq!(derluks.rights_amount, 0.0);
        assert_eq!(derluks.bonus_internal, 791_897_760.0);
        assert!(derluks.is_bonus() && !derluks.is_rights());
        // 989.179.083 / 197.281.323 = 5,0141…
        assert!((derluks.bonus_factor() - 5.0141).abs() < 1e-3, "{}", derluks.bonus_factor());
    }

    /// Bedelsiz kâr payından da gelebilir; ayrı sütundur ama etkisi aynıdır.
    #[test]
    fn bonus_from_profit_counts_the_same() {
        let rows = capital_of("2026/49");
        let visne = rows.iter().find(|r| r.company_name.starts_with("Vişne")).unwrap();
        assert_eq!(visne.bonus_internal, 0.0);
        assert_eq!(visne.bonus_profit, 64_350_000.0);
        assert!((visne.bonus_factor() - 1.55).abs() < 1e-6);
    }

    /// Bölüm numarası sabit değil: halka arz onayı olmayan haftada bu bölüm
    /// "1." olarak numaralanıyor. Başlık metni aranmalı.
    #[test]
    fn section_is_found_regardless_of_its_number() {
        let rows = capital_of("2026/48");
        assert_eq!(rows.len(), 3, "{rows:#?}");
        assert!(rows.iter().any(|r| r.company_name.starts_with("Katılımevim")));
    }

    /// KTLEV — Yahoo'nun olay listesi bu hissede ×937,9 üretiyordu. SPK
    /// tablosu gerçek oranı veriyor: 7.000.000.000 / 2.070.000.000 = ×3,3816.
    #[test]
    fn reads_the_ktlev_bonus_that_yahoo_corrupted() {
        let rows = capital_of("2026/48");
        let ktlev = rows.iter().find(|r| r.company_name.starts_with("Katılımevim")).unwrap();
        assert_eq!(ktlev.existing_capital, 2_070_000_000.0);
        assert_eq!(ktlev.new_capital, 7_000_000_000.0);
        assert_eq!(ktlev.bonus_profit, 4_930_000_000.0);
        assert!((ktlev.bonus_factor() - 3.3816).abs() < 1e-3, "{}", ktlev.bonus_factor());
    }

    /// Bedelli satırı: ortak para öder, `bonus_factor` 1 kalmalı.
    #[test]
    fn rights_issue_is_not_treated_as_a_split() {
        let rows = capital_of("2026/48");
        let cvk = rows.iter().find(|r| r.company_name.starts_with("CVK")).unwrap();
        assert_eq!(cvk.rights_amount, 2_380_000_000.0);
        assert_eq!(cvk.bonus_amount(), 0.0);
        assert_eq!(cvk.bonus_factor(), 1.0, "bedelli bölünme değildir");
        assert!((cvk.rights_ratio() - 1.7).abs() < 1e-9);
        assert_eq!(cvk.sale_type.as_deref(), Some("Halka Arz"));
    }

    /// Kuruşlu tutarlar ve satış türü birlikte gelebiliyor.
    #[test]
    fn reads_fractional_amounts_with_a_sale_type() {
        let rows = capital_of("2026/48");
        let karsu = rows.iter().find(|r| r.company_name.starts_with("Karsu")).unwrap();
        assert_eq!(karsu.existing_capital, 35_100_498.42);
        assert_eq!(karsu.rights_amount, 105_301_495.26);
        assert_eq!(karsu.sale_type.as_deref(), Some("Halka Arz"));
    }

    /// Sermaye özdeşliği tutmayan satır uydurma oran üretmek yerine atlanır.
    #[test]
    fn rows_failing_the_capital_identity_are_skipped() {
        let text = "\
  2.  Halka Açık Ortaklıkların Pay İhraçları

Sahte  Şirket
AŞ  100.000.000  500.000.000  -  200.000.000  -  -

  3.  Borçlanma Araçları
";
        assert!(extract_capital_increases_from_text(text, "test", "2026-01-01").is_empty());
    }

    #[test]
    fn missing_section_yields_nothing() {
        assert!(extract_capital_increases_from_text("boş bülten", "t", "d").is_empty());
    }

    /// 2021 ve öncesi arşiv sayfaları blok yapısı taşımaz, düz bağlantı verir.
    #[test]
    fn old_archive_links_are_parsed() {
        let html = r#"<a href="https://spk.gov.tr/data/abc/2020-5.pdf">x</a>
                      <a href="https://spk.gov.tr/data/abc/2020-50.pdf">y</a>
                      <a href="https://spk.gov.tr/data/abc/2020-5.pdf">yinelenen</a>
                      <a href="https://spk.gov.tr/data/abc/2022-2026 STRATEJİK PLAN.pdf">plan</a>"#;
        let rows = parse_bulletin_links(html, 2020);
        assert_eq!(rows.len(), 2, "{rows:#?}");
        assert_eq!(rows[0].title, "Bülten No : 2020/5");
        assert!(rows[0].url.ends_with("2020-5.pdf"));
        // Farklı yıl istendiğinde eşleşme olmamalı
        assert!(parse_bulletin_links(html, 2019).is_empty());
    }

    /// Eski bültenlerde tarih yalnız PDF başlığında bulunuyor.
    #[test]
    fn bulletin_header_gives_number_and_iso_date() {
        let text = "  SERMAYE PİYASASI KURULU \nBÜLTENİ \n\n2020/50    13/08/2020 \n";
        assert_eq!(
            bulletin_header(text),
            Some(("2020/50".to_string(), "2020-08-13".to_string()))
        );
        assert_eq!(bulletin_header("başlıksız metin"), None);
    }

    #[test]
    fn bulletin_number_is_taken_from_the_title() {
        assert_eq!(bulletin_number("Bülten No : 2026/47"), "2026/47");
        assert_eq!(bulletin_number("2026/47"), "2026/47");
    }

    #[test]
    fn decodes_turkish_entities() {
        assert_eq!(decode_entities("B&#252;lten"), "Bülten");
        assert_eq!(decode_entities("&#304;stanbul"), "İstanbul");
    }

    /// Fixture canlı sayfadan alınmıştır: SPK, Türkçe karakterleri düz UTF-8
    /// gönderiyor (`Yayımlanma`, `Perşembe`), sayısal varlık olarak değil.
    /// `decode_entities` bu sayfada no-op; kodlama değişirse diye savunma amaçlı
    /// duruyor ve ayrı testte doğrulanıyor.
    const SAMPLE_PAGE: &str = r#"
    <a href="https://spk.gov.tr/data/6a62701d8f95db0c500ba5eb/2026-47.pdf" class="link">
                                <div class="liste-item">
                                    <img class="liste-img" src="/assets/img/pdf.png">
                                    <div class="liste-content">
                                        <div class="liste-baslik">
                                           Bülten No : 2026/47
                                        </div>
                                        <div class="liste-icerik  overflow-hidden-2">
                                           Yayımlanma : 23 Temmuz 2026 Perşembe
                                        </div>
                                    </div>
                                </div>
    </a>"#;

    #[test]
    fn parses_bulletin_block() {
        let rows = parse_bulletins(SAMPLE_PAGE);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].title, "Bülten No : 2026/47");
        // "Yayımlanma :" etiketi regex'te tüketilir; alanda yalnız tarih kalır.
        assert_eq!(rows[0].date, "23 Temmuz 2026 Perşembe");
        assert!(rows[0].url.ends_with("2026-47.pdf"));
    }

    /// Bülten dışı PDF'ler listede geçiyor ve elenmeli.
    #[test]
    fn skips_non_bulletin_pdfs() {
        let page = SAMPLE_PAGE.replace("2026-47.pdf", "STRATEJİK PLAN.pdf");
        assert!(parse_bulletins(&page).is_empty());
    }

    /// Boş/alakasız sayfa panik değil boş liste vermeli — `fetch_latest_bulletins`
    /// bu boşluğu görüp bir önceki yıla düşüyor.
    #[test]
    fn unrelated_page_yields_no_bulletins() {
        assert!(parse_bulletins("<html><body>bakım</body></html>").is_empty());
    }

    /// Yıl sayfası URL'i takvimden türetilmeli; sabit yıl 1 Ocak'ta bozulur.
    #[test]
    fn year_url_follows_calendar() {
        assert!(year_url(2027).ends_with("/2027-yili-spk-bultenleri"));
        assert!(year_url(2026).ends_with("/2026-yili-spk-bultenleri"));
    }

    /// Canlı sayfadan alınmış kalıp: sıra sütunu boş başlık hücresiyle başlar,
    /// unvan `<strong>`/`<div>` sarmalları içinde gelebilir, boş hücre `\u{a0}`.
    const SAMPLE_APPLICATIONS: &str = "<table><tbody>
        <tr>
            <td nowrap=\"nowrap\" style=\"width: 35px;\">\u{a0}</td>
            <td><strong>Şirketler</strong></td>
            <td><div><strong>Başvuru</strong></div><div><strong>Tarihi</strong></div></td>
        </tr>
        <tr>
            <td>1</td>
            <td>Multinet Kurumsal Hizmetleri A.Ş.</td>
            <td>17.10.2023</td>
        </tr>
        <tr>
            <td>2</td>
            <td>Elin Elektrik &#304;n&#351;aat M&#252;&#351;avirlik Proje A.&#350;.</td>
            <td>23.09.2024</td>
        </tr>
    </tbody></table>";

    /// Regresyon: sıra sütunu unvan yerine geçiyordu ve arşive "1", "2" adlı
    /// kayıtlar düşüyordu.
    #[test]
    fn application_rows_take_name_not_row_number() {
        let rows = parse_spk_applications(SAMPLE_APPLICATIONS);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].company_name, "Multinet Kurumsal Hizmetleri A.Ş.");
        assert_eq!(rows[0].application_date, "17.10.2023");
        assert_eq!(rows[1].company_name, "Elin Elektrik İnşaat Müşavirlik Proje A.Ş.");
        assert_eq!(rows[1].application_date, "23.09.2024");
    }

    /// Başlık satırında tarih hücresi yoktur; kayıt üretmemeli.
    #[test]
    fn application_header_row_is_skipped() {
        for row in parse_spk_applications(SAMPLE_APPLICATIONS) {
            assert!(!row.company_name.contains("Şirketler"));
            assert!(!row.company_name.contains("Başvuru"));
        }
    }

    /// Sıra sütunu kaldırılırsa da (iki sütunlu tablo) doğru okunmalı —
    /// ayrıştırma konuma değil içeriğe bakıyor.
    #[test]
    fn application_parsing_survives_column_removal() {
        let two_col = "<table><tr><td>Örnek Sanayi A.Ş.</td><td>05.02.2026</td></tr></table>";
        let rows = parse_spk_applications(two_col);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].company_name, "Örnek Sanayi A.Ş.");
        assert_eq!(rows[0].application_date, "05.02.2026");
    }

    #[test]
    fn tr_date_shape_is_strict() {
        assert!(looks_like_tr_date("17.10.2023"));
        assert!(!looks_like_tr_date("2023-10-17"));
        assert!(!looks_like_tr_date("1"));
        assert!(!looks_like_tr_date("Multinet Kurumsal Hizmetleri A.Ş."));
    }

    /// Gerçek `pdf_extract` çıktısı (2026/49 ve 2026/47 bültenlerinden derlendi).
    /// 1. bölüm yedi sütunludur; 2. bölüm sermaye artırımıdır, halka arz değildir.
    const SAMPLE_BULLETIN: &str = "\
A.  İZAHNAME / İHRAÇ BELGESİ ONAYLANAN SERMAYE PİYASASI ARAÇLARI

1.  İlk Halka Arzlar

Ortaklık  Mevcut
Sermaye  Yeni
Sermaye
Sermaye Artırımı  Mevcut
Pay Satışı  Ek Pay
Satışı  Satış
Fiyatı
Bedelli  Bedelsiz

Çitlekçi  Mağazacılık
Gıda AŞ  150.000.000  180.000.000  30.000.000  -  6.500.000
(1)  -  73,70
(2)

Türker  Vangölü  Enerji
Yatırım AŞ  529.354.723  566.854.723  37.500.000  -  27.500.000
(5)  12.500.000
(6)  136,00
(7)

Kapeks  Kimya  Sanayi
AŞ  100.000.000  125.100.000  25.100.000  -  -  -  94,00
(8)

(1)  Mevcut ortaklardan Tunçlar Yatırım Holding AŞ'ye ait 6.500.000 TL nominal değerli paylar.
(2)  1 TL nominal değerli paylar 73,70 TL sabit fiyat üzerinden satışa sunulacaktır.

________________________________________________________________________________
MERKEZ Eskişehir Yolu 8.Km No:156 06530 ANKARA Tel: (312) 292 90 90
2

2.  Halka Açık Ortaklıkların Pay İhraçları

Ortaklık  Mevcut
Sermaye  Yeni

Dinamik  Isı  Makina
Yalıtım Malzemeleri
Sanayi ve Ticaret AŞ  119.728.125  520.000.000  -  400.271.875  -  -

Vişne  Madencilik  Üretim
Sanayi ve Ticaret AŞ  117.000.000  181.350.000  -  -  64.350.000  -

3.  Borçlanma Araçları
";

    #[test]
    fn parses_ipo_section_columns() {
        let approvals =
            extract_ipo_approvals_from_text(SAMPLE_BULLETIN, "2026/49", "05 Ağustos 2026");
        assert_eq!(approvals.len(), 3, "üç halka arz beklenir: {approvals:#?}");

        let citlekci = &approvals[0];
        assert_eq!(citlekci.company_name, "Çitlekçi Mağazacılık Gıda AŞ");
        assert_eq!(citlekci.capital_increase_lots, 30_000_000.0);
        assert_eq!(citlekci.share_sale_lots, 6_500_000.0);
        assert_eq!(citlekci.extra_sale_lots, 0.0);
        assert_eq!(citlekci.total_lots, 36_500_000.0);
        assert_eq!(citlekci.price, 73.70);

        // Ek pay satışı ayrı tutulur; taban arz büyüklüğüne girmez.
        let turker = &approvals[1];
        assert_eq!(turker.capital_increase_lots, 37_500_000.0);
        assert_eq!(turker.share_sale_lots, 27_500_000.0);
        assert_eq!(turker.extra_sale_lots, 12_500_000.0);
        assert_eq!(turker.total_lots, 65_000_000.0);
        assert_eq!(turker.price, 136.00);

        // Pay satışı olmayan, yalnız sermaye artırımıyla yapılan arz.
        let kapeks = &approvals[2];
        assert_eq!(kapeks.company_name, "Kapeks Kimya Sanayi AŞ");
        assert_eq!(kapeks.total_lots, 25_100_000.0);
        assert_eq!(kapeks.price, 94.00);
        assert_eq!(kapeks.ipo_size_tl, 25_100_000.0 * 94.00);
    }

    /// Regresyon: 2. bölümdeki sermaye artırımları halka arz sayılıyor, fiyat
    /// sütunu bulunmadığı için lot sayısı fiyat yerine geçiyordu (Dinamik Isı
    /// Makina için 400.271.875 TL "fiyat", 1,6×10¹⁷ TL "arz büyüklüğü").
    #[test]
    fn capital_increases_are_not_ipos() {
        let approvals =
            extract_ipo_approvals_from_text(SAMPLE_BULLETIN, "2026/49", "05 Ağustos 2026");
        for approval in &approvals {
            assert!(!approval.company_name.contains("Dinamik"), "{approval:?}");
            assert!(!approval.company_name.contains("Vişne"), "{approval:?}");
            assert!(approval.price < PRICE_CEILING, "{approval:?}");
        }
    }

    /// Bölüm sayfa sınırını aşabiliyor; araya giren başlık/altlık tabloyu
    /// kesmemeli, ama bir sonraki numaralı başlık kesmeli.
    #[test]
    fn page_furniture_does_not_end_the_section() {
        let lines: Vec<&str> = SAMPLE_BULLETIN.lines().collect();
        let section = ipo_section(&lines).expect("bölüm bulunmalı");
        assert!(section.iter().all(|line| !line.contains("MERKEZ Eskişehir")));
        assert!(section.iter().all(|line| !line.contains("Dinamik")));
    }

    #[test]
    fn footnote_lines_are_told_apart_from_cells() {
        assert!(!is_footnote("(1)  -  73,70"));
        assert!(!is_footnote("(2)"));
        assert!(is_footnote(
            "(1)  Mevcut ortaklardan Tunçlar Yatırım Holding AŞ'ye ait paylar."
        ));
        // Sermaye artırımı tablosunda satış türü hücresi satır sarabiliyor;
        // dipnot işaretiyle başlasa da tablo satırıdır.
        assert!(!is_footnote("(1)  -  -  Halka "));
        assert!(!is_footnote("(3)  -  -  Tahsisli/Nitelikli Yatırımcı"));
    }

    /// Regresyon: "Ek Pay Satışı" hücresi boş bırakıldığında (tire bile yok)
    /// altı hücre çıkıyor ve sabit yedi sütun dayatması geçerli satırı
    /// düşürüyordu — 2026/5 bülteninde Best Brands böyle kayboldu.
    #[test]
    fn missing_trailing_cell_is_tolerated() {
        let text = "1.  İlk Halka Arzlar

Best  Brands  Grup
Enerji Yatırım AŞ  150.000.000  188.205.000  38.205.000  -  16.373.570
(1)  14,70
(2)
";
        let approvals = extract_ipo_approvals_from_text(text, "2026/5", "29 Ocak 2026");
        assert_eq!(approvals.len(), 1, "{approvals:#?}");
        assert_eq!(approvals[0].company_name, "Best Brands Grup Enerji Yatırım AŞ");
        assert_eq!(approvals[0].capital_increase_lots, 38_205_000.0);
        assert_eq!(approvals[0].share_sale_lots, 16_373_570.0);
        assert_eq!(approvals[0].extra_sale_lots, 0.0);
        assert_eq!(approvals[0].price, 14.70);
    }

    /// Regresyon: unvanın ardından yıldızlı dipnot gelebiliyor. Yalnız
    /// numaralı işaretleri silen desen "(*)" belirtecini hücre sanıyor ve
    /// satırı düşürüyordu — 2024/37 bülteninde Bahadır Kimya böyle kayboldu.
    #[test]
    fn star_footnote_marker_is_stripped() {
        let text = "1.  İlk Halka Arzlar

Bahadır Kimya Sanayi ve Ticaret AŞ  (*)  45.000.000  55.000.000  10.000.000  -  6.000.000
(1)  -  51,00
(2)
";
        let approvals = extract_ipo_approvals_from_text(text, "2024/37", "01 Ağustos 2024");
        assert_eq!(approvals.len(), 1, "{approvals:#?}");
        assert_eq!(approvals[0].company_name, "Bahadır Kimya Sanayi ve Ticaret AŞ");
        assert_eq!(approvals[0].capital_increase_lots, 10_000_000.0);
        assert_eq!(approvals[0].share_sale_lots, 6_000_000.0);
        assert_eq!(approvals[0].price, 51.00);
    }

    /// Sermaye özdeşliği (`yeni = mevcut + bedelli + bedelsiz`) tutmuyorsa
    /// sütunlar kaymış demektir; kayıt üretilmemeli.
    #[test]
    fn shifted_columns_fail_the_capital_identity() {
        let text = "1.  İlk Halka Arzlar

Örnek Sanayi AŞ  100.000.000  900.000.000  25.000.000  -  5.000.000  -  30,00
";
        assert!(extract_ipo_approvals_from_text(text, "2026/1", "01 Ocak 2026").is_empty());
    }

    #[test]
    fn turkish_numbers_round_trip() {
        assert_eq!(parse_turkish_number("150.000.000"), Some(150_000_000.0));
        assert_eq!(parse_turkish_number("73,70"), Some(73.70));
        assert_eq!(parse_turkish_number("266.367.619,6"), Some(266_367_619.6));
        assert_eq!(parse_turkish_number("-"), None);
        assert_eq!(parse_turkish_number("TL"), None);
    }

    /// Sütun sayısı beklenenden farklıysa kayıt üretilmemeli: yarım okunmuş bir
    /// satırı yanlış sütuna yazmak, hiç yazmamaktan kötüdür.
    #[test]
    fn unexpected_column_count_is_rejected() {
        let text = "1.  İlk Halka Arzlar\n\nÖrnek Sanayi AŞ  100.000.000  125.000.000  25,00\n";
        assert!(extract_ipo_approvals_from_text(text, "2026/1", "01 Ocak 2026").is_empty());
    }

    #[test]
    fn skips_text_without_ipo_section() {
        let text = "Sermaye Piyasası Kurulu Bülteni\nGenel düzenlemeler hakkında...";
        let approvals = extract_ipo_approvals_from_text(text, "2026/49", "01 Ağustos");
        assert!(approvals.is_empty());
    }

    /// Ayrıştırıcıyı gerçek arşivle doğrular: iki yılın tüm bültenlerini tarar,
    /// çıkarılan onayları JSON olarak basar. Sütun düzeni beklenenden farklı
    /// olan satırlar stderr'e uyarı düşer — sessizce yanlış veri üretilmez.
    #[tokio::test]
    #[ignore = "canlı SPK erişimi gerektirir (~2 dk)"]
    async fn backfill_two_years_of_approvals() {
        let client = crate::http_client();
        let mut all = Vec::new();

        for year in [2024, 2025, 2026] {
            let bulletins = fetch_year_bulletins(&client, year).await.unwrap();
            eprintln!("[{year}] {} bülten", bulletins.len());
            for bulletin in &bulletins {
                let Ok(bytes) = fetch_bulletin_pdf(&client, &bulletin.url).await else {
                    eprintln!("[{year}] indirilemedi: {}", bulletin.url);
                    continue;
                };
                let number = bulletin
                    .title
                    .split(':')
                    .next_back()
                    .unwrap_or(&bulletin.title)
                    .trim()
                    .to_string();
                all.extend(extract_ipo_approvals_from_pdf(&bytes, &number, &bulletin.date));
            }
        }

        eprintln!("toplam {} halka arz onayı", all.len());
        println!("{}", serde_json::to_string(&all).expect("serileştirilebilir"));
    }

    #[tokio::test]
    #[ignore = "canlı SPK erişimi gerektirir"]
    async fn live_applications_have_company_names() {
        let client = crate::http_client();
        let rows = fetch_spk_applications(&client).await.unwrap();
        assert!(!rows.is_empty(), "başvuru listesi boş dönmemeli");
        for row in &rows {
            assert!(
                !row.company_name.chars().all(|c| c.is_ascii_digit()),
                "sıra numarası unvan olarak alınmış: {row:?}"
            );
            assert!(looks_like_tr_date(&row.application_date), "tarih bozuk: {row:?}");
        }
        println!("{} başvuru; ilk: {} · {}", rows.len(), rows[0].company_name, rows[0].application_date);
    }

    #[tokio::test]
    #[ignore = "canlı SPK erişimi gerektirir"]
    async fn live_bulletins_are_current_year() {
        let client = crate::http_client();
        let rows = fetch_latest_bulletins(&client).await.unwrap();
        assert!(!rows.is_empty(), "bülten listesi boş dönmemeli");
        assert!(rows.len() <= BULLETIN_LIMIT);
        for row in &rows {
            assert!(row.url.ends_with(".pdf"), "bülten bağlantısı PDF olmalı: {}", row.url);
            assert!(!row.title.is_empty() && !row.date.is_empty());
            assert!(!row.title.contains("&#"), "başlıkta çözülmemiş varlık: {}", row.title);
        }
        println!("son bülten: {} · {}", rows[0].title, rows[0].date);
    }

    #[tokio::test]
    #[ignore = "canlı SPK erişimi gerektirir"]
    async fn live_pdf_approval_extraction() {
        let client = crate::http_client();

        // Bilinen halka arz içeren bülteni doğrudan test et
        let known_url = "https://spk.gov.tr/data/6a7395628f95db1c20deaf20/2026-49.pdf";
        let pdf_bytes = fetch_bulletin_pdf(&client, known_url).await.unwrap();
        println!("PDF boyutu: {} bytes", pdf_bytes.len());

        let text = pdf_extract::extract_text_from_mem(&pdf_bytes).unwrap();
        println!("\n=== pdf_extract çıktısı (ilk 2000 karakter) ===");
        println!("{}", &text[..text.len().min(2000)]);

        println!("\n=== AŞ/A.Ş içeren satırlar ===");
        for (i, line) in text.lines().enumerate() {
            let t = line.trim();
            if t.ends_with(" AŞ") || t == "AŞ" || t.ends_with("AŞ") || t.contains("A.Ş") {
                println!("L{}: [{}]", i, t);
            }
        }

        let approvals = extract_ipo_approvals_from_pdf(
            &pdf_bytes, "2026/49", "05 Ağustos 2026"
        );
        println!("\ntoplam {} halka arz onayı bulundu:", approvals.len());
        for a in &approvals {
            println!(
                "  {} — sermaye_artırımı:{:.0}, pay_satışı:{:.0}, toplam:{:.0} lot, fiyat:{:.2} TL, büyüklük:{:.0} TL",
                a.company_name, a.capital_increase_lots, a.share_sale_lots, a.total_lots, a.price, a.ipo_size_tl
            );
        }

        // Pipeline ile de test et
        let pipeline_approvals = fetch_and_parse_latest_approvals(&client).await.unwrap();
        println!("\npipeline toplam {} onay buldu", pipeline_approvals.len());
    }
}

#[cfg(test)]
mod capital_backfill_live {
    /// Son on yılın bültenlerinden bedelli/bedelsiz arşivini kurar.
    /// ~680 PDF indirir; ilk çalıştırma birkaç dakika sürer.
    #[tokio::test]
    #[ignore = "canlı SPK erişimi gerektirir ve ~/.fraude_capital_increases.json dosyasını yazar"]
    async fn run_backfill() {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(90))
            .build()
            .unwrap();
        let t0 = std::time::Instant::now();
        let added = super::backfill_capital_increases(&client).await;
        let archive = crate::capital_store::load();
        println!(
            "\ntoplam {added} yeni kayıt, arşivde {} kayıt, {} bülten işlendi ({:?})",
            archive.records.len(),
            archive.processed_bulletins.len(),
            t0.elapsed()
        );
    }
}
