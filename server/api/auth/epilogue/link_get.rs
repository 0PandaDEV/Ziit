use serde_json::json;
use topcoat::{
    Result,
    context::Cx,
    router::{response::Response, route},
};

use crate::server::{
    api::auth::epilogue_get::{authorize_url, frontend_url},
    utils::{
        auth::{SESSION_COOKIE, encrypt_claims, read_cookie, session_user_id, short_cookie},
        config::config,
        http_util::json,
        logging::plain,
    },
};

#[route(GET "/api/auth/epilogue/link")]
pub async fn link(cx: &Cx) -> Result<Response> {
    let config = config();
    if config.disable_registering {
        return Err(plain(403, "Registration is currently disabled"));
    }
    let Some(session) = read_cookie(cx, SESSION_COOKIE) else {
        return Err(plain(401, "No session found"));
    };
    let Some(user_id) = session_user_id(&session).await else {
        return Err(plain(401, "Invalid token"));
    };
    if config.epilogue_app_id.is_empty() || config.base_url.is_empty() {
        return Err(plain(500, "Epilogue auth is not configured"));
    }
    let state = uuid::Uuid::new_v4().to_string();
    short_cookie(cx, "epilogue_oauth_state", state.clone());
    short_cookie(cx, "epilogue_link_account", "true".into());
    let token = encrypt_claims(&user_id, 600).ok_or_else(|| {
        plain(
            500,
            "Could not initiate Epilogue linking. Please try again.",
        )
    })?;
    short_cookie(cx, "epilogue_link_session", token);
    let cancel = format!("{}/settings?error=link_cancelled", frontend_url());
    Ok(json(&json!({ "url": authorize_url(&state, &cancel) })))
}
