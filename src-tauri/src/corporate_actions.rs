use crate::domain::{DividendRecord, CapitalIncrease, IpoRecord, EquityRow};
use crate::yahoo::YAHOO_USER_AGENT;
use serde::Deserialize;

#[derive(Deserialize)]
struct YahooChartResponse {
    chart: Option<YahooChart>,
}

#[derive(Deserialize)]
struct YahooChart {
    result: Option<Vec<YahooChartResult>>,
}

#[derive(Deserialize)]
struct YahooChartResult {
    timestamp: Option<Vec<i64>>,
    indicators: Option<YahooIndicators>,
    events: Option<YahooEvents>,
}

#[derive(Deserialize)]
struct YahooIndicators {
    quote: Option<Vec<YahooQuote>>,
}

#[derive(Deserialize)]
struct YahooQuote {
    close: Option<Vec<Option<f64>>>,
}

#[derive(Deserialize)]
struct YahooEvents {
    dividends: Option<std::collections::HashMap<String, YahooDividend>>,
    splits: Option<std::collections::HashMap<String, YahooSplit>>,
}

#[derive(Deserialize)]
struct YahooDividend {
    amount: f64,
    date: i64,
}

#[derive(Deserialize)]
struct YahooSplit {
    date: i64,
    numerator: f64,
    denominator: f64,
}

fn timestamp_to_date(ts: i64) -> String {
    let naive = chrono::DateTime::from_timestamp(ts, 0)
        .unwrap_or_else(|| chrono::DateTime::from_timestamp(0, 0).unwrap())
        .naive_utc();
    naive.format("%Y-%m-%d").to_string()
}

/// Temettü, bölünme ve aylık kapanışları tek Yahoo çağrısıyla getirir.
/// Kapanış serisi, temettü veriminin hak düşüm ayındaki fiyata göre
/// hesaplanabilmesi için gereklidir.
pub struct ChartEvents {
    pub dividends: Vec<YahooDividendEvent>,
    pub splits: Vec<YahooSplitEvent>,
}

pub struct YahooDividendEvent {
    pub date: i64,
    pub amount: f64,
    /// Hak düşüm tarihine en yakın aylık kapanış
    pub ref_close: Option<f64>,
}

pub struct YahooSplitEvent {
    pub date: i64,
    pub numerator: f64,
    pub denominator: f64,
}

pub async fn fetch_chart_events(client: &reqwest::Client, ticker: &str) -> Result<ChartEvents, String> {
    let symbol = if ticker.ends_with(".IS") { ticker.to_string() } else { format!("{}.IS", ticker) };
    let url = format!(
        "https://query1.finance.yahoo.com/v8/finance/chart/{}?range=15y&interval=1mo&events=div%2Csplit",
        symbol
    );
    let resp = client.get(&url)
        .header("User-Agent", YAHOO_USER_AGENT)
        .send().await.map_err(|e| e.to_string())?;
    let body = resp.text().await.map_err(|e| e.to_string())?;
    let parsed: YahooChartResponse = serde_json::from_str(&body).map_err(|e| e.to_string())?;

    let result = parsed.chart
        .and_then(|c| c.result)
        .and_then(|r| r.into_iter().next())
        .ok_or_else(|| format!("{ticker} için Yahoo grafik verisi yok"))?;

    let timestamps = result.timestamp.unwrap_or_default();
    let closes: Vec<Option<f64>> = result.indicators
        .and_then(|i| i.quote)
        .and_then(|q| q.into_iter().next())
        .and_then(|q| q.close)
        .unwrap_or_default();

    // Verilen zaman damgasına en yakın (öncesindeki) aylık kapanışı bul
    let close_at = |ts: i64| -> Option<f64> {
        let mut best: Option<f64> = None;
        for (i, t) in timestamps.iter().enumerate() {
            if *t <= ts {
                if let Some(Some(c)) = closes.get(i) {
                    best = Some(*c);
                }
            } else {
                break;
            }
        }
        best
    };

    let mut dividends = Vec::new();
    let mut splits = Vec::new();

    if let Some(events) = result.events {
        if let Some(divs) = events.dividends {
            for (_, d) in divs {
                dividends.push(YahooDividendEvent {
                    date: d.date,
                    amount: d.amount,
                    ref_close: close_at(d.date),
                });
            }
        }
        if let Some(spl) = events.splits {
            for (_, s) in spl {
                splits.push(YahooSplitEvent {
                    date: s.date,
                    numerator: s.numerator,
                    denominator: s.denominator,
                });
            }
        }
    }

    dividends.sort_by_key(|d| std::cmp::Reverse(d.date));
    splits.sort_by_key(|s| std::cmp::Reverse(s.date));
    Ok(ChartEvents { dividends, splits })
}

