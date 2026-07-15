use reqwest::Client;
use serde_json::json;
use crate::domain::NewsTag;

pub async fn generate_tags_for_news(client: &Client, api_key: &str, title: &str, content: &str) -> Result<Vec<NewsTag>, Box<dyn std::error::Error + Send + Sync>> {
    let prompt = format!(
        "You are a financial AI assistant. Read the following news article and extract tags for BIST (Istanbul Stock Exchange) companies affected by it. Return ONLY a JSON array of objects with the following schema:
[{{ \"ticker\": \"THYAO\", \"confidence\": 0.9, \"sentiment\": \"POSITIVE\", \"reason\": \"Because they ordered new planes.\" }}]

Title: {}
Content: {}", title, content
    );

    let request_body = json!({
        "model": "gemini-1.5-flash",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1
    });

    // Dummy logic for now, or real API call using google gemini endpoint
    // Fallback:
    let mut tags = Vec::new();
    tags.push(NewsTag {
        ticker: "TEST".to_string(),
        confidence: 0.95,
        sentiment: "POSITIVE".to_string(),
        reason: "Test reason".to_string()
    });

    Ok(tags)
}
