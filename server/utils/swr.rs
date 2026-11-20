use std::{
    future::Future,
    pin::Pin,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

use serde_json::Value;
use tokio::sync::{Mutex, RwLock};

type Loader = fn() -> Pin<Box<dyn Future<Output = topcoat::Result<Value>> + Send>>;

pub struct Swr {
    name: &'static str,
    ttl: Duration,
    load: Loader,
    slot: RwLock<Option<(Instant, Value)>>,
    flight: Mutex<()>,
    refreshing: AtomicBool,
}

impl Swr {
    pub const fn new(name: &'static str, ttl: Duration, load: Loader) -> Self {
        Self {
            name,
            ttl,
            load,
            slot: RwLock::const_new(None),
            flight: Mutex::const_new(()),
            refreshing: AtomicBool::new(false),
        }
    }

    async fn reload(&self) -> topcoat::Result<Value> {
        let started = Instant::now();
        let value = (self.load)().await?;
        *self.slot.write().await = Some((Instant::now(), value.clone()));
        tracing::debug!(
            cache = self.name,
            elapsed_ms = started.elapsed().as_millis() as u64,
            "cache refreshed"
        );
        Ok(value)
    }

    pub async fn refresh(&self) {
        if self.refreshing.swap(true, Ordering::AcqRel) {
            return;
        }
        if let Err(error) = self.reload().await {
            tracing::error!(cache = self.name, %error, "cache refresh failed");
        }
        self.refreshing.store(false, Ordering::Release);
    }

    pub async fn get(&'static self) -> topcoat::Result<Value> {
        if let Some((at, value)) = self.slot.read().await.clone() {
            if at.elapsed() >= self.ttl && !self.refreshing.load(Ordering::Acquire) {
                tokio::spawn(self.refresh());
            }
            return Ok(value);
        }
        let _flight = self.flight.lock().await;
        if let Some((_, value)) = self.slot.read().await.clone() {
            return Ok(value);
        }
        self.reload().await
    }

    pub fn keep_warm(&'static self) {
        tokio::spawn(async move {
            let every = self
                .ttl
                .saturating_sub(self.ttl / 5)
                .max(Duration::from_secs(10));
            loop {
                self.refresh().await;
                tokio::time::sleep(every).await;
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicUsize;

    use super::*;

    static LOADS: AtomicUsize = AtomicUsize::new(0);
    static CACHE: Swr = Swr::new("test", Duration::from_millis(80), || {
        Box::pin(async {
            tokio::time::sleep(Duration::from_millis(60)).await;
            Ok(Value::from(LOADS.fetch_add(1, Ordering::SeqCst) + 1))
        })
    });

    #[tokio::test]
    async fn loads_once_serves_stale_then_refreshes() {
        let (a, b, c) = tokio::join!(CACHE.get(), CACHE.get(), CACHE.get());
        assert_eq!(
            (a.unwrap(), b.unwrap(), c.unwrap()),
            (1.into(), 1.into(), 1.into())
        );
        assert_eq!(LOADS.load(Ordering::SeqCst), 1);

        let started = Instant::now();
        assert_eq!(CACHE.get().await.unwrap(), Value::from(1));
        assert!(started.elapsed() < Duration::from_millis(20));

        tokio::time::sleep(Duration::from_millis(100)).await;
        let started = Instant::now();
        assert_eq!(
            CACHE.get().await.unwrap(),
            Value::from(1),
            "stale value is served"
        );
        assert!(
            started.elapsed() < Duration::from_millis(20),
            "no waiting on refresh"
        );

        tokio::time::sleep(Duration::from_millis(120)).await;
        assert_eq!(CACHE.get().await.unwrap(), Value::from(2));
        assert_eq!(LOADS.load(Ordering::SeqCst), 2);
    }
}
