use chrono::Datelike;
use reqwest::Client;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::domain::{EquityRow, FinancialPeriod, FinancialStatement};

const MALI_TABLO_URL: &str =
    "https://www.isyatirim.com.tr/_layouts/15/IsYatirim.Website/Common/Data.aspx/MaliTablo";
/// Kaç takvim yılı geriye gidileceği; son 5 tam yıl + içinde bulunulan yıl.
const YEARS_BACK: i32 = 6;
const CACHE_TTL: Duration = Duration::from_secs(6 * 60 * 60);

#[derive(Debug, Deserialize)]
struct MaliTabloEnvelope {
    value: Option<Vec<MaliTabloItem>>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MaliTabloItem {
    item_code: Option<String>,
    item_desc_tr: Option<String>,
    value1: Option<serde_json::Value>,
    value2: Option<serde_json::Value>,
    value3: Option<serde_json::Value>,
    value4: Option<serde_json::Value>,
}

/// Tek bir bilanço dönemine ait kalemler: (kalem kodu, sadeleştirilmiş açıklama, değer).
type PeriodItems = Vec<(String, String, f64)>;
type PeriodMap = HashMap<(i32, u8), PeriodItems>;

struct CachedStatement {
    fetched_at: Instant,
    statement: FinancialStatement,
}

static CACHE: OnceLock<Mutex<HashMap<String, CachedStatement>>> = OnceLock::new();

pub async fn enrich_equity(_client: &Client, row: EquityRow) -> EquityRow {
    row
}

/// Türkçe karakterleri ASCII'ye indirger ve büyük harfe çevirir; İş Yatırım
/// kalem açıklamaları karışık büyük/küçük harf ve İ/ı içerdiğinden eşleştirme
/// bu sadeleştirilmiş biçim üzerinden yapılır.
fn fold_tr(input: &str) -> String {
    input
        .chars()
        .map(|character| match character {
            'ç' | 'Ç' => 'C',
            'ğ' | 'Ğ' => 'G',
            'ı' | 'İ' | 'i' => 'I',
            'ö' | 'Ö' => 'O',
            'ş' | 'Ş' => 'S',
            'ü' | 'Ü' => 'U',
            other => other.to_ascii_uppercase(),
        })
        .collect()
}

fn parse_value(value: &Option<serde_json::Value>) -> Option<f64> {
    match value.as_ref()? {
        serde_json::Value::Number(number) => number.as_f64(),
        serde_json::Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                trimmed.replace(',', ".").parse::<f64>().ok()
            }
        }
        _ => None,
    }
}

/// Dört (yıl, dönem) çiftini tek istekte çeker ve dönem başına kalem listesi döndürür.
async fn fetch_chunk(
    client: &Client,
    company: &str,
    financial_group: &str,
    pairs: &[(i32, u8)],
) -> Result<PeriodMap, String> {
    if pairs.is_empty() {
        return Ok(HashMap::new());
    }
    // API her zaman dört dönem parametresi bekler; eksik kalan sütunlar ilk
    // dönemin tekrarıyla doldurulur ve aynı anahtara yazıldığından zararsızdır.
    let padded: Vec<(i32, u8)> = (0..4).map(|i| pairs[i.min(pairs.len() - 1)]).collect();

    let mut url = reqwest::Url::parse(MALI_TABLO_URL).map_err(|error| error.to_string())?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("companyCode", company);
        query.append_pair("exchange", "TRY");
        query.append_pair("financialGroup", financial_group);
        for (index, (year, period)) in padded.iter().enumerate() {
            query.append_pair(&format!("year{}", index + 1), &year.to_string());
            query.append_pair(&format!("period{}", index + 1), &period.to_string());
        }
    }

    let envelope = client
        .get(url)
        .timeout(Duration::from_secs(12))
        .header("User-Agent", crate::yahoo::YAHOO_USER_AGENT)
        .header(
            "Referer",
            "https://www.isyatirim.com.tr/tr-tr/analiz/hisse/Sayfalar/sirket-karti.aspx",
        )
        .send()
        .await
        .map_err(|error| format!("İş Yatırım mali tablo isteği başarısız: {error}"))?
        .error_for_status()
        .map_err(|error| format!("İş Yatırım mali tablo yanıtı: {error}"))?
        .json::<MaliTabloEnvelope>()
        .await
        .map_err(|error| format!("İş Yatırım mali tablo çözümlenemedi: {error}"))?;

    let mut map: PeriodMap = HashMap::new();
    for item in envelope.value.unwrap_or_default() {
        let code = item.item_code.clone().unwrap_or_default();
        let desc = fold_tr(item.item_desc_tr.as_deref().unwrap_or("").trim());
        let values = [&item.value1, &item.value2, &item.value3, &item.value4];
        for (index, raw) in values.iter().enumerate() {
            if let Some(number) = parse_value(raw) {
                map.entry(padded[index])
                    .or_default()
                    .push((code.clone(), desc.clone(), number));
            }
        }
    }
    Ok(map)
}

fn by_code(items: &PeriodItems, code: &str) -> Option<f64> {
    items
        .iter()
        .find(|(item_code, _, _)| item_code == code)
        .map(|(_, _, value)| *value)
}

