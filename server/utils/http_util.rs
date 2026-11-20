use std::collections::HashMap;

use http::{
    StatusCode,
    header::{CONTENT_TYPE, HeaderValue, LOCATION},
};
use serde::Serialize;
use topcoat::{
    context::{Cx, try_context},
    router::{Body, request::uri, response::Response},
};

use super::{auth::AuthUser, db::User, logging::plain};

pub fn json<T: Serialize>(value: &T) -> Response {
    let mut response = Response::new(Body::from(
        serde_json::to_string(value).unwrap_or_else(|_| "null".into()),
    ));
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    response
}

pub fn redirect(to: &str) -> Response {
    let mut response = Response::new(Body::from(""));
    *response.status_mut() = StatusCode::FOUND;
    if let Ok(value) = HeaderValue::from_str(to) {
        response.headers_mut().insert(LOCATION, value);
    }
    response
}

pub fn no_store(mut response: Response) -> Response {
    let headers = response.headers_mut();
    headers.insert(
        "cache-control",
        HeaderValue::from_static("no-cache, no-store, must-revalidate"),
    );
    headers.insert("pragma", HeaderValue::from_static("no-cache"));
    headers.insert("expires", HeaderValue::from_static("0"));
    response
}

pub fn query_map(cx: &Cx) -> HashMap<String, String> {
    let raw = uri(cx).query().unwrap_or("");
    reqwest::Url::parse(&format!("http://localhost/?{raw}"))
        .map(|u| {
            u.query_pairs()
                .map(|(k, v)| (k.into_owned(), v.into_owned()))
                .collect()
        })
        .unwrap_or_default()
}

pub fn auth_user(cx: &Cx) -> topcoat::Result<&User> {
    try_context::<AuthUser>(cx)
        .map(|u| &u.0)
        .ok_or_else(|| plain(401, "Unauthorized"))
}

pub fn valid_email(value: &str) -> bool {
    let Some((local, domain)) = value.rsplit_once('@') else {
        return false;
    };
    !local.is_empty()
        && !value.contains(char::is_whitespace)
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !domain.contains("..")
}

pub async fn hash_password(password: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || bcrypt::hash(password, 10))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

pub async fn verify_password(password: String, hash: String) -> bool {
    tokio::task::spawn_blocking(move || bcrypt::verify(password, &hash).unwrap_or(false))
        .await
        .unwrap_or(false)
}

pub static CLIENT: std::sync::LazyLock<reqwest::Client> = std::sync::LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent("ziit")
        .build()
        .expect("http client")
});
