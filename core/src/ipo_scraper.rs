use reqwest::Client;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;
use futures::future::join_all;
use tokio::sync::Semaphore;

const LISTING_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MAX_YEAR_PAGES: u32 = 8;
const DETAIL_CONCURRENCY: usize = 10;

/// Tamamlanmış bir arzın yatırımcı grubu bazında dağıtım satırı.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct IpoResultRow {
    pub group: String,
    pub people: String,
    pub lots: String,
    pub ratio: String,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
pub struct ScrapedIpo {
    pub ticker: String,
    pub name: String,
    pub ipo_date: String,
    pub price: f64,
    pub status: String,
    pub book_building_dates: Option<String>,
    pub trading_start_date: Option<String>,
    pub distribution_type: Option<String>,
    pub participant_count: Option<String>,
    pub fund_usage: Option<String>,
    pub share_structure: Option<String>,
    pub ipo_size: Option<String>,
    pub katilim_index: Option<String>,
    pub lockup_period: Option<String>,
    pub consortium_lead: Option<String>,
    pub t1_t2_available: Option<String>,
    pub distribution_ratios: Option<String>,
    pub price_range: Option<String>,
    pub lot_amount: Option<String>,
    pub market: Option<String>,
    pub index_name: Option<String>,
    pub free_float_lots: Option<String>,
    pub free_float_ratio: Option<String>,
    pub sale_method: Option<String>,
    pub expected_lots: Option<String>,
    pub financials: Option<String>,
    pub price_stability: Option<String>,
    pub public_float_ratio: Option<String>,
    pub discount: Option<String>,
    pub results_table: Option<Vec<IpoResultRow>>,
    pub major_shareholders: Option<String>,
}

/// Liste sayfasından okunan, detay sayfası henüz gezilmemiş kayıt.
#[derive(Debug, Clone)]
pub struct ListedIpo {
    pub ticker: String,
    pub name: String,
    pub ipo_date: String,
    pub status: String,
    pub detail_url: Option<String>,
}

#[derive(Debug, Default, Clone)]
struct DetailData {
    price: f64,
    book_building_dates: Option<String>,
    trading_start_date: Option<String>,
    distribution_type: Option<String>,
    participant_count: Option<String>,
    fund_usage: Option<String>,
    share_structure: Option<String>,
    ipo_size: Option<String>,
    katilim_index: Option<String>,
    lockup_period: Option<String>,
    consortium_lead: Option<String>,
    t1_t2_available: Option<String>,
    distribution_ratios: Option<String>,
    price_range: Option<String>,
    lot_amount: Option<String>,
    market: Option<String>,
    index_name: Option<String>,
    free_float_lots: Option<String>,
    free_float_ratio: Option<String>,
    sale_method: Option<String>,
    expected_lots: Option<String>,
    financials: Option<String>,
    price_stability: Option<String>,
    public_float_ratio: Option<String>,
    discount: Option<String>,
    results_table: Option<Vec<IpoResultRow>>,
    major_shareholders: Option<String>,
}

fn current_year_string() -> String {
    chrono::Local::now().format("%Y").to_string()
}

