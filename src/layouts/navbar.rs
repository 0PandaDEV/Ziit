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
            <div class="viewport">
                <div class="content">
                    <div class="blur top" aria-hidden="true"><div></div><div></div><div></div><div></div><div></div></div>
                    (child)
                    <div class="blur bottom" aria-hidden="true"><div></div><div></div><div></div><div></div><div></div></div>
                </div>
            </div>
        </div>
    })
}
