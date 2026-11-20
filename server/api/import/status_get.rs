use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};

use futures::stream;
use serde_json::json;
use topcoat::{
    Result,
    context::Cx,
    router::{
        content::sse::{Event, Sse},
        request::headers,
        response::{IntoResponse, Response},
        route,
    },
};

use crate::server::utils::{
    http_util::{auth_user, json},
    import_queue::{ImportJob, ImportStatus, all_job_statuses, queue_status},
};

struct Seen {
    at: Instant,
    sent_final: bool,
}

static RECENT: LazyLock<Mutex<HashMap<String, Seen>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn is_active(job: &ImportJob) -> bool {
    !matches!(job.status, ImportStatus::Completed | ImportStatus::Failed)
}

fn is_done(job: &ImportJob) -> bool {
    !is_active(job)
}

fn cleanup() {
    RECENT
        .lock()
        .unwrap()
        .retain(|_, v| v.at.elapsed() <= Duration::from_secs(5));
}

fn pick_active(jobs: &[ImportJob]) -> Option<ImportJob> {
    if let Some(job) = jobs.iter().find(|j| is_active(j)) {
        return Some(job.clone());
    }
    let mut recent = RECENT.lock().unwrap();
    if let Some(job) = jobs
        .iter()
        .find(|j| is_done(j) && !recent.get(&j.id).is_some_and(|s| s.sent_final))
    {
        recent.entry(job.id.clone()).or_insert(Seen {
            at: Instant::now(),
            sent_final: false,
        });
        return Some(job.clone());
    }
    None
}

fn newest_first(mut jobs: Vec<ImportJob>) -> Vec<ImportJob> {
    jobs.sort_by(|a, b| b.id.cmp(&a.id));
    jobs
}

#[route(GET "/api/import/status")]
pub async fn status(cx: &Cx) -> Result<Response> {
    let user = auth_user(cx)?;
    let user_id = user.id.clone();
    let jobs = all_job_statuses(Some(&user_id));
    let queue = queue_status();
    let active = pick_active(&jobs).or_else(|| newest_first(jobs.clone()).into_iter().next());
    cleanup();

    let wants_stream = headers(cx)
        .get("accept")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("text/event-stream"));
    if !wants_stream {
        return Ok(json(&json!({
            "activeJob": active,
            "allJobs": jobs.iter().take(10).collect::<Vec<_>>(),
            "queueStatus": { "queueLength": queue.queue_length, "busyWorkers": queue.busy_workers, "availableWorkers": queue.available_workers },
            "hasActiveJobs": jobs.iter().any(is_active),
        })));
    }

    tracing::info!("[sse] open for user {user_id}");
    struct State {
        user_id: String,
        started: Instant,
        last: Option<String>,
        sent: u64,
        completed_messages: u32,
        completed: bool,
        first: bool,
        finished: bool,
    }
    let state = State {
        user_id,
        started: Instant::now(),
        last: None,
        sent: 0,
        completed_messages: 0,
        completed: false,
        first: true,
        finished: false,
    };

    let events = stream::unfold(state, |mut s| async move {
        if s.finished {
            return None;
        }
        loop {
            let interval = if s.first {
                Duration::from_millis(100)
            } else {
                Duration::from_millis(500)
            };
            s.first = false;
            tokio::time::sleep(interval).await;
            if s.started.elapsed() > Duration::from_secs(30 * 60) {
                return None;
            }
            let jobs = all_job_statuses(Some(&s.user_id));
            let queue = queue_status();
            let current = pick_active(&jobs);
            let has_active = jobs.iter().any(is_active);
            let snapshot = serde_json::to_string(&current).unwrap_or_default();
            let should_send = Some(&snapshot) != s.last.as_ref() || s.sent % 10 == 0 || has_active;
            let mut event = None;
            if should_send {
                s.sent += 1;
                let recent: Vec<_> = jobs.iter().take(5).collect();
                let payload = json!({
                    "activeJob": current,
                    "queueStatus": { "queueLength": queue.queue_length, "busyWorkers": queue.busy_workers, "availableWorkers": queue.available_workers },
                    "hasActiveJobs": has_active,
                    "totalJobs": jobs.len(),
                    "recentJobs": recent,
                    "heartbeat": s.sent,
                });
                event = Some(Event::new().data(payload.to_string()));
                s.last = Some(snapshot);
                if let Some(job) = &current
                    && is_done(job)
                    && let Some(seen) = RECENT.lock().unwrap().get_mut(&job.id)
                {
                    seen.sent_final = true;
                }
            }
            if !has_active {
                if !s.completed {
                    s.completed = true;
                    s.completed_messages = 0;
                }
                s.completed_messages += 1;
                if s.completed_messages >= 24 {
                    s.finished = true;
                    return event.map(|e| (Ok::<_, topcoat::Error>(e), s));
                }
            }
            if let Some(event) = event {
                return Some((Ok::<_, topcoat::Error>(event), s));
            }
            if !has_active {
                tokio::time::sleep(Duration::from_millis(4500)).await;
            }
        }
    });
    Sse::new(events).into_response(cx)
}
