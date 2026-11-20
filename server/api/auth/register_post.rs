use serde_json::Value;
use topcoat::{
    Result,
    context::Cx,
    cookie::SameSite,
    router::{content::Json, response::Response, route},
};

use crate::{
    composables::use_password_rules::first_error,
    server::utils::{
        auth::set_session,
        config::config,
        db::{find_user_by_email, find_user_by_id, new_id, pool},
        http_util::{hash_password, redirect},
        logging::{fail, plain, server_error},
    },
};

#[route(POST "/api/auth/register")]
pub async fn register(cx: &Cx, Json(body): Json<Value>) -> Result<Response> {
    if config().disable_registering {
        return Err(plain(403, "Registration is currently disabled"));
    }
    let (Some(email), Some(password)) = (
        body.get("email")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty()),
        body.get("password")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty()),
    ) else {
        return Err(fail(
            400,
            "Registration attempt with missing email or password.",
            Some("Email and password are required."),
        ));
    };
    if let Some(message) = first_error(password) {
        let message = match message {
            "At least 12 characters" => "Password must be at least 12 characters",
            "One uppercase letter" => "Password must contain at least one uppercase letter",
            "One lowercase letter" => "Password must contain at least one lowercase letter",
            "One number" => "Password must contain at least one number",
            _ => "Password must contain at least one special character",
        };
        return Err(fail(
            400,
            format!("Password validation failed for email {email}: {message}"),
            Some(message),
        ));
    }
    let failure = |e: &dyn std::fmt::Display| {
        server_error(
            format!("Registration failed: {e}"),
            "An unexpected error occurred during registration. Please try again.",
        )
    };
    if find_user_by_email(email)
        .await
        .map_err(|e| failure(&e))?
        .is_some()
    {
        return Err(fail(
            409,
            format!("Registration attempt with existing email: {email}."),
            None,
        ));
    }
    let hash = hash_password(password.to_string())
        .await
        .map_err(|e| failure(&e))?;
    let id = new_id();
    sqlx::query(
        r#"INSERT INTO "User" (id, email, "passwordHash", "apiKey") VALUES ($1, $2, $3, $4)"#,
    )
    .bind(&id)
    .bind(email)
    .bind(hash)
    .bind(uuid::Uuid::new_v4().to_string())
    .execute(pool())
    .await
    .map_err(|e| failure(&e))?;
    let user = find_user_by_id(&id)
        .await
        .map_err(|e| failure(&e))?
        .ok_or_else(|| failure(&"user missing after insert"))?;
    set_session(cx, &user, SameSite::Strict);
    Ok(redirect("/"))
}
