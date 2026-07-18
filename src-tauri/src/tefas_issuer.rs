//! Fon kurucusunun (portföy yönetim şirketi) KAP kaydı.
//!
//! TEFAS fonun kurucusunu ayrı bir alanda vermez; yalnızca unvanın içinde geçer
//! (ör. "ATA PORTFÖY PARA PİYASASI (TL) FONU" → "ATA PORTFÖY"). Unvandan kurucu
//! adı çıkarılıp KAP'ın üye arama ucunda aranır; bulunan kayıt şirketin KAP
//! sayfasına ve oradan da internet adresine götürür.
//!
//! KAP uçları çerezsiz çalışır ve bot-challenge arkasında değildir.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};

const MEMBER_SEARCH_URL: &str = "https://www.kap.org.tr/tr/api/member/filter";
const COMPANY_PAGE_URL: &str = "https://www.kap.org.tr/tr/sirket-bilgileri/genel";

/// Fon kurucusunun KAP künyesi.
#[derive(Clone, Debug, Serialize)]
pub struct FundIssuer {
    /// KAP'taki resmi unvan.
    pub name: String,
    /// Kurucunun KAP şirket sayfası.
    pub kap_url: String,
    /// Kurucunun internet adresi; KAP künyesinde yoksa None.
    pub website: Option<String>,
}

#[derive(Deserialize)]
struct KapMember {
    title: String,
    #[serde(rename = "permaLink")]
    perma_link: String,
}

/// Kurucu adı → künye. Aynı kurucunun onlarca fonu olduğundan tekrar tekrar
/// sorgulamak yerine süreç boyunca saklanır.
static CACHE: OnceLock<Mutex<HashMap<String, Option<FundIssuer>>>> = OnceLock::new();

fn cache() -> &'static Mutex<HashMap<String, Option<FundIssuer>>> {
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Fon unvanından kurucu adını çıkarır.
///
/// TEFAS unvanları "<KURUCU> PORTFÖY <fon adı> FONU" kalıbındadır; kurucu adı
/// "PORTFÖY" kelimesiyle biter. Kalıba uymayan unvanlarda None döner.
fn issuer_name(fund_name: &str) -> Option<String> {
    let upper = fund_name.to_uppercase();
    let index = upper.find("PORTFÖY")?;
    let name = upper[..index + "PORTFÖY".len()].trim();
    (!name.is_empty()).then(|| name.to_string())
}

/// KAP künyesindeki internet adresini çeker.
///
/// KAP sayfası Next.js RSC yükü taşır; adres `kpy41_acc1_int_addres` anahtarının
/// yanında düz metin olarak bulunur.
async fn website(client: &reqwest::Client, perma_link: &str) -> Option<String> {
    let html = client
        .get(format!("{COMPANY_PAGE_URL}/{perma_link}"))
        .timeout(Duration::from_secs(15))
        .header("User-Agent", crate::yahoo::YAHOO_USER_AGENT)
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()?;

    // RSC yükünde tırnaklar `\"` biçiminde kaçışlıdır; anahtar ile değeri
    // ayıran `\",\"value\":\"` dizisi bu yüzden gevşek geçilir.
    let pattern = regex::Regex::new(r#"kpy41_acc1_int_addres.*?value\\?":\\?"([^"\\]+)"#).ok()?;
    let address = pattern.captures(&html)?.get(1)?.as_str().trim().to_string();
    (!address.is_empty()).then_some(address)
}

/// Fon unvanına karşılık gelen kurucunun KAP künyesini döndürür.
pub async fn lookup(client: &reqwest::Client, fund_name: &str) -> Option<FundIssuer> {
    let issuer = issuer_name(fund_name)?;

    if let Some(hit) = cache().lock().unwrap_or_else(|e| e.into_inner()).get(&issuer) {
        return hit.clone();
    }

    let found = resolve(client, &issuer).await;
    cache()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(issuer, found.clone());
    found
}

async fn resolve(client: &reqwest::Client, issuer: &str) -> Option<FundIssuer> {
    // Kurucu adı boşluk ve Türkçe karakter taşır; yol parçası olarak eklenince
    // yüzde kodlaması reqwest tarafından yapılır.
    let mut url = reqwest::Url::parse(MEMBER_SEARCH_URL).ok()?;
    url.path_segments_mut().ok()?.push(issuer);

    let members = client
        .get(url)
        .timeout(Duration::from_secs(15))
        .header("User-Agent", crate::yahoo::YAHOO_USER_AGENT)
        .header("Accept", "application/json")
        .send()
        .await
        .ok()?
        .json::<Vec<KapMember>>()
        .await
        .ok()?;

    // Arama isim geçişine göre çalışır; kurucu adını içeren ilk kayıt alınır.
    let member = members
        .into_iter()
        .find(|m| m.title.to_uppercase().contains(issuer))?;

    Some(FundIssuer {
        website: website(client, &member.perma_link).await,
        kap_url: format!("{COMPANY_PAGE_URL}/{}", member.perma_link),
        name: member.title,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_issuer_from_fund_title() {
        assert_eq!(
            issuer_name("ATA PORTFÖY PARA PİYASASI (TL) FONU").as_deref(),
            Some("ATA PORTFÖY")
        );
        assert_eq!(
            issuer_name("İŞ PORTFÖY BIST 30 ENDEKSİ HİSSE SENEDİ FONU").as_deref(),
            Some("İŞ PORTFÖY")
        );
        // Çok kelimeli kurucu adı bozulmamalı.
        assert_eq!(
            issuer_name("QNB FİNANS PORTFÖY BİRİNCİ SERBEST FON").as_deref(),
            Some("QNB FİNANS PORTFÖY")
        );
        // Kalıba uymayan unvan sessizce elenir.
        assert_eq!(issuer_name("BİLİNMEYEN FON"), None);
    }

    /// Canlı uç: kurucu KAP'ta bulunur ve künyesinde internet adresi vardır.
    #[tokio::test]
    #[ignore = "canlı ağ erişimi gerektirir"]
    async fn resolves_issuer_from_kap() {
        let client = reqwest::Client::new();
        let issuer = lookup(&client, "ATA PORTFÖY PARA PİYASASI (TL) FONU")
            .await
            .expect("kurucu bulunmalı");
        println!("{} | {} | {:?}", issuer.name, issuer.kap_url, issuer.website);
        assert!(issuer.name.contains("ATA PORTFÖY"));
        assert!(issuer.kap_url.starts_with("https://www.kap.org.tr/"));
        assert_eq!(issuer.website.as_deref(), Some("www.ataportfoy.com.tr"));
    }
}
