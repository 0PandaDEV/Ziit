use crate::server::utils::{
    db::{new_id, pool},
    normalize::{normalize_editor, normalize_language, normalize_os},
    time::utc_today,
};

async fn top(column: &str) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT {column} FROM heartbeats_daily WHERE {column} IS NOT NULL GROUP BY {column} ORDER BY SUM(heartbeat_count) DESC LIMIT 1"
    )))
    .fetch_optional(pool())
    .await
}

pub async fn run() {
    let result: sqlx::Result<()> = async {
        let date = utc_today().to_string();
        let exists: bool =
            sqlx::query_scalar(r#"SELECT EXISTS (SELECT 1 FROM "Stats" WHERE date = $1::date)"#)
                .bind(&date)
                .fetch_one(pool())
                .await?;
        if exists {
            return Ok(());
        }
        let users: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "User""#)
            .fetch_one(pool())
            .await?;
        let (heartbeats, seconds): (i64, f64) = sqlx::query_as(
            "SELECT COALESCE(SUM(heartbeat_count), 0)::bigint, COALESCE(SUM(seconds), 0)::float8 FROM heartbeats_daily",
        )
        .fetch_one(pool())
        .await?;
        let hours = (seconds / 3600.0).floor() as i64;
        let editor = normalize_editor(top("editor").await?.as_deref()).unwrap_or_else(|| "Unknown".into());
        let language = normalize_language(top("language").await?.as_deref()).unwrap_or_else(|| "Unknown".into());
        let os = normalize_os(top("os").await?.as_deref()).unwrap_or_else(|| "Unknown".into());
        sqlx::query(
            r#"INSERT INTO "Stats" (id, date, "totalHours", "totalUsers", "totalHeartbeats", "topEditor", "topLanguage", "topOS")
               VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8)"#,
        )
        .bind(new_id())
        .bind(&date)
        .bind(hours as i32)
        .bind(users)
        .bind(heartbeats as i32)
        .bind(&editor)
        .bind(&language)
        .bind(&os)
        .execute(pool())
        .await?;
        tracing::info!(users, heartbeats, hours, "generated public stats for {date}");
        Ok(())
    }
    .await;
    if let Err(error) = result {
        tracing::error!(%error, "failed to generate public stats");
    }
}
