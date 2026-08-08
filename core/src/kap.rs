//! Gerçek KAP (Kamuyu Aydınlatma Platformu) istemcisi.
//!
//! KAP'ın resmi JSON uçları çerezsiz ve anahtarsız çalışır:
//! - `POST tr/api/disclosure/members/byCriteria` — şirket bildirimleri (hisse kodlu)
//! - `POST tr/api/disclosure/funds/byCriteria` — fon bildirimleri (`fundCode` = TEFAS kodu)
//!
//! İki uçta da sunucu tarafında şirket/fon filtresi YOKTUR: `fundCode`,
//! `mkkMemberOid` gibi anahtarlar hata vermeden sessizce yok sayılır; süzme
//! istemcide yapılır. Yanıt tarih azalan sıralıdır ve 2000 kayıtta kesilir,
//! bu yüzden pencereler dar tutulur.

use crate::domain::KapAnnouncement;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::error::Error;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

const BASE_URL: &str = "https://www.kap.org.tr/tr";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(25);

const FEED_LIMIT: usize = 40;

/// Bildirimler süreç içinde topluca saklanır: uçlar şirket/fon bazlı filtre
/// tanımadığından her sembol için ayrı istek atmanın anlamı yok.
const CACHE_TTL: Duration = Duration::from_secs(15 * 60);
const FUND_DISCLOSURE_LIMIT: usize = 12;
const TICKER_DISCLOSURE_LIMIT: usize = 12;

/// byCriteria yanıtındaki tek satır; iki uç da aynı şemayı döndürür
/// (şirketlerde `stockCodes`, fonlarda `fundCode` dolu gelir).
#[derive(Clone, Deserialize)]
struct DisclosureRow {
    #[serde(rename = "publishDate")]
    publish_date: String,
    #[serde(rename = "fundCode")]
    fund_code: Option<String>,
    #[serde(rename = "stockCodes")]
    stock_codes: Option<String>,
    /// Bildirimi **yapan** şirket kendisi değilse ilgili paylar burada gelir.
    ///
    /// Borsa İstanbul'un yayımladığı yapısal duyurularda (devre kesici, işlem
    /// sırası açılışı/kapanışı, tedbir) `stockCodes` boştur ve hissenin kodu
    /// yalnız bu alanda bulunur — haftalık kayıtların ~%21'i bu durumda. Alan
    /// okunmazsa bu bildirimler hisse sayfasında hiç görünmez.
    #[serde(rename = "relatedStocks")]
    related_stocks: Option<String>,
    #[serde(rename = "disclosureClass")]
    disclosure_class: Option<String>,
    subject: Option<String>,
    summary: Option<String>,
    #[serde(rename = "disclosureIndex")]
    disclosure_index: u64,
    /// Bildirimi yapan şirketin KAP'taki tam unvanı. Yanıtta `companyName`
    /// **yoktur**; unvan yalnız bu alanda gelir.
    #[serde(rename = "kapTitle")]
    kap_title: Option<String>,
    /// Bildirime ekli dosya sayısı (IR sunum, finansal rapor PDF'leri vb.).
    #[serde(rename = "attachmentCount", default)]
    attachment_count: u32,
}

impl DisclosureRow {
    /// Bildirimle ilişkili pay kodları ("AKBNK, GARAN" → ["AKBNK", "GARAN"]).
    /// Önce bildirimi yapan şirketin kodu, yoksa ilgili paylar.
    fn stock_code_list(&self) -> Vec<&str> {
        self.stock_codes
            .as_deref()
            .filter(|codes| !codes.trim().is_empty())
            .or(self.related_stocks.as_deref())
            .unwrap_or("")
            .split(',')
            .map(str::trim)
            .filter(|code| !code.is_empty() && *code != "-")
            .collect()
    }
}

/// Fon ekranında gösterilen KAP bildirimi.
#[derive(Clone, Debug, Serialize)]
pub struct FundDisclosure {
    pub date: String,
    pub subject: String,
    pub summary: String,
    /// KAP'taki bildirim detay sayfası.
    pub url: String,
}

pub(crate) fn istanbul_today() -> chrono::NaiveDate {
    let istanbul = chrono::FixedOffset::east_opt(3 * 3600).unwrap();
    chrono::Utc::now().with_timezone(&istanbul).date_naive()
}

/// Sunucunun tek yanıtta döndürdüğü en fazla kayıt.
///
/// Uç sayfalama tanımıyor: sınıra dayanan bir pencerede yanıt tarih azalan
/// sırada kesilir, yani **en eski günler sessizce düşer**. Ölçüm: 7 günlük
/// pencere ~1250, 14 günlük pencere tam 2000 döndürüyor — bilanço sezonunda
/// 7 gün de sınıra dayanabilir. Bu yüzden sınıra değen her pencere ikiye
/// bölünüp yeniden istenir (bkz. `fetch_window`).
const MAX_ROWS_PER_RESPONSE: usize = 2000;

/// Pencereyi bölerken inilecek en küçük genişlik. Tek gün de sınıra dayarsa
/// bölünecek yer kalmaz; o günün kaydı kesik kabul edilir.
const MIN_WINDOW_DAYS: i64 = 1;

