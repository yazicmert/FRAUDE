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

    let html = resp.text().await?;
    let mut applications = Vec::new();
    let re_row = regex::Regex::new(
        r#"(?is)<tr[^>]*>\s*<td[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>"#
    ).unwrap();

    for cap in re_row.captures_iter(&html) {
        let name = decode_entities(&cap[1]).trim().to_string();
        let date = decode_entities(&cap[2]).trim().to_string();
        if name.contains("Şirket") || name.contains("Unvan") || name.is_empty() {
            continue;
        }
        applications.push(SpkApplication {
            company_name: name,
            application_date: date,
            status: "SPK_APPLICATION".to_string(),
            source: "SPK".to_string(),
        });
    }

    Ok(applications)
}

#[derive(Clone, Debug, Serialize, serde::Deserialize)]
pub struct SpkIpoApproval {
    pub company_name: String,
    pub ticker: Option<String>,
    pub capital_increase_lots: f64,
    pub share_sale_lots: f64,
    pub total_lots: f64,
    pub price: f64,
    pub ipo_size_tl: f64,
    pub consortium_lead: Option<String>,
    pub bulletin_no: String,
    pub approval_date: String,
}

pub fn parse_spk_ipo_table(html: &str, bulletin_no: &str, approval_date: &str) -> Vec<SpkIpoApproval> {
    let mut approvals = Vec::new();
    let re_row = regex::Regex::new(
        r#"(?is)<tr[^>]*>\s*<td[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>"#
    ).unwrap();

    for cap in re_row.captures_iter(html) {
        let col1 = decode_entities(&cap[1]).trim().to_string();
        if col1.contains("Şirket") || col1.contains("Unvan") || col1.is_empty() {
            continue;
        }
        let cap_increase = parse_turkish_num(&cap[3]);
        let share_sale = parse_turkish_num(&cap[4]);
        let price = parse_turkish_num(&cap[5]);
        if price > 0.0 || cap_increase > 0.0 || share_sale > 0.0 {
            let total_lots = cap_increase + share_sale;
            let ipo_size_tl = total_lots * price;
            approvals.push(SpkIpoApproval {
                company_name: col1,
                ticker: None,
                capital_increase_lots: cap_increase,
                share_sale_lots: share_sale,
                total_lots,
                price,
                ipo_size_tl,
                consortium_lead: None,
                bulletin_no: bulletin_no.to_string(),
                approval_date: approval_date.to_string(),
            });
        }
    }
    approvals
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

fn parse_turkish_num(s: &str) -> f64 {
    let clean = decode_entities(s).replace(".", "").replace(",", ".").replace("TL", "").replace("₺", "").trim().to_string();
    clean.parse::<f64>().unwrap_or(0.0)
}

/// Listede tutulan en fazla bülten.
const BULLETIN_LIMIT: usize = 10;

fn year_url(year: i32) -> String {
    format!("https://spk.gov.tr/spk-bultenleri/{year}-yili-spk-bultenleri")
}

/// Tek bir yıl sayfasını çeker ve ayrıştırır. Sayfa yoksa (SPK yeni yıl
/// sayfasını henüz açmamışsa 302 döner) boş liste verir — hata değildir.
async fn fetch_year(client: &Client, year: i32) -> Result<Vec<SpkBulletin>, Box<dyn Error + Send + Sync>> {
    let response = client
        .get(year_url(year))
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

    let current = fetch_year(client, year).await?;
    if !current.is_empty() {
        return Ok(current);
    }

    let previous = fetch_year(client, year - 1).await?;
    if previous.is_empty() {
        return Err(format!("SPK bülten listesi {year} ve {} için boş döndü.", year - 1).into());
    }
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
        if bulletins.len() >= BULLETIN_LIMIT {
            break;
        }
    }
    bulletins
}

#[cfg(test)]
mod tests {
    use super::*;

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
            // Ham HTML varlığı sızmamalı.
            assert!(!row.title.contains("&#"), "başlıkta çözülmemiş varlık: {}", row.title);
        }
        println!("son bülten: {} · {}", rows[0].title, rows[0].date);
    }
}
