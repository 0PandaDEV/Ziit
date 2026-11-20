use topcoat::{
    Result,
    context::{Cx, try_context},
    router::request::uri,
    view::{View, class, component, view},
};

use super::ui::nav::nav;
use crate::server::utils::auth::AuthUser;

#[component]
pub async fn navbar(cx: &Cx) -> Result<impl View> {
    let signed_in = try_context::<AuthUser>(cx).is_some();
    let path = uri(cx).path().to_string();
    Ok(view! {
        <div class="navbar">
            <a class="title" (nav(cx, "/"))>
                <svg width="44" height="12" viewBox="0 0 44 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                        d="M10.262 -9.53674e-07L0.462 -9.53674e-07L0.462 1.96L6.342 1.96L0.462 9.8L10.262 9.8L10.262 7.84L4.3819 7.84L10.262 -9.53674e-07ZM21.154 1.96L21.154 -9.53674e-07L11.354 -9.53674e-07L11.354 1.96L15.274 1.96L15.274 7.84L11.354 7.84L11.354 9.8L21.154 9.8L21.154 7.84L17.234 7.84L17.234 1.96L21.154 1.96ZM32.214 1.96L32.214 -9.53674e-07L22.414 -9.53674e-07L22.414 1.96L26.334 1.96L26.334 7.84L22.414 7.84L22.414 9.8L32.214 9.8L32.214 7.84L28.294 7.84L28.294 1.96L32.214 1.96ZM33.152 -9.53674e-07L33.152 1.96L37.072 1.96L37.072 9.8L39.032 9.8L39.032 1.96L42.952 1.96L42.952 -9.53674e-07L33.152 -9.53674e-07Z"
                        fill="#E6E6E6"
                    ></path>
                </svg>
            </a>
            <div class="actions">
                <a (nav(cx, "/stats")) class=(class!("router-link-active" if path == "/stats"))>"Stats"</a>
                <a (nav(cx, "/leaderboard")) class=(class!("router-link-active" if path == "/leaderboard"))>"Leaderboard"</a>
                if signed_in {
                    <a (nav(cx, "/settings")) class=(class!("router-link-active" if path == "/settings"))>"Settings"</a>
                } else {
                    <a (nav(cx, "/login")) class=(class!("router-link-active" if path == "/login"))>"Login"</a>
                }
            </div>
        </div>
    })
}
