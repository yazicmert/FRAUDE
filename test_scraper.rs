#[tokio::main]
async fn main() {
    let client = reqwest::Client::new();
    let res = tauri_app::ipo_scraper::scrape_recent_ipos(&client).await;
    match res {
        Ok(ipos) => {
            for ipo in ipos {
                println!("{} - {}", ipo.ticker, ipo.status);
            }
        }
        Err(e) => println!("Error: {}", e),
    }
}
