use topcoat::{
    Result,
    context::Cx,
    view::{View, component, view},
};

use super::icon::{Icon, icon};
use crate::composables::use_stats::format_time;

#[component]
pub async fn list_modal(
    cx: &Cx,
    id: &str,
    title: &str,
    items: &[(String, f64)],
    total_seconds: f64,
) -> Result<impl View> {
    let max = items.first().map(|i| i.1).unwrap_or(0.0);
    Ok(view! {
        <dialog id=(id) class="list-modal">
            <div class="header">
                <h2 class="title">(title)</h2>
                <button class="close-button" type="button" data-close="" aria-label="Close">
                    icon(name: Icon::X, size: 24)
                </button>
            </div>
            <div class="list-content bar-list">
                for (name, seconds) in items.iter() {
                    let width = if max > 0.0 { seconds / max * 100.0 } else { 0.0 };
                    let percent = if total_seconds > 0.0 { seconds / total_seconds * 100.0 } else { 0.0 };
                    <div class="item" style=(format!("--percentage:{width:.1}%"))>
                        <div class="name">(name)</div>
                        <div class="percentage">(format!("{percent:.1}%"))</div>
                        <div class="time">(format_time(*seconds))</div>
                    </div>
                }
            </div>
        </dialog>
    })
}
