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

/// Resmî kaynağa geçilemeyen kayıtların etiketi.
const YAHOO_SOURCE: &str = "Yahoo Finance";

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
            source: YAHOO_SOURCE.to_string(),
        }
    }).collect();
    let mut records: Vec<DividendRecord> = records;
    assign_installments(&mut records);
    Ok(records)
}

/// Bir hissenin sermaye artırımları.
///
/// Asıl kaynak SPK bültenleridir; Yahoo yalnız SPK arşivinde kayıt yoksa
/// devreye girer. İki fark önemli:
///
/// * Yahoo'nun split akışı **bedelliyi hiç taşımaz**, SPK tablosu taşır.
/// * Yahoo bedelsizde bozulabiliyor (KTLEV'de üç kayıt çarpılınca ×937,9
///   çıkıyordu); SPK aynı zinciri ×11,5 ve ×3,3816 olarak veriyor.
pub async fn fetch_capital_increases(client: &reqwest::Client, ticker: &str) -> Result<Vec<CapitalIncrease>, String> {
    let archive = crate::capital_store::load();
    let official = crate::capital_store::increases_for(&archive, ticker);
    if !official.is_empty() {
        return Ok(official.iter().map(|row| official_to_record(ticker, row)).collect());
    }

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

/// Yahoo'dan derlenen temettü listesini resmî KAP kayıtlarıyla değiştirir.
///
/// Kapsama **hisse + hak kullanım tarihi** düzeyinde: KAP kaydı olan bir
/// ödemenin Yahoo satırı düşer, olmayanlar kalır. Sermaye artırımındaki gibi
/// hisse düzeyinde kapsamak burada yanlış olurdu — KAP tarama bütçeli
/// ilerliyor ve bir hissenin bazı ödemeleri henüz okunmamış olabilir; hisseyi
/// tümden kapsamak o ödemeleri listeden silerdi.
fn overlay_official_dividends(
    yahoo: Vec<DividendRecord>,
    archive: &crate::capital_store::CapitalArchive,
    cutoff: &str,
    today: &str,
) -> Vec<DividendRecord> {
    let official: Vec<DividendRecord> = archive
        .dividends
        .iter()
        // Hak kullanımı gelecekte olan ödeme geçmiş listesine girmez; o
        // "yaklaşan temettü" takvimine aittir (bkz. `upcoming_from_official`).
        .filter(|row| row.ex_date.as_str() >= cutoff && row.ex_date.as_str() <= today)
        .map(kap_to_dividend)
        .collect();

    if official.is_empty() {
        return yahoo;
    }

    let covered: std::collections::HashSet<(&str, &str)> = official
        .iter()
        .map(|row| (row.ticker.as_str(), row.ex_date.as_str()))
        .collect();

    let mut merged: Vec<DividendRecord> = yahoo
        .into_iter()
        .filter(|row| !covered.contains(&(row.ticker.as_str(), row.ex_date.as_str())))
        .collect();
    merged.extend(official);
    merged
}

/// Hak kullanımı henüz gelmemiş resmî temettüler.
///
/// Yaklaşan temettü takvimi bugüne dek Yahoo'nun `quoteSummary` ucundan
/// geliyordu; o uç kimlikli "crumb" istiyor, sık bloklanıyor ve önbellekte
/// takvim boş kalıyordu. KAP bildirimi hak kullanım tarihini **kesinleşmiş**
/// olarak veriyor — tahmine gerek yok.
fn upcoming_from_official(
    archive: &crate::capital_store::CapitalArchive,
    today: &str,
) -> Vec<crate::domain::UpcomingDividend> {
    archive
        .dividends
        .iter()
        .filter(|row| row.ex_date.as_str() > today)
        .map(|row| crate::domain::UpcomingDividend {
            ticker: row.ticker.clone(),
            ex_date: row.ex_date.clone(),
            // KAP yıllık oran vermez, o ödemenin tutarını verir; alan Yahoo'nun
            // tahmini yıllık oranı için var, uydurma değer yazılmaz.
            annual_rate: None,
            installment: installment_of(&row.payment_kind),
            gross_per_share: Some(row.gross_per_share),
            official: true,
        })
        .collect()
}

/// `"2. Taksit"` → `2`. Peşin ödemede taksit numarası yoktur, `0` döner.
fn installment_of(payment_kind: &str) -> u32 {
    payment_kind
        .split('.')
        .next()
        .and_then(|n| n.trim().parse::<u32>().ok())
        .unwrap_or(0)
}

/// KAP temettü kaydını arayüzün beklediği biçime çevirir.
///
/// Brüt tutar taşınır: Yahoo da brüt veriyor ve iki kaynak ancak aynı temelde
/// karşılaştırılabilir. Verim, akış kurulurken fiyat serisinden hesaplanıyor;
/// burada 0 bırakılır.
fn kap_to_dividend(row: &crate::kap_dividend::KapDividend) -> DividendRecord {
    DividendRecord {
        ticker: row.ticker.clone(),
        period: row.ex_date.get(..4).unwrap_or("?").to_string(),
        ex_date: row.ex_date.clone(),
        amount_per_share: row.gross_per_share,
        yield_pct: 0.0,
        installment: 0,
        source: format!("KAP Bildirimi {}", row.disclosure_index),
    }
}

/// Yahoo'dan derlenen piyasa geneli listesini resmî arşivle değiştirir.
///
/// Resmî kaydı bulunan **her hisse için Yahoo satırları tamamen atılır**,
/// tarih eşleştirmesi yapılmaz: resmî kaynak onay/karar tarihini, Yahoo
/// gerçekleşme tarihini verir ve ikisi gün-hafta ayrı düşer (KTLEV: onay
/// 29.07, gerçekleşme 03.08). Aynı artırımı iki kez listelememek için hisse
/// bazında tek kaynak seçilir.
///
/// Böylece liste bedelliyi de gösterir — Yahoo split akışında bedelli hiç yok.
fn overlay_with(
    yahoo_splits: Vec<CapitalIncrease>,
    archive: &crate::capital_store::CapitalArchive,
    cutoff: &str,
) -> Vec<CapitalIncrease> {
    let official: Vec<CapitalIncrease> = archive
        .records
        .iter()
        .filter_map(|row| {
            let ticker = row.ticker.as_deref()?;
            (row.increase.approval_date.as_str() >= cutoff)
                .then(|| official_to_record(ticker, row))
        })
        .collect();

    if official.is_empty() {
        return yahoo_splits;
    }

    // Kapsama **şirket** düzeyinde: artırım pay gruplarının hepsini ilgilendirir
    // (İş Bankası ISATR/ISBTR/ISCTR). Yalnız resmî kaydın kodunu kapsamak,
    // kardeş kodların Yahoo satırını bırakıyor ve aynı artırım listede iki kez,
    // iki ayrı tarih ve kaynakla görünüyordu.
    let covered: std::collections::HashSet<&str> = official
        .iter()
        .flat_map(|r| {
            std::iter::once(r.ticker.as_str())
                .chain(crate::company_match::sibling_tickers(&r.ticker))
        })
        .collect();

    let mut merged: Vec<CapitalIncrease> = yahoo_splits
        .into_iter()
        .filter(|r| !covered.contains(r.ticker.as_str()))
        .collect();
    merged.extend(official);
    merged
}

/// Resmî kaydı arayüzün beklediği biçime çevirir.
///
/// Bir artırım hem bedelli hem bedelsiz olabilir (karma); oran metni her
/// bileşeni mevcut sermayeye göre yüzde olarak verir.
fn official_to_record(ticker: &str, stored: &crate::capital_store::StoredCapitalIncrease) -> CapitalIncrease {
    let source = match stored.source {
        crate::capital_store::CapitalSource::SpkBulletin => {
            format!("SPK Bülteni {}", stored.increase.bulletin_no)
        }
        // Bülten numarası alanı KAP kayıtlarında "KAP/1644978" taşıyor;
        // kullanıcıya bildirim numarası olarak gösterilir.
        crate::capital_store::CapitalSource::KapDisclosure => {
            let index = stored.increase.bulletin_no.trim_start_matches("KAP/");
            format!("KAP Bildirimi {index}")
        }
    };
    CapitalIncrease { source, ..spk_to_record(ticker, &stored.increase) }
}

fn spk_to_record(ticker: &str, increase: &crate::spk::SpkCapitalIncrease) -> CapitalIncrease {
    let bonus_pct = increase.bonus_amount() / increase.existing_capital * 100.0;
    let rights_pct = increase.rights_ratio() * 100.0;

    let (increase_type, ratio) = match (increase.is_bonus(), increase.is_rights()) {
        (true, true) => (
            "KARMA",
            format!("Bedelsiz %{bonus_pct:.0} + Bedelli %{rights_pct:.0}"),
        ),
        (true, false) => ("BEDELSİZ", format!("%{bonus_pct:.0}")),
        (false, true) => ("BEDELLİ", format!("%{rights_pct:.0}")),
        (false, false) => ("BÖLÜNME", String::new()),
    };

    CapitalIncrease {
        ticker: ticker.to_string(),
        date: increase.approval_date.clone(),
        increase_type: increase_type.to_string(),
        ratio,
        rights_price: None,
        source: format!("SPK Bülteni {}", increase.bulletin_no),
    }
}




fn contains_turkish_ignore_case(haystack: &str, needle_ascii: &str) -> bool {
    let lower: String = haystack
        .chars()
        .map(|c| match c {
            'İ' | 'I' | 'ı' | 'i' => 'i',
            'Ğ' | 'ğ' => 'g',
            'Ü' | 'ü' => 'u',
            'Ş' | 'ş' => 's',
            'Ö' | 'ö' => 'o',
            'Ç' | 'ç' => 'c',
            other => other.to_ascii_lowercase(),
        })
        .collect();
    lower.contains(needle_ascii)
}

fn is_postponed_or_cancelled_text(text: &str) -> bool {
    contains_turkish_ignore_case(text, "ertelendi")
        || contains_turkish_ignore_case(text, "ertelen")
        || contains_turkish_ignore_case(text, "iptal")
}

/// Talep toplama / işlem tarihi geçmişte kalan arzları okuma anında
/// TAMAMLANDI'ya çevirir; ertelenen/iptal edilenleri ERTELENDİ'ye dönüştürür.
fn effective_status(status: &str, ipo_date: &str, book_building_dates: Option<&str>, today: &str) -> String {
    // 1. Ertelenen veya iptal edilen arzlar
    if let Some(bb) = book_building_dates {
        if is_postponed_or_cancelled_text(bb) {
            return "ERTELENDİ".to_string();
        }
    }

    let dated = crate::ipo_store::looks_like_iso_date(ipo_date);

    if matches!(status, "TALEP TOPLAMA" | "AKTİF") && dated && ipo_date < today {
        return "TAMAMLANDI".to_string();
    }
    // Tarihi gelecekte olan bir arz tamamlanmış olamaz. Yıl arşivi sayfalarında
    // durum rozeti bulunmadığı için o kayıtlar TAMAMLANDI varsayılıyor; içinde
    // bulunulan yılın arşivi henüz talep toplayan arzları da taşıyor.
    if status == "TAMAMLANDI" && dated && ipo_date > today {
        return "AKTİF".to_string();
    }

    status.to_string()
}

fn archive_to_records(archive: Vec<crate::ipo_store::PersistedIpo>) -> Vec<IpoRecord> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut records: Vec<IpoRecord> = archive
        .into_iter()
        .map(|p| IpoRecord {
            status: effective_status(&p.status, &p.ipo_date, p.book_building_dates.as_deref(), &today),
            ticker: p.ticker,
            company_name: p.name,
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
            fund_usage: p.fund_usage,
            share_structure: p.share_structure,
            ipo_size: p.ipo_size,
            katilim_index: p.katilim_index,
            lockup_period: p.lockup_period,
            consortium_lead: p.consortium_lead,
            t1_t2_available: p.t1_t2_available,
            distribution_ratios: p.distribution_ratios,
            price_range: p.price_range,
            lot_amount: p.lot_amount,
            market: p.market,
            index_name: p.index_name,
            free_float_lots: p.free_float_lots,
            free_float_ratio: p.free_float_ratio,
            sale_method: p.sale_method,
            expected_lots: p.expected_lots,
            financials: p.financials,
            price_stability: p.price_stability,
            public_float_ratio: p.public_float_ratio,
            discount: p.discount,
            results_table: p.results_table,
            major_shareholders: p.major_shareholders,
            data_sources: p.data_sources,
            spk_bulletin_no: p.spk_bulletin_no,
            spk_approval_date: p.spk_approval_date,
        })
        .collect();

    // Sıralama Önceliği:
    // 1. SPK ONAYLI / TALEP TOPLAMA / AKTİF olan güncel/yaklaşan halka arzlar (Öncelik 0 - En üstte)
    // 2. Borsada işlem gören tamamlanmış halka arzlar (ISO tarihli) yeniden eskiye (Öncelik 1)
    // 3. Taslak, başvuru ve ertelenenler (Öncelik 2)
    records.sort_by(|a, b| {
        let is_active_or_approved = |status: &str| {
            matches!(status, "SPK ONAYLI" | "TALEP TOPLAMA" | "AKTİF" | "YENİ")
        };
        let is_draft = |status: &str| matches!(status, "TASLAK" | "SPK_APPLICATION" | "ERTELENDİ" | "İPTAL");

        let priority = |r: &IpoRecord| -> u8 {
            if is_active_or_approved(&r.status) {
                0
            } else if is_draft(&r.status) {
                2
            } else {
                1
            }
        };

        let prio_a = priority(a);
        let prio_b = priority(b);

        if prio_a != prio_b {
            return prio_a.cmp(&prio_b);
        }

        let to_iso = |date_str: &str| -> String {
            if crate::ipo_store::looks_like_iso_date(date_str) {
                date_str.to_string()
            } else {
                let parsed = crate::ipo_scraper::parse_turkish_date(date_str);
                if crate::ipo_store::looks_like_iso_date(&parsed) {
                    parsed
                } else {
                    date_str.to_string()
                }
            }
        };

        // Aynı grup içindeki sıralama:
        if prio_a == 0 {
            // SPK Onaylı / Yaklaşanlar: ISO onay tarihi veya ipo_date'e göre en yeni üstte
            let date_a_raw = a.spk_approval_date.as_deref().unwrap_or(&a.ipo_date);
            let date_b_raw = b.spk_approval_date.as_deref().unwrap_or(&b.ipo_date);
            let date_a = to_iso(date_a_raw);
            let date_b = to_iso(date_b_raw);
            date_b.cmp(&date_a).then_with(|| b.spk_bulletin_no.cmp(&a.spk_bulletin_no))
        } else if prio_a == 1 {
            // Tamamlananlar: ISO tarihi en yeniden eskiye
            let a_iso = crate::ipo_store::looks_like_iso_date(&a.ipo_date);
            let b_iso = crate::ipo_store::looks_like_iso_date(&b.ipo_date);
            b_iso.cmp(&a_iso).then_with(|| b.ipo_date.cmp(&a.ipo_date))
        } else {
            // Taslaklar ve ertelenenler: isim sırasına göre
            a.company_name.cmp(&b.company_name)
        }
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
    // Pipeline çalıştır: tüm kaynakları paralel çeker
    let pipeline_result = crate::ipo_pipeline::run_full_pipeline(client).await;
    let mut archive = crate::ipo_store::load();

    // Pipeline sonuçlarını birleştir (SPK > KAP > halkarz.com)
    let mut pipeline_changed = crate::ipo_pipeline::merge_pipeline_into_archive(
        &mut archive,
        &pipeline_result,
    );

    // Onay bültende göründükten sonra arzın geri kalanı günler içinde KAP'a
    // damla damla düşüyor: kesin fiyat, katılımcı sayısı, ilk işlem tarihi,
    // endeks üyeliği. İzleme turu bunları kullanıcı bir şey yapmadan toplar.
    // Pipeline'dan **sonra** çalışır: yeni onay önce kayda dönüşmeli ki aynı
    // turda izlemeye girebilsin.
    pipeline_changed |=
        crate::ipo_follow::follow_round(client, &mut archive, &pipeline_result.kap_scan).await;

    if pipeline_changed {
        crate::ipo_store::save(&archive);
    }

    let pipeline_ok = pipeline_result.errors.is_empty();
    if !pipeline_result.errors.is_empty() {
        eprintln!("[ipo_pipeline] hatalar: {:?}", pipeline_result.errors);
    }

    (archive_to_records(archive), pipeline_ok)
}

/// Geçmiş yıl arşivlerinin taranacağı başlangıç yılı ve tekrar aralığı.
///
/// 2021'e kadar inilir: tohum dosyasındaki eski kayıtların bir kısmı uydurma
/// tarih taşıyor (Boğaziçi Beton 2021'de arz edildiği hâlde "2024-02-22"
/// yazıyordu) ve yalnız kendi yılının arşivinde bulunabildikleri için ancak
/// pencere o yıla uzandığında gerçek veriyle düzeliyorlar.
const BACKFILL_START_YEAR: i32 = 2021;
const BACKFILL_INTERVAL_DAYS: i64 = 7;

fn backfill_meta_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join(".fraude_ipos_meta.json"))
}