/// Değer bir tarih GİBİ mi duruyor? Sayfa henüz açıklanmamış alanlara
/// "Hazırlanıyor…", "Belirlenmedi", "-" gibi yer tutucular yazar; bunlar
/// tarih alanına yazılırsa "bilinmiyor" ile "şu tarih" ayrımı kaybolur.
///
/// Ölçüt bilerek gevşek: rakam içermeyen her değer yer tutucu sayılır.
/// Tarih biçimi kaynaktan kaynağa değişiyor ("12 Ağustos 2026", "12.08.2026",
/// "2026-08-12"), ama hepsinde rakam var; yer tutucularda yok.
pub(crate) fn date_like(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || !trimmed.chars().any(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(trimmed.to_string())
}

/// "05 Ağustos 2026 Çarşamba" → "2026-08-05". Ay adı bulunamazsa metin
/// olduğu gibi döner; çağıranlar ISO olup olmadığına `looks_like_iso_date`
/// ile bakar.
pub(crate) fn parse_turkish_date(date_str: &str) -> String {
    let months = [
        ("ocak", "01"), ("şubat", "02"), ("subat", "02"), ("mart", "03"),
        ("nisan", "04"), ("mayıs", "05"), ("mayis", "05"), ("haziran", "06"),
        ("temmuz", "07"), ("ağustos", "08"), ("agustos", "08"), ("eylül", "09"),
        ("eylul", "09"), ("ekim", "10"), ("kasım", "11"), ("kasim", "11"),
        ("aralık", "12"), ("aralik", "12")
    ];

    let parts: Vec<&str> = date_str.split_whitespace().collect();

    for i in (0..parts.len()).rev() {
        let p_lower = parts[i].to_lowercase();
        for (tr, num) in months.iter() {
            if p_lower.contains(tr) {
                let month = num;

                let year = if i + 1 < parts.len() {
                    let y: String = parts[i+1].chars().filter(|c| c.is_ascii_digit()).collect();
                    if y.len() == 4 { y } else { current_year_string() }
                } else {
                    current_year_string()
                };

                let day = if i > 0 {
                    let d = parts[i-1];
                    let d_last = if d.contains('-') {
                        d.split('-').last().unwrap_or("01")
                    } else {
                        d
                    };
                    let d_clean: String = d_last.chars().filter(|c| c.is_ascii_digit()).collect();
                    if d_clean.len() == 1 { format!("0{}", d_clean) }
                    else if d_clean.is_empty() { "01".to_string() }
                    else { d_clean }
                } else {
                    "01".to_string()
                };

                return format!("{}-{}-{}", year, month, day);
            }
        }
    }

    date_str.to_string()
}

/// "20,50 TL" veya "20,00 - 22,00 TL" gibi metinlerden fiyat çıkarır.
fn parse_price_text(text: &str) -> Option<f64> {
    let cleaned = text.replace(" TL", "").replace(' ', "").replace(',', ".");
    if let Ok(val) = cleaned.parse::<f64>() {
        return Some(val);
    }
    // Fiyat aralığı verilmişse ilk sayıyı al
    for token in cleaned.split('-') {
        if let Ok(val) = token.parse::<f64>() {
            return Some(val);
        }
    }
    None
}

/// Bir liste sayfasındaki (ana sayfa veya yıl arşivi) tüm halka arz
/// kayıtlarını ayrıştırır. Saf fonksiyondur; ağ erişimi yapmaz.
///
/// `assume_completed`: yıl arşivi sayfalarında makalelerde tarih (`<time>`)
/// ve durum rozeti bulunmaz; bu bayrakla kayıtlar TAMAMLANDI sayılır ve
/// tarih detay sayfasından doldurulmak üzere boş bırakılır.
pub fn parse_listing(html: &str, assume_completed: bool) -> Vec<ListedIpo> {
    let document = Html::parse_document(html);
    let active_selector = Selector::parse("ul.halka-arz-list:not(.taslak) article.index-list").unwrap();
    let taslak_selector = Selector::parse("ul.halka-arz-list.taslak article.index-list").unwrap();
    // Ana sayfada span.il-bist-kod, yıl arşivinde h2.il-bist-kod kullanılıyor
    let ticker_selector = Selector::parse(".il-bist-kod").unwrap();
    let name_selector = Selector::parse("h3.il-halka-arz-sirket a").unwrap();
    let date_selector = Selector::parse("time").unwrap();
    let badge_selector = Selector::parse("div.il-badge").unwrap();

    let mut listed = Vec::new();
    let mut seen = HashSet::new();

    let mut process = |row: scraper::ElementRef, is_taslak: bool| {
        let ticker = match row.select(&ticker_selector).next() {
            Some(el) => el.text().collect::<String>().trim().to_string(),
            None => return,
        };
        let name = match row.select(&name_selector).next() {
            Some(el) => el.text().collect::<String>().trim().to_string(),
            None => return,
        };
        // BIST kodu SPK onayından önce atanmaz; sitede bu kayıtların
        // il-bist-kod elemanı boştur. Ana sayfada isimle tekilleştirilip
        // tutulurlar; yıl arşivinde kodsuz kayıt taslaktır, TAMAMLANDI
        // sayılmaması için atlanır.
        if ticker.is_empty() {
            if assume_completed || name.is_empty() || !seen.insert(format!("name:{name}")) {
                return;
            }
        } else if !seen.insert(ticker.clone()) {
            return;
        }

        let raw_date = row.select(&date_selector).next()
            .map(|el| el.inner_html().trim().to_string());

        if assume_completed {
            let ipo_date = raw_date.as_deref().map(parse_turkish_date).unwrap_or_default();
            let detail_url = row.select(&name_selector).next()
                .and_then(|el| el.value().attr("href"))
                .map(|l| l.to_string());
            listed.push(ListedIpo {
                ticker,
                name,
                ipo_date,
                status: "TAMAMLANDI".to_string(),
                detail_url,
            });
            return;
        }

        let raw_date = raw_date.unwrap_or_else(|| "Hazırlanıyor...".to_string());
        let ipo_date = parse_turkish_date(&raw_date);

        let mut status = "TALEP TOPLAMA".to_string();
        if is_taslak {
            status = "TASLAK".to_string();
        } else if raw_date.contains("Hazırlanıyor") || raw_date.contains("Taslak") || raw_date.contains("Onay") {
            status = "TASLAK".to_string();
        } else if let Some(badge_el) = row.select(&badge_selector).next() {
            let class = badge_el.value().attr("class").unwrap_or("");
            let title = badge_el.value().attr("title").unwrap_or("");
            let inner_html = badge_el.inner_html();
            let inner = inner_html.to_lowercase();
            // Rozet ikonu iç elemanda olabildiği için hem class hem içerik kontrol edilir
            if class.contains("fa-check") || title.contains("tamamlandı") || title.contains("sonuçları")
                || inner.contains("tamamlandı") || inner.contains("sonuç") || inner.contains("fa-check") {
                status = "TAMAMLANDI".to_string();
            } else {
                status = "AKTİF".to_string();
            }
        }

        let detail_url = row.select(&name_selector).next()
            .and_then(|el| el.value().attr("href"))
            .map(|l| l.to_string());

        listed.push(ListedIpo { ticker, name, ipo_date, status, detail_url });
    };

    for row in document.select(&active_selector) {
        process(row, false);
    }
    for row in document.select(&taslak_selector) {
        process(row, true);
    }

    listed
}

/// Detay sayfasındaki üst bilgi tablosunda (`table.sp-table`) bir satırın
/// etiketini ve değerini döndürür. Etiket `<em>`, değer ikinci `<td>`.
fn sp_table_rows(doc: &Html) -> Vec<(String, String)> {
    let row_selector = Selector::parse("table.sp-table tr").unwrap();
    let em_selector = Selector::parse("em").unwrap();
    let td_selector = Selector::parse("td").unwrap();

    let mut rows = Vec::new();
    for tr in doc.select(&row_selector) {
        let Some(label_el) = tr.select(&em_selector).next() else { continue };
        let label = collapse_ws(&label_el.text().collect::<String>())
            .trim_end_matches(':')
            .trim()
            .to_string();
        let tds: Vec<_> = tr.select(&td_selector).collect();
        if tds.len() < 2 {
            continue;
        }
        // Aracı kurum hücresinde lider `<strong>`, konsorsiyum üyeleri ayrı bir
        // `<ul>` içindedir; aralarında boşluk olmadığı için düz `text()` unvanları
        // "…A.Ş.Vakıf Yatırım…" diye yapıştırıyordu. Metin düğümleri ayrı ayrı
        // toplanıp " / " ile birleştirilir.
        let parts: Vec<String> = tds[1]
            .text()
            .map(collapse_ws)
            .filter(|p| !p.is_empty())
            .collect();
        let value = parts.join(" / ");
        if !label.is_empty() && !value.is_empty() {
            rows.push((label, value));
        }
    }
    rows
}

/// Özet Bilgiler bloğundaki (`ul.aex-in > li`) başlık/gövde çiftleri.
/// Gövdedeki `<small>` kaynak dipnotu ("* İzahname, Sayfa 347.") atılır,
/// `<br>` ile ayrılmış maddeler satır satır korunur.
fn summary_blocks(doc: &Html) -> Vec<(String, String)> {
    let li_selector = Selector::parse("ul.aex-in > li").unwrap();
    let h5_selector = Selector::parse("h5").unwrap();
    let p_selector = Selector::parse("p").unwrap();
    let small_selector = Selector::parse("small").unwrap();

    let mut blocks = Vec::new();
    for li in doc.select(&li_selector) {
        let Some(h5) = li.select(&h5_selector).next() else { continue };
        let title = collapse_ws(&h5.text().collect::<String>())
            .trim_end_matches('*')
            .trim()
            .to_string();
        let Some(p) = li.select(&p_selector).next() else { continue };

        let citation: Vec<String> = p
            .select(&small_selector)
            .map(|s| collapse_ws(&s.text().collect::<String>()))
            .collect();

        // Metni `<br>` sınırlarında böl: doğrudan metin düğümlerini sırayla
        // topla, `<br>` görünce satırı kapat.
        let mut lines: Vec<String> = Vec::new();
        let mut current = String::new();
        for node in p.children() {
            match node.value() {
                scraper::Node::Text(text) => current.push_str(text),
                scraper::Node::Element(el) if el.name() == "br" => {
                    let line = collapse_ws(&current);
                    if !line.is_empty() {
                        lines.push(line);
                    }
                    current.clear();
                }
                scraper::Node::Element(_) => {
                    if let Some(el) = scraper::ElementRef::wrap(node) {
                        current.push_str(&el.text().collect::<String>());
                    }
                }
                _ => {}
            }
        }
        let line = collapse_ws(&current);
        if !line.is_empty() {
            lines.push(line);
        }

        let body: String = lines
            .into_iter()
            .filter(|l| !citation.iter().any(|c| c == l))
            .map(|l| l.trim_start_matches('-').trim().to_string())
            .filter(|l| !l.is_empty())
            .collect::<Vec<_>>()
            .join("\n");

        if !title.is_empty() && !body.is_empty() {
            blocks.push((title, body));
        }
    }
    blocks
}

/// `table.fs-extra` finansal tablosunu "Dönem | Hasılat | Brüt Kâr" biçiminde
/// satır satır düzleştirir.
fn parse_financials(doc: &Html) -> Option<String> {
    let table_selector = Selector::parse("table.fs-extra").unwrap();
    let tr_selector = Selector::parse("tr").unwrap();
    let cell_selector = Selector::parse("th, td").unwrap();

    let table = doc.select(&table_selector).next()?;
    let mut lines = Vec::new();
    for tr in table.select(&tr_selector) {
        let cells: Vec<String> = tr
            .select(&cell_selector)
            .map(|c| collapse_ws(&c.text().collect::<String>()))
            .collect();
        if cells.iter().all(|c| c.is_empty()) {
            continue;
        }
        lines.push(cells.join(" | "));
    }
    (!lines.is_empty()).then(|| lines.join("\n"))
}

/// `table.as-table` halka arz sonuçlarını yatırımcı grubu satırlarına ayırır.
/// Başlık satırları ("Yatırımcı Grubu", "Kişi/Lot/Oran") ve dipnot atlanır.
fn parse_results_table(doc: &Html) -> (Vec<IpoResultRow>, Option<String>) {
    let table_selector = Selector::parse("table.as-table").unwrap();
    let tr_selector = Selector::parse("tr").unwrap();
    let td_selector = Selector::parse("td").unwrap();

    let mut rows = Vec::new();
    let mut footnote = None;

    let Some(table) = doc.select(&table_selector).next() else {
        return (rows, footnote);
    };

    for tr in table.select(&tr_selector) {
        let cells: Vec<String> = tr
            .select(&td_selector)
            .map(|c| collapse_ws(&c.text().collect::<String>()))
            .filter(|c| !c.is_empty())
            .collect();

        if cells.len() == 1 && cells[0].starts_with('*') {
            footnote = Some(cells[0].trim_start_matches('*').trim().to_string());
            continue;
        }
        if cells.len() < 4 {
            continue;
        }
        // Başlık satırları: "Yatırımcı Grubu | Dağıtım" ve "Kişi | Lot | Oran"
        if cells[0].contains("Yatırımcı Grubu") || cells[0] == "Kişi" {
            continue;
        }
        // Oran sütunu yüzde işaretiyle başlamıyorsa satır veri değildir
        if !cells[3].starts_with('%') {
            continue;
        }
        rows.push(IpoResultRow {
            group: cells[0].clone(),
            people: cells[1].clone(),
            lots: cells[2].clone(),
            ratio: cells[3].clone(),
        });
    }

    (rows, footnote)
}

/// Sayfa sonundaki `**`/`***`/`****` dipnotlarından katılım endeksi ve
/// T1-T2 bakiyesi bilgisini okur.
fn parse_footnotes(doc: &Html) -> (Option<String>, Option<String>) {
    let selector = Selector::parse("ul.aex-in small, ul.aex-in i, .aexi-note, ul.aex-in li").unwrap();
    let mut katilim = None;
    let mut t1_t2 = None;

    for el in doc.select(&selector) {
        let text = collapse_ws(&el.text().collect::<String>());
        let lower = text.to_lowercase();

        if katilim.is_none() && lower.contains("katılım endeksine") {
            katilim = Some(if lower.contains("uygun değil") {
                "Katılım Endeksine Uygun Değil".to_string()
            } else {
                "Katılım Endeksine Uygun (XKTUM)".to_string()
            });
        }
        if t1_t2.is_none() && (lower.contains("t1-t2") || lower.contains("t1 - t2")) {
            t1_t2 = Some(if lower.contains("kullanılamaz") {
                "T1-T2 Bakiyesi Kullanılamaz".to_string()
            } else {
                "T1-T2 Bakiyesi Kullanılabilir".to_string()
            });
        }
    }

    (katilim, t1_t2)
}

fn collapse_ws(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Şirket detay sayfasını ayrıştırır. halkarz.com detay sayfası üç bölümden
/// oluşur ve her biri kendi yapısıyla okunur:
/// * `table.sp-table` — tarih, fiyat, lot, aracı kurum, pazar, fiili dolaşım
/// * `table.as-table` — tamamlanmış arzlarda yatırımcı grubu dağıtım tablosu
/// * `ul.aex-in > li` — Özet Bilgiler (fon kullanımı, tahsisat, iskonto…)
///
/// Saf fonksiyondur; ağ erişimi yapmaz.
fn parse_detail(html: &str) -> DetailData {
    let doc = Html::parse_document(html);
    let mut data = DetailData::default();

    for (label, value) in sp_table_rows(&doc) {
        match label.as_str() {
            l if l.contains("Halka Arz Tarihi") => data.book_building_dates = Some(value),
            l if l.contains("Fiyatı") || l.contains("Fiyat/Aralığı") => {
                if let Some(price) = parse_price_text(&value) {
                    data.price = price;
                }
                data.price_range = Some(value);
            }
            l if l.contains("Dağıtım Yöntemi") => data.distribution_type = Some(value),
            l if l == "Pay" => data.lot_amount = Some(value),
            l if l.contains("Aracı Kurum") || l.contains("Konsorsiyum") => {
                data.consortium_lead = Some(value)
            }
            l if l.contains("Fiili Dolaşımdaki Pay Oranı") => data.free_float_ratio = Some(value),
            l if l.contains("Fiili Dolaşımdaki Pay") => data.free_float_lots = Some(value),
            l if l.contains("Endeks") => data.index_name = Some(value),
            l if l.contains("Pazar") => data.market = Some(value),
            // Tarih henüz açıklanmadıysa sayfa "Hazırlanıyor…" gibi bir yer
            // tutucu yazar. Bunu kaydetmek iki yerde zarar veriyordu: arayüz
            // metni tarihmiş gibi gösteriyor, ve `detail_is_complete` alanı
            // DOLU sayıp kaydı tamamlanmış kabul ediyordu — böylece gerçek
            // tarih yayımlandığında künye bir daha tazelenmiyordu.
            l if l.contains("İlk İşlem Tarihi") => data.trading_start_date = date_like(value),
            _ => {}
        }
    }

    for (title, body) in summary_blocks(&doc) {
        match title.as_str() {
            t if t.contains("Halka Arz Şekli") => data.share_structure = Some(body),
            t if t.contains("Fonun Kullanım Yeri") || t.contains("Fon Kullanım Yeri") => {
                data.fund_usage = Some(body)
            }
            t if t.contains("Satış Yöntemi") => data.sale_method = Some(body),
            t if t.contains("Tahsisat") => data.distribution_ratios = Some(body),
            t if t.contains("Pay Miktarı") => data.expected_lots = Some(body),
            t if t.contains("Fiyat İstikrarı") => data.price_stability = Some(body),
            t if t.contains("Satmama Taahhüdü") => data.lockup_period = Some(body),
            t if t.contains("Halka Arz İskontosu") => data.discount = Some(body),
            t if t.contains("Halka Açıklık") => data.public_float_ratio = Some(body),
            t if t.contains("Halka Arz Büyüklüğü") => data.ipo_size = Some(body),
            _ => {}
        }
    }

    data.financials = parse_financials(&doc);

    let (result_rows, footnote) = parse_results_table(&doc);
    if let Some(total) = result_rows.iter().find(|r| r.group.contains("Toplam")) {
        data.participant_count = Some(total.people.clone());
    }
    data.major_shareholders = footnote;
    if !result_rows.is_empty() {
        data.results_table = Some(result_rows);
    }

    let (katilim, t1_t2) = parse_footnotes(&doc);
    data.katilim_index = katilim;
    data.t1_t2_available = t1_t2;

    data
}

/// Liste kayıtlarını ScrapedIpo'ya dönüştürür; `skip_details` içindeki
/// ticker'lar için detay sayfası çekilmez (arşivde detayları zaten tam olan
/// kayıtlar için gereksiz istekten kaçınmak amacıyla).
async fn resolve_details(
    client: &Client,
    listed: Vec<ListedIpo>,
    skip_details: &HashSet<String>,
) -> Vec<ScrapedIpo> {
    let semaphore = Arc::new(Semaphore::new(DETAIL_CONCURRENCY));
    let mut tasks = Vec::new();

    for item in listed {
        // Kodsuz kayıtlar (200+ taslak) için detay sayfası çekilmez;
        // liste bilgisi (isim + durum) yeterlidir ve istek sayısı patlamaz.
        let fetch_url = if item.ticker.is_empty() || skip_details.contains(&item.ticker) {
            None
        } else {
            item.detail_url.clone()
        };
        let client = client.clone();
        let permit = semaphore.clone();

        tasks.push(tokio::spawn(async move {
            let mut detail = DetailData::default();
            if let Some(url) = fetch_url {
                let _permit = permit.acquire().await.ok()?;
                if let Ok(res) = client.get(&url)
                    .header("User-Agent", LISTING_USER_AGENT)
                    .timeout(Duration::from_secs(15))
                    .send().await {
                    if let Ok(html) = res.text().await {
                        detail = parse_detail(&html);
                    }
                }
            }
            // Liste sayfasında tarih yoksa (yıl arşivi) detaydaki ilk işlem
            // veya talep toplama tarihinden türet
            let mut ipo_date = item.ipo_date;
            if !crate::ipo_store::looks_like_iso_date(&ipo_date) {
                for candidate in [&detail.trading_start_date, &detail.book_building_dates] {
                    if let Some(raw) = candidate {
                        let parsed = parse_turkish_date(raw);
                        if crate::ipo_store::looks_like_iso_date(&parsed) {
                            ipo_date = parsed;
                            break;
                        }
                    }
                }
            }

            // Yıl arşivi sayfalarında rozet yoktur, kayıtlar TAMAMLANDI
            // varsayılır. İçinde bulunulan yılın arşivi henüz sonuçlanmamış
            // arzları da taşır: tarihi gelecekte olan bir arz tamamlanmış
            // olamaz, yoksa talep toplaması süren şirket "TAMAMLANDI" görünüp
            // ana sayfadan gelen doğru durumu da eziyordu.
            let status = if item.status == "TAMAMLANDI"
                && crate::ipo_store::looks_like_iso_date(&ipo_date)
                && ipo_date > chrono::Local::now().format("%Y-%m-%d").to_string()
            {
                "AKTİF".to_string()
            } else {
                item.status
            };

            Some(ScrapedIpo {
                ticker: item.ticker,
                name: item.name,
                ipo_date,
                price: detail.price,
                status,
                book_building_dates: detail.book_building_dates,
                trading_start_date: detail.trading_start_date,
                distribution_type: detail.distribution_type,
                participant_count: detail.participant_count,
                fund_usage: detail.fund_usage,
                share_structure: detail.share_structure,
                ipo_size: detail.ipo_size,
                katilim_index: detail.katilim_index,
                lockup_period: detail.lockup_period,
                consortium_lead: detail.consortium_lead,
                t1_t2_available: detail.t1_t2_available,
                distribution_ratios: detail.distribution_ratios,
                price_range: detail.price_range,
                lot_amount: detail.lot_amount,
                market: detail.market,
                index_name: detail.index_name,
                free_float_lots: detail.free_float_lots,
                free_float_ratio: detail.free_float_ratio,
                sale_method: detail.sale_method,
                expected_lots: detail.expected_lots,
                financials: detail.financials,
                price_stability: detail.price_stability,
                public_float_ratio: detail.public_float_ratio,
                discount: detail.discount,
                results_table: detail.results_table,
                major_shareholders: detail.major_shareholders,
            })
        }));
    }

    let mut scraped = Vec::new();
    for res in join_all(tasks).await {
        if let Ok(Some(ipo)) = res {
            scraped.push(ipo);
        }
    }
    scraped
}

async fn fetch_listing_html(client: &Client, url: &str) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let resp = client.get(url)
        .header("User-Agent", LISTING_USER_AGENT)
        .timeout(Duration::from_secs(15))
        .send().await?;
    if !resp.status().is_success() {
        return Err(format!("Failed to fetch {}: HTTP {}", url, resp.status()).into());
    }
    Ok(resp.text().await?)
}

/// Ana sayfadaki güncel halka arz listesini (aktif + taslak) detaylarıyla çeker.
pub async fn scrape_recent_ipos(client: &Client) -> Result<Vec<ScrapedIpo>, Box<dyn std::error::Error + Send + Sync>> {
    let html = fetch_listing_html(client, "https://halkarz.com/").await?;
    let listed = parse_listing(&html, false);
    Ok(resolve_details(client, listed, &HashSet::new()).await)
}

/// Bir yılın arşiv sayfalarını (halkarz.com/k/halka-arz/{yıl}/) gezerek o yılın
/// halka arzlarını döndürür. `skip_details` içindeki ticker'ların detay
/// sayfası atlanır; sayfalar tükenince veya MAX_YEAR_PAGES'e ulaşınca durur.
pub async fn scrape_year_archive(
    client: &Client,
    year: i32,
    skip_details: &HashSet<String>,
) -> Vec<ScrapedIpo> {
    let mut all_listed: Vec<ListedIpo> = Vec::new();
    let mut seen = HashSet::new();

    for page in 1..=MAX_YEAR_PAGES {
        let url = if page == 1 {
            format!("https://halkarz.com/k/halka-arz/{}/", year)
        } else {
            format!("https://halkarz.com/k/halka-arz/{}/page/{}/", year, page)
        };

        let html = match fetch_listing_html(client, &url).await {
            Ok(html) => html,
            Err(_) => break,
        };

        let listed = parse_listing(&html, true);
        let mut new_count = 0;
        for item in listed {
            // Kodsuz kayıtlar aynı boş anahtarı paylaşmasın diye tekilleştirme
            // anahtarı koda değil, kod yoksa isme dayanır.
            let key = if item.ticker.is_empty() {
                format!("name:{}", item.name)
            } else {
                item.ticker.clone()
            };
            if seen.insert(key) {
                all_listed.push(item);
                new_count += 1;
            }
        }
        // Yeni kayıt gelmiyorsa sayfalama bitti demektir
        if new_count == 0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(400)).await;
    }

    resolve_details(client, all_listed, skip_details).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Tamamlanmış bir arzın (AKFIS, Ocak 2025) gerçek detay sayfası.
    const DETAIL_HTML: &str = include_str!("../halkarz_detail.html");

    #[test]
    fn detail_reads_the_top_information_table() {
        let d = parse_detail(DETAIL_HTML);

        assert_eq!(d.price, 38.70);
        assert_eq!(d.price_range.as_deref(), Some("38,70 TL"));
        assert_eq!(d.book_building_dates.as_deref(), Some("15-16-17 Ocak 2025"));
        assert_eq!(d.trading_start_date.as_deref(), Some("23 Ocak 2025"));
        assert_eq!(d.distribution_type.as_deref(), Some("Eşit Dağıtım"));
        assert_eq!(d.lot_amount.as_deref(), Some("95.487.612 Lot"));
        assert_eq!(d.market.as_deref(), Some("Yıldız Pazar"));
        assert_eq!(d.index_name.as_deref(), Some("BIST500"));
        assert_eq!(d.free_float_lots.as_deref(), Some("66.838.038 Lot"));
        assert_eq!(d.free_float_ratio.as_deref(), Some("%10.49"));
    }

    /// Aracı kurum hücresi konsorsiyum üyelerini ayrı bir listede taşır;
    /// lider ve üyeler tek metinde toplanmalı.
    #[test]
    fn detail_keeps_every_consortium_member() {
        let lead = parse_detail(DETAIL_HTML).consortium_lead.unwrap();
        assert_eq!(
            lead,
            "Tera Yatırım Menkul Değerler A.Ş. / Vakıf Yatırım Menkul Değerler A.Ş.",
            "lider ve üyeler ayraçla ayrılmalı, yapışmamalı"
        );
    }

    #[test]
    fn detail_reads_the_summary_blocks() {
        let d = parse_detail(DETAIL_HTML);

        let structure = d.share_structure.unwrap();
        assert!(structure.contains("Sermaye Artırımı : 66.841.328 Lot"), "{structure}");
        assert!(structure.contains("Ortak Satışı"), "{structure}");

        assert_eq!(d.public_float_ratio.as_deref(), Some("%15."));
        assert_eq!(d.discount.as_deref(), Some("%20."));
        assert_eq!(d.price_stability.as_deref(), Some("Planlanmamaktadır."));
        assert_eq!(d.ipo_size.as_deref(), Some("～ 3,7 Milyar TL."));

        let lockup = d.lockup_period.unwrap();
        assert!(lockup.contains("1 Yıl, İhraççı."), "{lockup}");
        assert!(lockup.contains("180 Gün, Ortaklar."), "{lockup}");

        let allocation = d.distribution_ratios.unwrap();
        assert!(allocation.contains("38.195.045 Lot (%40) Yurt İçi Bireysel"), "{allocation}");
        assert_eq!(allocation.lines().count(), 5, "{allocation}");
    }

    /// Kaynak dipnotu ("* İzahname, Sayfa 347.") veriye karışmamalı.
    #[test]
    fn detail_strips_source_citations() {
        let usage = parse_detail(DETAIL_HTML).fund_usage.unwrap();
        assert!(!usage.contains("İzahname"), "{usage}");
        assert_eq!(usage.lines().count(), 3, "{usage}");
    }

    #[test]
    fn detail_reads_the_allocation_results_table() {
        let d = parse_detail(DETAIL_HTML);
        let rows = d.results_table.expect("sonuç tablosu");

        assert_eq!(rows.len(), 6, "5 yatırımcı grubu + toplam");
        assert_eq!(
            rows[0],
            IpoResultRow {
                group: "Yurt İçi Bireysel".into(),
                people: "260.628".into(),
                lots: "22.155.886".into(),
                ratio: "%33.15".into(),
            }
        );
        assert_eq!(rows[5].group, "Toplam");
        // Katılımcı sayısı toplam satırından okunur
        assert_eq!(d.participant_count.as_deref(), Some("261.072"));
    }

    #[test]
    fn detail_reads_the_financial_table() {
        let financials = parse_detail(DETAIL_HTML).financials.unwrap();
        assert!(financials.contains("2024/9"), "{financials}");
        assert!(financials.contains("Hasılat"), "{financials}");
        assert!(financials.contains("5,2 Milyar TL"), "{financials}");
    }

    #[test]
    fn detail_reads_the_participation_index_footnote() {
        let d = parse_detail(DETAIL_HTML);
        assert_eq!(
            d.katilim_index.as_deref(),
            Some("Katılım Endeksine Uygun Değil")
        );
    }

    #[test]
    fn parses_full_turkish_date() {
        assert_eq!(parse_turkish_date("3 Temmuz 2026"), "2026-07-03");
        assert_eq!(parse_turkish_date("13 Aralık 2024"), "2024-12-13");
    }

    #[test]
    fn parses_date_range_using_last_day() {
        assert_eq!(parse_turkish_date("10-11 Temmuz 2025"), "2025-07-11");
    }

    #[test]
    fn missing_year_falls_back_to_current_year() {
        let year = current_year_string();
        assert_eq!(parse_turkish_date("5 Ekim"), format!("{year}-10-05"));
    }

    #[test]
    fn unparseable_text_is_returned_unchanged() {
        assert_eq!(parse_turkish_date("Hazırlanıyor..."), "Hazırlanıyor...");
    }

    #[test]
    fn single_digit_day_is_zero_padded() {
        assert_eq!(parse_turkish_date("7 Mart 2027"), "2027-03-07");
    }

    #[test]
    fn price_text_parses_single_and_range() {
        assert_eq!(parse_price_text("20,50 TL"), Some(20.5));
        assert_eq!(parse_price_text("20,00 - 22,00 TL"), Some(20.0));
        assert_eq!(parse_price_text("fiyat yok"), None);
    }

    #[test]
    fn listing_snapshot_parses_entries() {
        // Depodaki gerçek halkarz.com anlık görüntüsüyle ayrıştırıcıyı doğrula
        let html = include_str!("../halkarz.html");
        let listed = parse_listing(html, false);
        assert!(listed.len() > 20, "snapshot should yield many entries, got {}", listed.len());
        assert!(listed.iter().any(|l| l.ticker == "SARAE"));
        let sarae = listed.iter().find(|l| l.ticker == "SARAE").unwrap();
        assert_eq!(sarae.ipo_date, "2026-07-10");
        assert!(sarae.detail_url.is_some());
        // Taslak bölümü de ayrıştırılmalı
        assert!(listed.iter().any(|l| l.status == "TASLAK"));
    }

    #[test]
    fn listing_keeps_entries_without_bist_code() {
        // BIST kodu atanmamış kayıtlar (boş il-bist-kod) atlanmamalı;
        // sitedeki 200+ taslak şirket ve kod bekleyen güncel arzlar bunlardır.
        let html = include_str!("../halkarz.html");
        let listed = parse_listing(html, false);
        let codeless: Vec<_> = listed.iter().filter(|l| l.ticker.is_empty()).collect();
        assert!(codeless.len() > 100, "codeless drafts should be kept, got {}", codeless.len());
        assert!(codeless.iter().all(|l| !l.name.is_empty()));
        assert!(codeless.iter().all(|l| l.status == "TASLAK"));
        // Ana listedeki kod bekleyen arz da dahil olmalı
        assert!(listed.iter().any(|l| l.name.starts_with("Albayrak Hazır Beton")));
    }

    #[test]
    fn year_archive_mode_skips_codeless_entries() {
        // Yıl arşivi modunda kodsuz kayıtlar TAMAMLANDI sayılmamalı
        let html = include_str!("../halkarz.html");
        let listed = parse_listing(html, true);
        assert!(listed.iter().all(|l| !l.ticker.is_empty()));
    }
}
