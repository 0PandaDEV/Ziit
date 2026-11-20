use serde_json::{Value, json};
use topcoat::{
    Result,
    context::Cx,
    router::{OriginPolicy, content::Json, response::Response, route},
};

use super::{api_key_user, parse_heartbeat};
use crate::server::utils::{
    db::{new_id, pool},
    heartbeats::recompute_seconds,
    http_util::json,
    logging::{fail, server_error},
};

#[route(POST "/api/external/heartbeat", with(OriginPolicy::dangerous_disable()))]
pub async fn heartbeat(cx: &Cx, Json(body): Json<Value>) -> Result<Response> {
    let user = api_key_user(cx, "Heartbeat API error", None, None).await?;
    let h = parse_heartbeat(&user.id, &body).map_err(|e| {
        fail(
            400,
            format!("Heartbeat API error: Validation error. Details: {e}"),
            None,
        )
    })?;
    let id = new_id();
    sqlx::query(
        r#"INSERT INTO "Heartbeats" (id, "userId", "timestamp", project, editor, language, os, file, branch)
           VALUES ($1, $2, $3::timestamptz, $4, $5, $6, $7, $8, $9)"#,
    )
    .bind(&id)
    .bind(&user.id)
    .bind(h.timestamp.to_string())
    .bind(&h.project)
    .bind(&h.editor)
    .bind(&h.language)
    .bind(&h.os)
    .bind(&h.file)
    .bind(&h.branch)
    .execute(pool())
    .await
    .map_err(|e| server_error(format!("Heartbeat API error: Failed to process heartbeat. Error: {e}"), "Failed to process your request."))?;
    recompute_seconds(&user.id, h.timestamp, h.timestamp)
        .await
        .map_err(|e| {
            server_error(
                format!("Heartbeat API error: Failed to update tracked time. Error: {e}"),
                "Failed to process your request.",
            )
        })?;
    Ok(json(&json!({ "success": true, "id": id })))
}
