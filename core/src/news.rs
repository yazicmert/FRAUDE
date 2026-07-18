use crate::domain::NewsItem;
use reqwest::Client;
use std::error::Error;
use std::time::Duration;

const RSS_URL: &str = "https://www.ntv.com.tr/ekonomi.rss";

pub async fn fetch_news(client: &Client) -> Result<Vec<NewsItem>, Box<dyn Error + Send + Sync>> {
    let response = client
        .get(RSS_URL)
        .timeout(Duration::from_secs(10))
        .send()
        .await?;

    let bytes = response.bytes().await?;
    let channel = rss::Channel::read_from(&bytes[..])?;

    let mut news_items = Vec::new();

    for item in channel.items() {
        let title = item.title().unwrap_or("No title").to_string();
        let link = item.link().unwrap_or("").to_string();
        let pub_date = item.pub_date().unwrap_or("").to_string();
        
        let description = item.description().unwrap_or("").to_string();

        let news = NewsItem {
            title,
            link,
            pub_date,
            source: "NTV Ekonomi".to_string(),
            summary: Some(description),
            ticker: None,
            is_kap: false,
            tags: Vec::new(),
            sector_tags: Vec::new(),
        };

        news_items.push(news);

        if news_items.len() >= 20 {
            break; // Limit to 20 latest news
        }
    }

    Ok(news_items)
}
