use std::time::Instant;

use super::{db::pool, state, time::ts_expr};

const DONE: &str = "seconds_backfill_done";
const CURSOR: &str = "seconds_backfill_cursor";

async fn backfill_chunk(start: &str, end: &str) -> sqlx::Result<u64> {
    let result = sqlx::query(
        r#"UPDATE "Heartbeats" h SET seconds = o.next_seconds
           FROM (
             SELECT
               id,
               "timestamp",
               CASE
                 WHEN LEAD("timestamp") OVER w - "timestamp" <= tracking_timeout()
                   THEN EXTRACT(EPOCH FROM (LEAD("timestamp") OVER w - "timestamp"))::REAL
                 ELSE 0
               END AS next_seconds
             FROM "Heartbeats"
             WHERE "timestamp" >= $1::timestamptz AND "timestamp" < $2::timestamptz + INTERVAL '10 minutes'
             WINDOW w AS (PARTITION BY "userId" ORDER BY "timestamp", id)
           ) o
           WHERE h.id = o.id AND h."timestamp" = o."timestamp"
             AND h."timestamp" >= $1::timestamptz AND h."timestamp" < $2::timestamptz
             AND h.seconds IS DISTINCT FROM o.next_seconds"#,
    )
    .bind(start)
    .bind(end)
    .execute(pool())
    .await?;
    Ok(result.rows_affected())
}

async fn run_inner() -> sqlx::Result<()> {
    if state::get(DONE).await?.is_some() {
        return Ok(());
    }
    let chunks: Vec<(String, String)> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {}, {} FROM timescaledb_information.chunks WHERE hypertable_name = 'Heartbeats' ORDER BY range_start",
        ts_expr("range_start"),
        ts_expr("range_end")
    )))
    .fetch_all(pool())
    .await?;
    let cursor = state::get(CURSOR).await?;
    let pending: Vec<_> = chunks
        .into_iter()
        .filter(|(_, end)| cursor.as_deref().is_none_or(|c| end.as_str() > c))
        .collect();
    let total = pending.len();
    if total > 0 {
        tracing::info!(
            chunks = total,
            "calculating tracked time for existing heartbeats (resumable, stats are incomplete until this finishes)"
        );
    }
    for (index, (start, end)) in pending.iter().enumerate() {
        let started = Instant::now();
        let updated = backfill_chunk(start, end).await?;
        state::set(CURSOR, end).await?;
        tracing::info!(
            chunk = index + 1,
            of = total,
            updated,
            elapsed_ms = started.elapsed().as_millis() as u64,
            "tracked time calculated"
        );
    }
    state::set(DONE, "1").await
}

pub async fn run() {
    if let Err(error) = run_inner().await {
        tracing::error!(%error, "failed to calculate tracked time, it will resume on the next start");
    }
}
