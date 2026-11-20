use std::{collections::HashMap, time::Instant};

use super::{
    db::pool,
    heartbeats::refresh_aggregates,
    normalize::{
        NameKind, fingerprint, learn_names, normalize_editor, normalize_language, normalize_os,
    },
    state,
    time::ts_expr,
};

const LOCK_ID: i64 = 742400123;

type Normalizer = fn(Option<&str>) -> Option<String>;

fn dirty_map(values: &[Option<String>], f: Normalizer) -> HashMap<String, Option<String>> {
    let mut map = HashMap::new();
    for value in values.iter().flatten() {
        let target = f(Some(value));
        if target.as_deref() != Some(value.as_str()) {
            map.insert(value.clone(), target);
        }
    }
    map
}

async fn learn_from_database() -> sqlx::Result<()> {
    for (kind, column) in [
        (NameKind::Editor, "editor"),
        (NameKind::Language, "language"),
        (NameKind::Os, "os"),
    ] {
        let rows: Vec<(Option<String>, i64)> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
            "SELECT {column}, SUM(heartbeat_count)::bigint FROM heartbeats_daily GROUP BY {column}"
        )))
        .fetch_all(pool())
        .await?;
        learn_names(kind, &rows);
    }
    Ok(())
}

async fn backfill_heartbeats() -> sqlx::Result<u64> {
    let chunks: Vec<(String, String)> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {}, {} FROM timescaledb_information.chunks WHERE hypertable_name = 'Heartbeats' ORDER BY range_start",
        ts_expr("range_start"),
        ts_expr("range_end")
    )))
    .fetch_all(pool())
    .await?;
    let mut updated = 0;
    for (start, end) in chunks {
        let combos: Vec<(Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
            r#"SELECT DISTINCT editor, language, os FROM "Heartbeats"
               WHERE "timestamp" >= $1::timestamptz AND "timestamp" < $2::timestamptz"#,
        )
        .bind(&start)
        .bind(&end)
        .fetch_all(pool())
        .await?;
        let editors = dirty_map(
            &combos.iter().map(|c| c.0.clone()).collect::<Vec<_>>(),
            normalize_editor,
        );
        let languages = dirty_map(
            &combos.iter().map(|c| c.1.clone()).collect::<Vec<_>>(),
            normalize_language,
        );
        let systems = dirty_map(
            &combos.iter().map(|c| c.2.clone()).collect::<Vec<_>>(),
            normalize_os,
        );
        if editors.is_empty() && languages.is_empty() && systems.is_empty() {
            continue;
        }
        let keys = |m: &HashMap<String, Option<String>>| m.keys().cloned().collect::<Vec<_>>();
        let json = |m: &HashMap<String, Option<String>>| {
            serde_json::to_string(m).unwrap_or_else(|_| "{}".into())
        };
        let result = sqlx::query(
            r#"UPDATE "Heartbeats" SET
                 editor = CASE WHEN editor IS NOT NULL AND $3::jsonb ? editor THEN $3::jsonb ->> editor ELSE editor END,
                 language = CASE WHEN language IS NOT NULL AND $4::jsonb ? language THEN $4::jsonb ->> language ELSE language END,
                 os = CASE WHEN os IS NOT NULL AND $5::jsonb ? os THEN $5::jsonb ->> os ELSE os END
               WHERE "timestamp" >= $1::timestamptz AND "timestamp" < $2::timestamptz
                 AND (editor = ANY($6::text[]) OR language = ANY($7::text[]) OR os = ANY($8::text[]))"#,
        )
        .bind(&start)
        .bind(&end)
        .bind(json(&editors))
        .bind(json(&languages))
        .bind(json(&systems))
        .bind(keys(&editors))
        .bind(keys(&languages))
        .bind(keys(&systems))
        .execute(pool())
        .await?;
        updated += result.rows_affected();
    }
    Ok(updated)
}

