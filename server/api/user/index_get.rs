use serde_json::json;
use topcoat::{
    Result,
    context::Cx,
    router::{response::Response, route},
};

use crate::server::utils::{
    db::find_user_by_id,
    http_util::{auth_user, json},
    logging::{fail, server_error},
};

#[route(GET "/api/user")]
pub async fn user(cx: &Cx) -> Result<Response> {
    let auth = auth_user(cx)?;
    let user = find_user_by_id(&auth.id)
        .await
        .map_err(|e| {
            server_error(
                format!("Failed to fetch user data for user {}: {e}", auth.id),
                "Failed to fetch user data. Please try again.",
            )
        })?
        .ok_or_else(|| {
            fail(
                404,
                format!("User not found for ID {}", auth.id),
                Some("User not found."),
            )
        })?;
    Ok(json(&json!({
        "id": user.id,
        "email": user.email,
        "githubId": user.github_id,
        "githubUsername": user.github_username,
        "epilogueId": user.epilogue_id,
        "epilogueUsername": user.epilogue_username,
        "apiKey": user.api_key,
        "leaderboardEnabled": user.leaderboard_enabled,
        "leaderboardFirstSet": user.leaderboard_first_set,
    })))
}