fn by_desc(items: &PeriodItems, code_prefix: &str, needle: &str) -> Option<f64> {
    items
        .iter()
        .find(|(code, desc, _)| code.starts_with(code_prefix) && desc.contains(needle))
        .map(|(_, _, value)| *value)
}

fn sum_codes(items: &PeriodItems, codes: &[&str]) -> Option<f64> {
    let values: Vec<f64> = codes.iter().filter_map(|code| by_code(items, code)).collect();
    if values.is_empty() {
        None
    } else {
        Some(values.iter().sum())
    }
}

/// Tek dönemin kümülatif değerlerini FinancialPeriod'a çevirir.
/// Sanayi (XI_29) şirketlerinde kalem kodları sabittir; bankalarda (UFRS)
/// faiz gelirleri hasılat, net faiz geliri brüt kâr karşılığı olarak okunur.
fn extract_period(items: &PeriodItems, is_bank: bool, period_label: String) -> FinancialPeriod {
    if is_bank {
        let operating_cash_flow = by_code(items, "4C")
            .or_else(|| by_desc(items, "4", "ISLETME FAALIYETLERINDEN"));
        return FinancialPeriod {
            period: period_label,
            revenue: by_code(items, "3A"),
            gross_profit: by_code(items, "3C"),
            operating_income: by_code(items, "3CL").or_else(|| by_desc(items, "3", "VERGI ONCESI")),
            net_income: by_desc(items, "3", "DONEM NET K").or_else(|| by_code(items, "2OV")),
            total_assets: by_code(items, "1Z").or_else(|| by_desc(items, "1", "AKTIF TOPLAMI")),
            total_equity: by_code(items, "2O"),
            total_debt: None,
            operating_cash_flow,
            free_cash_flow: None,
        };
    }

    let operating_cash_flow = by_code(items, "4C");
    let capex = by_desc(items, "4", "MADDI VE MADDI OLMAYAN DURAN VARLIKLARIN ALIM");
    let free_cash_flow = match (operating_cash_flow, capex) {
        // Nakit çıkışları tabloda işaretli gelir; pozitifse mutlak değeri düşülür.
        (Some(ocf), Some(spend)) => Some(if spend < 0.0 { ocf + spend } else { ocf - spend }),
        _ => None,
    };
    FinancialPeriod {
        period: period_label,
        revenue: by_code(items, "3C"),
        gross_profit: by_code(items, "3D"),
        operating_income: by_code(items, "3DF"),
        net_income: by_code(items, "3Z").or_else(|| by_code(items, "3L")),
        total_assets: by_code(items, "1BL"),
        total_equity: by_code(items, "2O").or_else(|| by_code(items, "2N")),
        total_debt: sum_codes(items, &["2AA", "2BA"]),
        operating_cash_flow,
        free_cash_flow,
    }
}

fn period_label(year: i32, period: u8) -> String {
    let (month, day) = match period {
        3 => ("03", "31"),
        6 => ("06", "30"),
        9 => ("09", "30"),
        _ => ("12", "31"),
    };
    format!("{year}-{month}-{day}")
}

fn has_data(period: &FinancialPeriod) -> bool {
    period.revenue.is_some() || period.net_income.is_some() || period.total_assets.is_some()
}

fn subtract(current: Option<f64>, previous: Option<f64>, is_first_quarter: bool) -> Option<f64> {
    match (current, previous) {
        (Some(cur), Some(prev)) => Some(cur - prev),
        (Some(cur), None) if is_first_quarter => Some(cur),
        _ => None,
    }
}

/// Gelir tablosu ve nakit akışı kalemleri yıl içinde kümülatif raporlanır;
/// çeyrek bazına indirmek için aynı yılın önceki dönemi düşülür.
fn to_quarterly(current: &FinancialPeriod, previous: Option<&FinancialPeriod>, period: u8) -> FinancialPeriod {
    let first = period == 3;
    FinancialPeriod {
        period: current.period.clone(),
        revenue: subtract(current.revenue, previous.and_then(|p| p.revenue), first),
        gross_profit: subtract(current.gross_profit, previous.and_then(|p| p.gross_profit), first),
        operating_income: subtract(current.operating_income, previous.and_then(|p| p.operating_income), first),
        net_income: subtract(current.net_income, previous.and_then(|p| p.net_income), first),
        total_assets: current.total_assets,
        total_equity: current.total_equity,
        total_debt: current.total_debt,
        operating_cash_flow: subtract(current.operating_cash_flow, previous.and_then(|p| p.operating_cash_flow), first),
        free_cash_flow: subtract(current.free_cash_flow, previous.and_then(|p| p.free_cash_flow), first),
    }
}

async fn fetch_all_periods(
    client: &Client,
    company: &str,
    financial_group: &str,
    pairs: &[(i32, u8)],
) -> Result<PeriodMap, String> {
    let futures: Vec<_> = pairs
        .chunks(4)
        .map(|chunk| fetch_chunk(client, company, financial_group, chunk))
        .collect();
    let mut merged: PeriodMap = HashMap::new();
    let mut last_error = None;
    for result in futures::future::join_all(futures).await {
        match result {
            Ok(map) => merged.extend(map),
            Err(error) => last_error = Some(error),
        }
    }
    if merged.is_empty() {
        if let Some(error) = last_error {
            return Err(error);
        }
    }
    Ok(merged)
}