/// Tek bir pencereyi ister; geçici bağlantı hatalarında yeniden dener.
/// Denemesiz kurulumda düşen tek istek o turun bildirimlerini tamamen
/// boşaltıyordu (akış "hiç bildirim yok" gibi görünüyordu).
///
/// Hız sınırı (429) **yeniden denenmez**: KAP'ın sınırı dakikalar mertebesinde
/// sıfırlanır, aynı çağrı içinde ısrar etmek yalnız sınırı daha da uzatır.
/// Hata açıkça yüzeye çıkar ve bir sonraki önbellek turunda tekrar denenir.
async fn fetch_by_criteria(
    client: &Client,
    kind: &str,
    from: chrono::NaiveDate,
    to: chrono::NaiveDate,
) -> Result<Vec<DisclosureRow>, String> {
    crate::retry::with_retry(
        crate::retry::DEFAULT_ATTEMPTS,
        crate::retry::is_rate_limited,
        || fetch_by_criteria_once(client, kind, from, to),
    )
    .await
}

async fn fetch_by_criteria_once(
    client: &Client,
    kind: &str,
    from: chrono::NaiveDate,
    to: chrono::NaiveDate,
) -> Result<Vec<DisclosureRow>, String> {
    let body = serde_json::json!({
        "fromDate": from.format("%Y-%m-%d").to_string(),
        "toDate": to.format("%Y-%m-%d").to_string(),
    });
    let _permit = crate::retry::kap_permit().await;
    let response = client
        .post(format!("{BASE_URL}/api/disclosure/{kind}/byCriteria"))
        .timeout(REQUEST_TIMEOUT)
        .header("User-Agent", crate::yahoo::YAHOO_USER_AGENT)
        .header("Accept", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("KAP {kind} isteği: {error}"))?;

    // Durum kodu ÖNCE denetlenir. Denetlenmediğinde 429/5xx gövdesi doğrudan
    // JSON çözücüye gidiyor ve gerçek sebebi gizleyen "yanıtı çözümlenemedi"
    // hatası üretiyordu — hız sınırına takıldığımızı görmek imkânsızdı.
    let response = crate::retry::check_status(response, &format!("KAP {kind}"))?;

    // Hata durumunda dizi yerine {"success":false,...} zarfı döner; decode
    // hatası olarak yüzeye çıkar.
    response
        .json::<Vec<DisclosureRow>>()
        .await
        .map_err(|error| format!("KAP {kind} yanıtı çözümlenemedi: {error}"))
}

/// Bir tarih aralığını **eksiksiz** getirir.
///
/// Yanıt sunucu sınırına dayanmışsa aralık ikiye bölünüp her yarı ayrı ayrı
/// istenir; böylece yoğun günlerde kesilen eski kayıtlar da toplanır. Özyineleme
/// `MIN_WINDOW_DAYS`'te durur.
fn fetch_window<'a>(
    client: &'a Client,
    kind: &'a str,
    from: chrono::NaiveDate,
    to: chrono::NaiveDate,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<DisclosureRow>, String>> + Send + 'a>> {
    Box::pin(async move {
        let rows = fetch_by_criteria(client, kind, from, to).await?;
        let span = (to - from).num_days();
        if rows.len() < MAX_ROWS_PER_RESPONSE || span <= MIN_WINDOW_DAYS {
            return Ok(rows);
        }

        // Sınıra dayandı: aralığı ikiye böl, iki yarıyı paralel iste.
        let middle = from + chrono::Duration::days(span / 2);
        let (older, newer) = tokio::join!(
            fetch_window(client, kind, from, middle),
            fetch_window(client, kind, middle + chrono::Duration::days(1), to),
        );

        // Bölünmüş istek başarısız olursa kesik de olsa eldeki veriyle devam
        // edilir; boş dönmek kullanıcıya "hiç bildirim yok" demek olurdu.
        match (older, newer) {
            (Ok(mut a), Ok(b)) => {
                a.extend(b);
                Ok(a)
            }
            _ => Ok(rows),
        }
    })
}

/// Modüller arası paylaşılan ham bildirim satırı.
///
/// `DisclosureRow` özeldir çünkü serde adlandırmaları uca bağlıdır; halka arz
/// tarafı gibi başka modüller uçla değil bu sadeleşmiş görünümle konuşur.
#[derive(Clone, Debug)]
pub(crate) struct RawDisclosure {
    pub publish_date: String,
    pub subject: String,
    pub disclosure_index: u64,
    /// Bildirimi yapan şirketin KAP unvanı.
    pub kap_title: String,
    /// Bildirimle ilişkili pay kodları; bildirimi yapan yoksa ilgili paylar.
    pub stock_codes: Vec<String>,
}

impl From<&DisclosureRow> for RawDisclosure {
    fn from(row: &DisclosureRow) -> Self {
        RawDisclosure {
            publish_date: row.publish_date.clone(),
            subject: row.subject.clone().unwrap_or_default(),
            disclosure_index: row.disclosure_index,
            kap_title: row.kap_title.clone().unwrap_or_default(),
            stock_codes: row
                .stock_code_list()
                .into_iter()
                .map(str::to_string)
                .collect(),
        }
    }
}

