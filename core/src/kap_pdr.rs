//! Fonun içindeki tek tek varlıklar — KAP Portföy Dağılım Raporu'ndan (PDR).
//!
//! TEFAS yalnızca varlık sınıfı yüzdesi verir; menkul kıymet kırılımı fonların
//! KAP'a her ay verdiği PDR bildiriminin PDF ekindedir ("III-FON PORTFÖY
//! DEĞERİ TABLOSU"). Zincir:
//!
//! 1. `disclosure/funds/byCriteria` + `period` filtresi → dönemin tüm PDR'leri
//!    tek istekte (`period` filtresi 2000 kayıt sınırını aşmanın tek yolu).
//! 2. `notification/attachment-detail/{index}` → ekin `objId`'si.
//! 3. `file/download/{objId}` → PDF, Java-serialization sargısı içinde gelir;
//!    gerçek içerik `%PDF` ofsetinden başlar.
//!
//! Raporlar aylıktır ve dönemi izleyen ayın ilk ~8 gününde yayınlanır; veri
//! ~1 ay gecikmelidir ve her fon PDR vermez (Haziran 2026: 3228 fonun 1264'ü).

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

const BASE_URL: &str = "https://www.kap.org.tr/tr";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Dönem → PDR haritası günde bir tazelense yeter: kaynak aylık yayınlanır.
const INDEX_CACHE_TTL: Duration = Duration::from_secs(6 * 60 * 60);
/// Ayrıştırılmış rapor fon başına saklanır; aynı ay içinde değişmez.
const HOLDINGS_CACHE_TTL: Duration = Duration::from_secs(24 * 60 * 60);

/// Fon portföyündeki tek varlık.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FundHolding {
    /// BIST/fon kodu (rapordaki ilk belirteç; ör. "ASELS").
    pub code: String,
    /// Menkul kıymetin rapordaki adı.
    pub name: String,
    /// Fon toplam değerine göre yüzde.
    pub pct: f64,
    /// Rapordaki varlık grubu başlığı (ör. "HİSSE SENETLERİ"); bulunamazsa boş.
    pub group: String,
}

/// Fonun PDR'den çıkarılmış portföyü.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FundHoldingsReport {
    /// Rapor dönemi, "2026-06" biçiminde.
    pub period: String,
    /// KAP bildirim sayfası (kaynağa gitmek için).
    pub url: String,
    pub holdings: Vec<FundHolding>,
}

#[derive(Deserialize)]
struct PdrRow {
    #[serde(rename = "fundCode")]
    fund_code: Option<String>,
    subject: Option<String>,
    #[serde(rename = "disclosureIndex")]
    disclosure_index: u64,
}

#[derive(Deserialize)]
struct AttachmentDetail {
    attachments: Vec<Attachment>,
}

#[derive(Deserialize)]
struct Attachment {
    #[serde(rename = "objId")]
    obj_id: String,
}

async fn post_criteria(
    client: &reqwest::Client,
    from: chrono::NaiveDate,
    to: chrono::NaiveDate,
    period_month: u32,
) -> Result<Vec<PdrRow>, String> {
    let body = serde_json::json!({
        "fromDate": from.format("%Y-%m-%d").to_string(),
        "toDate": to.format("%Y-%m-%d").to_string(),
        "period": period_month.to_string(),
    });
    client
        .post(format!("{BASE_URL}/api/disclosure/funds/byCriteria"))
        .timeout(REQUEST_TIMEOUT)
        .header("User-Agent", crate::yahoo::YAHOO_USER_AGENT)
        .header("Accept", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("KAP PDR sorgusu: {error}"))?
        .json::<Vec<PdrRow>>()
        .await
        .map_err(|error| format!("KAP PDR yanıtı çözümlenemedi: {error}"))
}

/// (dönem, fon kodu → bildirim indeksi) haritası.
type PdrIndex = (String, HashMap<String, u64>);

static INDEX_CACHE: OnceLock<Mutex<Option<(Instant, Arc<PdrIndex>)>>> = OnceLock::new();

/// Son yayınlanmış PDR dönemini bulur.
///
/// Raporlar dönemi izleyen ayda yayınlanır: önce geçen ayın dönemi denenir;
/// ay başındaysak ve henüz yayın yoksa bir önceki döneme düşülür.
async fn pdr_index(client: &reqwest::Client) -> Result<Arc<PdrIndex>, String> {
    let cache = INDEX_CACHE.get_or_init(|| Mutex::new(None));
    if let Some((at, map)) = cache.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        if at.elapsed() < INDEX_CACHE_TTL {
            return Ok(map.clone());
        }
    }

    let today = crate::kap::istanbul_today();
    // (dönem ayı ait olduğu yıl-ay, yayın penceresi başlangıcı)
    let candidates = [months_back(today, 1), months_back(today, 2)];
    let mut chosen: Option<PdrIndex> = None;
    for (year, month) in candidates {
        let window_start =
            chrono::NaiveDate::from_ymd_opt(next_month(year, month).0, next_month(year, month).1, 1)
                .expect("geçerli ay başı");
        let rows = post_criteria(client, window_start, today, month).await?;
        let map: HashMap<String, u64> = rows
            .into_iter()
            .filter(|row| row.subject.as_deref() == Some("Portföy Dağılım Raporu"))
            .filter_map(|row| row.fund_code.map(|code| (code, row.disclosure_index)))
            .collect();
        if !map.is_empty() {
            chosen = Some((format!("{year}-{month:02}"), map));
            break;
        }
    }

    let index = Arc::new(chosen.ok_or("KAP'ta yayınlanmış portföy dağılım raporu bulunamadı.")?);
    *cache.lock().unwrap_or_else(|e| e.into_inner()) = Some((Instant::now(), index.clone()));
    Ok(index)
}

