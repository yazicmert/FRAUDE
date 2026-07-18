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
    #[serde(rename = "disclosureClass")]
    disclosure_class: Option<String>,
    subject: Option<String>,
    summary: Option<String>,
    #[serde(rename = "disclosureIndex")]
    disclosure_index: u64,
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

async fn fetch_by_criteria(
    client: &Client,
    kind: &str,
    from: chrono::NaiveDate,
    to: chrono::NaiveDate,
) -> Result<Vec<DisclosureRow>, String> {
    let body = serde_json::json!({
        "fromDate": from.format("%Y-%m-%d").to_string(),
        "toDate": to.format("%Y-%m-%d").to_string(),
    });
    let response = client
        .post(format!("{BASE_URL}/api/disclosure/{kind}/byCriteria"))
        .timeout(REQUEST_TIMEOUT)
        .header("User-Agent", crate::yahoo::YAHOO_USER_AGENT)
        .header("Accept", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("KAP {kind} isteği: {error}"))?;

    // Hata durumunda dizi yerine {"success":false,...} zarfı döner; decode
    // hatası olarak yüzeye çıkar.
    response
        .json::<Vec<DisclosureRow>>()
        .await
        .map_err(|error| format!("KAP {kind} yanıtı çözümlenemedi: {error}"))
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
        .stock_codes
        .as_deref()
        .and_then(|codes| codes.split(',').next())
        .map(|code| code.trim().to_uppercase())
        .filter(|code| !code.is_empty() && code != "-")
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
        fetch_by_criteria(client, "members", d(6), today),
        fetch_by_criteria(client, "members", d(13), d(7)),
        fetch_by_criteria(client, "members", d(20), d(14)),
        fetch_by_criteria(client, "members", d(27), d(21)),
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
        .filter(|row| {
            row.stock_codes
                .as_deref()
                .is_some_and(|codes| codes.split(',').any(|c| c.trim() == code))
        })
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
        fetch_by_criteria(client, "funds", today - day(13), today),
        fetch_by_criteria(client, "funds", today - day(27), today - day(14)),
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
}
