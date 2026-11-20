use crate::server::utils::normalize_backfill::run_data_maintenance;

pub async fn run() {
    if let Err(error) = run_data_maintenance().await {
        tracing::error!(%error, "data maintenance failed");
    }
}
