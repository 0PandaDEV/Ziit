mod app;
mod components;
mod composables;
mod layouts;
mod pages;

#[path = "../server/mod.rs"]
mod server;

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,sqlx=warn")),
        )
        .init();
    server::utils::config::init();
    server::utils::db::init().await;
    server::cron::start();

    let router = app::router().trusted_proxies(
        topcoat::router::TrustedProxies::new()
            .nearest(server::utils::config::config().trusted_proxy_hops),
    );
    topcoat::start(router.build()).await.unwrap();
}