fn months_back(date: chrono::NaiveDate, count: u32) -> (i32, u32) {
    use chrono::Datelike;
    let total = date.year() * 12 + date.month0() as i32 - count as i32;
    (total.div_euclid(12), total.rem_euclid(12) as u32 + 1)
}

fn next_month(year: i32, month: u32) -> (i32, u32) {
    if month == 12 { (year + 1, 1) } else { (year, month + 1) }
}

/// KAP'ın dosya ucu içeriği Java-serialization sargısında döndürür
/// (`aced 0005 ...`); gerçek dosya `%PDF` imzasından başlar.
fn strip_java_wrapper(raw: &[u8]) -> Option<&[u8]> {
    let start = raw.windows(4).position(|window| window == b"%PDF")?;
    Some(&raw[start..])
}

async fn download_pdr_pdf(client: &reqwest::Client, disclosure_index: u64) -> Result<Vec<u8>, String> {
    let detail = client
        .get(format!("{BASE_URL}/api/notification/attachment-detail/{disclosure_index}"))
        .timeout(REQUEST_TIMEOUT)
        .header("User-Agent", crate::yahoo::YAHOO_USER_AGENT)
        .send()
        .await
        .map_err(|error| format!("KAP bildirim detayı: {error}"))?
        .json::<Vec<AttachmentDetail>>()
        .await
        .map_err(|error| format!("KAP bildirim detayı çözümlenemedi: {error}"))?;

    let obj_id = detail
        .first()
        .and_then(|d| d.attachments.first())
        .map(|a| a.obj_id.clone())
        .ok_or("PDR bildiriminde ek bulunamadı.")?;

    let raw = client
        .get(format!("{BASE_URL}/api/file/download/{obj_id}"))
        .timeout(REQUEST_TIMEOUT)
        .header("User-Agent", crate::yahoo::YAHOO_USER_AGENT)
        .send()
        .await
        .map_err(|error| format!("KAP dosya indirme: {error}"))?
        .bytes()
        .await
        .map_err(|error| format!("KAP dosya okunamadı: {error}"))?;

    strip_java_wrapper(&raw)
        .map(<[u8]>::to_vec)
        .ok_or_else(|| "İndirilen dosyada PDF imzası yok.".to_string())
}

/// "III-FON PORTFÖY DEĞERİ TABLOSU" bölümündeki varlık grupları. Görsel şablon
/// SPK'nındır ama PDF'i her kurucunun kendi sistemi bastığından başlığın önüne
/// "E)" gibi ekler gelebilir; eşleşme satır sonuna göredir.
const GROUP_HEADERS: [&str; 15] = [
    "HİSSE SENETLERİ",
    "BORÇLANMA SENETLERİ",
    "DEVLET TAHVİLLERİ",
    "HAZİNE BONOLARI",
    "ÖZEL SEKTÖR TAHVİLLERİ",
    "FİNANSMAN BONOLARI",
    "KİRA SERTİFİKALARI",
    "YATIRIM FONLARI",
    "BORSA YATIRIM FONLARI",
    "TERS REPO",
    "VADELİ MEVDUAT",
    "MEVDUAT",
    "KATILIM HESABI",
    "VARANTLAR",
    "DİĞER",
];

fn group_header(line: &str) -> Option<&'static str> {
    // Değer satırları sayı/ISIN ile bittiğinden sondan eşleşme güvenlidir;
    // uzunluk sınırı "...FONU HİSSE SENETLERİ" gibi ad satırlarını eler.
    (line.len() < 40)
        .then(|| GROUP_HEADERS.iter().find(|g| line.ends_with(**g)).copied())
        .flatten()
}

/// Sayfa arası tekrarlanan kolon başlıklarının ASCII büyük harfli ilk
/// kelimeleri; kayıt başı sanılmamaları için elenir. (Türkçe karakterli
/// başlıklar ör. "GÜNLÜK", "İHRAÇCI" kod desenine zaten uymaz.)
const HEADER_WORDS: [&str; 16] = [
    "TOPLAM", "GRUP", "MENKUL", "KIYMET", "BORSA", "ISIN", "KODU", "REPO",
    "KALAN", "SATIN", "ORAN", "ORANI", "TUTARI", "VADE", "VADEYE", "NET",
];

/// "1.326.655,465" → 1326655.465
fn parse_tr_number(raw: &str) -> Option<f64> {
    raw.replace('.', "").replace(',', ".").parse().ok()
}

/// Satır "KOD Ad ..." biçiminde bir kayıt başı mı? Kod ASCII büyük harf/rakam
/// olup kolon başlığı kelimesi olamaz; tahvil satırlarında kod 12 karakterlik
/// ISIN'in kendisidir.
fn record_start(line: &str) -> bool {
    let mut tokens = line.split_whitespace();
    let (Some(code), Some(next)) = (tokens.next(), tokens.next()) else { return false };
    if line.starts_with(char::is_whitespace) {
        return false;
    }
    (2..=12).contains(&code.len())
        && code.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
        && !HEADER_WORDS.contains(&code)
        // Bazı raporlar kod ile adı "-" ile ayırır: "DBA - DENİZ ...".
        && (next == "-" || next.chars().next().is_some_and(char::is_alphanumeric))
}

