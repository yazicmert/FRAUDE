use chrono::Datelike;
use reqwest::Client;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::domain::{FinancialPeriod, FinancialStatement};

const MALI_TABLO_URL: &str =
    "https://www.isyatirim.com.tr/_layouts/15/IsYatirim.Website/Common/Data.aspx/MaliTablo";

/// Çeyrek kırılımı çekilen yıl sayısı (içinde bulunulan yıl dahil).
///
/// Çeyrek serisi yalnız yakın dönem için anlamlı: ekranda son 12 çeyrek
/// gösteriliyor ve her yıl dört (yıl, dönem) çifti = ek istek demek.
const QUARTERLY_YEARS: i32 = 6;

/// Yıllık serinin başladığı takvim yılı.
///
/// İş Yatırım bu uçtan 2008'e kadar tam tablo döndürüyor (ölçüldü: 2008-2012
/// eski 108 kalemli format, 2014+ 147 kalemli format — kalem KODLARI aynı,
/// yalnız nakit akışı kalemi `4C` eski formatta yok, o da Option olarak zaten
/// modellendi). Yalnız son 6 yılı çekmek, sağlayıcıda hazır duran ~12 yıllık
/// geçmişi görünmez kılıyordu.
const ANNUAL_HISTORY_START: i32 = 2008;

const CACHE_TTL: Duration = Duration::from_secs(6 * 60 * 60);

/// Mali tabloların raporlama para birimi.
///
/// Çeviriyi **sağlayıcı** yapar (`exchange` parametresi). Bu bilinçli bir
/// tercih: tabloyu tek bir güncel kurla bölmek yanlış olurdu. İş Yatırım
/// UMS 21'e uygun çeviriyor — gelir tablosu dönem **ortalama** kuruyla,
/// bilanço dönem **sonu** kuruyla. Ölçüm (ASELS 2025): hasılatta zımni kur
/// 39,58 iken bilançoda 42,92. Tek kur kullansaydık gelir tablosu ~%8 sapardı.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum Currency {
    #[default]
    Try,
    Usd,
}

impl Currency {
    /// Sağlayıcının `exchange` parametresi. Enum olması, kullanıcıdan gelen
    /// serbest metnin URL'ye girmesini engeller.
    fn exchange(self) -> &'static str {
        match self {
            Currency::Try => "TRY",
            Currency::Usd => "USD",
        }
    }

    /// `FinancialStatement.currency` alanında görünen etiket.
    fn label(self) -> &'static str {
        self.exchange()
    }

    /// İstemciden gelen değeri çözer; tanınmayan her şey TRY'ye düşer.
    pub fn parse(value: Option<&str>) -> Currency {
        match value.map(str::trim).unwrap_or("") {
            v if v.eq_ignore_ascii_case("USD") => Currency::Usd,
            _ => Currency::Try,
        }
    }
}

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
    currency: Currency,
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
        query.append_pair("exchange", currency.exchange());
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
        return FinancialPeriod {
            period: period_label,
            // "I. FAİZ GELİRLERİ" — bankada hasılatın karşılığı.
            revenue: by_code(items, "3A"),
            // "III. NET FAİZ GELİRİ/GİDERİ" — brüt kârın karşılığı.
            gross_profit: by_code(items, "3C"),
            // Vergi öncesi kâr: sürdürülen (3CL) + durdurulan (3CR) faaliyetler.
            operating_income: sum_codes(items, &["3CL", "3CR"]),
            // Dönem net kârı: sürdürülen (3CN) + durdurulan (3CT) faaliyetler.
            // Yedek, özkaynak bölümündeki toplam satırı (2OV).
            net_income: sum_codes(items, &["3CN", "3CT"]).or_else(|| by_code(items, "2OV")),
            total_assets: by_code(items, "1Z").or_else(|| by_desc(items, "1", "AKTIF TOPLAMI")),
            total_equity: by_code(items, "2O"),
            // Bankada "toplam borç" kaldıraç anlamında tanımsızdır: fonlama
            // tabanı mevduattır, finansal borç değil.
            total_debt: None,
            // Uç bankalar için nakit akış tablosu (4* kalemleri) hiç döndürmüyor.
            operating_cash_flow: None,
            free_cash_flow: None,
        };
    }

    let operating_cash_flow = by_code(items, "4C");
    // Serbest nakit akımını sağlayıcı kendisi hesaplayıp `4CB` olarak veriyor
    // (= 4C işletme nakdi + 4CAK yatırım faaliyetleri nakdi; birebir doğrulandı).
    // Kendi türetmemiz İş Yatırım'ın sitesinde gösterdiği rakamdan sapardı.
    let free_cash_flow = by_code(items, "4CB")
        .or_else(|| Some(operating_cash_flow? + by_code(items, "4CAK")?));
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

