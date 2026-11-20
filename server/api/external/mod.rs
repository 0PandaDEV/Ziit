pub mod batch_post;
pub mod heartbeat_post;
pub mod stats_get;
pub mod user_get;

use jiff::Timestamp;
use serde_json::Value;
use topcoat::context::Cx;

use crate::server::utils::{
    auth::{bearer, is_uuid},
    db::{User, find_user_by_api_key},
    heartbeats::HeartbeatInput,
    logging::{fail, server_error},
    normalize::{normalize_editor, normalize_language, normalize_os},
};

pub async fn api_key_user(
    cx: &Cx,
    label: &str,
    missing: Option<&str>,
    invalid: Option<&str>,
) -> topcoat::Result<User> {
    let Some(key) = bearer(cx) else {
        return Err(fail(
            401,
            format!("{label}: Missing or invalid API key format in header."),
            missing,
        ));
    };
    if !is_uuid(&key) {
        return Err(fail(
            401,
            format!("{label}: Invalid API key format."),
            invalid,
        ));
    }
    let user = find_user_by_api_key(&key)
        .await
        .map_err(|e| server_error(format!("{label}: {e}"), "Failed to process your request."))?;
    user.ok_or_else(|| fail(401, format!("{label}: Invalid API key."), None))
}

fn text(value: &Value, field: &str, min: usize, max: usize) -> Result<Option<String>, String> {
    match value.get(field) {
        None | Some(Value::Null) if min == 0 => Ok(None),
        Some(Value::String(s)) => {
            let len = s.chars().count();
            if s.contains('\0') {
                return Err(format!("{field}: invalid characters"));
            }
            if len < min || len > max {
                Err(format!("{field}: length must be between {min} and {max}"))
            } else {
                Ok(Some(s.clone()))
            }
        }
        _ => Err(format!("{field}: expected string")),
    }
}

pub fn parse_heartbeat(user_id: &str, value: &Value) -> Result<HeartbeatInput, String> {
    let timestamp = match value.get("timestamp") {
        Some(Value::Number(n)) => n
            .as_f64()
            .and_then(|ms| Timestamp::from_millisecond(ms as i64).ok())
            .ok_or("timestamp: out of range")?,
        Some(Value::String(s)) => s
            .parse::<Timestamp>()
            .map_err(|_| "timestamp: invalid datetime".to_string())?,
        _ => return Err("timestamp: expected iso datetime or number".into()),
    };
    let latest = Timestamp::now()
        .checked_add(jiff::SignedDuration::from_hours(24))
        .map_err(|e| e.to_string())?;
    let timestamp = timestamp.min(latest);
    let project = text(value, "project", 1, 255)?;
    let language = text(value, "language", 1, 50)?;
    let editor = text(value, "editor", 1, 50)?;
    let os = text(value, "os", 1, 50)?;
    let branch = text(value, "branch", 0, 255)?;
    let file = text(value, "file", 0, 255)?;
    if file.is_none() {
        return Err("file: expected string".into());
    }
    Ok(HeartbeatInput {
        user_id: user_id.to_string(),
        timestamp,
        project,
        language: language
            .as_deref()
            .and_then(|v| normalize_language(Some(v)).or(Some(v.to_string()))),
        editor: editor
            .as_deref()
            .and_then(|v| normalize_editor(Some(v)).or(Some(v.to_string()))),
        os: os
            .as_deref()
            .and_then(|v| normalize_os(Some(v)).or(Some(v.to_string()))),
        file,
        branch,
    })
}