/// Verilen tarih aralığındaki **tüm** şirket bildirimlerini getirir.
///
/// `member_rows` yalnız son ~4 haftayı önbellekler; geçmişe dönük tarama
/// (halka arz arşivi gibi) buradan geçer. Aralık tek istekle 2000 satır
/// sınırına dayanırsa `fetch_window` özyinelemeli olarak böler, yani uzun
/// aralıklarda da kayıt düşmez. Önbelleklenmez: çağıran kendi ritmini kurar.
pub(crate) async fn disclosures_in_range(
    client: &Client,
    from: chrono::NaiveDate,
    to: chrono::NaiveDate,
) -> Result<Vec<RawDisclosure>, String> {
    let rows = fetch_window(client, "members", from, to).await?;
    Ok(rows.iter().map(RawDisclosure::from).collect())
}

/// "16.07.2026 15:50:23" → "16.07.2026 15:50". Beklenmedik biçim aynen kalır.
fn short_date(raw: &str) -> String {
    match raw.rsplit_once(':') {
        Some((rest, seconds)) if seconds.len() == 2 && rest.contains(':') => rest.to_string(),
        _ => raw.to_string(),
    }
}

fn class_label(class: Option<&str>) -> String {
    match class {
        Some("ODA") => "Özel Durum Açıklaması".to_string(),
        Some("FR") => "Finansal Rapor".to_string(),
        Some("DUY") => "Duyuru".to_string(),
        Some("DG") => "Diğer".to_string(),
        // Borsa İstanbul'un yapısal duyuruları: devre kesici, işlem sırası
        // açılış/kapanış, tedbir kararları. Haftalık akışın ~%22'si.
        Some("DKB") => "Borsa İstanbul Duyurusu".to_string(),
        Some(other) => other.to_string(),
        None => "KAP".to_string(),
    }
}

/// Konu/özet metnine göre kaba önem puanı; akıştaki AI rozetini besler.
fn importance(subject: &str, summary: &str) -> u8 {
    let text = format!("{subject} {summary}").to_lowercase();
    const HIGH: [&str; 12] = [
        "temettü", "kâr payı", "kar payı", "birleşme", "bölünme", "geri alım",
        "sermaye artırım", "iflas", "konkordato", "devralma", "halka arz", "pay satış",
    ];
    const MEDIUM: [&str; 8] = [
        "finansal rapor", "faaliyet raporu", "ihale", "sözleşme",
        "derecelendirme", "ortaklık", "yatırım", "üretim",
    ];
    if HIGH.iter().any(|kw| text.contains(kw)) {
        75
    } else if MEDIUM.iter().any(|kw| text.contains(kw)) {
        55
    } else {
        45
    }
}

fn to_announcement(row: &DisclosureRow) -> Option<KapAnnouncement> {
    let subject = row.subject.as_deref()?.trim();
    if subject.is_empty() {
        return None;
    }
    // Birden çok kod "AKBNK, GARAN" biçiminde gelir; rozete ilki yazılır.
    let ticker = row
        .stock_code_list()
        .first()
        .map(|code| code.to_uppercase())
        .unwrap_or_else(|| "KAP".to_string());
    let summary = row
        .summary
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != "-")
        .unwrap_or_default()
        .to_string();

    Some(KapAnnouncement {
        id: format!("KAP-{}", row.disclosure_index),
        ticker,
        title: subject.to_string(),
        date: short_date(&row.publish_date),
        category: class_label(row.disclosure_class.as_deref()),
        summary,
        ai_importance_score: importance(subject, &row.summary.clone().unwrap_or_default()),
        url: format!("{BASE_URL}/Bildirim/{}", row.disclosure_index),
        attachment_count: row.attachment_count,
    })
}

type RowCache = Mutex<Option<(Instant, Arc<Vec<DisclosureRow>>)>>;

static MEMBER_CACHE: OnceLock<RowCache> = OnceLock::new();
static FUND_CACHE: OnceLock<RowCache> = OnceLock::new();

fn read_cache(cache: &'static OnceLock<RowCache>) -> Option<Arc<Vec<DisclosureRow>>> {
    let guard = cache.get_or_init(|| Mutex::new(None));
    let guard = guard.lock().unwrap_or_else(|e| e.into_inner());
    guard
        .as_ref()
        .filter(|(fetched_at, _)| fetched_at.elapsed() < CACHE_TTL)
        .map(|(_, rows)| rows.clone())
}

fn write_cache(cache: &'static OnceLock<RowCache>, rows: Arc<Vec<DisclosureRow>>) {
    let guard = cache.get_or_init(|| Mutex::new(None));
    *guard.lock().unwrap_or_else(|e| e.into_inner()) = Some((Instant::now(), rows));
}

