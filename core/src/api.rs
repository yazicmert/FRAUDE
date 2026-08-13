//! Paylaşımlı komut gövdeleri — tek gerçek kaynak.
//!
//! Masaüstü (src-tauri/src/commands.rs) bu fonksiyonları ince `#[tauri::command]`
//! sarmalayıcılarından, web API (server/src/rpc.rs) `/v1/rpc/{komut}` sevkinden
//! çağırır. Komut sözleşmesi burada değişir; iki taraf otomatik aynı kalır.
//! Kişi-başı komutlar (AI anahtarları, ajanlar, izleme) burada DEĞİLDİR —
//! onlar masaüstünde yerel, web'de Faz 2 (Supabase JWT) sonrası sunucuya gelir.

use crate::domain::{
    DashboardSnapshot, FqlResponse, KapAnnouncement, KapFilter, NewsItem, ScreenerRequest,
    ScreenerResult, SyncResult, TickerSnapshot,
};
use crate::{services, AppState};

pub async fn execute_fql(
    state: &AppState,
    command: String,
    active_context: Option<String>,
) -> Result<FqlResponse, String> {
    let mut store = state.store.lock().await;
    services::execute(&mut store, &state.http, &command, active_context).await
}

pub async fn sync_data(state: &AppState, source: String, mode: String) -> Result<SyncResult, String> {
    let force_bist = source == "BIST_INDICES";
    let store_is_empty = state.store.lock().await.equities.is_empty();
    // Endeks üyeliklerini zorla tazeleyen çağrı her zaman tam senkrondur.
    let effective = if force_bist { "full" } else { services::effective_sync_mode(&mode, store_is_empty) };

    if effective == "incremental" {
        // Artımlı: tüm evren yerine iki ucuz toplu fiyat kaynağı (İş Yatırım
        // screener + ~20 global Yahoo isteği) ve KAP/SPK akışları tazelenir.
        let (closes, global_quotes, kap_res, spk_res) = tokio::join!(
            crate::isyatirim::current_closes(&state.http),
            crate::yahoo::fetch_global_quotes(&state.http),
            crate::kap::fetch_kap_announcements(&state.http),
            crate::spk::fetch_latest_bulletins(&state.http)
        );
        let kap = kap_res.unwrap_or_default();
        let spk = spk_res.unwrap_or_default();

        let mut store = state.store.lock().await;
        let updated = crate::yahoo::apply_incremental_prices(&mut store.equities, &closes, &global_quotes);
        if updated > 0 {
            crate::market_cache::save(&store.equities, false);
        }
        if !kap.is_empty() {
            store.kap = kap;
        }
        if !spk.is_empty() {
            store.spk_bulletins = spk;
        }
        services::refresh_source_status(&mut store);
        let market_as_of_ts = global_quotes.iter().filter_map(|quote| quote.as_of_ts).max()
            .or_else(|| (!closes.is_empty()).then(|| chrono::Utc::now().timestamp()));

        return Ok(SyncResult {
            source,
            mode: "incremental".into(),
            status: if updated > 0 { "completed" } else { "partial" }.into(),
            message: if updated > 0 {
                format!("Incremental sync: {} prices refreshed.", updated)
            } else {
                "Incremental sync completed without any fresh market prices.".into()
            },
            updated_records: updated + store.kap.len(),
            market_updated_records: updated,
            market_coverage: None,
            market_as_of_ts,
        });
    }

    let (equities_res, kap_res, spk_res) = tokio::join!(
        crate::yahoo::fetch_all_equities_report(&state.http, force_bist),
        crate::kap::fetch_kap_announcements(&state.http),
        crate::spk::fetch_latest_bulletins(&state.http)
    );
    let report = equities_res;
    let coverage = report.coverage();
    let requested = report.requested;
    let fetched = report.fetched;
    let market_as_of_ts = report.rows.iter().filter_map(|row| row.as_of_ts).max();
    let equities = report.rows;
    let kap = kap_res.unwrap_or_default();
    let spk = spk_res.unwrap_or_default();

    // Lock the mutex briefly only to save the new records
    let mut store = state.store.lock().await;
    let eq_count = equities.len();
    if !equities.is_empty() {
        // Bindirme (merge): bu turda gelmeyen semboller eski değerini korur;
        // hız sınırına takılan kısmi senkron evreni sessizce küçültemez.
        services::merge_equities(&mut store.equities, equities);
        let complete = services::full_sync_is_acceptable(coverage);
        if complete {
            services::record_full_sync();
        }
        // Evren diske yazılır: yeniden açılış ~650 grafik isteğini tekrarlamaz.
        // Kısmi tur da yazılır ama tam senkron damgasını ileri taşımaz.
        crate::market_cache::save(&store.equities, complete);
    }
    if !kap.is_empty() {
        store.kap = kap;
    }
    if !spk.is_empty() {
        store.spk_bulletins = spk;
    }

    services::refresh_source_status(&mut store);

    let complete = services::full_sync_is_acceptable(coverage);
    Ok(SyncResult {
        source,
        mode: "full".into(),
        status: if complete { "completed" } else { "partial" }.into(),
        message: format!(
            "Synced {}/{} market symbols from Yahoo Finance ({:.1}% coverage).",
            fetched, requested, coverage * 100.0
        ),
        updated_records: eq_count + store.kap.len(),
        market_updated_records: eq_count,
        market_coverage: Some(coverage),
        market_as_of_ts,
    })
}