/// Kayıt satırlarından kod ve okunur adı çıkarır.
///
/// Ad, kayıt başından ilk sayı belirtecine ya da satır başı boşluklu ilk
/// satıra (ihraççı bloku / değer satırı) kadar sürer: fon adları ihraççı
/// tekrarına, hisse satırları değerlere bulaşmaz.
fn extract_name(record: &[&str]) -> Option<(String, String)> {
    let start = record.iter().position(|line| record_start(line))?;
    let mut code: Option<String> = None;
    let mut name: Vec<String> = Vec::new();

    'lines: for (offset, line) in record[start..].iter().enumerate() {
        if offset > 0 && line.starts_with(char::is_whitespace) {
            break;
        }
        for token in line.split_whitespace() {
            if code.is_none() {
                code = Some(token.to_string());
                continue;
            }
            // İlk sayı belirteci değer kolonlarının başladığı yerdir; tek
            // satırlık kayıtlarda da geçerli.
            if token.chars().next().is_some_and(|c| c.is_ascii_digit()) {
                break 'lines;
            }
            // Kod-ad ayıracı ada taşınmaz.
            if token == "-" && name.is_empty() {
                continue;
            }
            name.push(token.to_string());
        }
    }
    Some((code?, name.join(" ")))
}

/// Parça (boş satırla ayrılmış blok) gerçek bir değer satırı taşıyor mu?
/// Kayıt imzası: kayıt başı satırı + ondalıklı sayı + gg/aa/yy alış tarihi.
/// Bu bekçi, sütunları ayrı bloklara saçılmış (kolon-major) PDF'lerde yanlış
/// ad-yüzde eşleşmesi üretmek yerine hiç sonuç üretmemeyi garanti eder.
fn chunk_is_row(chunk: &[&str], date_re: &regex::Regex) -> bool {
    chunk.iter().any(|l| record_start(l))
        && chunk.iter().any(|l| l.split_whitespace().any(|t| t.contains(',')))
        && chunk.iter().any(|l| date_re.is_match(l))
}

/// Parçadaki son ondalıklı sayı — değer satırının son kolonu (FTD %).
fn last_decimal(chunk: &[&str]) -> Option<f64> {
    chunk
        .iter()
        .rev()
        .flat_map(|l| l.split_whitespace().rev())
        .find(|t| t.contains(',') && t.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .and_then(parse_tr_number)
}

/// PDF metninden varlık satırlarını çıkarır.
///
/// Çapa ISIN'dir: portföy tablosu dışındaki hiçbir satır ISIN taşımaz
/// (alış/satış tabloları dahil), bu yüzden bölüm sınırı aramaya gerek yoktur.
/// PDF'i her kurucunun kendi sistemi bastığından üç yerleşim desteklenir:
///
/// - A: yüzde ISIN'e bitişik satır sonundadır ("… 2,10TRAAEFES91A9").
/// - B: ISIN kendi satırındadır; değerler bir önceki blokta biter ("… 13,63").
/// - C: tek satır, ABD sayı biçimi, tarihle başlar, ISIN çift basılıdır
///   ("25.11.2026 ADELKALEM 20,000,000.00 … 1.25TRFADELK2615TRFADELK2615").
/// - D: ISIN satır ortasında, son sayı FTD yüzdesi ("AEFES TL … TRAAEFES91A9
///   … 2,38 2,26 2,29") — kolon-major PDF'in yeniden kurulmuş hali. Ad kolonu
///   dikey kaymayla komşu satıra karışabildiğinden ad bilerek boş bırakılır.
/// - E: ISIN ile başlar, yüzde işaretiyle biter ("TRT010328T12 Hazine ve
///   Maliye Bakanlığı 35,000,000.03… 1.47%").
///
/// Taranmış (görüntü) PDF'ler bilinçli olarak boş döner.
fn parse_holdings(text: &str) -> Vec<FundHolding> {
    let glued = regex::Regex::new(r"(\d{1,3}(?:\.\d{3})*,\d+)(TR[A-Z0-9]{10})\s*$").unwrap();
    let standalone_isin = regex::Regex::new(r"^(TR[A-Z0-9]{10})$").unwrap();
    let us_row = regex::Regex::new(
        r"^\d{2}\.\d{2}\.\d{4}\s+(.+?)\s+[\d,]+\.\d+\s+[\d,]+\.\d+\s+(\d+\.\d+)(TR[A-Z0-9]{10})(?:TR[A-Z0-9]{10})?$",
    )
    .unwrap();
    let mid_isin = regex::Regex::new(
        r"^([A-Z0-9]{2,12})\s.*\s(TR[A-Z0-9]{10})\s.*\s(\d{1,3}(?:\.\d{3})*,\d+)$",
    )
    .unwrap();
    let isin_lead =
        regex::Regex::new(r"^(TR[A-Z0-9]{10})\s+(\D+?)\s*\d.*?(\d+\.\d+)%$").unwrap();
    let purchase_date = regex::Regex::new(r"\b\d{2}/\d{2}/\d{2}\b").unwrap();

    let mut holdings = Vec::new();
    let mut buffer: Vec<&str> = Vec::new();
    let mut previous: Vec<&str> = Vec::new();
    let mut group = "";

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if !buffer.is_empty() {
                previous = std::mem::take(&mut buffer);
            }
            continue;
        }
        if let Some(header) = group_header(trimmed) {
            group = header;
            buffer.clear();
            previous.clear();
            continue;
        }

        // Biçim C
        if let Some(caps) = us_row.captures(trimmed) {
            if let Some(pct) = caps[2].replace(',', "").parse::<f64>().ok() {
                holdings.push(FundHolding {
                    code: caps[3].to_string(),
                    name: caps[1].trim().to_string(),
                    pct,
                    group: group.to_string(),
                });
            }
            buffer.clear();
            continue;
        }

        // Biçim B
        if standalone_isin.is_match(trimmed) {
            let chunk: &[&str] = if buffer.iter().any(|l| l.contains(',')) { &buffer } else { &previous };
            if chunk_is_row(chunk, &purchase_date) {
                if let (Some(pct), Some((code, name))) = (last_decimal(chunk), extract_name(chunk)) {
                    holdings.push(FundHolding { code, name, pct, group: group.to_string() });
                }
            }
            buffer.clear();
            previous.clear();
            continue;
        }

        // Biçim A
        if let Some(caps) = glued.captures(line.trim_end()) {
            buffer.push(line);
            if let (Some(pct), Some((code, name))) = (parse_tr_number(&caps[1]), extract_name(&buffer)) {
                holdings.push(FundHolding { code, name, pct, group: group.to_string() });
            }
            buffer.clear();
            previous.clear();
            continue;
        }

        // Biçim E
        if let Some(caps) = isin_lead.captures(trimmed) {
            if let Ok(pct) = caps[3].replace(',', "").parse::<f64>() {
                holdings.push(FundHolding {
                    code: caps[1].to_string(),
                    name: caps[2].trim().to_string(),
                    pct,
                    group: group.to_string(),
                });
            }
            buffer.clear();
            continue;
        }

        // Biçim D
        if let Some(caps) = mid_isin.captures(trimmed) {
            if let Some(pct) = parse_tr_number(&caps[3]) {
                holdings.push(FundHolding {
                    code: caps[1].to_string(),
                    name: String::new(),
                    pct,
                    group: group.to_string(),
                });
            }
            buffer.clear();
            continue;
        }

        buffer.push(line);
    }
    holdings
}