/// Bölünme olayını sınıflandırır. Yahoo split akışında bedelli (rüçhanlı)
/// artırımlar yer almaz; pay artıranlar bedelsiz/bölünme, azaltanlar
/// birleştirmedir (ters bölünme).
fn classify_split(numerator: f64, denominator: f64) -> (&'static str, String) {
    if denominator <= 0.0 || numerator <= 0.0 {
        return ("BÖLÜNME", format!("{}:{}", numerator as i64, denominator as i64));
    }
    let base = format!("{}:{}", numerator as i64, denominator as i64);
    if numerator > denominator {
        let pct = (numerator / denominator - 1.0) * 100.0;
        ("BEDELSİZ", format!("{} (%{:.0})", base, pct))
    } else if numerator < denominator {
        ("BİRLEŞTİRME", base)
    } else {
        ("BÖLÜNME", base)
    }
}

/// Aynı hissenin aynı takvim yılındaki ödemelerini tarihe göre sıralayıp
/// 1'den başlayan taksit numarası atar ("bir yılda iki temettü → ikincisi
/// 2. taksit"). Kayıt sırası değişmez.
fn assign_installments(records: &mut [DividendRecord]) {
    use std::collections::HashMap;
    let mut groups: HashMap<(String, String), Vec<usize>> = HashMap::new();
    for (i, r) in records.iter().enumerate() {
        let year = r.ex_date.get(..4).unwrap_or("?").to_string();
        groups.entry((r.ticker.clone(), year)).or_default().push(i);
    }
    for (_, mut idxs) in groups {
        idxs.sort_by(|a, b| records[*a].ex_date.cmp(&records[*b].ex_date));
        for (seq, idx) in idxs.into_iter().enumerate() {
            records[idx].installment = (seq + 1) as u32;
        }
    }
}

pub async fn fetch_dividends(client: &reqwest::Client, ticker: &str) -> Result<Vec<DividendRecord>, String> {
    let events = fetch_chart_events(client, ticker).await?;
    let records = events.dividends.into_iter().map(|d| {
        let ex_date = timestamp_to_date(d.date);
        let year = ex_date.get(..4).unwrap_or("?").to_string();
        let yield_pct = d.ref_close
            .filter(|c| *c > 0.0)
            .map(|c| (d.amount / c) * 100.0)
            .unwrap_or(0.0);
        DividendRecord {
            ticker: ticker.to_string(),
            ex_date,
            amount_per_share: d.amount,
            yield_pct,
            period: year,
            installment: 0,
        }
    }).collect();
    let mut records: Vec<DividendRecord> = records;
    assign_installments(&mut records);
    Ok(records)
}

pub async fn fetch_capital_increases(client: &reqwest::Client, ticker: &str) -> Result<Vec<CapitalIncrease>, String> {
    let events = fetch_chart_events(client, ticker).await?;
    let records = events.splits.into_iter().map(|s| {
        let (increase_type, ratio) = classify_split(s.numerator, s.denominator);
        CapitalIncrease {
            ticker: ticker.to_string(),
            date: timestamp_to_date(s.date),
            increase_type: increase_type.to_string(),
            ratio,
            rights_price: None,
            source: "Yahoo Finance".to_string(),
        }
    }).collect();
    Ok(records)
}




/// Talep toplama / işlem tarihi geçmişte kalan arzları okuma anında
/// TAMAMLANDI'ya çevirir; böylece site rozeti gecikse bile durum bayatlamaz.
fn effective_status(status: &str, ipo_date: &str, today: &str) -> String {
    let is_open = matches!(status, "TALEP TOPLAMA" | "AKTİF");
    if is_open && crate::ipo_store::looks_like_iso_date(ipo_date) && ipo_date < today {
        "TAMAMLANDI".to_string()
    } else {
        status.to_string()
    }
}

