use reqwest::Client;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;
use futures::future::join_all;
use tokio::sync::Semaphore;

const LISTING_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MAX_YEAR_PAGES: u32 = 8;
const DETAIL_CONCURRENCY: usize = 10;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScrapedIpo {
    pub ticker: String,
    pub name: String,
    pub ipo_date: String,
    pub price: f64,
    pub status: String,
    pub book_building_dates: Option<String>,
    pub trading_start_date: Option<String>,
    pub distribution_type: Option<String>,
    pub participant_count: Option<String>,
}

/// Liste sayfasından okunan, detay sayfası henüz gezilmemiş kayıt.
#[derive(Debug, Clone)]
pub struct ListedIpo {
    pub ticker: String,
    pub name: String,
    pub ipo_date: String,
    pub status: String,
    pub detail_url: Option<String>,
}

#[derive(Debug, Default, Clone)]
struct DetailData {
    price: f64,
    book_building_dates: Option<String>,
    trading_start_date: Option<String>,
    distribution_type: Option<String>,
    participant_count: Option<String>,
}

fn current_year_string() -> String {
    chrono::Local::now().format("%Y").to_string()
}

fn parse_turkish_date(date_str: &str) -> String {
    let months = [
        ("ocak", "01"), ("şubat", "02"), ("subat", "02"), ("mart", "03"),
        ("nisan", "04"), ("mayıs", "05"), ("mayis", "05"), ("haziran", "06"),
        ("temmuz", "07"), ("ağustos", "08"), ("agustos", "08"), ("eylül", "09"),
        ("eylul", "09"), ("ekim", "10"), ("kasım", "11"), ("kasim", "11"),
        ("aralık", "12"), ("aralik", "12")
    ];

    let parts: Vec<&str> = date_str.split_whitespace().collect();

    for i in (0..parts.len()).rev() {
        let p_lower = parts[i].to_lowercase();
        for (tr, num) in months.iter() {
            if p_lower.contains(tr) {
                let month = num;

                let year = if i + 1 < parts.len() {
                    let y: String = parts[i+1].chars().filter(|c| c.is_ascii_digit()).collect();
                    if y.len() == 4 { y } else { current_year_string() }
                } else {
                    current_year_string()
                };

                let day = if i > 0 {
                    let d = parts[i-1];
                    let d_last = if d.contains('-') {
                        d.split('-').last().unwrap_or("01")
                    } else {
                        d
                    };
                    let d_clean: String = d_last.chars().filter(|c| c.is_ascii_digit()).collect();
                    if d_clean.len() == 1 { format!("0{}", d_clean) }
                    else if d_clean.is_empty() { "01".to_string() }
                    else { d_clean }
                } else {
                    "01".to_string()
                };

                return format!("{}-{}-{}", year, month, day);
            }
        }
    }

    date_str.to_string()
}

/// "20,50 TL" veya "20,00 - 22,00 TL" gibi metinlerden fiyat çıkarır.
fn parse_price_text(text: &str) -> Option<f64> {
    let cleaned = text.replace(" TL", "").replace(' ', "").replace(',', ".");
    if let Ok(val) = cleaned.parse::<f64>() {
        return Some(val);
    }
    // Fiyat aralığı verilmişse ilk sayıyı al
    for token in cleaned.split('-') {
        if let Ok(val) = token.parse::<f64>() {
            return Some(val);
        }
    }
    None
}

