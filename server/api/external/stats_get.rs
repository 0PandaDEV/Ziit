use topcoat::{
    Result,
    context::Cx,
    router::{response::Response, route},
};

use super::api_key_user;
use crate::{
    composables::use_stats::TimeRange,
    server::utils::{
        http_util::{json, query_map},
        logging::fail,
        stats::calculate_stats,
    },
};

#[route(GET "/api/external/stats")]
pub async fn stats(cx: &Cx) -> Result<Response> {
    let user = api_key_user(
        cx,
        "External Stats API",
        Some("API key is missing or improperly formatted."),
        Some("Invalid API key format."),
    )
    .await?;
    let query = query_map(cx);
    let raw = query
        .get("timeRange")
        .map(String::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or("today");
    let Some(range) = TimeRange::parse(raw) else {
        return Err(fail(
            400,
            format!(
                "External Stats API: Invalid timeRange value: {raw}. User ID: {}",
                user.id
            ),
            Some("Invalid time range specified."),
        ));
    };
    let offset = query
        .get("midnightOffsetSeconds")
        .and_then(|v| v.parse::<i32>().ok());
    Ok(json(&calculate_stats(&user.id, range, offset, None).await?))
}
