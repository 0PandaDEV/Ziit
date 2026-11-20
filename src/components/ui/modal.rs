use topcoat::{
    Result,
    context::Cx,
    view::{Child, View, component, view},
};

use super::button::button;

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
        <dialog id=(id) class="modal">
            <div class="text">
                <h2 class="title">(title)</h2>
                if !description.is_empty() {
                    <p class="description">(description)</p>
                }
            </div>
            <form data-api=(api) data-success=((!success.is_empty()).then_some(success)) data-reload="">
                (child)
                <div class="modal-buttons">
                    button(text: "Cancel", attrs: topcoat::view::attributes! { data-close="" })
                    button(text: "Save", attrs: topcoat::view::attributes! { type="submit" })
                </div>
            </form>
        </dialog>
    })
}
