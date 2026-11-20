use std::{
    collections::HashMap,
    io::{BufReader, Read},
    path::PathBuf,
    sync::{
        Arc, LazyLock,
        atomic::{AtomicI64, AtomicU64, Ordering},
    },
    time::Duration,
};

use base64::{Engine, engine::general_purpose::STANDARD};
use futures::StreamExt;
use jiff::Timestamp;
use regex::Regex;
use serde::{
    Deserialize,
    de::{DeserializeSeed, Error as _, IgnoredAny, MapAccess, SeqAccess, Visitor},
};

use super::{
    heartbeats::{HeartbeatInput, process_heartbeats_by_date},
    import_queue::{ImportStatus, Update, update_job},
    url_policy::download_limited,
};

const MAX_DUMP_SIZE: usize = 2 * 1024 * 1024 * 1024;
const API: &str = "https://api.wakatime.com/api/v1";

#[derive(Debug, Clone, Deserialize)]
pub struct WakatimeHeartbeat {
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub entity: Option<String>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub project: Option<String>,
    #[serde(default)]
    pub user_agent_id: Option<String>,
    pub time: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WakatimeUser {
    pub last_plugin: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WakatimeDay {
    #[allow(dead_code)]
    pub date: String,
    #[serde(default)]
    pub heartbeats: Vec<WakatimeHeartbeat>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WakatimeUserAgent {
    pub id: String,
    pub editor: String,
    pub os: String,
}

#[derive(Deserialize)]
struct DumpList {
    data: Vec<DataDump>,
}

#[derive(Deserialize)]
struct DataDump {
    #[serde(rename = "type")]
    kind: String,
    status: String,
    percent_complete: f64,
    download_url: Option<String>,
}

#[derive(Deserialize)]
struct AgentPage {
    data: Vec<WakatimeUserAgent>,
    total_pages: u32,
}

pub fn basename(entity: &str) -> String {
    entity
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(entity)
        .to_string()
}

fn auth(api_key: &str) -> String {
    format!("Basic {}", STANDARD.encode(api_key))
}

fn err(e: impl std::fmt::Display) -> topcoat::Error {
    topcoat::Error::msg(e.to_string())
}

async fn create_data_dump_request(client: &reqwest::Client, api_key: &str) -> topcoat::Result<()> {
    let response = client
        .post(format!("{API}/users/current/data_dumps"))
        .header("Authorization", auth(api_key))
        .json(&serde_json::json!({ "type": "heartbeats", "email_when_finished": false }))
        .send()
        .await
        .map_err(err)?;
    if response.status().is_success() {
        return Ok(());
    }
    let status = response.status();
    let body: serde_json::Value = response.json().await.unwrap_or_default();
    if status.as_u16() == 400
        && body.get("error").and_then(|e| e.as_str())
            == Some("Wait for your current export to expire before creating another.")
    {
        return Ok(());
    }
    Err(err(format!("WakaTime data dump request failed: {status}")))
}

async fn poll_for_data_dump(
    client: &reqwest::Client,
    api_key: &str,
    job_id: &str,
) -> topcoat::Result<String> {
    for _ in 0..180 {
        let list: DumpList = client
            .get(format!("{API}/users/current/data_dumps"))
            .header("Authorization", auth(api_key))
            .send()
            .await
            .map_err(err)?
            .error_for_status()
            .map_err(err)?
            .json()
            .await
            .map_err(err)?;
        let dump = list
            .data
            .into_iter()
            .find(|d| d.kind == "heartbeats")
            .ok_or_else(|| err("No heartbeats dump found"))?;
        if dump.status == "Completed"
            && let Some(url) = dump.download_url
        {
            return Ok(url);
        }
        update_job(
            job_id,
            Update::progress(
                ImportStatus::WaitingForDataDump,
                dump.percent_complete as i64,
                100,
            ),
        );
        tokio::time::sleep(Duration::from_secs(10)).await;
    }
    Err(err("Data dump polling timed out after 10 minutes"))
}

async fn fetch_user_agents(
    client: &reqwest::Client,
    api_key: &str,
) -> topcoat::Result<HashMap<String, WakatimeUserAgent>> {
    let mut agents = HashMap::new();
    let mut page = 1;
    loop {
        let body: AgentPage = client
            .get(format!("{API}/users/current/user_agents?page={page}"))
            .header("Authorization", auth(api_key))
            .send()
            .await
            .map_err(err)?
            .error_for_status()
            .map_err(err)?
            .json()
            .await
            .map_err(err)?;
        for agent in body.data {
            agents.insert(agent.id.clone(), agent);
        }
        page += 1;
        if page > body.total_pages {
            return Ok(agents);
        }
    }
}

pub fn map_heartbeat(
    h: &WakatimeHeartbeat,
    agents: &HashMap<String, WakatimeUserAgent>,
    user_id: &str,
    last_plugin: Option<&str>,
) -> HeartbeatInput {
    let agent = agents.get(h.user_agent_id.as_deref().unwrap_or(""));
    let mut editor = agent
        .map(|a| a.editor.clone())
        .unwrap_or_else(|| "unknown".into());
    let mut os = agent
        .map(|a| a.os.clone())
        .unwrap_or_else(|| "unknown".into());
    if agent.is_none() {
        if let Some(id) = h.user_agent_id.as_deref().filter(|s| !s.is_empty()) {
            let parsed = parse_user_agent(id);
            if !parsed.editor.is_empty() {
                editor = parsed.editor;
            }
            if !parsed.os.is_empty() {
                os = parsed.os;
            }
        }
        if let Some(plugin) = last_plugin.filter(|s| !s.is_empty()) {
            let parsed = parse_user_agent(plugin);
            if !parsed.editor.is_empty() {
                editor = parsed.editor;
            }
            if !parsed.os.is_empty() {
                os = parsed.os;
            }
        }
    }
    HeartbeatInput {
        user_id: user_id.to_string(),
        timestamp: Timestamp::from_millisecond((h.time * 1000.0).round() as i64)
            .unwrap_or_else(|_| Timestamp::now()),
        project: h.project.clone().filter(|p| !p.is_empty()),
        editor: Some(editor),
        language: h.language.clone().filter(|l| !l.is_empty()),
        os: Some(os),
        file: h.entity.as_deref().filter(|e| !e.is_empty()).map(basename),
        branch: h.branch.clone().filter(|b| !b.is_empty()),
    }
}

pub struct ExportSource {
    pub reader: Box<dyn Read + Send>,
    pub size: u64,
    pub cleanup: Option<PathBuf>,
}

struct Counting<R> {
    inner: R,
    count: Arc<AtomicU64>,
}

impl<R: Read> Read for Counting<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let read = self.inner.read(buf)?;
        self.count.fetch_add(read as u64, Ordering::Relaxed);
        Ok(read)
    }
}

type Sink<'a> = &'a mut dyn FnMut(Option<Arc<str>>, WakatimeDay) -> bool;

struct Days<'a> {
    sink: Sink<'a>,
    last_plugin: Option<Arc<str>>,
}

