use topcoat::context::Cx;

use crate::server::utils::{
    auth::{AuthUser, SESSION_COOKIE, clear_session, read_cookie, session_id},
    db::find_user_by_session,
};

const PUBLIC_API_PATHS: [&str; 4] = [
    "/api/external/",
    "/api/auth/",
    "/api/public/",
    "/api/leaderboard/",
];
const PUBLIC_PAGES: [&str; 7] = [
    "/stats",
    "/leaderboard",
    "/login",
    "/register",
    "/sitemap.xml",
    "/robots.txt",
    "/_openapi.json",
];

pub fn is_public_path(path: &str) -> bool {
    if path.starts_with("/_topcoat/") {
        return true;
    }
    if PUBLIC_API_PATHS.iter().any(|p| path.starts_with(p)) || PUBLIC_PAGES.contains(&path) {
        return true;
    }
    !path.starts_with("/api/")
        && path
            .rsplit('/')
            .next()
            .is_some_and(|last| last.contains('.'))
}

pub async fn current_user(cx: &Cx) -> Option<AuthUser> {
    let token = read_cookie(cx, SESSION_COOKIE)?;
    find_user_by_session(&session_id(&token))
        .await
        .ok()
        .flatten()
        .map(AuthUser)
}

pub enum Outcome {
    Allowed(Option<Box<AuthUser>>),
    Denied,
}

pub async fn check(cx: &Cx, path: &str) -> Outcome {
    let public = is_public_path(path);
    let has_cookie = read_cookie(cx, SESSION_COOKIE).is_some();
    if public {
        return Outcome::Allowed(if has_cookie {
            current_user(cx).await.map(Box::new)
        } else {
            None
        });
    }
    if !has_cookie {
        return Outcome::Denied;
    }
    match current_user(cx).await {
        Some(user) => Outcome::Allowed(Some(Box::new(user))),
        None => {
            clear_session(cx).await;
            Outcome::Denied
        }
    }
}
