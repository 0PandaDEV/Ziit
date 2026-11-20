use std::{
    collections::HashMap,
    sync::{
        LazyLock, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

use futures::StreamExt;
use serde::Serialize;
use tokio::sync::Semaphore;

use super::{
    heartbeats::{finalize_import, process_heartbeats_by_date},
    wakapi::{handle_wakapi_sequential_import, prepare_wakapi_data},
    wakatime::{
        WakatimeExportData, handle_wakatime_import, map_heartbeat, prepare_wakatime_file_data,
    },
};

const WORKER_COUNT: usize = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum ImportStatus {
    #[serde(rename = "Processing")]
    Processing,
    #[serde(rename = "Processing heartbeats")]
    ProcessingHeartbeats,
    #[serde(rename = "Uploading")]
    Uploading,
    #[serde(rename = "Creating data dump request")]
    CreatingDataDumpRequest,
    #[serde(rename = "Waiting for data dump")]
    WaitingForDataDump,
    #[serde(rename = "Downloading")]
    Downloading,
    #[serde(rename = "Fetching metadata")]
    FetchingMetadata,
    #[serde(rename = "Completed")]
    Completed,
    #[serde(rename = "Failed")]
    Failed,
}

impl ImportStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Processing => "Processing",
            Self::ProcessingHeartbeats => "Processing heartbeats",
            Self::Uploading => "Uploading",
            Self::CreatingDataDumpRequest => "Creating data dump request",
            Self::WaitingForDataDump => "Waiting for data dump",
            Self::Downloading => "Downloading",
            Self::FetchingMetadata => "Fetching metadata",
            Self::Completed => "Completed",
            Self::Failed => "Failed",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum ImportMethod {
    #[serde(rename = "wakatime-api")]
    WakatimeApi,
    #[serde(rename = "wakatime-file")]
    WakatimeFile,
    #[serde(rename = "wakapi")]
    Wakapi,
}

impl ImportMethod {
    fn name(self) -> &'static str {
        if self == Self::Wakapi {
            "WakAPI"
        } else {
            "WakaTime"
        }
    }

    fn log_prefix(self) -> &'static str {
        if self == Self::Wakapi {
            "wakapi"
        } else {
            "wakatime"
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportJob {
    pub id: String,
    pub file_name: String,
    pub status: ImportStatus,
    pub message: Option<String>,
    pub progress: i64,
    pub imported_count: Option<i64>,
    pub error: Option<String>,
    pub user_id: String,
    #[serde(rename = "type")]
    pub kind: Option<ImportMethod>,
    pub total_size: Option<i64>,
    pub uploaded_size: Option<i64>,
    pub processed_count: Option<i64>,
    pub total_to_process: Option<i64>,
    pub file_id: Option<String>,
}

impl ImportJob {
    pub fn new(id: &str, user_id: &str, kind: ImportMethod, file_name: String) -> Self {
        Self {
            id: id.to_string(),
            file_name,
            status: ImportStatus::Processing,
            message: Some(format!("[{}] Queued", kind.name())),
            progress: 0,
            imported_count: None,
            error: None,
            user_id: user_id.to_string(),
            kind: Some(kind),
            total_size: None,
            uploaded_size: None,
            processed_count: None,
            total_to_process: None,
            file_id: None,
        }
    }
}

#[derive(Default, Clone)]
pub struct Update {
    pub status: Option<ImportStatus>,
    pub current: Option<i64>,
    pub total: Option<i64>,
    pub imported_count: Option<i64>,
    pub error: Option<String>,
    pub additional_info: Option<String>,
}

impl Update {
    pub fn status(status: ImportStatus) -> Self {
        Self {
            status: Some(status),
            ..Default::default()
        }
    }

    pub fn progress(status: ImportStatus, current: i64, total: i64) -> Self {
        Self {
            status: Some(status),
            current: Some(current),
            total: Some(total),
            ..Default::default()
        }
    }

    pub fn completed(imported: Option<i64>) -> Self {
        Self {
            status: Some(ImportStatus::Completed),
            imported_count: imported,
            ..Default::default()
        }
    }

    pub fn failed(error: impl Into<String>) -> Self {
        Self {
            status: Some(ImportStatus::Failed),
            error: Some(error.into()),
            ..Default::default()
        }
    }
}

static JOBS: LazyLock<Mutex<HashMap<String, ImportJob>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static QUEUED: AtomicUsize = AtomicUsize::new(0);
static BUSY: AtomicUsize = AtomicUsize::new(0);
static PERMITS: LazyLock<Semaphore> = LazyLock::new(|| Semaphore::new(WORKER_COUNT));

fn group_digits(value: i64) -> String {
    let digits = value.abs().to_string();
    let mut out = String::new();
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(ch);
    }
    if value < 0 { format!("-{out}") } else { out }
}

fn format_status(job: &ImportJob, status: ImportStatus, u: &Update) -> String {
    let prefix = job.kind.map(ImportMethod::name).unwrap_or("WakaTime");
    let progress = format!(" ({}%)", job.progress);
    let has_progress = matches!((u.current, u.total), (Some(_), Some(t)) if t > 0);
    match status {
        ImportStatus::ProcessingHeartbeats => {
            if has_progress {
                let info = u
                    .additional_info
                    .as_ref()
                    .map(|i| format!(" {i}"))
                    .unwrap_or_default();
                format!(
                    "[{prefix}] Importing data: {}/{} days{info}{progress}",
                    u.current.unwrap(),
                    u.total.unwrap()
                )
            } else if let Some(info) = &u.additional_info {
                format!("[{prefix}] Importing data: {info}{progress}")
            } else {
                format!("[{prefix}] Importing data{progress}")
            }
        }
        ImportStatus::Uploading => {
            if has_progress {
                let mb = |v: i64| format!("{:.1}", v as f64 / (1024.0 * 1024.0));
                format!(
                    "[{prefix}] Uploading: {}MB/{}MB{progress}",
                    mb(u.current.unwrap()),
                    mb(u.total.unwrap())
                )
            } else if let Some(info) = &u.additional_info {
                format!("[{prefix}] Uploading: {info}{progress}")
            } else {
                format!("[{prefix}] Uploading{progress}")
            }
        }
        ImportStatus::CreatingDataDumpRequest => {
            format!("[{prefix}] Creating Data Dump Request{progress}")
        }
        ImportStatus::WaitingForDataDump => format!("[{prefix}] Waiting for Data Dump{progress}"),
        ImportStatus::Downloading => match &u.additional_info {
            Some(info) => format!("[{prefix}] Downloading: {info}{progress}"),
            None => format!("[{prefix}] Downloading Data Dump{progress}"),
        },
        ImportStatus::FetchingMetadata => format!("[{prefix}] Fetching Metadata{progress}"),
        ImportStatus::Completed => match job.imported_count.filter(|c| *c != 0) {
            Some(count) => format!(
                "✓ [{prefix}] Sucessfully Imported {} days.",
                group_digits(count)
            ),
            None => format!("✓ [{prefix}] Import completed successfully"),
        },
        ImportStatus::Failed => match &job.error {
            Some(error) => format!("✕ [{prefix}] Import failed: {error}"),
            None => format!("✕ [{prefix}] Import failed"),
        },
        ImportStatus::Processing => format!("[{prefix}] {}", status.as_str()),
    }
}

pub fn insert_job(job: ImportJob) {
    JOBS.lock().unwrap().insert(job.id.clone(), job);
}

pub fn remove_user_jobs(user_id: &str) {
    JOBS.lock().unwrap().retain(|_, job| job.user_id != user_id);
}

pub fn with_job<R>(id: &str, f: impl FnOnce(&mut ImportJob) -> R) -> Option<R> {
    JOBS.lock().unwrap().get_mut(id).map(f)
}

pub fn job_exists(id: &str) -> bool {
    JOBS.lock().unwrap().contains_key(id)
}

pub fn update_job(id: &str, u: Update) {
    let mut jobs = JOBS.lock().unwrap();
    let Some(job) = jobs.get_mut(id) else { return };
    let old_progress = job.progress;
    let old_processed = job.processed_count.unwrap_or(0);
    if let Some(c) = u.current {
        job.processed_count = Some(c);
    }
    if let Some(t) = u.total {
        job.total_to_process = Some(t);
    }
    if let Some(c) = u.imported_count {
        job.imported_count = Some(c);
    }
    if let Some(e) = &u.error {
        job.error = Some(e.clone());
    }
    match (u.current, u.total) {
        (Some(c), Some(t)) if t > 0 => {
            job.progress = ((c as f64 / t as f64) * 100.0).round() as i64
        }
        _ if u.status == Some(ImportStatus::Completed) => job.progress = 100,
        _ => {}
    }
    if let Some(status) = u.status {
        job.status = status;
        job.message = Some(format_status(job, status, &u));
    }
    if u.status == Some(ImportStatus::ProcessingHeartbeats)
        && matches!(u.total, Some(t) if t > 0)
        && (old_progress != job.progress || old_processed != job.processed_count.unwrap_or(0))
    {
        let prefix = job.kind.map(ImportMethod::log_prefix).unwrap_or("queue");
        tracing::info!(
            "[{prefix}] Job {} progress: {}/{} days ({}%)",
            job.id,
            job.processed_count.unwrap_or(0),
            job.total_to_process.unwrap_or(0),
            job.progress
        );
    }
}

pub fn all_job_statuses(user_id: Option<&str>) -> Vec<ImportJob> {
    JOBS.lock()
        .unwrap()
        .values()
        .filter(|j| user_id.is_none_or(|u| j.user_id == u))
        .cloned()
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueStatus {
    pub queue_length: usize,
    pub busy_workers: usize,
    pub available_workers: usize,
    pub total_workers: usize,
    pub active_jobs: usize,
}

pub fn queue_status() -> QueueStatus {
    let busy = BUSY.load(Ordering::Relaxed);
    let active = JOBS
        .lock()
        .unwrap()
        .values()
        .filter(|j| {
            !matches!(j.status, ImportStatus::Completed | ImportStatus::Failed)
                && j.status.as_str().contains("Processing")
        })
        .count();
    QueueStatus {
        queue_length: QUEUED.load(Ordering::Relaxed),
        busy_workers: busy,
        available_workers: WORKER_COUNT.saturating_sub(busy),
        total_workers: WORKER_COUNT,
        active_jobs: active,
    }
}

enum JobData {
    WakatimeApi {
        api_key: String,
    },
    WakatimeFile {
        export: WakatimeExportData,
    },
    Wakapi {
        api_key: String,
        instance_url: String,
    },
}

fn spawn_job(id: String, user_id: String, data: JobData) -> String {
    QUEUED.fetch_add(1, Ordering::Relaxed);
    let job_id = id.clone();
    tokio::spawn(async move {
        let permit = PERMITS.acquire().await.expect("semaphore closed");
        QUEUED.fetch_sub(1, Ordering::Relaxed);
        BUSY.fetch_add(1, Ordering::Relaxed);
        let result = process_job(&id, &user_id, data).await;
        BUSY.fetch_sub(1, Ordering::Relaxed);
        drop(permit);
        if let Err(message) = result {
            tracing::info!("Worker failed job {id}: {message}");
            if job_exists(&id) {
                update_job(&id, Update::failed(message));
            } else {
                let mut job = ImportJob::new(
                    &id,
                    &user_id,
                    ImportMethod::WakatimeApi,
                    format!("Import {}", jiff::Timestamp::now()),
                );
                job.kind = None;
                job.message = Some("Failed".into());
                job.status = ImportStatus::Failed;
                job.error = Some(message);
                insert_job(job);
            }
        }
    });
    tracing::info!(
        "Added job {job_id} to queue. Queue length: {}",
        QUEUED.load(Ordering::Relaxed)
    );
    job_id
}

async fn process_job(id: &str, user_id: &str, data: JobData) -> Result<(), String> {
    let imported = match data {
        JobData::WakatimeApi { api_key } => {
            with_job(id, |j| j.status = ImportStatus::Processing);
            update_job(id, Update::status(ImportStatus::Processing));
            handle_wakatime_import(&api_key, user_id, id)
                .await
                .map_err(|e| e.to_string())?
        }
        JobData::WakatimeFile { export } => {
            let days: Vec<_> = prepare_wakatime_file_data(export.clone());
            update_job(
                id,
                Update::progress(ImportStatus::Processing, 0, days.len() as i64),
            );
            update_job(
                id,
                Update::progress(ImportStatus::ProcessingHeartbeats, 0, days.len() as i64),
            );
            let total = days.len();
            let done = AtomicUsize::new(0);
            let concurrency = if total > 10 { 4 } else { 1 };
            let last_plugin = export.user.last_plugin.clone();
            futures::stream::iter(days)
                .for_each_concurrent(concurrency, |day| {
                    let last_plugin = last_plugin.clone();
                    let done = &done;
                    async move {
                        let agents = HashMap::new();
                        let rows = day
                            .heartbeats
                            .iter()
                            .map(|h| map_heartbeat(h, &agents, user_id, last_plugin.as_deref()))
                            .collect();
                        process_heartbeats_by_date(user_id, rows).await;
                        let finished = done.fetch_add(1, Ordering::Relaxed) + 1;
                        update_job(
                            id,
                            Update::progress(
                                ImportStatus::ProcessingHeartbeats,
                                finished as i64,
                                total as i64,
                            ),
                        );
                    }
                })
                .await;
            total as i64
        }
        JobData::Wakapi {
            api_key,
            instance_url,
        } => {
            update_job(id, Update::status(ImportStatus::Processing));
            let by_date = prepare_wakapi_data(&api_key, &instance_url, user_id, id)
                .await
                .map_err(|e| e.to_string())?;
            handle_wakapi_sequential_import(by_date, user_id, id)
                .await
                .map_err(|e| e.to_string())?
        }
    };
    finalize_import(user_id).await;
    if with_job(id, |j| j.status != ImportStatus::Failed).unwrap_or(false) {
        update_job(id, Update::completed(Some(imported)));
    }
    Ok(())
}

pub fn queue_wakatime_api_import(api_key: String, user_id: &str) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    insert_job(ImportJob::new(
        &id,
        user_id,
        ImportMethod::WakatimeApi,
        format!("WakaTime API Import {}", jiff::Timestamp::now()),
    ));
    spawn_job(id, user_id.to_string(), JobData::WakatimeApi { api_key })
}

pub fn queue_wakatime_file_import(
    export: WakatimeExportData,
    user_id: &str,
    job_id: &str,
) -> String {
    if !job_exists(job_id) {
        insert_job(ImportJob::new(
            job_id,
            user_id,
            ImportMethod::WakatimeFile,
            format!("WakaTime File Import {}", jiff::Timestamp::now()),
        ));
    }
    spawn_job(
        job_id.to_string(),
        user_id.to_string(),
        JobData::WakatimeFile { export },
    )
}

pub fn queue_wakapi_import(api_key: String, instance_url: String, user_id: &str) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    insert_job(ImportJob::new(
        &id,
        user_id,
        ImportMethod::Wakapi,
        format!("WakAPI Import {}", jiff::Timestamp::now()),
    ));
    spawn_job(
        id,
        user_id.to_string(),
        JobData::Wakapi {
            api_key,
            instance_url,
        },
    )
}
