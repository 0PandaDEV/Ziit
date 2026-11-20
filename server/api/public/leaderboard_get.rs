use serde_json::{Value, json};
use topcoat::{
    Result,
    context::Cx,
    router::{response::Response, route},
};

use std::time::Duration;

use crate::server::utils::{db::pool, http_util::json, logging::server_error, swr::Swr};

#[derive(sqlx::FromRow)]
struct LeaderRow {
    user_id: String,
    total_minutes: i32,
    top_editor: Option<String>,
    top_os: Option<String>,
    top_language: Option<String>,
}

pub static LEADERBOARD: Swr =
    Swr::new("leaderboard", Duration::from_secs(300), || Box::pin(load()));

async fn load() -> topcoat::Result<Value> {
    let rows: Vec<LeaderRow> = sqlx::query_as(
        "SELECT user_id, total_minutes, top_editor, top_os, top_language FROM get_leaderboard_stats()",
    )
    .fetch_all(pool())
    .await
    .map_err(|e| {
        server_error(
            format!("Database query failed. Please try again later. {e}"),
            "Failed to fetch leaderboard",
        )
    })?;
    Ok(Value::Array(
        rows.into_iter()
            .map(|r| {
                json!({ "userId": r.user_id, "totalMinutes": r.total_minutes, "topEditor": r.top_editor, "topOS": r.top_os, "topLanguage": r.top_language })
            })
            .collect(),
    ))
}

pub async fn leaderboard() -> topcoat::Result<Value> {
    LEADERBOARD.get().await
}

#[route(GET "/api/public/leaderboard")]
pub async fn handler(cx: &Cx) -> Result<Response> {
    Ok(json(&leaderboard().await?))
}