/// Bir sonraki backfill'in ne yapacağı.
enum BackfillPlan {
    /// Sıra gelmedi.
    Skip,
    /// Takvim gereği: yalnız arşivde eksik olan kayıtların detayı çekilir.
    Incremental,
    /// Ayrıştırıcı değişti: her kaydın detay sayfası yeniden okunur.
    ///
    /// Sürüm damgası yalnız "çalış" demeye yetmiyor — eksiksiz görünen eski
    /// kayıtlar atlandığı için düzeltmeler (ayraçsız konsorsiyum unvanları,
    /// yanlış TAMAMLANDI durumu) onlara hiç ulaşmıyordu.
    Full,
}

fn backfill_plan() -> BackfillPlan {
    let Some(path) = backfill_meta_path() else { return BackfillPlan::Skip };
    let meta = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok());

    let version = meta
        .as_ref()
        .and_then(|v| v.get("parser_version").and_then(serde_json::Value::as_u64));
    if version != Some(DETAIL_PARSER_VERSION) {
        return BackfillPlan::Full;
    }

    let last = meta
        .as_ref()
        .and_then(|v| v.get("last_backfill").and_then(|d| d.as_str().map(String::from)));

    match last {
        Some(date) => {
            let cutoff = (chrono::Local::now() - chrono::Duration::days(BACKFILL_INTERVAL_DAYS))
                .format("%Y-%m-%d")
                .to_string();
            if date.as_str() < cutoff.as_str() {
                BackfillPlan::Incremental
            } else {
                BackfillPlan::Skip
            }
        }
        None => BackfillPlan::Full,
    }
}