fn archive_to_records(archive: Vec<crate::ipo_store::PersistedIpo>) -> Vec<IpoRecord> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut records: Vec<IpoRecord> = archive
        .into_iter()
        .map(|p| IpoRecord {
            ticker: p.ticker,
            company_name: p.name,
            status: effective_status(&p.status, &p.ipo_date, &today),
            ipo_date: p.ipo_date,
            price: p.price,
            current_price: None,
            return_pct: None,
            lot_size: 100,
            book_building_dates: p.book_building_dates,
            trading_start_date: p.trading_start_date,
            distribution_type: p.distribution_type,
            participant_count: p.participant_count,
            split_factor: p.split_factor,
        })
        .collect();

    // ISO tarihli kayıtlar yeniden eskiye; tarihi çözülemeyenler (taslaklar) sona
    records.sort_by(|a, b| {
        let a_iso = crate::ipo_store::looks_like_iso_date(&a.ipo_date);
        let b_iso = crate::ipo_store::looks_like_iso_date(&b.ipo_date);
        b_iso.cmp(&a_iso).then_with(|| b.ipo_date.cmp(&a.ipo_date))
    });

    records
}

/// Arşivdeki mevcut veriden kayıt listesi üretir; ağ erişimi yapmaz.
pub fn load_archive_records() -> Vec<IpoRecord> {
    archive_to_records(crate::ipo_store::load())
}

/// Halka arz takvimini yeniler: siteyi kazır, sonucu kalıcı arşive işler ve
/// arşivin tamamından kayıt listesi üretir. Scrape başarısız olsa bile arşiv
/// (ilk çalıştırmada tohum veriyle dolan ~/.fraude_ipos.json) sayesinde veri döner.
/// Dönen bool, canlı scrape'in başarılı olup olmadığını bildirir.
pub async fn refresh_ipo_base(client: &reqwest::Client) -> (Vec<IpoRecord>, bool) {
    let scrape_result = crate::ipo_scraper::scrape_recent_ipos(client).await;
    let mut archive = crate::ipo_store::load();

    let scrape_ok = matches!(&scrape_result, Ok(list) if !list.is_empty());
    if let Ok(scraped) = scrape_result {
        if crate::ipo_store::merge_scraped(&mut archive, &scraped) {
            crate::ipo_store::save(&archive);
        }
    }

    (archive_to_records(archive), scrape_ok)
}

/// Geçmiş yıl arşivlerinin taranacağı başlangıç yılı ve tekrar aralığı.
const BACKFILL_START_YEAR: i32 = 2023;
const BACKFILL_INTERVAL_DAYS: i64 = 7;

fn backfill_meta_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join(".fraude_ipos_meta.json"))
}

fn backfill_due() -> bool {
    let Some(path) = backfill_meta_path() else { return false };
    let last = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("last_backfill").and_then(|d| d.as_str().map(String::from)));

    match last {
        Some(date) => {
            let cutoff = (chrono::Local::now() - chrono::Duration::days(BACKFILL_INTERVAL_DAYS))
                .format("%Y-%m-%d")
                .to_string();
            date.as_str() < cutoff.as_str()
        }
        None => true,
    }
}

fn mark_backfill_done() {
    if let Some(path) = backfill_meta_path() {
        let meta = serde_json::json!({
            "last_backfill": chrono::Local::now().format("%Y-%m-%d").to_string(),
        });
        let _ = std::fs::write(&path, meta.to_string());
    }
}

