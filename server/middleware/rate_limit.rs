use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};

use topcoat::{
    context::Cx,
    router::request::{client_ip, headers},
};

use crate::server::utils::logging::plain;

#[derive(Clone, Copy)]
struct Profile {
    limit: u32,
    window: Duration,
}

const fn profile(limit: u32, millis: u64) -> Profile {
    Profile {
        limit,
        window: Duration::from_millis(millis),
    }
}

const DEFAULT: Profile = profile(50, 60_000);
const AUTH: Profile = profile(5, 1_800_000);
const EXTERNAL: Profile = profile(100, 30_000);
const STATS: Profile = profile(50, 60_000);
const IMPORT: Profile = profile(20, 1_800_000);
const PUBLIC: Profile = profile(50, 60_000);

const MAPPINGS: [(&str, Profile); 6] = [
    ("/api/auth", AUTH),
    ("/api/user/export", IMPORT),
    ("/api/external", EXTERNAL),
    ("/api/stats", STATS),
    ("/api/import", IMPORT),
    ("/api/public", PUBLIC),
];

struct Entry {
    count: u32,
    reset: Instant,
}

static STORE: LazyLock<Mutex<HashMap<String, Entry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub struct RateLimitHeaders {
    pub limit: u32,
    pub remaining: u32,
    pub reset_secs: u64,
}

fn profile_for(path: &str) -> Profile {
    MAPPINGS
        .iter()
        .find(|(prefix, _)| path.starts_with(prefix))
        .map(|(_, p)| *p)
        .unwrap_or(DEFAULT)
}

fn ip(cx: &Cx) -> String {
    headers(cx)
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(|v| v.trim().to_string())
        .or_else(|| client_ip(cx).map(|ip| ip.to_string()))
        .unwrap_or_default()
}

pub fn check(cx: &Cx, path: &str) -> topcoat::Result<Option<RateLimitHeaders>> {
    if !path.starts_with("/api") {
        return Ok(None);
    }
    let profile = profile_for(path);
    let key = format!("{}:{}", ip(cx), path);
    let now = Instant::now();
    let mut store = STORE.lock().unwrap();
    if store.len() > 10_000 {
        store.retain(|_, e| e.reset > now);
    }
    let entry = store.entry(key).or_insert(Entry {
        count: 0,
        reset: now + profile.window,
    });
    if now > entry.reset {
        entry.count = 0;
        entry.reset = now + profile.window;
    }
    if entry.count >= profile.limit {
        return Err(plain(429, "Too many requests, please try again later"));
    }
    entry.count += 1;
    Ok(Some(RateLimitHeaders {
        limit: profile.limit,
        remaining: profile.limit - entry.count,
        reset_secs: entry
            .reset
            .saturating_duration_since(now)
            .as_secs_f64()
            .ceil() as u64,
    }))
}
