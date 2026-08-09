//! SPK onayı almış halka arzları KAP bildirimleriyle **otomatik** tamamlar.
//!
//! Süreç şöyle işliyor: SPK haftalık bülteninde bir izahname onayı yayımlanır
//! (`spk::extract_ipo_approvals_from_pdf` → arşive "SPK ONAYLI" kayıt).
//! Onaydan sonraki günlerde arzın geri kalan verisi damla damla KAP'a düşer:
//!
//! | gün | bildirim | dolan alan |
//! |---|---|---|
//! | onay | Payların Borsa Birincil Piyasada Halka Arzı | fiyat, aracı kurum, pazar, halka açıklık |
//! | arz sonrası | Halka Arz Sonuçları | katılımcı sayısı ve grup kırılımı, kesin fiyat/büyüklük |
//! | arz sonrası | %5'inden Fazlasını Satın Alanlar | büyük alıcı dipnotu |
//! | işlem öncesi | Payların İşlem Görmeye Başlaması | **ilk işlem tarihi**, pazar, baz fiyat |
//! | işlem günü | Endeks Şirketlerinde Değişiklik | girdiği endeksler |
//!
//! Bu tur her yenilemede çalışır ve "izlenen" arzların eksik alanlarını arar.
//! Kullanıcı bir şey yapmaz: onay bültende göründüğü an kayıt izlemeye girer,
//! bildirimler yayımlandıkça alanlar kendiliğinden dolar ve kayıt tamamlanınca
//! izlemeden çıkar.
//!
//! **Bütçelidir.** KAP'ın gövde ucu ~30-60 saniyelik pencerede 10 belge
//! veriyor (bkz. [`crate::kap_capital::FETCH_BUDGET`]); okunmuş bildirim
//! numaraları diske yazılır, yoksa her tur aynı ilk on belgeyi indirir ve hiç
//! ilerlemez.
//!
//! Bu yüzden tur **iki aşamalıdır**: keşif bulduğu adayları kalıcı bir kuyruğa
//! yazar, okuma kuyruğu bütçe kadar sindirir. Aşamalar ayrılmazsa birbirlerine
//! kilitleniyorlar — bkz. [`PendingDisclosure`].

use crate::ipo_store::PersistedIpo;
use crate::kap::RawDisclosure;
use crate::kap_ipo::{KapIpoDisclosureType, KapIpoExtractedData};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Bir arzın izlenmeye başlaması için onayın en fazla bu kadar eski olabildiği
/// gün sayısı.
///
/// Onaydan ilk işleme tipik olarak 3-6 hafta geçiyor; endeks duyurusu birkaç
/// gün daha sarkabiliyor. Altı ay, gecikmiş arzlara da yer bırakır ve pencere
/// dar tutulduğu için tarama ucuz kalır.
const WATCH_WINDOW_DAYS: i64 = 180;

/// Süreci devam eden kayıtların durumları. Bunlar için tarih penceresi
/// aranmaz: arz tarihi henüz belli olmayabilir.
const PENDING_STATUSES: &[&str] = &["TASLAK", "SPK ONAYLI", "TALEP TOPLAMA", "AKTİF"];

/// Kaynak rozeti; `ipo_pipeline` ile aynı etiket kullanılır.
const KAP_SOURCE: &str = "KAP";

/// Okunmayı bekleyen bir bildirim.
///
/// Kuyruk **kalıcıdır** ve keşfi okumadan ayırır. Aksi hâlde ikisi birbirine
/// kilitleniyordu: bütçe turda 10 gövdeyle sınırlı olduğu için geniş taramanın
/// bulduğu yığın turlara yayılmak zorunda, ama tarama penceresi daraldığında
/// devredilen adaylar taramanın dışında kalıp kayboluyordu. Yığını korumak
/// için pencereyi geniş tutmak ise her turda 13 listeleme isteği demekti —
/// yani gövde ucuyla aynı hız sınırını yiyen bir tarama.
///
/// Kuyrukla tarama her tur birkaç günü sorar, yığın kuyruktan sindirilir.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PendingDisclosure {
    pub index: String,
    pub kind: KapIpoDisclosureType,
    /// Bildirimin konusu olan pay kodu; kodsuz Borsa duyurularında `None`.
    #[serde(default)]
    pub ticker: Option<String>,
}

/// Tur ilerlemesi. Arşivden ayrı bir dosyada tutulur: halka arz arşivi düz bir
/// kayıt listesi ve şema başına kayıt taşıyor, tur durumu oraya ait değil.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct FollowState {
    /// Gövdesi okunmuş bildirim numaraları.
    #[serde(default)]
    pub processed: HashSet<String>,
    /// Keşfedilmiş ama henüz okunmamış bildirimler.
    #[serde(default)]
    pub pending: Vec<PendingDisclosure>,
    #[serde(default)]
    pub last_round: Option<String>,
    /// **Eksiksiz** tamamlanmış son taramanın günü (ISO).
    ///
    /// Yalnız tam tarama kaydedilir; eksik tarama üzerine ilerlemek atlanan
    /// pencerelerin bildirimlerini kalıcı olarak kaybettirir.
    #[serde(default)]
    pub last_scan: Option<String>,
}

