use serde::Deserialize;
use topcoat::{
    Result,
    context::Cx,
    cookie::{Cookie, Cookies, SameSite, cookies},
    router::{response::Response, route},
};

use crate::server::{
    api::auth::epilogue_get::{ISSUER, redirect_uri},
    utils::{
        auth::{SESSION_COOKIE, decrypt_user_id, read_cookie, session_user_id, set_session},
        config::config,
        db::{USER_COLS, User, new_id, pool},
        heartbeats::finalize_import,
        http_util::{CLIENT, no_store, query_map, redirect},
        logging::server_error,
    },
};

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
}

#[derive(Deserialize)]
struct EpilogueUser {
    #[serde(rename = "sub")]
    id: String,
    #[serde(rename = "preferred_username")]
    username: Option<String>,
    email: Option<String>,
}

async fn merge_link(user_id: &str, ep: &EpilogueUser) -> sqlx::Result<&'static str> {
    let mut tx = pool().begin().await?;
    let existing: Option<String> =
        sqlx::query_scalar(r#"SELECT id FROM "User" WHERE "epilogueId" = $1"#)
            .bind(&ep.id)
            .fetch_optional(&mut *tx)
            .await?;
    let current: Option<Option<String>> =
        sqlx::query_scalar(r#"SELECT "epilogueId" FROM "User" WHERE id = $1"#)
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await?;
    let outcome = match existing {
        Some(other) if other != user_id => {
            sqlx::query(r#"UPDATE "Heartbeats" SET "userId" = $1 WHERE "userId" = $2"#)
                .bind(user_id)
                .bind(&other)
                .execute(&mut *tx)
                .await?;
            sqlx::query(r#"DELETE FROM "User" WHERE id = $1"#)
                .bind(&other)
                .execute(&mut *tx)
                .await?;
            sqlx::query(
                r#"UPDATE "User" SET "epilogueId" = $1, "epilogueUsername" = $2 WHERE id = $3"#,
            )
            .bind(&ep.id)
            .bind(&ep.username)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
            "/settings?success=accounts_merged"
        }
        _ if current.flatten().as_deref() == Some(ep.id.as_str()) => {
            "/settings?success=epilogue_updated"
        }
        _ => {
            sqlx::query(
                r#"UPDATE "User" SET "epilogueId" = $1, "epilogueUsername" = $2 WHERE id = $3"#,
            )
            .bind(&ep.id)
            .bind(&ep.username)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
            "/settings?success=epilogue_linked"
        }
    };
    tx.commit().await?;
    Ok(outcome)
}

async fn login_or_create(ep: &EpilogueUser) -> sqlx::Result<User> {
    let mut tx = pool().begin().await?;
    let found: Option<User> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        r#"SELECT {USER_COLS} FROM "User" WHERE "epilogueId" = $1"#
    )))
    .bind(&ep.id)
    .fetch_optional(&mut *tx)
    .await?;
    let user = match found {
        None => {
            let email = ep
                .email
                .clone()
                .unwrap_or_else(|| format!("epilogue_{}@temp.ziit.app", ep.id));
            let username = ep
                .username
                .clone()
                .unwrap_or_else(|| format!("epilogue_user_{}", ep.id));
            sqlx::query_as(sqlx::AssertSqlSafe(format!(r#"INSERT INTO "User" (id, email, "epilogueId", "epilogueUsername", "apiKey") VALUES ($1, $2, $3, $4, $5) RETURNING {USER_COLS}"#)))
                .bind(new_id()).bind(email).bind(&ep.id).bind(username).bind(uuid::Uuid::new_v4().to_string())
                .fetch_one(&mut *tx).await?
        }
        Some(user) => {
            let username = ep
                .username
                .clone()
                .or(user.epilogue_username.clone())
                .unwrap_or_else(|| format!("epilogue_user_{}", ep.id));
            sqlx::query_as(sqlx::AssertSqlSafe(format!(
                r#"UPDATE "User" SET "epilogueUsername" = $1 WHERE id = $2 RETURNING {USER_COLS}"#
            )))
            .bind(username)
            .bind(&user.id)
            .fetch_one(&mut *tx)
            .await?
        }
    };
    tx.commit().await?;
    Ok(user)
}

#[route(GET "/api/auth/epilogue/callback")]
pub async fn callback(cx: &Cx) -> Result<Response> {
    let query = query_map(cx);
    let state = query.get("state");
    let stored = read_cookie(cx, "epilogue_oauth_state");
    if state.is_none() || state != stored.as_ref() {
        tracing::error!("Epilogue callback error: Invalid state");
        return Ok(redirect("/login?error=invalid_state"));
    }
    if query.get("iss").is_some_and(|iss| iss != ISSUER) {
        tracing::error!("Epilogue callback error: Invalid issuer");
        return Ok(redirect("/login?error=invalid_state"));
    }
    let verifier = read_cookie(cx, "epilogue_pkce");
    let linking = read_cookie(cx, "epilogue_link_account").as_deref() == Some("true");
    let link_session = read_cookie(cx, "epilogue_link_session");
    for name in [
        "epilogue_oauth_state",
        "epilogue_pkce",
        "epilogue_link_account",
        "epilogue_link_session",
    ] {
        cookies(cx).remove(Cookie::build((name, "")).secure(true).path("/").build());
    }

    let Some(code) = query.get("code").filter(|c| !c.is_empty()).cloned() else {
        return Ok(redirect(if linking {
            "/settings?error=link_cancelled"
        } else {
            "/login?error=cancelled"
        }));
    };
    let Some(verifier) = verifier else {
        return Ok(redirect("/login?error=invalid_state"));
    };

    let config = config();
    let failure = |detail: String| {
        server_error(
            format!("Epilogue authentication failed: {detail}"),
            "Epilogue authentication failed. Please try again.",
        )
    };

    let form = [
        ("grant_type", "authorization_code"),
        ("code", code.as_str()),
        ("redirect_uri", redirect_uri().as_str()),
        ("client_id", config.epilogue_app_id.as_str()),
        ("client_secret", config.epilogue_app_secret.as_str()),
        ("code_verifier", verifier.as_str()),
    ]
    .iter()
    .map(|(k, v)| format!("{k}={}", urlencoding::encode(v)))
    .collect::<Vec<_>>()
    .join("&");
    let token: TokenResponse = CLIENT
        .post(format!("{ISSUER}/oauth/token"))
        .header("content-type", "application/x-www-form-urlencoded")
        .body(form)
        .send()
        .await
        .map_err(|e| failure(e.to_string()))?
        .error_for_status()
        .map_err(|e| failure(e.to_string()))?
        .json()
        .await
        .map_err(|e| failure(e.to_string()))?;
    let ep: EpilogueUser = CLIENT
        .get(format!("{ISSUER}/oauth/userinfo"))
        .bearer_auth(&token.access_token)
        .send()
        .await
        .map_err(|e| failure(e.to_string()))?
        .error_for_status()
        .map_err(|e| failure(e.to_string()))?
        .json()
        .await
        .map_err(|_| {
            server_error(
                "Epilogue callback error: Invalid user data received",
                "Could not retrieve user information from Epilogue",
            )
        })?;
    if ep.id.is_empty() {
        return Err(server_error(
            "Epilogue callback error: Invalid user data received",
            "Could not retrieve user information from Epilogue",
        ));
    }

    if linking {
        let current = match read_cookie(cx, SESSION_COOKIE) {
            Some(session) => session_user_id(&session).await,
            None => None,
        };
        let bound = link_session.as_deref().and_then(decrypt_user_id);
        if let Some(user_id) = bound.filter(|id| current.as_deref() == Some(id.as_str())) {
            return match merge_link(&user_id, &ep).await {
                Ok(target) => {
                    if target.contains("accounts_merged") {
                        tokio::spawn(async move {
                            finalize_import(&user_id).await;
                        });
                    }
                    Ok(redirect(target))
                }
                Err(_) => Ok(redirect("/settings?error=link_failed")),
            };
        }
        return Ok(redirect("/settings?error=link_failed"));
    }

    let user = login_or_create(&ep)
        .await
        .map_err(|e| failure(e.to_string()))?;
    set_session(cx, &user, SameSite::Lax).await?;
    Ok(no_store(redirect("/")))
}
