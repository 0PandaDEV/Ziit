use std::fs;

use serde_json::json;
use topcoat::{
    Result,
    context::Cx,
    router::{BodyLimit, content::multipart::Multipart, response::Response, route},
};

use super::{assert_safe_file_id, chunks_dir, clean_file_name, ensure_dir};
use crate::server::utils::{
    http_util::{auth_user, json},
    import_queue::{
        ImportJob, ImportMethod, ImportStatus, Update, all_job_statuses, insert_job, update_job,
        with_job,
    },
    logging::fail,
};

const MAX_CHUNK_SIZE: usize = 100 * 1024 * 1024;
const MAX_FILE_SIZE: i64 = 2 * 1024 * 1024 * 1024;
const MAX_TOTAL_CHUNKS: u64 = 4096;
const MAX_UPLOADS_PER_USER: usize = 3;

#[route(POST "/api/import/chunk", with(BodyLimit::max(MAX_CHUNK_SIZE + 1024 * 1024)))]
pub async fn chunk(cx: &Cx, mut form: Multipart) -> Result<Response> {
    let user = auth_user(cx)?;
    let mut file_id = None;
    let mut file_name = None;
    let mut chunk_index = 0u64;
    let mut total_chunks = 0u64;
    let mut file_size = 0i64;
    let mut data = None;

    while let Some(field) = form.next_field().await? {
        let name = field.name().unwrap_or_default().to_string();
        match name.as_str() {
            "chunk" => data = Some(field.bytes().await?),
            other => {
                let text = field.text().await?;
                if text.len() > 1024 {
                    return Err(fail(
                        400,
                        "Oversized form field in chunked upload",
                        Some("Invalid upload data"),
                    ));
                }
                match other {
                    "fileId" => file_id = Some(text),
                    "fileName" => file_name = Some(text),
                    "chunkIndex" => chunk_index = text.parse().unwrap_or(0),
                    "totalChunks" => total_chunks = text.parse().unwrap_or(0),
                    "fileSize" => file_size = text.parse().unwrap_or(0),
                    _ => {}
                }
            }
        }
    }

    let (Some(file_id), Some(file_name), Some(data)) = (file_id, file_name, data) else {
        return Err(fail(
            400,
            "Missing required fields for chunked upload",
            Some("Missing upload data"),
        ));
    };
    assert_safe_file_id(&file_id)?;
    let file_name = clean_file_name(&file_name);
    if data.len() > MAX_CHUNK_SIZE {
        return Err(fail(
            413,
            format!(
                "Chunk too large: {} bytes (max: {MAX_CHUNK_SIZE} bytes)",
                data.len()
            ),
            Some("Individual chunk size exceeds maximum allowed limit"),
        ));
    }
    if file_size <= 0
        || total_chunks == 0
        || total_chunks > MAX_TOTAL_CHUNKS
        || chunk_index >= total_chunks
    {
        return Err(fail(
            400,
            format!("Invalid chunk metadata for file ID {file_id}"),
            Some("Invalid chunk metadata"),
        ));
    }
    if file_size > MAX_FILE_SIZE {
        return Err(fail(
            413,
            format!("File too large: {file_size} bytes (max: {MAX_FILE_SIZE} bytes)"),
            Some("File size exceeds maximum allowed limit"),
        ));
    }

    let existing = with_job(&file_id, |j| j.user_id == user.id);
    if existing == Some(false) {
        return Err(fail(
            404,
            format!("Job not found for file ID {file_id}"),
            Some("Import job not found."),
        ));
    }
    let dir = chunks_dir(&user.id, &file_id);
    let path = dir.join(format!("chunk-{chunk_index}"));
    let previous = fs::metadata(&path).map(|m| m.len() as i64).unwrap_or(0);
    let (declared, so_far) = with_job(&file_id, |j| {
        (j.total_size.unwrap_or(0), j.uploaded_size.unwrap_or(0))
    })
    .unwrap_or((file_size, 0));
    if so_far - previous + data.len() as i64 > declared {
        return Err(fail(
            413,
            format!("Upload for file ID {file_id} exceeds declared size {declared}"),
            Some("Uploaded data exceeds declared file size"),
        ));
    }
    if existing.is_none() {
        let uploading = all_job_statuses(Some(&user.id))
            .iter()
            .filter(|j| matches!(j.status, ImportStatus::Uploading))
            .count();
        if uploading >= MAX_UPLOADS_PER_USER {
            return Err(fail(
                429,
                format!("Too many concurrent uploads for user {}", user.id),
                Some("Too many uploads in progress"),
            ));
        }
        let mut job = ImportJob::new(&file_id, &user.id, ImportMethod::WakatimeFile, file_name);
        job.total_size = Some(file_size);
        job.uploaded_size = Some(0);
        job.file_id = Some(file_id.clone());
        insert_job(job);
        if chunk_index == 0 {
            update_job(
                &file_id,
                Update::progress(ImportStatus::Uploading, 0, file_size),
            );
        }
    }

    ensure_dir(&dir).map_err(|e| fail(69, format!("Failed to create chunk dir: {e}"), None))?;
    fs::write(&path, &data).map_err(|e| fail(69, format!("Failed to write chunk: {e}"), None))?;

    let uploaded = with_job(&file_id, |j| {
        let next = j.uploaded_size.unwrap_or(0) - previous + data.len() as i64;
        j.uploaded_size = Some(next);
        next
    })
    .unwrap_or(0);
    update_job(
        &file_id,
        Update::progress(ImportStatus::Uploading, uploaded, file_size),
    );
    tracing::info!(
        "Received chunk {}/{total_chunks} for file {file_id} ({:.2}MB/{:.2}MB)",
        chunk_index + 1,
        uploaded as f64 / 1_048_576.0,
        file_size as f64 / 1_048_576.0
    );
    Ok(json(
        &json!({ "success": true, "chunkIndex": chunk_index, "totalChunks": total_chunks }),
    ))
}