/// İlk taramanın kaç gün geriye bakacağı.
///
/// İzahname arzdan ~2 ay önce, endeks duyurusu ilk işlemden birkaç gün sonra
/// yayımlanıyor; 90 gün sürecin tamamını rahatça kapsıyor.
const FULL_SCAN_DAYS: u32 = 90;

/// Artımlı taramada, en son taramanın üzerine eklenen gün payı.
///
/// KAP bildirimleri gecikmeli yayımlanabiliyor ve tur her zaman aynı saatte
/// çalışmıyor; bindirme olmadan iki tur arasındaki bildirimler düşer.
const SCAN_OVERLAP_DAYS: i64 = 3;

/// Bu turda taranacak gün sayısı.
///
/// Tarama **artımlıdır**: 90 günlük pencere 13 istek demek ve yenileme her 30
/// dakikada bir çalışıyor. Her turda tam pencereyi istemek listeleme ucunun
/// hız sınırını tetikliyor, sınır tetiklenince tarama tamamen boş dönüyordu —
/// yani sık tarama, hiç taramamaya dönüşüyordu. İlk tur geçmişi kurar,
/// sonrakiler yalnız araya giren günleri sorar.
pub fn scan_days(today: chrono::NaiveDate) -> u32 {
    window_days(&load_state(), today)
}

/// `scan_days`'in saf çekirdeği; diske dokunmadan sınanabilsin diye ayrıdır.
fn window_days(state: &FollowState, today: chrono::NaiveDate) -> u32 {
    let Some(last) = state.last_scan.as_deref().and_then(parse_date) else {
        return FULL_SCAN_DAYS;
    };
    let elapsed = (today - last).num_days().max(0) + SCAN_OVERLAP_DAYS;
    (elapsed as u32).min(FULL_SCAN_DAYS)
}

fn state_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|home| home.join(".fraude_ipo_follow.json"))
}

