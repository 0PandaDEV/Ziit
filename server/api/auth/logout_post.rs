use serde_json::json;
use topcoat::{
    Result,
    context::Cx,
    router::{response::Response, route},
};

use crate::server::utils::{auth::clear_session, http_util::json};

#[route(POST "/api/auth/logout")]
pub async fn logout(cx: &Cx) -> Result<Response> {
    clear_session(cx).await;
    Ok(json(&json!({ "success": true })))
}