/// Yıl arşivi sayfalarını (halkarz.com/k/halka-arz/{yıl}/) tarayarak ana
/// sayfadan düşmüş eski halka arzları arşive ekler ve detay alanları eksik
/// kayıtları (talep toplama, ilk işlem tarihi, dağıtım türü, katılımcı)
/// tamamlar. Haftada bir kez çalışır; detayları zaten tam olan kayıtların
/// detay sayfası tekrar çekilmez. Arşiv değiştiyse true döner.
pub async fn backfill_ipo_history(client: &reqwest::Client) -> bool {
    if !backfill_due() {
        return false;
    }

    let mut archive = crate::ipo_store::load();
    let skip_details: std::collections::HashSet<String> = archive
        .iter()
        .filter(|p| p.book_building_dates.is_some())
        .map(|p| p.ticker.clone())
        .collect();

    let current_year = chrono::Datelike::year(&chrono::Local::now());
    let mut changed = false;

    for year in BACKFILL_START_YEAR..=current_year {
        let scraped = crate::ipo_scraper::scrape_year_archive(client, year, &skip_details).await;
        if !scraped.is_empty() {
            changed |= crate::ipo_store::merge_scraped(&mut archive, &scraped);
        }
    }

    changed |= refresh_split_factors(client, &mut archive).await;

    if changed {
        crate::ipo_store::save(&archive);
    }
    mark_backfill_done();
    changed
}

/// Verilen zaman damgalı bölünme olaylarından, arz tarihinden SONRA
/// gerçekleşenlerin kümülatif çarpanını hesaplar. Yahoo verisinde ara sıra
/// görülen bozuk kayıtlara karşı makul olmayan oranlar (tek olayda >100x
/// veya <1/100) yok sayılır; kümülatif sonuç da güvenlik bandında tutulur.
fn split_factor_since(splits: &[YahooSplitEvent], ipo_date: &str) -> f64 {
    let mut factor = 1.0;
    for s in splits {
        if s.denominator <= 0.0 || s.numerator <= 0.0 {
            continue;
        }
        let ratio = s.numerator / s.denominator;
        if !(0.01..=100.0).contains(&ratio) {
            continue;
        }
        if timestamp_to_date(s.date).as_str() > ipo_date {
            factor *= ratio;
        }
    }
    if !(0.001..=1000.0).contains(&factor) {
        return 1.0;
    }
    factor
}

/// Arşivdeki (taslak olmayan, ISO tarihli) arzların arz sonrası bölünme
/// çarpanlarını Yahoo'dan günceller. Haftalık backfill içinde çalışır;
/// aynı gün içinde tekrar kontrol edilmez.
async fn refresh_split_factors(
    client: &reqwest::Client,
    archive: &mut [crate::ipo_store::PersistedIpo],
) -> bool {
    use futures::future::join_all;

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let pending: Vec<(usize, String, String)> = archive
        .iter()
        .enumerate()
        .filter(|(_, p)| p.status != "TASLAK" && crate::ipo_store::looks_like_iso_date(&p.ipo_date))
        .filter(|(_, p)| p.split_checked.as_deref() != Some(today.as_str()))
        .map(|(i, p)| (i, p.ticker.clone(), p.ipo_date.clone()))
        .collect();

    if pending.is_empty() {
        return false;
    }

    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(6));
    let mut tasks = Vec::new();
    for (idx, ticker, ipo_date) in pending {
        let client = client.clone();
        let permit = semaphore.clone();
        tasks.push(tokio::spawn(async move {
            let _permit = permit.acquire().await.ok()?;
            let events = fetch_chart_events(&client, &ticker).await.ok()?;
            Some((idx, split_factor_since(&events.splits, &ipo_date)))
        }));
    }

    let mut changed = false;
    for res in join_all(tasks).await {
        if let Ok(Some((idx, factor))) = res {
            if let Some(entry) = archive.get_mut(idx) {
                entry.split_factor = Some(factor);
                entry.split_checked = Some(today.clone());
                changed = true;
            }
        }
    }
    changed
}

/// Cache'lenmiş kayıtlara store'daki güncel piyasa fiyatlarını uygular; böylece
/// IPO cache'i beklemeden her çağrıda taze fiyat/getiri gösterilir. Getiri,
/// arz sonrası bedelsiz/bölünme çarpanıyla düzeltilir: 2:1 bedelsiz sonrası
/// fiyat yarılanmış görünse de gerçek getiri korunur.
pub fn apply_market_prices(records: &mut [IpoRecord], equities: &[EquityRow]) {
    for rec in records.iter_mut() {
        rec.current_price = equities.iter().find(|eq| eq.ticker == rec.ticker).map(|eq| eq.price);
        let factor = rec.split_factor.filter(|f| *f > 0.0).unwrap_or(1.0);
        rec.return_pct = rec.current_price.map(|cp| {
            if rec.price > 0.0 {
                ((cp * factor - rec.price) / rec.price) * 100.0
            } else {
                0.0
            }
        });
    }
}

