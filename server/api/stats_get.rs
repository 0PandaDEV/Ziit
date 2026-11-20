use topcoat::{
    Result,
    context::Cx,
    router::{response::Response, route},
};

use crate::{
    composables::use_stats::TimeRange,
    server::utils::{
        http_util::{auth_user, json, query_map},
        logging::fail,
        stats::calculate_stats,
    },
};

#[route(GET "/api/stats")]
pub async fn stats(cx: &Cx) -> Result<Response> {
    let user = auth_user(cx)?;
    let query = query_map(cx);
    let raw = query.get("timeRange").map(String::as_str).unwrap_or("");
    let Some(range) = TimeRange::parse(raw) else {
        return Err(fail(
            400,
            format!("Invalid timeRange value: {raw}. User ID: {}", user.id),
            Some("Invalid time range specified."),
        ));
    };
    let offset = query
        .get("midnightOffsetSeconds")
        .and_then(|v| v.parse::<i32>().ok());
    Ok(json(&calculate_stats(&user.id, range, offset, None).await?))
}
