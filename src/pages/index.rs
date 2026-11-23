use jiff::{Timestamp, tz::TimeZone};
use topcoat::{
    Result,
    context::{Cx, try_context},
    router::{page, request::headers},
    view::{View, component, view},
};

use crate::{
    app::{PageMeta, meta},
    components::{
        chart::{chart_config, line_chart},
        leaderboard_setup::leaderboard_setup,
        ui::{
            icon::{Icon, icon},
            list_modal::list_modal,
        },
    },
    composables::use_stats::{StatsResult, TimeRange, format_time, process_stats_response, sorted},
    layouts::default::default_layout,
    server::utils::{
        auth::{AuthUser, read_cookie},
        http_util::query_map,
        stats::calculate_stats,
        stats_cache,
    },
};

const STALE_AFTER: std::time::Duration = std::time::Duration::from_secs(3);

fn cookie_zone(cx: &Cx) -> TimeZone {
    read_cookie(cx, "ziit_tz")
        .filter(|name| {
            name.len() <= 64
                && name
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '_' | '+' | '-'))
        })
        .and_then(|name| TimeZone::get(&name).ok())
        .unwrap_or(TimeZone::UTC)
}

fn local_today(zone: &TimeZone) -> jiff::civil::Date {
    Timestamp::now().to_zoned_datetime(zone.clone()).date()
}

#[component]
async fn section(
    cx: &Cx,
    id: &str,
    title: &str,
    items: &[(String, f64)],
    total_seconds: f64,
) -> Result<impl View> {
    let max = items.first().map(|i| i.1).unwrap_or(0.0);
    let modal_id = format!("modal-{id}");
    let opener = format!("#{modal_id}");
    Ok(view! {
        <div class="section">
            <div class="text">
                <h2>(title)</h2>
                <button class="extend" type="button" data-open=(opener)>
                    icon(name: Icon::Maximize, size: 16)
                    "DETAILS"
                </button>
            </div>
            if items.is_empty() {
                <p class="no-data">"No data available"</p>
            } else {
                <div class="list bar-list">
                    for (name, seconds) in items.iter().take(8) {
                        let width = if max > 0.0 { seconds / max * 100.0 } else { 0.0 };
                        let percent = if total_seconds > 0.0 { seconds / total_seconds * 100.0 } else { 0.0 };
                        <div class="item" style=(format!("--percentage:{width:.1}%"))>
                            <div class="name">(name)</div>
                            <div class="percentage">(format!("{percent:.1}%"))</div>
                            <div class="time">(format_time(*seconds))</div>
                        </div>
                    }
                </div>
            }
            list_modal(id: &modal_id, title: title, items: items, total_seconds: total_seconds)
        </div>
    })
}

async fn dashboard_stats(
    user_id: &str,
    range: TimeRange,
    offset: i32,
    refresh: bool,
) -> (StatsResult, bool) {
    if !refresh && let Some((value, age)) = stats_cache::get(user_id, range.as_str(), offset) {
        return (process_stats_response(&value), age > STALE_AFTER);
    }
    match calculate_stats(user_id, range, Some(offset), None).await {
        Ok(value) => {
            stats_cache::put(user_id, range.as_str(), offset, &value);
            (process_stats_response(&value), false)
        }
        Err(error) => {
            tracing::error!("Failed to load dashboard stats: {error}");
            (StatsResult::default(), false)
        }
    }
}

#[page(
    "/",
    with(meta("Ziit - Coding Statistics", "Track your coding time and productivity with Ziit", "")),
    with(PageMeta { class: "page-index", needs_tz: true })
)]
pub async fn index(cx: &Cx) -> Result<impl View> {
    let user = try_context::<AuthUser>(cx).map(|u| u.0.clone());
    let remembered = read_cookie(cx, "ziit_range");
    let range = query_map(cx)
        .get("range")
        .cloned()
        .or(remembered)
        .and_then(|r| TimeRange::parse(&r))
        .filter(|r| *r != TimeRange::CustomRange)
        .unwrap_or(TimeRange::Today);
    let zone = cookie_zone(cx);
    let offset = zone.to_offset(Timestamp::now()).seconds();

    let refresh = headers(cx).contains_key("x-ziit-refresh");
    let (stats, stale) = match &user {
        Some(user) => dashboard_stats(&user.id, range, offset, refresh).await,
        None => (StatsResult::default(), false),
    };

    let (labels, data) = chart_config(range, &stats, local_today(&zone));
    let projects = sorted(&stats.projects);
    let languages = sorted(&stats.languages);
    let editors = sorted(&stats.editors);
    let files = sorted(&stats.files);
    let systems = sorted(&stats.os);
    let branches = sorted(&stats.branches);
    let first_set = user.as_ref().is_some_and(|u| u.leaderboard_first_set);
    let total = stats.total_seconds;

    Ok(view! {
        default_layout(
            total_seconds: total,
            range: range,
            home: true,
            <div class="stats-dashboard" data-stale=(stale) data-range=(range.as_str())>
                if !first_set {
                    leaderboard_setup()
                }
                <div class="chart-container">
                    <div class="chart">
                        line_chart(labels: &labels, data: &data)
                    </div>
                </div>
                <div class="metrics-tables">
                    section(id: "projects", title: "Projects", items: &projects, total_seconds: total)
                    section(id: "languages", title: "Languages", items: &languages, total_seconds: total)
                    section(id: "editors", title: "Editors", items: &editors, total_seconds: total)
                    section(id: "files", title: "Files", items: &files, total_seconds: total)
                    section(id: "os", title: "Operating Systems", items: &systems, total_seconds: total)
                    section(id: "branches", title: "Branches", items: &branches, total_seconds: total)
                </div>
            </div>
        )
    })
}
