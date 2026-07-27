//! Chrome eklentisi için localhost köprüsü.
//!
//! Uygulama açıkken 127.0.0.1'de küçük bir axum sunucusu dinler; Chrome
//! eklentisi buraya serbest araştırma görevleri gönderir ve iş durumlarını
//! yoklar. Kimlik: uygulama ilk açılışta rastgele bir eşleştirme (pairing)
//! token'ı üretir (`~/.fraude_bridge.json`), Ayarlar'da gösterilir; tüm
//! `/ext/*` istekleri `Authorization: Bearer <token>` ister. Yalnız loopback +
//! token olduğundan CORS gevşektir.
//!
//! Aynı `AppState`'i ve `ResearchSignal`'i Tauri komutlarıyla paylaşır; iş
//! kuyruğu ve worker ortaktır — eklenti işi uygulamada da görünür.

use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, Method, StatusCode},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::Manager;
use tower_http::cors::{Any, CorsLayer};

use crate::research::{self, JobSource, JobStatus, SubmitResearchJobRequest};
use crate::research_worker::ResearchSignal;
use crate::AppState;

/// Denenecek port aralığı (ilk boş olan bağlanır). Eklenti Ayarlar'da gösterilen
/// gerçek portu kullanır.
const PORT_RANGE: std::ops::RangeInclusive<u16> = 8799..=8809;

/// Uygulamada giriş yapmış üye. Frontend (AuthGate) lisansı onayladığında
/// `set_bridge_identity` ile buraya yazar; çıkışta temizlenir. Köprü bu bilgiyi
/// eklentiye bildirir ve oturum yoksa iş göndermeyi reddeder.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct BridgeAccount {
    pub email: String,
    pub name: String,
}

/// Köprü durumu (Tauri state olarak yönetilir). Token ve hesap canlı okunur;
/// böylece token yenileme / giriş-çıkış sunucuyu yeniden başlatmadan anında
/// etkili olur.
pub struct BridgeHandle {
    pub token: std::sync::Mutex<String>,
    /// Bağlanan gerçek port; 0 = henüz bağlanmadı.
    pub port: std::sync::Mutex<u16>,
    /// Giriş yapmış üye; None = uygulamada oturum açılmamış.
    pub account: std::sync::Mutex<Option<BridgeAccount>>,
}

impl BridgeHandle {
    pub fn load() -> Self {
        BridgeHandle {
            token: std::sync::Mutex::new(load_or_create_token()),
            port: std::sync::Mutex::new(0),
            account: std::sync::Mutex::new(None),
        }
    }

    /// Zehirlenmeye dayanıklı kilit alma.
    ///
    /// Bu kilitler yalnız küçük değerleri (token, port, hesap) koruyor; bir
    /// panik sırasında tutuluyor olsalar bile içerideki veri tutarsız kalmaz.
    /// Düz `.unwrap()` ise zehirlenmiş kilidi kalıcı panik kaynağına çevirir:
    /// tek bir panikten sonra köprünün **her** isteği ve Ayarlar'daki token
    /// ekranı uygulama kapanana kadar çöker. Çekirdek crate her yerde bu
    /// kalıbı kullanıyor (bkz. `core/src/live_quotes.rs`).
    pub fn guard<T>(lock: &std::sync::Mutex<T>) -> std::sync::MutexGuard<'_, T> {
        lock.lock().unwrap_or_else(|error| error.into_inner())
    }
}

fn bridge_file_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join(".fraude_bridge.json"))
}

fn load_or_create_token() -> String {
    if let Some(path) = bridge_file_path() {
        if let Ok(data) = std::fs::read_to_string(&path) {
            if let Ok(v) = serde_json::from_str::<Value>(&data) {
                if let Some(t) = v.get("token").and_then(|t| t.as_str()) {
                    if !t.is_empty() {
                        return t.to_string();
                    }
                }
            }
        }
    }
    let token = generate_token();
    save_token(&token);
    token
}

fn save_token(token: &str) {
    if let Some(path) = bridge_file_path() {
        let _ = crate::persist::write_json_atomic(&path, &json!({ "token": token }));
    }
}

