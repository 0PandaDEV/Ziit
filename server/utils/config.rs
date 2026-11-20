use std::sync::OnceLock;

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub paseto_key: String,
    pub admin_key: String,
    pub base_url: String,
    pub disable_registering: bool,
    pub github_client_id: String,
    pub github_client_secret: String,
    pub epilogue_app_id: String,
    pub epilogue_app_secret: String,
    pub production: bool,
}

static CONFIG: OnceLock<Config> = OnceLock::new();

fn var(name: &str) -> String {
    std::env::var(format!("ZIIT_{name}"))
        .or_else(|_| std::env::var(format!("NUXT_{name}")))
        .unwrap_or_default()
}

pub fn init() {
    let production = std::env::var("ZIIT_ENV")
        .or_else(|_| std::env::var("NODE_ENV"))
        .map(|v| v == "production")
        .unwrap_or(!cfg!(debug_assertions));
    let base_url = {
        let v = var("BASE_URL");
        if v.is_empty() { var("HOST") } else { v }
    };
    let config = Config {
        database_url: var("DATABASE_URL"),
        paseto_key: var("PASETO_KEY"),
        admin_key: var("ADMIN_KEY"),
        base_url: base_url.trim_end_matches('/').to_string(),
        disable_registering: var("DISABLE_REGISTRATION") == "true",
        github_client_id: var("GITHUB_CLIENT_ID"),
        github_client_secret: var("GITHUB_CLIENT_SECRET"),
        epilogue_app_id: var("EPILOGUE_APP_ID"),
        epilogue_app_secret: var("EPILOGUE_APP_SECRET"),
        production,
    };

    let missing: Vec<&str> = [
        ("ZIIT_DATABASE_URL", config.database_url.is_empty()),
        ("ZIIT_PASETO_KEY", config.paseto_key.is_empty()),
    ]
    .into_iter()
    .filter_map(|(name, empty)| empty.then_some(name))
    .collect();
    if !missing.is_empty() {
        eprintln!(
            "missing required environment variables: {}\ncopy .env.example to .env and fill them in",
            missing.join(", ")
        );
        std::process::exit(1);
    }
    let _ = CONFIG.set(config);
}

pub fn config() -> &'static Config {
    CONFIG.get().expect("config not initialised")
}
