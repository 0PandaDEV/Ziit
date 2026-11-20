use topcoat::{
    Result,
    asset::{AssetBundle, RouterBuilderAssetExt},
    context::{Cx, try_context},
    cookie::CookieLayer,
    metadata::Metadata,
    router::{
        Router, RouterBuilder, RouterBuilderDirectoryExt, RouterBuilderDiscoverExt, Slot, layout,
    },
    runtime::RuntimeLayer,
    view::{View, view},
};

use crate::components::ui::nav::nav;
use crate::server::utils::auth::AuthUser;

pub struct PageMeta {
    pub class: &'static str,
    pub needs_tz: bool,
}

const STYLES: [&str; 7] = [
    "base",
    "components",
    "admin",
    "index",
    "login",
    "settings",
    "stats",
];

const SCRIPTS: [&str; 10] = [
    "useLoading",
    "useToast",
    "useKeybind",
    "useApi",
    "useDialog",
    "usePasswordRules",
    "useImport",
    "useTimezone",
    "useRevalidate",
    "useRange",
];

pub fn meta(title: &'static str, description: &'static str, path: &'static str) -> Metadata {
    Metadata::new()
        .title(title)
        .description(description)
        .canonical(format!("https://ziit.app{path}"))
        .viewport("width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no")
        .theme_color("#191919")
}

const NAV_KEYS: [(&str, &str); 4] = [
    ("1", "/"),
    ("2", "/stats"),
    ("3", "/leaderboard"),
    ("4", "/settings"),
];

#[layout("/", with(Metadata::new().title("Ziit").viewport("width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no")))]
async fn root(cx: &Cx, slot: Slot<'_>) -> Result<impl View> {
    let page = try_context::<PageMeta>(cx);
    let class = page.map(|p| p.class).unwrap_or("");
    let needs_tz = page.is_some_and(|p| p.needs_tz);
    let signed_in = try_context::<AuthUser>(cx).is_some();
    Ok(view! {
        <!DOCTYPE html>
        <html lang="en">
            <head>
                topcoat::metadata::tags()
                <link rel="icon" type="image/ico" href="/favicon.ico">
                <link rel="manifest" href="/manifest.webmanifest">
                for style in STYLES {
                    <link rel="stylesheet" href=(format!("/styles/{style}.css"))>
                }
                topcoat::runtime::script()
                for script in SCRIPTS {
                    <script type="module" src=(format!("/js/{script}.js"))></script>
                }
            </head>
            <body>
                <div class="toast-container" id="toasts"></div>
                for (key, path) in NAV_KEYS {
                    <a (nav(cx, path)) data-key=(key) style="display:none" aria-hidden="true" tabindex="-1"></a>
                }
                if signed_in {
                    <a href="/api/auth/logout" data-key="Alt+L" style="display:none" aria-hidden="true" tabindex="-1"></a>
                }
                <div class=(class) style="display:contents" data-needs-tz=(needs_tz)>(slot)</div>
            </body>
        </html>
    })
}

pub fn router() -> RouterBuilder {
    Router::builder()
        .discover()
        .layer(CookieLayer::new())
        .serve_dir("/styles/{*file}", "./styles")
        .public_dir("./public")
        .assets(
            AssetBundle::load()
                .expect("asset bundle missing: run with `topcoat dev` or `topcoat asset bundle`"),
        )
        .layer(RuntimeLayer::new())
}
