use serde::Deserialize;
use serde_json::json;
use topcoat::{
    Result,
    context::Cx,
    cookie::{Cookie, Cookies, SameSite, cookies},
    router::{response::Response, route},
};

use crate::server::utils::{
    auth::{decrypt_user_id, read_cookie, set_session},
    config::config,
    db::{USER_COLS, User, find_user_by_email, new_id, pool},
    heartbeats::finalize_import,
    http_util::{CLIENT, no_store, query_map, redirect},
    logging::{fail, server_error},
};

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
}

#[derive(Deserialize)]
struct GithubUser {
    id: i64,
    login: String,
}

#[derive(Deserialize)]
struct GithubEmail {
    email: String,
    primary: bool,
}

fn clear(cx: &Cx, name: &str) {
    cookies(cx).remove(Cookie::build((name.to_string(), "")).path("/").build());
}

async fn merge_link(user_id: &str, gh: &GithubUser, token: &str) -> sqlx::Result<&'static str> {
    let mut tx = pool().begin().await?;
    let existing: Option<String> =
        sqlx::query_scalar(r#"SELECT id FROM "User" WHERE "githubId" = $1"#)
            .bind(gh.id.to_string())
            .fetch_optional(&mut *tx)
            .await?;
    let current: Option<Option<String>> =
        sqlx::query_scalar(r#"SELECT "githubId" FROM "User" WHERE id = $1"#)
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
            sqlx::query(r#"UPDATE "User" SET "githubId" = $1, "githubUsername" = $2, "githubAccessToken" = $3 WHERE id = $4"#)
                .bind(gh.id.to_string()).bind(&gh.login).bind(token).bind(user_id).execute(&mut *tx).await?;
            "/settings?success=accounts_merged"
        }
        _ if current.flatten().as_deref() == Some(gh.id.to_string().as_str()) => {
            sqlx::query(r#"UPDATE "User" SET "githubAccessToken" = $1 WHERE id = $2"#)
                .bind(token)
                .bind(user_id)
                .execute(&mut *tx)
                .await?;
            "/settings?success=github_updated"
        }
        _ => {
            sqlx::query(r#"UPDATE "User" SET "githubId" = $1, "githubUsername" = $2, "githubAccessToken" = $3 WHERE id = $4"#)
                .bind(gh.id.to_string()).bind(&gh.login).bind(token).bind(user_id).execute(&mut *tx).await?;
            "/settings?success=github_linked"
        }
    };
    tx.commit().await?;
    Ok(outcome)
}

enum Login {
    Ok(Box<User>),
    PasswordAccount,
}

async fn login_or_create(gh: &GithubUser, email: &str, token: &str) -> sqlx::Result<Login> {
    let mut tx = pool().begin().await?;
    let found: Option<User> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        r#"SELECT {USER_COLS} FROM "User" WHERE "githubId" = $1"#
    )))
    .bind(gh.id.to_string())
    .fetch_optional(&mut *tx)
    .await?;
    let user = if let Some(user) = found {
        sqlx::query_as(sqlx::AssertSqlSafe(format!(r#"UPDATE "User" SET "githubAccessToken" = $1, lastlogin = now() WHERE id = $2 RETURNING {USER_COLS}"#)))
            .bind(token).bind(&user.id).fetch_one(&mut *tx).await?
    } else if let Some(existing) = find_user_by_email(email).await? {
        if existing.password_hash.is_some() {
            return Ok(Login::PasswordAccount);
        }
        sqlx::query_as(sqlx::AssertSqlSafe(format!(r#"UPDATE "User" SET "githubId" = $1, "githubUsername" = $2, "githubAccessToken" = $3, lastlogin = now() WHERE id = $4 RETURNING {USER_COLS}"#)))
            .bind(gh.id.to_string()).bind(&gh.login).bind(token).bind(&existing.id).fetch_one(&mut *tx).await?
    } else {
        sqlx::query_as(sqlx::AssertSqlSafe(format!(r#"INSERT INTO "User" (id, email, "githubId", "githubUsername", "githubAccessToken", "apiKey", lastlogin) VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING {USER_COLS}"#)))
            .bind(new_id()).bind(email).bind(gh.id.to_string()).bind(&gh.login).bind(token).bind(uuid::Uuid::new_v4().to_string())
            .fetch_one(&mut *tx).await?
    };
    tx.commit().await?;
    Ok(Login::Ok(Box::new(user)))
}

#[route(GET "/api/auth/github/callback")]
pub async fn callback(cx: &Cx) -> Result<Response> {
    let query = query_map(cx);
    let Some(code) = query.get("code").filter(|c| !c.is_empty()) else {
        return Err(fail(
            400,
            "GitHub callback error: No authorization code provided.",
            None,
        ));
    };
    let state = query.get("state");
    let stored = read_cookie(cx, "github_oauth_state");
    if state.is_none() || state != stored.as_ref() {
        tracing::error!("GitHub Callback error: Invalid state");
        return Ok(redirect("/login?error=invalid_state"));
    }
    let linking = read_cookie(cx, "github_link_account").as_deref() == Some("true");
    let link_session = read_cookie(cx, "github_link_session");
    for name in [
        "github_oauth_state",
        "github_link_account",
        "github_link_session",
    ] {
        clear(cx, name);
    }

    let config = config();
    let failure = |detail: String| {
        server_error(
            format!("GitHub authentication failed: {detail}"),
            "GitHub authentication failed. Please try again.",
        )
    };

    let token: TokenResponse = CLIENT
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .json(&json!({
            "client_id": config.github_client_id,
            "client_secret": config.github_client_secret,
            "code": code,
            "redirect_uri": format!("{}/api/auth/github/callback", config.base_url),
        }))
        .send()
        .await
        .map_err(|e| failure(e.to_string()))?
        .json()
        .await
        .map_err(|e| failure(e.to_string()))?;
    let access = token.access_token;

    let get = |url: &str| {
        CLIENT
            .get(url)
            .bearer_auth(&access)
            .header("Accept", "application/vnd.github.v3+json")
    };
    let gh: GithubUser = get("https://api.github.com/user")
        .send()
        .await
        .map_err(|e| failure(e.to_string()))?
        .json()
        .await
        .map_err(|e| failure(e.to_string()))?;
    let emails: Vec<GithubEmail> = get("https://api.github.com/user/emails")
        .send()
        .await
        .map_err(|e| failure(e.to_string()))?
        .json()
        .await
        .map_err(|e| failure(e.to_string()))?;
    let Some(email) = emails
        .iter()
        .find(|e| e.primary)
        .or(emails.first())
        .map(|e| e.email.clone())
    else {
        return Err(server_error(
            format!(
                "GitHub callback error: No primary email found for GitHub user ID {}.",
                gh.id
            ),
            "Could not retrieve email from GitHub",
        ));
    };

    if linking {
        if let Some(user_id) = link_session.as_deref().and_then(decrypt_user_id) {
            return match merge_link(&user_id, &gh, &access).await {
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

    match login_or_create(&gh, &email, &access)
        .await
        .map_err(|e| failure(e.to_string()))?
    {
        Login::PasswordAccount => Ok(redirect("/login?error=account_exists_use_password")),
        Login::Ok(user) => {
            set_session(cx, &user, SameSite::Lax);
            Ok(no_store(redirect("/")))
        }
    }
}
