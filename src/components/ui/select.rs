use topcoat::{
    Result,
    context::Cx,
    view::{View, class, component, view},
};

use super::{
    icon::{Icon, icon},
    key::keys,
    nav::nav,
};
use crate::composables::{use_stats::TimeRange, use_time_range_options::TIME_RANGE_OPTIONS};

#[component]
pub async fn time_range_select(cx: &Cx, selected: TimeRange) -> Result<impl View> {
    let current = TIME_RANGE_OPTIONS
        .iter()
        .find(|o| o.value == selected)
        .map(|o| o.label)
        .unwrap_or("Select");
    Ok(view! {
        <details class="select-container">
            <summary class="selected-item">
                (current)
                icon(name: Icon::ChevronsUpDown, size: 16)
            </summary>
            <div class="dropdown-menu">
                for option in TIME_RANGE_OPTIONS.iter() {
                    <a
                        class=(class!("dropdown-item", "selected" if option.value == selected))
                        (nav(cx, format!("/?range={}", option.value.as_str()))) data-loading-bar=""
                        data-key=(option.key)
                    >
                        (option.label)
                        keys(combo: option.key)
                    </a>
                }
            </div>
        </details>
    })
}
