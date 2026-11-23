use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};
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

pub const ISSUER: &str = "https://auth.epilogue.team";

pub fn new_pkce() -> (String, String) {
    let verifier = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

pub fn redirect_uri() -> String {
    format!("{}/api/auth/epilogue/callback", config().base_url)
}

pub fn authorize_url(state: &str, challenge: &str) -> String {
    format!(
        "{ISSUER}/authorize/?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&code_challenge={}&code_challenge_method=S256",
        urlencoding::encode(&config().epilogue_app_id),
        urlencoding::encode(&redirect_uri()),
        urlencoding::encode("openid email profile"),
        urlencoding::encode(state),
        urlencoding::encode(challenge),
    )
}

#[route(GET "/api/auth/epilogue")]
pub async fn epilogue(cx: &Cx) -> Result<Response> {
    if let Some(response) = base_url_redirect(cx) {
        return Ok(response);
    }
    let config = config();
    if config.disable_registering {
        return Err(plain(403, "Registration is currently disabled"));
    }
    if config.epilogue_app_id.is_empty() || config.base_url.is_empty() {
        return Err(plain(500, "Epilogue auth is not configured"));
    }
    let state = uuid::Uuid::new_v4().to_string();
    let (verifier, challenge) = new_pkce();
    short_cookie(cx, "epilogue_oauth_state", state.clone());
    short_cookie(cx, "epilogue_pkce", verifier);
    Ok(redirect(&authorize_url(&state, &challenge)))
}