pub async fn get_dashboard_snapshot(state: &AppState) -> Result<DashboardSnapshot, String> {
    // Göstergeler ağdan gelir ve kilit dışında toplanır; store mutex'i yalnızca
    // anlık görüntü kurulurken tutulur. Aksi halde şeridin periyodik yenilemesi
    // store'a ihtiyaç duyan tüm komutları kendi ağ isteği boyunca bekletirdi.
    let market_metrics = services::market_metrics(&state.http).await;
    let store = state.store.lock().await;
    Ok(services::dashboard(&store, market_metrics))
}

pub async fn get_ticker_snapshot(state: &AppState, ticker: String) -> Result<TickerSnapshot, String> {
    let normalized = crate::yahoo::canonical_ticker(&ticker);

    let local_snapshot = {
        let store = state.store.lock().await;
        services::ticker_snapshot(&store, &normalized).ok()
    };

    if let Some(mut snapshot) = local_snapshot {
        // Snapshot'ın temel/teknik alanları yerel store'dan gelir; fiyat katmanı
        // ise enstrüman tipine göre yönlendirilen kısa ömürlü canlı uçtan
        // bindirilir. Ağ başarısızsa doğrulanmış son kayıt korunur.
        let live = crate::live_quotes::get_live_quotes(&state.http, std::slice::from_ref(&normalized))
            .await
            .into_iter()
            .find(|quote| crate::yahoo::canonical_ticker(&quote.ticker) == normalized);
        if let Some(quote) = live {
            snapshot.equity.price = quote.price;
            snapshot.equity.change_pct = quote.change_pct;
            snapshot.equity.as_of_ts = Some(quote.as_of_ts);

            let mut store = state.store.lock().await;
            if let Some(row) = store
                .equities
                .iter_mut()
                .find(|row| crate::yahoo::canonical_ticker(&row.ticker) == normalized)
            {
                row.price = quote.price;
                row.change_pct = quote.change_pct;
                row.as_of_ts = Some(quote.as_of_ts);
            }
        }
        return Ok(snapshot);
    }

    // Yerel evrende yok (örn. sync'ten önce tıklanan yeni halka arz):
    // Yahoo'dan canlı çek; şirket adını IPO arşivinden bulmaya çalış.
    let name = crate::ipo_store::load()
        .iter()
        .find(|p| p.ticker == normalized)
        .map(|p| p.name.clone())
        .unwrap_or_else(|| normalized.clone());

    let equity = crate::yahoo::fetch_equity(&state.http, &normalized, &name)
        .await
        .map_err(|e| format!("{normalized} yerel evrende yok ve canlı veri alınamadı: {e}"))?;

    // Store anahtarı her varlık sınıfında kanonik sağlayıcı sembolüdür.
    let store_key = normalized.as_str();
    let mut store = state.store.lock().await;
    if !store.equities.iter().any(|row| row.ticker == store_key) {
        let mut cached = equity.clone();
        cached.ticker = store_key.to_string();
        store.equities.push(cached);
    }
    let kap = services::filter_kap(
        &store,
        crate::domain::KapFilter { ticker: Some(normalized), category: None, limit: Some(5) },
    );

    Ok(TickerSnapshot {
        technical_summary: services::technical_summary(&equity),
        fundamental_summary: services::fundamental_summary(&equity),
        equity,
        kap,
    })
}