/// Son ~4 haftanın şirket bildirimleri (önbellekli).
///
/// Bilanço sezonunda hacim haftada 2000 kayıt sınırına dayandığından aralık
/// haftalık dört parça halinde istenir; en yeni pencere olmazsa olmaz,
/// eskiler gelmezse elde olan gösterilir. Kayıtlar tarih azalan kalır.
async fn member_rows(client: &Client) -> Result<Arc<Vec<DisclosureRow>>, String> {
    if let Some(rows) = read_cache(&MEMBER_CACHE) {
        return Ok(rows);
    }

    let today = istanbul_today();
    let d = |n| today - chrono::Duration::days(n);
    let (w0, w1, w2, w3) = tokio::join!(
        fetch_window(client, "members", d(6), today),
        fetch_window(client, "members", d(13), d(7)),
        fetch_window(client, "members", d(20), d(14)),
        fetch_window(client, "members", d(27), d(21)),
    );
    let mut rows = w0?;
    for window in [w1, w2, w3] {
        rows.extend(window.unwrap_or_default());
    }

    let rows = Arc::new(rows);
    write_cache(&MEMBER_CACHE, rows.clone());
    Ok(rows)
}

/// Son şirket bildirimleri — panodaki KAP akışının kaynağı.
pub async fn fetch_kap_announcements(
    client: &Client,
) -> Result<Vec<KapAnnouncement>, Box<dyn Error + Send + Sync>> {
    let rows = member_rows(client).await?;
    let mut items: Vec<KapAnnouncement> = rows.iter().filter_map(to_announcement).collect();
    items.truncate(FEED_LIMIT);
    Ok(items)
}

/// Havuzdan tek hissenin bildirimlerini süzer. Kod eşleşmesi parça bazlıdır:
/// "AKBNK, GARAN" satırı GARAN sorgusuna da çıkar, "AGARAN" çıkmaz.
fn rows_for_ticker(rows: &[DisclosureRow], code: &str) -> Vec<KapAnnouncement> {
    rows.iter()
        .filter(|row| row.stock_code_list().contains(&code))
        .filter_map(to_announcement)
        .map(|mut item| {
            // Çok kodlu bildirimde rozet sorgulanan hisseyi göstermeli.
            item.ticker = code.to_string();
            item
        })
        .take(TICKER_DISCLOSURE_LIMIT)
        .collect()
}

/// Bir hissenin son ~4 haftadaki gerçek KAP bildirimleri.
pub async fn ticker_disclosures(client: &Client, ticker: &str) -> Result<Vec<KapAnnouncement>, String> {
    let code = ticker.trim().to_uppercase();
    let rows = member_rows(client).await?;
    Ok(rows_for_ticker(&rows, &code))
}

/// Son ~4 haftanın tüm fon bildirimlerini getirir (önbellekli).
///
/// 2000 kayıt sınırına yoğun günlerde tek pencere takıldığından aralık iki
/// parça halinde istenir ve birleştirilir.
async fn fund_rows(client: &Client) -> Result<Arc<Vec<DisclosureRow>>, String> {
    if let Some(rows) = read_cache(&FUND_CACHE) {
        return Ok(rows);
    }

    let today = istanbul_today();
    let day = chrono::Duration::days;
    let (recent, older) = tokio::join!(
        fetch_window(client, "funds", today - day(13), today),
        fetch_window(client, "funds", today - day(27), today - day(14)),
    );
    // İlk pencere olmazsa olmaz; ikincisi gelmezse elde olan gösterilir.
    let mut rows = recent?;
    rows.extend(older.unwrap_or_default());

    let rows = Arc::new(rows);
    write_cache(&FUND_CACHE, rows.clone());
    Ok(rows)
}

/// Bir fonun son KAP bildirimleri (fon ekranı için).
pub async fn fund_disclosures(client: &Client, fund_code: &str) -> Result<Vec<FundDisclosure>, String> {
    let code = fund_code.trim().to_uppercase();
    let rows = fund_rows(client).await?;

    Ok(rows
        .iter()
        .filter(|row| row.fund_code.as_deref() == Some(code.as_str()))
        .take(FUND_DISCLOSURE_LIMIT)
        .map(|row| FundDisclosure {
            date: short_date(&row.publish_date),
            subject: row.subject.clone().unwrap_or_default(),
            summary: row
                .summary
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty() && *s != "-")
                .unwrap_or_default()
                .to_string(),
            url: format!("{BASE_URL}/Bildirim/{}", row.disclosure_index),
        })
        .collect())
}

/// RSS/Google News tarihlerini "gg.aa.YYYY SS:DD" biçimine çevirir.
/// (Haber modülleri kullanır; KAP'ın kendi tarihleri zaten bu biçimdedir.)
pub(crate) fn format_rss_date(raw: &str) -> String {
    let cleaned = raw
        .replace("<![CDATA[", "")
        .replace("]]>", "")
        .trim()
        .to_string();

    if let Ok(dt) = chrono::DateTime::parse_from_rfc2822(&cleaned) {
        let istanbul = chrono::FixedOffset::east_opt(3 * 3600).unwrap();
        return dt.with_timezone(&istanbul).format("%d.%m.%Y %H:%M").to_string();
    }
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(&cleaned, "%d.%m.%Y %H:%M:%S") {
        return dt.format("%d.%m.%Y %H:%M").to_string();
    }
    cleaned
}

