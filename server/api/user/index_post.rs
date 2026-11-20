use serde_json::{Value, json};
use topcoat::{
    Result,
    context::Cx,
    router::{content::Json, response::Response, route},
};

use crate::{
    composables::use_password_rules::PASSWORD_RULES,
    server::utils::{
        db::{find_user_by_email, pool},
        http_util::{auth_user, hash_password, json, valid_email},
        logging::fail,
    },
};

fn password_message(password: &str) -> Option<&'static str> {
    let messages = [
        "Password must be at least 12 characters",
        "Password must contain at least one uppercase letter",
        "Password must contain at least one lowercase letter",
        "Password must contain at least one number",
        "Password must contain at least one special character",
    ];
    PASSWORD_RULES
        .iter()
        .zip(messages)
        .find(|(rule, _)| !(rule.test)(password))
        .map(|(_, m)| m)
}

#[route(POST "/api/user")]
pub async fn update(cx: &Cx, Json(body): Json<Value>) -> Result<Response> {
    let user = auth_user(cx)?;
    let bad = |message: &str| {
        fail(
            400,
            format!("Invalid user settings data for user {}: {message}", user.id),
            Some(message),
        )
    };

    let email = match body.get("email") {
        None | Some(Value::Null) => None,
        Some(Value::String(e)) if valid_email(e) => Some(e.clone()),
        Some(_) => return Err(bad("Invalid email address")),
    };
    let password = match body.get("password") {
        None | Some(Value::Null) => None,
        Some(Value::String(p)) => match password_message(p) {
            Some(message) => return Err(bad(message)),
            None => Some(p.clone()),
        },
        Some(_) => return Err(bad("Invalid input: expected string")),
    };
    let flag = |name: &str| -> Result<Option<bool>> {
        match body.get(name) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::Bool(b)) => Ok(Some(*b)),
            Some(_) => Err(bad("Invalid input: expected boolean")),
        }
    };
    let enabled = flag("leaderboardEnabled")?;
    let first_set = flag("leaderboardFirstSet")?;

    if let Some(email) = &email
        && let Some(existing) = find_user_by_email(email)
            .await
            .map_err(|e| db_failure(&user.id, &e))?
        && existing.id != user.id
    {
        return Err(fail(
            409,
            format!(
                "User settings update failed for user {}: Email {email} already in use by another account.",
                user.id
            ),
            None,
        ));
    }
    let hash = match password {
        Some(p) => Some(
            hash_password(p)
                .await
                .map_err(|e| db_failure(&user.id, &e))?,
        ),
        None => None,
    };
    if email.is_some() || hash.is_some() || enabled.is_some() || first_set.is_some() {
        sqlx::query(
            r#"UPDATE "User" SET
                 email = COALESCE($1, email),
                 "passwordHash" = COALESCE($2, "passwordHash"),
                 "leaderboardEnabled" = COALESCE($3, "leaderboardEnabled"),
                 "leaderboardFirstSet" = COALESCE($4, "leaderboardFirstSet")
               WHERE id = $5"#,
        )
        .bind(email)
        .bind(hash)
        .bind(enabled)
        .bind(first_set)
        .bind(&user.id)
        .execute(pool())
        .await
        .map_err(|e| db_failure(&user.id, &e))?;
    }
    Ok(json(&json!({ "success": true })))
}

fn db_failure(user_id: &str, e: &dyn std::fmt::Display) -> topcoat::Error {
    fail(
        69,
        format!("Failed to update user settings for user {user_id}: {e}"),
        Some("Failed to update user settings. Please try again."),
    )
}
