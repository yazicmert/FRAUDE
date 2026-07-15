import re

with open("src/ipo_scraper.rs", "r") as f:
    code = f.read()

new_fn = """pub async fn scrape_recent_ipos(client: &Client) -> Result<Vec<ScrapedIpo>, Box<dyn std::error::Error + Send + Sync>> {
    let url = "https://halkarz.com/";
    let resp = client.get(url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .timeout(Duration::from_secs(15))
        .send().await?;
        
    if !resp.status().is_success() {
        return Err(format!("Failed to fetch halkarz.com: HTTP {}", resp.status()).into());
    }
    
    let html = resp.text().await?;
    let semaphore = Arc::new(Semaphore::new(10));
    let mut tasks = Vec::new();
    
    let document = Html::parse_document(&html);
    let active_selector = Selector::parse("ul.halka-arz-list:not(.taslak) article.index-list").unwrap();
    let taslak_selector = Selector::parse("ul.halka-arz-list.taslak article.index-list").unwrap();

    let process_row = |row: scraper::ElementRef, is_taslak: bool| -> Option<tokio::task::JoinHandle<Result<ScrapedIpo, String>>> {
        let ticker_selector = Selector::parse("span.il-bist-kod").unwrap();
        let name_selector = Selector::parse("h3.il-halka-arz-sirket a").unwrap();
        let date_selector = Selector::parse("time").unwrap();
        let badge_selector = Selector::parse("div.il-badge").unwrap();

        let ticker = row.select(&ticker_selector).next().map(|el| el.text().collect::<String>().trim().to_string())?;
        let name = row.select(&name_selector).next().map(|el| el.text().collect::<String>().trim().to_string())?;

        let date_el = row.select(&date_selector).next();
        let raw_date = if let Some(el) = date_el {
            el.inner_html().trim().to_string()
        } else {
            "Hazırlanıyor...".to_string()
        };
        
        let ipo_date = parse_turkish_date(&raw_date);

        let badge = row.select(&badge_selector).next();
        let mut status = "TALEP TOPLAMA".to_string();
        
        if is_taslak {
            status = "TASLAK".to_string();
        } else if raw_date.contains("Hazırlanıyor") || raw_date.contains("Taslak") || raw_date.contains("Onay") {
            status = "TASLAK".to_string();
        } else if let Some(badge_el) = badge {
            let class = badge_el.value().attr("class").unwrap_or("");
            let title = badge_el.value().attr("title").unwrap_or("");
            let inner = badge_el.inner_html().trim().to_lowercase();
            if class.contains("fa-check") || title.contains("tamamlandı") || title.contains("sonuçları") || inner.contains("tamamlandı") || inner.contains("sonuç") {
                status = "TAMAMLANDI".to_string();
            } else {
                status = "AKTİF".to_string();
            }
        }

        let detail_link = row.select(&name_selector).next().and_then(|el| el.value().attr("href"));
        let detail_url = detail_link.map(|l| l.to_string());

        if let Some(detail_url) = detail_url {
            let c = client.clone();
            let ticker = ticker.clone();
            let name = name.clone();
            let ipo_date = ipo_date.clone();
            let status = status.clone();
            let permit = semaphore.clone();
            
            Some(tokio::spawn(async move {
                let _permit = permit.acquire().await.unwrap();
                let mut price = 0.0;
                let mut book_building_dates = None;
                let mut trading_start_date = None;
                let mut distribution_type = None;
                let mut participant_count = None;

                if let Ok(res) = c.get(&detail_url)
                    .header("User-Agent", "Mozilla/5.0")
                    .timeout(Duration::from_secs(15))
                    .send().await {
                    if let Ok(detail_html) = res.text().await {
                        let detail_doc = Html::parse_document(&detail_html);
                        
                        let price_selector = Selector::parse("strong.f700").unwrap();
                        for p_el in detail_doc.select(&price_selector) {
                            let text = p_el.text().collect::<String>();
                            if text.contains("TL") {
                                let cleaned = text.replace(" TL", "").replace(" ", "").replace(",", ".");
                                if let Ok(val) = cleaned.parse::<f64>() {
                                    price = val;
                                    break;
                                }
                            }
                        }

                        let sp_tr_selector = Selector::parse(".sp-table tr").unwrap();
                        let em_selector = Selector::parse("em").unwrap();
                        let td_selector = Selector::parse("td").unwrap();
                        
                        for tr in detail_doc.select(&sp_tr_selector) {
                            let label = tr.select(&em_selector).next().map(|e| e.text().collect::<String>()).unwrap_or_default();
                            let tds: Vec<_> = tr.select(&td_selector).collect();
                            if tds.len() >= 2 {
                                let val = tds[1].text().collect::<String>().trim().to_string();
                                let clean_val = val.replace("**", "").trim().to_string();
                                
                                if label.contains("Halka Arz Tarihi") {
                                    book_building_dates = Some(clean_val);
                                } else if label.contains("Bist İlk İşlem Tarihi") {
                                    trading_start_date = Some(clean_val);
                                } else if label.contains("Dağıtım Yöntemi") {
                                    distribution_type = Some(clean_val);
                                }
                            }
                        }

                        let as_tr_selector = Selector::parse(".as-table tr").unwrap();
                        for tr in detail_doc.select(&as_tr_selector) {
                            let text = tr.text().collect::<String>();
                            if text.contains("Toplam") {
                                let tds: Vec<_> = tr.select(&td_selector).collect();
                                if tds.len() >= 2 {
                                    let val = tds[1].text().collect::<String>().trim().to_string();
                                    let clean_val = val.replace(" Kişi", "").replace(" Müşteri", "").replace("**", "").trim().to_string();
                                    participant_count = Some(clean_val);
                                }
                            }
                        }
                    }
                }

                Ok(ScrapedIpo {
                    ticker,
                    name,
                    ipo_date,
                    price,
                    status,
                    book_building_dates,
                    trading_start_date,
                    distribution_type,
                    participant_count,
                })
            }))
        } else {
            Some(tokio::spawn(async move {
                Ok(ScrapedIpo {
                    ticker,
                    name,
                    ipo_date,
                    price: 0.0,
                    status,
                    book_building_dates: None,
                    trading_start_date: None,
                    distribution_type: None,
                    participant_count: None,
                })
            }))
        }
    };

    for row in document.select(&active_selector) {
        if let Some(task) = process_row(row, false) {
            tasks.push(task);
        }
    }
    
    for row in document.select(&taslak_selector) {
        if let Some(task) = process_row(row, true) {
            tasks.push(task);
        }
    }

    let mut scraped = Vec::new();
    for res in join_all(tasks).await {
        if let Ok(Ok(ipo)) = res {
            scraped.push(ipo);
        }
    }
    
    Ok(scraped)
}
"""

new_code = re.sub(r'pub async fn scrape_recent_ipos\(client: &Client\) -> Result<Vec<ScrapedIpo>, Box<dyn std::error::Error \+ Send \+ Sync>> \{.*$', new_fn, code, flags=re.DOTALL)

with open("src/ipo_scraper.rs", "w") as f:
    f.write(new_code)