/// Bir liste sayfasındaki (ana sayfa veya yıl arşivi) tüm halka arz
/// kayıtlarını ayrıştırır. Saf fonksiyondur; ağ erişimi yapmaz.
///
/// `assume_completed`: yıl arşivi sayfalarında makalelerde tarih (`<time>`)
/// ve durum rozeti bulunmaz; bu bayrakla kayıtlar TAMAMLANDI sayılır ve
/// tarih detay sayfasından doldurulmak üzere boş bırakılır.
pub fn parse_listing(html: &str, assume_completed: bool) -> Vec<ListedIpo> {
    let document = Html::parse_document(html);
    let active_selector = Selector::parse("ul.halka-arz-list:not(.taslak) article.index-list").unwrap();
    let taslak_selector = Selector::parse("ul.halka-arz-list.taslak article.index-list").unwrap();
    // Ana sayfada span.il-bist-kod, yıl arşivinde h2.il-bist-kod kullanılıyor
    let ticker_selector = Selector::parse(".il-bist-kod").unwrap();
    let name_selector = Selector::parse("h3.il-halka-arz-sirket a").unwrap();
    let date_selector = Selector::parse("time").unwrap();
    let badge_selector = Selector::parse("div.il-badge").unwrap();

    let mut listed = Vec::new();
    let mut seen = HashSet::new();

    let mut process = |row: scraper::ElementRef, is_taslak: bool| {
        let ticker = match row.select(&ticker_selector).next() {
            Some(el) => el.text().collect::<String>().trim().to_string(),
            None => return,
        };
        let name = match row.select(&name_selector).next() {
            Some(el) => el.text().collect::<String>().trim().to_string(),
            None => return,
        };
        if ticker.is_empty() || !seen.insert(ticker.clone()) {
            return;
        }

        let raw_date = row.select(&date_selector).next()
            .map(|el| el.inner_html().trim().to_string());

        if assume_completed {
            let ipo_date = raw_date.as_deref().map(parse_turkish_date).unwrap_or_default();
            let detail_url = row.select(&name_selector).next()
                .and_then(|el| el.value().attr("href"))
                .map(|l| l.to_string());
            listed.push(ListedIpo {
                ticker,
                name,
                ipo_date,
                status: "TAMAMLANDI".to_string(),
                detail_url,
            });
            return;
        }

        let raw_date = raw_date.unwrap_or_else(|| "Hazırlanıyor...".to_string());
        let ipo_date = parse_turkish_date(&raw_date);

        let mut status = "TALEP TOPLAMA".to_string();
        if is_taslak {
            status = "TASLAK".to_string();
        } else if raw_date.contains("Hazırlanıyor") || raw_date.contains("Taslak") || raw_date.contains("Onay") {
            status = "TASLAK".to_string();
        } else if let Some(badge_el) = row.select(&badge_selector).next() {
            let class = badge_el.value().attr("class").unwrap_or("");
            let title = badge_el.value().attr("title").unwrap_or("");
            let inner_html = badge_el.inner_html();
            let inner = inner_html.to_lowercase();
            // Rozet ikonu iç elemanda olabildiği için hem class hem içerik kontrol edilir
            if class.contains("fa-check") || title.contains("tamamlandı") || title.contains("sonuçları")
                || inner.contains("tamamlandı") || inner.contains("sonuç") || inner.contains("fa-check") {
                status = "TAMAMLANDI".to_string();
            } else {
                status = "AKTİF".to_string();
            }
        }

        let detail_url = row.select(&name_selector).next()
            .and_then(|el| el.value().attr("href"))
            .map(|l| l.to_string());

        listed.push(ListedIpo { ticker, name, ipo_date, status, detail_url });
    };

    for row in document.select(&active_selector) {
        process(row, false);
    }
    for row in document.select(&taslak_selector) {
        process(row, true);
    }

    listed
}

