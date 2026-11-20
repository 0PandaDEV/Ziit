use serde_json::json;
use topcoat::{
    Result,
    context::Cx,
    router::{BodyLimit, content::multipart::Multipart, response::Response, route},
};

use super::parse_export;
use crate::server::utils::{
    http_util::{auth_user, json},
    import_queue::{
        ImportJob, ImportMethod, ImportStatus, Update, insert_job, queue_wakatime_file_import,
        update_job,
    },
    logging::fail,
};

#[route(POST "/api/import/file", with(BodyLimit::max(500 * 1024 * 1024)))]
pub async fn file(cx: &Cx, mut form: Multipart) -> Result<Response> {
    let user = auth_user(cx)?;
    let mut upload = None;
    while let Some(field) = form.next_field().await? {
        if field.name() == Some("file") && field.file_name().is_some() {
            let name = field.file_name().map(str::to_string);
            upload = Some((name, field.bytes().await?));
        }
    }
    let Some((name, bytes)) = upload else {
        return Err(fail(
            400,
            "Invalid form data",
            Some("Invalid form data received"),
        ));
    };
    tracing::info!("Processing WakaTime exported file upload");
    let export = parse_export(&bytes).map_err(|e| fail(400, e, Some("Invalid file format")))?;
    let job_id = uuid::Uuid::new_v4().to_string();
    let file_name = name.unwrap_or_else(|| format!("WakaTime Import {}", jiff::Timestamp::now()));
    insert_job(ImportJob::new(
        &job_id,
        &user.id,
        ImportMethod::WakatimeFile,
        file_name,
    ));
    update_job(&job_id, Update::status(ImportStatus::Processing));
    let queued = queue_wakatime_file_import(export, &user.id, &job_id);
    Ok(json(
        &json!({ "success": true, "jobId": queued, "message": "File import has been queued for processing" }),
    ))
}
