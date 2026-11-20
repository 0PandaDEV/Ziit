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
        password_rules::password_rules,
        ui::{button::button, icon::Icon, input::input},
    },
    layouts::navbar::navbar_layout,
};

#[page(
    "/register",
    with(meta("Ziit - Coding Statistics", "Track your coding time and productivity with Ziit", "/register")),
    with(PageMeta { class: "page-login", needs_tz: false })
)]
pub async fn register(cx: &Cx) -> Result<impl View> {
    Ok(view! {
        navbar_layout(
            <main>
                <div class="branding">
                    <h1 class="title">
                        <svg width="124" height="28" viewBox="0 0 124 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M29.32 -1.90735e-06L1.32 -1.90735e-06L1.32 5.6L18.12 5.6L1.32 28L29.32 28L29.32 22.4L12.5197 22.4L29.32 -1.90735e-06ZM60.44 5.6L60.44 -1.90735e-06L32.44 -1.90735e-06L32.44 5.6L43.64 5.6L43.64 22.4L32.44 22.4L32.44 28L60.44 28L60.44 22.4L49.24 22.4L49.24 5.6L60.44 5.6ZM92.04 5.6L92.04 -1.90735e-06L64.04 -1.90735e-06L64.04 5.6L75.24 5.6L75.24 22.4L64.04 22.4L64.04 28L92.04 28L92.04 22.4L80.84 22.4L80.84 5.6L92.04 5.6ZM94.72 -1.90735e-06L94.72 5.6L105.92 5.6L105.92 28L111.52 28L111.52 5.6L122.72 5.6L122.72 -1.90735e-06L94.72 -1.90735e-06Z" fill="#E6E6E6"></path>
                        </svg>
                    </h1>
                    <p class="description">
                        "Please create your account or "
                        <a (nav(cx, "/login"))><u>"Login"</u></a>
                    </p>
                </div>
                <form id="register-form" class="form" autocomplete="on" data-api="/api/auth/register" data-redirect="/">
                    input(name: "email", placeholder: "Email", input_type: "text", icon_name: Some(Icon::Mail))
                    <div class="password-field">
                        input(
                            name: "password",
                            placeholder: "Password",
                            input_type: "password",
                            icon_name: Some(Icon::KeyRound),
                            attrs: attributes! { data-rules="#register-rules" }
                        )
                        password_rules(id: "register-rules")
                    </div>
                </form>
                <div class="buttons">
                    button(
                        text: "Register",
                        key_name: "enter",
                        attrs: attributes! { type="submit" form="register-form" }
                    )
                    button(text: "Github", key_name: "g", href: "/api/auth/github")
                    button(text: "Epilogue", key_name: "e", href: "/api/auth/epilogue")
                </div>
            </main>
        )
    })
}