/// Konumlandırılmış tek karakter (koordinatlar sayfa sol-üst köşesine göre).
struct PlacedChar {
    page: u32,
    x: f64,
    y: f64,
    /// Karakterin yatay ilerlemesi — boşluk çıkarımında kullanılır.
    advance: f64,
    /// Cihaz uzayındaki punto — kümeleme toleranslarının ölçeği.
    size: f64,
    text: String,
}

/// Karakterleri konumlarıyla toplayan `OutputDev`.
///
/// Kolon-major basılmış PDF'lerde içerik akışı görsel düzeni izlemez; düz
/// metin çıkarımı kolonları ayrı bloklara saçar. Burada karakterler (sayfa,
/// y, x) ile toplanır ve satırlar görsel konuma göre yeniden kurulur.
#[derive(Default)]
struct PositionalText {
    page: u32,
    /// Sayfa yüksekliği: PDF'te y yukarı büyür, satır sıralaması için çevrilir.
    flip: f64,
    chars: Vec<PlacedChar>,
}

impl pdf_extract::OutputDev for PositionalText {
    fn begin_page(
        &mut self,
        page_num: u32,
        media_box: &pdf_extract::MediaBox,
        _: Option<(f64, f64, f64, f64)>,
    ) -> Result<(), pdf_extract::OutputError> {
        self.page = page_num;
        self.flip = media_box.ury - media_box.lly;
        Ok(())
    }
    fn end_page(&mut self) -> Result<(), pdf_extract::OutputError> {
        Ok(())
    }
    fn output_character(
        &mut self,
        trm: &pdf_extract::Transform,
        width: f64,
        spacing: f64,
        font_size: f64,
        char: &str,
    ) -> Result<(), pdf_extract::OutputError> {
        // Dönme yok sayılır: raporlar dik metinli tablolardır.
        let scale = trm.m11.hypot(trm.m12).max(f64::EPSILON);
        self.chars.push(PlacedChar {
            page: self.page,
            x: trm.m31,
            y: self.flip - trm.m32,
            advance: (width * font_size + spacing) * scale,
            size: font_size * scale,
            text: char.to_string(),
        });
        Ok(())
    }
    fn begin_word(&mut self) -> Result<(), pdf_extract::OutputError> {
        Ok(())
    }
    fn end_word(&mut self) -> Result<(), pdf_extract::OutputError> {
        Ok(())
    }
    fn end_line(&mut self) -> Result<(), pdf_extract::OutputError> {
        Ok(())
    }
}

