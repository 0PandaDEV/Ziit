use topcoat::{
    Result,
    context::Cx,
    view::{View, component, view},
};

#[component]
pub async fn radio_button(
    cx: &Cx,
    text: &str,
    name: &str,
    value: &str,
    #[default] selected: bool,
) -> Result<impl View> {
    Ok(view! {
        <label class="radio-button">
            <input type="radio" name=(name) value=(value) checked=(selected)>
            <span class="circle">
                <span class="inner"></span>
                <span class="selected"></span>
            </span>
            <span class="text">(text)</span>
        </label>
    })
}