fn generate_token() -> String {
    let mut buf = [0u8; 24];
    if getrandom::getrandom(&mut buf).is_err() {
        // Düşük entropili yedek (RNG erişilemezse boş kalmasın).
        let seed = (research::now_ms() as u64) ^ (std::process::id() as u64).rotate_left(17);
        for (i, b) in buf.iter_mut().enumerate() {
            *b = ((seed >> ((i % 8) * 8)) as u8) ^ (i as u8);
        }
    }
    buf.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Yeni token üretir, kalıcılaştırır ve canlı state'e yazar. Yeni değeri döner.
pub fn regenerate_token(handle: &BridgeHandle) -> String {
    let token = generate_token();
    save_token(&token);
    *BridgeHandle::guard(&handle.token) = token.clone();
    token
}

/// Setup'ta spawn edilen sunucu döngüsü.
pub async fn run_bridge(handle: tauri::AppHandle) {
    let app = Router::new()
        .route("/ext/v1/state", get(get_state))
        .route("/ext/v1/jobs", get(list_jobs).post(submit_job))
        .layer(cors())
        .with_state(handle.clone());

    let mut bound = None;
    for port in PORT_RANGE {
        let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
        if let Ok(listener) = tokio::net::TcpListener::bind(addr).await {
            bound = Some((listener, port));
            break;
        }
    }
    let Some((listener, port)) = bound else {
        eprintln!("Fraude köprüsü: {PORT_RANGE:?} aralığında boş port bulunamadı.");
        return;
    };

    {
        let bh = handle.state::<BridgeHandle>();
        *BridgeHandle::guard(&bh.port) = port;
    }
    eprintln!("Fraude köprüsü dinlemede: http://127.0.0.1:{port}/ext/v1");

    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("Fraude köprüsü durdu: {e}");
    }
}

fn cors() -> CorsLayer {
    CorsLayer::new()
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION])
        .allow_origin(Any)
}

fn check_auth(handle: &tauri::AppHandle, headers: &HeaderMap) -> Result<(), (StatusCode, String)> {
    let token = BridgeHandle::guard(&handle.state::<BridgeHandle>().token).clone();
    let provided = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .unwrap_or("")
        .trim();
    if !token.is_empty() && provided == token {
        Ok(())
    } else {
        Err((StatusCode::UNAUTHORIZED, "yetkisiz".into()))
    }
}

/// GET /ext/v1/state → aktif ajanlar (boşta/meşgul) + çalışan iş sayısı.
async fn get_state(
    State(handle): State<tauri::AppHandle>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, String)> {
    check_auth(&handle, &headers)?;
    let state = handle.state::<AppState>();
    let store = state.store.lock().await;

    let busy_agents: std::collections::HashSet<String> = store
        .research_jobs
        .iter()
        .filter(|j| j.status == JobStatus::Running)
        .filter_map(|j| j.agent_id.clone())
        .collect();

    let running = store
        .research_jobs
        .iter()
        .filter(|j| j.status == JobStatus::Running)
        .count();

    let agents: Vec<Value> = store
        .agents
        .iter()
        .filter(|a| a.is_active)
        .map(|a| {
            json!({
                "id": a.id,
                "name": a.name,
                "role": a.role_description,
                "busy": busy_agents.contains(&a.id),
            })
        })
        .collect();

    let account = BridgeHandle::guard(&handle.state::<BridgeHandle>().account).clone();

    Ok(Json(json!({ "agents": agents, "jobsRunning": running, "account": account })))
}

#[derive(Deserialize)]
struct SinceQuery {
    #[serde(default)]
    since: Option<i64>,
}

/// GET /ext/v1/jobs?since=<ms> → `since`'ten sonra güncellenen işler.
async fn list_jobs(
    State(handle): State<tauri::AppHandle>,
    headers: HeaderMap,
    Query(q): Query<SinceQuery>,
) -> Result<Json<Value>, (StatusCode, String)> {
    check_auth(&handle, &headers)?;
    let state = handle.state::<AppState>();
    let store = state.store.lock().await;
    let since = q.since.unwrap_or(0);
    let jobs: Vec<_> = store
        .research_jobs
        .iter()
        .filter(|j| j.updated_at_ms > since)
        .cloned()
        .collect();
    Ok(Json(json!({ "jobs": jobs })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtJobBody {
    #[serde(default)]
    prompt: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    image_data_url: Option<String>,
    #[serde(default)]
    agent_id: Option<String>,
}

/// POST /ext/v1/jobs → serbest (custom) iş oluştur, worker'ı uyandır.
async fn submit_job(
    State(handle): State<tauri::AppHandle>,
    headers: HeaderMap,
    Json(body): Json<ExtJobBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    check_auth(&handle, &headers)?;
    // Üyelik denetimi: uygulamada oturum açılmamışsa iş kabul edilmez.
    let signed_in = BridgeHandle::guard(&handle.state::<BridgeHandle>().account).is_some();
    if !signed_in {
        return Err((
            StatusCode::FORBIDDEN,
            "Uygulamada oturum açık değil. Fraude'ye giriş yapın.".into(),
        ));
    }
    let req = SubmitResearchJobRequest {
        kind: research::JobKind::Custom,
        ticker: None,
        prompt: body.prompt,
        url: body.url,
        image_data_url: body.image_data_url,
        agent_id: body.agent_id,
    };
    let state = handle.state::<AppState>();
    let id = {
        let mut store = state.store.lock().await;
        research::enqueue_job(&mut store, JobSource::Extension, req)
            .map_err(|e| (StatusCode::BAD_REQUEST, e))?
    };
    handle.state::<ResearchSignal>().wake();
    Ok(Json(json!({ "jobId": id })))
}
