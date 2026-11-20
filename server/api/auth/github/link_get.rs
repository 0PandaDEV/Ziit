use serde_json::json;
use topcoat::{
    Result,
    context::Cx,
    router::{response::Response, route},
};

use crate::server::{
    api::auth::github_get::authorize_url,
    utils::{
        auth::{SESSION_COOKIE, decrypt_user_id, encrypt_claims, read_cookie, short_cookie},
        config::config,
        http_util::json,
        logging::plain,
    },
};

#[route(GET "/api/auth/github/link")]
pub async fn link(cx: &Cx) -> Result<Response> {
    if config().disable_registering {
        return Err(plain(403, "Registration is currently disabled"));
    }
    let Some(session) = read_cookie(cx, SESSION_COOKIE) else {
        return Err(plain(401, "No session found"));
    };
    let Some(user_id) = decrypt_user_id(&session) else {
        return Err(plain(401, "Invalid token"));
    };
    let state = uuid::Uuid::new_v4().to_string();
    short_cookie(cx, "github_oauth_state", state.clone());
    short_cookie(cx, "github_link_account", "true".into());
    let token = encrypt_claims(&user_id, None, 600)
        .ok_or_else(|| plain(500, "Could not initiate GitHub linking. Please try again."))?;
    short_cookie(cx, "github_link_session", token);
    Ok(json(&json!({ "url": authorize_url(&state) })))
}
