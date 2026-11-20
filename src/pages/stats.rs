use topcoat::{
    Result,
    context::Cx,
    router::page,
    view::{View, component, view},
};

use crate::{
    app::{PageMeta, meta},
    layouts::navbar::navbar_layout,
    server::api::public::stats_get::public_stats,
};

#[component]
async fn item(cx: &Cx, label: &str, value: String) -> Result<impl View> {
    Ok(view! {
        <div class="item">
            <p>(label)</p>
            <h2>(value)</h2>
        </div>
    })
}

fn text(value: &serde_json::Value, key: &str) -> String {
    match &value[key] {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    }
}

#[page(
    "/stats",
    with(meta("Ziit - Instance Statistics", "View instance statistics on Ziit.", "/stats")),
    with(PageMeta { class: "page-stats", needs_tz: false })
)]
pub async fn stats(cx: &Cx) -> Result<impl View> {
    let stats = public_stats().await.unwrap_or_default();
    Ok(view! {
        navbar_layout(
            <main>
                <div class="container">
                    <div class="numbers">
                        item(label: "total hours", value: text(&stats, "totalHours"))
                        item(label: "total heartbeats", value: text(&stats, "totalHeartbeats"))
                        item(label: "total users", value: text(&stats, "totalUsers"))
                    </div>
                    <div class="top">
                        item(label: "top editor", value: text(&stats, "topEditor"))
                        item(label: "top language", value: text(&stats, "topLanguage"))
                        item(label: "top os", value: text(&stats, "topOS"))
                    </div>
                </div>
            </main>
        )
    })
}
