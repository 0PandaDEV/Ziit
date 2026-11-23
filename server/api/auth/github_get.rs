use topcoat::{
    Result,
    context::Cx,
    router::{response::Response, route},
};

use crate::server::utils::{
    auth::short_cookie,
    config::config,
    http_util::{base_url_redirect, redirect},
    logging::plain,
};

#[route(GET "/api/auth/github")]
pub async fn github(cx: &Cx) -> Result<Response> {
    if let Some(response) = base_url_redirect(cx) {
        return Ok(response);
    }
    let config = config();
    if config.disable_registering {
        return Err(plain(403, "Registration is currently disabled"));
    }
    let state = uuid::Uuid::new_v4().to_string();
    short_cookie(cx, "github_oauth_state", state.clone());
    Ok(redirect(&authorize_url(&state)))
}

pub fn authorize_url(state: &str) -> String {
    let config = config();
    format!(
        "https://github.com/login/oauth/authorize?client_id={}&redirect_uri={}&state={}&scope={}",
        urlencoding::encode(&config.github_client_id),
        urlencoding::encode(&format!("{}/api/auth/github/callback", config.base_url)),
        urlencoding::encode(state),
        urlencoding::encode("read:user user:email"),
    )
}
