pub mod clean_chunks;
pub mod clean_sessions;
pub mod public_stats;

use std::{future::Future, time::Duration};

use crate::server::{plugins::normalize_data, utils::backfill_seconds};

const STARTUP_DELAY: Duration = Duration::from_secs(5);

fn until_next_midnight_utc() -> Duration {
    let now = jiff::Timestamp::now();
    let next = now
        .to_zoned_datetime(jiff::tz::TimeZone::UTC)
        .date()
        .tomorrow()
        .ok()
        .and_then(|d| d.to_zoned_datetime(jiff::tz::TimeZone::UTC).ok())
        .map(|z| z.timestamp());
    next.map(|n| Duration::from_secs((n.as_second() - now.as_second()).max(1) as u64))
        .unwrap_or(Duration::from_secs(86_400))
}

fn daily<F, Fut>(job: F)
where
    F: Fn() -> Fut + Send + 'static,
    Fut: Future<Output = ()> + Send + 'static,
{
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(until_next_midnight_utc()).await;
            job().await;
        }
    });
}

pub fn start() {
    crate::server::api::public::keep_warm();
    tokio::spawn(async {
        tokio::time::sleep(STARTUP_DELAY).await;
        backfill_seconds::run().await;
        normalize_data::run().await;
        public_stats::run().await;
        clean_chunks::run().await;
        clean_sessions::run().await;
    });
    daily(public_stats::run);
    daily(clean_chunks::run);
    daily(clean_sessions::run);
}