pub async fn get_financial_statements(client: &Client, ticker: &str) -> Result<FinancialStatement, String> {
    let company = ticker.trim().trim_end_matches(".IS").to_uppercase();

    if let Some(cached) = CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .get(&company)
    {
        if cached.fetched_at.elapsed() < CACHE_TTL {
            return Ok(cached.statement.clone());
        }
    }

    let current_year = chrono::Utc::now().year();
    let mut pairs: Vec<(i32, u8)> = Vec::new();
    for year in (current_year - YEARS_BACK + 1)..=current_year {
        for period in [3u8, 6, 9, 12] {
            pairs.push((year, period));
        }
    }

    // Önce sanayi formatı denenir; hiç veri gelmezse banka/sigorta (UFRS) formatına düşülür.
    let mut is_bank = false;
    let mut period_map = fetch_all_periods(client, &company, "XI_29", &pairs).await?;
    let industrial_has_data = period_map
        .values()
        .any(|items| by_code(items, "3C").is_some() || by_code(items, "1BL").is_some());
    if !industrial_has_data {
        period_map = fetch_all_periods(client, &company, "UFRS", &pairs).await?;
        is_bank = true;
    }

    let mut cumulative: HashMap<(i32, u8), FinancialPeriod> = HashMap::new();
    for (key, items) in &period_map {
        let extracted = extract_period(items, is_bank, period_label(key.0, key.1));
        if has_data(&extracted) {
            cumulative.insert(*key, extracted);
        }
    }

    if cumulative.is_empty() {
        return Err(format!("{company} için İş Yatırım'da mali tablo verisi bulunamadı."));
    }

    let mut annual_keys: Vec<i32> = cumulative.keys().filter(|(_, p)| *p == 12).map(|(y, _)| *y).collect();
    annual_keys.sort_unstable();
    let annuals: Vec<FinancialPeriod> = annual_keys
        .iter()
        .filter_map(|year| cumulative.get(&(*year, 12)).cloned())
        .collect();

    let mut quarter_keys: Vec<(i32, u8)> = cumulative.keys().copied().collect();
    quarter_keys.sort_unstable();
    let mut quarterlies: Vec<FinancialPeriod> = quarter_keys
        .iter()
        .map(|(year, period)| {
            let current = &cumulative[&(*year, *period)];
            let previous = if *period > 3 { cumulative.get(&(*year, period - 3)) } else { None };
            to_quarterly(current, previous, *period)
        })
        .filter(has_data)
        .collect();
    let keep_from = quarterlies.len().saturating_sub(12);
    quarterlies.drain(..keep_from);

    let statement = FinancialStatement {
        ticker: company.clone(),
        currency: "TRY".to_string(),
        annuals,
        quarterlies,
    };

    CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .insert(company, CachedStatement { fetched_at: Instant::now(), statement: statement.clone() });

    Ok(statement)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fold_tr_normalizes_turkish_characters() {
        assert_eq!(fold_tr("Aktİf Toplamı"), "AKTIF TOPLAMI");
        assert_eq!(fold_tr("İşletme Faaliyetlerinden"), "ISLETME FAALIYETLERINDEN");
    }

    #[tokio::test]
    #[ignore = "requires live İş Yatırım access"]
    async fn live_asels_statements_cover_five_years() {
        let client = Client::new();
        let statement = get_financial_statements(&client, "ASELS").await.unwrap();
        println!(
            "yıllık: {:?}",
            statement.annuals.iter().map(|p| (&p.period, p.revenue)).collect::<Vec<_>>()
        );
        println!(
            "çeyrek: {:?}",
            statement.quarterlies.iter().map(|p| (&p.period, p.revenue, p.net_income)).collect::<Vec<_>>()
        );
        assert!(statement.annuals.len() >= 4, "en az 4 yıllık dönem: {}", statement.annuals.len());
        assert!(statement.quarterlies.len() >= 6, "en az 6 çeyrek: {}", statement.quarterlies.len());
        assert!(statement.annuals.iter().all(|p| p.revenue.is_some()), "yıllık hasılat dolu olmalı");
        let last = statement.annuals.last().unwrap();
        let margin = last.net_income.unwrap() / last.revenue.unwrap() * 100.0;
        assert!(margin.abs() < 100.0, "net marj makul olmalı: {margin}");
    }

    #[tokio::test]
    #[ignore = "requires live İş Yatırım access"]
    async fn live_garan_uses_bank_format() {
        let client = Client::new();
        let statement = get_financial_statements(&client, "GARAN").await.unwrap();
        assert!(!statement.annuals.is_empty(), "banka yıllık dönemleri dolu olmalı");
        let last = statement.annuals.last().unwrap();
        assert!(last.total_assets.is_some(), "banka aktif toplamı dolu olmalı");
        assert!(last.net_income.is_some(), "banka net kârı dolu olmalı");
    }
}
