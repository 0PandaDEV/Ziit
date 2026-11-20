use serde_json::json;
use topcoat::{
    Result,
    context::Cx,
    router::{response::Response, route},
};

use crate::server::utils::{
    http_util::{auth_user, json},
    import_queue::{all_job_statuses, queue_status},
};

#[route(GET "/api/import")]
pub async fn index(cx: &Cx) -> Result<Response> {
    let user = auth_user(cx)?;
    let jobs = all_job_statuses(Some(&user.id));
    let active = jobs.iter().any(|j| {
        matches!(
            j.status.as_str(),
            "Processing" | "Queued" | "Uploading" | "Pending"
        )
    });
    Ok(json(&json!({
        "success": true,
        "queue": queue_status(),
        "userJobs": jobs.iter().take(10).collect::<Vec<_>>(),
        "hasActiveJobs": active,
    })))
}