async fn backfill_stats() -> sqlx::Result<u64> {
    let rows: Vec<(String, String, String, String)> =
        sqlx::query_as(r#"SELECT id, "topEditor", "topLanguage", "topOS" FROM "Stats""#)
            .fetch_all(pool())
            .await?;
    let mut updated = 0;
    for (id, editor, language, os) in rows {
        let top_editor = normalize_editor(Some(&editor)).unwrap_or_else(|| "Unknown".into());
        let top_language = normalize_language(Some(&language)).unwrap_or_else(|| "Unknown".into());
        let top_os = normalize_os(Some(&os)).unwrap_or_else(|| "Unknown".into());
        if top_editor == editor && top_language == language && top_os == os {
            continue;
        }
        sqlx::query(r#"UPDATE "Stats" SET "topEditor" = $1, "topLanguage" = $2, "topOS" = $3 WHERE id = $4"#)
            .bind(top_editor)
            .bind(top_language)
            .bind(top_os)
            .bind(id)
            .execute(pool())
            .await?;
        updated += 1;
    }
    Ok(updated)
}

async fn report_unmapped() -> sqlx::Result<()> {
    for column in ["editor", "language", "os"] {
        let rows: Vec<Vec<String>> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT array_agg(DISTINCT {column}) FROM heartbeats_daily WHERE {column} IS NOT NULL GROUP BY lower({column}) HAVING count(DISTINCT {column}) > 1"
        )))
        .fetch_all(pool())
        .await?;
        for variants in rows {
            tracing::warn!("[normalize] unmapped {column} variants {variants:?}");
        }
    }
    Ok(())
}

async fn timed<T>(
    step: &str,
    future: impl std::future::Future<Output = sqlx::Result<T>>,
) -> sqlx::Result<T> {
    let started = Instant::now();
    let value = future.await?;
    tracing::info!(
        step,
        elapsed_ms = started.elapsed().as_millis() as u64,
        "maintenance step finished"
    );
    Ok(value)
}

const AGGREGATES: [&str; 2] = ["heartbeats_daily", "heartbeat_stats_daily"];
const AGGREGATES_VERSION: &str = "native-seconds-1";

async fn ensure_aggregate_policies() -> sqlx::Result<()> {
    for aggregate in AGGREGATES {
        sqlx::raw_sql(sqlx::AssertSqlSafe(format!(
            "SELECT add_continuous_aggregate_policy('{aggregate}', start_offset => NULL, end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '30 minutes', if_not_exists => true)"
        )))
        .execute(pool())
        .await?;
    }
    Ok(())
}

async fn run_maintenance() -> sqlx::Result<()> {
    let ready: bool = sqlx::query_scalar(
        r#"SELECT (to_regclass('public.heartbeat_stats_daily') IS NOT NULL AND to_regclass('public."AppState"') IS NOT NULL)"#,
    )
    .fetch_one(pool())
    .await?;
    if !ready {
        tracing::warn!("skipped data maintenance: migrations have not been applied");
        return Ok(());
    }

    if state::get("aggregates_version").await?.as_deref() != Some(AGGREGATES_VERSION)
        && timed("materialize aggregates", refresh_aggregates()).await?
    {
        state::set("aggregates_version", AGGREGATES_VERSION).await?;
    }
    ensure_aggregate_policies().await?;
    timed("learn names", learn_from_database()).await?;

    let mut refresh = false;
    let fingerprint = fingerprint();
    if state::get("normalize_fingerprint").await?.as_deref() != Some(fingerprint.as_str()) {
        let heartbeats = timed("normalize heartbeats", backfill_heartbeats()).await?;
        let stats = timed("normalize stats", backfill_stats()).await?;
        tracing::info!(heartbeats, stats, "normalized stored names");
        refresh |= heartbeats > 0;
        state::set("normalize_fingerprint", &fingerprint).await?;
    }

    if refresh {
        timed("refresh aggregates", refresh_aggregates()).await?;
    }
    report_unmapped().await
}

pub async fn run_data_maintenance() -> sqlx::Result<()> {
    let mut lock = pool().acquire().await?;
    let locked: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock($1::bigint)")
        .bind(LOCK_ID)
        .fetch_one(&mut *lock)
        .await?;
    if !locked {
        return Ok(());
    }
    let result = run_maintenance().await;
    sqlx::query("SELECT pg_advisory_unlock($1::bigint)")
        .bind(LOCK_ID)
        .execute(&mut *lock)
        .await?;
    result
}