impl<'de> DeserializeSeed<'de> for Days<'_> {
    type Value = ();

    fn deserialize<D: serde::Deserializer<'de>>(self, deserializer: D) -> Result<(), D::Error> {
        deserializer.deserialize_seq(self)
    }
}

impl<'de> Visitor<'de> for Days<'_> {
    type Value = ();

    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("a list of days")
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<(), A::Error> {
        while let Some(day) = seq.next_element::<WakatimeDay>()? {
            if day.heartbeats.is_empty() {
                continue;
            }
            if !(self.sink)(self.last_plugin.clone(), day) {
                return Err(A::Error::custom("import was stopped"));
            }
        }
        Ok(())
    }
}

struct Export<'a>(Sink<'a>);

impl<'de> Visitor<'de> for Export<'_> {
    type Value = ();

    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("a WakaTime export object")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<(), A::Error> {
        let sink = self.0;
        let mut last_plugin: Option<Arc<str>> = None;
        let mut seen_days = false;
        while let Some(key) = map.next_key::<String>()? {
            match key.as_str() {
                "user" => {
                    let user: WakatimeUser = map.next_value()?;
                    last_plugin = user.last_plugin.map(Arc::from);
                }
                "days" => {
                    map.next_value_seed(Days {
                        sink: &mut *sink,
                        last_plugin: last_plugin.clone(),
                    })?;
                    seen_days = true;
                }
                _ => {
                    map.next_value::<IgnoredAny>()?;
                }
            }
        }
        if seen_days {
            Ok(())
        } else {
            Err(A::Error::missing_field("days"))
        }
    }
}

pub fn stream_export<R: Read>(reader: R, sink: Sink) -> Result<(), String> {
    let invalid = |e: serde_json::Error| format!("Invalid WakaTime export format: {e}");
    let mut de = serde_json::Deserializer::from_reader(reader);
    serde::Deserializer::deserialize_map(&mut de, Export(sink)).map_err(invalid)?;
    de.end().map_err(invalid)
}

pub async fn import_stream(
    source: ExportSource,
    agents: HashMap<String, WakatimeUserAgent>,
    user_id: &str,
    job_id: &str,
) -> Result<i64, String> {
    let read = Arc::new(AtomicU64::new(0));
    let size = source.size.max(1);
    let counted = Counting {
        inner: source.reader,
        count: read.clone(),
    };
    let (tx, rx) = tokio::sync::mpsc::channel::<(Option<Arc<str>>, WakatimeDay)>(4);
    let parser = tokio::task::spawn_blocking(move || {
        let reader = BufReader::with_capacity(1024 * 1024, counted);
        stream_export(reader, &mut |plugin, day| {
            tx.blocking_send((plugin, day)).is_ok()
        })
    });
    update_job(
        job_id,
        Update::progress(ImportStatus::ProcessingHeartbeats, 0, 100),
    );
    let done = AtomicI64::new(0);
    let (agents, read, done) = (&agents, &read, &done);
    futures::stream::unfold(rx, |mut rx| async move { rx.recv().await.map(|v| (v, rx)) })
        .for_each_concurrent(4, |(plugin, day)| async move {
            let rows = day
                .heartbeats
                .iter()
                .map(|h| map_heartbeat(h, agents, user_id, plugin.as_deref()))
                .collect();
            process_heartbeats_by_date(user_id, rows).await;
            done.fetch_add(1, Ordering::Relaxed);
            let percent = (read.load(Ordering::Relaxed) * 100 / size).min(99) as i64;
            update_job(
                job_id,
                Update::progress(ImportStatus::ProcessingHeartbeats, percent, 100),
            );
        })
        .await;
    parser
        .await
        .map_err(|e| format!("Import parser crashed: {e}"))??;
    Ok(done.load(Ordering::Relaxed))
}

