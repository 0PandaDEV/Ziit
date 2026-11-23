use topcoat::{
    Result,
    context::Cx,
    view::{View, class, component, view},
};

use super::ui::icon::{Icon, icon};
use crate::composables::use_password_rules::PASSWORD_RULES;

#[component]
pub async fn password_rules(cx: &Cx, id: &str, #[default] inline: bool) -> Result<impl View> {
    Ok(view! {
        <ul id=(id) class=(class!("password-rules", "inline" if inline)) hidden=(!inline)>
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

#[component]
pub async fn password_match(cx: &Cx) -> Result<impl View> {
    Ok(view! {
        <p class="password-match" data-state="empty">
            <span class="when-empty">icon(name: Icon::Circle, size: 14) "Passwords match"</span>
            <span class="when-match">icon(name: Icon::Check, size: 14) "Passwords match"</span>
            <span class="when-mismatch">icon(name: Icon::X, size: 14) "Passwords don't match"</span>
        </p>
    })
}
