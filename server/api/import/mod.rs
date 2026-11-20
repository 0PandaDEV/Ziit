pub mod chunk_post;
pub mod file_post;
pub mod index_get;
pub mod index_post;
pub mod status_get;

use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

use crate::server::utils::{logging::fail, wakatime::ExportSource};

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
    chunks_root().join(user_id).join(file_id)
}

const MAX_FILE_IMPORTS: usize = 2;

pub fn chunks_root() -> PathBuf {
    std::env::temp_dir().join("ziit-chunks")
}

fn ensure_one(path: &Path) -> std::io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if meta.permissions().mode() & 0o022 != 0 {
                    return Err(std::io::Error::other(
                        "chunk directory is writable by others",
                    ));
                }
            }
            Ok(())
        }
        Ok(_) => Err(std::io::Error::other(
            "unexpected non-directory in chunk path",
        )),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let mut builder = fs::DirBuilder::new();
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                builder.mode(0o700);
            }
            builder.create(path)
        }
        Err(e) => Err(e),
    }
}

pub fn ensure_dir(path: &Path) -> std::io::Result<()> {
    let root = chunks_root();
    let relative = path
        .strip_prefix(&root)
        .map_err(|_| std::io::Error::other("path outside chunk root"))?;
    let mut current = root;
    ensure_one(&current)?;
    for part in relative.components() {
        current.push(part);
        ensure_one(&current)?;
    }
    Ok(())
}

pub fn clean_file_name(name: &str) -> String {
    let cleaned: String = name.chars().filter(|c| !c.is_control()).take(255).collect();
    if cleaned.trim().is_empty() {
        "upload".into()
    } else {
        cleaned
    }
}

pub fn assert_import_capacity() -> topcoat::Result<()> {
    if crate::server::utils::import_queue::active_file_imports() >= MAX_FILE_IMPORTS {
        return Err(fail(
            429,
            "Too many file imports are being processed",
            Some("Too many imports in progress. Please try again in a few minutes."),
        ));
    }
    Ok(())
}

struct ChunkReader {
    paths: std::vec::IntoIter<PathBuf>,
    current: Option<fs::File>,
}

impl Read for ChunkReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        loop {
            if let Some(file) = &mut self.current {
                let read = file.read(buf)?;
                if read > 0 {
                    return Ok(read);
                }
                self.current = None;
            }
            match self.paths.next() {
                Some(path) => self.current = Some(fs::File::open(path)?),
                None => return Ok(0),
            }
        }
    }
}

pub fn open_chunks(dir: &Path) -> Result<ExportSource, String> {
    let mut chunks: Vec<(u64, PathBuf)> = fs::read_dir(dir)
        .map_err(|_| "Upload chunks are missing".to_string())?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let index = name.strip_prefix("chunk-")?.parse::<u64>().ok()?;
            Some((index, entry.path()))
        })
        .collect();
    chunks.sort_by_key(|(index, _)| *index);
    if chunks.is_empty()
        || chunks
            .iter()
            .enumerate()
            .any(|(position, (index, _))| *index != position as u64)
    {
        return Err("Upload is incomplete: missing chunks".into());
    }
    let size = chunks
        .iter()
        .filter_map(|(_, path)| fs::metadata(path).ok())
        .map(|meta| meta.len())
        .sum();
    Ok(ExportSource {
        reader: Box::new(ChunkReader {
            paths: chunks
                .into_iter()
                .map(|(_, path)| path)
                .collect::<Vec<_>>()
                .into_iter(),
            current: None,
        }),
        size,
        cleanup: Some(dir.to_path_buf()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::utils::wakatime::stream_export;

    const EXPORT: &str = r#"{"user":{"last_plugin":"vscode"},"range":{"start":0,"end":1},"days":[{"date":"2024-01-01","heartbeats":[{"time":1.0}]}]}"#;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ziit-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn run(dir: &Path) -> Result<Vec<(Option<String>, usize)>, String> {
        let source = open_chunks(dir)?;
        let mut days = Vec::new();
        stream_export(source.reader, &mut |plugin, day| {
            days.push((plugin.map(|p| p.to_string()), day.heartbeats.len()));
            true
        })?;
        Ok(days)
    }

    #[test]
    fn joins_chunks_in_order() {
        let dir = scratch("join");
        let (a, b) = EXPORT.split_at(40);
        fs::write(dir.join("chunk-1"), b).unwrap();
        fs::write(dir.join("chunk-0"), a).unwrap();
        assert_eq!(run(&dir).unwrap(), vec![(Some("vscode".into()), 1)]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn streams_days_when_user_comes_last() {
        let dir = scratch("order");
        fs::write(
            dir.join("chunk-0"),
            r#"{"days":[{"date":"a","heartbeats":[]},{"date":"b","heartbeats":[{"time":1.0},{"time":2.0}]}],"user":{"last_plugin":"x"}}"#,
        )
        .unwrap();
        assert_eq!(run(&dir).unwrap(), vec![(None, 2)]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_missing_chunk_and_garbage() {
        let dir = scratch("gap");
        fs::write(dir.join("chunk-0"), &EXPORT[..40]).unwrap();
        fs::write(dir.join("chunk-2"), &EXPORT[40..]).unwrap();
        assert!(run(&dir).is_err());
        fs::write(dir.join("chunk-1"), "").unwrap();
        fs::write(dir.join("chunk-2"), "not json").unwrap();
        assert!(run(&dir).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_missing_days_and_trailing_data() {
        let dir = scratch("shape");
        fs::write(dir.join("chunk-0"), r#"{"user":{"last_plugin":null}}"#).unwrap();
        assert!(run(&dir).is_err());
        fs::write(dir.join("chunk-0"), format!("{EXPORT} []")).unwrap();
        assert!(run(&dir).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_deeply_nested_json() {
        let dir = scratch("deep");
        fs::write(dir.join("chunk-0"), "[".repeat(100_000)).unwrap();
        assert!(run(&dir).is_err());
        fs::write(
            dir.join("chunk-0"),
            format!(r#"{{"days":{}}}"#, "[".repeat(100_000)),
        )
        .unwrap();
        assert!(run(&dir).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sanitizes_names_and_ids() {
        assert_eq!(clean_file_name("a\u{0}b\nc"), "abc");
        assert_eq!(clean_file_name("\n"), "upload");
        assert!(assert_safe_file_id("../etc").is_err());
        assert!(assert_safe_file_id("ok-id_1").is_ok());
    }
}
