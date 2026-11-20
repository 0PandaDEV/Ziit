use topcoat::{
    Result,
    context::Cx,
    view::{View, class, component, view},
};

#[component]
pub async fn key(cx: &Cx, key_name: &str, #[default] red: bool) -> Result<impl View> {
    Ok(view! {
        <div class=(class!("key", "red" if red))>(key_name)</div>
    })
}

#[component]
pub async fn keys(cx: &Cx, combo: &str, #[default] red: bool) -> Result<impl View> {
    Ok(view! {
        <div class="key-container">
            for part in combo.split('+') {
                key(key_name: part, red: red)
            }
        </div>
    })
}
