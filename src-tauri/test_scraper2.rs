use std::env;

#[tokio::main]
async fn main() {
    let client = reqwest::Client::new();
    // In order to call scrape_recent_ipos, we can't easily compile it as a standalone script because it depends on ipo_scraper.rs and scraper crate.
    // Let's just fetch halkarz.com and count how many "article.index-list" there are.
    let resp = client.get("https://halkarz.com/").send().await.unwrap();
    let html = resp.text().await.unwrap();
    let document = scraper::Html::parse_document(&html);
    let sel = scraper::Selector::parse("article.index-list").unwrap();
    let count = document.select(&sel).count();
    println!("Found {} items", count);
}
