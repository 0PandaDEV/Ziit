use super::db::pool;

pub async fn get(key: &str) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar(r#"SELECT "value" FROM "AppState" WHERE "key" = $1"#)
        .bind(key)
        .fetch_optional(pool())
        .await
}

pub async fn set(key: &str, value: &str) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO "AppState" ("key", "value") VALUES ($1, $2)
           ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now()"#,
    )
    .bind(key)
    .bind(value)
    .execute(pool())
    .await?;
    Ok(())
}
