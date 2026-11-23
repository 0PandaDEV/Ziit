use topcoat::{
    Result,
    context::Cx,
    view::{View, component, view},
};

use super::icon::{Icon, icon};
use super::input::input;
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
    let total = items.len();
    let placeholder = format!("Search {}", title.to_lowercase());
    Ok(view! {
        <dialog id=(id) class="list-modal" aria-label=(title)>
            <div class="modal-header">
                <div class="heading">
                    <h2 class="title">(title)</h2>
                    <span class="count" data-count=(total)>(total)</span>
                </div>
                <button class="close-button" type="button" data-close="" aria-label="Close">
                    <span class="key">"esc"</span>
                    icon(name: Icon::X, size: 20)
                </button>
            </div>
            <div class="search">
                input(placeholder: &placeholder, input_type: "search", icon_name: Some(Icon::Search), attrs: topcoat::view::attributes! { data-filter="" autocomplete="off" spellcheck="false" })
            </div>
            <div class="list-content bar-list">
                for (index, (name, seconds)) in items.iter().enumerate() {
                    let width = if max > 0.0 { seconds / max * 100.0 } else { 0.0 };
                    let percent = if total_seconds > 0.0 { seconds / total_seconds * 100.0 } else { 0.0 };
                    <div class="item" style=(format!("--percentage:{width:.1}%"))>
                        <div class="rank">(index + 1)</div>
                        <div class="name" data-name=(name)>(name)</div>
                        <div class="percentage">(format!("{percent:.1}%"))</div>
                        <div class="time">(format_time(*seconds))</div>
                    </div>
                }
                <p class="empty" data-empty="" hidden=(true)>"No matches"</p>
            </div>
        </dialog>
    })
}