/// Mali tablolar. `currency` "TRY" (varsayılan) ya da "USD"; çeviriyi sağlayıcı
/// UMS 21'e uygun yapar (gelir tablosu ortalama, bilanço dönem sonu kuruyla).
pub async fn get_financial_statements(
    state: &AppState,
    ticker: String,
    currency: Option<String>,
) -> Result<crate::domain::FinancialStatement, String> {
    let currency = crate::fundamentals::Currency::parse(currency.as_deref());
    crate::fundamentals::get_financial_statements(&state.http, &ticker, currency).await
}

pub async fn run_screener(state: &AppState, request: ScreenerRequest) -> Result<ScreenerResult, String> {
    let store = state.store.lock().await;
    let query = match request.market {
        Some(market) => format!("{market} {}", request.query),
        None => request.query,
    };
    Ok(services::run_screener_query(&store, &query))
}

pub async fn list_kap_announcements(
    state: &AppState,
    filter: KapFilter,
) -> Result<Vec<KapAnnouncement>, String> {
    let store = state.store.lock().await;
    Ok(services::filter_kap(&store, filter))
}

pub async fn get_price_history(
    state: &AppState,
    ticker: String,
    range: Option<String>,
    source: Option<String>,
) -> Result<Vec<crate::domain::HistoricalQuote>, String> {
    let r = range.unwrap_or_else(|| "6mo".to_string());
    // Kullanıcı grafikte "İş Yatırım" kaynağını seçtiyse fiyat serisi oradan
    // gelir (düzeltilmiş kapanış-only). Yalnızca BIST hisseleri için anlamlıdır;
    // frontend seçiciyi zaten yalnız BIST sembollerinde gösterir.
    if source.as_deref() == Some("isyatirim") {
        return crate::isyatirim_price::fetch_price_history(&state.http, &ticker, &r).await;
    }
    // X ile başlayan BIST endeksleri kısa vadede Borsa İstanbul'dan gelir;
    // 'max', '5y', '1y' gibi çok yıllık uzun dönemlerde Borsa İstanbul grafiği
    // yalnızca son birkaç ayı döndürdüğü için Yahoo Finance tarihselliği kullanılır.
    if ticker.starts_with('X') && !ticker.contains('-') && (ticker.ends_with(".IS") || !ticker.contains('=')) {
        if r != "max" && r != "5y" && r != "1y" {
            if let Ok(rows) = crate::bist::fetch_index_history(&state.http, &ticker, &r).await {
                if !rows.is_empty() {
                    return Ok(rows);
                }
            }
        }
    }
    // GRAM ALTIN / GRAM GÜMÜŞ özel dönüşümü (ons → gram TL) fetch_price_history
    // içinde yapılır; burada erken eşleme yapılırsa TL dönüşümü devre dışı kalır.
    crate::yahoo::fetch_price_history(&state.http, &ticker, &r).await
}

/// BIST resmi tatil takvimi (Nager.Date). Frontend bir kez çekip yerel önbelleğe
/// yazar; piyasa açık/kapalı rozeti bunu kullanır, ağ yoksa gömülü yedeğe düşer.
pub async fn get_market_holidays(
    state: &AppState,
) -> Result<Vec<crate::market_calendar::MarketHoliday>, String> {
    Ok(crate::market_calendar::get_holidays(&state.http).await)
}

