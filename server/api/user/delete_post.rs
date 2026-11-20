use serde_json::json;
use topcoat::{
    Result,
    context::Cx,
    router::{response::Response, route},
};

use crate::server::utils::{
    db::pool,
    http_util::{auth_user, json},
    logging::fail,
};

#[route(POST "/api/user/delete")]
pub async fn delete(cx: &Cx) -> Result<Response> {
    let user = auth_user(cx)?;
    let row: Result<Option<(String, String)>, sqlx::Error> = sqlx::query_as(
        r#"DELETE FROM "User" WHERE id = $1 RETURNING id, to_char("createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')"#,
    )
    .bind(&user.id)
    .fetch_optional(pool())
    .await;
    match row {
        Ok(Some((id, created_at))) => Ok(json(&json!({ "id": id, "createdAt": created_at }))),
        Ok(None) => Err(fail(
            404,
            format!("User {} not found", user.id),
            Some("User not found."),
        )),
        Err(sqlx::Error::Database(e)) if e.code().as_deref() == Some("23503") => Err(fail(
            400,
            format!(
                "Cannot delete user {}: User still has associated data",
                user.id
            ),
            Some(
                "Cannot delete user. Please remove all associated data first before deleting your account.",
            ),
        )),
        Err(sqlx::Error::Database(e)) => Err(fail(
            400,
            format!("Database error {:?}: {e}", e.code()),
            Some("Database operation failed. Please try again."),
        )),
        Err(e) => Err(fail(
            69,
            format!("Failed to delete user {}: {e}", user.id),
            Some("Failed to delete user. Please try again."),
        )),
    }
}