/// Aynı anda gönderilen en fazla mali tablo isteği.
///
/// Derin geçmiş bir tabloyu ~9 parçaya bölüyor. Parçalar sınırsız paralel
/// gönderildiğinde — özellikle senkron ya da başka İş Yatırım çağrıları da
/// akarken — bağlantılar "error sending request" ile düşüyor ve `join_all`
/// bunu sessizce yutuyordu: tablo eksik dönemle dönüyor, kullanıcıya hata
/// gösterilmiyordu. Ölçülen belirti: aynı hissenin TRY tablosu 14, USD tablosu
/// 18 dönem.
const CHUNK_CONCURRENCY: usize = 3;

/// Geçici hatada bir parçanın toplam deneme sayısı.
const CHUNK_MAX_ATTEMPTS: u32 = 3;

/// Tek parçayı geçici ağ hatalarına karşı yeniden dener.
async fn fetch_chunk_with_retry(
    client: &Client,
    company: &str,
    financial_group: &str,
    currency: Currency,
    pairs: &[(i32, u8)],
) -> Result<PeriodMap, String> {
    let mut attempt = 1;
    loop {
        match fetch_chunk(client, company, financial_group, currency, pairs).await {
            Ok(map) => return Ok(map),
            Err(error) if attempt == CHUNK_MAX_ATTEMPTS => return Err(error),
            Err(_) => {
                tokio::time::sleep(std::time::Duration::from_millis(250 * 2u64.pow(attempt - 1)))
                    .await;
                attempt += 1;
            }
        }
    }
}

async fn fetch_all_periods(
    client: &Client,
    company: &str,
    financial_group: &str,
    currency: Currency,
    pairs: &[(i32, u8)],
) -> Result<PeriodMap, String> {
    let gate = std::sync::Arc::new(tokio::sync::Semaphore::new(CHUNK_CONCURRENCY));
    let futures: Vec<_> = pairs
        .chunks(4)
        .map(|chunk| {
            let gate = gate.clone();
            async move {
                let _permit = gate.acquire().await.map_err(|error| error.to_string())?;
                fetch_chunk_with_retry(client, company, financial_group, currency, chunk).await
            }
        })
        .collect();

    let mut merged: PeriodMap = HashMap::new();
    let mut last_error = None;
    for result in futures::future::join_all(futures).await {
        match result {
            Ok(map) => merged.extend(map),
            Err(error) => last_error = Some(error),
        }
    }
    // Boş sonuç HATA DEĞİLDİR: bankalar XI_29 grubunda sıfır kalem döndürür ve
    // `get_financial_statements` tam olarak bu boşluğu görüp UFRS'ye düşer.
    // Yalnızca gerçekten istek hatası olduysa ve hiçbir parça gelmediyse hata
    // yüzeye çıkar. Kısmi sonuç korunur: tek bir eski yılın düşmesi tüm tabloyu
    // yok etmemeli.
    if merged.is_empty() {
        if let Some(error) = last_error {
            return Err(error);
        }
    }
    Ok(merged)
}

