use pasetors::{
    claims::{Claims, ClaimsValidationRules},
    keys::SymmetricKey,
    local,
    token::UntrustedToken,
    version4::V4,
};
use serde_json::Value;
use topcoat::{
    context::Cx,
    cookie::{Cookie, Cookies, SameSite, cookies, time::Duration},
    router::request::headers,
};

use super::{config::config, db::User};

pub const SESSION_COOKIE: &str = "ziit_session";
const WEEK: i64 = 7 * 24 * 60 * 60;

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

pub fn encrypt_claims(user_id: &str, email: Option<&str>, ttl_secs: i64) -> Option<String> {
    let key = key()?;
    let mut claims = Claims::new().ok()?;
    claims.add_additional("userId", user_id).ok()?;
    if let Some(email) = email {
        claims.add_additional("email", email).ok()?;
    }
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

pub fn set_session(cx: &Cx, user: &User, same_site: SameSite) {
    let Some(token) = encrypt_claims(&user.id, Some(&user.email), WEEK) else {
        return;
    };
    cookies(cx).add(
        Cookie::build((SESSION_COOKIE, token))
            .path("/")
            .max_age(Duration::seconds(WEEK))
            .http_only(true)
            .secure(config().production)
            .same_site(same_site),
    );
}

pub fn clear_session(cx: &Cx) {
    cookies(cx).remove(Cookie::build((SESSION_COOKIE, "")).path("/").build());
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