// ---------------- Piyasa geneli temettü / bölünme akışı ----------------

/// Tüm BIST evreninin son temettü ve bölünme olaylarını tutan günlük cache.
/// Kurumsal Aksiyonlar sekmesindeki "en yeniden eskiye" akışı besler.
#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct MarketEventsCache {
    #[serde(default)]
    pub last_updated: Option<String>,
    #[serde(default)]
    pub last_updated_ts: i64,
    #[serde(default)]
    pub dividends: Vec<DividendRecord>,
    #[serde(default)]
    pub splits: Vec<CapitalIncrease>,
    #[serde(default)]
    pub upcoming: Vec<crate::domain::UpcomingDividend>,
}

const MARKET_EVENTS_TTL_SECS: i64 = 24 * 3600;
/// Akışta tutulan pencereler: temettüler 24 ay, bölünmeler 5 yıl geriye.
const DIVIDEND_WINDOW_MONTHS: i64 = 24;
const SPLIT_WINDOW_YEARS: i64 = 5;

fn market_events_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join(".fraude_corporate_events.json"))
}

pub fn load_market_events() -> MarketEventsCache {
    market_events_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_market_events(cache: &MarketEventsCache) {
    if let Some(path) = market_events_path() {
        if let Ok(json) = serde_json::to_string(cache) {
            let _ = std::fs::write(&path, json);
        }
    }
}

pub fn market_events_stale() -> bool {
    let cache = load_market_events();
    let now = chrono::Utc::now().timestamp();
    cache.last_updated_ts == 0 || now - cache.last_updated_ts > MARKET_EVENTS_TTL_SECS
}

/// BIST evreni + güncel IPO arşivindeki tüm hisselerin temettü/bölünme
/// olaylarını Yahoo'dan toplar ve pencere içindekileri cache'e yazar.
/// Günde bir kez arka plan görevinde çalışır (~613 hisse, eşzamanlılık 6).
/// Toplama yarıdan fazla hissede başarısızsa mevcut cache korunur.
pub async fn refresh_market_events(client: &reqwest::Client) {
    use futures::future::join_all;

    let mut tickers: Vec<String> = crate::yahoo::BIST_TICKERS
        .iter()
        .map(|(t, _)| t.to_string())
        .collect();
    let archive = crate::ipo_store::load();
    for t in crate::ipo_store::recent_ipo_tickers(&archive) {
        if !tickers.contains(&t) {
            tickers.push(t);
        }
    }
    let universe_size = tickers.len();
    let tickers_snapshot = tickers.clone();

    let div_cutoff = (chrono::Local::now() - chrono::Duration::days(DIVIDEND_WINDOW_MONTHS * 30))
        .format("%Y-%m-%d")
        .to_string();
    let split_cutoff = (chrono::Local::now() - chrono::Duration::days(SPLIT_WINDOW_YEARS * 365))
        .format("%Y-%m-%d")
        .to_string();

    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(6));
    let mut tasks = Vec::new();
    for ticker in tickers {
        let client = client.clone();
        let permit = semaphore.clone();
        tasks.push(tokio::spawn(async move {
            let _permit = permit.acquire().await.ok()?;
            let events = fetch_chart_events(&client, &ticker).await.ok()?;
            Some((ticker, events))
        }));
    }

    let mut dividends: Vec<DividendRecord> = Vec::new();
    let mut splits: Vec<CapitalIncrease> = Vec::new();
    let mut success = 0usize;

    for res in join_all(tasks).await {
        let Ok(Some((ticker, events))) = res else { continue };
        success += 1;
        for d in events.dividends {
            let ex_date = timestamp_to_date(d.date);
            if ex_date.as_str() < div_cutoff.as_str() {
                continue;
            }
            let yield_pct = d.ref_close
                .filter(|c| *c > 0.0)
                .map(|c| (d.amount / c) * 100.0)
                .unwrap_or(0.0);
            dividends.push(DividendRecord {
                ticker: ticker.clone(),
                period: ex_date.get(..4).unwrap_or("?").to_string(),
                ex_date,
                amount_per_share: d.amount,
                yield_pct,
                installment: 0,
            });
        }
        for s in events.splits {
            let date = timestamp_to_date(s.date);
            if date.as_str() < split_cutoff.as_str() {
                continue;
            }
            let (increase_type, ratio) = classify_split(s.numerator, s.denominator);
            splits.push(CapitalIncrease {
                ticker: ticker.clone(),
                date,
                increase_type: increase_type.to_string(),
                ratio,
                rights_price: None,
                source: "Yahoo Finance".to_string(),
            });
        }
    }

    // Yahoo geçici olarak bloklarsa yarım veriyle mevcut cache'i ezme
    if success < universe_size / 2 {
        return;
    }

    dividends.sort_by(|a, b| b.ex_date.cmp(&a.ex_date));
    splits.sort_by(|a, b| b.date.cmp(&a.date));
    assign_installments(&mut dividends);

    // Gelecek temettü takvimi: tarama başarısızsa önceki liste korunur
    let mut upcoming = match fetch_upcoming_dividends(&tickers_snapshot).await {
        Some(list) => list,
        None => load_market_events().upcoming,
    };

    // Yaklaşan ödeme, aynı yıl içinde ödenenlerin devamı: kaçıncı taksit?
    for u in upcoming.iter_mut() {
        let year = u.ex_date.get(..4).unwrap_or("?");
        let paid_this_year = dividends
            .iter()
            .filter(|d| d.ticker == u.ticker && d.ex_date.get(..4) == Some(year) && d.ex_date < u.ex_date)
            .count() as u32;
        u.installment = paid_this_year + 1;
    }

    save_market_events(&MarketEventsCache {
        last_updated: Some(chrono::Local::now().format("%d.%m.%Y %H:%M").to_string()),
        last_updated_ts: chrono::Utc::now().timestamp(),
        dividends,
        splits,
        upcoming,
    });
}

