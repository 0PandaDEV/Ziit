use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum TimeRange {
    #[default]
    #[serde(rename = "today")]
    Today,
    #[serde(rename = "yesterday")]
    Yesterday,
    #[serde(rename = "week")]
    Week,
    #[serde(rename = "month")]
    Month,
    #[serde(rename = "month-to-date")]
    MonthToDate,
    #[serde(rename = "last-month")]
    LastMonth,
    #[serde(rename = "last-90-days")]
    Last90Days,
    #[serde(rename = "year-to-date")]
    YearToDate,
    #[serde(rename = "last-12-months")]
    Last12Months,
    #[serde(rename = "all-time")]
    AllTime,
    #[serde(rename = "custom-range")]
    CustomRange,
}

pub const ALL_TIME_RANGES: [TimeRange; 11] = [
    TimeRange::Today,
    TimeRange::Yesterday,
    TimeRange::Week,
    TimeRange::Month,
    TimeRange::MonthToDate,
    TimeRange::LastMonth,
    TimeRange::Last90Days,
    TimeRange::YearToDate,
    TimeRange::Last12Months,
    TimeRange::AllTime,
    TimeRange::CustomRange,
];

impl TimeRange {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Today => "today",
            Self::Yesterday => "yesterday",
            Self::Week => "week",
            Self::Month => "month",
            Self::MonthToDate => "month-to-date",
            Self::LastMonth => "last-month",
            Self::Last90Days => "last-90-days",
            Self::YearToDate => "year-to-date",
            Self::Last12Months => "last-12-months",
            Self::AllTime => "all-time",
            Self::CustomRange => "custom-range",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        ALL_TIME_RANGES.into_iter().find(|r| r.as_str() == value)
    }

    pub fn as_db(self) -> String {
        self.as_str().to_uppercase().replace('-', "_")
    }

    pub fn valid_list() -> String {
        ALL_TIME_RANGES
            .iter()
            .map(|r| r.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    }
}

pub type StatRecord = BTreeMap<String, f64>;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HourlyData {
    pub seconds: f64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Summary {
    pub date: String,
    pub total_seconds: f64,
    pub projects: Option<StatRecord>,
    pub languages: Option<StatRecord>,
    pub editors: Option<StatRecord>,
    pub os: Option<StatRecord>,
    pub files: Option<StatRecord>,
    pub branches: Option<StatRecord>,
    pub hourly_data: Vec<HourlyData>,
}

#[derive(Debug, Clone, Default)]
pub struct StatsResult {
    pub total_seconds: f64,
    pub projects: StatRecord,
    pub languages: StatRecord,
    pub editors: StatRecord,
    pub os: StatRecord,
    pub files: StatRecord,
    pub branches: StatRecord,
    pub summaries: Vec<Summary>,
}

fn accumulate(target: &mut StatRecord, source: &Option<StatRecord>) {
    if let Some(source) = source {
        for (key, seconds) in source {
            *target.entry(key.clone()).or_insert(0.0) += seconds;
        }
    }
}

pub fn process_stats_response(value: &serde_json::Value) -> StatsResult {
    let summaries: Vec<Summary> = value
        .get("summaries")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let mut result = StatsResult::default();
    for day in &summaries {
        result.total_seconds += day.total_seconds;
        accumulate(&mut result.projects, &day.projects);
        accumulate(&mut result.languages, &day.languages);
        accumulate(&mut result.editors, &day.editors);
        accumulate(&mut result.os, &day.os);
        accumulate(&mut result.files, &day.files);
        accumulate(&mut result.branches, &day.branches);
    }
    result.summaries = summaries;
    result
}

pub fn format_time(seconds: f64) -> String {
    if seconds <= 0.0 {
        return "0h 0m".into();
    }
    let hours = (seconds / 3600.0).floor() as i64;
    let minutes = ((seconds % 3600.0) / 60.0).floor() as i64;
    format!("{hours}h {minutes}m")
}

pub fn sorted(record: &StatRecord) -> Vec<(String, f64)> {
    let mut items: Vec<(String, f64)> = record
        .iter()
        .map(|(k, v)| {
            (
                if k.is_empty() {
                    "Unknown".to_string()
                } else {
                    k.clone()
                },
                *v,
            )
        })
        .collect();
    items.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    items
}