/// TEFAS'taki tüm fonlar (yatırım, emeklilik, BYF, gayrimenkul, girişim sermayesi).
pub async fn get_funds(state: &AppState) -> Result<Vec<crate::tefas::FundRow>, String> {
    Ok(crate::tefas::get_funds(&state.http).await)
}

/// Tüm fonların 1 ay / 3 ay / 1 yıl getirileri (ilk çağrı yavaş, 12 sa önbellek).
pub async fn get_fund_returns(state: &AppState) -> Result<Vec<crate::tefas::FundReturns>, String> {
    Ok(crate::tefas::get_fund_returns(&state.http).await)
}

/// Fonun güncel varlık sınıfı dağılımı (yüzde).
pub async fn get_fund_allocation(
    state: &AppState,
    code: String,
) -> Result<Vec<crate::tefas::FundAllocation>, String> {
    crate::tefas::get_fund_allocation(&state.http, &code).await
}

/// Fonun fiyat geçmişi; TEFAS 1 aydan uzun aralığı reddettiğinden aylık parçalanır.
pub async fn get_fund_history(
    state: &AppState,
    code: String,
    months: u32,
) -> Result<Vec<(String, f64)>, String> {
    crate::tefas::get_fund_history(&state.http, &code, months).await
}

/// "Bu hisseyi hangi fonlar tutuyor" yanıtındaki tek satır.
#[derive(Clone, Debug, serde::Serialize)]
pub struct TickerFundRow {
    pub fund_code: String,
    pub fund_name: String,
    pub fund_kind: String,
    /// Fon toplam değerine göre yüzde.
    pub weight_pct: f64,
    /// PDR dönemi ("2026-06").
    pub period: String,
    /// KAP bildirim sayfası.
    pub url: String,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct TickerFundsPayload {
    pub entries: Vec<TickerFundRow>,
    /// Dizinde taranmış toplam PDR raporu sayısı (kapsam göstergesi).
    pub scanned_funds: usize,
}

/// Verilen hisseyi portföyünde taşıyan fonlar, birikmiş PDR dizininden.
/// Ağ yalnız fon adlarını çözmek için (önbellekli liste) kullanılır. Dizin
/// bomboşsa (ilk kurulum) tarama açılış görevini beklemeden hemen başlatılır;
/// eşzamanlılık kilidi kap_pdr içindedir.
pub async fn get_ticker_funds(
    state: &AppState,
    ticker: String,
) -> Result<TickerFundsPayload, String> {
    let (entries, scanned_funds) = crate::kap_pdr::funds_holding_ticker(&ticker);
    let funds = crate::tefas::get_funds(&state.http).await;

    if scanned_funds == 0 && !funds.is_empty() {
        let client = state.http.clone();
        let codes: Vec<String> = funds
            .iter()
            .filter(|f| matches!(f.kind.as_str(), "YAT" | "EMK" | "BYF"))
            .map(|f| f.code.clone())
            .take(80)
            .collect();
        tokio::spawn(async move {
            crate::kap_pdr::crawl_fund_holdings(&client, &codes, 30).await;
        });
    }
    let by_code: std::collections::HashMap<&str, &crate::tefas::FundRow> =
        funds.iter().map(|f| (f.code.as_str(), f)).collect();

    let entries = entries
        .into_iter()
        .map(|entry| {
            let meta = by_code.get(entry.fund_code.as_str());
            TickerFundRow {
                fund_name: meta.map(|f| f.name.clone()).unwrap_or_default(),
                fund_kind: meta.map(|f| f.kind.clone()).unwrap_or_default(),
                fund_code: entry.fund_code,
                weight_pct: entry.weight_pct,
                period: entry.period,
                url: entry.url,
            }
        })
        .collect();

    Ok(TickerFundsPayload { entries, scanned_funds })
}

/// Taranmış (metin içermeyen) PDR PDF'ini kullanıcının varsayılan AI
/// anahtarıyla görüntüden çözer. Maliyet kullanıcının hesabına işlediği için
/// yalnız açık kullanıcı isteğiyle çağrılır; arka plan taraması bunu KULLANMAZ.
pub async fn get_fund_holdings_ai(
    state: &AppState,
    code: String,
) -> Result<crate::kap_pdr::FundHoldingsReport, String> {
    let access = {
        let mut store = state.store.lock().await;
        crate::services::default_ai_access(&mut store)
    }
    .ok_or("Görüntü analizi için Ayarlar › AI Providers'ta etkin bir anahtar gerekli.")?;
    crate::kap_pdr::get_fund_holdings_ai(
        &state.http,
        &code,
        &access.api_url,
        &access.secret,
        &access.model,
    )
    .await
    .map(|report| (*report).clone())
}

/// Fon kurucusunun KAP kaydı: şirket sayfası bağlantısı ve internet adresi.
pub async fn get_fund_issuer(
    state: &AppState,
    fund_name: String,
) -> Result<Option<crate::tefas_issuer::FundIssuer>, String> {
    Ok(crate::tefas_issuer::lookup(&state.http, &fund_name).await)
}

/// Fonun son KAP bildirimleri (son ~4 hafta).
pub async fn get_fund_disclosures(
    state: &AppState,
    code: String,
) -> Result<Vec<crate::kap::FundDisclosure>, String> {
    crate::kap::fund_disclosures(&state.http, &code).await
}

/// Fonun içindeki tek tek varlıklar — son KAP Portföy Dağılım Raporu'ndan.
pub async fn get_fund_holdings(
    state: &AppState,
    code: String,
) -> Result<crate::kap_pdr::FundHoldingsReport, String> {
    crate::kap_pdr::get_fund_holdings(&state.http, &code)
        .await
        .map(|report| (*report).clone())
}

/// Verilen sembollerin enstrüman türüne göre yönlendirilmiş güncel fiyatları.
pub async fn get_live_quotes(
    state: &AppState,
    tickers: Vec<String>,
) -> Result<Vec<crate::live_quotes::LiveQuote>, String> {
    Ok(crate::live_quotes::get_live_quotes(&state.http, &tickers).await)
}

/// Türkiye ekonomik takvimi (TradingEconomics, keysiz).
pub async fn get_economic_calendar(
    state: &AppState,
) -> Result<Vec<crate::economic_calendar::EconomicEvent>, String> {
    Ok(crate::economic_calendar::get_economic_calendar(&state.http).await)
}

pub async fn get_news_feed(state: &AppState, ticker: Option<String>) -> Result<Vec<NewsItem>, String> {
    let mut company = if let Some(symbol) = ticker.as_ref() {
        let store = state.store.lock().await;
        store
            .equities
            .iter()
            .find(|row| row.ticker.eq_ignore_ascii_case(symbol))
            .map(|row| row.name.clone())
    } else {
        None
    };

    if company.is_none() {
        if let Some(sym) = ticker.as_deref() {
            company = match sym {
                "^GSPC" => Some("S&P 500".to_string()),
                "^DJI" => Some("Dow Jones".to_string()),
                "^IXIC" => Some("Nasdaq".to_string()),
                "XU100.IS" => Some("BIST 100".to_string()),
                "XU030.IS" => Some("BIST 30".to_string()),
                _ => None,
            };
        }
    }

    let mut items = services::get_news_feed(&state.http, ticker.as_deref(), company.as_deref()).await?;

    // Apply rule-based news tagging
    let store = state.store.lock().await;
    for item in items.iter_mut() {
        crate::news_tagger::tag_news(item, &store.equities);
    }

    Ok(items)
}

pub async fn get_shareholders(
    state: &AppState,
    ticker: String,
    force_refresh: Option<bool>,
) -> Result<crate::shareholders::ShareholderSnapshot, String> {
    crate::shareholders::get_shareholders(&state.http, &ticker, force_refresh.unwrap_or(false)).await
}

/// KAP Genel Bilgiler sayfasından bağlı ortaklık / iştirak tablosu.
pub async fn get_subsidiaries(
    state: &AppState,
    ticker: String,
    force_refresh: Option<bool>,
) -> Result<crate::subsidiaries::SubsidiarySnapshot, String> {
    crate::subsidiaries::get_subsidiaries(&state.http, &ticker, force_refresh.unwrap_or(false)).await
}

/// Ortaklık yapısındaki bir ortak (şirket ya da gerçek kişi) için haber araması.
/// `kind`: "company" | "person" — kişilerde arama penceresi geniş tutulur.
pub async fn research_entity_news(
    state: &AppState,
    name: String,
    kind: String,
) -> Result<Vec<NewsItem>, String> {
    services::research_entity_news(&state.http, &name, &kind).await
}

pub async fn get_news_preview(state: &AppState, url: String) -> Result<String, String> {
    services::get_news_preview(&state.http, &url).await
}

pub async fn get_news_html(state: &AppState, url: String) -> Result<String, String> {
    services::get_news_html(&state.http, &url).await
}

/// Takvim maddesiyle ilgili haberler. Hata döndürmez: haber bulunamaması
/// takvim satırının açılmasını engellememeli, liste boş görünür.
pub async fn get_calendar_event_news(
    state: &AppState,
    category: String,
    event: String,
    date: String,
    lang: String,
) -> Result<Vec<NewsItem>, String> {
    Ok(crate::calendar_news::get_calendar_event_news(&state.http, &category, &event, &date, &lang).await)
}

pub async fn get_bist_indices(
    state: &AppState,
) -> Result<
    (
        std::collections::HashMap<String, Vec<crate::domain::IndexConstituent>>,
        Vec<crate::domain::IndexChange>,
    ),
    String,
> {
    let store = state.store.lock().await;
    Ok((store.indices.clone(), store.index_changes.clone()))
}

pub async fn update_bist_indices(state: &AppState) -> Result<(), String> {
    let url = "https://borsaistanbul.com/datum/hisse_endeks_ds.csv";
    let resp = state.http.get(url).send().await.map_err(|e| e.to_string())?;
    let text = resp.text().await.map_err(|e| e.to_string())?;

    let mut new_indices: std::collections::HashMap<String, Vec<crate::domain::IndexConstituent>> =
        std::collections::HashMap::new();
    let mut changes: Vec<crate::domain::IndexChange> = Vec::new();
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    for (i, line) in text.lines().enumerate() {
        if i < 2 {
            continue; // skip headers
        }
        let parts: Vec<&str> = line.split(';').collect();
        if parts.len() >= 4 {
            let mut ticker = parts[0].trim().to_string();
            if ticker.ends_with(".E") {
                ticker = ticker.trim_end_matches(".E").to_string();
            }
            let name = parts[1].trim().to_string();
            let index_code = parts[2].trim().to_string(); // INDEX CODE (e.g. XU100)

            new_indices
                .entry(index_code)
                .or_default()
                .push(crate::domain::IndexConstituent { ticker, name });
        }
    }

    let mut store = state.store.lock().await;

    // Compare and find changes
    if !store.indices.is_empty() {
        for (index_name, new_list) in &new_indices {
            if let Some(old_list) = store.indices.get(index_name) {
                let old_tickers: std::collections::HashSet<_> =
                    old_list.iter().map(|c| c.ticker.clone()).collect();
                let new_tickers: std::collections::HashSet<_> =
                    new_list.iter().map(|c| c.ticker.clone()).collect();

                for t in new_tickers.difference(&old_tickers) {
                    changes.push(crate::domain::IndexChange {
                        ticker: t.clone(),
                        index_code: index_name.clone(),
                        action: "ADDED".into(),
                        date: today.clone(),
                    });
                }
                for t in old_tickers.difference(&new_tickers) {
                    changes.push(crate::domain::IndexChange {
                        ticker: t.clone(),
                        index_code: index_name.clone(),
                        action: "REMOVED".into(),
                        date: today.clone(),
                    });
                }
            }
        }
    }

    store.indices = new_indices;
    store.index_changes.extend(changes);
    // keep only last 100 changes
    if store.index_changes.len() > 100 {
        store.index_changes = store.index_changes.clone().into_iter().rev().take(100).collect();
        store.index_changes.reverse();
    }

    store.save_indices();

    // Isı haritası ve bülten filtreleri endeks listesini değil, hisse
    // satırlarındaki index_memberships alanını okur. Aynı CSV üyelik
    // önbelleğine de işlenir ve bellekteki hisseler hemen tazelenir; aksi
    // halde yeni bileşim ancak 30 günlük önbellek dolunca görünür olurdu.
    let fresh = crate::bist_indices::update_from_csv_text(&text);
    if !fresh.memberships.is_empty() {
        for equity in store.equities.iter_mut() {
            let Some(memberships) = fresh.memberships.get(&equity.ticker) else { continue };
            let mut updated = memberships.clone();
            // CSV'de yer almayan sentetik üyelikler (emtia, halka arz) korunur.
            for special in ["Emtialar", "BIST HALKA ARZ"] {
                if equity.index_memberships.iter().any(|m| m == special)
                    && !updated.iter().any(|m| m == special)
                {
                    updated.push(special.to_string());
                }
            }
            equity.index_memberships = updated;
            if let Some(change) = fresh.changes.get(&equity.ticker) {
                equity.index_changes = Some(change.clone());
            }
        }
    }

    Ok(())
}

pub async fn get_corporate_events() -> Result<crate::domain::CorporateEventsPayload, String> {
    let cache = crate::corporate_actions::load_market_events();
    Ok(crate::domain::CorporateEventsPayload {
        ready: cache.last_updated_ts > 0,
        last_updated: cache.last_updated,
        dividends: cache.dividends,
        splits: cache.splits,
        upcoming: cache.upcoming,
    })
}

pub async fn get_kap_for_ticker(
    state: &AppState,
    ticker: String,
) -> Result<Vec<crate::domain::KapAnnouncement>, String> {
    let normalized = ticker.trim().to_uppercase();

    // Önce gerçek KAP: son ~4 haftanın resmi bildirimleri
    if let Ok(items) = crate::kap::ticker_disclosures(&state.http, &normalized).await {
        if !items.is_empty() {
            return Ok(items);
        }
    }

    // KAP'ta yakın dönem bildirimi yoksa (ya da uç yanıt vermediyse) Google
    // News'in KAP aramasıyla daha geriye bakılır.
    // Şirket adı sorguyu güçlendirir: önce evrende, sonra IPO arşivinde ara
    let company = {
        let store = state.store.lock().await;
        store.equities.iter().find(|e| e.ticker == normalized).map(|e| e.name.clone())
    }
    .or_else(|| {
        crate::ipo_store::load()
            .iter()
            .find(|p| p.ticker == normalized)
            .map(|p| p.name.clone())
    });

    let live = services::fetch_kap_disclosures(&state.http, &normalized, company.as_deref())
        .await
        .unwrap_or_default();
    if !live.is_empty() {
        return Ok(live);
    }

    // Canlı arama sonuçsuzsa eşitlenmiş havuzdan süz
    let store = state.store.lock().await;
    Ok(services::filter_kap(
        &store,
        crate::domain::KapFilter { ticker: Some(normalized), category: None, limit: Some(10) },
    ))
}

pub async fn get_dividends(
    state: &AppState,
    ticker: String,
) -> Result<Vec<crate::domain::DividendRecord>, String> {
    crate::corporate_actions::fetch_dividends(&state.http, &ticker).await
}

pub async fn get_capital_increases(
    state: &AppState,
    ticker: String,
) -> Result<Vec<crate::domain::CapitalIncrease>, String> {
    crate::corporate_actions::fetch_capital_increases(&state.http, &ticker).await
}

/// Aracı kurum/banka analiz raporları.
///
/// Arşiv diskte tutulur; `force_refresh` gelmedikçe gün içinde bir kez
/// tazelenir. Kaynakların hepsi düşse bile eldeki arşiv döner — rapor listesi
/// tek bir sitenin erişilebilirliğine bağlı kalmaz.
pub async fn get_analyst_reports(
    state: &AppState,
    ticker: Option<String>,
    force_refresh: Option<bool>,
) -> Result<crate::domain::AnalystReportPayload, String> {
    use crate::research_reports as reports;

    let mut archive = reports::load();
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let stale = archive
        .last_updated
        .as_deref()
        .map_or(true, |stamp| !stamp.starts_with(&today));

    let mut errors = Vec::new();
    if force_refresh.unwrap_or(false) {
        // Elle tazelemede konsensüs de yenilensin; iki kaynağın farklı
        // tazelikte kalması ekranda tutarsız görünür.
        crate::analyst_consensus::invalidate();
    }
    if force_refresh.unwrap_or(false) || stale {
        // İlk kurulumda arşiv boş olur; o turda geriye doğru derin taranır.
        let deep = archive.reports.is_empty();
        let (_, source_errors) = reports::refresh(&state.http, deep).await;
        errors = source_errors;
        archive = reports::load();
    }

    let requested = ticker.as_deref().filter(|code| !code.trim().is_empty());

    // Konsensüs ayrı kaynaktan gelir ve kendi önbelleği vardır; rapor
    // arşivinin tazelenmesine bağlı değildir.
    let consensus = match requested {
        Some(code) => crate::analyst_consensus::for_ticker(&state.http, code)
            .await
            .into_iter()
            .collect(),
        None => {
            let mut rows: Vec<_> =
                crate::analyst_consensus::load(&state.http).await.into_values().collect();
            // İzleyen kurum sayısı çok olan pay üstte; ekran onu öne alır.
            rows.sort_by(|a, b| {
                b.total.cmp(&a.total).then_with(|| a.ticker.cmp(&b.ticker))
            });
            rows
        }
    };

    let records = match requested {
        Some(code) => {
            // Arşiv derinliği sınırlı; hisse açıldığında kurumun etiket akışı
            // o hissenin tam geçmişini tek istekte verir.
            let universe: std::collections::HashSet<String> =
                crate::bist_universe::load(&state.http)
                    .await
                    .into_iter()
                    .map(|(symbol, _)| symbol)
                    .collect();
            let live = reports::fetch_ticker_feed(&state.http, code, &universe).await;
            if !live.is_empty() {
                reports::merge(&mut archive, live);
                reports::save(&archive);
            }
            reports::for_ticker(&archive, code)
        }
        None => archive.reports.clone(),
    };

    Ok(crate::domain::AnalystReportPayload {
        reports: records,
        last_updated: archive.last_updated,
        errors,
        consensus,
    })
}

pub async fn get_ipo_calendar(
    state: &AppState,
    force_refresh: Option<bool>,
) -> Result<crate::domain::IpoCalendarPayload, String> {
    const CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(30 * 60);

    let needs_refresh = {
        let cache = state.ipo_cache.lock().await;
        force_refresh.unwrap_or(false)
            || cache.base_records.is_empty()
            || cache.fetched_at.map(|t| t.elapsed() > CACHE_TTL).unwrap_or(true)
    };

    if needs_refresh {
        crate::refresh_ipo_cache(state).await;
    }

    // Store kilidi yalnızca fiyat kopyası için kısaca tutulur; scrape sırasında asla.
    let equities = {
        let store = state.store.lock().await;
        store.equities.clone()
    };

    let cache = state.ipo_cache.lock().await;
    let mut records = cache.base_records.clone();
    crate::corporate_actions::apply_market_prices(&mut records, &equities);

    Ok(crate::domain::IpoCalendarPayload {
        records,
        last_updated: cache.last_updated.clone(),
        scrape_ok: cache.scrape_ok,
    })
}
