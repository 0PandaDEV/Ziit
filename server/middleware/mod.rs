pub mod auth;
pub mod cors;
pub mod rate_limit;

use http::{
    Method, StatusCode,
    header::{CONTENT_TYPE, HeaderName, HeaderValue},
};
use topcoat::{
    Result,
    context::Cx,
    router::{
        Body, Next, layer,
        request::{method, uri},
        response::Response,
    },
};

use crate::server::utils::logging::ApiError;

fn api_error_response(error: &ApiError) -> Response {
    let body = serde_json::json!({
        "statusCode": error.status,
        "statusMessage": error.message,
        "message": error.message,
    });
    let mut response = Response::new(Body::from(body.to_string()));
    *response.status_mut() =
        StatusCode::from_u16(error.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    response
}

fn redirect_login() -> Response {
    let mut response = Response::new(Body::from(""));
    *response.status_mut() = StatusCode::FOUND;
    response
        .headers_mut()
        .insert("location", HeaderValue::from_static("/login"));
    response
}

fn insert(response: &mut Response, name: &'static str, value: String) {
    if let Ok(value) = HeaderValue::from_str(&value) {
        response
            .headers_mut()
            .insert(HeaderName::from_static(name), value);
    }
}

#[layer("/")]
pub async fn middleware(cx: &Cx, body: Body, next: Next<'_>) -> Result<Response> {
    let path = uri(cx).path().to_string();
    let is_api = path.starts_with("/api/");

    if is_api && method(cx) == Method::OPTIONS {
        let mut response = Response::new(Body::from(""));
        *response.status_mut() = StatusCode::NO_CONTENT;
        cors::apply(cx, &path, &mut response);
        return Ok(response);
    }

    let limits = rate_limit::check(cx, &path);
    let mut rate_headers = None;
    let mut response = match limits {
        Err(error) => error_to_response(error)?,
        Ok(headers) => match auth::check(cx, &path).await {
            auth::Outcome::Denied => {
                if is_api {
                    api_error_response(&ApiError {
                        status: 401,
                        message: "Unauthorized".into(),
                    })
                } else {
                    redirect_login()
                }
            }
            auth::Outcome::Allowed(user) => {
                rate_headers = headers;
                let result = match user {
                    Some(user) => next.run(&cx.with(*user), body).await,
                    None => next.run(cx, body).await,
                };
                match result {
                    Ok(response) => response,
                    Err(error) => error_to_response(error)?,
                }
            }
        },
    };
    if let Some(limits) = rate_headers {
        insert(&mut response, "x-ratelimit-limit", limits.limit.to_string());
        insert(
            &mut response,
            "x-ratelimit-remaining",
            limits.remaining.to_string(),
        );
        insert(
            &mut response,
            "x-ratelimit-reset",
            limits.reset_secs.to_string(),
        );
    }
    cors::apply(cx, &path, &mut response);
    Ok(response)
}

fn error_to_response(error: topcoat::Error) -> Result<Response> {
    match error.downcast_ref::<ApiError>() {
        Some(api) => Ok(api_error_response(api)),
        None => Err(error),
    }
}