/// Yahoo quoteSummary/calendarEvents üzerinden açıklanmış GELECEK temettü
/// hak düşüm tarihlerini toplar. Bu uç kimlikli "crumb" ister: önce çerez
/// (fc.yahoo.com), sonra crumb alınır ve tüm sorgulara eklenir.
/// Crumb alınamazsa None döner (mevcut takvim korunur).
async fn fetch_upcoming_dividends(
    tickers: &[String],
) -> Option<Vec<crate::domain::UpcomingDividend>> {
    use futures::future::join_all;

    let client = reqwest::Client::builder()
        .cookie_store(true)
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .ok()?;

    let _ = client
        .get("https://fc.yahoo.com")
        .header("User-Agent", YAHOO_USER_AGENT)
        .send()
        .await;

    let crumb = client
        .get("https://query1.finance.yahoo.com/v1/test/getcrumb")
        .header("User-Agent", YAHOO_USER_AGENT)
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()?;
    if crumb.is_empty() || crumb.contains('<') || crumb.len() > 40 {
        return None;
    }

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(6));
    let mut tasks = Vec::new();

    for ticker in tickers.iter().cloned() {
        let client = client.clone();
        let crumb = crumb.clone();
        let permit = semaphore.clone();
        tasks.push(tokio::spawn(async move {
            let _permit = permit.acquire().await.ok()?;
            let url = format!(
                "https://query1.finance.yahoo.com/v10/finance/quoteSummary/{}.IS?modules=calendarEvents%2CsummaryDetail&crumb={}",
                ticker, crumb
            );
            let body = client
                .get(&url)
                .header("User-Agent", YAHOO_USER_AGENT)
                .send()
                .await
                .ok()?
                .text()
                .await
                .ok()?;
            let v: serde_json::Value = serde_json::from_str(&body).ok()?;
            let result = v.get("quoteSummary")?.get("result")?.get(0)?;
            let ex_ts = result
                .get("calendarEvents")?
                .get("exDividendDate")?
                .get("raw")?
                .as_i64()?;
            let annual_rate = result
                .get("summaryDetail")
                .and_then(|s| s.get("dividendRate"))
                .and_then(|r| r.get("raw"))
                .and_then(|r| r.as_f64());
            Some((ticker, timestamp_to_date(ex_ts), annual_rate))
        }));
    }

    let mut upcoming = Vec::new();
    let mut responded = 0usize;
    let total = tasks.len();
    for res in join_all(tasks).await {
        if let Ok(item) = res {
            responded += 1;
            if let Some((ticker, ex_date, annual_rate)) = item {
                if ex_date.as_str() >= today.as_str() {
                    upcoming.push(crate::domain::UpcomingDividend { ticker, ex_date, annual_rate, installment: 0 });
                }
            }
        }
    }
    // join hataları dışında hepsi yanıtlandı sayılır; crumb bloklandıysa
    // sonuç boş kalır — bunu başarısızlık kabul et
    if upcoming.is_empty() && responded < total / 2 {
        return None;
    }

    upcoming.sort_by(|a, b| a.ex_date.cmp(&b.ex_date));
    Some(upcoming)
}

