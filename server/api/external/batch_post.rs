use serde_json::{Value, json};
use topcoat::{
    Result,
    context::Cx,
    router::{BodyLimit, OriginPolicy, content::Json, response::Response, route},
};

use super::{api_key_user, parse_heartbeat};
use crate::server::utils::{
    heartbeats::insert_heartbeats,
    http_util::json,
    logging::{fail, server_error},
};

#[route(POST "/api/external/batch", with(OriginPolicy::dangerous_disable()), with(BodyLimit::max(64 * 1024 * 1024)))]
pub async fn batch(cx: &Cx, Json(body): Json<Value>) -> Result<Response> {
    let user = api_key_user(cx, "Batch API error", None, None).await?;
    let Some(items) = body
        .as_array()
        .filter(|a| !a.is_empty() && a.len() <= 100_000)
    else {
        return Err(fail(
            400,
            "Batch API error: Validation error. Details: expected 1..100000 items",
            None,
        ));
    };
    let mut rows = Vec::with_capacity(items.len());
    for item in items {
        rows.push(parse_heartbeat(&user.id, item).map_err(|e| {
            fail(
                400,
                format!("Batch API error: Validation error. Details: {e}"),
                None,
            )
        })?);
    }
    let count = insert_heartbeats(&rows).await.map_err(|e| {
        server_error(
            format!("Batch API error: Failed to process heartbeats. Error: {e}"),
            "Failed to process your request.",
        )
    })?;
    Ok(json(&json!({ "success": true, "count": count })))
}
