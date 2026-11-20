use topcoat::{
    Result,
    context::Cx,
    view::{Child, View, class, component, view},
};

use crate::{
    components::{navbar::navbar, ui::select::time_range_select},
    composables::use_stats::{TimeRange, format_time},
};

#[component]
pub async fn default_layout(
    cx: &Cx,
    #[default] total_seconds: f64,
    #[default] range: TimeRange,
    #[default] home: bool,
    #[default] child: Child<'_>,
) -> Result<impl View> {
    Ok(view! {
        <div class="layout">
            navbar()
            <div class="fade-top"></div>
            <div class="content">(child)</div>
            <div class=(class!("fade-bottom", "home-page" if home))></div>
            if home {
                <div class="bottombar">
                    <p class="coding-time">(format_time(total_seconds))</p>
                    time_range_select(selected: range)
                </div>
            }
        </div>
    })
}
