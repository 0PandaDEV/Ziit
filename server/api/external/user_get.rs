use serde_json::json;
use topcoat::{
    Result,
    context::Cx,
    router::{response::Response, route},
};

use super::api_key_user;
use crate::server::utils::http_util::json;

#[route(GET "/api/external/user")]
pub async fn user(cx: &Cx) -> Result<Response> {
    let user = api_key_user(
        cx,
        "External User API",
        Some("API key is missing or improperly formatted."),
        Some("Invalid API key format."),
    )
    .await?;
    Ok(json(&json!({
        "id": user.id,
        "email": user.email,
        "githubId": user.github_id,
        "githubUsername": user.github_username,
        "apiKey": user.api_key,
    })))
}
