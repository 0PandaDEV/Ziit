use crate::server::utils::db::pool;

pub async fn run() {
    if let Err(e) = sqlx::query(r#"DELETE FROM "Session" WHERE "expiresAt" < now()"#)
        .execute(pool())
        .await
    {
        tracing::warn!("Failed to clean expired sessions: {e}");
    }
}