// ─── Bildirim Detay Scraper ─────────────────────────────────────────────
//
// KAP'ın bildirim detay API'si (disclosureDetail, downloadAttachment) API KEY
// gerektirdiğinden, bildirim ekleri ve export URL'leri doğrudan bildirim
// sayfasının server-side rendered HTML'inden çıkarılır.
//
// Bildirim sayfası HTML'inde bulunan kalıplar:
//   Ekler:  href="https://www.kap.org.tr/tr/api/file/download/{fileId}">Dosya Adı.pdf</a>
//   PDF:    href="https://www.kap.org.tr/tr/api/BildirimPdf/{id}"
//   Word:   href="https://www.kap.org.tr/tr/api/notification/export/word/{id}"
//   Excel:  href="https://www.kap.org.tr/tr/api/notification/export/excel/{id}"

use crate::domain::{KapAttachmentInfo, KapDisclosureDetail};
use regex::Regex;

/// Bir KAP bildiriminin detay sayfasını çekip ek dosyaları ve export URL'lerini
/// çıkarır. `disclosure_index` sayısal bildirim numarasıdır (ör. "1643242").
///
/// Başarısız olursa hata mesajı döner — çağıran kod graceful degrade eder.
pub async fn fetch_disclosure_detail(
    client: &Client,
    disclosure_index: &str,
) -> Result<KapDisclosureDetail, String> {
    let url = format!("{BASE_URL}/Bildirim/{disclosure_index}");
    let _permit = crate::retry::kap_permit().await;

    let html = client
        .get(&url)
        .timeout(REQUEST_TIMEOUT)
        .header("User-Agent", crate::yahoo::YAHOO_USER_AGENT)
        .header("Accept", "text/html")
        .send()
        .await
        .map_err(|e| format!("KAP bildirim sayfası isteği: {e}"))?
        .text()
        .await
        .map_err(|e| format!("KAP bildirim sayfası okunamadı: {e}"))?;

    // ── Bildirim Ekleri: /api/file/download/{fileId} ──
    // HTML kalıbı: href="https://www.kap.org.tr/tr/api/file/download/XXXXX">DosyaAdı.pdf</a>
    let file_re = Regex::new(
        r#"href="(https://www\.kap\.org\.tr/tr/api/file/download/[^"]+)"[^>]*>([^<]+)</a>"#,
    )
    .unwrap();

    let attachments: Vec<KapAttachmentInfo> = file_re
        .captures_iter(&html)
        .map(|cap| KapAttachmentInfo {
            url: cap[1].to_string(),
            name: cap[2].trim().to_string(),
        })
        .collect();

    // ── Sağ panel export URL'leri ──
    let pdf_url = extract_href(&html, "api/BildirimPdf/")
        .unwrap_or_else(|| format!("{BASE_URL}/api/BildirimPdf/{disclosure_index}"));
    let word_url = extract_href(&html, "api/notification/export/word/")
        .unwrap_or_else(|| format!("{BASE_URL}/api/notification/export/word/{disclosure_index}"));
    let excel_url = extract_href(&html, "api/notification/export/excel/")
        .unwrap_or_else(|| format!("{BASE_URL}/api/notification/export/excel/{disclosure_index}"));

    Ok(KapDisclosureDetail {
        disclosure_index: disclosure_index.to_string(),
        attachments,
        pdf_url,
        word_url,
        excel_url,
    })
}

