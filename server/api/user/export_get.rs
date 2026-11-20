use bytes::Bytes;
use futures::{StreamExt, stream};
use http::{
    StatusCode,
    header::{CACHE_CONTROL, CONTENT_DISPOSITION, CONTENT_TYPE, HeaderValue},
};
use http_body_util::StreamBody;
use serde_json::{Value, json};
use sqlx::FromRow;
use topcoat::{
    Result,
    context::Cx,
    router::{Body, response::Response, route},
};

use crate::server::utils::{
    db::pool,
    http_util::{auth_user, query_map},
    logging::fail,
};

const PAGE_SIZE: i64 = 5000;

#[derive(FromRow, Clone)]
struct Row {
    id: String,
    cursor: String,
    ts: String,
    project: Option<String>,
    editor: Option<String>,
    language: Option<String>,
    os: Option<String>,
    file: Option<String>,
    branch: Option<String>,
}

async fn page(user_id: &str, cursor_ts: &str, cursor_id: &str) -> sqlx::Result<Vec<Row>> {
    sqlx::query_as(
        r#"SELECT id, "timestamp"::text AS cursor,
                  to_char("timestamp" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ts,
                  project, editor, language, os, file, branch
           FROM "Heartbeats"
           WHERE "userId" = $1 AND ("timestamp", id) > ($2::timestamptz, $3)
           ORDER BY "timestamp", id LIMIT $4"#,
    )
    .bind(user_id)
    .bind(cursor_ts)
    .bind(cursor_id)
    .bind(PAGE_SIZE)
    .fetch_all(pool())
    .await
}

fn csv_cell(value: &Option<String>) -> String {
    match value {
        None => String::new(),
        Some(v) => {
            let v = if v.starts_with(['=', '+', '-', '@', '\t', '\r']) {
                format!("'{v}")
            } else {
                v.clone()
            };
            if v.contains(['"', ',', '\r', '\n']) {
                format!("\"{}\"", v.replace('"', "\"\""))
            } else {
                v
            }
        }
    }
}

fn pages(user_id: String) -> impl futures::Stream<Item = sqlx::Result<Vec<Row>>> {
    stream::try_unfold(
        Some(("-infinity".to_string(), String::new())),
        move |state| {
            let user_id = user_id.clone();
            async move {
                let Some((ts, id)) = state else {
                    return Ok(None);
                };
                let rows = page(&user_id, &ts, &id).await?;
                if rows.is_empty() {
                    return Ok(None);
                }
                let next = (rows.len() as i64 == PAGE_SIZE).then(|| {
                    let last = rows.last().unwrap();
                    (last.cursor.clone(), last.id.clone())
                });
                Ok(Some((rows, next)))
            }
        },
    )
}

#[derive(sqlx::FromRow)]
struct SummaryRow {
    date: String,
    summary: Value,
}

fn export_summary(row: SummaryRow) -> Value {
    let seconds = row.summary["totalSeconds"].as_f64().unwrap_or(0.0);
    json!({
        "date": row.date,
        "totalMinutes": (seconds / 60.0).round() as i64,
        "projects": row.summary["projects"],
        "languages": row.summary["languages"],
        "editors": row.summary["editors"],
        "os": row.summary["os"],
        "files": row.summary["files"],
        "branches": row.summary["branches"],
    })
}

type Chunk = Result<http_body::Frame<Bytes>, Box<dyn std::error::Error + Send + Sync>>;

fn frame(text: String) -> Chunk {
    Ok(http_body::Frame::data(Bytes::from(text)))
}

fn boxed(e: sqlx::Error) -> Box<dyn std::error::Error + Send + Sync> {
    tracing::error!("Export stream failed: {e}");
    Box::new(e)
}

#[route(GET "/api/user/export")]
pub async fn export(cx: &Cx) -> Result<Response> {
    let user = auth_user(cx)?;
    let format = query_map(cx)
        .get("format")
        .cloned()
        .unwrap_or_else(|| "json".into());
    if format != "json" && format != "csv" {
        return Err(fail(
            400,
            format!("Invalid export format requested by user {}", user.id),
            Some("Invalid export format"),
        ));
    }
    let user_id = user.id.clone();

    let body: std::pin::Pin<Box<dyn futures::Stream<Item = Chunk> + Send>> = if format == "csv" {
        let head = stream::once(async {
            frame("timestamp,project,editor,language,os,file,branch\n".to_string())
        });
        let rest = pages(user_id).map(|page| match page {
            Err(e) => Err(boxed(e)),
            Ok(rows) => frame(
                rows.iter()
                    .map(|r| {
                        format!(
                            "{},{},{},{},{},{},{}\n",
                            r.ts,
                            csv_cell(&r.project),
                            csv_cell(&r.editor),
                            csv_cell(&r.language),
                            csv_cell(&r.os),
                            csv_cell(&r.file),
                            csv_cell(&r.branch)
                        )
                    })
                    .collect(),
            ),
        });
        Box::pin(head.chain(rest))
    } else {
        let summaries: Vec<SummaryRow> = sqlx::query_as(
            "SELECT day::text AS date, summary FROM daily_summaries($1, '1970-01-01', (now() AT TIME ZONE 'UTC')::date) ORDER BY day",
        )
        .bind(&user_id)
        .fetch_all(pool())
        .await
        .map_err(|e| fail(69, format!("Export failed: {e}"), None))?;
        let summaries: Vec<Value> = summaries.into_iter().map(export_summary).collect();
        let user_json = json!({
            "id": user.id, "email": user.email, "githubUsername": user.github_username,
            "leaderboardEnabled": user.leaderboard_enabled,
        });
        let head = format!(
            "{{\"version\":1,\"exportedAt\":{},\"user\":{},\"summaries\":{},\"heartbeats\":[",
            Value::String(jiff::Timestamp::now().to_string()),
            user_json,
            Value::Array(summaries)
        );
        let first = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
        let head = stream::once(async move { frame(head) });
        let rest = pages(user_id).map(move |page| match page {
            Err(e) => Err(boxed(e)),
            Ok(rows) => {
                let mut chunk = String::new();
                for r in rows {
                    if !first.swap(false, std::sync::atomic::Ordering::Relaxed) {
                        chunk.push(',');
                    }
                    chunk.push_str(
                        &json!({
                            "timestamp": r.ts, "project": r.project, "editor": r.editor,
                            "language": r.language, "os": r.os, "file": r.file, "branch": r.branch,
                        })
                        .to_string(),
                    );
                }
                frame(chunk)
            }
        });
        Box::pin(
            head.chain(rest)
                .chain(stream::once(async { frame("]}".to_string()) })),
        )
    };

    let date = jiff::Timestamp::now()
        .to_zoned_datetime(jiff::tz::TimeZone::UTC)
        .date();
    let mut response = Response::new(Body::new(StreamBody::new(body)));
    *response.status_mut() = StatusCode::OK;
    let headers = response.headers_mut();
    let content_type = if format == "json" {
        "application/json; charset=utf-8"
    } else {
        "text/csv; charset=utf-8"
    };
    headers.insert(CONTENT_TYPE, HeaderValue::from_static(content_type));
    if let Ok(v) = HeaderValue::from_str(&format!(
        "attachment; filename=\"ziit-export-{date}.{format}\""
    )) {
        headers.insert(CONTENT_DISPOSITION, v);
    }
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}