#[cfg(test)]
mod tests {
    #[test]
    fn installments_are_numbered_within_year() {
        use crate::domain::DividendRecord;
        let rec = |ticker: &str, ex_date: &str| DividendRecord {
            ticker: ticker.into(),
            ex_date: ex_date.into(),
            amount_per_share: 1.0,
            yield_pct: 0.0,
            period: ex_date[..4].into(),
            installment: 0,
        };
        let mut records = vec![
            rec("EREGL", "2026-12-15"),
            rec("EREGL", "2026-03-10"),
            rec("EREGL", "2026-06-20"),
            rec("EREGL", "2025-06-01"),
            rec("BIMAS", "2026-09-16"),
        ];
        super::assign_installments(&mut records);
        assert_eq!(records[0].installment, 3); // 2026'nın üçüncü ödemesi
        assert_eq!(records[1].installment, 1);
        assert_eq!(records[2].installment, 2);
        assert_eq!(records[3].installment, 1); // farklı yıl kendi içinde sayılır
        assert_eq!(records[4].installment, 1); // tek ödeme
    }

    #[test]
    fn split_classification_is_honest() {
        use super::classify_split;
        assert_eq!(classify_split(2.0, 1.0), ("BEDELSİZ", "2:1 (%100)".to_string()));
        assert_eq!(classify_split(3.0, 2.0), ("BEDELSİZ", "3:2 (%50)".to_string()));
        // Ters bölünme artık BEDELLİ diye yanlış etiketlenmiyor
        assert_eq!(classify_split(1.0, 10.0).0, "BİRLEŞTİRME");
    }

    #[test]
    fn split_factor_counts_only_post_ipo_events() {
        use super::{split_factor_since, YahooSplitEvent};
        let splits = vec![
            // 2026-01-01 civarı (arzdan sonra): 2:1
            YahooSplitEvent { date: 1767225600, numerator: 2.0, denominator: 1.0 },
            // 2020 (arzdan önce): 3:1 — sayılmamalı
            YahooSplitEvent { date: 1577836800, numerator: 3.0, denominator: 1.0 },
        ];
        let factor = split_factor_since(&splits, "2025-06-01");
        assert!((factor - 2.0).abs() < 1e-9, "factor = {factor}");
        assert!((split_factor_since(&splits, "2026-12-31") - 1.0).abs() < 1e-9);
    }

    #[test]
    fn split_factor_ignores_garbage_events() {
        use super::{split_factor_since, YahooSplitEvent};
        let splits = vec![
            // Bozuk kayıt: 1.4 milyon katlık "bölünme" — yok sayılmalı
            YahooSplitEvent { date: 1767225600, numerator: 9_785_138.0, denominator: 7.0 },
            // Geçerli: 2:1
            YahooSplitEvent { date: 1767225600, numerator: 2.0, denominator: 1.0 },
        ];
        let factor = split_factor_since(&splits, "2025-01-01");
        assert!((factor - 2.0).abs() < 1e-9, "bozuk olay elenmeli, factor = {factor}");
    }

