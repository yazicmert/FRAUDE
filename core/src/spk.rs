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
    /// Sabit fiyatla onaylandıysa pay fiyatı; aralıkla onaylandıysa 0.
    pub price: f64,
    pub ipo_size_tl: f64,
    /// Talep toplamalı arzlarda onaylanan taban-tavan aralığı ("8,50 - 9,90 TL").
    /// Kesin fiyat talep toplama sonrası belli olur.
    #[serde(default)]
    pub price_range: Option<String>,
    pub consortium_lead: Option<String>,
    pub bulletin_no: String,
    pub approval_date: String,
}

/// Türkçe karakterleri ASCII eşdeğerlerine dönüştürür (fuzzy matching için).
///
/// Şapkalı harfler de indirgenir: bülten tablolarının başlığında "Kâr
/// Payından" geçiyor ve 'â' ASCII'ye inmezse başlık sözlüğüyle eşleşmiyor.
pub fn normalize_turkish(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'ç' | 'Ç' => 'c',
            'ğ' | 'Ğ' => 'g',
            'ı' | 'İ' | 'î' | 'Î' => 'i',
            'ö' | 'Ö' => 'o',
            'ş' | 'Ş' => 's',
            'ü' | 'Ü' | 'û' | 'Û' => 'u',
            'â' | 'Â' => 'a',
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

        // Blok yapısı yoksa (2021 ve öncesi) tablo düzenine, o da tutmazsa düz
        // bağlantı listesine düşülür. Sıra önemli: tablo hem tarihi hem bülten
        // numarasını verir ve PDF adı anlamsız olsa da satırı yakalar.
        let html = fetch_page_html(client, &base).await?;
        let rows = parse_bulletin_rows(&html, year);
        if !rows.is_empty() {
            return Ok(rows);
        }
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

/// Eski arşiv sayfalarının tablo düzeni için ayrıştırıcı.
///
/// 2021 arşivi bültenleri üç hücrelik gruplar hâlinde bir tabloda verir ve
/// PDF adları **anlamsızdır** (`8d06cd9d947815143db2e1c0efef1804.pdf`):
///
/// ```html
/// <tr>
///   <td>14.10.2021</td><td>2021 / 51</td><td><a href=".../5896753e….pdf">…
///   <td>21.10.2021</td><td>2021 / 52</td><td><a href=".../0194410c….pdf">…
/// </tr>
/// ```
///
/// Dosya adından yıl okuyan `parse_bulletin_links` bunları göremiyordu: 2021'in
/// 67 bülteninden yalnız 40'ı taranıyor, kalan 27'sindeki sermaye artırımı ve
/// halka arz onayları hiç görülmüyordu. Tablo ayrıca tarihi de taşır, bu yüzden
/// PDF başlığına düşmeye gerek kalmaz.
fn parse_bulletin_rows(html: &str, year: i32) -> Vec<SpkBulletin> {
    let re = regex::Regex::new(
        r#"(?is)<td[^>]*>\s*(\d{2})\.(\d{2})\.(\d{4})\s*</td>\s*<td[^>]*>\s*(\d{4})\s*/\s*(\d+)\s*</td>\s*<td[^>]*>\s*<a\s+href="([^"]+\.pdf)""#,
    )
    .expect("geçerli regex");

    let mut seen = std::collections::HashSet::new();
    let mut bulletins = Vec::new();
    for capture in re.captures_iter(html) {
        // Sayfa yalnız kendi yılını listelemeli; farklı yıl satırı sızarsa
        // o yılın taramasında ikinci kez sayılır.
        if capture[4].parse::<i32>().ok() != Some(year) {
            continue;
        }
        let url = capture[6].to_string();
        if !seen.insert(url.clone()) {
            continue;
        }
        bulletins.push(SpkBulletin {
            title: format!("Bülten No : {}/{}", &capture[4], &capture[5]),
            date: format!("{}-{}-{}", &capture[3], &capture[2], &capture[1]),
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
        .flat_map(|block| parse_approval_block(block, bulletin_no, approval_date))
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
        if !is_page_furniture(line) && !is_table_header(line) {
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

    // Dipnot işaretinden sonra yeni bir şirketin tablo satırı başlayabiliyor
    // (2021/49: "(5) Anatolia Tanı ve Biyoteknoloji Ürünleri AŞ 100.000.000
    // …"). Bunu dipnot sayan bölüm ayrıştırıcısı tabloyu orada kesiyor ve
    // kalan arzların hepsini düşürüyordu.
    if looks_like_table_row(trimmed) {
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

/// Tablo sütun başlığı satırı mı?
///
/// Başlık iki-üç satıra sarar ve gövdeden **boş satırla ayrılmayabilir**; o
/// zaman ilk şirketin bloğuna karışır ve unvanın başına yapışır. Arşivde
/// "Ortaklık Mevcut Sermaye Yeni Sermaye Bedelli Sermaye Artırımı Bedelsiz
/// Sermaye Artırımı Satış Türü İç Kaynaklardan Kâr Payından Global Yatırım
/// Holding AŞ" adlı kayıt böyle oluştu: unvan tanınmaz hâle geldiği için
/// BIST koduna da bağlanamıyordu.
///
/// Ölçüt satırdaki **her** kelimenin başlık sözlüğünde geçmesidir. Tek kelime
/// eşleşmesi yetmez: şirket unvanları da "Sermaye", "Yatırım", "Pay" taşıyor
/// ("Vişne Madencilik", "İş Girişim Sermayesi Yatırım Ortaklığı").
fn is_table_header(line: &str) -> bool {
    const HEADER_WORDS: &[&str] = &[
        "ortaklik", "mevcut", "yeni", "sermaye", "artirimi", "bedelli", "bedelsiz",
        "ic", "kaynaklardan", "kar", "payindan", "satis", "satisi", "turu", "pay",
        "ek", "fiyati",
    ];

    let mut matched = 0usize;
    for word in line.split_whitespace() {
        let key: String = normalize_turkish(word)
            .to_lowercase()
            .chars()
            .filter(|c| c.is_alphanumeric())
            .collect();
        if key.is_empty() {
            continue;
        }
        if !HEADER_WORDS.contains(&key.as_str()) {
            return false;
        }
        matched += 1;
    }
    matched > 0
}

/// Satır bir şirketin tablo satırı mı?
///
/// Ölçüt: bağımsız bir hukuki form eki ("AŞ") ve ardından en az iki sayı.
/// Gerçek dipnot metni şirket adını çekimli anıyor ("AŞ'ye ait") — bu bağımsız
/// jeton sayılmaz — ve tek sayı taşıyor.
fn looks_like_table_row(line: &str) -> bool {
    let tokens: Vec<&str> = line.split_whitespace().collect();
    let Some(suffix) = tokens.iter().position(|token| is_company_suffix(token)) else {
        return false;
    };
    tokens[suffix + 1..]
        .iter()
        .filter(|token| parse_turkish_number(token).is_some())
        .count()
        >= 2
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

/// Tablo hücresi.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Cell {
    /// Boş hücre; metinde tire olarak görünür.
    Empty,
    Number(f64),
    /// Fiyat aralığı — talep toplamalı arzlarda sabit fiyat yerine bu onaylanır.
    Range(f64, f64),
}

impl Cell {
    fn number(self) -> Option<f64> {
        match self {
            Cell::Number(value) => Some(value),
            _ => None,
        }
    }

    fn number_or_zero(self) -> f64 {
        self.number().unwrap_or(0.0)
    }
}

/// Bir bloktaki **her** şirketi onay kaydına çevirir.
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
///
/// Blok **birden çok şirket taşıyabilir**: `pdf_extract` iki satırın arasına
/// her zaman boş satır koymuyor ve ikinci unvan birincinin fiyat hücresinin
/// hemen ardından başlıyor (2021/49'da Gelecek Varlık ile Anatolia Tanı,
/// 2022/7'de Hun Enerji ile DAP Gayrimenkul). Tek şirket varsayan eski
/// ayrıştırıcı böyle bloklarda **iki arzı birden** düşürüyordu; burada jeton
/// akışı sayısal olmayan ilk jetonda kesilip yeni unvan oradan başlatılır.
fn parse_approval_block(
    block: &[&str],
    bulletin_no: &str,
    approval_date: &str,
) -> Vec<SpkIpoApproval> {
    let normalized = normalize_row_text(&block.join(" "));
    let tokens: Vec<&str> = normalized.split_whitespace().collect();

    let mut approvals = Vec::new();
    let mut index = 0usize;
    while index < tokens.len() {
        // 1. Unvan: "AŞ" ekine kadar olan jetonlar.
        let start = index;
        while index < tokens.len() && !is_company_suffix(tokens[index]) {
            index += 1;
        }
        if index == tokens.len() {
            break; // Blokta unvan sonu yok; şirket satırı değil.
        }
        let company_name = tokens[start..=index].join(" ");
        index += 1;

        // 2. Hücreler: sayısal olmayan ilk jetona kadar.
        let cells_start = index;
        let mut cells = Vec::new();
        while index < tokens.len() {
            let Some(cell) = parse_cell(tokens[index]) else { break };
            cells.push(cell);
            index += 1;
        }

        if company_name.chars().filter(|c| c.is_alphabetic()).count() < 3 {
            continue;
        }
        // Hiç hücre okunamadıysa unvan sanılan şey tablo satırı değildir.
        if index == cells_start {
            eprintln!(
                "[spk] {bulletin_no}: {company_name} — hücreler çözülemedi ({:?}); atlandı",
                tokens[cells_start..].join(" ")
            );
            continue;
        }

        if let Some(approval) = approval_from_cells(
            company_name,
            &cells,
            bulletin_no,
            approval_date,
        ) {
            approvals.push(approval);
        }
    }

    approvals
}

/// Jeton unvanı bitiren hukuki form eki mi?
///
/// `pdf_extract` noktaları kimi bültende düşürüyor: "T.A.Ş." → **"TAŞ"**.
/// Yalnız "AŞ" biçimlerini tanıyan eski sürüm, unvanı "Türk Anonim Şirketi"
/// olan her şirketi göremiyordu — Ereğli, Tüpraş, Hektaş, Türk Traktör,
/// Eczacıbaşı, Bizim… hepsinin sermaye artırımı sessizce düşüyor ve listede
/// Yahoo kaynaklı görünüyordu.
///
/// Karşılaştırma **büyük/küçük harfe duyarlı**: bültende unvanlar başlık
/// düzeninde yazılır, dolayısıyla "Taş" (kelime) ile "TAŞ" (ek) ayrışır —
/// "Akıllı Taş Madencilik AŞ" ekini yanlış yerde bitirmez.
fn is_company_suffix(token: &str) -> bool {
    matches!(
        token,
        "AŞ" | "A.Ş." | "A.Ş"
            | "TAŞ" | "T.A.Ş." | "T.A.Ş"
            | "AO" | "A.O." | "A.O"
            | "TAO" | "T.A.O." | "T.A.O"
    )
}

/// Hücre jetonlarını çözer; sayı, tire ve fiyat aralığı dışındaki her şey
/// `None` — orada tablo satırı bitmiştir.
fn parse_cell(token: &str) -> Option<Cell> {
    if token == "-" {
        return Some(Cell::Empty);
    }
    if let Some(value) = parse_turkish_number(token) {
        return Some(Cell::Number(value));
    }
    parse_price_range(token)
}

/// "8-9", "15,50-17", "11,50-12,50" → fiyat aralığı.
///
/// Talep toplamalı arzlarda SPK sabit fiyat değil **taban-tavan aralığı**
/// onaylıyor; kesin fiyat talep sonrası açıklanıyor. Aralığı sayı sanmayan
/// eski ayrıştırıcı bu satırların tamamını düşürüyordu — 2018-2022 arası
/// arzların çoğu böyle onaylandığı için o yıllardan bültende yalnız 5-6 arz
/// görünüyordu.
fn parse_price_range(token: &str) -> Option<Cell> {
    let (low, high) = token.split_once('-')?;
    let low = parse_turkish_number(low)?;
    let high = parse_turkish_number(high)?;
    // Sıralı olmayan bir "aralık" aralık değildir; büyük olasılıkla başka bir
    // biçim yanlış çözülmüştür.
    (low > 0.0 && high >= low).then_some(Cell::Range(low, high))
}

/// Satır metnini jetonlanmaya hazırlar.
///
/// İki temizlik yapılır:
///
/// * **Dipnot işaretleri atılır.** Hücrelerin arasına serpiştiriliyorlar.
///   Numaralıların yanında yıldız da kullanılıyor: unvanın hemen ardından
///   gelen `(*)`, yalnız numaralı işaretleri silen bir desende çözülemeyen bir
///   belirteç olarak kalıp satırın tamamını düşürüyordu (Bahadır Kimya,
///   2024/37).
/// * **Boşluklu uzun tire kapatılır.** Fiyat aralığı kimi bültende
///   "11,50 – 12,50" diye yazılıyor ve üç ayrı jetona bölünüyordu. Yalnız uzun
///   tire (U+2013) kapatılır; ASCII tire boş hücre imidir ve dokunulmazsa
///   "150.000.000 - 6.500.000" yanlışlıkla aralık sanılırdı.
fn normalize_row_text(text: &str) -> String {
    static RE: std::sync::OnceLock<(regex::Regex, regex::Regex)> = std::sync::OnceLock::new();
    let (footnote, en_dash) = RE.get_or_init(|| {
        (
            regex::Regex::new(r"\((?:\d+|\*+)\)").expect("geçerli regex"),
            regex::Regex::new(r"\s*\u{2013}\s*").expect("geçerli regex"),
        )
    });

    let without_footnotes = footnote.replace_all(text, " ");
    collapse_spaces(&en_dash.replace_all(&without_footnotes, "-"))
}

/// Çözülmüş hücrelerden onay kaydı üretir; sütun düzeni beklenenden farklıysa
/// uyarı bırakıp `None` döner.
fn approval_from_cells(
    company_name: String,
    cells: &[Cell],
    bulletin_no: &str,
    approval_date: &str,
) -> Option<SpkIpoApproval> {
    // Her düşen satır uyarı bırakır: sessiz kayıp, ayrıştırıcı bozulduğunda
    // "bu hafta halka arz yokmuş" gibi görünüyor ve fark edilmiyordu.
    if !(MIN_COLUMNS..=MAX_COLUMNS).contains(&cells.len()) {
        eprintln!(
            "[spk] {bulletin_no}: {company_name} — {MIN_COLUMNS}-{MAX_COLUMNS} sütun bekleniyordu, \
             {} bulundu ({cells:?}); atlandı",
            cells.len()
        );
        return None;
    }

    // Fiyat son sütundur: ya sabit fiyat ya taban-tavan aralığı. Okunamıyorsa
    // satır ayrıştırılamamış demektir ve uydurmak yerine atlanır.
    let (price, price_range) = match cells[cells.len() - 1] {
        Cell::Number(price) if price > 0.0 && price < PRICE_CEILING => (price, None),
        Cell::Range(low, high) if high < PRICE_CEILING => {
            // Aralık ortası ya da ucu **fiyat değildir**; kesin fiyat talep
            // toplama sonrası belli olur ve halkarz.com/KAP'tan gelir. Uydurma
            // bir sayı, arz büyüklüğünü ve getiriyi sessizce bozardı.
            (0.0, Some(format_price_range(low, high)))
        }
        _ => return None,
    };

    let existing_capital = cells[COL_EXISTING_CAPITAL].number()?;
    let new_capital = cells[COL_NEW_CAPITAL].number()?;
    let capital_increase_lots = cells[COL_PAID_INCREASE].number_or_zero();
    let bonus_increase = cells[COL_BONUS_INCREASE].number_or_zero();

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
    let share_sale_lots = sale_columns.first().copied().map(Cell::number_or_zero).unwrap_or(0.0);
    let extra_sale_lots = sale_columns.get(1).copied().map(Cell::number_or_zero).unwrap_or(0.0);

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
        // Fiyat aralıkla onaylandıysa arz büyüklüğü de henüz belli değildir.
        ipo_size_tl: total_lots * price,
        price_range,
        consortium_lead: None,
        bulletin_no: bulletin_no.to_string(),
        approval_date: approval_date.to_string(),
    })
}

/// "8,50 - 9,90 TL" — arayüzün beklediği ham aralık metni.
fn format_price_range(low: f64, high: f64) -> String {
    let render = |value: f64| format!("{value:.2}").replace('.', ",");
    format!("{} - {} TL", render(low), render(high))
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
        .flat_map(|block| parse_capital_block(block, bulletin_no, approval_date))
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
        if !is_page_furniture(line) && !is_table_header(line) {
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

/// Son sütunda geçen satış türleri. Uzun kalıp önce denenir.
///
/// Vokabüler yalnız **yapışık satırları ayırmak** için gerekli: iki şirket tek
/// bloğa düştüğünde ilkinin satış türüyle ikincinin unvanı yan yana geliyor
/// ("… Halka Arz Hürriyet Gazetecilik ve Matbaacılık A.Ş. 552.000.000 …") ve
/// nerede birinin bitip diğerinin başladığını başka türlü söylemek mümkün
/// değil. Yapışma yoksa bu liste hiç kullanılmaz, dolayısıyla listede olmayan
/// bir satış türü normal satırlarda olduğu gibi okunur.
const SALE_TYPES: &[&str] = &[
    "Tahsisli/Nitelikli Yatırımcı",
    "Nitelikli Yatırımcı",
    "Halka Arz",
    "Tahsisli",
    "Birleşme",
    "Bedelsiz",
];

/// Bir bloktaki **her** şirketi sermaye artırımı kaydına çevirir.
///
/// Unvan birden çok satıra sarar, sayısal hücreler unvanın bittiği "AŞ"
/// ekinden sonra başlar:
///
/// ```text
/// Katılımevim  Tasarruf
/// Finansman AŞ  2.070.000.000  7.000.000.000  -  -  4.930.000.000  -
/// ```
///
/// Halka arz tablosunda olduğu gibi burada da iki şirket tek bloğa
/// yapışabiliyor. Eski ayrıştırıcı bunu **sessizce** yanlış okuyordu: ikinci
/// şirketin unvanı ve rakamları birincinin `sale_type` alanına yazılıyor
/// ("Halka Arz Tuğçelik Alüminyum … 180.000.000 …"), ikinci artırım ise hiç
/// kaydedilmiyordu.
fn parse_capital_block(
    block: &[&str],
    bulletin_no: &str,
    approval_date: &str,
) -> Vec<SpkCapitalIncrease> {
    let normalized = normalize_row_text(&block.join(" "));
    let tokens: Vec<&str> = normalized.split_whitespace().collect();

    let mut increases = Vec::new();
    let mut index = 0usize;
    while index < tokens.len() {
        // 1. Unvan: "AŞ" ekine kadar.
        let start = index;
        while index < tokens.len() && !is_company_suffix(tokens[index]) {
            index += 1;
        }
        if index == tokens.len() {
            break;
        }
        let company_name = tokens[start..=index].join(" ");
        index += 1;

        // 2. Beş sayısal sütun.
        let mut cells = [None::<f64>; CAPITAL_COLUMNS];
        let mut filled = 0usize;
        while filled < CAPITAL_COLUMNS && index < tokens.len() {
            match parse_cell(tokens[index]) {
                Some(Cell::Empty) => filled += 1,
                Some(Cell::Number(value)) => {
                    cells[filled] = Some(value);
                    filled += 1;
                }
                // Sayısal sütunlar dolmadan metin geldiyse satır bozuktur.
                _ => break,
            }
            index += 1;
        }
        if filled < CAPITAL_COLUMNS {
            continue;
        }

        // 3. Son sütun metindir; ardından yeni bir şirket başlayabilir.
        let (sale_type, next) = split_sale_type(&tokens, index);
        index = next;

        if let Some(increase) = capital_from_cells(
            company_name,
            &cells,
            sale_type,
            bulletin_no,
            approval_date,
        ) {
            increases.push(increase);
        }
    }

    increases
}

/// Sayısal sütunlardan sonraki metin dizisini satış türü ile (varsa) bir
/// sonraki şirketin unvanına böler; ikinci değer taramanın süreceği konumdur.
fn split_sale_type(tokens: &[&str], from: usize) -> (Option<String>, usize) {
    let mut end = from;
    while end < tokens.len() && parse_cell(tokens[end]).is_none() {
        end += 1;
    }
    let run = &tokens[from..end];

    // Metin dizisinde hukuki form eki varsa bir sonraki şirketin unvanı bu
    // dizinin içinde başlıyor demektir.
    let name_starts_here = run.iter().any(|token| is_company_suffix(token));
    if !name_starts_here {
        return (clean_sale_type(&run.join(" ")), end);
    }

    let text = run.join(" ");
    for sale_type in SALE_TYPES {
        if let Some(rest) = text.strip_prefix(sale_type) {
            if rest.is_empty() || rest.starts_with(' ') {
                // Kalan, sonraki şirketin unvanının başıdır.
                let consumed = sale_type.split_whitespace().count();
                return (clean_sale_type(sale_type), from + consumed);
            }
        }
    }

    // Bilinmeyen satış türü: unvanın nerede başladığı söylenemez. Satış türünü
    // uydurmaktansa boş bırakılır ve dizinin tamamı unvan olarak taranır.
    (None, from)
}

fn clean_sale_type(text: &str) -> Option<String> {
    match collapse_spaces(text) {
        s if s.is_empty() || s == "-" => None,
        s => Some(s),
    }
}

/// Çözülmüş hücrelerden sermaye artırımı kaydı üretir.
fn capital_from_cells(
    company_name: String,
    cells: &[Option<f64>; CAPITAL_COLUMNS],
    sale_type: Option<String>,
    bulletin_no: &str,
    approval_date: &str,
) -> Option<SpkCapitalIncrease> {
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

/// Bülten başlığından numarayı çıkarır: "Bülten No : 2026/47" → "2026/47".
fn bulletin_number(title: &str) -> String {
    title.split(':').next_back().unwrap_or(title).trim().to_string()
}

/// Bülten arşivinin kaç yıl geriye taranacağı.
///
/// Aralık `(bu yıl - N)..=bu yıl`, yani N+1 takvim yılı. Fazladan yıl bilerek
/// var: akış son 10 **yılı** (bugünden 3650 gün geriye) gösteriyor, o pencere
/// takvim yılının ortasına düşüyor. Aralık `bu yıl - N + 1` ile başlarsa
/// pencerenin ilk aylarının resmî karşılığı hiç indirilmez ve o aylar kalıcı
/// olarak Yahoo kaynaklı görünür.
const CAPITAL_BACKFILL_YEARS: i32 = 10;

/// Aynı anda indirilecek bülten PDF'i sayısı. SPK sunucusu yavaş; yüksek
/// eşzamanlılık bağlantı hatası üretiyor.
const CAPITAL_FETCH_CONCURRENCY: usize = 4;

/// Bülten ayrıştırıcısının sürümü.
///
/// Artırıldığında işlenmiş bülten kümesi sıfırlanır ve arşiv baştan kurulur.
/// Bu olmadan bir ayrıştırıcı düzeltmesi yalnız **yeni** bültenlere uygulanır;
/// arşivdeki bozuk kayıt (yanlış okunmuş unvan, kaçırılmış satır) kalıcı olur.
///
/// 2: bülten başına iki bölüm okunmaya başlandı — halka arz onayları da
///    arşivleniyor; tablo başlığı artık unvana yapışmıyor.
/// 3: fiyat aralığıyla onaylanan arzlar (2018-2022'nin çoğu) ve tek bloğa
///    yapışmış ikinci şirketler artık düşmüyor.
/// 4: sermaye artırımı tablosunda da yapışık satırlar ayrılıyor — ikinci
///    şirket birincinin satış türüne yutulmuyordu.
/// 5: noktasız "TAŞ" eki tanınıyor — "Türk Anonim Şirketi" unvanlı şirketlerin
///    (Ereğli, Tüpraş, Hektaş, Türk Traktör…) artırımları hiç okunmuyordu.
pub const BULLETIN_PARSER_VERSION: u32 = 5;

/// Bir bültenden çıkan iki tablo.
struct ParsedBulletin {
    increases: Vec<SpkCapitalIncrease>,
    approvals: Vec<SpkIpoApproval>,
    bulletin_no: String,
}

/// Bülten metninden **her iki** tabloyu çıkarır.
///
/// Tek geçiş olması ölçülebilir bir kazanç: eskiden sermaye artırımı için
/// indirilen ~680 PDF'in halka arz bölümü hiç okunmuyor, halka arz onayları
/// için aynı PDF'lerin son dördü ikinci kez indiriliyordu. Arşivdeki 457 halka
/// arz kaydının yalnız 6'sı SPK bülteninden gelen fiyat/lot verisini
/// taşıyordu; gerisi kazınmış siteye kalmıştı.
fn parse_bulletin_text(text: &str, listing_no: &str, listing_date: &str) -> Option<ParsedBulletin> {
    // Eski arşiv sayfaları tarih vermiyor; PDF başlığı hem numarayı hem
    // tarihi taşıdığı için önceliklidir.
    let (no, date) = bulletin_header(text)
        .unwrap_or_else(|| (listing_no.to_string(), listing_date.to_string()));

    // Tarih arşivde "arz sonrası mı" kıyasının anahtarı; bozuk bir tarih
    // bedelsizi yanlış tarafa düşürüp getiriyi sessizce kaydırır. Liste
    // sayfasından gelen metin bazen "2026-03-2022" gibi çözülüyordu — böyle
    // bir bülten yarım veri yazmaktansa atlanır.
    if !crate::ipo_store::looks_like_iso_date(&date) {
        eprintln!("[spk] {no}: tarih çözülemedi ({date:?}); bülten atlandı");
        return None;
    }

    Some(ParsedBulletin {
        increases: extract_capital_increases_from_text(text, &no, &date),
        approvals: extract_ipo_approvals_from_text(text, &no, &date),
        bulletin_no: no,
    })
}

/// Son on yılın bültenlerini tarayarak sermaye artırımı ve halka arz onayı
/// arşivini kurar. Eklenen `(artırım, halka arz onayı)` sayısını döner.
///
/// İşlenen bültenlerin adresleri arşivde tutulur; ikinci çalıştırmada yalnız
/// yeni bültenler indirilir. Her yıl bitiminde arşiv diske yazılır, böylece
/// yarıda kesilen bir tarama baştan başlamaz.
pub async fn backfill_spk_bulletins(client: &Client) -> (usize, usize) {
    use futures::future::join_all;
    use std::sync::Arc;
    use tokio::sync::Semaphore;

    let mut archive = crate::capital_store::load();

    // Ayrıştırıcı değiştiyse her bülten yeniden okunur. Kayıtlar silinmez:
    // `merge_bulletin` her bülteni işlerken o bültenin eski kayıtlarının
    // yerine yenilerini koyar, böylece tarama sürerken arşiv kullanılabilir
    // kalır ve yarıda kesilse bile veri kaybı olmaz.
    if archive.parser_version != BULLETIN_PARSER_VERSION {
        eprintln!(
            "[spk] ayrıştırıcı sürümü {} → {}; {} bülten yeniden taranacak",
            archive.parser_version,
            BULLETIN_PARSER_VERSION,
            archive.processed_bulletins.len()
        );
        archive.processed_bulletins.clear();
    }

    // Kodu boş kalmış kayıtlar önce yeniden denenir: şirket sonradan
    // listelenmiş ya da eşleştirici düzelmiş olabilir. Ağ erişimi yok.
    let filled = crate::capital_store::refresh_tickers(&mut archive);
    if filled > 0 {
        eprintln!("[spk] {filled} kaydın BIST kodu yeniden çözüldü");
        crate::capital_store::save(&archive);
    }

    let current_year = chrono::Datelike::year(&chrono::Local::now());
    let mut total_increases = 0usize;
    let mut total_approvals = 0usize;
    let mut scanned_all_years = true;

    for year in (current_year - CAPITAL_BACKFILL_YEARS)..=current_year {
        let bulletins = match fetch_year_bulletins(client, year).await {
            Ok(list) => list,
            Err(e) => {
                eprintln!("[spk] {year} bülten listesi alınamadı: {e}");
                scanned_all_years = false;
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
                let parsed = tokio::task::spawn_blocking(move || {
                    let text = match pdf_extract::extract_text_from_mem(&bytes) {
                        Ok(text) => text,
                        Err(e) => {
                            eprintln!("[spk] {listing_no}: PDF metni çıkarılamadı: {e}");
                            return None;
                        }
                    };
                    parse_bulletin_text(&text, &listing_no, &listing_date)
                })
                .await
                .ok()?;

                Some((bulletin.url, parsed))
            }));
        }

        let mut year_increases = 0usize;
        let mut year_approvals = 0usize;
        let mut year_bulletins = 0usize;
        for res in join_all(tasks).await {
            let Ok(Some((url, parsed))) = res else { continue };
            year_bulletins += 1;
            if let Some(parsed) = parsed {
                let (increases, approvals) = crate::capital_store::merge_bulletin(
                    &mut archive,
                    crate::capital_store::BulletinExtract {
                        bulletin_no: parsed.bulletin_no,
                        increases: parsed.increases,
                        approvals: parsed.approvals,
                    },
                );
                year_increases += increases;
                year_approvals += approvals;
            }
            // Metni çözülemeyen bülten de işlenmiş sayılır: her turda yeniden
            // indirmek aynı hatayı tekrarlar, ağ yükünü boşuna büyütür.
            archive.processed_bulletins.insert(url);
        }

        total_increases += year_increases;
        total_approvals += year_approvals;
        eprintln!(
            "[spk] {year}: {year_bulletins} bülten tarandı, {year_increases} sermaye artırımı, \
             {year_approvals} halka arz onayı"
        );

        archive.last_updated = Some(chrono::Local::now().format("%Y-%m-%d").to_string());
        crate::capital_store::save(&archive);
    }

    // Sürüm damgası ancak **tüm** yıllar taranabildiğinde ilerler; yarım
    // tarama tamamlanmış sayılırsa eksik yıllar bir daha hiç okunmaz.
    if scanned_all_years && archive.parser_version != BULLETIN_PARSER_VERSION {
        archive.parser_version = BULLETIN_PARSER_VERSION;
        crate::capital_store::save(&archive);
    }

    (total_increases, total_approvals)
}

/// Bilinen **tüm** halka arz onayları: arşiv geçmişi + son bültenlerin canlı
/// taraması.
///
/// Arşiv haftalık backfill'de dolar ve 2017'ye kadar iner; canlı tarama son
/// haftaların onaylarını backfill'i beklemeden getirir. İkisi
/// `(bülten no, unvan)` üzerinden tekilleştirilir.
pub async fn fetch_all_approvals(
    client: &Client,
) -> Result<Vec<SpkIpoApproval>, Box<dyn Error + Send + Sync>> {
    let archived = crate::capital_store::ipo_approvals(&crate::capital_store::load());

    // Canlı tarama başarısız olsa bile arşiv verisi dönmeli: geçmiş onaylar
    // ağ hatasına bağlı olmamalı.
    let live = match fetch_and_parse_latest_approvals(client).await {
        Ok(rows) => rows,
        Err(e) => {
            eprintln!("[spk] son bültenler taranamadı, arşivle yetiniliyor: {e}");
            Vec::new()
        }
    };

    let mut seen: std::collections::HashSet<(String, String)> = archived
        .iter()
        .map(|a| (a.bulletin_no.clone(), a.company_name.clone()))
        .collect();

    let mut all = archived;
    for approval in live {
        if seen.insert((approval.bulletin_no.clone(), approval.company_name.clone())) {
            all.push(approval);
        }
    }
    Ok(all)
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

    /// Regresyon: iki şirket tek bloğa yapıştığında eski ayrıştırıcı bunu
    /// **sessizce** yanlış okuyordu — ikincinin unvanı ve rakamları birincinin
    /// `sale_type` alanına yazılıyor, ikinci artırım hiç kaydedilmiyordu.
    /// Arşivde satış türü olarak duran metin buydu.
    #[test]
    fn two_companies_glued_into_one_capital_block_are_both_read() {
        let text = "\
  2.  Halka Açık Ortaklıkların Pay İhraçları

Hürriyet  Gazetecilik  ve
Matbaacılık AŞ  552.000.000  592.000.000  40.000.000  -  -  Tahsisli
Tuğçelik  Alüminyum  ve  Metal  Mamülleri  Sanayi  ve  Ticaret  AŞ  180.000.000  360.000.000  180.000.000  -  -  Halka Arz

  3.  Borçlanma Araçları
";
        let rows = extract_capital_increases_from_text(text, "2023/12", "2023-03-16");
        assert_eq!(rows.len(), 2, "{rows:#?}");

        assert_eq!(rows[0].company_name, "Hürriyet Gazetecilik ve Matbaacılık AŞ");
        assert_eq!(rows[0].rights_amount, 40_000_000.0);
        assert_eq!(rows[0].sale_type.as_deref(), Some("Tahsisli"));

        assert_eq!(
            rows[1].company_name,
            "Tuğçelik Alüminyum ve Metal Mamülleri Sanayi ve Ticaret AŞ"
        );
        assert_eq!(rows[1].rights_amount, 180_000_000.0);
        assert_eq!(rows[1].sale_type.as_deref(), Some("Halka Arz"));
    }

    /// Regresyon: `pdf_extract` "T.A.Ş."yi "TAŞ" olarak veriyor. Yalnız "AŞ"
    /// biçimlerini tanıyan ayrıştırıcı, unvanı "Türk Anonim Şirketi" olan her
    /// şirketin artırımını düşürüyordu — Hektaş'ın 5,9 milyarlık bedellisi
    /// (2024/47) böyle kayboldu ve listede Yahoo kaynaklı görünüyordu.
    #[test]
    fn dotless_tas_suffix_is_recognised() {
        let text = "\
  1.  Halka Açık Ortaklıkların Pay İhraçları

Hektaş Ticaret TAŞ  2.530.000.000  8.430.000.000  5.900.000.000  -  -  Halka Arz
Ereğli Demir ve Çelik Fabrikaları T.A.Ş.  3.500.000.000  7.000.000.000  -  3.500.000.000  -  -

  2.  Borçlanma Araçları
";
        let rows = extract_capital_increases_from_text(text, "2024/47", "2024-11-20");
        assert_eq!(rows.len(), 2, "{rows:#?}");
        assert_eq!(rows[0].company_name, "Hektaş Ticaret TAŞ");
        assert_eq!(rows[0].rights_amount, 5_900_000_000.0);
        assert_eq!(rows[1].company_name, "Ereğli Demir ve Çelik Fabrikaları T.A.Ş.");
        assert_eq!(rows[1].bonus_internal, 3_500_000_000.0);
    }

    /// Bilinmeyen bir satış türü yapışmayla birlikte gelirse unvanın nerede
    /// başladığı söylenemez; satış türü uydurulmaz.
    #[test]
    fn an_unknown_sale_type_is_left_empty_rather_than_guessed() {
        let text = "\
  1.  Halka Açık Ortaklıkların Pay İhraçları

Örnek Bir AŞ  100.000.000  200.000.000  100.000.000  -  -  Yepyeni Bir Yöntem
Diğer Örnek AŞ  50.000.000  75.000.000  25.000.000  -  -  Halka Arz

  2.  Borçlanma Araçları
";
        let rows = extract_capital_increases_from_text(text, "2026/1", "2026-01-07");
        assert_eq!(rows.len(), 2, "{rows:#?}");
        assert_eq!(rows[0].company_name, "Örnek Bir AŞ");
        assert_eq!(rows[0].sale_type, None, "bilinmeyen tür uydurulmamalı");
        assert_eq!(rows[1].company_name, "Yepyeni Bir Yöntem Diğer Örnek AŞ");
    }

    /// Regresyon: sütun başlığı gövdeden boş satırla ayrılmadığında ilk
    /// şirketin bloğuna karışıyor ve unvanın başına yapışıyordu. Arşivde
    /// "Ortaklık Mevcut Sermaye … Global Yatırım Holding AŞ" adlı kayıt böyle
    /// oluştu; unvan tanınmaz hâle geldiği için BIST koduna da bağlanamıyordu.
    #[test]
    fn column_headers_do_not_stick_to_the_company_name() {
        let text = "\
  1.  Halka Açık Ortaklıkların Pay İhraçları
Ortaklık  Mevcut
Sermaye  Yeni
Sermaye  Bedelli Sermaye Artırımı  Bedelsiz Sermaye Artırımı  Satış Türü
İç Kaynaklardan  Kâr Payından
Global Yatırım Holding AŞ  100.000.000  200.000.000  -  100.000.000  -  -

  2.  Borçlanma Araçları
";
        let rows = extract_capital_increases_from_text(text, "2025/6", "2025-02-06");
        assert_eq!(rows.len(), 1, "{rows:#?}");
        assert_eq!(rows[0].company_name, "Global Yatırım Holding AŞ");
        assert_eq!(rows[0].bonus_internal, 100_000_000.0);
    }

    /// Aynı ayıklama halka arz tablosunda da gerekli.
    #[test]
    fn ipo_column_headers_are_stripped_too() {
        let text = "\
1.  İlk Halka Arzlar
Ortaklık  Mevcut
Sermaye  Yeni
Sermaye
Sermaye Artırımı  Mevcut
Pay Satışı  Ek Pay
Satışı  Satış
Fiyatı
Bedelli  Bedelsiz
Kapeks  Kimya  Sanayi
AŞ  100.000.000  125.100.000  25.100.000  -  -  -  94,00

2.  Borçlanma Araçları
";
        let rows = extract_ipo_approvals_from_text(text, "2026/49", "2026-08-05");
        assert_eq!(rows.len(), 1, "{rows:#?}");
        assert_eq!(rows[0].company_name, "Kapeks Kimya Sanayi AŞ");
        assert_eq!(rows[0].price, 94.0);
    }

    /// Başlık sözlüğündeki kelimeler şirket unvanlarında da geçiyor; tek
    /// kelime eşleşmesi satırı başlık saymamalı.
    #[test]
    fn company_names_sharing_header_words_survive() {
        assert!(is_table_header("Ortaklık  Mevcut"));
        assert!(is_table_header("İç Kaynaklardan  Kâr Payından"));
        assert!(is_table_header("Bedelli  Bedelsiz"));
        assert!(!is_table_header("İş Girişim Sermayesi Yatırım Ortaklığı AŞ"));
        assert!(!is_table_header("Vişne  Madencilik  Üretim"));
        assert!(!is_table_header("Sermaye  100.000.000"));
        assert!(!is_table_header(""));
    }

    /// 2021 arşivi bültenleri bir tabloda verir ve PDF adları anlamsızdır;
    /// dosya adından yıl okuyan ayrıştırıcı bunları hiç göremiyordu.
    /// Canlı sayfadan alınmış kalıp.
    const OLD_TABLE_PAGE: &str = r#"
        <tr>
            <td>14.10.2021</td>
            <td>2021 / 51</td>
            <td><a href="https://spk.gov.tr/data/61e0/5896753e2d8f2c9449dd6c438ddfa5f4.pdf" target="_blank"><img src="pdf.png" /></a></td>
            <td>21.10.2021</td>
            <td>2021 / 52</td>
            <td><a href="https://spk.gov.tr/data/61e0/0194410c76b0f82919f28976d1eac73a.pdf" target="_blank"><img src="pdf.png" /></a></td>
        </tr>
        <tr>
            <td>27.10.2021</td>
            <td>2021 / 53</td>
            <td><a href="https://spk.gov.tr/data/61e0/8d06cd9d947815143db2e1c0efef1804.pdf" target="_blank"><img src="pdf.png" /></a></td>
        </tr>"#;

    #[test]
    fn old_archive_table_rows_are_parsed() {
        let rows = parse_bulletin_rows(OLD_TABLE_PAGE, 2021);
        assert_eq!(rows.len(), 3, "{rows:#?}");
        assert_eq!(rows[0].title, "Bülten No : 2021/51");
        // Tablo tarihi de taşır; PDF başlığına düşmeye gerek kalmaz.
        assert_eq!(rows[0].date, "2021-10-14");
        assert!(rows[0].url.ends_with("5896753e2d8f2c9449dd6c438ddfa5f4.pdf"));
        assert_eq!(rows[2].title, "Bülten No : 2021/53");
    }

    /// Sayfa başka bir yılın satırını taşırsa o yılın taramasında ikinci kez
    /// sayılmamalı.
    #[test]
    fn old_archive_table_ignores_other_years() {
        assert!(parse_bulletin_rows(OLD_TABLE_PAGE, 2020).is_empty());
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

    /// Regresyon: talep toplamalı arzlarda SPK sabit fiyat değil taban-tavan
    /// aralığı onaylıyor. Aralığı sayı sanmayan ayrıştırıcı satırın tamamını
    /// düşürüyordu — 2018-2022 arası arzların çoğu böyle onaylandığı için o
    /// yıllardan bültende yalnız 5-6 arz görünüyordu.
    #[test]
    fn price_ranges_are_kept_instead_of_dropping_the_row() {
        let text = "1.  İlk Halka Arzlar

Biotrend  Çevre  ve  Enerji  Yatırımları  AŞ  128.000.000  150.000.000  22.000.000  -  14.666.666
(1)  5.000.000
(2)   16,50-18
(3)
";
        let approvals = extract_ipo_approvals_from_text(text, "2021/20", "2021-04-15");
        assert_eq!(approvals.len(), 1, "{approvals:#?}");

        let row = &approvals[0];
        assert_eq!(row.company_name, "Biotrend Çevre ve Enerji Yatırımları AŞ");
        assert_eq!(row.capital_increase_lots, 22_000_000.0);
        assert_eq!(row.share_sale_lots, 14_666_666.0);
        assert_eq!(row.extra_sale_lots, 5_000_000.0);
        // Kesin fiyat talep toplama sonrası belli olur; uydurulmaz.
        assert_eq!(row.price, 0.0);
        assert_eq!(row.ipo_size_tl, 0.0);
        assert_eq!(row.price_range.as_deref(), Some("16,50 - 18,00 TL"));
    }

    /// Aralık kimi bültende boşluklu uzun tireyle yazılıyor ve üç jetona
    /// bölünüyordu.
    #[test]
    fn spaced_en_dash_ranges_are_closed_up() {
        let text = "1.  İlk Halka Arzlar

Hitit Bilgisayar Hizmetleri AŞ  100.000.000  127.500.000  27.500.000  -  7.692.308
(1)  -  11,50 – 12,50
(2)
";
        let approvals = extract_ipo_approvals_from_text(text, "2022/8", "2022-02-17");
        assert_eq!(approvals.len(), 1, "{approvals:#?}");
        assert_eq!(approvals[0].price_range.as_deref(), Some("11,50 - 12,50 TL"));
    }

    /// ASCII tire boş hücre imidir; aralık sanılıp iki sütun birleşmemeli.
    #[test]
    fn empty_cells_are_not_mistaken_for_a_range() {
        let text = "1.  İlk Halka Arzlar

Kapeks  Kimya  Sanayi
AŞ  100.000.000  125.100.000  25.100.000  -  -  -  94,00
";
        let approvals = extract_ipo_approvals_from_text(text, "2026/49", "2026-08-05");
        assert_eq!(approvals.len(), 1, "{approvals:#?}");
        assert_eq!(approvals[0].price, 94.0);
        assert_eq!(approvals[0].price_range, None);
        assert_eq!(approvals[0].total_lots, 25_100_000.0);
    }

    /// Regresyon: `pdf_extract` iki şirketin arasına her zaman boş satır
    /// koymuyor; ikinci unvan birincinin fiyat hücresinin hemen ardından
    /// başlıyor. Tek şirket varsayan ayrıştırıcı böyle bloklarda iki arzı
    /// birden düşürüyordu (2021/49, 2022/7, 2022/28).
    #[test]
    fn two_companies_glued_into_one_block_are_both_read() {
        let text = "1.  İlk Halka Arzlar

Gelecek  Varlık  Yönetimi  AŞ  126.500.000  139.700.000  13.200.000  -  8.800.000
(3)  4.400.000
(4)  13,65
(5) Anatolia  Tanı  ve Biyoteknoloji  Ürünleri AŞ  100.000.000  110.000.000  10.000.000  -  10.000.000
(6)  3.000.000
(7)  21,00-22,50
(8)
";
        let approvals = extract_ipo_approvals_from_text(text, "2021/49", "2021-10-07");
        assert_eq!(approvals.len(), 2, "{approvals:#?}");

        assert_eq!(approvals[0].company_name, "Gelecek Varlık Yönetimi AŞ");
        assert_eq!(approvals[0].price, 13.65);
        assert_eq!(approvals[0].total_lots, 22_000_000.0);

        assert_eq!(
            approvals[1].company_name,
            "Anatolia Tanı ve Biyoteknoloji Ürünleri AŞ"
        );
        assert_eq!(approvals[1].price_range.as_deref(), Some("21,00 - 22,50 TL"));
        assert_eq!(approvals[1].total_lots, 20_000_000.0);
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
        let (increases, approvals) = super::backfill_spk_bulletins(&client).await;
        let archive = crate::capital_store::load();
        println!(
            "\n{increases} sermaye artırımı + {approvals} halka arz onayı işlendi; \
             arşivde {} artırım, {} onay, {} bülten ({:?})",
            archive.records.len(),
            archive.ipo_approvals.len(),
            archive.processed_bulletins.len(),
            t0.elapsed()
        );
    }
}