pub async fn handle_wakatime_import(
    api_key: &str,
    user_id: &str,
    job_id: &str,
) -> topcoat::Result<i64> {
    tracing::info!("[wakatime] Starting WakaTime API import for user {user_id}");
    let client = reqwest::Client::new();
    update_job(
        job_id,
        Update::status(ImportStatus::CreatingDataDumpRequest),
    );
    create_data_dump_request(&client, api_key).await?;
    update_job(job_id, Update::status(ImportStatus::WaitingForDataDump));
    let url = poll_for_data_dump(&client, api_key, job_id).await?;
    update_job(job_id, Update::status(ImportStatus::Downloading));
    let bytes = download_limited(&url, MAX_DUMP_SIZE, Duration::from_secs(30 * 60)).await?;
    update_job(job_id, Update::status(ImportStatus::FetchingMetadata));
    let agents = fetch_user_agents(&client, api_key).await?;
    let source = ExportSource {
        size: bytes.len() as u64,
        reader: Box::new(std::io::Cursor::new(bytes)),
        cleanup: None,
    };
    let total = import_stream(source, agents, user_id, job_id)
        .await
        .map_err(err)?;

    tracing::info!("[wakatime] Successfully imported {total} days from WakaTime API");
    Ok(total)
}

pub struct ParsedAgent {
    pub os: String,
    pub editor: String,
}

fn capitalize_editor(lower: &str, raw: &str) -> String {
    let mapped = match lower {
        "cursor" => "Cursor",
        "visual studio code" | "vscode" | "vs code" => "Visual Studio Code",
        "sublime text" => "Sublime Text",
        "atom" => "Atom",
        "vim" => "Vim",
        "neovim" | "nvim" => "NeoVim",
        "emacs" => "Emacs",
        "zed dev" => "Zed Preview",
        "pearai" => "PearAI",
        "intellij idea"
        | "intellij community edition"
        | "intellij ultimate edition"
        | "intellijidea" => "IntelliJ IDEA",
        "pycharm" => "PyCharm",
        "webstorm" => "WebStorm",
        "phpstorm" => "PhpStorm",
        "android studio" => "Android Studio",
        "xcode" => "Xcode",
        _ => "",
    };
    if !mapped.is_empty() {
        return mapped.to_string();
    }
    let mut out = String::with_capacity(raw.len());
    let mut prev_word = false;
    for ch in raw.chars() {
        let word = ch.is_alphanumeric() || ch == '_';
        if word && !prev_word {
            out.extend(ch.to_uppercase());
        } else {
            out.push(ch);
        }
        prev_word = word;
    }
    out
}

static GO_AGENT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\(([^)]+)\).*?go[\d.]+\s([A-Za-z ]+)/[\d.]+").unwrap());
static BROWSER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(Firefox|Chrome|Edge|Safari|Opera)/([\d.]+)").unwrap());
static PAREN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\(([^)]+)\)").unwrap());

pub fn parse_user_agent(user_agent: &str) -> ParsedAgent {
    let empty = || ParsedAgent {
        os: String::new(),
        editor: String::new(),
    };
    if user_agent.is_empty() {
        return empty();
    }
    if let Some(m) = GO_AGENT.captures(user_agent) {
        let raw_os = &m[1];
        let raw_editor = &m[2];
        let editor = capitalize_editor(&raw_editor.to_lowercase(), raw_editor);
        let os = if raw_os.contains("darwin") {
            "macOS"
        } else if raw_os.contains("linux") {
            "Linux"
        } else if raw_os.contains("windows") || raw_os.contains("win") {
            "Windows"
        } else {
            "Linux"
        };
        return ParsedAgent {
            os: os.into(),
            editor,
        };
    }
    if let Some(b) = BROWSER.captures(user_agent) {
        let raw = &b[1];
        let editor = capitalize_editor(&raw.to_lowercase(), raw);
        let mut os = "Unknown".to_string();
        if let Some(p) = PAREN.captures(user_agent) {
            let info = p[1].split(';').next().unwrap_or("").trim().to_string();
            os = if info.starts_with("Windows") {
                "Windows".into()
            } else if info.starts_with("Macintosh") {
                "macOS".into()
            } else if info.starts_with("X11") || info.starts_with("Linux") {
                "Linux".into()
            } else {
                info
            };
        } else if user_agent.to_lowercase().contains("windows") {
            os = "Windows".into();
        }
        return ParsedAgent { os, editor };
    }
    empty()
}
