use topcoat::{
    Result,
    context::Cx,
    view::{View, component, view},
};

use super::ui::icon::{Icon, icon};
use crate::composables::use_password_rules::PASSWORD_RULES;

#[component]
pub async fn password_rules(cx: &Cx, id: &str) -> Result<impl View> {
    Ok(view! {
        <ul id=(id) class="password-rules" hidden="">
            for rule in PASSWORD_RULES.iter() {
                <li data-pattern=(rule.pattern)>
                    <span class="when-met">icon(name: Icon::Check, size: 14)</span>
                    <span class="when-unmet">icon(name: Icon::Circle, size: 14)</span>
                    <span>(rule.short)</span>
                </li>
            }
        </ul>
    })
}
