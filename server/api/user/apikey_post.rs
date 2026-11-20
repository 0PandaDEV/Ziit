use serde_json::json;
use topcoat::{
    Result,
    context::Cx,
    router::{response::Response, route},
};

use crate::server::utils::{
    db::pool,
    http_util::{auth_user, json},
    logging::server_error,
};

#[route(POST "/api/user/apikey")]
pub async fn apikey(cx: &Cx) -> Result<Response> {
    let user = auth_user(cx)?;
    let key = uuid::Uuid::new_v4().to_string();
    sqlx::query(r#"UPDATE "User" SET "apiKey" = $1 WHERE id = $2"#)
        .bind(&key)
        .bind(&user.id)
        .execute(pool())
        .await
        .map_err(|e| {
            server_error(
                format!("Failed to generate API key for user {}: {e}", user.id),
                "Failed to generate API key. Please try again.",
            )
        })?;
    Ok(json(&json!({ "apiKey": key })))
}
