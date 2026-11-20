use crate::server::utils::db::pool;

pub async fn run() {
    let result = sqlx::query(
        r#"DELETE FROM "User" u
           WHERE u.lastlogin < now() - INTERVAL '90 days'
             AND NOT EXISTS (SELECT 1 FROM "Heartbeats" h WHERE h."userId" = u.id)"#,
    )
    .execute(pool())
    .await;
    match result {
        Ok(r) if r.rows_affected() > 0 => {
            tracing::info!("Deleted {} inactive users", r.rows_affected())
        }
        Ok(_) => {}
        Err(e) => tracing::error!("Error cleaning inactive users: {e}"),
    }
}
