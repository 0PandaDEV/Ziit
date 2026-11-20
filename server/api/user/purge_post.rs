use serde_json::json;
use topcoat::{
    Result,
    context::Cx,
    router::{response::Response, route},
};

use crate::server::utils::{
    db::pool,
    heartbeats::refresh_aggregates,
    http_util::{auth_user, json},
    logging::server_error,
};

#[route(POST "/api/user/purge")]
pub async fn purge(cx: &Cx) -> Result<Response> {
    let user = auth_user(cx)?;
    let failure = |e: sqlx::Error| {
        server_error(
            format!("Failed to purge user data {}: {e}", user.id),
            "Failed to purge user data. Please try again.",
        )
    };
    let mut tx = pool().begin().await.map_err(failure)?;
    sqlx::query(r#"DELETE FROM "Heartbeats" WHERE "userId" = $1"#)
        .bind(&user.id)
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
    tx.commit().await.map_err(failure)?;
    if let Err(error) = refresh_aggregates().await {
        tracing::error!(%error, "failed to refresh aggregates after purge");
    }
    Ok(json(
        &json!({ "success": true, "message": "User data successfully purged", "userId": user.id }),
    ))
}