/// PDF metnini görsel yerleşime göre yeniden kurar (pdftotext -layout benzeri).
///
/// Düz akış çıkarımı boş dönen kolon-major PDF'ler için ikinci şanstır:
/// karakterler y'ye göre satırlara kümelenir, satır içinde x'e göre dizilir,
/// bariz dikey boşluklara boş satır konur (ayrıştırıcının parça sınırı).
fn layout_text(pdf: &[u8]) -> Result<String, String> {
    let document = pdf_extract::Document::load_mem(pdf)
        .map_err(|error| format!("PDF açılamadı: {error}"))?;
    let mut collector = PositionalText::default();
    pdf_extract::output_doc(&document, &mut collector)
        .map_err(|error| format!("PDF konumsal okunamadı: {error}"))?;

    let mut chars = collector.chars;
    chars.sort_by(|a, b| {
        (a.page, a.y, a.x)
            .partial_cmp(&(b.page, b.y, b.x))
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // Satır kümeleme: y farkı toleransın altındaki karakterler aynı satırdadır.
    let mut rows: Vec<(u32, f64, Vec<PlacedChar>)> = Vec::new();
    for c in chars {
        match rows.last_mut() {
            Some((page, y, row)) if *page == c.page && (c.y - *y).abs() <= (c.size * 0.4).max(1.5) => {
                row.push(c);
            }
            _ => rows.push((c.page, c.y, vec![c])),
        }
    }

    // Satır aralığı medyanı: bunun belirgin üstündeki boşluklar parça sınırıdır.
    let mut pitches: Vec<f64> = rows
        .windows(2)
        .filter(|w| w[0].0 == w[1].0)
        .map(|w| w[1].1 - w[0].1)
        .filter(|d| *d > 0.1)
        .collect();
    pitches.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let pitch = pitches.get(pitches.len() / 2).copied().unwrap_or(12.0);

    let mut text = String::new();
    let mut previous: Option<(u32, f64)> = None;
    for (page, y, mut row) in rows {
        match previous {
            Some((last_page, _)) if last_page != page => text.push_str("\n\n"),
            Some((_, last_y)) if y - last_y > pitch * 1.75 => text.push_str("\n\n"),
            Some(_) => text.push('\n'),
            None => {}
        }
        previous = Some((page, y));

        row.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));
        let mut cursor: Option<f64> = None;
        for c in &row {
            if let Some(end) = cursor {
                if c.x - end > (c.size * 0.25).max(1.0) {
                    text.push(' ');
                }
            }
            text.push_str(&c.text);
            cursor = Some(c.x + c.advance.max(0.0));
        }
    }
    Ok(text)
}

static HOLDINGS_CACHE: OnceLock<Mutex<HashMap<String, (Instant, Arc<FundHoldingsReport>)>>> =
    OnceLock::new();

// ─── Kalıcı rapor dizini (hisse → fonlar ters araması için) ────────────────────
//
// Ayrıştırılan her PDR raporu ~/.fraude_fund_holdings.json'a yazılır. Böylece
// "bu hisseyi hangi fonlar tutuyor" sorusu ağa çıkmadan, birikmiş dizin
// üzerinde yanıtlanır; kapsam arka plan taramasıyla ve kullanıcı fon
// detaylarına baktıkça büyür. Rapor aylık olduğundan dönemi güncel olan
// kayıt tekrar indirilmez.

#[derive(Clone, Serialize, Deserialize)]
struct StoredReport {
    fetched_at_unix: u64,
    report: FundHoldingsReport,
}

static HOLDINGS_STORE: OnceLock<Mutex<HashMap<String, StoredReport>>> = OnceLock::new();

fn holdings_store_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|home| home.join(".fraude_fund_holdings.json"))
}

fn holdings_store() -> &'static Mutex<HashMap<String, StoredReport>> {
    HOLDINGS_STORE.get_or_init(|| {
        let map = holdings_store_path()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        Mutex::new(map)
    })
}

fn store_report(code: &str, report: &FundHoldingsReport) {
    let mut guard = holdings_store().lock().unwrap_or_else(|e| e.into_inner());
    guard.insert(
        code.to_string(),
        StoredReport {
            fetched_at_unix: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or_default(),
            report: report.clone(),
        },
    );
    if let (Some(path), Ok(json)) = (holdings_store_path(), serde_json::to_string(&*guard)) {
        let _ = std::fs::write(path, json);
    }
}

/// Dizindeki rapor sayısı ve verilen dönemle eşleşen fon kodları.
fn stored_period_codes(period: &str) -> std::collections::HashSet<String> {
    holdings_store()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .filter(|(_, stored)| stored.report.period == period)
        .map(|(code, _)| code.clone())
        .collect()
}

/// Bir hisseyi portföyünde taşıyan fon kaydı (ters arama sonucu).
#[derive(Clone, Debug, Serialize)]
pub struct TickerFundEntry {
    pub fund_code: String,
    /// Fon toplam değerine göre yüzde.
    pub weight_pct: f64,
    /// Rapor dönemi ("2026-06").
    pub period: String,
    /// KAP bildirim sayfası.
    pub url: String,
}

/// Birikmiş rapor dizininde verilen hisseyi tutan fonlar (ağ erişimi yapmaz).
/// İkinci değer dizindeki toplam rapor sayısıdır (kapsam göstergesi için).
pub fn funds_holding_ticker(ticker: &str) -> (Vec<TickerFundEntry>, usize) {
    let needle = ticker.trim().to_uppercase();
    let guard = holdings_store().lock().unwrap_or_else(|e| e.into_inner());
    let scanned = guard.len();
    let mut entries: Vec<TickerFundEntry> = guard
        .iter()
        .filter_map(|(fund_code, stored)| {
            let hit = stored
                .report
                .holdings
                .iter()
                .filter(|h| h.code == needle && h.pct > 0.0)
                .map(|h| h.pct)
                .fold(0.0_f64, f64::max);
            (hit > 0.0).then(|| TickerFundEntry {
                fund_code: fund_code.clone(),
                weight_pct: hit,
                period: stored.report.period.clone(),
                url: stored.report.url.clone(),
            })
        })
        .collect();
    entries.sort_by(|a, b| b.weight_pct.total_cmp(&a.weight_pct));
    (entries, scanned)
}