pub fn load_state() -> FollowState {
    state_path()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save_state(state: &FollowState) {
    let Some(path) = state_path() else { return };
    if let Ok(json) = serde_json::to_string(state) {
        let _ = std::fs::write(path, json);
    }
}

/// İzlenen bir arz: arşivdeki konumu ve tanınma anahtarları.
struct Watched {
    index: usize,
    ticker: Option<String>,
    name: String,
}

/// Arşivden izlenmeye değer kayıtları seçer.
///
/// Ölçüt iki yönlü: kaydın **eksiği olmalı** (tamamlanmışı taramak kotayı boşa
/// harcar) ve süreci **yakın zamanda** olmalı (2019'da arz edilmiş bir kaydın
/// bildirimi KAP penceresinde zaten yok).
fn watch_list(archive: &[PersistedIpo], today: chrono::NaiveDate) -> Vec<Watched> {
    archive
        .iter()
        .enumerate()
        .filter(|(_, ipo)| missing_fields(ipo))
        .filter(|(_, ipo)| in_watch_window(ipo, today))
        .map(|(index, ipo)| Watched {
            index,
            ticker: (!ipo.ticker.is_empty()).then(|| ipo.ticker.clone()),
            name: ipo.name.clone(),
        })
        .collect()
}

/// KAP'ın doldurabileceği alanlardan eksik olan var mı?
///
/// Yalnız bu modülün yazabildiği alanlara bakılır; halkarz.com'un alanlarına
/// (fon kullanımı, finansallar, fiyat istikrarı) bakmak her kaydı sonsuza dek
/// izlemede tutardı.
fn missing_fields(ipo: &PersistedIpo) -> bool {
    ipo.trading_start_date.is_none()
        || ipo.participant_count.is_none()
        || ipo.results_table.is_none()
        || ipo.major_shareholders.is_none()
        || ipo.index_name.is_none()
        || ipo.market.is_none()
        || ipo.lot_amount.is_none()
}

/// Kayıt, KAP taramasının eriştiği zaman aralığında mı?
fn in_watch_window(ipo: &PersistedIpo, today: chrono::NaiveDate) -> bool {
    if PENDING_STATUSES.contains(&ipo.status.as_str()) {
        return true;
    }
    let Some(date) = parse_date(&ipo.ipo_date) else {
        // Tarihi çözülemeyen tamamlanmış kayıt hangi pencereye düştüğü
        // bilinemez; taramaya alınırsa arşivin tamamı izlemede kalır.
        return false;
    };
    (today - date).num_days().abs() <= WATCH_WINDOW_DAYS
}

fn parse_date(value: &str) -> Option<chrono::NaiveDate> {
    let head = value.split_whitespace().next()?;
    chrono::NaiveDate::parse_from_str(head, "%Y-%m-%d")
        .or_else(|_| chrono::NaiveDate::parse_from_str(head, "%d.%m.%Y"))
        .ok()
}

/// Pay koduyla izlenen kaydı bulur; kod yoksa ya da eşleşmiyorsa `None`.
///
/// Kod eşleşmesi gövde indirmeden çalışan tek güvenilir yol: bildirimin
/// konusu olan pay `relatedStocks` alanında geliyor ve arzdan sonra kayda da
/// atanmış oluyor.
fn match_by_ticker(watch: &[Watched], ticker: Option<&str>) -> Option<usize> {
    let ticker = ticker?;
    watch.iter().position(|w| w.ticker.as_deref() == Some(ticker))
}

/// Gövdeden çıkan unvanla eşleştirir — kaydın kodu henüz yokken tek yol budur.
fn match_by_name(watch: &[Watched], data: &KapIpoExtractedData) -> Option<usize> {
    let name = data.company_name.as_deref()?;
    watch
        .iter()
        .position(|w| crate::company_match::same_company(&w.name, name))
}

/// Bir turu çalıştırır: izlenen arzların eksik alanlarını KAP'tan doldurur.
///
/// Bildirim listesi **dışarıdan** verilir: `ipo_pipeline` aynı listeyi zaten
/// çekiyor ve burada yeniden taramak, her yenilemede uçtan onlarca sayfa daha
/// istemek demekti. Tek tarama iki tüketiciyi besler.
///
/// Arşiv değiştiyse `true` döner. Ağ hatası turu bitirmez — bu tur ne
/// bulunduysa işlenir, kalanı bir sonraki tura kalır.
pub async fn follow_round(
    client: &Client,
    archive: &mut [PersistedIpo],
    scan: &crate::kap_ipo::IpoScan,
) -> bool {
    let mut state = load_state();
    let changed = run_round(client, archive, scan, &mut state).await;
    // Durum **en sonda** yazılır: arşiv kaydı `run_round` içinde tamamlanmış
    // olur ve ilerleme ancak verisi diskteyken imlenir.
    save_state(&state);
    changed
}

/// Turun çekirdeği; durumu çağıran taşır, böylece sınamalar kullanıcının
/// gerçek `~/.fraude_ipo_follow.json` dosyasına dokunmadan çalışabilir.
async fn run_round(
    client: &Client,
    archive: &mut [PersistedIpo],
    scan: &crate::kap_ipo::IpoScan,
    state: &mut FollowState,
) -> bool {
    let today = crate::kap::istanbul_today();
    let watch = watch_list(archive, today);

    // 1. Keşif: taramada çıkan yeni adaylar kalıcı kuyruğa eklenir.
    let discovered = enqueue_candidates(state, &scan.rows, &watch);

    // Tarama imleci keşiften hemen sonra ilerler: yığın artık kuyrukta
    // duruyor ve taramanın onu yeniden bulmasına gerek yok.
    if scan.complete {
        state.last_scan = Some(today.format("%Y-%m-%d").to_string());
    }

    if state.pending.is_empty() {
        report(&watch, 0, 0, discovered);
        return false;
    }

    // 2. Okuma: kota kıt, en yeni bildirim önce okunur. Bildirim numarası
    // zamanla arttığı için metin biçimindeki tarihten güvenilir bir anahtar.
    //
    // **Sayısal** sıralanır: numaralar bugün yedi basamaklı ve metin
    // karşılaştırması aynı sonucu veriyor, ama sekiz basamağa geçildiğinde
    // "10000000" < "9999999" olur ve kuyruk sessizce en eskiden başlar.
    state.pending.sort_by_key(|p| std::cmp::Reverse(p.index.parse::<u64>().unwrap_or(0)));
    let batch: Vec<PendingDisclosure> = state
        .pending
        .iter()
        .take(crate::kap_capital::FETCH_BUDGET)
        .cloned()
        .collect();

    // Gövde çekimi ortak: bütçe, aralık ve kota bitince durma mantığı
    // sermaye/temettü turlarıyla aynı uçtan ve aynı sınırdan geçiyor.
    let rows: Vec<RawDisclosure> = batch.iter().map(pending_row).collect();
    let round = crate::kap_capital::fetch_forms(client, &rows).await;
    let read = round.forms.len();

    let queued: std::collections::HashMap<&str, &PendingDisclosure> =
        batch.iter().map(|p| (p.index.as_str(), p)).collect();

    let mut changed = false;
    for (index, form) in &round.forms {
        let Some(candidate) = queued.get(index.as_str()) else { continue };

        let data = crate::kap_ipo::parse_form(form, candidate.kind);
        // Numara okunduğu an işlenmiş sayılır: gövdesi boş çıkan ya da
        // izlenen hiçbir arza ait olmayan bildirim de bir daha indirilmemeli.
        state.processed.insert(index.clone());
        state.pending.retain(|p| &p.index != index);
        if data.is_empty() {
            continue;
        }

        let target = match_by_ticker(&watch, candidate.ticker.as_deref())
            .or_else(|| match_by_name(&watch, &data));
        let Some(target) = target else { continue };
        let entry = &mut archive[watch[target].index];

        // Kodsuz kaydın kodu bildirimden gelir; köprünün asıl kazancı budur.
        // Şirket kodunu ancak listelenirken alıyor, o âna kadar arşivde
        // yalnız unvanla duruyor ve sonraki turlarda ad benzerliğine muhtaç
        // kalıyordu. Kod bir kez yazılınca eşleşme kesinleşir.
        if entry.ticker.is_empty() {
            if let Some(ticker) = &candidate.ticker {
                entry.ticker = ticker.clone();
                changed = true;
                eprintln!("[ipo_follow] {} kodu atandı: {ticker}", entry.name);
            }
        }

        if crate::ipo_pipeline::merge_extracted(entry, &data) {
            // Kaynak rozeti kullanıcıya alanın nereden geldiğini gösteriyor;
            // halkarz.com ile KAP aynı alanı farklı yazabildiği için ayrım
            // önemli.
            if !entry.data_sources.iter().any(|source| source == KAP_SOURCE) {
                entry.data_sources.push(KAP_SOURCE.to_string());
            }
            changed = true;
            eprintln!(
                "[ipo_follow] {} ← {:?} bildirimi işlendi",
                if entry.ticker.is_empty() { &entry.name } else { &entry.ticker },
                candidate.kind,
            );
        }
    }

    // Sıra önemli: **önce veri, sonra ilerleme**. Durumu çağıran (`follow_round`)
    // bu dönüşten sonra yazar; arşiv yazılamazsa (çökme, disk hatası)
    // ilerleme de imlenmemiş olur ve bildirimler tekrar okunur.
    if changed {
        crate::ipo_store::save(archive);
    }
    state.last_round = Some(today.format("%Y-%m-%d").to_string());

    report(&watch, state.pending.len(), read, discovered);
    changed
}

/// Yapacak işi olan her tur rapor verir.
///
/// Sessiz kalan bir tur, hız sınırına takıldığı için hiçbir şey okuyamadığında
/// "yapacak iş yoktu" gibi görünüyor ve haftalarca ilerlemediği fark
/// edilmiyor — o yüzden okunamama durumu açıkça yazılır. Gerçekten yapacak iş
/// olmayan tur ise susar: yenileme 30 dakikada bir çalışıyor ve boş satırlar
/// günlüğü, içindeki gerçek uyarıyı gizleyecek kadar doldurur.
fn report(watch: &[Watched], pending: usize, read: usize, discovered: usize) {
    if discovered == 0 && read == 0 && pending == 0 {
        return;
    }
    eprintln!(
        "[ipo_follow] {} izlenen arz · +{discovered} yeni · {read} okundu · {pending} kuyrukta{}",
        watch.len(),
        if read == 0 && pending > 0 {
            " (gövde alınamadı — hız sınırı olabilir)"
        } else {
            ""
        },
    );
}

/// Kuyruk kaydından gövde çekimi için gereken en az satır.
///
/// `fetch_forms` yalnız bildirim numarasını kullanıyor; kuyruğa ham satırın
/// tamamını yazmak durum dosyasını gereksiz şişirirdi.
fn pending_row(pending: &PendingDisclosure) -> RawDisclosure {
    RawDisclosure {
        publish_date: String::new(),
        subject: String::new(),
        disclosure_index: pending.index.parse().unwrap_or_default(),
        kap_title: String::new(),
        stock_codes: Vec::new(),
        related_stocks: Vec::new(),
    }
}

/// Taramada çıkan yeni adayları kuyruğa ekler; eklenen sayıyı döner.
///
/// Üç eleme: gövdesi yapısal veri taşımayan türler (izahname, fiyat raporu)
/// hiç indirilmez, daha önce okunanlar ya da kuyrukta olanlar atlanır,
/// kalanlardan yalnız izlenen bir arza bağlanabilenler ya da unvanı gövdede
/// yazan Borsa duyuruları alınır.
fn enqueue_candidates(
    state: &mut FollowState,
    rows: &[RawDisclosure],
    watch: &[Watched],
) -> usize {
    // Kodsuz kayıt varsa, konusu bilinmeyen Borsa duyurularının gövdesini
    // okumaya değer: unvan orada yazıyor ve koda giden tek köprü odur.
    let has_codeless = watch.iter().any(|w| w.ticker.is_none());
    let queued: HashSet<String> = state.pending.iter().map(|p| p.index.clone()).collect();
    let mut added = 0;

    for row in rows {
        let index = row.disclosure_index_str();
        if state.processed.contains(&index) || queued.contains(&index) {
            continue;
        }
        let Some(kind) = crate::kap_ipo::classify_disclosure(&row.subject) else {
            continue;
        };
        if !kind.has_form_body() {
            continue;
        }

        let ticker = crate::kap_ipo::subject_ticker(row);
        let watched = match_by_ticker(watch, ticker.as_deref()).is_some();
        // Borsa duyurularında unvan gövdede yazıyor; kodsuz bir kayıt varken
        // bunlar koda giden tek köprü olduğu için kodla eşleşmese de alınır.
        let names_company_in_body = matches!(
            kind,
            KapIpoDisclosureType::Listing | KapIpoDisclosureType::ExchangeNotice
        );
        let relevant = watched || (has_codeless && names_company_in_body);
        if !relevant {
            continue;
        }

        state.pending.push(PendingDisclosure { index, kind, ticker });
        added += 1;
    }

    added
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ipo(ticker: &str, status: &str, date: &str) -> PersistedIpo {
        PersistedIpo {
            ticker: ticker.to_string(),
            name: format!("{ticker} Sanayi A.Ş."),
            ipo_date: date.to_string(),
            status: status.to_string(),
            ..PersistedIpo::default()
        }
    }

    fn row(index: u64, subject: &str, related: &[&str]) -> RawDisclosure {
        RawDisclosure {
            publish_date: "30.07.2026 09:00:00".to_string(),
            subject: subject.to_string(),
            disclosure_index: index,
            kap_title: "BORSA İSTANBUL A.Ş.".to_string(),
            stock_codes: related.iter().map(|s| s.to_string()).collect(),
            related_stocks: related.iter().map(|s| s.to_string()).collect(),
        }
    }

    const TODAY: &str = "2026-08-08";
    fn today() -> chrono::NaiveDate {
        chrono::NaiveDate::parse_from_str(TODAY, "%Y-%m-%d").unwrap()
    }

    /// Tarama penceresi ilerlemeye göre daralmalı.
    ///
    /// Her turda 90 gün istemek listeleme ucunun hız sınırını tetikliyor ve
    /// sınır tetiklenince tarama **tamamen** boş dönüyor — yani sık tarama,
    /// hiç taramamaya dönüşüyordu.
    #[test]
    fn scan_window_shrinks_after_a_complete_scan() {
        let today = today();
        let full = FollowState::default();
        assert_eq!(window_days(&full, today), FULL_SCAN_DAYS);

        // Dün tam tarama yapıldıysa yalnız bindirme payı kadar geriye bakılır.
        let yesterday = FollowState {
            last_scan: Some((today - chrono::Duration::days(1)).format("%Y-%m-%d").to_string()),
            ..FollowState::default()
        };
        assert_eq!(window_days(&yesterday, today), 1 + SCAN_OVERLAP_DAYS as u32);

        // Uzun aradan sonra tam pencereyi aşmamalı.
        let stale = FollowState {
            last_scan: Some("2024-01-01".to_string()),
            ..FollowState::default()
        };
        assert_eq!(window_days(&stale, today), FULL_SCAN_DAYS);
    }

    /// Eksik tarama ilerlemeyi **kaydetmemeli**: atlanan pencere bir daha
    /// istenmezse o günlerin bildirimleri kalıcı olarak kaybolur.
    #[tokio::test]
    async fn an_incomplete_scan_does_not_advance_the_cursor() {
        let scan = crate::kap_ipo::IpoScan {
            rows: vec![row(1_700_001, "Halka Arz Sonuçları", &["MASFN"])],
            complete: false,
        };
        let mut state = FollowState::default();
        let mut archive = [ipo("MASFN", "AKTİF", "2026-07-24")];

        run_round(&crate::http_client(), &mut archive, &scan, &mut state).await;

        assert_eq!(state.last_scan, None, "eksik tarama imleci ilerletmemeli");
        // Aday yine de kuyruğa girmeli; keşif taramanın eksikliğinden bağımsız.
        assert_eq!(state.pending.len(), 1);
    }

    /// Bütçeyi aşan aday yığını **kuyrukta** birikir ve imleç yine ilerler.
    ///
    /// Kuyruk olmadan ikisi birbirine kilitleniyordu: imleci ilerletmek
    /// devredilen adayları taramanın dışında bırakıp kaybettiriyor, geniş
    /// pencereyi korumak ise her turda 13 listeleme isteği demek oluyordu.
    #[tokio::test]
    async fn a_backlog_survives_in_the_queue() {
        let overflow = crate::kap_capital::FETCH_BUDGET as u64 + 5;
        let rows: Vec<RawDisclosure> = (0..overflow)
            .map(|n| row(1_700_000 + n, "Halka Arz Sonuçları", &["MASFN"]))
            .collect();
        let scan = crate::kap_ipo::IpoScan { rows, complete: true };
        let mut state = FollowState::default();
        let mut archive = [ipo("MASFN", "AKTİF", "2026-07-24")];

        // Yalnız keşif aşaması sınanıyor; okuma ağ ister.
        let watch = watch_list(&archive, today());
        let discovered = enqueue_candidates(&mut state, &scan.rows, &watch);
        assert_eq!(discovered as u64, overflow, "yığının tamamı kuyruğa girmeli");

        // İmleç ilerlese de kuyruk korunduğu için hiçbir aday kaybolmaz.
        state.last_scan = Some("2026-08-08".to_string());
        let empty = crate::kap_ipo::IpoScan { rows: Vec::new(), complete: true };
        run_round(&crate::http_client(), &mut archive, &empty, &mut state).await;
        assert!(
            state.pending.len() as u64 >= overflow - crate::kap_capital::FETCH_BUDGET as u64,
            "okunamayan adaylar kuyrukta kalmalı"
        );
    }

    #[test]
    fn fresh_approvals_are_watched() {
        let archive = vec![ipo("KPEKS", "SPK ONAYLI", "Hazırlanıyor...")];
        assert_eq!(watch_list(&archive, today()).len(), 1);
    }

    /// Alanları tamamlanmış kayıt izlemeden çıkmalı; yoksa her tur kotayı
    /// yeniden harcar.
    #[test]
    fn complete_records_leave_the_watch_list() {
        let mut done = ipo("EMPAE", "TAMAMLANDI", "2026-07-01");
        done.trading_start_date = Some("2026-07-05".to_string());
        done.participant_count = Some("1.134.537".to_string());
        done.results_table = Some(Vec::new());
        done.major_shareholders = Some("yoktur".to_string());
        done.index_name = Some("XUTUM".to_string());
        done.market = Some("Yıldız Pazar".to_string());
        done.lot_amount = Some("38.000.000 Lot".to_string());

        assert!(watch_list(&[done], today()).is_empty());
    }

    /// KAP penceresi geriye yalnız birkaç ay bakıyor; eski arzları izlemek
    /// bulunamayacak bildirimler için kota harcamak olur.
    #[test]
    fn old_completed_records_are_not_watched() {
        let archive = vec![ipo("BOBET", "TAMAMLANDI", "2021-09-14")];
        assert!(watch_list(&archive, today()).is_empty());
    }

    /// Regresyon: halka arz bildirimini konsorsiyum lideri yapıyor. Konusu
    /// `relatedStocks`te; bildirimi yapanın kodu okunursa veri aracı kurumun
    /// kaydına yazılır.
    #[test]
    fn candidates_match_on_the_subject_company_not_the_filer() {
        let watch = watch_list(&[ipo("MASFN", "AKTİF", "2026-07-24")], today());
        let mut broker_row = row(1636762, "Halka Arz Sonuçları", &["MASFN"]);
        broker_row.stock_codes = vec!["DZY".to_string(), "DZYMK".to_string()];

        // Bildirimin konusu aracı kurumun kodundan değil ilgili paylardan okunur.
        let subject = crate::kap_ipo::subject_ticker(&broker_row);
        assert_eq!(subject.as_deref(), Some("MASFN"));
        assert_eq!(match_by_ticker(&watch, subject.as_deref()), Some(0));

        // Kuyruğa da konusu olan kodla girmeli.
        let mut state = FollowState::default();
        assert_eq!(enqueue_candidates(&mut state, &[broker_row], &watch), 1);
        assert_eq!(state.pending[0].ticker.as_deref(), Some("MASFN"));
    }

    /// Gövdesi boş türler (izahname, fiyat tespit raporu) indirilmemeli: içerik
    /// ekte, export'ta yalnız "… ektedir." kalıyor ve kota boşa gidiyor.
    #[test]
    fn bodyless_subjects_are_not_downloaded() {
        let watch = watch_list(&[ipo("MASFN", "AKTİF", "2026-07-24")], today());
        let state = FollowState::default();
        let rows = vec![
            row(1, "İzahname (SPK Tarafından Onaylanan)", &["MASFN"]),
            row(2, "Fiyat Tespit Raporu", &["MASFN"]),
            row(3, "Halka Arz Sonuçları", &["MASFN"]),
        ];

        let mut state = state;
        assert_eq!(enqueue_candidates(&mut state, &rows, &watch), 1);
        assert_eq!(state.pending[0].index, "3");
    }

    #[test]
    fn processed_disclosures_are_skipped() {
        let watch = watch_list(&[ipo("MASFN", "AKTİF", "2026-07-24")], today());
        let mut state = FollowState::default();
        state.processed.insert("1636762".to_string());

        let rows = vec![row(1636762, "Halka Arz Sonuçları", &["MASFN"])];
        assert_eq!(enqueue_candidates(&mut state, &rows, &watch), 0);
        assert!(state.pending.is_empty());
    }

    /// İzlenen hiçbir arza bağlanmayan bildirim indirilmemeli — "%5'inden
    /// fazlası" başlığı bedelli sermaye artırımlarında da kullanılıyor ve
    /// akışta halka arzlardan çok onlar var.
    #[test]
    fn unrelated_disclosures_are_ignored() {
        let watch = watch_list(&[ipo("MASFN", "AKTİF", "2026-07-24")], today());
        let rows = vec![row(
            9,
            "Halka Arz İşlemlerinde Sermaye Piyasası Aracının % 5 inden Fazlasını Satın Alanlara İlişkin Bildirim",
            &["FENER"],
        )];
        assert_eq!(
            enqueue_candidates(&mut FollowState::default(), &rows, &watch),
            0
        );
    }

    /// Kodsuz kayıt varken Borsa duyuruları okunmalı: unvan gövdede yazıyor ve
    /// koda giden tek köprü odur.
    #[test]
    fn codeless_records_pull_in_exchange_notices() {
        let watch = watch_list(&[ipo("", "SPK ONAYLI", "Hazırlanıyor...")], today());
        let rows = vec![row(7, "Payların İşlem Görmeye Başlaması", &["YENIA"])];

        let mut state = FollowState::default();
        assert_eq!(enqueue_candidates(&mut state, &rows, &watch), 1);
        // Kod izlenen kayda ait değil; eşleşme gövdedeki unvandan çıkacak ve
        // kod oradan kayda yazılacak — köprünün asıl kazancı bu.
        assert_eq!(state.pending[0].ticker.as_deref(), Some("YENIA"));
    }

    /// Kodsuz bir taslak, Borsa duyurusunun gövdesindeki unvandan eşleşince
    /// **kodunu da** almalı. Almazsa her turda yeniden ad benzerliğine muhtaç
    /// kalır ve unvan yazımı değişirse bağ kopar.
    #[tokio::test]
    async fn a_matched_draft_receives_its_ticker() {
        let mut archive = [PersistedIpo {
            name: "Masfen Enerji A.Ş.".to_string(),
            status: "SPK ONAYLI".to_string(),
            ipo_date: "Hazırlanıyor...".to_string(),
            ..PersistedIpo::default()
        }];
        let watch = watch_list(&archive, today());
        assert!(watch[0].ticker.is_none(), "kayıt kodsuz başlamalı");

        // Gövde unvanı taşır; kod bildirimin ilgili paylarından gelir.
        let data = KapIpoExtractedData {
            company_name: Some("Masfen Enerji A.Ş.".to_string()),
            market: Some("Yıldız Pazar".to_string()),
            ..KapIpoExtractedData::default()
        };
        let target = match_by_name(&watch, &data).expect("unvan eşleşmeli");
        let entry = &mut archive[watch[target].index];
        entry.ticker = "MASFN".to_string();
        crate::ipo_pipeline::merge_extracted(entry, &data);

        assert_eq!(archive[0].ticker, "MASFN");
        assert_eq!(archive[0].market.as_deref(), Some("Yıldız Pazar"));
    }

    /// **Otomasyon sözleşmesi.** Bültende bir halka arz onayı çıktığı andan
    /// menünün dolduğu ana kadar zincirin tamamı, ağa çıkmadan:
    ///
    /// 1. SPK bülteni onayı → arşivde "SPK ONAYLI" kayıt (fiyat, lot),
    /// 2. kayıt kendiliğinden izlemeye girer,
    /// 3. günler sonra yayımlanan KAP bildirimleri aday olarak seçilir,
    /// 4. gövdeleri menünün istediği alanları doldurur,
    /// 5. kayıt tamamlanınca izlemeden düşer.
    ///
    /// Zincirin herhangi bir halkası koparsa süreç sessizce durur ve kullanıcı
    /// bunu ancak aylar sonra boş sütunlardan fark eder.
    #[test]
    fn approval_to_filled_record_runs_without_intervention() {
        // 1. Bülten onayı geldi; arşivde bu şirketin kaydı yok.
        let approval = crate::spk::SpkIpoApproval {
            company_name: "Masfen Enerji A.Ş.".to_string(),
            ticker: None,
            capital_increase_lots: 85_000_000.0,
            share_sale_lots: 0.0,
            extra_sale_lots: 0.0,
            total_lots: 85_000_000.0,
            price: 45.68,
            ipo_size_tl: 3_882_800_000.0,
            price_range: None,
            consortium_lead: None,
            bulletin_no: "2026/45".to_string(),
            approval_date: chrono::Local::now().format("%Y-%m-%d").to_string(),
        };
        let result = crate::ipo_pipeline::PipelineResult {
            spk_applications: Vec::new(),
            spk_approvals: vec![approval],
            kap_disclosures: Vec::new(),
            kap_scan: crate::kap_ipo::IpoScan { rows: Vec::new(), complete: true },
            scraper_ipos: Vec::new(),
            errors: Vec::new(),
        };
        let mut archive = Vec::new();
        assert!(crate::ipo_pipeline::merge_pipeline_into_archive(&mut archive, &result));
        assert_eq!(archive.len(), 1, "onay kayıt doğurmalı");
        assert_eq!(archive[0].status, "SPK ONAYLI");

        // 2. Kayıt kendiliğinden izlemeye girmeli — kodu henüz yok.
        let watch = watch_list(&archive, today());
        assert_eq!(watch.len(), 1, "yeni onay izlemeye girmeli");
        assert!(watch[0].ticker.is_none());

        // 3. Kod atanınca (arz gerçekleşti) bildirimler aday olmalı.
        archive[0].ticker = "MASFN".to_string();
        let watch = watch_list(&archive, today());
        let rows = vec![
            row(1636762, "Halka Arz Sonuçları", &["MASFN"]),
            row(1637308, "Payların İşlem Görmeye Başlaması", &["MASFN"]),
            row(1639195, "Endeks Şirketlerinde Değişiklik", &["MASFN"]),
            row(1620936, "İzahname (SPK Tarafından Onaylanan)", &["MASFN"]),
        ];
        let mut state = FollowState::default();
        assert_eq!(
            enqueue_candidates(&mut state, &rows, &watch),
            3,
            "gövdesiz izahname aday olmamalı"
        );

        // 4. Gövdeler menünün alanlarını doldurmalı.
        let bodies = [
            (
                KapIpoDisclosureType::Result,
                vec![
                    vec!["HALKA ARZ FİYATI".to_string(), "45,68".to_string()],
                    vec![
                        "HALKA ARZA KATILAN TOPLAM YATIRIMCI SAYISI".to_string(),
                        "1.093.898".to_string(),
                    ],
                    vec![
                        "Yurt İçi Bireysel Yatırımcı Sayısı".to_string(),
                        "1.089.645".to_string(),
                    ],
                ],
            ),
            (
                KapIpoDisclosureType::Listing,
                vec![
                    vec![
                        "İşlem Görmeye Başlayacağı Tarih".to_string(),
                        "30/07/2026".to_string(),
                    ],
                    vec!["İşlem Göreceği Pazar".to_string(), "Yıldız Pazar".to_string()],
                    vec![
                        "İşlem Görecek Payların Nominal Tutarı (TL)".to_string(),
                        "85.000.000".to_string(),
                    ],
                ],
            ),
            (
                KapIpoDisclosureType::MajorBuyers,
                vec![vec![
                    String::new(),
                    "Masfen Enerji A.Ş. halka arzında %5'inden fazlasını alan kişi yoktur."
                        .to_string(),
                ]],
            ),
            (
                KapIpoDisclosureType::IndexChange,
                vec![
                    vec![
                        "Pay Adı".to_string(),
                        "Kapsamına Dahil Edildiği Endeks".to_string(),
                    ],
                    vec!["MASFEN ENERJİ".to_string(), "XUTUM".to_string()],
                ],
            ),
        ];
        for (kind, rows) in bodies {
            let data = crate::kap_ipo::parse_form(&crate::kap::KapForm { rows }, kind);
            assert!(!data.is_empty(), "{kind:?} gövdesi boş çözüldü");
            crate::ipo_pipeline::merge_extracted(&mut archive[0], &data);
        }

        let filled = &archive[0];
        assert_eq!(filled.trading_start_date.as_deref(), Some("2026-07-30"));
        assert_eq!(filled.participant_count.as_deref(), Some("1.093.898"));
        assert_eq!(filled.market.as_deref(), Some("Yıldız Pazar"));
        assert_eq!(filled.lot_amount.as_deref(), Some("85.000.000 Lot"));
        assert_eq!(filled.index_name.as_deref(), Some("XUTUM"));
        assert!(filled.results_table.is_some());
        assert!(filled.major_shareholders.is_some());
        // Bültenden gelen fiyat korunmalı; KAP aynı değeri taşıyor.
        assert_eq!(filled.price, 45.68);

        // 5. Tamamlanan kayıt izlemeden düşmeli, yoksa kotayı sonsuza dek yer.
        assert!(
            watch_list(&archive, today()).is_empty(),
            "dolan kayıt izlemede kalmamalı"
        );
    }

    /// Uçtan uca: gerçek arşiv ve canlı KAP ile bir tur.
    #[tokio::test]
    #[ignore = "canlı KAP erişimi gerektirir; ~/.fraude_ipos.json ve ~/.fraude_ipo_follow.json dosyalarını yazar"]
    async fn live_round_fills_missing_fields() {
        let client = crate::http_client();
        let mut archive = crate::ipo_store::load();
        let watched = watch_list(&archive, crate::kap::istanbul_today()).len();

        let days = scan_days(crate::kap::istanbul_today());
        let scan = crate::kap_ipo::fetch_ipo_rows(&client, days).await;
        assert!(scan.complete, "tarama eksik döndü (hız sınırı?)");

        let changed = follow_round(&client, &mut archive, &scan).await;
        println!(
            "izlenen: {watched} · {days} gün · bildirim: {} · değişti: {changed}",
            scan.rows.len()
        );

        for ipo in archive.iter().filter(|i| i.trading_start_date.is_some()) {
            assert!(
                !ipo.trading_start_date.as_deref().unwrap_or_default().is_empty(),
                "boş ilk işlem tarihi: {ipo:?}"
            );
        }
    }
}
