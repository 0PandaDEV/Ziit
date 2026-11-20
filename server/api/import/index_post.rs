use std::fs;

use serde_json::{Value, json};
use topcoat::{
    Result,
    context::Cx,
    router::{content::Json, response::Response, route},
};

use super::{assert_import_capacity, assert_safe_file_id, chunks_dir, open_chunks};
use crate::server::utils::{
    auth::is_uuid,
    http_util::{auth_user, json},
    import_queue::{
        ImportStatus, Update, queue_wakapi_import, queue_wakatime_api_import,
        queue_wakatime_file_import, remove_user_jobs, update_job, with_job,
    },
    logging::fail,
};

async fn process_file_in_background(file_id: String, user_id: String) {
    let owned = with_job(&file_id, |j| {
        j.user_id == user_id
            && j.file_id.as_deref() == Some(&file_id)
            && matches!(j.status, ImportStatus::Uploading)
    })
    .unwrap_or(false);
    if !owned {
        tracing::info!(
            "Error during background processing for user {user_id}: job not found for file ID {file_id}"
        );
        return;
    }
    update_job(&file_id, Update::status(ImportStatus::Processing));
    let dir = chunks_dir(&user_id, &file_id);
    match open_chunks(&dir) {
        Ok(source) => {
            queue_wakatime_file_import(source, &user_id, &file_id);
        }
        Err(message) => {
            tracing::info!("Error processing file {file_id}: {message}");
            update_job(&file_id, Update::failed(message));
            let _ = fs::remove_dir_all(&dir);
        }
    }
}

#[route(POST "/api/import")]
pub async fn import(cx: &Cx, Json(body): Json<Value>) -> Result<Response> {
    let user = auth_user(cx)?;
    let process_chunks = body
        .get("processChunks")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    if !process_chunks {
        remove_user_jobs(&user.id);
    }

    if process_chunks && let Some(file_id) = body.get("fileId").and_then(Value::as_str) {
        assert_safe_file_id(file_id)?;
        if with_job(file_id, |j| j.user_id == user.id) != Some(true) {
            return Err(fail(
                404,
                format!("Job not found for file ID {file_id}"),
                Some("Import job not found."),
            ));
        }
        assert_import_capacity()?;
        tracing::info!("Processing chunks request");
        tokio::spawn(process_file_in_background(
            file_id.to_string(),
            user.id.clone(),
        ));
        return Ok(json(
            &json!({ "success": true, "message": "File processing has started in the background." }),
        ));
    }

    let instance_type = body
        .get("instanceType")
        .and_then(Value::as_str)
        .unwrap_or("");
    let api_key = body
        .get("apiKey")
        .and_then(Value::as_str)
        .map(str::to_string);
    let instance_url = body
        .get("instanceUrl")
        .and_then(Value::as_str)
        .map(str::to_string);

    match instance_type {
        "wakapi" => {
            let Some(key) = api_key.filter(|k| is_uuid(k)) else {
                return Err(fail(
                    400,
                    format!("Invalid request data for user {}", user.id),
                    Some("API key must be a valid UUID"),
                ));
            };
            let url = instance_url
                .filter(|u| reqwest::Url::parse(u).is_ok())
                .ok_or_else(|| {
                    fail(
                        400,
                        "WakAPI instance URL missing",
                        Some("WakAPI instance URL is missing"),
                    )
                })?;
            tracing::info!("Received WakAPI import request");
            let job_id = queue_wakapi_import(key, url, &user.id);
            Ok(json(
                &json!({ "success": true, "jobId": job_id, "message": "WakAPI import has been queued for processing" }),
            ))
        }
        "wakatime" => {
            let key = api_key
                .ok_or_else(|| fail(400, "WakaTime API key missing - use file upload instead", Some("WakaTime API key is required for API import. Use file upload as alternative.")))?;
            let valid = key
                .strip_prefix("waka_")
                .map(|rest| is_uuid(&rest.to_lowercase()))
                .unwrap_or(false);
            if !valid {
                return Err(fail(
                    400,
                    format!("Invalid request data for user {}", user.id),
                    Some("API key must be in format waka_<uuid>"),
                ));
            }
            tracing::info!("Received WakaTime API import request");
            let job_id = queue_wakatime_api_import(key, &user.id);
            Ok(json(
                &json!({ "success": true, "jobId": job_id, "message": "WakaTime API import has been queued for processing" }),
            ))
        }
        _ => Err(fail(
            400,
            "Invalid instance type",
            Some("Invalid instance type specified"),
        )),
    }
}