/// Şirket detay sayfasından fiyat, talep toplama tarihi, ilk işlem tarihi,
/// dağıtım yöntemi ve katılımcı sayısını ayrıştırır. Saf fonksiyondur.
fn parse_detail(html: &str) -> DetailData {
    let doc = Html::parse_document(html);
    let mut data = DetailData::default();

    let price_selector = Selector::parse("strong.f700").unwrap();
    for p_el in doc.select(&price_selector) {
        let text = p_el.text().collect::<String>();
        if text.contains("TL") {
            if let Some(val) = parse_price_text(&text) {
                data.price = val;
                break;
            }
        }
    }

    let sp_tr_selector = Selector::parse(".sp-table tr").unwrap();
    let em_selector = Selector::parse("em").unwrap();
    let td_selector = Selector::parse("td").unwrap();

    for tr in doc.select(&sp_tr_selector) {
        let label = tr.select(&em_selector).next().map(|e| e.text().collect::<String>()).unwrap_or_default();
        let tds: Vec<_> = tr.select(&td_selector).collect();
        if tds.len() >= 2 {
            let val = tds[1].text().collect::<String>().trim().to_string();
            let clean_val = val.replace("**", "").trim().to_string();

            if label.contains("Halka Arz Tarihi") {
                data.book_building_dates = Some(clean_val);
            } else if label.contains("Bist İlk İşlem Tarihi") {
                data.trading_start_date = Some(clean_val);
            } else if label.contains("Dağıtım Yöntemi") {
                data.distribution_type = Some(clean_val);
            }
        }
    }

    let as_tr_selector = Selector::parse(".as-table tr").unwrap();
    for tr in doc.select(&as_tr_selector) {
        let text = tr.text().collect::<String>();
        if text.contains("Toplam") {
            let tds: Vec<_> = tr.select(&td_selector).collect();
            if tds.len() >= 2 {
                let val = tds[1].text().collect::<String>().trim().to_string();
                let clean_val = val.replace(" Kişi", "").replace(" Müşteri", "").replace("**", "").trim().to_string();
                data.participant_count = Some(clean_val);
            }
        }
    }

    data
}

/// Liste kayıtlarını ScrapedIpo'ya dönüştürür; `skip_details` içindeki
/// ticker'lar için detay sayfası çekilmez (arşivde detayları zaten tam olan
/// kayıtlar için gereksiz istekten kaçınmak amacıyla).
async fn resolve_details(
    client: &Client,
    listed: Vec<ListedIpo>,
    skip_details: &HashSet<String>,
) -> Vec<ScrapedIpo> {
    let semaphore = Arc::new(Semaphore::new(DETAIL_CONCURRENCY));
    let mut tasks = Vec::new();

    for item in listed {
        let fetch_url = if skip_details.contains(&item.ticker) {
            None
        } else {
            item.detail_url.clone()
        };
        let client = client.clone();
        let permit = semaphore.clone();

        tasks.push(tokio::spawn(async move {
            let mut detail = DetailData::default();
            if let Some(url) = fetch_url {
                let _permit = permit.acquire().await.ok()?;
                if let Ok(res) = client.get(&url)
                    .header("User-Agent", LISTING_USER_AGENT)
                    .timeout(Duration::from_secs(15))
                    .send().await {
                    if let Ok(html) = res.text().await {
                        detail = parse_detail(&html);
                    }
                }
            }
            // Liste sayfasında tarih yoksa (yıl arşivi) detaydaki ilk işlem
            // veya talep toplama tarihinden türet
            let mut ipo_date = item.ipo_date;
            if !crate::ipo_store::looks_like_iso_date(&ipo_date) {
                for candidate in [&detail.trading_start_date, &detail.book_building_dates] {
                    if let Some(raw) = candidate {
                        let parsed = parse_turkish_date(raw);
                        if crate::ipo_store::looks_like_iso_date(&parsed) {
                            ipo_date = parsed;
                            break;
                        }
                    }
                }
            }

            Some(ScrapedIpo {
                ticker: item.ticker,
                name: item.name,
                ipo_date,
                price: detail.price,
                status: item.status,
                book_building_dates: detail.book_building_dates,
                trading_start_date: detail.trading_start_date,
                distribution_type: detail.distribution_type,
                participant_count: detail.participant_count,
            })
        }));
    }

    let mut scraped = Vec::new();
    for res in join_all(tasks).await {
        if let Ok(Some(ipo)) = res {
            scraped.push(ipo);
        }
    }
    scraped
}

async fn fetch_listing_html(client: &Client, url: &str) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let resp = client.get(url)
        .header("User-Agent", LISTING_USER_AGENT)
        .timeout(Duration::from_secs(15))
        .send().await?;
    if !resp.status().is_success() {
        return Err(format!("Failed to fetch {}: HTTP {}", url, resp.status()).into());
    }
    Ok(resp.text().await?)
}

