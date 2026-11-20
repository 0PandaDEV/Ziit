use std::fmt::{self, Display};

#[derive(Debug, Clone)]
pub struct ApiError {
    pub status: u16,
    pub message: String,
}

impl Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} {}", self.status, self.message)
    }
}

impl std::error::Error for ApiError {}

fn standard_message(status: u16) -> &'static str {
    match status {
        400 => "Invalid Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        413 => "Content Too Large",
        429 => "Too Many Requests",
        _ => "Server On Fire",
    }
}

pub fn handle_api_error(status: u16, detail: impl Display, frontend: Option<&str>) -> ApiError {
    let status = match status {
        400 | 401 | 403 | 404 | 409 | 413 | 429 => status,
        _ => 500,
    };
    tracing::error!(status, "{detail}");
    ApiError {
        status,
        message: frontend
            .unwrap_or_else(|| standard_message(status))
            .to_string(),
    }
}

pub fn fail(status: u16, detail: impl Display, frontend: Option<&str>) -> topcoat::Error {
    handle_api_error(status, detail, frontend).into()
}

pub fn server_error(detail: impl Display, frontend: &str) -> topcoat::Error {
    fail(69, detail, Some(frontend))
}

pub fn plain(status: u16, message: &str) -> topcoat::Error {
    ApiError {
        status,
        message: message.to_string(),
    }
    .into()
}
