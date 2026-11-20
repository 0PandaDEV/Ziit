use topcoat::{
    Result,
    context::Cx,
    router::{response::Response, route},
};

use crate::server::utils::{auth::clear_session, http_util::redirect};

#[route(GET "/api/auth/logout")]
pub async fn logout(cx: &Cx) -> Result<Response> {
    clear_session(cx);
    Ok(redirect("/"))
}