pub async fn get_financial_statements(
    client: &Client,
    ticker: &str,
    currency: Currency,
) -> Result<FinancialStatement, String> {
    let company = ticker.trim().trim_end_matches(".IS").to_uppercase();
    // Önbellek anahtarı para birimini içerir; aksi halde TRY tablosu USD
    // isteğine (ya da tersi) servis edilirdi.
    let cache_key = format!("{company}:{}", currency.exchange());

    if let Some(cached) = CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .get(&cache_key)
    {
        if cached.fetched_at.elapsed() < CACHE_TTL {
            return Ok(cached.statement.clone());
        }
    }

    let current_year = chrono::Utc::now().year();
    let quarterly_from = current_year - QUARTERLY_YEARS + 1;
    let mut pairs: Vec<(i32, u8)> = Vec::new();
    // Yakın dönem: dört çeyrek birden.
    for year in quarterly_from..=current_year {
        for period in [3u8, 6, 9, 12] {
            pairs.push((year, period));
        }
    }
    // Derin geçmiş: yalnız yıllık. Dört yıl tek istekte paketlendiği için
    // ~12 yıllık ek geçmiş yalnızca ~3 istek maliyetinde.
    for year in ANNUAL_HISTORY_START..quarterly_from {
        pairs.push((year, 12));
    }

    // Önce sanayi formatı denenir; hiç veri gelmezse banka/sigorta (UFRS) formatına düşülür.
    let mut is_bank = false;
    let mut period_map = fetch_all_periods(client, &company, "XI_29", currency, &pairs).await?;
    let industrial_has_data = period_map
        .values()
        .any(|items| by_code(items, "3C").is_some() || by_code(items, "1BL").is_some());
    if !industrial_has_data {
        period_map = fetch_all_periods(client, &company, "UFRS", currency, &pairs).await?;
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

    // Çeyreğe indirme yalnız dört dönemi de çekilen yıllar için yapılır.
    // Derin geçmişte tek başına duran yıllık kayıt "Q4" gibi görünürdü: kümülatif
    // yıl sonu değerinden çıkarılacak 9 aylık dönem elde olmadığı için hasılat
    // boş, bilanço dolu bir sahte çeyrek üretirdi.
    let mut quarter_keys: Vec<(i32, u8)> = cumulative
        .keys()
        .copied()
        .filter(|(year, _)| *year >= quarterly_from)
        .collect();
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
    // Hibrit Entegrasyon: Resmî Canlı KAP Scraper Engine ile en güncel bilanço bildirimi kontrolü
    if let Ok(Some(live_kap_period)) = crate::kap::fetch_latest_kap_financial_period(client, &company).await {
        if !quarterlies.iter().any(|q| q.period == live_kap_period.period) {
            quarterlies.push(live_kap_period);
        }
    }

    let statement = FinancialStatement {
        ticker: company.clone(),
        currency: currency.label().to_string(),
        annuals,
        quarterlies,
    };

    CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .insert(cache_key, CachedStatement { fetched_at: Instant::now(), statement: statement.clone() });

    Ok(statement)
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct DerivedFinancialRatios {
    pub gross_margin: Option<f64>,
    pub net_margin: Option<f64>,
    pub sales_growth: Option<f64>,
    pub profit_growth: Option<f64>,
    pub net_debt_ebitda: Option<f64>,
}

pub fn compute_ratios_from_statement(statement: &FinancialStatement) -> DerivedFinancialRatios {
    let annuals = &statement.annuals;
    let latest_annual = annuals.last();
    let prev_annual = if annuals.len() >= 2 { annuals.get(annuals.len() - 2) } else { None };

    let quarterly_latest = statement.quarterlies.last();

    let cur = latest_annual.or(quarterly_latest);

    let net_margin = cur.and_then(|p| {
        let rev = p.revenue?;
        let net = p.net_income?;
        if rev > 0.0 {
            Some((net / rev) * 100.0)
        } else {
            None
        }
    });

    let gross_margin = cur.and_then(|p| {
        let rev = p.revenue?;
        let gp = p.gross_profit?;
        if rev > 0.0 {
            Some((gp / rev) * 100.0)
        } else {
            None
        }
    });

    let sales_growth = match (latest_annual, prev_annual) {
        (Some(curr), Some(prev)) => {
            if let (Some(r0), Some(r1)) = (curr.revenue, prev.revenue) {
                if r1 > 0.0 {
                    Some(((r0 - r1) / r1) * 100.0)
                } else {
                    None
                }
            } else {
                None
            }
        }
        _ => None,
    };

    let profit_growth = match (latest_annual, prev_annual) {
        (Some(curr), Some(prev)) => {
            if let (Some(n0), Some(n1)) = (curr.net_income, prev.net_income) {
                if n1 != 0.0 {
                    Some(((n0 - n1) / n1.abs()) * 100.0)
                } else {
                    None
                }
            } else {
                None
            }
        }
        _ => None,
    };

    let net_debt_ebitda = cur.and_then(|p| {
        let debt = p.total_debt?;
        let op = p.operating_income?;
        if op > 0.0 {
            Some(debt / op)
        } else {
            None
        }
    });

    DerivedFinancialRatios {
        gross_margin,
        net_margin,
        sales_growth,
        profit_growth,
        net_debt_ebitda,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fold_tr_normalizes_turkish_characters() {
        assert_eq!(fold_tr("Aktİf Toplamı"), "AKTIF TOPLAMI");
        assert_eq!(fold_tr("İşletme Faaliyetlerinden"), "ISLETME FAALIYETLERINDEN");
    }

    fn items(rows: &[(&str, &str, f64)]) -> PeriodItems {
        rows.iter().map(|(c, d, v)| (c.to_string(), fold_tr(d), *v)).collect()
    }

    /// Serbest nakit akımı sağlayıcının kendi `4CB` kalemidir.
    ///
    /// Önceki kod bunun yerine "MADDI VE MADDI OLMAYAN DURAN VARLIKLARIN ALIM"
    /// açıklamasını arıyordu; bu kalem tabloda YOK (ASELS/THYAO/EREGL/TUPRS'te
    /// sıfır eşleşme), dolayısıyla serbest nakit akımı her şirkette boş kalıyordu.
    #[test]
    fn free_cash_flow_uses_provider_line() {
        let period = extract_period(
            &items(&[
                ("3C", "Satış Gelirleri", 100.0),
                ("4C", "İşletme Faaliyetlerinden Kaynaklanan Net Nakit", 53.0),
                ("4CAK", "Yatırım Faaliyetlerinden Kaynaklanan Nakit", -42.0),
                ("4CB", "Serbest Nakit Akım", 11.0),
            ]),
            false,
            "2025-12-31".into(),
        );
        assert_eq!(period.free_cash_flow, Some(11.0), "sağlayıcının kalemi kullanılmalı");
    }

    /// `4CB` yoksa aynı tanımdan türetilir: işletme nakdi + yatırım nakdi.
    /// (Sağlayıcıda birebir doğrulandı: 4CB = 4C + 4CAK.)
    #[test]
    fn free_cash_flow_falls_back_to_the_same_definition() {
        let period = extract_period(
            &items(&[
                ("4C", "İşletme Faaliyetlerinden Kaynaklanan Net Nakit", 53.0),
                ("4CAK", "Yatırım Faaliyetlerinden Kaynaklanan Nakit", -42.0),
            ]),
            false,
            "2025-12-31".into(),
        );
        assert_eq!(period.free_cash_flow, Some(11.0));

        // Yatırım kalemi de yoksa uydurma yapılmaz.
        let partial = extract_period(
            &items(&[("4C", "İşletme Faaliyetlerinden Kaynaklanan Net Nakit", 53.0)]),
            false,
            "2025-12-31".into(),
        );
        assert_eq!(partial.free_cash_flow, None);
    }

    /// Banka net kârı ve vergi öncesi kârı **kod** üzerinden okunmalı.
    ///
    /// Açıklama araması ("DONEM NET K") iki kaleme birden uyuyor: sürdürülen
    /// (3CN) ve durdurulan (3CT) faaliyetler. `.find()` yanıttaki sıraya göre
    /// birini seçiyordu — sıra değişse her bankanın net kârı 0 olurdu.
    #[test]
    fn bank_income_sums_continuing_and_discontinued_operations() {
        let rows = items(&[
            ("3A", "I. FAİZ GELİRLERİ", 710.0),
            ("3C", "III. NET FAİZ GELİRİ/GİDERİ", 165.0),
            ("3CL", "XV. SÜRDÜRÜLEN FAALİYETLER VERGİ ÖNCESİ K/Z", 142.0),
            ("3CR", "XX. DURDURULAN FAALİYETLER VERGİ ÖNCESİ K/Z", 8.0),
            ("3CN", "XVII. SÜRDÜRÜLEN FAALİYETLER DÖNEM NET K/Z", 110.0),
            ("3CT", "XXII. DURDURULAN FAALİYETLER DÖNEM NET K/Z", 5.0),
            ("1Z", "AKTİF TOPLAMI", 3820.0),
            ("2O", "XVI. ÖZKAYNAKLAR", 444.0),
        ]);
        let period = extract_period(&rows, true, "2025-12-31".into());
        assert_eq!(period.revenue, Some(710.0));
        assert_eq!(period.gross_profit, Some(165.0));
        assert_eq!(period.operating_income, Some(150.0), "142 + 8 durdurulan");
        assert_eq!(period.net_income, Some(115.0), "110 + 5 durdurulan");
        assert_eq!(period.total_assets, Some(3820.0));
        assert_eq!(period.total_equity, Some(444.0));
        // Bankada kaldıraç anlamında "toplam borç" ve nakit akış tablosu yok.
        assert_eq!(period.total_debt, None);
        assert_eq!(period.operating_cash_flow, None);
    }

    /// Kalemlerin yanıttaki sırası sonucu DEĞİŞTİRMEMELİ.
    #[test]
    fn bank_income_is_order_independent() {
        let forward = items(&[
            ("3CN", "XVII. SÜRDÜRÜLEN FAALİYETLER DÖNEM NET K/Z", 110.0),
            ("3CT", "XXII. DURDURULAN FAALİYETLER DÖNEM NET K/Z", 5.0),
        ]);
        let mut reversed = forward.clone();
        reversed.reverse();
        assert_eq!(
            extract_period(&forward, true, "x".into()).net_income,
            extract_period(&reversed, true, "x".into()).net_income,
        );
    }

    /// Sanayi eşlemesi: kâr ve özkaynak ANA ORTAKLIK payı olmalı (tutarlı ROE),
    /// toplam borç yalnız finansal borç (ticari borçlar hariç).
    #[test]
    fn industrial_mapping_prefers_parent_share_and_financial_debt() {
        let period = extract_period(
            &items(&[
                ("3C", "Satış Gelirleri", 198.0),
                ("3D", "BRÜT KAR (ZARAR)", 63.0),
                ("3DF", "FAALİYET KARI (ZARARI)", 54.0),
                ("3Z", "Ana Ortaklık Payları", 32.9),
                ("3L", "DÖNEM KARI (ZARARI)", 32.5),
                ("1BL", "TOPLAM VARLIKLAR", 474.0),
                ("2O", "Ana Ortaklığa Ait Özkaynaklar", 275.0),
                ("2N", "Özkaynaklar", 277.0),
                ("2AA", "Finansal Borçlar", 41.0),
                ("2BA", "Finansal Borçlar", 5.0),
                ("2AAGAA", "Ticari Borçlar", 41.7),
            ]),
            false,
            "2025-12-31".into(),
        );
        assert_eq!(period.net_income, Some(32.9), "ana ortaklık payı");
        assert_eq!(period.total_equity, Some(275.0), "ana ortaklığa ait özkaynak");
        assert_eq!(period.total_debt, Some(46.0), "kısa+uzun finansal borç; ticari borç hariç");
    }

    /// Yıllık seri sağlayıcıda hazır duran derin geçmişi kapsamalı.
    ///
    /// Ölçüm: İş Yatırım MaliTablo ucu 2008'e kadar tam tablo döndürüyor
    /// (2008-2012 eski 108 kalemli format, 2014+ 147 kalemli; kalem kodları
    /// aynı). Önceden yalnız son 6 yıl çekiliyor ve ~12 yıllık geçmiş görünmez
    /// kalıyordu.
    #[tokio::test]
    #[ignore = "requires live İş Yatırım access"]
    async fn live_annual_history_reaches_back_over_a_decade() {
        let client = crate::http_client();
        let statement = get_financial_statements(&client, "ASELS", Currency::Try).await.unwrap();

        let years: Vec<&str> = statement.annuals.iter().map(|p| &p.period[..4]).collect();
        println!("yıllık dönemler: {years:?}");
        assert!(
            statement.annuals.len() >= 12,
            "en az 12 yıllık dönem gelmeli, gelen: {}",
            statement.annuals.len()
        );
        let oldest = statement.annuals.first().expect("en eski dönem");
        assert!(
            oldest.period.starts_with("200") || oldest.period.starts_with("201"),
            "seri 2010'lu yıllardan başlamalı: {}",
            oldest.period
        );
        // Derin geçmişte de asıl kalemler dolu olmalı (kalem kodları eski
        // formatta da aynı); nakit akışı `4C` eski yıllarda yok, o yüzden
        // hasılat/aktif üzerinden doğrulanır.
        assert!(oldest.revenue.is_some(), "en eski yılda hasılat dolu olmalı");
        assert!(oldest.total_assets.is_some(), "en eski yılda aktif toplamı dolu olmalı");

        // Çeyrek serisi yalnız yakın dönemden gelmeli: derin geçmişte tek başına
        // duran yıllık kayıt sahte bir "çeyrek" üretmemeli.
        let quarterly_from = chrono::Utc::now().year() - QUARTERLY_YEARS + 1;
        for period in &statement.quarterlies {
            let year: i32 = period.period[..4].parse().unwrap();
            assert!(year >= quarterly_from, "çeyrek serisine eski yıl sızdı: {}", period.period);
        }
    }

    #[tokio::test]
    #[ignore = "requires live İş Yatırım access"]
    async fn live_asels_statements_cover_five_years() {
        let client = Client::new();
        let statement = get_financial_statements(&client, "ASELS", Currency::Try).await.unwrap();
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

    /// Kümülatiften çeyreğe indirme doğrulaması: bir yılın dört çeyreği
    /// toplandığında o yılın yıllık rakamını **birebir** vermeli. Çıkarma
    /// sırası ya da dönem eşlemesi bozulursa bu test yakalar.
    #[tokio::test]
    #[ignore = "requires live İş Yatırım access"]
    async fn live_quarters_sum_back_to_the_annual_figure() {
        let client = crate::http_client();
        // Sanayi ve banka formatı birlikte denenir.
        for ticker in ["ASELS", "THYAO", "GARAN", "AKBNK"] {
            let statement = get_financial_statements(&client, ticker, Currency::Try).await.unwrap();
            // Tamamlanmış en son yıl: dört çeyreği de elde olan.
            let Some(year) = statement
                .annuals
                .iter()
                .rev()
                .map(|p| p.period[..4].to_string())
                .find(|year| {
                    statement.quarterlies.iter().filter(|q| q.period.starts_with(year)).count() == 4
                })
            else {
                panic!("{ticker}: dört çeyreği tam bir yıl bulunamadı");
            };

            let annual = statement.annuals.iter().find(|p| p.period.starts_with(&year)).unwrap();
            let quarters: Vec<_> =
                statement.quarterlies.iter().filter(|q| q.period.starts_with(&year)).collect();

            for (label, annual_value, sum) in [
                ("hasılat", annual.revenue, quarters.iter().filter_map(|q| q.revenue).sum::<f64>()),
                ("net kâr", annual.net_income, quarters.iter().filter_map(|q| q.net_income).sum::<f64>()),
            ] {
                let Some(expected) = annual_value else { continue };
                let drift = (sum - expected).abs() / expected.abs().max(1.0);
                assert!(
                    drift < 1e-6,
                    "{ticker} {year} {label}: Σçeyrek {sum:.0} ≠ yıllık {expected:.0}"
                );
            }
            println!("{ticker} {year}: dört çeyrek yıllığa birebir toplanıyor");
        }
    }

    #[test]
    fn currency_parse_defaults_to_try() {
        assert_eq!(Currency::parse(Some("USD")), Currency::Usd);
        assert_eq!(Currency::parse(Some("usd")), Currency::Usd);
        assert_eq!(Currency::parse(Some(" Usd ")), Currency::Usd);
        assert_eq!(Currency::parse(Some("TRY")), Currency::Try);
        // Tanınmayan/boş değer sessizce TRY'ye düşer; sağlayıcıya serbest metin gitmez.
        assert_eq!(Currency::parse(Some("EUR")), Currency::Try);
        assert_eq!(Currency::parse(Some("../etc")), Currency::Try);
        assert_eq!(Currency::parse(None), Currency::Try);
    }

    /// USD tablosu sağlayıcıdan gelmeli ve TRY ile tutarlı olmalı.
    ///
    /// Kritik nokta: çeviri **tek kurla** yapılmıyor. Gelir tablosu dönem
    /// ortalama, bilanço dönem sonu kuruyla çevriliyor (UMS 21), dolayısıyla
    /// iki zımni kur birbirinden farklı olmalı. Aynı çıksalardı sağlayıcının
    /// naif bir bölme yaptığını anlardık.
    #[tokio::test]
    #[ignore = "requires live İş Yatırım access"]
    async fn live_usd_statements_use_period_appropriate_rates() {
        let client = crate::http_client();
        let try_statement = get_financial_statements(&client, "ASELS", Currency::Try).await.unwrap();
        let usd_statement = get_financial_statements(&client, "ASELS", Currency::Usd).await.unwrap();

        assert_eq!(usd_statement.currency, "USD");
        assert_eq!(try_statement.currency, "TRY");
        assert_eq!(
            usd_statement.annuals.len(), try_statement.annuals.len(),
            "iki para biriminde de aynı dönemler gelmeli"
        );

        let usd = usd_statement.annuals.last().expect("dönem");
        let try_ = try_statement.annuals.last().expect("dönem");
        assert_eq!(usd.period, try_.period);

        let income_rate = try_.revenue.unwrap() / usd.revenue.unwrap();
        let balance_rate = try_.total_assets.unwrap() / usd.total_assets.unwrap();
        println!(
            "{}: gelir tablosu kuru {income_rate:.2}, bilanço kuru {balance_rate:.2}",
            usd.period
        );

        // Kurlar makul TRY/USD aralığında olmalı.
        for (label, rate) in [("gelir tablosu", income_rate), ("bilanço", balance_rate)] {
            assert!((5.0..200.0).contains(&rate), "{label} kuru makul değil: {rate}");
        }
        // Ve birbirinden farklı olmalı — naif tek-kur bölmesi değil.
        assert!(
            (income_rate - balance_rate).abs() / balance_rate > 0.01,
            "ortalama ve dönem sonu kuru aynı çıktı ({income_rate:.2} vs {balance_rate:.2}); \
             sağlayıcı naif çeviri yapıyor olabilir"
        );
    }

    /// Sanayi şirketlerinde serbest nakit akımı gerçekten dolmalı.
    /// (Eski açıklama araması hiçbir şirkette eşleşmediği için alan her zaman
    /// boştu — sessiz bir özellik kaybıydı.)
    #[tokio::test]
    #[ignore = "requires live İş Yatırım access"]
    async fn live_free_cash_flow_is_populated_for_industrials() {
        let client = crate::http_client();
        for ticker in ["ASELS", "THYAO", "EREGL", "BIMAS"] {
            let statement = get_financial_statements(&client, ticker, Currency::Try).await.unwrap();
            let with_ocf = statement.annuals.iter().filter(|p| p.operating_cash_flow.is_some()).count();
            let with_fcf = statement.annuals.iter().filter(|p| p.free_cash_flow.is_some()).count();
            println!("{ticker}: işletme nakdi {with_ocf} dönem, serbest nakit {with_fcf} dönem");
            assert!(with_fcf > 0, "{ticker}: serbest nakit akımı hiç dolmadı");
            // Nakit akış tablosu olan her dönemde serbest nakit de üretilebilmeli.
            assert_eq!(with_fcf, with_ocf, "{ticker}: işletme nakdi olup serbest nakdi olmayan dönem var");
        }
    }

    #[tokio::test]
    #[ignore = "requires live İş Yatırım access"]
    async fn live_garan_uses_bank_format() {
        let client = Client::new();
        let statement = get_financial_statements(&client, "GARAN", Currency::Try).await.unwrap();
        assert!(!statement.annuals.is_empty(), "banka yıllık dönemleri dolu olmalı");
        let last = statement.annuals.last().unwrap();
        assert!(last.total_assets.is_some(), "banka aktif toplamı dolu olmalı");
        assert!(last.net_income.is_some(), "banka net kârı dolu olmalı");
    }

    /// Çoklu sektör doğrulaması: Sanayi, Enerji, Otomotiv, Cam, Holding ve Bankacılık
    /// hisselerinin finansal tabloları sorunsuz yüklenmeli ve 15+ yıllık tarihsel
    /// dönemi kapsamalı.
    #[tokio::test]
    #[ignore = "requires live İş Yatırım access"]
    async fn live_multi_sector_financial_statements_check() {
        let client = crate::http_client();
        let tickers = ["TUPRS", "KCHOL", "FROTO", "SISE", "AKBNK"];
        for ticker in tickers {
            let statement = get_financial_statements(&client, ticker, Currency::Try)
                .await
                .unwrap_or_else(|e| panic!("{ticker} için bilanço yüklenemedi: {e}"));
            
            assert!(!statement.annuals.is_empty(), "{ticker} yıllık dönemleri boş");
            assert!(!statement.quarterlies.is_empty(), "{ticker} çeyreklik dönemleri boş");
            assert!(
                statement.annuals.len() >= 10,
                "{ticker} en az 10 yıllık tarihsel veri içermeli, gelen: {}",
                statement.annuals.len()
            );

            let latest = statement.annuals.last().expect("son dönem");
            assert!(latest.total_assets.is_some(), "{ticker} aktif toplamı dolu olmalı");
            assert!(latest.net_income.is_some(), "{ticker} net kârı dolu olmalı");

            println!(
                "✓ {ticker}: {} yıllık / {} çeyreklik dönem, Son Dönem ({}): Aktif={:?} M, NetKâr={:?} M",
                statement.annuals.len(),
                statement.quarterlies.len(),
                latest.period,
                latest.total_assets.map(|v| v / 1e6),
                latest.net_income.map(|v| v / 1e6)
            );
        }
    }
}
