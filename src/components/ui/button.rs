use topcoat::{
    Result,
    context::Cx,
    view::{Attributes, View, class, component, view},
};

use super::key::keys;

#[component]
pub async fn button(
    cx: &Cx,
    text: &str,
    #[default] key_name: &str,
    #[default] red: bool,
    #[default] disabled: bool,
    #[default] href: &str,
    #[default] attrs: Attributes,
) -> Result<impl View> {
    let key = (!key_name.is_empty()).then_some(key_name);
    Ok(view! {
        if href.is_empty() {
            <button class="btn" type="button" disabled=(disabled) data-key=(key) (attrs)>
                if let Some(combo) = key {
                    keys(combo: combo, red: red)
                }
                <p class=(class!("text", "red" if red))>(text)</p>
            </button>
        } else {
            <a class="btn" href=(href) data-key=(key) (attrs)>
                if let Some(combo) = key {
                    keys(combo: combo, red: red)
                }
                <p class=(class!("text", "red" if red))>(text)</p>
            </a>
        }
    })
}