fn mark_backfill_done() {
    if let Some(path) = backfill_meta_path() {
        let meta = serde_json::json!({
            "last_backfill": chrono::Local::now().format("%Y-%m-%d").to_string(),
            "parser_version": DETAIL_PARSER_VERSION,
        });
        let _ = std::fs::write(&path, meta.to_string());
    }
}

/// Detay ayrıştırıcısının sürümü. Yeni alan eklendiğinde artırılır; arşivdeki
/// kayıtlar bir kez daha detay sayfasından tazelenir.
const DETAIL_PARSER_VERSION: u64 = 3;

/// Bir kaydın detay sayfasının tekrar çekilmesine gerek olmadığını söyler.
///
/// Eskiden ölçüt yalnız `book_building_dates` idi: talep toplama tarihi olan
/// her kayıt "tam" sayılıp atlanıyor, pazar/tahsisat/dağıtım tablosu gibi
/// alanlar hiç dolmuyordu. Artık tamamlanmış bir arzda beklenen çekirdek
/// alanların hepsi aranır.
fn detail_is_complete(ipo: &crate::ipo_store::PersistedIpo) -> bool {
    let core_filled = ipo.book_building_dates.is_some()
        && ipo.distribution_type.is_some()
        && ipo.market.is_some()
        && ipo.lot_amount.is_some()
        && ipo.consortium_lead.is_some()
        && ipo.distribution_ratios.is_some();

    // Tamamlanmış arzlarda ayrıca ilk işlem tarihi ve dağıtım tablosu beklenir.
    if ipo.status == "TAMAMLANDI" {
        return core_filled && ipo.trading_start_date.is_some() && ipo.results_table.is_some();
    }
    core_filled
}

