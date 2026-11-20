use serde_json::json;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use topcoat::{
    Result,
    context::Cx,
    router::{response::Response, route},
};

use crate::server::utils::{
    auth::bearer,
    config::config,
    db::pool,
    http_util::json,
    logging::{fail, server_error},
};

fn valid_base64(value: &str) -> bool {
    use base64::{Engine, engine::general_purpose::STANDARD};
    STANDARD.decode(value).is_ok()
}

pub fn valid_key(provided: &str, expected: &str) -> bool {
    if expected.is_empty() {
        return false;
    }
    let a = Sha256::digest(provided.as_bytes());
    let b = Sha256::digest(expected.as_bytes());
    a.ct_eq(&b).into()
}

#[derive(sqlx::FromRow)]
pub struct AdminUser {
    pub id: String,
    pub email: String,
    pub github_username: Option<String>,
    pub created_at: String,
    pub last_login: String,
    pub heartbeats_count: i64,
    pub summaries_count: i64,
    pub total_minutes: i64,
}

pub async fn dashboard_rows() -> sqlx::Result<Vec<AdminUser>> {
    sqlx::query_as(
        r#"SELECT
             u.id,
             u.email,
             u."githubUsername" AS github_username,
             to_char(u."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
             to_char(u.lastlogin, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last_login,
             COALESCE(h.heartbeats, 0)::bigint AS heartbeats_count,
             COALESCE(h.days, 0)::bigint AS summaries_count,
             ROUND(COALESCE(h.seconds, 0) / 60.0)::bigint AS total_minutes
           FROM "User" u
           LEFT JOIN (
             SELECT "userId", SUM(heartbeat_count) AS heartbeats, SUM(seconds) AS seconds, COUNT(DISTINCT bucket) AS days
             FROM heartbeats_daily
             GROUP BY "userId"
           ) h ON h."userId" = u.id
           ORDER BY u."createdAt" DESC"#,
    )
    .fetch_all(pool())
    .await
}

#[route(GET "/api/admin")]
pub async fn admin(cx: &Cx) -> Result<Response> {
    let Some(key) = bearer(cx) else {
        return Err(fail(
            401,
            "Admin API error: Missing or invalid Admin key format in header.",
            None,
        ));
    };
    if !valid_base64(&key) {
        return Err(fail(
            401,
            "Admin API error: Invalid Admin key format.",
            None,
        ));
    }
    if !valid_key(&key, &config().admin_key) {
        return Err(fail(401, "Admin API error: Invalid Admin key.", None));
    }
    let rows = dashboard_rows().await.map_err(|e| {
        server_error(
            format!("Admin API error: Error occurred getting the user data. Error: {e}"),
            "Failed to process your request.",
        )
    })?;
    let out: Vec<_> = rows
        .into_iter()
        .map(|r| json!({
            "id": r.id, "email": r.email, "github_username": r.github_username, "created_at": r.created_at, "last_login": r.last_login,
            "heartbeats_count": r.heartbeats_count, "summaries_count": r.summaries_count, "total_minutes": r.total_minutes,
        }))
        .collect();
    Ok(json(&out))
}