/// Aynı anda tek tarama çalışır; açılış görevi ile "dizin boş" tetiklemesi
/// çakışıp KAP'a çift trafik üretmesin.
static CRAWLING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Verilen fon kodlarının PDR'lerini dizine ekler (arka plan taraması).
///
/// Dönemi güncel olan kayıtlar atlanır; istekler arasında beklenir ki KAP'a
/// nazik kalınsın. `cap` bir oturumda indirilecek yeni rapor sayısını sınırlar.
/// Dizine eklenen yeni rapor sayısını döndürür.
pub async fn crawl_fund_holdings(client: &reqwest::Client, codes: &[String], cap: usize) -> usize {
    if CRAWLING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return 0;
    }
    let added = crawl_inner(client, codes, cap).await;
    CRAWLING.store(false, std::sync::atomic::Ordering::SeqCst);
    added
}

async fn crawl_inner(client: &reqwest::Client, codes: &[String], cap: usize) -> usize {
    let Ok(index) = pdr_index(client).await else { return 0 };
    let (period, available) = index.as_ref();
    let done = stored_period_codes(period);

    let mut added = 0;
    for code in codes {
        if added >= cap {
            break;
        }
        let code = code.trim().to_uppercase();
        // Dizinde güncel dönem kaydı olan ya da bu dönem PDR vermemiş fon atlanır
        if done.contains(&code) || !available.contains_key(&code) {
            continue;
        }
        if get_fund_holdings(client, &code).await.is_ok() {
            added += 1;
        }
        tokio::time::sleep(Duration::from_millis(2500)).await;
    }
    added
}