/// Yıl arşivi sayfalarını (halkarz.com/k/halka-arz/{yıl}/) tarayarak ana
/// sayfadan düşmüş eski halka arzları arşive ekler ve detay alanları eksik
/// kayıtları (talep toplama, ilk işlem tarihi, dağıtım türü, katılımcı)
/// tamamlar. Haftada bir kez çalışır; detayları zaten tam olan kayıtların
/// detay sayfası tekrar çekilmez. Arşiv değiştiyse true döner.
pub async fn backfill_ipo_history(client: &reqwest::Client) -> bool {
    let plan = match backfill_plan() {
        BackfillPlan::Skip => return false,
        plan => plan,
    };

    let mut archive = crate::ipo_store::load();
    let skip_details: std::collections::HashSet<String> = match plan {
        BackfillPlan::Full => std::collections::HashSet::new(),
        _ => archive
            .iter()
            .filter(|p| detail_is_complete(p))
            .map(|p| p.ticker.clone())
            .collect(),
    };

    let current_year = chrono::Datelike::year(&chrono::Local::now());
    let mut changed = false;

    for year in BACKFILL_START_YEAR..=current_year {
        let scraped = crate::ipo_scraper::scrape_year_archive(client, year, &skip_details).await;
        eprintln!("[ipo] {year} arşivi: {} kayıt tarandı", scraped.len());
        if !scraped.is_empty() {
            changed |= crate::ipo_store::merge_scraped(&mut archive, &scraped);
        }
    }

    // Bölünme çarpanları SPK arşivinden okunduğu için bültenler önce
    // taranır; sıra ters olursa yeni onaylar bir tur geç yansır.
    let (increases, approvals) = crate::spk::backfill_spk_bulletins(client).await;
    if increases > 0 || approvals > 0 {
        eprintln!("[spk] arşive {increases} sermaye artırımı, {approvals} halka arz onayı işlendi");
    }

    // Aşağıdaki iki tur ile bu çağrıdan hemen önce çalışan halka arz izleme
    // turu **aynı** gövde ucunu ve aynı hız sınırını paylaşıyor. Aralarında
    // pencere beklenmezse ilk tur bütçenin tamamını yakar ve sonrakiler hiç
    // ilerlemez; temettü arşivi tam olarak bu yüzden boş kalmıştı.
    crate::kap_capital::body_cooldown().await;

    // Bültenin göremediği artırımlar KAP'tan gelir: kayıtlı sermaye
    // sistemindeki şirketler iç kaynaklı bedelsizi yönetim kurulu kararıyla
    // yapıyor ve bülten onay tablosunda yayımlanmıyor. Gövde ucunun kotası
    // yüzünden tur bütçeli; her hafta boşluk biraz daha kapanır.
    crate::kap_capital::backfill_round(client).await;

    // Temettü taraması buradan **çağrılmaz**: haftalık backfill'e bağlıyken
    // tur başına 10 bildirim okuyabiliyordu ve KAP haftada ~43 temettü
    // bildirimi yayımlıyor — arşiv kapanmak şöyle dursun akışın gerisine
    // düşüyordu. Kendi döngüsüne taşındı: bkz. [`crate::kap_dividend::crawl`].

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

/// Olay listesinden çıkan çarpanı Yahoo'nun kendi fiyat serisiyle doğrular.
///
/// Yahoo'nun `close` serisi bölünmelere göre geriye dönük düzeltilmiştir:
/// arz günündeki kapanış, o günkü gerçek fiyatın çarpana bölünmüş hâlidir.
/// Buradan bağımsız bir "ima edilen çarpan" çıkar:
/// `arz fiyatı / arz günü düzeltilmiş kapanış`.
///
/// İki kaynak birbirini tutuyorsa olay listesi kullanılır — o kesin değerdir,
/// ima edilen çarpan ilk gün hareketi kadar sapar. Tutmuyorsa seri kazanır;
/// olay listesi bozuk olabiliyor:
///
/// * EUREN — olaylar ×12,44 diyor, bu ilk gün ₺16,25 → ₺49,37 (%204) demek
///   olurdu; BIST'te günlük marj ±%10. Seri ×4,09 diyor, o da ilk günü
///   ₺16,23'e koyuyor: arz fiyatının tam üstüne.
/// * KTLEV — üç kayıt çarpılınca ×937,9 çıkıyor, getiri %304.256 görünüyordu.
///
/// Bant, ilk gün hareketini (birkaç gün üst üste tavan olabilir) tolere
/// edecek kadar geniş, mertebe hatasını yakalayacak kadar dar.
const SPLIT_AGREEMENT_BAND: std::ops::RangeInclusive<f64> = 0.5..=2.5;

fn reconcile_split_factor(event_factor: f64, ipo_price: f64, reference_close: Option<f64>) -> f64 {
    let Some(reference) = reference_close.filter(|c| *c > 0.0) else {
        // Yahoo'nun serisi arz gününü kapsamıyor (bazı hisselerde veri aylar
        // sonra başlıyor); doğrulanamayan çarpan olduğu gibi bırakılır.
        return event_factor;
    };
    if ipo_price <= 0.0 {
        return event_factor;
    }

    let implied = ipo_price / reference;
    if !implied.is_finite() || implied <= 0.0 {
        return event_factor;
    }

    if SPLIT_AGREEMENT_BAND.contains(&(event_factor / implied)) {
        event_factor
    } else {
        // Çarpan 1'in altına düşemez: arz sonrası bölünme pay sayısını azaltmaz.
        implied.max(1.0)
    }
}

/// Arz gününe ait düzeltilmiş kapanışı **günlük** seriden okur.
///
/// Aylık seri bu iş için kullanılamaz: ay-sonu kapanışını verir. EUREN'de
/// arz günü ₺3,97 iken Haziran 2022 ay-sonu ₺6,65; ima edilen çarpan 1,7 kat
/// kayıyor. Pencere dar tutulur — arz gününden itibaren üç hafta içinde veri
/// yoksa hisse için doğrulama yapılmaz.
async fn fetch_ipo_reference_close(
    client: &reqwest::Client,
    ticker: &str,
    ipo_date: &str,
) -> Option<f64> {
    let start = chrono::NaiveDate::parse_from_str(ipo_date, "%Y-%m-%d")
        .ok()?
        .and_hms_opt(0, 0, 0)?
        .and_utc()
        .timestamp();
    let end = start + 21 * 24 * 60 * 60;

    let symbol = if ticker.ends_with(".IS") { ticker.to_string() } else { format!("{ticker}.IS") };
    let url = format!(
        "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?period1={start}&period2={end}&interval=1d"
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
    let parsed: YahooChartResponse = serde_json::from_str(&body).ok()?;

    parsed
        .chart?
        .result?
        .into_iter()
        .next()?
        .indicators?
        .quote?
        .into_iter()
        .next()?
        .close?
        .into_iter()
        .flatten()
        .find(|c| *c > 0.0)
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
    let pending: Vec<(usize, String, String, f64)> = archive
        .iter()
        .enumerate()
        .filter(|(_, p)| p.status != "TASLAK" && crate::ipo_store::looks_like_iso_date(&p.ipo_date))
        .filter(|(_, p)| p.split_checked.as_deref() != Some(today.as_str()))
        .map(|(i, p)| (i, p.ticker.clone(), p.ipo_date.clone(), p.price))
        .collect();

    if pending.is_empty() {
        return false;
    }

    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(6));
    let mut tasks = Vec::new();
    // SPK arşivi asıl kaynaktır; Yahoo yalnız o hisse için resmî kayıt
    // bulunmadığında devreye girer.
    let capital_archive = std::sync::Arc::new(crate::capital_store::load());

    for (idx, ticker, ipo_date, ipo_price) in pending {
        let client = client.clone();
        let permit = semaphore.clone();
        let capital_archive = capital_archive.clone();
        tasks.push(tokio::spawn(async move {
            let _permit = permit.acquire().await.ok()?;

            let official = crate::capital_store::bonus_factor_since(&capital_archive, &ticker, &ipo_date);
            if official > 1.0 {
                return Some((idx, official));
            }

            let events = fetch_chart_events(&client, &ticker).await.ok()?;
            let from_events = split_factor_since(&events.splits, &ipo_date);
            let reference = fetch_ipo_reference_close(&client, &ticker, &ipo_date).await;
            let factor = reconcile_split_factor(from_events, ipo_price, reference);
            if (factor - from_events).abs() > f64::EPSILON {
                eprintln!(
                    "[ipo] {ticker}: bölünme çarpanı olay listesine göre ×{from_events:.2}, \
                     fiyat serisine göre ×{factor:.2} — seri kullanıldı"
                );
            }
            Some((idx, factor))
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
/// Akışta tutulan pencereler: temettüler 24 ay, sermaye artırımları 10 yıl
/// geriye. Artırım penceresi SPK arşiviyle aynı derinlikte tutulur; daha dar
/// bir pencere resmî kaynaktan gelen kayıtları listede kırpardı.
const DIVIDEND_WINDOW_MONTHS: i64 = 24;
const SPLIT_WINDOW_YEARS: i64 = 10;

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
    // Verim fiyat serisinden hesaplanıyor ve yalnız Yahoo'da var; resmî kayıt
    // aynı ödemeyi devraldığında verimi buradan alır.
    let mut dividend_yields: std::collections::HashMap<(String, String), f64> =
        std::collections::HashMap::new();

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
            dividend_yields.insert((ticker.clone(), ex_date.clone()), yield_pct);
            dividends.push(DividendRecord {
                ticker: ticker.clone(),
                period: ex_date.get(..4).unwrap_or("?").to_string(),
                ex_date,
                amount_per_share: d.amount,
                yield_pct,
                installment: 0,
                source: YAHOO_SOURCE.to_string(),
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

    // Resmî kayıtlar Yahoo satırlarının yerini alır. Arşiv bir kez okunur:
    // iki bindirme de aynı dosyadan besleniyor.
    let archive = crate::capital_store::load();
    let splits = overlay_with(splits, &archive, &split_cutoff);
    let today_iso = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut dividends = overlay_official_dividends(dividends, &archive, &div_cutoff, &today_iso);

    // Verim, resmî kayıtlarda boş gelir (KAP tutarı verir, fiyatı vermez);
    // aynı hisse-tarih için Yahoo'nun hesapladığı verim varsa devralınır.
    for record in dividends.iter_mut().filter(|d| d.yield_pct == 0.0) {
        if let Some(value) = dividend_yields.get(&(record.ticker.clone(), record.ex_date.clone())) {
            record.yield_pct = *value;
        }
    }

    dividends.sort_by(|a, b| b.ex_date.cmp(&a.ex_date));
    let mut splits = splits;
    splits.sort_by(|a, b| b.date.cmp(&a.date));
    assign_installments(&mut dividends);

    // Yaklaşan temettü takviminin kaynağı KAP'tır: hak kullanım tarihini
    // **kesinleşmiş** olarak veriyor. Yahoo yalnız KAP'ın henüz okumadığı
    // hisseler için devrede kalır ve erişilemediğinde takvim bundan etkilenmez.
    let official_upcoming = upcoming_from_official(&archive, &today_iso);
    let covered: std::collections::HashSet<&str> =
        official_upcoming.iter().map(|u| u.ticker.as_str()).collect();

    let mut upcoming: Vec<crate::domain::UpcomingDividend> =
        match fetch_upcoming_dividends(&tickers_snapshot).await {
            Some(list) => list,
            // Yahoo düştüğünde önceki turun **Yahoo kaynaklı** satırları
            // korunur; KAP'tan gelenler zaten aşağıda yeniden üretiliyor ve
            // tümünü geri yüklemek silinmiş bir ödemeyi diriltirdi.
            None => load_market_events()
                .upcoming
                .into_iter()
                .filter(|u| u.ex_date.as_str() > today_iso.as_str())
                .collect(),
        };
    upcoming.retain(|u| !covered.contains(u.ticker.as_str()));
    upcoming.extend(official_upcoming);
    upcoming.sort_by(|a, b| a.ex_date.cmp(&b.ex_date));

    // Yaklaşan ödeme, aynı yıl içinde ödenenlerin devamı: kaçıncı taksit?
    for u in upcoming.iter_mut() {
        // KAP taksitli dağıtımda numarayı kendisi veriyor ("2. Taksit").
        // Sayımla bulunamaz: taksitlerin tamamı gelecekte olduğunda geçmiş
        // ödeme yok ve beşi birden "1. taksit" görünürdü.
        if u.installment > 0 {
            continue;
        }
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

    // Ayrı istemci: crumb akışı kendi çerez oturumunu ister. Ortak yapılandırma
    // (sıkıştırma, havuz) `http_client_builder`'dan gelir; yalnız çerez deposu
    // ve daha kısa zaman aşımı eklenir.
    let client = crate::http_client_builder()
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
    // Crumb, noktalama içerebilen kısa bir jetondur; **boşluk içermez**.
    // Uç sınıra takıldığında gövdede düz metin "Too Many Requests" dönüyor:
    // 18 karakter, '<' yok, uzunluk sınırının altında — eski denetim bunu
    // geçerli jeton sanıp her sorguya ekliyordu ve tüm istekler sessizce
    // başarısız oluyordu.
    let crumb = crumb.trim().to_string();
    let plausible = !crumb.is_empty()
        && crumb.len() <= 40
        && !crumb.chars().any(|c| c.is_whitespace() || c == '<');
    if !plausible {
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
            // Buraya kadar gelen istek **yanıtlanmıştır**; temettü tarihi
            // bulunmaması ayrı bir sonuçtur. İkisi aynı `None` ile temsil
            // edilince bloklanan uç "hiçbir hisse temettü vermiyor" gibi
            // görünüyordu.
            let result = v.get("quoteSummary")?.get("result")?.get(0)?.clone();
            let found = result
                .get("calendarEvents")
                .and_then(|c| c.get("exDividendDate"))
                .and_then(|d| d.get("raw"))
                .and_then(serde_json::Value::as_i64)
                .map(|ex_ts| {
                    let annual_rate = result
                        .get("summaryDetail")
                        .and_then(|s| s.get("dividendRate"))
                        .and_then(|r| r.get("raw"))
                        .and_then(serde_json::Value::as_f64);
                    (ticker, timestamp_to_date(ex_ts), annual_rate)
                });
            Some(found)
        }));
    }

    let mut upcoming = Vec::new();
    let mut responded = 0usize;
    let total = tasks.len();
    for res in join_all(tasks).await {
        // `Ok(None)`: istek ya da çözümleme düştü — yanıt sayılmaz.
        let Ok(Some(item)) = res else { continue };
        responded += 1;
        if let Some((ticker, ex_date, annual_rate)) = item {
            if ex_date.as_str() >= today.as_str() {
                upcoming.push(crate::domain::UpcomingDividend {
                    ticker,
                    ex_date,
                    annual_rate,
                    installment: 0,
                    gross_per_share: None,
                    official: false,
                });
            }
        }
    }
    // Uç bloklandığında hiçbir sorgu yanıtlanmaz; bunu "temettü yok" diye
    // kaydetmek mevcut takvimi siliyordu.
    if responded < total / 2 {
        return None;
    }

    upcoming.sort_by(|a, b| a.ex_date.cmp(&b.ex_date));
    Some(upcoming)
}

#[cfg(test)]
mod tests {
    use super::{effective_status, reconcile_split_factor, spk_to_record};

    fn spk_row(company: &str, date: &str, existing: f64, bonus: f64, rights: f64) -> crate::spk::SpkCapitalIncrease {
        crate::spk::SpkCapitalIncrease {
            company_name: company.into(),
            existing_capital: existing,
            new_capital: existing + bonus + rights,
            rights_amount: rights,
            bonus_internal: bonus,
            bonus_profit: 0.0,
            sale_type: None,
            bulletin_no: "2026/48".into(),
            approval_date: date.into(),
        }
    }

    /// Yahoo'nun split akışında bedelli hiç yok; SPK kaydı BEDELLİ olarak
    /// görünmeli ve kaynağı bülten numarasını taşımalı.
    #[test]
    fn rights_issue_is_labelled_and_sourced_from_the_bulletin() {
        let record = spk_to_record("CVKMD", &spk_row("CVK", "2026-01-15", 1_400_000_000.0, 0.0, 2_380_000_000.0));
        assert_eq!(record.increase_type, "BEDELLİ");
        assert_eq!(record.ratio, "%170");
        assert_eq!(record.source, "SPK Bülteni 2026/48");
        assert_eq!(record.date, "2026-01-15");
    }

    fn yahoo_row(ticker: &str, date: &str) -> crate::domain::CapitalIncrease {
        crate::domain::CapitalIncrease {
            ticker: ticker.into(),
            date: date.into(),
            increase_type: "BEDELSİZ".into(),
            ratio: "200:100 (%100)".into(),
            rights_price: None,
            source: "Yahoo Finance".into(),
        }
    }

    /// SPK kaydı olan hissede Yahoo satırları tamamen düşer — tarihler
    /// (onay / gerçekleşme) tutmadığı için aynı artırım iki kez listelenirdi.
    /// Tek bültenlik kaydı arşive işleyen test yardımcısı.
    fn archive_of(rows: Vec<crate::spk::SpkCapitalIncrease>) -> crate::capital_store::CapitalArchive {
        let mut archive = crate::capital_store::CapitalArchive::default();
        for row in rows {
            crate::capital_store::merge_bulletin(
                &mut archive,
                crate::capital_store::BulletinExtract {
                    bulletin_no: row.bulletin_no.clone(),
                    increases: vec![row],
                    approvals: Vec::new(),
                },
            );
        }
        archive
    }

    #[test]
    fn official_records_replace_yahoo_rows_for_the_same_ticker() {
        let archive = archive_of(vec![
            spk_row("Katılımevim Tasarruf Finansman AŞ", "2026-07-29", 2_070_000_000.0, 4_930_000_000.0, 0.0),
        ]);

        let merged = super::overlay_with(
            vec![yahoo_row("KTLEV", "2026-08-03"), yahoo_row("ASELS", "2026-05-01")],
            &archive,
            "2020-01-01",
        );

        let ktlev: Vec<_> = merged.iter().filter(|r| r.ticker == "KTLEV").collect();
        assert_eq!(ktlev.len(), 1, "aynı artırım iki kez listelenmemeli");
        assert!(ktlev[0].source.starts_with("SPK"), "{}", ktlev[0].source);

        // SPK'da olmayan hisse Yahoo'dan gelmeye devam eder
        assert!(merged.iter().any(|r| r.ticker == "ASELS" && r.source == "Yahoo Finance"));
    }

    /// Artırım pay gruplarının hepsini ilgilendirir: resmî kayıt bir koda
    /// bağlansa da kardeş kodların Yahoo satırı düşmeli, yoksa aynı olay
    /// listede iki kez, iki ayrı tarih ve kaynakla görünür.
    #[test]
    fn official_record_covers_every_share_class_of_the_company() {
        let archive = archive_of(vec![
            spk_row("Türkiye İş Bankası AŞ", "2026-02-22", 100.0, 150.0, 0.0),
        ]);

        let merged = super::overlay_with(
            vec![yahoo_row("ISCTR", "2026-02-27"), yahoo_row("ISATR", "2026-02-27")],
            &archive,
            "2020-01-01",
        );

        assert!(
            merged.iter().all(|r| r.source.starts_with("SPK")),
            "kardeş pay gruplarının Yahoo satırı kalmamalı: {merged:#?}"
        );
        assert_eq!(merged.len(), 1);
    }

    fn kap_dividend(ticker: &str, ex_date: &str, gross: f64) -> crate::kap_dividend::KapDividend {
        crate::kap_dividend::KapDividend {
            ticker: ticker.into(),
            ex_date: ex_date.into(),
            gross_per_share: gross,
            net_per_share: gross * 0.85,
            payment_date: None,
            payment_kind: "Peşin".into(),
            disclosure_index: "1617428".into(),
        }
    }

    fn yahoo_dividend(ticker: &str, ex_date: &str, amount: f64) -> crate::domain::DividendRecord {
        crate::domain::DividendRecord {
            ticker: ticker.into(),
            ex_date: ex_date.into(),
            amount_per_share: amount,
            yield_pct: 4.2,
            period: ex_date[..4].into(),
            installment: 0,
            source: super::YAHOO_SOURCE.into(),
        }
    }

    /// Kapsama **hisse + tarih** düzeyinde olmalı. Hisseyi tümden kapsamak,
    /// KAP taraması bütçeli ilerlediği için henüz okunmamış ödemeleri listeden
    /// silerdi.
    #[test]
    fn official_dividends_replace_only_the_same_payment() {
        let mut archive = crate::capital_store::CapitalArchive::default();
        archive.dividends.push(kap_dividend("ARASE", "2026-06-24", 2.0));

        let merged = super::overlay_official_dividends(
            vec![
                yahoo_dividend("ARASE", "2026-06-24", 1.98),
                yahoo_dividend("ARASE", "2025-06-20", 1.20),
                yahoo_dividend("EREGL", "2026-05-01", 3.0),
            ],
            &archive,
            "2024-01-01",
            "2026-08-08",
        );

        let arase_2026: Vec<_> = merged
            .iter()
            .filter(|d| d.ticker == "ARASE" && d.ex_date == "2026-06-24")
            .collect();
        assert_eq!(arase_2026.len(), 1, "aynı ödeme iki kez listelenmemeli");
        assert!(arase_2026[0].source.starts_with("KAP"));
        assert_eq!(arase_2026[0].amount_per_share, 2.0, "brüt tutar resmî kaynaktan");

        // Henüz okunmamış ödemeler ve başka hisseler yerinde kalır.
        assert!(merged.iter().any(|d| d.ex_date == "2025-06-20" && d.source == super::YAHOO_SOURCE));
        assert!(merged.iter().any(|d| d.ticker == "EREGL"));
    }

    /// Hak kullanımı gelecekte olan ödeme geçmiş listesine değil, yaklaşan
    /// temettü takvimine ait.
    #[test]
    fn future_dated_official_dividends_go_to_the_calendar() {
        let mut archive = crate::capital_store::CapitalArchive::default();
        archive.dividends.push(kap_dividend("ARASE", "2026-09-15", 2.0));

        let merged = super::overlay_official_dividends(Vec::new(), &archive, "2024-01-01", "2026-08-08");
        assert!(merged.is_empty(), "gelecek ödeme geçmiş listesine girmemeli");

        let upcoming = super::upcoming_from_official(&archive, "2026-08-08");
        assert_eq!(upcoming.len(), 1);
        assert_eq!(upcoming[0].ticker, "ARASE");
        assert_eq!(upcoming[0].ex_date, "2026-09-15");
        // KAP yıllık oran vermiyor; uydurulmaz.
        assert_eq!(upcoming[0].annual_rate, None);
        // Ama o ödemenin brüt tutarını veriyor — takvimde "—" görünmemeli.
        assert_eq!(upcoming[0].gross_per_share, Some(2.0));
        assert!(upcoming[0].official);
    }

    /// Taksit numarası bildirimin kendisinde yazıyor; sayımla bulunamaz çünkü
    /// taksitlerin tamamı gelecekte olduğunda geçmiş ödeme kaydı yok.
    #[test]
    fn installment_numbers_come_from_the_disclosure() {
        let mut archive = crate::capital_store::CapitalArchive::default();
        for (ex_date, kind) in [("2026-08-20", "1. Taksit"), ("2026-10-20", "2. Taksit")] {
            let mut row = kap_dividend("BEGYO", ex_date, 0.03);
            row.payment_kind = kind.into();
            archive.dividends.push(row);
        }
        archive.dividends.push(kap_dividend("ARASE", "2026-09-15", 2.0));

        let upcoming = super::upcoming_from_official(&archive, "2026-08-08");
        let numbered: Vec<u32> = upcoming
            .iter()
            .filter(|u| u.ticker == "BEGYO")
            .map(|u| u.installment)
            .collect();
        assert_eq!(numbered, vec![1, 2]);
        // Peşin ödemede taksit yok; numara akış tarafında sayımla veriliyor.
        assert_eq!(upcoming.iter().find(|u| u.ticker == "ARASE").unwrap().installment, 0);
    }

    /// Pencere dışındaki resmî kayıt listeye girmemeli.
    #[test]
    fn official_records_outside_the_window_are_dropped() {
        let archive = archive_of(vec![
            spk_row("Katılımevim Tasarruf Finansman AŞ", "2017-01-01", 100.0, 100.0, 0.0),
        ]);

        let merged = super::overlay_with(vec![yahoo_row("KTLEV", "2026-08-03")], &archive, "2020-01-01");
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].source, "Yahoo Finance", "pencere dışı SPK kaydı devralmamalı");
    }

    #[test]
    fn bonus_and_mixed_increases_are_labelled() {
        let bonus = spk_to_record("KTLEV", &spk_row("K", "2026-01-01", 2_070_000_000.0, 4_930_000_000.0, 0.0));
        assert_eq!(bonus.increase_type, "BEDELSİZ");
        assert_eq!(bonus.ratio, "%238");

        let mixed = spk_to_record("X", &spk_row("X", "2026-01-01", 100.0, 100.0, 50.0));
        assert_eq!(mixed.increase_type, "KARMA");
        assert_eq!(mixed.ratio, "Bedelsiz %100 + Bedelli %50");
    }

    /// İki kaynak uyuşuyorsa olay listesi korunur — kesin değer odur, ima
    /// edilen çarpan ilk gün hareketi kadar sapar.
    ///
    /// ENERY: arz ₺88,76, arz günü düzeltilmiş kapanış ₺1,5724 → ima ×56,45.
    /// Olay listesi ×62,07; oran 1,10 (ilk gün tavanı) — bantta.
    #[test]
    fn agreeing_sources_keep_the_event_factor() {
        assert_eq!(reconcile_split_factor(62.07, 88.76, Some(1.5724)), 62.07);
        assert_eq!(reconcile_split_factor(1.0, 20.0, Some(20.0)), 1.0);
    }

    /// EUREN: olaylar ×12,44 diyor; bu ilk günü ₺49,37 yapardı (arz ₺16,25,
    /// %204) — BIST marjı ±%10 iken imkânsız. Seri ×4,09 diyor ve ilk günü
    /// ₺16,23'e, yani arz fiyatının üstüne koyuyor.
    #[test]
    fn impossible_first_day_move_falls_back_to_the_price_series() {
        let factor = reconcile_split_factor(12.44, 16.25, Some(3.9685));
        assert!((factor - 16.25 / 3.9685).abs() < 1e-9, "çarpan: {factor}");

        // Düzeltilmiş çarpanla ilk gün fiyatı arz fiyatına oturmalı
        assert!((3.9685 * factor - 16.25).abs() < 0.05, "ilk gün: {}", 3.9685 * factor);
    }

    /// KTLEV: üç bozuk kayıt çarpılınca ×937,9 — getiri %304.256 görünüyordu.
    #[test]
    fn corrupt_event_chain_is_rejected() {
        let factor = reconcile_split_factor(937.93, 13.43, Some(3.1603));
        assert!(factor < 5.0, "mertebe hatası elenmeli: {factor}");
    }

    /// Yahoo serisi arz gününü kapsamıyorsa (bazı hisselerde veri aylar sonra
    /// başlıyor) doğrulama yapılamaz; çarpan olduğu gibi bırakılır.
    #[test]
    fn unverifiable_factor_is_left_untouched() {
        assert_eq!(reconcile_split_factor(6.0, 36.2, None), 6.0);
        assert_eq!(reconcile_split_factor(4.0, 0.0, Some(3.0)), 4.0);
        assert_eq!(reconcile_split_factor(4.0, 13.43, Some(0.0)), 4.0);
    }

    /// Arz sonrası bölünme pay sayısını azaltmaz; çarpan 1'in altına inemez.
    #[test]
    fn fallback_factor_never_drops_below_one() {
        assert_eq!(reconcile_split_factor(500.0, 10.0, Some(40.0)), 1.0);
    }

    #[test]
    fn past_dated_open_offering_is_reported_completed() {
        assert_eq!(effective_status("AKTİF", "2026-07-31", None, "2026-08-08"), "TAMAMLANDI");
        assert_eq!(effective_status("TALEP TOPLAMA", "2026-07-31", None, "2026-08-08"), "TAMAMLANDI");
    }

    #[test]
    fn postponed_offering_is_reported_postponed() {
        assert_eq!(effective_status("SPK ONAYLI", "2025-01-16", Some("Ertelendi"), "2026-08-20"), "ERTELENDİ");
        assert_eq!(effective_status("AKTİF", "2026-07-23", Some("İptal Edildi"), "2026-08-20"), "ERTELENDİ");
    }

    /// Yıl arşivi rozetsiz olduğu için içindeki her kaydı TAMAMLANDI sayıyor;
    /// talep toplaması sürenler böyle "bitmiş" görünüyordu.
    #[test]
    fn future_dated_offering_is_never_reported_completed() {
        assert_eq!(effective_status("TAMAMLANDI", "2026-08-14", None, "2026-08-08"), "AKTİF");
    }

    #[test]
    fn undated_drafts_keep_their_status() {
        assert_eq!(effective_status("TASLAK", "Hazırlanıyor...", None, "2026-08-08"), "TASLAK");
        assert_eq!(effective_status("TAMAMLANDI", "2026-08-08", None, "2026-08-08"), "TAMAMLANDI");
    }

    /// Bir yıl arşivinin tamamını gerçekten gezip detayları doldurduğunu
    /// doğrular. Kapsam (kaç arz) ve zenginlik (kaç alan dolu) birlikte
    /// ölçülür — sayfalama koptuğunda kayıt sayısı, ayrıştırıcı koptuğunda
    /// alan doluluğu düşer.
    #[tokio::test]
    #[ignore = "canlı halkarz.com erişimi gerektirir"]
    async fn live_year_archive_is_fully_scraped() {
        let client = reqwest::Client::new();
        let empty = std::collections::HashSet::new();

        for year in [2023, 2024, 2025] {
            let scraped = crate::ipo_scraper::scrape_year_archive(&client, year, &empty).await;
            let with_market = scraped.iter().filter(|s| s.market.is_some()).count();
            let with_results = scraped.iter().filter(|s| s.results_table.is_some()).count();
            let with_alloc = scraped.iter().filter(|s| s.distribution_ratios.is_some()).count();
            println!(
                "{year}: {} arz | pazar {} | dağıtım tablosu {} | tahsisat {}",
                scraped.len(),
                with_market,
                with_results,
                with_alloc
            );

            assert!(scraped.len() >= 18, "{year}: yalnız {} kayıt", scraped.len());
            assert!(
                with_market * 10 >= scraped.len() * 8,
                "{year}: kayıtların %80'inde pazar bilgisi olmalı ({with_market}/{})",
                scraped.len()
            );
        }
    }

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
            source: super::YAHOO_SOURCE.into(),
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
        assert_eq!(effective_status("TALEP TOPLAMA", "2026-07-10", None, "2026-07-13"), "TAMAMLANDI");
        assert_eq!(effective_status("AKTİF", "2026-07-01", None, "2026-07-13"), "TAMAMLANDI");
        // Bugünkü ve gelecekteki arzlar açık kalır
        assert_eq!(effective_status("TALEP TOPLAMA", "2026-07-13", None, "2026-07-13"), "TALEP TOPLAMA");
        assert_eq!(effective_status("AKTİF", "2026-08-01", None, "2026-07-13"), "AKTİF");
        // Taslaklar ve tarihi çözülemeyenler dokunulmaz
        assert_eq!(effective_status("TASLAK", "2026-01-01", None, "2026-07-13"), "TASLAK");
        assert_eq!(effective_status("TALEP TOPLAMA", "Hazırlanıyor...", None, "2026-07-13"), "TALEP TOPLAMA");
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
