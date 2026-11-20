pub mod chunk_post;
pub mod file_post;
pub mod index_get;
pub mod index_post;
pub mod status_get;

use std::path::PathBuf;

use crate::server::utils::{logging::fail, wakatime::WakatimeExportData};

pub fn assert_safe_file_id(file_id: &str) -> topcoat::Result<()> {
    let ok = !file_id.is_empty()
        && file_id.len() <= 128
        && file_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if ok {
        Ok(())
    } else {
        Err(fail(
            400,
            format!("Rejected import with invalid fileId: {file_id:?}"),
            Some("Invalid upload identifier."),
        ))
    }
}

pub fn chunks_dir(user_id: &str, file_id: &str) -> PathBuf {
    std::env::temp_dir()
        .join("ziit-chunks")
        .join(user_id)
        .join(file_id)
}

pub fn parse_export(bytes: &[u8]) -> Result<WakatimeExportData, String> {
    serde_json::from_slice(bytes).map_err(|e| format!("Invalid WakaTime export format: {e}"))
}
