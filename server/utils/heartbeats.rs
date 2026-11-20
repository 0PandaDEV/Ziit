use std::collections::{BTreeMap, HashSet};

use jiff::{Timestamp, civil::Date};

use super::{
    db::{new_id, pool},
    normalize::{normalize_editor, normalize_language, normalize_os},
    time::{day_bounds, ts_to_utc_date},
};

const INSERT_BATCH_SIZE: usize = 2000;
const EARLIEST_TIMESTAMP_SECONDS: i64 = 946_684_800;

fn clean(value: &Option<String>, max: usize) -> Option<String> {
    value
        .as_ref()
        .map(|v| v.chars().filter(|c| *c != '\0').take(max).collect())
}

#[derive(Debug, Clone)]
pub struct HeartbeatInput {
    pub user_id: String,
    pub timestamp: Timestamp,
    pub project: Option<String>,
    pub editor: Option<String>,
    pub language: Option<String>,
    pub os: Option<String>,
    pub file: Option<String>,
    pub branch: Option<String>,
}

async fn insert_rows(rows: &[HeartbeatInput]) -> sqlx::Result<u64> {
    let mut inserted = 0;
    for batch in rows.chunks(INSERT_BATCH_SIZE) {
        let mut ids = Vec::with_capacity(batch.len());
        let mut users = Vec::with_capacity(batch.len());
        let mut stamps = Vec::with_capacity(batch.len());
        let mut cols: [Vec<Option<String>>; 6] = Default::default();
        for h in batch {
            ids.push(new_id());
            users.push(h.user_id.clone());
            stamps.push(h.timestamp.to_string());
            cols[0].push(clean(&h.project, 255));
            cols[1].push(clean(&h.editor, 50));
            cols[2].push(clean(&h.language, 50));
            cols[3].push(clean(&h.os, 50));
            cols[4].push(clean(&h.file, 255));
            cols[5].push(clean(&h.branch, 255));
        }
        let result = sqlx::query(
            r#"INSERT INTO "Heartbeats" (id, "userId", "timestamp", project, editor, language, os, file, branch)
               SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[]::timestamptz[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[])
               ON CONFLICT DO NOTHING"#,
        )
        .bind(ids)
        .bind(users)
        .bind(stamps)
        .bind(&cols[0])
        .bind(&cols[1])
        .bind(&cols[2])
        .bind(&cols[3])
        .bind(&cols[4])
        .bind(&cols[5])
        .execute(pool())
        .await?;
        inserted += result.rows_affected();
    }
    Ok(inserted)
}

pub async fn recompute_seconds(user_id: &str, from: Timestamp, to: Timestamp) -> sqlx::Result<()> {
    sqlx::query("SELECT recompute_heartbeat_seconds($1, $2::timestamptz, $3::timestamptz)")
        .bind(user_id)
        .bind(from.to_string())
        .bind(to.to_string())
        .execute(pool())
        .await?;
    Ok(())
}

pub async fn recompute_user_seconds(user_id: &str) -> sqlx::Result<()> {
    sqlx::query(
        "SELECT recompute_heartbeat_seconds($1, '-infinity'::timestamptz, 'infinity'::timestamptz)",
    )
    .bind(user_id)
    .execute(pool())
    .await?;
    Ok(())
}

fn is_concurrent_refresh(error: &sqlx::Error) -> bool {
    error.to_string().contains("concurrent refresh")
}

pub async fn refresh_aggregates() -> sqlx::Result<bool> {
    let mut conn = pool().acquire().await?;
    let mut complete = true;
    for aggregate in ["heartbeats_daily", "heartbeat_stats_daily"] {
        let result = sqlx::raw_sql(sqlx::AssertSqlSafe(format!(
            "CALL refresh_continuous_aggregate('{aggregate}', NULL, NULL)"
        )))
        .execute(&mut *conn)
        .await;
        match result {
            Ok(_) => {}
            Err(error) if is_concurrent_refresh(&error) => {
                tracing::info!(
                    aggregate,
                    "aggregate is already being refreshed by the background policy"
                );
                complete = false;
            }
            Err(error) => return Err(error),
        }
    }
    Ok(complete)
}

pub async fn insert_heartbeats(rows: &[HeartbeatInput]) -> sqlx::Result<u64> {
    let inserted = insert_rows(rows).await?;
    let mut windows: BTreeMap<&str, (Timestamp, Timestamp)> = BTreeMap::new();
    for h in rows {
        let window = windows
            .entry(&h.user_id)
            .or_insert((h.timestamp, h.timestamp));
        window.0 = window.0.min(h.timestamp);
        window.1 = window.1.max(h.timestamp);
    }
    for (user_id, (from, to)) in windows {
        recompute_seconds(user_id, from, to).await?;
    }
    Ok(inserted)
}

async fn insert_new_heartbeats(
    user_id: &str,
    date: Date,
    heartbeats: &[HeartbeatInput],
) -> sqlx::Result<()> {
    let (start, end) = day_bounds(date);
    let existing: Vec<(i64, Option<String>)> = sqlx::query_as(
        r#"SELECT (EXTRACT(EPOCH FROM "timestamp") * 1000)::bigint, file FROM "Heartbeats"
           WHERE "userId" = $1 AND "timestamp" >= $2::timestamptz AND "timestamp" < $3::timestamptz"#,
    )
    .bind(user_id)
    .bind(start.to_string())
    .bind(end.to_string())
    .fetch_all(pool())
    .await?;
    let seen: HashSet<(i64, String)> = existing
        .into_iter()
        .map(|(ts, file)| (ts, file.unwrap_or_default()))
        .collect();
    let fresh: Vec<HeartbeatInput> = heartbeats
        .iter()
        .filter(|h| {
            !seen.contains(&(
                h.timestamp.as_millisecond(),
                h.file.clone().unwrap_or_default(),
            ))
        })
        .cloned()
        .map(|mut h| {
            h.language = normalize_language(h.language.as_deref());
            h.editor = normalize_editor(h.editor.as_deref());
            h.os = normalize_os(h.os.as_deref());
            h
        })
        .collect();
    insert_rows(&fresh).await?;
    Ok(())
}

pub async fn process_heartbeats_by_date(user_id: &str, heartbeats: Vec<HeartbeatInput>) {
    let mut by_date: BTreeMap<Date, Vec<HeartbeatInput>> = BTreeMap::new();
    let earliest = Timestamp::from_second(EARLIEST_TIMESTAMP_SECONDS).unwrap_or(Timestamp::MIN);
    let latest = Timestamp::now()
        .checked_add(jiff::SignedDuration::from_hours(24))
        .unwrap_or(Timestamp::MAX);
    for h in heartbeats
        .into_iter()
        .filter(|h| h.timestamp >= earliest && h.timestamp <= latest)
    {
        by_date
            .entry(ts_to_utc_date(h.timestamp))
            .or_default()
            .push(h);
    }
    for (date, items) in by_date {
        if let Err(error) = insert_new_heartbeats(user_id, date, &items).await {
            tracing::error!(%error, %date, "failed to save imported heartbeats");
        }
    }
}

pub async fn finalize_import(user_id: &str) {
    let result = async {
        recompute_user_seconds(user_id).await?;
        refresh_aggregates().await
    }
    .await;
    if let Err(error) = result {
        tracing::error!(%error, user_id, "failed to finalize import");
    }
}
