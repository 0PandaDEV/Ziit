use topcoat::{
    Result,
    context::Cx,
    router::page,
    view::{View, attributes, view},
};

use crate::components::ui::nav::nav;
use crate::{
    app::{PageMeta, meta},
    components::{
        flash::flash,
        ui::{button::button, icon::Icon, input::input},
    },
    layouts::navbar::navbar_layout,
    server::utils::http_util::query_map,
};

pub fn error_message(code: &str) -> &'static str {
    match code {
        "invalid_state" => "Invalid authentication state, please try again",
        "no_code" => "No authorization code received",
        "no_email" => "No email address found in your GitHub account",
        "github_auth_failed" => "GitHub authentication failed",
        "epilogue_auth_failed" => "Epilogue authentication failed",
        "link_failed" => "Account linking failed, please try again",
        "account_exists_use_password" => {
            "An account with this email already exists. Log in with your password, then link GitHub from Settings."
        }
        "cancelled" => "Authentication was cancelled",
        "link_cancelled" => "Account linking was cancelled",
        _ => "Authentication error",
    }
}

#[page(
    "/login",
    with(meta("Ziit - Coding Statistics", "Track your coding time and productivity with Ziit", "/login")),
    with(PageMeta { class: "page-login", needs_tz: false })
)]
pub async fn login(cx: &Cx) -> Result<impl View> {
    let query = query_map(cx);
    let error = query.get("error").map(|c| error_message(c).to_string());
    let success = query.get("success").map(|c| {
        if c == "logout" {
            "Logged out successfully"
        } else {
            "Success"
        }
        .to_string()
    });
    Ok(view! {
        navbar_layout(
            <main>
                flash(message: error)
                flash(message: success, success: true)
                <div class="branding">
                    <h1 class="title"><svg width="124" height="28" viewBox="0 0 124 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M29.32 -1.90735e-06L1.32 -1.90735e-06L1.32 5.6L18.12 5.6L1.32 28L29.32 28L29.32 22.4L12.5197 22.4L29.32 -1.90735e-06ZM60.44 5.6L60.44 -1.90735e-06L32.44 -1.90735e-06L32.44 5.6L43.64 5.6L43.64 22.4L32.44 22.4L32.44 28L60.44 28L60.44 22.4L49.24 22.4L49.24 5.6L60.44 5.6ZM92.04 5.6L92.04 -1.90735e-06L64.04 -1.90735e-06L64.04 5.6L75.24 5.6L75.24 22.4L64.04 22.4L64.04 28L92.04 28L92.04 22.4L80.84 22.4L80.84 5.6L92.04 5.6ZM94.72 -1.90735e-06L94.72 5.6L105.92 5.6L105.92 28L111.52 28L111.52 5.6L122.72 5.6L122.72 -1.90735e-06L94.72 -1.90735e-06Z" fill="#E6E6E6"></path>
                        </svg></h1>
                    <p class="description">
                        "Please sign in to your account or "
                        <a (nav(cx, "/register"))><u>"Register"</u></a>
                    </p>
                </div>
                <form id="login-form" class="form" autocomplete="on" data-api="/api/auth/login" data-redirect="/">
                    input(name: "email", placeholder: "Email", input_type: "text", icon_name: Some(Icon::Mail))
                    input(name: "password", placeholder: "Password", input_type: "password", icon_name: Some(Icon::KeyRound))
                </form>
                <div class="buttons">
                    button(
                        text: "Login",
                        key_name: "enter",
                        attrs: attributes! { type="submit" form="login-form" }
                    )
                    button(text: "Github", key_name: "g", href: "/api/auth/github")
                    button(text: "Epilogue", key_name: "e", href: "/api/auth/epilogue")
                </div>
            </main>
        )
    })
}
