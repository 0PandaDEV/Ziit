use topcoat::{
    Result,
    context::Cx,
    view::{View, component, view},
};

#[component]
pub async fn flash(
    cx: &Cx,
    message: Option<String>,
    #[default] success: bool,
) -> Result<impl View> {
    Ok(view! {
        if let Some(message) = message {
            <div hidden="" data-toast=(message) data-toast-type=(if success { "success" } else { "error" })></div>
        }
    })
}
