use topcoat::{
    Result,
    context::Cx,
    router::page,
    view::{View, class, component, view},
};

use crate::components::ui::nav::nav;
use crate::{
    app::{PageMeta, meta},
    layouts::navbar::navbar_layout,
    server::{api::public::leaderboard_get::leaderboard, utils::http_util::query_map},
};

#[derive(Clone, Default)]
struct Row {
    user_id: String,
    total_minutes: i64,
    top_language: String,
    top_editor: String,
    top_os: String,
}

fn rows(value: &serde_json::Value) -> Vec<Row> {
    let text = |v: &serde_json::Value, k: &str| {
        v[k].as_str()
            .filter(|s| !s.is_empty())
            .unwrap_or("Unknown")
            .to_string()
    };
    value
        .as_array()
        .into_iter()
        .flatten()
        .map(|v| Row {
            user_id: v["userId"].as_str().unwrap_or_default().to_string(),
            total_minutes: v["totalMinutes"].as_i64().unwrap_or(0),
            top_language: text(v, "topLanguage"),
            top_editor: text(v, "topEditor"),
            top_os: text(v, "topOS"),
        })
        .collect()
}

fn minutes(total: i64) -> String {
    format!("{}h {}m", total / 60, total % 60)
}

#[component]
async fn header_cell(
    cx: &Cx,
    label: &str,
    key: &str,
    sort: &str,
    desc: bool,
    #[default] mobile_hidden: bool,
) -> Result<impl View> {
    let active = sort == key;
    let next = if active && desc { "asc" } else { "desc" };
    Ok(view! {
        <td class=(class!("sorted" if active, "asc" if active && !desc, "desc" if active && desc, "hide-mobile" if mobile_hidden))>
            <a (nav(cx, format!("/leaderboard?sort={key}&order={next}")))>(label)</a>
        </td>
    })
}

#[page(
    "/leaderboard",
    with(meta("Ziit - Leaderboard", "See who codes the most on this Ziit instance.", "/leaderboard")),
    with(PageMeta { class: "page-leaderboard", needs_tz: false })
)]
pub async fn leaderboard_page(cx: &Cx) -> Result<impl View> {
    let query = query_map(cx);
    let sort = query
        .get("sort")
        .cloned()
        .unwrap_or_else(|| "totalMinutes".into());
    let desc = query.get("order").map(String::as_str) != Some("asc");
    let mut data = rows(&leaderboard().await.unwrap_or_default());
    data.sort_by(|a, b| {
        let ordering = match sort.as_str() {
            "topLanguage" => a.top_language.cmp(&b.top_language),
            "topEditor" => a.top_editor.cmp(&b.top_editor),
            "topOS" => a.top_os.cmp(&b.top_os),
            _ => a.total_minutes.cmp(&b.total_minutes),
        };
        if desc { ordering.reverse() } else { ordering }
    });
    let by_minutes = sort == "totalMinutes";
    let by_language = sort == "topLanguage";
    let by_editor = sort == "topEditor";
    let by_os = sort == "topOS";
    Ok(view! {
        navbar_layout(
            <table class="data-table">
                <thead class="header row">
                    <tr>
                        <td class="id">"User ID"</td>
                        header_cell(label: "Total Time", key: "totalMinutes", sort: &sort, desc: desc)
                        header_cell(label: "Top Language", key: "topLanguage", sort: &sort, desc: desc, mobile_hidden: true)
                        header_cell(label: "Top Editor", key: "topEditor", sort: &sort, desc: desc, mobile_hidden: true)
                        header_cell(label: "Top OS", key: "topOS", sort: &sort, desc: desc, mobile_hidden: true)
                    </tr>
                </thead>
                <tbody>
                    for user in data {
                        <tr class="row">
                            <td class="id">(user.user_id)</td>
                            <td class=(class!("sorted" if by_minutes))>(minutes(user.total_minutes))</td>
                            <td class=(class!("hide-mobile", "sorted" if by_language))>(user.top_language)</td>
                            <td class=(class!("hide-mobile", "sorted" if by_editor))>(user.top_editor)</td>
                            <td class=(class!("hide-mobile", "sorted" if by_os))>(user.top_os)</td>
                        </tr>
                    }
                </tbody>
            </table>
        )
    })
}