/// HTML'den belirli bir alt-dizi içeren ilk `href="…"` değerini çıkarır.
fn extract_href(html: &str, pattern: &str) -> Option<String> {
    let search = format!(r#"href=""#);
    let mut pos = 0;
    while let Some(start) = html[pos..].find(&search) {
        let abs_start = pos + start + search.len();
        if let Some(end) = html[abs_start..].find('"') {
            let href = &html[abs_start..abs_start + end];
            if href.contains(pattern) {
                return Some(href.to_string());
            }
        }
        pos = abs_start + 1;
    }
    None
}

/// Canlı KAP Finansal Rapor Bildiriminden (XBRL / SSR HTML) en güncel dönemi kazıyıp ayrıştırır.
pub async fn fetch_latest_kap_financial_period(
    client: &Client,
    ticker: &str,
) -> Result<Option<crate::domain::FinancialPeriod>, Box<dyn Error + Send + Sync>> {
    let list = ticker_disclosures(client, ticker).await?;
    let fr = list.into_iter().find(|ann| {
        let cat = ann.category.to_uppercase();
        let title = ann.title.to_lowercase();
        cat == "FR" || title.contains("finansal rapor") || title.contains("bilanço")
    });

    let ann = match fr {
        Some(a) => a,
        None => return Ok(None),
    };

    let raw_id = ann.id.replace(|c: char| !c.is_ascii_digit(), "");
    if raw_id.is_empty() {
        return Ok(None);
    }

    let url = format!("{BASE_URL}/Bildirim/{raw_id}");
    let resp = client
        .get(&url)
        .timeout(Duration::from_secs(10))
        .header("User-Agent", crate::yahoo::YAHOO_USER_AGENT)
        .send()
        .await?;

    if !resp.status().is_success() {
        return Ok(None);
    }

    let html = resp.text().await?;
    let period_str = ann.date.chars().take(10).collect::<String>();

    let revenue = parse_html_line_item(&html, &["Hasılat", "Satış Gelirleri", "FAİZ GELİRLERİ"]);
    let gross_profit = parse_html_line_item(&html, &["Brüt Kâr", "NET FAİZ GELİRİ"]);
    let operating_income = parse_html_line_item(&html, &["Esas Faaliyet Kârı", "Faaliyet Kârı"]);
    let net_income = parse_html_line_item(&html, &["Net Dönem Kârı", "DÖNEM KÂRI"]);
    let total_assets = parse_html_line_item(&html, &["Toplam Varlıklar", "TOPLAM AKTİFLER"]);
    let total_equity = parse_html_line_item(&html, &["Özkaynaklar", "TOPLAM ÖZKAYNAKLAR"]);
    let total_debt = parse_html_line_item(&html, &["Finansal Borçlar", "Kısa Vadeli Borçlar"]);
    let operating_cash_flow = parse_html_line_item(&html, &["İşletme Faaliyetlerinden Nakit"]);

    if revenue.is_none() && net_income.is_none() && total_assets.is_none() {
        return Ok(None);
    }

    Ok(Some(crate::domain::FinancialPeriod {
        period: period_str,
        revenue,
        gross_profit,
        operating_income,
        net_income,
        total_assets,
        total_equity,
        total_debt,
        operating_cash_flow,
        free_cash_flow: None,
    }))
}

fn parse_html_line_item(html: &str, keywords: &[&str]) -> Option<f64> {
    for kw in keywords {
        if let Some(pos) = html.find(kw) {
            let snippet = &html[pos..pos + std::cmp::min(250, html.len() - pos)];
            for token in snippet.split(|c: char| !c.is_numeric() && c != '.' && c != ',' && c != '-') {
                let cleaned = token.replace('.', "").replace(',', ".");
                if let Ok(num) = cleaned.parse::<f64>() {
                    if num.abs() > 1.0 {
                        return Some(num);
                    }
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_MEMBER: &str = r#"{
        "publishDate": "16.07.2026 15:50:23",
        "fundCode": null,
        "kapTitle": "LUXERA GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş.",
        "disclosureClass": "ODA",
        "summary": "Gayrimenkul Portföyüne Varlık Alımı Hakkında ",
        "subject": "Özel Durum Açıklaması (Genel)",
        "stockCodes": "LXGYO",
        "disclosureIndex": 1634099
    }"#;

    const SAMPLE_FUND: &str = r#"{
        "publishDate": "14.07.2026 15:58:19",
        "fundCode": "TLV",
        "kapTitle": "TERA PORTFÖY PARA PİYASASI KATILIM (TL) FONU",
        "disclosureClass": "ODA",
        "summary": "-",
        "subject": "Borsa Dışı Vaad Sözleşmesi",
        "stockCodes": null,
        "disclosureIndex": 1632500
    }"#;

    #[test]
    fn maps_member_row_to_announcement() {
        let row: DisclosureRow = serde_json::from_str(SAMPLE_MEMBER).unwrap();
        let item = to_announcement(&row).unwrap();
        assert_eq!(item.id, "KAP-1634099");
        assert_eq!(item.ticker, "LXGYO");
        assert_eq!(item.title, "Özel Durum Açıklaması (Genel)");
        assert_eq!(item.date, "16.07.2026 15:50");
        assert_eq!(item.category, "Özel Durum Açıklaması");
        assert_eq!(item.summary, "Gayrimenkul Portföyüne Varlık Alımı Hakkında");
        assert_eq!(item.url, "https://www.kap.org.tr/tr/Bildirim/1634099");
    }

    #[test]
    fn fund_row_without_stock_code_gets_kap_badge_and_no_dash_summary() {
        let row: DisclosureRow = serde_json::from_str(SAMPLE_FUND).unwrap();
        let item = to_announcement(&row).unwrap();
        assert_eq!(item.ticker, "KAP");
        // "-" özeti boş sayılır
        assert_eq!(item.summary, "");
    }

    #[test]
    fn multiple_stock_codes_use_first() {
        let row: DisclosureRow =
            serde_json::from_str(&SAMPLE_MEMBER.replace("\"LXGYO\"", "\"AKBNK, GARAN\"")).unwrap();
        assert_eq!(to_announcement(&row).unwrap().ticker, "AKBNK");
    }

    #[test]
    fn missing_subject_is_skipped() {
        let row: DisclosureRow =
            serde_json::from_str(&SAMPLE_MEMBER.replace("\"Özel Durum Açıklaması (Genel)\"", "null")).unwrap();
        assert!(to_announcement(&row).is_none());
    }

    /// Borsa İstanbul duyurusu: `stockCodes` boş, kod yalnız `relatedStocks`'ta.
    /// Bu satırlar haftalık akışın ~%21'i; alan okunmazsa hisse sayfasında hiç
    /// görünmezler ve rozetleri "KAP" kalır.
    const SAMPLE_RELATED: &str = r#"{
        "publishDate": "27.07.2026 10:12:00",
        "kapTitle": "BORSA İSTANBUL BISTECH DEVRE KESİCİ UYGULAMASI",
        "disclosureClass": "DKB",
        "summary": "-",
        "subject": "Pay Bazında Devre Kesici Bildirimi",
        "stockCodes": null,
        "relatedStocks": "AGHOL",
        "disclosureIndex": 1636800
    }"#;

    #[test]
    fn related_stocks_fill_in_when_stock_codes_are_empty() {
        let row: DisclosureRow = serde_json::from_str(SAMPLE_RELATED).unwrap();
        let item = to_announcement(&row).unwrap();
        assert_eq!(item.ticker, "AGHOL", "ilgili pay rozete yazılmalı");
        assert_eq!(item.category, "Borsa İstanbul Duyurusu");
        // Hisse sayfasında da görünmeli.
        assert_eq!(rows_for_ticker(std::slice::from_ref(&row), "AGHOL").len(), 1);
    }

    /// Boş string de "kod yok" sayılmalı; sağlayıcı null yerine "" gönderebiliyor.
    #[test]
    fn blank_stock_codes_fall_back_to_related() {
        let row: DisclosureRow =
            serde_json::from_str(&SAMPLE_RELATED.replace("\"stockCodes\": null", "\"stockCodes\": \"  \"")).unwrap();
        assert_eq!(to_announcement(&row).unwrap().ticker, "AGHOL");
    }

    /// İki alan da boşsa davranış değişmemeli: rozet "KAP", süzmede çıkmaz.
    #[test]
    fn row_without_any_code_stays_unattributed() {
        let row: DisclosureRow = serde_json::from_str(
            &SAMPLE_RELATED.replace("\"relatedStocks\": \"AGHOL\"", "\"relatedStocks\": null"),
        ).unwrap();
        assert_eq!(to_announcement(&row).unwrap().ticker, "KAP");
        assert!(rows_for_ticker(std::slice::from_ref(&row), "AGHOL").is_empty());
    }

    #[test]
    fn short_date_trims_only_seconds() {
        assert_eq!(short_date("16.07.2026 15:50:23"), "16.07.2026 15:50");
        assert_eq!(short_date("16.07.2026 15:50"), "16.07.2026 15:50");
        assert_eq!(short_date("2026-07-16"), "2026-07-16");
    }

    #[test]
    fn importance_ranks_subjects() {
        assert_eq!(importance("Kâr Payı Dağıtım İşlemlerine İlişkin Bildirim", ""), 75);
        assert_eq!(importance("Finansal Rapor", ""), 55);
        assert_eq!(importance("Şirket Genel Bilgi Formu", ""), 45);
    }

    #[test]
    fn ticker_filter_matches_exact_code_tokens() {
        let multi: DisclosureRow =
            serde_json::from_str(&SAMPLE_MEMBER.replace("\"LXGYO\"", "\"AKBNK, GARAN\"")).unwrap();
        let single: DisclosureRow = serde_json::from_str(SAMPLE_MEMBER).unwrap();
        let none: DisclosureRow =
            serde_json::from_str(&SAMPLE_MEMBER.replace("\"LXGYO\"", "null")).unwrap();
        let rows = vec![multi, single, none];

        // İkinci koddan da bulunur ve rozet sorgulanan hisseye çevrilir.
        let garan = rows_for_ticker(&rows, "GARAN");
        assert_eq!(garan.len(), 1);
        assert_eq!(garan[0].ticker, "GARAN");
        // Parça eşleşmesi: "GARAN" sorgusu "AGARAN" gibi kodlara taşmaz.
        assert!(rows_for_ticker(&rows, "GAR").is_empty());
        assert_eq!(rows_for_ticker(&rows, "LXGYO").len(), 1);
    }

    #[test]
    fn formats_rss_dates() {
        assert_eq!(format_rss_date("Thu, 09 Jul 2026 08:48:51 +0000"), "09.07.2026 11:48");
        assert_eq!(format_rss_date("09.07.2026 12:51:48"), "09.07.2026 12:51");
    }

    /// Canlı uç: `relatedStocks` okunduğunda bildirimlerin hisseye bağlanma
    /// oranı ölçülebilir biçimde artmalı. Yalnız `stockCodes` okunsaydı Borsa
    /// İstanbul duyuruları (devre kesici, işlem sırası, tedbir) sahipsiz kalırdı.
    #[tokio::test]
    #[ignore = "canlı ağ erişimi gerektirir"]
    async fn live_related_stocks_recover_unattributed_disclosures() {
        let client = crate::http_client();
        let rows = member_rows(&client).await.expect("havuz gelmeli");

        let with_stock_codes = rows
            .iter()
            .filter(|row| row.stock_codes.as_deref().is_some_and(|c| !c.trim().is_empty()))
            .count();
        let attributed = rows.iter().filter(|row| !row.stock_code_list().is_empty()).count();
        let recovered = attributed - with_stock_codes;

        println!(
            "havuz {} kayıt · stockCodes {} · relatedStocks ile kurtarılan {} · toplam {}",
            rows.len(), with_stock_codes, recovered, attributed
        );
        assert!(recovered > 0, "relatedStocks hiç kayıt kurtarmadı — alan adı değişmiş olabilir");
        assert!(attributed > with_stock_codes);

        // Kurtarılan bir kaydın hisse süzmesinde gerçekten göründüğünü doğrula.
        let recovered_code = rows
            .iter()
            .find(|row| {
                row.stock_codes.as_deref().is_none_or(|c| c.trim().is_empty())
                    && !row.stock_code_list().is_empty()
            })
            .map(|row| row.stock_code_list()[0].to_string())
            .expect("kurtarılan kayıt olmalı");
        let items = rows_for_ticker(&rows, &recovered_code);
        assert!(!items.is_empty(), "{recovered_code} süzmede görünmeli");
        println!("örnek: {recovered_code} → {}", items[0].title);
    }

    /// Canlı uç: pencere bölme, sunucunun 2000 kayıt sınırını aşan aralıkta
    /// tek istekten daha fazla kayıt toplamalı. Bölme çalışmazsa eski günler
    /// sessizce düşerdi.
    #[tokio::test]
    #[ignore = "canlı ağ erişimi gerektirir"]
    async fn live_window_splitting_beats_the_server_cap() {
        let client = crate::http_client();
        let today = istanbul_today();
        let from = today - chrono::Duration::days(29);

        let single = fetch_by_criteria(&client, "members", from, today).await.unwrap();
        let split = fetch_window(&client, "members", from, today).await.unwrap();

        println!("30 günlük aralık: tek istek {} · bölünmüş {}", single.len(), split.len());
        assert_eq!(single.len(), MAX_ROWS_PER_RESPONSE, "aralık sınıra dayanmalı (test öncülü)");
        assert!(
            split.len() > single.len(),
            "bölme daha fazla kayıt toplamalı: {} vs {}",
            split.len(), single.len()
        );
        // Bölünmüş parçalar örtüşmediğinden mükerrer kayıt olmamalı.
        let unique: std::collections::HashSet<u64> =
            split.iter().map(|row| row.disclosure_index).collect();
        assert_eq!(unique.len(), split.len(), "bölünmüş pencerelerde mükerrer kayıt var");
    }

    /// Canlı uç: şirket akışı dolu ve alanlar beklenen biçimde gelir.
    #[tokio::test]
    #[ignore = "canlı ağ erişimi gerektirir"]
    async fn live_member_feed_returns_announcements() {
        let client = reqwest::Client::new();
        let items = fetch_kap_announcements(&client).await.expect("akış gelmeli");
        println!("{} bildirim; ilki: {} | {} | {}", items.len(), items[0].ticker, items[0].title, items[0].date);
        assert!(!items.is_empty());
        assert!(items[0].url.starts_with("https://www.kap.org.tr/tr/Bildirim/"));
    }

    /// Canlı uç: şirket havuzundan seçilen bir hisse koduyla süzme
    /// deterministik olarak sonuç verir.
    #[tokio::test]
    #[ignore = "canlı ağ erişimi gerektirir"]
    async fn live_ticker_disclosures_filter_by_code() {
        let client = reqwest::Client::new();
        let rows = member_rows(&client).await.expect("şirket havuzu gelmeli");
        println!("havuz: {} kayıt", rows.len());
        let code = rows
            .iter()
            .find_map(|r| r.stock_codes.as_deref())
            .and_then(|codes| codes.split(',').next())
            .map(|c| c.trim().to_string())
            .expect("en az bir hisse kodu olmalı");
        let items = ticker_disclosures(&client, &code).await.unwrap();
        println!("{code}: {} bildirim; ilki: {:?}", items.len(), items.first().map(|i| &i.title));
        assert!(!items.is_empty());
        assert!(items.iter().all(|i| i.ticker == code));
    }

    /// Canlı uç: fon havuzu dolu gelir ve içinden seçilen bir fon koduyla
    /// süzme deterministik olarak sonuç verir.
    #[tokio::test]
    #[ignore = "canlı ağ erişimi gerektirir"]
    async fn live_fund_disclosures_filter_by_code() {
        let client = reqwest::Client::new();
        let rows = fund_rows(&client).await.expect("fon havuzu gelmeli");
        let code = rows
            .iter()
            .find_map(|r| r.fund_code.clone())
            .expect("en az bir fon kodu olmalı");
        let items = fund_disclosures(&client, &code).await.unwrap();
        println!("{code}: {} bildirim; ilki: {:?}", items.len(), items.first().map(|i| &i.subject));
        assert!(!items.is_empty());
        assert!(items.iter().all(|i| i.url.contains("/Bildirim/")));
    }

    /// Canlı uç: Gerçek bir KAP bildirim sayfasından (örneğin 1643242) eklerin
    /// ve export linklerinin doğru ayrıştırıldığını doğrular.
    #[tokio::test]
    #[ignore = "canlı ağ erişimi gerektirir"]
    async fn live_disclosure_detail_scraping() {
        let client = reqwest::Client::new();
        let detail = fetch_disclosure_detail(&client, "1643242")
            .await
            .expect("KAP bildirim detayı scrape edilebilmeli");

        println!(
            "KAP 1643242 scrape sonucu: {} adet ek | PDF: {} | Excel: {} | Word: {}",
            detail.attachments.len(),
            detail.pdf_url,
            detail.excel_url,
            detail.word_url
        );

        assert!(!detail.pdf_url.is_empty());
        assert!(!detail.excel_url.is_empty());
        assert!(!detail.word_url.is_empty());
        assert!(detail.attachments.len() >= 3, "THYAO 1643242 bildiriminde en az 3 adet ek olmalı");
        assert!(detail.attachments[0].url.contains("api/file/download/"));
    }
}
