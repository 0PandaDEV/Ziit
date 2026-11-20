use topcoat::{
    Result,
    context::Cx,
    router::{request::headers, response::Response, route},
};

use crate::server::utils::{
    auth::short_cookie, config::config, http_util::redirect, logging::plain,
};

pub fn frontend_url(cx: &Cx) -> String {
    let host = headers(cx)
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let proto = headers(cx)
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("http");
    format!("{proto}://{host}")
}

pub fn authorize_url(state: &str, cancel_url: &str) -> String {
    let config = config();
    format!(
        "https://auth.epilogue.team/authorize/?app_id={}&redirect_url={}&cancel_url={}&state={}",
        urlencoding::encode(&config.epilogue_app_id),
        urlencoding::encode(&format!("{}/api/auth/epilogue/callback", config.base_url)),
        urlencoding::encode(cancel_url),
        urlencoding::encode(state),
    )
}

#[route(GET "/api/auth/epilogue")]
pub async fn epilogue(cx: &Cx) -> Result<Response> {
    let config = config();
    if config.disable_registering {
        return Err(plain(403, "Registration is currently disabled"));
    }
    if config.epilogue_app_id.is_empty() || config.base_url.is_empty() {
        return Err(plain(500, "Epilogue auth is not configured"));
    }
    let state = uuid::Uuid::new_v4().to_string();
    short_cookie(cx, "epilogue_oauth_state", state.clone());
    Ok(redirect(&authorize_url(
        &state,
        &format!("{}/login?error=cancelled", frontend_url(cx)),
    )))
}
