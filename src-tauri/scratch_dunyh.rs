use serde::Deserialize;
use std::error::Error;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let url = "https://query1.finance.yahoo.com/v8/finance/chart/DUNYH.IS?range=6mo&interval=1d";
    let client = reqwest::Client::new();
    let resp = client.get(url).header("User-Agent", "Mozilla/5.0").send().await?.text().await?;
    println!("{}", resp);
    Ok(())
}
