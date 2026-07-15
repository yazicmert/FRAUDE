use reqwest::Client;

#[tokio::main]
async fn main() {
    let client = Client::new();
    let url = "https://halkarz.com/";
    match client.get(url).header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36").send().await {
        Ok(res) => println!("halkarz.com Status: {}", res.status()),
        Err(e) => println!("halkarz.com Error: {}", e),
    }

    let url2 = "https://www.isyatirim.com.tr/tr-tr/analiz/hisse/Sayfalar/halka-arz-olan-sirketler.aspx";
    match client.get(url2).header("User-Agent", "Mozilla/5.0").send().await {
        Ok(res) => println!("isyatirim.com.tr Status: {}", res.status()),
        Err(e) => println!("isyatirim.com.tr Error: {}", e),
    }
}