/// Ana sayfadaki güncel halka arz listesini (aktif + taslak) detaylarıyla çeker.
pub async fn scrape_recent_ipos(client: &Client) -> Result<Vec<ScrapedIpo>, Box<dyn std::error::Error + Send + Sync>> {
    let html = fetch_listing_html(client, "https://halkarz.com/").await?;
    let listed = parse_listing(&html, false);
    Ok(resolve_details(client, listed, &HashSet::new()).await)
}

/// Bir yılın arşiv sayfalarını (halkarz.com/k/halka-arz/{yıl}/) gezerek o yılın
/// halka arzlarını döndürür. `skip_details` içindeki ticker'ların detay
/// sayfası atlanır; sayfalar tükenince veya MAX_YEAR_PAGES'e ulaşınca durur.
pub async fn scrape_year_archive(
    client: &Client,
    year: i32,
    skip_details: &HashSet<String>,
) -> Vec<ScrapedIpo> {
    let mut all_listed: Vec<ListedIpo> = Vec::new();
    let mut seen = HashSet::new();

    for page in 1..=MAX_YEAR_PAGES {
        let url = if page == 1 {
            format!("https://halkarz.com/k/halka-arz/{}/", year)
        } else {
            format!("https://halkarz.com/k/halka-arz/{}/page/{}/", year, page)
        };

        let html = match fetch_listing_html(client, &url).await {
            Ok(html) => html,
            Err(_) => break,
        };

        let listed = parse_listing(&html, true);
        let mut new_count = 0;
        for item in listed {
            if seen.insert(item.ticker.clone()) {
                all_listed.push(item);
                new_count += 1;
            }
        }
        // Yeni kayıt gelmiyorsa sayfalama bitti demektir
        if new_count == 0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(400)).await;
    }

    resolve_details(client, all_listed, skip_details).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_full_turkish_date() {
        assert_eq!(parse_turkish_date("3 Temmuz 2026"), "2026-07-03");
        assert_eq!(parse_turkish_date("13 Aralık 2024"), "2024-12-13");
    }

    #[test]
    fn parses_date_range_using_last_day() {
        assert_eq!(parse_turkish_date("10-11 Temmuz 2025"), "2025-07-11");
    }

    #[test]
    fn missing_year_falls_back_to_current_year() {
        let year = current_year_string();
        assert_eq!(parse_turkish_date("5 Ekim"), format!("{year}-10-05"));
    }

    #[test]
    fn unparseable_text_is_returned_unchanged() {
        assert_eq!(parse_turkish_date("Hazırlanıyor..."), "Hazırlanıyor...");
    }

    #[test]
    fn single_digit_day_is_zero_padded() {
        assert_eq!(parse_turkish_date("7 Mart 2027"), "2027-03-07");
    }

    #[test]
    fn price_text_parses_single_and_range() {
        assert_eq!(parse_price_text("20,50 TL"), Some(20.5));
        assert_eq!(parse_price_text("20,00 - 22,00 TL"), Some(20.0));
        assert_eq!(parse_price_text("fiyat yok"), None);
    }

    #[test]
    fn listing_snapshot_parses_entries() {
        // Depodaki gerçek halkarz.com anlık görüntüsüyle ayrıştırıcıyı doğrula
        let html = include_str!("../halkarz.html");
        let listed = parse_listing(html, false);
        assert!(listed.len() > 20, "snapshot should yield many entries, got {}", listed.len());
        assert!(listed.iter().any(|l| l.ticker == "SARAE"));
        let sarae = listed.iter().find(|l| l.ticker == "SARAE").unwrap();
        assert_eq!(sarae.ipo_date, "2026-07-10");
        assert!(sarae.detail_url.is_some());
        // Taslak bölümü de ayrıştırılmalı
        assert!(listed.iter().any(|l| l.status == "TASLAK"));
    }
}
