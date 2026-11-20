use serde_json::{Value, json};
use topcoat::{
    Result,
    context::Cx,
    router::{response::Response, route},
};

use std::time::Duration;

use crate::server::utils::{db::pool, http_util::json, logging::server_error, swr::Swr};

pub static STATS: Swr = Swr::new("stats", Duration::from_secs(300), || Box::pin(load()));

#[derive(sqlx::FromRow)]
struct Latest {
    date: String,
    total_hours: i32,
    total_users: i64,
    total_heartbeats: i32,
    top_editor: String,
    top_language: String,
    top_os: String,
    created_at: String,
    fresh: bool,
}

pub async fn public_stats() -> topcoat::Result<Value> {
    STATS.get().await
}

async fn load() -> topcoat::Result<Value> {
    let fail = |e: sqlx::Error| {
        server_error(
            format!("Failed to fetch public stats: {e}"),
            "Failed to fetch stats",
        )
    };
    let latest: Option<Latest> = sqlx::query_as(
        r#"SELECT to_char(date, 'YYYY-MM-DD') AS date,
                  "totalHours" AS total_hours, "totalUsers" AS total_users, "totalHeartbeats" AS total_heartbeats,
                  "topEditor" AS top_editor, "topLanguage" AS top_language, "topOS" AS top_os,
                  to_char("createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
                  date >= (now() - INTERVAL '1 day')::date AS fresh
           FROM "Stats" ORDER BY date DESC LIMIT 1"#,
    )
    .fetch_optional(pool())
    .await
    .map_err(fail)?;

    let (users, heartbeats, hours) = match &latest {
        Some(l) if l.fresh => {
            let new_users: i64 =
                sqlx::query_scalar(r#"SELECT COUNT(*) FROM "User" WHERE "createdAt" > $1::date"#)
                    .bind(&l.date)
                    .fetch_one(pool())
                    .await
                    .map_err(fail)?;
            let (new_heartbeats, new_seconds): (i64, f64) = sqlx::query_as(
                "SELECT COALESCE(SUM(heartbeat_count), 0)::bigint, COALESCE(SUM(seconds), 0)::float8 FROM heartbeats_daily WHERE bucket >= $1::date::timestamptz",
            )
            .bind(&l.date)
            .fetch_one(pool())
            .await
            .map_err(fail)?;
            (
                l.total_users + new_users,
                l.total_heartbeats as i64 + new_heartbeats,
                l.total_hours as i64 + (new_seconds / 3600.0).floor() as i64,
            )
        }
        _ => {
            let users: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "User""#)
                .fetch_one(pool())
                .await
                .map_err(fail)?;
            let (heartbeats, seconds): (i64, f64) = sqlx::query_as(
                "SELECT COALESCE(SUM(heartbeat_count), 0)::bigint, COALESCE(SUM(seconds), 0)::float8 FROM heartbeats_daily",
            )
            .fetch_one(pool())
            .await
            .map_err(fail)?;
            (users, heartbeats, (seconds / 3600.0).floor() as i64)
        }
    };
    let unknown = || "Unknown".to_string();
    let value = json!({
        "totalUsers": users,
        "totalHeartbeats": heartbeats,
        "totalHours": hours,
        "topEditor": latest.as_ref().map(|l| l.top_editor.clone()).unwrap_or_else(unknown),
        "topLanguage": latest.as_ref().map(|l| l.top_language.clone()).unwrap_or_else(unknown),
        "topOS": latest.as_ref().map(|l| l.top_os.clone()).unwrap_or_else(unknown),
        "lastUpdated": latest.as_ref().map(|l| l.created_at.clone()).unwrap_or_else(|| jiff::Timestamp::now().to_string()),
        "source": if latest.is_some() { "mixed" } else { "live" },
    });
    Ok(value)
}

#[route(GET "/api/public/stats")]
pub async fn handler(cx: &Cx) -> Result<Response> {
    Ok(json(&public_stats().await?))
}
