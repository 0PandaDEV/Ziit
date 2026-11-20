use serde_json::Value;
use topcoat::{
    Result,
    context::Cx,
    cookie::SameSite,
    router::{content::Json, response::Response, route},
};

use crate::server::utils::{
    auth::set_session,
    db::{find_user_by_email, pool},
    http_util::{redirect, valid_email, verify_password},
    logging::{fail, server_error},
};

#[route(POST "/api/auth/login")]
pub async fn login(cx: &Cx, Json(body): Json<Value>) -> Result<Response> {
    let email = match body.get("email").and_then(Value::as_str) {
        Some(e) if valid_email(e) => e.to_string(),
        Some(_) => {
            return Err(fail(
                400,
                "Login validation failed: invalid email format",
                Some("Invalid email format"),
            ));
        }
        None => {
            return Err(fail(
                400,
                "Login validation failed: missing email",
                Some("Invalid input: expected string, received undefined"),
            ));
        }
    };
    let password = match body.get("password").and_then(Value::as_str) {
        Some(p) if !p.is_empty() => p.to_string(),
        Some(_) => {
            return Err(fail(
                400,
                "Login validation failed: empty password",
                Some("Password is required"),
            ));
        }
        None => {
            return Err(fail(
                400,
                "Login validation failed: missing password",
                Some("Invalid input: expected string, received undefined"),
            ));
        }
    };

    let user = find_user_by_email(&email).await.map_err(|e| {
        server_error(
            format!("Authentication failed: {e}"),
            "Authentication failed. Please try again.",
        )
    })?;
    let Some(user) = user else {
        return Err(fail(
            401,
            "Invalid login attempt: user not found or no password hash.",
            Some("Invalid email or password"),
        ));
    };
    let Some(hash) = user.password_hash.clone() else {
        return Err(fail(
            401,
            "Invalid login attempt: user not found or no password hash.",
            Some("Invalid email or password"),
        ));
    };
    if !verify_password(password, hash).await {
        return Err(fail(
            401,
            "Invalid login attempt: password mismatch.",
            Some("Invalid email or password"),
        ));
    }

    sqlx::query(r#"UPDATE "User" SET lastlogin = now() WHERE id = $1"#)
        .bind(&user.id)
        .execute(pool())
        .await
        .map_err(|e| {
            server_error(
                format!("Authentication failed: {e}"),
                "Authentication failed. Please try again.",
            )
        })?;

    set_session(cx, &user, SameSite::Strict).await?;
    Ok(redirect("/"))
}
