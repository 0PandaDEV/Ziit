use topcoat::{
    Result,
    context::Cx,
    view::{Child, View, component, view},
};

use crate::components::navbar::navbar;

#[component]
pub async fn navbar_layout(cx: &Cx, #[default] child: Child<'_>) -> Result<impl View> {
    Ok(view! {
        <div class="layout navbar-layout">
            navbar()
            <div class="fade-top"></div>
            <div class="content">(child)</div>
            <div class="fade-bottom"></div>
        </div>
    })
}
