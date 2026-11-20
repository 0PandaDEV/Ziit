use std::{
    fs,
    time::{Duration, SystemTime},
};

use crate::server::api::import::chunks_root;

const MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

pub async fn run() {
    let _ = tokio::task::spawn_blocking(|| {
        let Ok(users) = fs::read_dir(chunks_root()) else {
            return;
        };
        for user in users.filter_map(|e| e.ok()) {
            let Ok(uploads) = fs::read_dir(user.path()) else {
                continue;
            };
            for upload in uploads.filter_map(|e| e.ok()) {
                let stale = upload
                    .metadata()
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|m| SystemTime::now().duration_since(m).ok())
                    .is_some_and(|age| age > MAX_AGE);
                if stale && upload.file_type().is_ok_and(|t| t.is_dir()) {
                    let _ = fs::remove_dir_all(upload.path());
                }
            }
        }
    })
    .await;
}
