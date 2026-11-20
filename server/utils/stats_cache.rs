use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};

use serde_json::Value;

const MAX_ENTRIES: usize = 256;
const MAX_AGE: Duration = Duration::from_secs(60 * 60);

type Key = (String, &'static str, i32);

static CACHE: LazyLock<Mutex<HashMap<Key, (Instant, Value)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn get(user_id: &str, range: &'static str, offset: i32) -> Option<(Value, Duration)> {
    let cache = CACHE.lock().unwrap();
    let (at, value) = cache.get(&(user_id.to_string(), range, offset))?;
    (at.elapsed() < MAX_AGE).then(|| (value.clone(), at.elapsed()))
}

pub fn put(user_id: &str, range: &'static str, offset: i32, value: &Value) {
    let mut cache = CACHE.lock().unwrap();
    if cache.len() >= MAX_ENTRIES {
        cache.retain(|_, (at, _)| at.elapsed() < MAX_AGE);
    }
    if cache.len() >= MAX_ENTRIES
        && let Some(oldest) = cache
            .iter()
            .min_by_key(|(_, (at, _))| *at)
            .map(|(k, _)| k.clone())
    {
        cache.remove(&oldest);
    }
    cache.insert(
        (user_id.to_string(), range, offset),
        (Instant::now(), value.clone()),
    );
}
