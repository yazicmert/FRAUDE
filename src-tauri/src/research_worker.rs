//! Araştırma işleri arka plan worker'ı.
//!
//! Monitor döngüsü desenini izler: kuyruktaki işleri sırayla işler, ağ
//! işlemlerini store kilidi DIŞINDA yapar, bitince webview olayı + OS bildirimi
//! gönderir. Yeni iş eklendiğinde `ResearchSignal` ile uyandırılır; ayrıca 15 sn
//! fallback poll ile de kontrol eder. Aynı anda tek iş çalışır (maliyet ve
//! öngörülebilirlik için) — team işi 4 rol + sentez çağrısı yapabildiğinden
//! seri işleme kasıtlıdır.

use std::sync::Arc;
use std::time::Duration;

use tauri::{Emitter, Manager};
use tokio::sync::Notify;

use crate::research::{self, JobKind, JobStatus, ResearchJob, ResearchOutcome};
use crate::{domain, AppState};

/// Worker'ı uyandırma sinyali; komut ve köprü yeni iş eklediğinde tetikler.
pub struct ResearchSignal {
    pub notify: Arc<Notify>,
}

impl Default for ResearchSignal {
    fn default() -> Self {
        Self {
            notify: Arc::new(Notify::new()),
        }
    }
}

impl ResearchSignal {
    pub fn wake(&self) {
        self.notify.notify_one();
    }
}

/// Setup'ta spawn edilen ana döngü.
pub async fn run_research_worker(handle: tauri::AppHandle) {
    // Açılış kurtarması: önceki oturumda yarıda kalmış (Running) işleri Error'a çevir.
    {
        let state = handle.state::<AppState>();
        let mut store = state.store.lock().await;
        let mut changed = false;
        for job in store.research_jobs.iter_mut() {
            if job.status == JobStatus::Running {
                job.status = JobStatus::Error;
                job.error = Some("Uygulama kapandığı için araştırma yarıda kaldı.".into());
                job.finished_at = Some(research::iso_now());
                job.updated_at_ms = research::now_ms();
                job.input.image_data_url = None;
                changed = true;
            }
        }
        if changed {
            store.save_research_jobs();
        }
    }

    let notify = {
        let sig = handle.state::<ResearchSignal>();
        sig.notify.clone()
    };

    loop {
        // Kuyruğu boşalt.
        loop {
            let state = handle.state::<AppState>();
            if !process_next_job(&handle, state.inner()).await {
                break;
            }
        }
        // Sinyal ya da fallback zaman aşımı bekle.
        tokio::select! {
            _ = notify.notified() => {},
            _ = tokio::time::sleep(Duration::from_secs(15)) => {},
        }
    }
}

/// Kuyruktaki ilk işi işler. İşlenecek iş yoksa false döner.
async fn process_next_job(handle: &tauri::AppHandle, state: &AppState) -> bool {
    // 1) Kısa kilit: bir sonraki Queued işi sahiplen (Running yap) ve gerekli
    //    verileri kopyala. Ağ işlemleri bu kilit dışında yapılır.
    let (job, agents, ai_keys, equities) = {
        let mut store = state.store.lock().await;
        let Some(idx) = store
            .research_jobs
            .iter()
            .position(|j| j.status == JobStatus::Queued)
        else {
            return false;
        };
        {
            let j = &mut store.research_jobs[idx];
            j.status = JobStatus::Running;
            j.started_at = Some(research::iso_now());
            j.updated_at_ms = research::now_ms();
        }
        let job = store.research_jobs[idx].clone();
        let agents = store.agents.clone();
        let ai_keys = store.ai_keys.clone();
        let equities = store.equities.clone();
        store.save_research_jobs();
        (job, agents, ai_keys, equities)
    };

    emit_job(handle, &job);

    // 2) Orkestrasyon (kilitsiz, ağ).
    let result: Result<ResearchOutcome, String> = match job.kind {
        JobKind::TickerTeam => {
            let ticker = job.input.ticker.clone().unwrap_or_default();
            let team = job.team.clone().unwrap_or_default();
            research::run_team_research(
                &state.http,
                &ticker,
                &team,
                &agents,
                &ai_keys,
                &equities,
            )
            .await
        }
        JobKind::Custom => {
            let agent = job
                .agent_id
                .as_deref()
                .and_then(|id| agents.iter().find(|a| a.id == id));
            research::run_custom_research(&state.http, &job.input, agent, &ai_keys).await
        }
    };

    // 3) Kısa kilit: sonucu yaz, raporu Artifact olarak kaydet.
    let finished = {
        let mut store = state.store.lock().await;
        let Some(idx) = store.research_jobs.iter().position(|j| j.id == job.id) else {
            // İş arada silinmiş olabilir; bir sonraki tura geç.
            return true;
        };
        match result {
            Ok(outcome) => {
                let artifact_id = format!("art-{}", research::now_ms());
                let created = research::iso_now();
                store.artifacts.push(domain::Artifact {
                    id: artifact_id.clone(),
                    title: outcome.title.clone(),
                    content: outcome.report.clone(),
                    created_at: created.clone(),
                });
                store.save_artifacts();

                let j = &mut store.research_jobs[idx];
                j.report = Some(outcome.report);
                j.artifact_id = Some(artifact_id);
                j.status = JobStatus::Done;
                j.finished_at = Some(created);
                j.updated_at_ms = research::now_ms();
                j.notified_app = true;
                j.input.image_data_url = None;
            }
            Err(e) => {
                let j = &mut store.research_jobs[idx];
                j.status = JobStatus::Error;
                j.error = Some(e);
                j.finished_at = Some(research::iso_now());
                j.updated_at_ms = research::now_ms();
                j.notified_app = true;
                j.input.image_data_url = None;
            }
        }
        store.save_research_jobs();
        store.research_jobs[idx].clone()
    };

    emit_job(handle, &finished);
    notify_os(handle, &finished);
    true
}

fn emit_job(handle: &tauri::AppHandle, job: &ResearchJob) {
    let _ = handle.emit("fraude-research-update", serde_json::json!({ "job": job }));
}

fn notify_os(handle: &tauri::AppHandle, job: &ResearchJob) {
    use tauri_plugin_notification::NotificationExt;
    let (title, body) = match job.status {
        JobStatus::Done => ("✅ Araştırma tamamlandı".to_string(), job.title.clone()),
        JobStatus::Error => (
            "⚠️ Araştırma başarısız".to_string(),
            job.error.clone().unwrap_or_else(|| job.title.clone()),
        ),
        _ => return,
    };
    let _ = handle.notification().builder().title(title).body(body).show();
}