    #[test]
    fn past_open_ipos_become_completed() {
        use super::effective_status;
        assert_eq!(effective_status("TALEP TOPLAMA", "2026-07-10", "2026-07-13"), "TAMAMLANDI");
        assert_eq!(effective_status("AKTİF", "2026-07-01", "2026-07-13"), "TAMAMLANDI");
        // Bugünkü ve gelecekteki arzlar açık kalır
        assert_eq!(effective_status("TALEP TOPLAMA", "2026-07-13", "2026-07-13"), "TALEP TOPLAMA");
        assert_eq!(effective_status("AKTİF", "2026-08-01", "2026-07-13"), "AKTİF");
        // Taslaklar ve tarihi çözülemeyenler dokunulmaz
        assert_eq!(effective_status("TASLAK", "2026-01-01", "2026-07-13"), "TASLAK");
        assert_eq!(effective_status("TALEP TOPLAMA", "Hazırlanıyor...", "2026-07-13"), "TALEP TOPLAMA");
    }

    #[tokio::test]
    #[ignore = "requires live Yahoo access (full market sweep, ~1-2 min)"]
    async fn live_market_events_sweep_populates_cache() {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .unwrap();
        super::refresh_market_events(&client).await;
        let cache = super::load_market_events();
        assert!(cache.last_updated_ts > 0, "cache yazılmalı");
        assert!(cache.dividends.len() > 100, "piyasada son 24 ayda >100 temettü olmalı, bulunan: {}", cache.dividends.len());
        assert!(cache.splits.len() > 30, "son 5 yılda >30 bölünme olmalı, bulunan: {}", cache.splits.len());
        // En yeniden eskiye sıralı olmalı
        assert!(cache.dividends.windows(2).all(|w| w[0].ex_date >= w[1].ex_date));
        assert!(cache.splits.windows(2).all(|w| w[0].date >= w[1].date));
    }

    #[tokio::test]
    #[ignore = "requires live Yahoo access"]
    async fn live_chart_events_yield_and_splits() {
        let client = reqwest::Client::new();
        let events = super::fetch_chart_events(&client, "ASELS").await.unwrap();
        assert!(!events.dividends.is_empty(), "ASELS temettü geçmişi olmalı");
        assert!(
            events.dividends.iter().any(|d| d.ref_close.is_some()),
            "verim hesabı için referans kapanış bulunmalı"
        );
        assert!(!events.splits.is_empty(), "ASELS bedelsiz geçmişi olmalı");

        let divs = super::fetch_dividends(&client, "ASELS").await.unwrap();
        assert!(divs.iter().any(|d| d.yield_pct > 0.0), "en az bir temettünün verimi hesaplanmalı");

        let caps = super::fetch_capital_increases(&client, "ASELS").await.unwrap();
        assert!(caps.iter().any(|c| c.increase_type == "BEDELSİZ"));
    }

    #[tokio::test]
    #[ignore = "requires live halkarz.com access"]
    async fn live_refresh_populates_archive() {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap();
        let (records, scrape_ok) = super::refresh_ipo_base(&client).await;
        assert!(scrape_ok, "live scrape should succeed");
        assert!(records.len() >= 30, "archive + scrape should yield records, got {}", records.len());
        let iso_count = records
            .iter()
            .filter(|r| crate::ipo_store::looks_like_iso_date(&r.ipo_date))
            .count();
        assert!(iso_count >= 30, "most records should have ISO dates, got {iso_count}");
    }

    #[tokio::test]
    #[ignore = "requires live halkarz.com access"]
    async fn live_backfill_fills_missing_details() {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap();
        super::backfill_ipo_history(&client).await;

        let archive = crate::ipo_store::load();
        let missing: Vec<_> = archive
            .iter()
            .filter(|p| p.status != "TASLAK" && p.book_building_dates.is_none())
            .map(|p| p.ticker.clone())
            .collect();
        assert!(
            missing.len() <= 3,
            "backfill should fill nearly all detail fields, still missing: {missing:?}"
        );
    }
}
