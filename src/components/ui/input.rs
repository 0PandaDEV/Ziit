use topcoat::{
    Result,
    context::Cx,
    view::{Attributes, View, component, view},
};

use super::icon::{Icon, icon};

#[component]
pub async fn input(
    cx: &Cx,
    #[default] name: &str,
    #[default] placeholder: &str,
    #[default] input_type: &str,
    #[default] value: &str,
    #[default] icon_name: Option<Icon>,
    #[default] locked: bool,
    #[default] attrs: Attributes,
) -> Result<impl View> {
    Ok(view! {
        <div class="input">
            if let Some(name) = icon_name {
                icon(name: name, size: 16)
            }
            <input
                name=((!name.is_empty()).then_some(name))
                type=(if input_type.is_empty() { "text" } else { input_type })
                placeholder=((!placeholder.is_empty()).then_some(placeholder))
                value=((!value.is_empty()).then_some(value))
                readonly=(locked)
                (attrs)
            >
        </div>
    })
}
