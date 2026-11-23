use topcoat::{
    Result,
    context::Cx,
    view::{Child, View, component, view},
};

use super::{
    button::button,
    icon::{Icon, icon},
};

#[component]
pub async fn modal(
    cx: &Cx,
    id: &str,
    title: &str,
    api: &str,
    #[default] description: &str,
    #[default] success: &str,
    #[default] child: Child<'_>,
) -> Result<impl View> {
    Ok(view! {
        <dialog id=(id) class="modal" aria-label=(title)>
            <div class="modal-header">
                <h2 class="title">(title)</h2>
                <button class="close-button" type="button" data-close="" aria-label="Close">
                    <span class="key">"esc"</span>
                    icon(name: Icon::X, size: 20)
                </button>
            </div>
            <form data-api=(api) data-success=((!success.is_empty()).then_some(success)) data-reload="">
                if !description.is_empty() {
                    <p class="description">(description)</p>
                }
                (child)
                <div class="modal-buttons">
                    button(text: "Save", key_name: "enter", attrs: topcoat::view::attributes! { type="submit" })
                </div>
            </form>
        </dialog>
    })
}
