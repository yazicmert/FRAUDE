use serde::Serialize;
use reqwest::Client;
use std::error::Error;

#[derive(Clone, Debug, Serialize)]
pub struct SpkBulletin {
    pub title: String,
    pub date: String,
    pub url: String,
}

pub async fn fetch_latest_bulletins(client: &Client) -> Result<Vec<SpkBulletin>, Box<dyn Error + Send + Sync>> {
    let url = "https://spk.gov.tr/spk-bultenleri/2026-yili-spk-bultenleri";
    
    let response = client
        .get(url)
        .header("User-Agent", crate::yahoo::YAHOO_USER_AGENT)
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(format!("SPK request failed with status: {}", response.status()).into());
    }

    let html = response.text().await?;
    let mut bulletins = Vec::new();

    // Parse blocks like:
    // <a href="https://spk.gov.tr/data/6a4e8ea28f95db2724466880/2026-44.pdf" class="link">
    // ...
    //   <div class="liste-baslik">Bülten No : 2026/44</div>
    //   <div class="liste-icerik  overflow-hidden-2">Yayımlanma : 08 Temmuz 2026 Çarşamba</div>
    
    let re_item = regex::Regex::new(r#"(?is)<a href="([^"]+\.pdf)"[^>]*>.*?<div class="liste-baslik[^"]*">\s*(.*?)\s*</div>.*?<div class="liste-icerik[^>]*>\s*(?:<[^>]*>\s*)*Yayımlanma :\s*(.*?)\s*</div>"#).unwrap();

    for cap in re_item.captures_iter(&html) {
        let url = cap[1].trim().to_string();
        let title = cap[2].trim().replace("&#199;", "Ç").replace("&#231;", "ç").replace("&#286;", "Ğ").replace("&#287;", "ğ").replace("&#304;", "İ").replace("&#305;", "ı").replace("&#214;", "Ö").replace("&#246;", "ö").replace("&#350;", "Ş").replace("&#351;", "ş").replace("&#220;", "Ü").replace("&#252;", "ü");
        let date = cap[3].trim().replace("&#199;", "Ç").replace("&#231;", "ç").replace("&#286;", "Ğ").replace("&#287;", "ğ").replace("&#304;", "İ").replace("&#305;", "ı").replace("&#214;", "Ö").replace("&#246;", "ö").replace("&#350;", "Ş").replace("&#351;", "ş").replace("&#220;", "Ü").replace("&#252;", "ü");

        // Skip non-bulletin PDFs
        if url.contains("STRATEJİK PLAN") || url.contains("Aydınlatma Metni") {
            continue;
        }

        bulletins.push(SpkBulletin {
            title,
            date,
            url,
        });
        
        if bulletins.len() >= 10 {
            break;
        }
    }

    Ok(bulletins)
}
