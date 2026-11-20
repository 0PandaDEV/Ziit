use std::{collections::BTreeMap, time::Duration};

use base64::{Engine, engine::general_purpose::STANDARD};
use jiff::{Timestamp, civil::Date};
use serde::Deserialize;

use super::{
    heartbeats::{HeartbeatInput, process_heartbeats_by_date},
    import_queue::{ImportStatus, Update, update_job},
    url_policy::{fetch_external_instance, pinned_client},
    wakatime::{basename, parse_user_agent},
};

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct WakapiHeartbeat {
    branch: Option<String>,
    entity: Option<String>,
    language: Option<String>,
    project: Option<String>,
    time: Option<f64>,
    user_agent_id: Option<String>,
}

#[derive(Deserialize)]
struct Data<T> {
    data: T,
}

#[derive(Deserialize)]
struct AllTime {
    range: Range,
}

#[derive(Deserialize)]
struct Range {
    start_date: String,
}

const MAX_IMPORTED_HEARTBEATS: usize = 3_000_000;

fn map(h: WakapiHeartbeat, user_id: &str) -> HeartbeatInput {
    let agent = parse_user_agent(h.user_agent_id.as_deref().unwrap_or(""));
    let timestamp = h
        .time
        .and_then(|t| Timestamp::from_millisecond((t * 1000.0).round() as i64).ok())
        .unwrap_or_else(Timestamp::now);
    HeartbeatInput {
        user_id: user_id.to_string(),
        timestamp,
        project: h.project.filter(|p| !p.is_empty()),
        editor: Some(agent.editor),
        language: h.language.filter(|l| !l.is_empty()),
        os: Some(agent.os),
        file: h.entity.as_deref().filter(|e| !e.is_empty()).map(basename),
        branch: h.branch.filter(|b| !b.is_empty()),
    }
}

pub async fn prepare_wakapi_data(
    api_key: &str,
    instance_url: &str,
    user_id: &str,
    job_id: &str,
) -> topcoat::Result<BTreeMap<String, Vec<HeartbeatInput>>> {
    update_job(job_id, Update::status(ImportStatus::FetchingMetadata));
    let auth = format!("Basic {}", STANDARD.encode(api_key));
    let base = format!(
        "{}/api/compat/wakatime/v1",
        instance_url.trim_end_matches('/')
    );
    let client = pinned_client(instance_url, Duration::from_secs(60)).await?;

    let all_time: Data<AllTime> = fetch_external_instance(
        &client,
        &format!("{base}/users/current/all_time_since_today"),
        &[],
        Some(&auth),
    )
    .await?;
    let start: Timestamp = all_time.data.range.start_date.parse().map_err(|_| {
        topcoat::Error::msg(format!(
            "Failed to fetch activity date range from WakAPI for user {user_id}"
        ))
    })?;
    let earliest = Date::constant(2000, 1, 1);
    let mut day: Date = start
        .to_zoned_datetime(jiff::tz::TimeZone::UTC)
        .date()
        .max(earliest);
    let mut collected = 0usize;
    let last: Date = Timestamp::now()
        .to_zoned_datetime(jiff::tz::TimeZone::UTC)
        .date()
        .tomorrow()?;
    update_job(job_id, Update::status(ImportStatus::Processing));

    let mut by_date = BTreeMap::new();
    while day <= last {
        let date = day.to_string();
        let response: Data<Vec<WakapiHeartbeat>> = fetch_external_instance(
            &client,
            &format!("{base}/users/current/heartbeats"),
            &[("date", &date)],
            Some(&auth),
        )
        .await?;
        collected += response.data.len();
        if collected > MAX_IMPORTED_HEARTBEATS {
            return Err(topcoat::Error::msg("Import is too large"));
        }
        if !response.data.is_empty() {
            by_date.insert(
                date,
                response.data.into_iter().map(|h| map(h, user_id)).collect(),
            );
        }
        day = day.tomorrow()?;
    }
    Ok(by_date)
}

pub async fn handle_wakapi_sequential_import(
    by_date: BTreeMap<String, Vec<HeartbeatInput>>,
    user_id: &str,
    job_id: &str,
) -> topcoat::Result<i64> {
    tracing::info!(
        "[wakapi] Processing {} days of data sequentially",
        by_date.len()
    );
    let total = by_date.len() as i64;
    update_job(
        job_id,
        Update::progress(ImportStatus::ProcessingHeartbeats, 0, total),
    );
    for (i, (_, heartbeats)) in by_date.into_iter().enumerate() {
        if !heartbeats.is_empty() {
            process_heartbeats_by_date(user_id, heartbeats).await;
        }
        update_job(
            job_id,
            Update::progress(ImportStatus::ProcessingHeartbeats, i as i64 + 1, total),
        );
    }
    tracing::info!("[wakapi] Successfully imported {total} days from WakAPI");
    Ok(total)
}
