use serde_json::{Value, json};

use super::{db::pool, logging::plain};
use crate::composables::use_stats::TimeRange;

pub async fn calculate_stats(
    user_id: &str,
    time_range: TimeRange,
    midnight_offset_seconds: Option<i32>,
    project_filter: Option<&str>,
) -> topcoat::Result<Value> {
    let exists: bool = sqlx::query_scalar(r#"SELECT EXISTS (SELECT 1 FROM "User" WHERE id = $1)"#)
        .bind(user_id)
        .fetch_one(pool())
        .await
        .map_err(|e| plain(500, &format!("Error calculating stats: {e}")))?;
    if !exists {
        return Err(plain(404, "User not found"));
    }

    let raw: Option<String> = sqlx::query_scalar(
        "SELECT get_user_stats($1::TEXT, $2::TEXT, $3::INT, $4::TEXT)::text AS stats",
    )
    .bind(user_id)
    .bind(time_range.as_db())
    .bind(midnight_offset_seconds.unwrap_or(0))
    .bind(project_filter)
    .fetch_one(pool())
    .await
    .map_err(|e| {
        tracing::error!("Error calculating stats: {e}");
        plain(500, &format!("Error calculating stats: {e}"))
    })?;

    let parsed: Value = match raw {
        Some(raw) => serde_json::from_str(&raw)
            .map_err(|e| plain(500, &format!("Error calculating stats: {e}")))?,
        None => {
            return Err(plain(
                500,
                "Error calculating stats: No data returned from database function",
            ));
        }
    };

    let mut out = json!({
        "summaries": parsed.get("summaries").cloned().filter(|v| !v.is_null()).unwrap_or(json!([])),
        "offsetSeconds": parsed.get("offsetSeconds").cloned().filter(|v| !v.is_null()).unwrap_or(json!(0)),
    });
    if let Some(seconds) = parsed.get("projectSeconds").filter(|v| !v.is_null()) {
        out["projectSeconds"] = seconds.clone();
        out["projectFilter"] = parsed.get("projectFilter").cloned().unwrap_or(Value::Null);
    }
    Ok(out)
}

pub struct TimeRangeTotal {
    pub total_minutes: i64,
}

pub async fn get_user_time_range_total(
    user_id: &str,
    time_range: TimeRange,
    offset_seconds: Option<i32>,
) -> topcoat::Result<TimeRangeTotal> {
    let row: Option<(Option<i32>,)> = sqlx::query_as(
        "SELECT total_minutes::INT FROM get_user_time_range_total($1::TEXT, $2::TEXT, $3::INT)",
    )
    .bind(user_id)
    .bind(time_range.as_db())
    .bind(offset_seconds.unwrap_or(0))
    .fetch_optional(pool())
    .await
    .map_err(|e| {
        tracing::error!("Error getting time range total: {e}");
        plain(500, &format!("Error getting time range total: {e}"))
    })?;
    Ok(match row {
        Some((m,)) => TimeRangeTotal {
            total_minutes: m.unwrap_or(0) as i64,
        },
        None => TimeRangeTotal { total_minutes: 0 },
    })
}
