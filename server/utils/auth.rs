use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use pasetors::{
    claims::{Claims, ClaimsValidationRules},
    keys::SymmetricKey,
    local,
    token::UntrustedToken,
    version4::V4,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use topcoat::{
    context::Cx,
    cookie::{Cookie, Cookies, SameSite, cookies, time::Duration},
    router::request::headers,
};

use super::{
    config::config,
    db::{User, pool},
};

pub const SESSION_COOKIE: &str = "ziit_session";
const WEEK: i64 = 7 * 24 * 60 * 60;
const MAX_SESSIONS: i64 = 20;

fn key() -> Option<SymmetricKey<V4>> {
    let raw = config().paseto_key.strip_prefix("k4.local.")?;
    let bytes = base64url_or_std(raw)?;
    SymmetricKey::<V4>::from(&bytes).ok()
}

fn base64url_or_std(value: &str) -> Option<Vec<u8>> {
    use base64::{Engine, engine::general_purpose};
    let trimmed = value.trim_end_matches('=');
    general_purpose::URL_SAFE_NO_PAD
        .decode(trimmed)
        .or_else(|_| general_purpose::STANDARD_NO_PAD.decode(trimmed))
        .ok()
}

pub fn encrypt_claims(user_id: &str, ttl_secs: i64) -> Option<String> {
    let key = key()?;
    let mut claims = Claims::new().ok()?;
    claims.add_additional("userId", user_id).ok()?;
    let exp = jiff::Timestamp::now()
        .checked_add(jiff::SignedDuration::from_secs(ttl_secs))
        .ok()?;
    claims.expiration(&exp.to_string()).ok()?;
    local::encrypt(&key, &claims, None, None).ok()
}

pub fn decrypt_user_id(token: &str) -> Option<String> {
    let key = key()?;
    let untrusted = UntrustedToken::<pasetors::Local, V4>::try_from(token)
        .inspect_err(|e| tracing::debug!("paseto parse failed: {e:?}"))
        .ok()?;
    let mut rules = ClaimsValidationRules::new();
    rules.disable_valid_at();
    let trusted = local::decrypt(&key, &untrusted, &rules, None, None)
        .inspect_err(|e| tracing::debug!("paseto decrypt failed: {e:?}"))
        .ok()?;
    let claims = trusted.payload_claims()?;
    let exp: jiff::Timestamp = claims
        .get_claim("exp")
        .and_then(Value::as_str)?
        .parse()
        .ok()?;
    if exp < jiff::Timestamp::now() {
        return None;
    }
    claims
        .get_claim("userId")
        .and_then(Value::as_str)
        .map(str::to_string)
}

pub fn session_id(token: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(token.as_bytes()))
}

fn new_session_token() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

pub async fn set_session(cx: &Cx, user: &User, same_site: SameSite) -> topcoat::Result<()> {
    let token = new_session_token();
    let fail = |e: sqlx::Error| topcoat::Error::msg(format!("Failed to create session: {e}"));
    sqlx::query(
        r#"DELETE FROM "Session" WHERE "userId" = $1 AND id NOT IN (
             SELECT id FROM "Session" WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT $2
           )"#,
    )
    .bind(&user.id)
    .bind(MAX_SESSIONS - 1)
    .execute(pool())
    .await
    .map_err(fail)?;
    sqlx::query(
        r#"INSERT INTO "Session" (id, "userId", "expiresAt") VALUES ($1, $2, now() + make_interval(secs => $3))"#,
    )
    .bind(session_id(&token))
    .bind(&user.id)
    .bind(WEEK as f64)
    .execute(pool())
    .await
    .map_err(fail)?;
    cookies(cx).add(
        Cookie::build((SESSION_COOKIE, token))
            .path("/")
            .max_age(Duration::seconds(WEEK))
            .http_only(true)
            .secure(config().production)
            .same_site(same_site),
    );
    Ok(())
}

pub async fn clear_session(cx: &Cx) {
    if let Some(token) = read_cookie(cx, SESSION_COOKIE) {
        let _ = sqlx::query(r#"DELETE FROM "Session" WHERE id = $1"#)
            .bind(session_id(&token))
            .execute(pool())
            .await;
    }
    cookies(cx).remove(Cookie::build((SESSION_COOKIE, "")).path("/").build());
}

pub async fn revoke_other_sessions(cx: &Cx, user_id: &str) -> sqlx::Result<()> {
    let keep = read_cookie(cx, SESSION_COOKIE)
        .map(|t| session_id(&t))
        .unwrap_or_default();
    sqlx::query(r#"DELETE FROM "Session" WHERE "userId" = $1 AND id <> $2"#)
        .bind(user_id)
        .bind(keep)
        .execute(pool())
        .await
        .map(|_| ())
}

pub async fn session_user_id(token: &str) -> Option<String> {
    sqlx::query_scalar(r#"SELECT "userId" FROM "Session" WHERE id = $1 AND "expiresAt" > now()"#)
        .bind(session_id(token))
        .fetch_optional(pool())
        .await
        .ok()
        .flatten()
}

pub fn short_cookie(cx: &Cx, name: &'static str, value: String) {
    cookies(cx).add(
        Cookie::build((name, value))
            .path("/")
            .max_age(Duration::seconds(600))
            .http_only(true)
            .secure(config().production)
            .same_site(SameSite::Lax),
    );
}

pub fn read_cookie(cx: &Cx, name: &str) -> Option<String> {
    cookies(cx).get(name).map(|c| c.value().to_string())
}

pub fn bearer(cx: &Cx) -> Option<String> {
    let value = headers(cx).get("authorization")?.to_str().ok()?;
    value.strip_prefix("Bearer ").map(str::to_string)
}

pub fn is_uuid(value: &str) -> bool {
    let b = value.as_bytes();
    b.len() == 36
        && b.iter().enumerate().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => *c == b'-',
            _ => c.is_ascii_hexdigit(),
        })
}

#[derive(Clone)]
pub struct AuthUser(pub User);
