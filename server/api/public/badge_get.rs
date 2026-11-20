use http::{
    StatusCode,
    header::{CONTENT_TYPE, HeaderValue},
};
use topcoat::{
    Result,
    context::Cx,
    router::{Body, request::uri, response::Response, route},
};

use crate::{
    composables::use_stats::TimeRange,
    server::utils::{
        badge::{BadgeOptions, badgen},
        http_util::query_map,
        logging::plain,
        stats::{calculate_stats, get_user_time_range_total},
    },
};

fn format_time(seconds: i64) -> String {
    if seconds == 0 {
        "0 mins".into()
    } else if seconds < 60 {
        format!("{seconds} secs")
    } else if seconds < 3600 {
        format!("{} mins", (seconds as f64 / 60.0).round() as i64)
    } else {
        let hours = seconds / 3600;
        let minutes = ((seconds % 3600) as f64 / 60.0).round() as i64;
        if minutes == 0 {
            format!("{hours} hrs")
        } else {
            format!("{hours} hrs {minutes} mins")
        }
    }
}

fn color_hex(color: &str) -> String {
    match color {
        "blue" => "007ec6",
        "green" => "97ca00",
        "red" => "e05d44",
        "orange" => "fe7d37",
        "yellow" => "dfb317",
        "purple" => "9f9f9f",
        "black" => "333333",
        other => other,
    }
    .to_string()
}

#[route(GET "/api/public/badge/{*params}")]
pub async fn badge(cx: &Cx) -> Result<Response> {
    let path = uri(cx).path().to_string();
    let segments: Vec<String> = path
        .split('/')
        .filter(|s| !s.is_empty())
        .skip_while(|s| *s != "badge")
        .skip(1)
        .map(|s| {
            urlencoding::decode(s)
                .map(|c| c.into_owned())
                .unwrap_or_else(|_| s.to_string())
        })
        .collect();

    let Some(user_id) = segments.first().filter(|s| !s.is_empty()) else {
        return Err(plain(400, "User ID is required"));
    };
    let project = segments
        .get(1)
        .map(|s| s.to_lowercase())
        .unwrap_or_else(|| "all".into());
    let range = match segments.get(2) {
        Some(raw) => TimeRange::parse(raw).ok_or_else(|| {
            plain(
                400,
                &format!(
                    "Invalid time range. Valid options are: {}",
                    TimeRange::valid_list()
                ),
            )
        })?,
        None => TimeRange::AllTime,
    };
    let color = segments.get(3).cloned().unwrap_or_else(|| "blue".into());
    let label_text = segments.get(4).cloned();
    let query = query_map(cx);
    let flat = query.get("style").map(String::as_str) == Some("flat");
    let icon = query.get("icon").cloned();

    let total_seconds = if project == "all" {
        get_user_time_range_total(user_id, range, None)
            .await?
            .total_minutes
            * 60
    } else {
        let stats = calculate_stats(user_id, range, None, Some(&project)).await?;
        if let Some(seconds) = stats.get("projectSeconds").and_then(|v| v.as_f64()) {
            seconds as i64
        } else {
            let mut sum = 0.0;
            for summary in stats["summaries"].as_array().into_iter().flatten() {
                if let Some(projects) = summary.get("projects").and_then(|p| p.as_object()) {
                    for (name, seconds) in projects {
                        if name.to_lowercase() == project {
                            sum += seconds.as_f64().unwrap_or(0.0);
                        }
                    }
                }
            }
            sum as i64
        }
    };

    let icon = icon.or_else(|| label_text.is_none().then(|| "/favicon.ico".to_string()));
    let svg = badgen(&BadgeOptions {
        label: label_text.as_deref().unwrap_or("Ziit"),
        status: &format_time(total_seconds),
        color: &color_hex(&color),
        flat,
        icon: icon.as_deref(),
    });
    let mut response = Response::new(Body::from(svg));
    *response.status_mut() = StatusCode::OK;
    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static("image/svg+xml;charset=utf-8"),
    );
    Ok(response)
}