/// Fonun son PDR'inden varlık kırılımı. PDR vermeyen fonlarda hata döner.
pub async fn get_fund_holdings(
    client: &reqwest::Client,
    fund_code: &str,
) -> Result<Arc<FundHoldingsReport>, String> {
    let code = fund_code.trim().to_uppercase();

    let cache = HOLDINGS_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some((at, report)) = cache.lock().unwrap_or_else(|e| e.into_inner()).get(&code) {
        if at.elapsed() < HOLDINGS_CACHE_TTL {
            return Ok(report.clone());
        }
    }

    let index = pdr_index(client).await?;
    let (period, map) = index.as_ref();
    let disclosure_index = *map
        .get(&code)
        .ok_or_else(|| format!("{code} için {period} döneminde KAP portföy dağılım raporu yok."))?;

    let pdf = download_pdr_pdf(client, disclosure_index).await?;
    let text = pdf_extract::extract_text_from_mem(&pdf)
        .map_err(|error| format!("PDR PDF metni çıkarılamadı ({code}): {error}"))?;

    let mut holdings = parse_holdings(&text);
    if holdings.is_empty() {
        // Düz akış boş kaldıysa PDF kolon-major basılmış olabilir; görsel
        // yerleşime göre yeniden kurulup bir kez daha denenir.
        if let Ok(rebuilt) = layout_text(&pdf) {
            holdings = parse_holdings(&rebuilt);
        }
    }

    let report = Arc::new(FundHoldingsReport {
        period: period.clone(),
        url: format!("{BASE_URL}/Bildirim/{disclosure_index}"),
        holdings,
    });
    cache
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(code.clone(), (Instant::now(), report.clone()));
    // Ters arama dizini (hisse → fonlar) her başarılı ayrıştırmayla büyür
    store_report(&code, &report);
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// BIST 30 endeks fonu: gerçek hisseler, sayfa arası başlık tekrarıyla.
    #[test]
    fn parses_equity_fund_holdings_across_page_breaks() {
        let text = include_str!("../fixtures/pdr_mmh_2026_05.txt");
        let holdings = parse_holdings(text);
        println!("MMH: {} varlık", holdings.len());
        assert!(holdings.len() >= 25, "BIST 30 fonu en az ~30 pozisyon taşır, {} bulundu", holdings.len());

        let aefes = holdings.iter().find(|h| h.code == "AEFES").expect("AEFES bulunmalı");
        assert!(aefes.name.contains("ANADOLU") && aefes.name.contains("EFES"));
        assert!((aefes.pct - 2.10).abs() < 0.001);
        assert_eq!(aefes.group, "HİSSE SENETLERİ");

        // Sayfa kırılımından SONRA gelen satır: başlık çöpü ada karışmamalı.
        let eregl = holdings.iter().find(|h| h.code == "EREGL").expect("EREGL bulunmalı");
        assert!(eregl.name.starts_with("EREGLI"), "ad başlık çöpüyle başladı: {}", eregl.name);

        // Tek satırlık kayıt biçimi.
        let bimas = holdings.iter().find(|h| h.code == "BIMAS").expect("BIMAS bulunmalı");
        assert_eq!(bimas.name, "BIMAS");

        // Değerler değer satırıyla aynı satırda başlayan kayıt (AKBNK T.A.S.).
        let akbnk = holdings.iter().find(|h| h.code == "AKBNK").expect("AKBNK bulunmalı");
        assert_eq!(akbnk.name, "AKBANK T.A.S.");

        // FTD yüzdeleri makul toplanmalı (nakit/borç dışı kalanlar).
        let total: f64 = holdings.iter().map(|h| h.pct).sum();
        assert!((50.0..=101.0).contains(&total), "yüzde toplamı anlamsız: {total}");
    }

    /// Fon sepeti: ad ihraççı blokunda değil fon unvanında kalmalı.
    #[test]
    fn parses_fund_basket_holdings_without_issuer_bleed() {
        let text = include_str!("../fixtures/pdr_glc_2026_06.txt");
        let holdings = parse_holdings(text);
        println!("GLC: {} varlık", holdings.len());
        assert_eq!(holdings.len(), 10);

        let kub = holdings.iter().find(|h| h.code == "KUB").expect("KUB bulunmalı");
        assert!((kub.pct - 9.44).abs() < 0.001);
        assert!(kub.name.contains("KARE PORTFÖY"));
        // İhraççı bloku ("Kare Portföy Yönetimi A.Ş.") ada sızmamalı.
        assert!(!kub.name.contains("Yönetimi"), "ihraççı ada sızdı: {}", kub.name);

        let total: f64 = holdings.iter().map(|h| h.pct).sum();
        assert!((80.0..=101.0).contains(&total), "yüzde toplamı anlamsız: {total}");
    }

    /// Biçim B: ISIN kendi satırında, yüzde değer satırının son kolonu.
    #[test]
    fn parses_detached_isin_layout() {
        let holdings = parse_holdings(include_str!("../fixtures/pdr_bvm_2026_06.txt"));
        println!("BVM: {} varlık", holdings.len());
        assert!(holdings.len() >= 5, "BVM'den {} varlık çıktı", holdings.len());

        let aefes = holdings.iter().find(|h| h.code == "AEFES").expect("AEFES bulunmalı");
        assert!((aefes.pct - 13.63).abs() < 0.001);
        let bimas = holdings.iter().find(|h| h.code == "BIMAS").expect("BIMAS bulunmalı");
        assert!((bimas.pct - 14.19).abs() < 0.001);
        assert!(bimas.name.contains("MAĞAZALA"));
    }

    /// Biçim A tahvil çeşidi: kod 12 karakterlik ISIN'in kendisi.
    #[test]
    fn parses_bond_rows_with_isin_codes() {
        let holdings = parse_holdings(include_str!("../fixtures/pdr_ti1_2026_06.txt"));
        println!("TI1: {} varlık", holdings.len());
        assert!(holdings.len() >= 10);

        let bond = holdings.iter().find(|h| h.code == "TRT080726T13").expect("tahvil bulunmalı");
        assert!((bond.pct - 0.21).abs() < 0.001);
        assert_eq!(bond.name, "HAZİNE");
        assert_eq!(bond.group, "BORÇLANMA SENETLERİ");
    }

    /// Biçim C: ABD sayı biçimi, tarihle başlayan tek satır, çift ISIN.
    #[test]
    fn parses_us_number_layout() {
        let holdings = parse_holdings(include_str!("../fixtures/pdr_ybs_2026_06.txt"));
        println!("YBS: {} varlık", holdings.len());
        assert!(holdings.len() >= 2);

        let adel = holdings.iter().find(|h| h.code == "TRFADELK2615").expect("bono bulunmalı");
        assert!((adel.pct - 1.25).abs() < 0.001);
        assert_eq!(adel.name, "ADELKALEM");
    }

    /// Kolon-major saçılmış PDF'in DÜZ metni: yanlış eşleşme üretmektense boş
    /// dönmeli — bu düzen konumsal yeniden kurmadan sonra ayrıştırılır.
    #[test]
    fn column_major_layout_yields_nothing_not_garbage() {
        let holdings = parse_holdings(include_str!("../fixtures/pdr_mmh_2026_06_kolonlu.txt"));
        assert!(
            holdings.is_empty(),
            "kolon-major düzenden çöp üretildi: {:?}",
            holdings.iter().take(3).collect::<Vec<_>>()
        );
    }

    /// Biçim D: kolon-major PDF'in konumsal yeniden kurulmuş metni.
    /// Ad kolonu dikey kaymayla komşu satıra karıştığından bilerek boştur.
    #[test]
    fn parses_reconstructed_column_major_layout() {
        let holdings = parse_holdings(include_str!("../fixtures/pdr_mmh_2026_06_yerlesim.txt"));
        println!("MMH yerleşim: {} varlık", holdings.len());
        assert!(holdings.len() >= 25, "{} varlık çıktı", holdings.len());

        let aefes = holdings.iter().find(|h| h.code == "AEFES").expect("AEFES bulunmalı");
        assert!((aefes.pct - 2.29).abs() < 0.001);
        assert_eq!(aefes.group, "HİSSE SENETLERİ");
        assert!(aefes.name.is_empty());

        let total: f64 = holdings.iter().map(|h| h.pct).sum();
        assert!((50.0..=101.0).contains(&total), "yüzde toplamı anlamsız: {total}");
    }

    /// Biçim E: ISIN ile başlayıp yüzde işaretiyle biten satırlar (AAL tipi).
    #[test]
    fn parses_isin_leading_percent_layout() {
        let holdings = parse_holdings(include_str!("../fixtures/pdr_aal_2026_06_yerlesim.txt"));
        println!("AAL yerleşim: {} varlık", holdings.len());
        assert!(holdings.len() >= 30);

        let bond = holdings.iter().find(|h| h.code == "TRT010328T12").expect("tahvil bulunmalı");
        assert!((bond.pct - 1.47).abs() < 0.001);
        assert_eq!(bond.name, "Hazine ve Maliye Bakanlığı");
    }

    #[test]
    fn parses_turkish_numbers() {
        assert_eq!(parse_tr_number("1.326.655,465"), Some(1_326_655.465));
        assert_eq!(parse_tr_number("2,10"), Some(2.10));
        assert_eq!(parse_tr_number("80_100_5"), None);
    }

    #[test]
    fn java_wrapper_is_stripped_to_pdf_signature() {
        let raw = [b"\xac\xed\x00\x05ur\x00\x02[B".as_slice(), b"%PDF-1.5 rest"].concat();
        assert_eq!(strip_java_wrapper(&raw).unwrap(), b"%PDF-1.5 rest");
        assert!(strip_java_wrapper(b"not a pdf").is_none());
    }

    #[test]
    fn months_back_handles_year_boundary() {
        let jan = chrono::NaiveDate::from_ymd_opt(2026, 1, 5).unwrap();
        assert_eq!(months_back(jan, 1), (2025, 12));
        assert_eq!(months_back(jan, 2), (2025, 11));
        let jul = chrono::NaiveDate::from_ymd_opt(2026, 7, 16).unwrap();
        assert_eq!(months_back(jul, 1), (2026, 6));
        assert_eq!(next_month(2025, 12), (2026, 1));
    }

    /// Keşif aracı: gerçek PDR metinlerini fikstür yazımı için dosyaya döker.
    #[tokio::test]
    #[ignore = "canlı ağ erişimi gerektirir"]
    async fn live_dump_pdr_texts() {
        let client = reqwest::Client::new();
        // MMH = BIST 30 hisse fonu (1612791), GLC = fon sepeti (1624252),
        // AAL = para piyasası (repo/mevduat ağırlıklı) — dönem haritasından bulunur.
        let index = pdr_index(&client).await.expect("harita");
        let mut targets = vec![("MMH", 1_612_791_u64), ("GLC", 1_624_252_u64)];
        for code in ["MMH_guncel", "BVM", "TI1", "AAL", "YBS"] {
            let lookup = code.trim_end_matches("_guncel");
            if let Some(idx) = index.1.get(if code == "MMH_guncel" { "MMH" } else { lookup }) {
                targets.push((code, *idx));
            }
        }
        for (code, index) in targets {
            let pdf = download_pdr_pdf(&client, index).await.expect("pdf inmeli");
            let text = pdf_extract::extract_text_from_mem(&pdf).expect("metin çıkmalı");
            let path = format!("/tmp/pdr_{code}.txt");
            std::fs::write(&path, &text).unwrap();
            let layout = layout_text(&pdf).unwrap_or_default();
            std::fs::write(format!("/tmp/pdr_{code}_yerlesim.txt"), &layout).unwrap();
            println!(
                "{code}: {} bayt pdf, {} karakter düz, {} karakter yerleşim (düz {} / yerleşim {} varlık)",
                pdf.len(), text.len(), layout.len(),
                parse_holdings(&text).len(), parse_holdings(&layout).len()
            );
        }
    }

    /// Canlı uç: dönem haritası dolu gelir ve bilinen bir fon kodu içerir.
    #[tokio::test]
    #[ignore = "canlı ağ erişimi gerektirir"]
    async fn live_pdr_index_has_funds() {
        let client = reqwest::Client::new();
        let index = pdr_index(&client).await.expect("dönem haritası gelmeli");
        let (period, map) = index.as_ref();
        println!("dönem {period}: {} fon", map.len());
        assert!(map.len() > 500);
    }

    /// Keşif aracı: dönem havuzundan örnekleme ile ayrıştırma kapsamını ölçer.
    #[tokio::test]
    #[ignore = "canlı ağ erişimi gerektirir"]
    async fn live_measure_parse_coverage() {
        let client = reqwest::Client::new();
        let index = pdr_index(&client).await.expect("harita");
        let (period, map) = index.as_ref();
        // Deterministik örnek: koda göre sıralı her N'inci fon.
        let mut codes: Vec<&String> = map.keys().collect();
        codes.sort();
        let step = (codes.len() / 25).max(1);
        let sample: Vec<&&String> = codes.iter().step_by(step).take(25).collect();

        let mut parsed = 0usize;
        let mut empty: Vec<String> = Vec::new();
        for code in &sample {
            let Ok(pdf) = download_pdr_pdf(&client, map[**code]).await else {
                empty.push(format!("{code} (indirme)"));
                continue;
            };
            let Ok(text) = pdf_extract::extract_text_from_mem(&pdf) else {
                empty.push(format!("{code} (metin)"));
                continue;
            };
            let mut holdings = parse_holdings(&text);
            if holdings.is_empty() {
                if let Ok(rebuilt) = layout_text(&pdf) {
                    holdings = parse_holdings(&rebuilt);
                }
            }
            if holdings.is_empty() {
                empty.push(format!("{code} ({}KB)", pdf.len() / 1024));
            } else {
                parsed += 1;
            }
        }
        println!(
            "dönem {period}: örnek {} fon → {} ayrıştı, {} boş: {:?}",
            sample.len(), parsed, empty.len(), empty
        );
    }

    /// Canlı uçtan uca: dönem haritası → PDF → varlık listesi.
    ///
    /// TI1 (İş Portföy) kullanılır: kurumsal üretici, desteklenen düzen.
    /// (MMH bilerek kullanılmaz: güncel PDF'i kolon-major, bilinçli boş döner.)
    #[tokio::test]
    #[ignore = "canlı ağ erişimi gerektirir"]
    async fn live_full_chain_extracts_holdings() {
        let client = reqwest::Client::new();
        let report = get_fund_holdings(&client, "TI1").await.expect("TI1 kırılımı gelmeli");
        println!(
            "TI1 {} dönemi: {} varlık; ilk 3: {:?}",
            report.period,
            report.holdings.len(),
            report.holdings.iter().take(3).map(|h| (&h.code, h.pct)).collect::<Vec<_>>()
        );
        assert!(report.holdings.len() >= 20);
        assert!(report.url.contains("/Bildirim/"));
        // Havuzda olmayan fon dürüst hatayla dönmeli.
        let missing = get_fund_holdings(&client, "QQQQQQ").await;
        assert!(missing.is_err());
    }
}
