use http::header::{HeaderName, HeaderValue};
use topcoat::{
    context::Cx,
    router::{request::headers, response::Response},
};

use crate::server::utils::config::config;

fn set(response: &mut Response, name: &'static str, value: &str) {
    if let Ok(value) = HeaderValue::from_str(value) {
        response
            .headers_mut()
            .insert(HeaderName::from_static(name), value);
    }
}

pub fn apply(cx: &Cx, path: &str, response: &mut Response) {
    if path.starts_with("/api/") {
        if path.starts_with("/api/external/") {
            set(
                response,
                "access-control-allow-origin",
                "vscode-webview://*",
            );
            set(response, "access-control-allow-methods", "POST");
            set(
                response,
                "access-control-allow-headers",
                "authorization,content-type",
            );
            set(response, "access-control-allow-credentials", "true");
        } else {
            let origin = headers(cx)
                .get("origin")
                .and_then(|v| v.to_str().ok())
                .map(str::to_string)
                .or_else(|| Some(config().base_url.clone()).filter(|b| !b.is_empty()))
                .unwrap_or_default();
            set(response, "access-control-allow-origin", &origin);
            set(response, "access-control-allow-methods", "GET,POST,OPTIONS");
            set(
                response,
                "access-control-allow-headers",
                "authorization,content-type",
            );
            set(response, "access-control-allow-credentials", "true");
        }
    }
    set(response, "x-frame-options", "DENY");
    set(response, "x-content-type-options", "nosniff");
    set(response, "x-xss-protection", "1; mode=block");
    set(
        response,
        "permissions-policy",
        "camera=(), microphone=(), geolocation=()",
    );
    if config().production {
        set(
            response,
            "strict-transport-security",
            "max-age=31536000; includeSubDomains; preload",
        );
    }
}
