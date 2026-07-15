//! Borsa İstanbul resmi tatil takvimi. Tarihler Nager.Date açık API'sinden
//! (ülke bazlı resmi tatiller, dini bayramlar dahil, ücretsiz/keysiz) çekilir.
//! Frontend bu listeyi bir kez alıp yerel önbelleğe yazar ve piyasa açık/kapalı
//! rozetinde kullanır; ağ yoksa frontend'in gömülü yedek takvimi devreye girer.
//!
//! Nager.Date TR verisi Ramazan/Kurban gibi hicri bayramları da doğru tarihlerle
//! ve Türkçe adlarıyla döndürür, böylece sabit-kod tahmine gerek kalmaz.

use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

/// İçinde bulunulan yıldan itibaren kaç yıllık tatil çekileceği.
const YEARS_AHEAD: i32 = 2;
const CACHE_TTL: Duration = Duration::from_secs(12 * 60 * 60);

#[derive(Deserialize)]
struct NagerHoliday {
    date: String,
    #[serde(rename = "localName")]
    local_name: String,
}

/// Frontend'e dönen sade tatil kaydı.
#[derive(Clone, Serialize)]
pub struct MarketHoliday {
    /// Europe/Istanbul yerel tarihi, YYYY-MM-DD.
    pub date: String,
    /// Türkçe bayram adı (ör. "Demokrasi ve Millî Birlik Günü").
    pub name: String,
}

static CACHE: OnceLock<Mutex<Option<(Instant, Vec<MarketHoliday>)>>> = OnceLock::new();

fn cached() -> Option<Vec<MarketHoliday>> {
    let cache = CACHE.get_or_init(|| Mutex::new(None));
    let cache = cache.lock().unwrap_or_else(|error| error.into_inner());
    cache
        .as_ref()
        .filter(|(fetched_at, _)| fetched_at.elapsed() < CACHE_TTL)
        .map(|(_, rows)| rows.clone())
}

async fn fetch_year(client: &reqwest::Client, year: i32) -> Result<Vec<MarketHoliday>, String> {
    let url = format!("https://date.nager.at/api/v3/PublicHolidays/{year}/TR");
    let rows = client
        .get(url)
        .timeout(Duration::from_secs(10))
        .header("User-Agent", crate::yahoo::YAHOO_USER_AGENT)
        .send()
        .await
        .map_err(|error| format!("Tatil takvimi isteği başarısız ({year}): {error}"))?
        .error_for_status()
        .map_err(|error| format!("Tatil takvimi yanıtı ({year}): {error}"))?
        .json::<Vec<NagerHoliday>>()
        .await
        .map_err(|error| format!("Tatil takvimi çözümlenemedi ({year}): {error}"))?;
    Ok(rows
        .into_iter()
        .map(|row| MarketHoliday { date: row.date, name: row.local_name })
        .collect())
}

/// İçinde bulunulan yıl ve sonraki `YEARS_AHEAD-1` yılın BIST resmi tatillerini
/// döndürür. Ağ hatasında boş liste döner (frontend gömülü yedeğe düşer).
pub async fn get_holidays(client: &reqwest::Client) -> Vec<MarketHoliday> {
    if let Some(rows) = cached() {
        return rows;
    }

    let current_year = chrono::Utc::now().format("%Y").to_string().parse::<i32>().unwrap_or(2026);
    let mut all = Vec::new();
    for year in current_year..(current_year + YEARS_AHEAD) {
        match fetch_year(client, year).await {
            Ok(mut rows) => all.append(&mut rows),
            // Bir yıl gelmezse diğer yılları yine döndür; hiçbiri gelmezse boş.
            Err(_) => continue,
        }
    }

    if !all.is_empty() {
        *CACHE.get_or_init(|| Mutex::new(None)).lock().unwrap_or_else(|error| error.into_inner()) =
            Some((Instant::now(), all.clone()));
    }
    all
}
