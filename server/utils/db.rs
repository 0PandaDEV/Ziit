use std::{sync::OnceLock, time::Duration};

use serde::Serialize;
use sqlx::{
    ConnectOptions, PgPool,
    postgres::{PgConnectOptions, PgPoolOptions},
};

use super::config::config;

static POOL: OnceLock<PgPool> = OnceLock::new();
static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

pub fn pool() -> &'static PgPool {
    POOL.get().expect("database not initialised")
}

fn clean_url(url: &str) -> String {
    let Some((base, query)) = url.split_once('?') else {
        return url.to_string();
    };
    let kept: Vec<&str> = query
        .split('&')
        .filter(|p| !p.starts_with("schema="))
        .collect();
    if kept.is_empty() {
        base.to_string()
    } else {
        format!("{base}?{}", kept.join("&"))
    }
}

pub async fn init() {
    let options = clean_url(&config().database_url)
        .parse::<PgConnectOptions>()
        .expect("invalid ZIIT_DATABASE_URL")
        .log_statements(log::LevelFilter::Off)
        .log_slow_statements(log::LevelFilter::Warn, Duration::from_secs(30));
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .acquire_timeout(Duration::from_secs(30))
        .connect_with(options)
        .await
        .expect("failed to connect to database");
    baseline_from_prisma(&pool).await;
    tracing::info!("applying database migrations");
    let watchdog = tokio::spawn(report_blockers(pool.clone()));
    MIGRATOR.run(&pool).await.expect("failed to run migrations");
    watchdog.abort();
    tracing::info!("database ready");
    let _ = POOL.set(pool);
}

async fn report_blockers(pool: PgPool) {
    loop {
        tokio::time::sleep(Duration::from_secs(10)).await;
        let rows: Vec<(i32, String, String)> = sqlx::query_as(
            r#"SELECT pid, COALESCE(now() - query_start, interval '0')::text, left(regexp_replace(query, '\s+', ' ', 'g'), 120)
               FROM pg_stat_activity
               WHERE datname = current_database() AND pid <> pg_backend_pid() AND state <> 'idle'"#,
        )
        .fetch_all(&pool)
        .await
        .unwrap_or_default();
        tracing::warn!(
            "migrations are taking long, other database sessions are still busy (a leftover session can hold the migration lock; end it with pg_terminate_backend(pid))"
        );
        for (pid, running_for, query) in rows {
            tracing::warn!(pid, running_for, query, "busy database session");
        }
    }
}

async fn table_exists(pool: &PgPool, name: &str) -> bool {
    sqlx::query_scalar::<_, bool>("SELECT to_regclass($1) IS NOT NULL")
        .bind(format!("public.{name}"))
        .fetch_one(pool)
        .await
        .unwrap_or(false)
}

async fn baseline_from_prisma(pool: &PgPool) {
    if !table_exists(pool, "_prisma_migrations").await
        || table_exists(pool, "_sqlx_migrations").await
    {
        return;
    }
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS _sqlx_migrations (
            version BIGINT PRIMARY KEY,
            description TEXT NOT NULL,
            installed_on TIMESTAMPTZ NOT NULL DEFAULT now(),
            success BOOLEAN NOT NULL,
            checksum BYTEA NOT NULL,
            execution_time BIGINT NOT NULL
        )",
    )
    .execute(pool)
    .await
    .expect("failed to create _sqlx_migrations");
    let applied: Vec<String> = sqlx::query_scalar(
        "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    for migration in MIGRATOR.iter() {
        if migration.migration_type.is_down_migration() {
            continue;
        }
        let prefix = migration.version.to_string();
        if !applied.iter().any(|name| name.starts_with(&prefix)) {
            continue;
        }
        sqlx::query(
            "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
             VALUES ($1, $2, true, $3, 0) ON CONFLICT DO NOTHING",
        )
        .bind(migration.version)
        .bind(migration.description.to_string())
        .bind(migration.checksum.to_vec())
        .execute(pool)
        .await
        .expect("failed to baseline migration");
    }
}

pub const USER_COLS: &str = r#"id, email, "passwordHash", "githubId", "githubUsername", "epilogueId", "epilogueUsername", "apiKey", "leaderboardEnabled", "leaderboardFirstSet", "publicData""#;

#[derive(Debug, Clone, sqlx::FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct User {
    pub id: String,
    pub email: String,
    #[sqlx(rename = "passwordHash")]
    #[serde(skip)]
    pub password_hash: Option<String>,
    #[sqlx(rename = "githubId")]
    pub github_id: Option<String>,
    #[sqlx(rename = "githubUsername")]
    pub github_username: Option<String>,
    #[sqlx(rename = "epilogueId")]
    pub epilogue_id: Option<String>,
    #[sqlx(rename = "epilogueUsername")]
    pub epilogue_username: Option<String>,
    #[sqlx(rename = "apiKey")]
    pub api_key: String,
    #[sqlx(rename = "leaderboardEnabled")]
    pub leaderboard_enabled: bool,
    #[sqlx(rename = "leaderboardFirstSet")]
    pub leaderboard_first_set: bool,
    #[sqlx(rename = "publicData")]
    pub public_data: bool,
}

pub async fn find_user_by_id(id: &str) -> sqlx::Result<Option<User>> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        r#"SELECT {USER_COLS} FROM "User" WHERE id = $1"#
    )))
    .bind(id)
    .fetch_optional(pool())
    .await
}

pub async fn find_user_by_session(id: &str) -> sqlx::Result<Option<User>> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        r#"SELECT {USER_COLS} FROM "User" WHERE id = (
             SELECT "userId" FROM "Session" WHERE id = $1 AND "expiresAt" > now()
           )"#
    )))
    .bind(id)
    .fetch_optional(pool())
    .await
}

pub async fn find_user_by_email(email: &str) -> sqlx::Result<Option<User>> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        r#"SELECT {USER_COLS} FROM "User" WHERE email = $1"#
    )))
    .bind(email)
    .fetch_optional(pool())
    .await
}

pub async fn find_user_by_api_key(api_key: &str) -> sqlx::Result<Option<User>> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        r#"SELECT {USER_COLS} FROM "User" WHERE "apiKey" = $1"#
    )))
    .bind(api_key)
    .fetch_optional(pool())
    .await
}

pub fn new_id() -> String {
    cuid2::create_id()
}
