use jiff::{Timestamp, civil::Date};

pub const TS_SELECT: &str = "YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"";

pub fn ts_expr(column: &str) -> String {
    format!("to_char({column} AT TIME ZONE 'UTC', '{TS_SELECT}')")
}

pub fn utc_today() -> Date {
    Timestamp::now()
        .to_zoned_datetime(jiff::tz::TimeZone::UTC)
        .date()
}

pub fn day_bounds(date: Date) -> (Timestamp, Timestamp) {
    let start = date
        .to_zoned_datetime(jiff::tz::TimeZone::UTC)
        .unwrap()
        .timestamp();
    let end = date
        .tomorrow()
        .unwrap()
        .to_zoned_datetime(jiff::tz::TimeZone::UTC)
        .unwrap()
        .timestamp();
    (start, end)
}

pub fn ts_to_utc_date(ts: Timestamp) -> Date {
    ts.to_zoned_datetime(jiff::tz::TimeZone::UTC).date()
}
