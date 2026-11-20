use jiff::civil::Date;
use topcoat::{
    Result,
    context::Cx,
    view::{View, component, view},
};

use crate::composables::use_stats::{StatsResult, TimeRange};

const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

fn month_name(date: Date) -> &'static str {
    MONTHS[(date.month() - 1) as usize]
}

fn date_label(date: Date) -> String {
    format!("{} {}", date.day(), month_name(date))
}

fn month_year_label(date: Date) -> String {
    format!("{} {:02}'", month_name(date), date.year() % 100)
}

fn parse(date: &str) -> Option<Date> {
    date.parse().ok()
}

fn days_between(start: Date, end: Date) -> Vec<Date> {
    let mut days = Vec::new();
    let mut current = start;
    while current <= end {
        days.push(current);
        match current.tomorrow() {
            Ok(next) => current = next,
            Err(_) => break,
        }
    }
    days
}

fn per_day(stats: &StatsResult, days: &[Date]) -> (Vec<String>, Vec<f64>) {
    let labels: Vec<String> = days.iter().map(|d| date_label(*d)).collect();
    let mut data = vec![0.0; labels.len()];
    for summary in &stats.summaries {
        let Some(date) = parse(&summary.date) else {
            continue;
        };
        if let Some(index) = labels.iter().position(|l| *l == date_label(date)) {
            data[index] += summary.total_seconds / 3600.0;
        }
    }
    (labels, data)
}

fn month_labels_back(today: Date, count: i32) -> Vec<&'static str> {
    (0..count)
        .rev()
        .map(|i| MONTHS[(((today.month() as i32 - 1 - i) % 12 + 12) % 12) as usize])
        .collect()
}

fn monthly(stats: &StatsResult, labels: Vec<&'static str>) -> (Vec<String>, Vec<f64>) {
    let mut data = vec![0.0; labels.len()];
    for summary in &stats.summaries {
        let Some(date) = parse(&summary.date) else {
            continue;
        };
        if let Some(index) = labels.iter().position(|l| *l == month_name(date)) {
            data[index] += summary.total_seconds / 3600.0;
        }
    }
    (labels.into_iter().map(String::from).collect(), data)
}

pub fn chart_config(range: TimeRange, stats: &StatsResult, today: Date) -> (Vec<String>, Vec<f64>) {
    match range {
        TimeRange::Today | TimeRange::Yesterday => {
            let labels = (0..24).map(|h| format!("{h:02}:00")).collect();
            let mut data = vec![0.0; 24];
            if let Some(summary) = stats.summaries.first() {
                for (hour, slot) in data.iter_mut().enumerate() {
                    *slot = summary
                        .hourly_data
                        .get(hour)
                        .map(|h| h.seconds / 3600.0)
                        .unwrap_or(0.0);
                }
            }
            (labels, data)
        }
        TimeRange::Week => per_day(
            stats,
            &days_between(
                today
                    .checked_sub(jiff::Span::new().days(6))
                    .unwrap_or(today),
                today,
            ),
        ),
        TimeRange::Month | TimeRange::Last90Days => {
            let back = if range == TimeRange::Month { 29 } else { 89 };
            per_day(
                stats,
                &days_between(
                    today
                        .checked_sub(jiff::Span::new().days(back))
                        .unwrap_or(today),
                    today,
                ),
            )
        }
        TimeRange::MonthToDate => per_day(stats, &days_between(today.first_of_month(), today)),
        TimeRange::LastMonth => {
            let last_end = today.first_of_month().yesterday().unwrap_or(today);
            per_day(stats, &days_between(last_end.first_of_month(), last_end))
        }
        TimeRange::YearToDate => monthly(stats, month_labels_back(today, today.month() as i32)),
        TimeRange::Last12Months => monthly(stats, month_labels_back(today, 12)),
        TimeRange::AllTime => {
            let dates: Vec<Date> = stats
                .summaries
                .iter()
                .filter_map(|s| parse(&s.date))
                .collect();
            if let (Some(min), Some(max)) =
                (dates.iter().min().copied(), dates.iter().max().copied())
                && max.year() - min.year() > 0
            {
                let mut labels = Vec::new();
                let mut cursor = min.first_of_month();
                while cursor <= max {
                    labels.push(month_year_label(cursor));
                    match cursor.checked_add(jiff::Span::new().months(1)) {
                        Ok(next) => cursor = next,
                        Err(_) => break,
                    }
                }
                let mut data = vec![0.0; labels.len()];
                for summary in &stats.summaries {
                    let Some(date) = parse(&summary.date) else {
                        continue;
                    };
                    if let Some(index) = labels.iter().position(|l| *l == month_year_label(date)) {
                        data[index] += summary.total_seconds / 3600.0;
                    }
                }
                return (labels, data);
            }
            monthly(stats, month_labels_back(today, 12))
        }
        TimeRange::CustomRange => per_day(
            stats,
            &days_between(
                today
                    .checked_sub(jiff::Span::new().days(29))
                    .unwrap_or(today),
                today,
            ),
        ),
    }
}

fn duration_label(hours: f64) -> String {
    let whole = hours.floor() as i64;
    let minutes = ((hours - whole as f64) * 60.0).round() as i64;
    if whole == 0 {
        if minutes > 0 {
            format!("{minutes}m")
        } else {
            "0h".into()
        }
    } else if minutes > 0 {
        format!("{whole}h {minutes}m")
    } else {
        format!("{whole}h")
    }
}

fn tooltip_label(hours: f64) -> String {
    let whole = hours.floor() as i64;
    let minutes = ((hours - whole as f64) * 60.0).round() as i64;
    format!(
        "{whole}h {}",
        if minutes > 0 {
            format!("{minutes}m")
        } else {
            String::new()
        }
    )
}

fn nice_num(range: f64) -> f64 {
    let rounded = range.round();
    let range = if (range - rounded).abs() < range / 1000.0 {
        rounded
    } else {
        range
    };
    let nice_range = 10f64.powf(range.log10().floor());
    let fraction = range / nice_range;
    let nice_fraction = if fraction <= 1.0 {
        1.0
    } else if fraction <= 2.0 {
        2.0
    } else if fraction <= 5.0 {
        5.0
    } else {
        10.0
    };
    nice_fraction * nice_range
}

fn decimal_places(x: f64) -> i32 {
    let mut e = 1.0;
    let mut p = 0;
    while (x * e).round() / e != x && p < 15 {
        e *= 10.0;
        p += 1;
    }
    p
}

const MAX_TICKS: usize = 11;

fn linear_ticks(data_max: f64) -> Vec<f64> {
    let rmax = if data_max <= 0.0 { 1.0 } else { data_max };
    let max_spaces = (MAX_TICKS - 1) as f64;
    let mut spacing = nice_num(rmax / max_spaces);
    let mut num_spaces = (rmax / spacing).ceil();
    if num_spaces > max_spaces {
        spacing = nice_num(num_spaces * spacing / max_spaces);
    }
    let nice_max = (rmax / spacing).ceil() * spacing;
    num_spaces = nice_max / spacing;
    num_spaces = if (num_spaces - num_spaces.round()).abs() < spacing / 1000.0 {
        num_spaces.round()
    } else {
        num_spaces.ceil()
    };
    let factor = 10f64.powi(decimal_places(spacing));
    let nice_max = (nice_max * factor).round() / factor;
    let mut ticks: Vec<f64> = (0..num_spaces as usize)
        .map(|j| (j as f64 * spacing * factor).round() / factor)
        .collect();
    ticks.push(nice_max);
    ticks
}

const CHAR_WIDTH: f64 = 7.0;
const LABEL_CHAR_WIDTH: f64 = 7.3;
const TIERS: [f64; 3] = [308.0, 1198.0, 1838.0];

fn skip_for(count: usize, label_width: f64, chart_width: f64) -> usize {
    if count <= 1 {
        return 1;
    }
    let slot = (chart_width - 64.0).max(1.0) / (count - 1) as f64;
    ((label_width * 1.5 + 14.0) / slot).ceil().max(1.0) as usize
}

struct Tick {
    pct: f64,
    label: String,
}

struct Label {
    pct: f64,
    text: String,
    class: String,
}

struct Column {
    left: f64,
    width: f64,
    x: f64,
    y: f64,
    title: String,
    value: String,
    align: String,
}

const PLOT_TOP: f64 = 15.2;
const PLOT_HEIGHT: f64 = 272.4;
const CHART_HEIGHT: f64 = 316.0;
const TIP_HEIGHT: f64 = 64.0;

fn tooltip_align(x_pct: f64, y_pct: f64) -> String {
    let y = PLOT_TOP + (100.0 - y_pct) / 100.0 * PLOT_HEIGHT;
    let edge = if x_pct < 4.0 {
        " start"
    } else if x_pct > 96.0 {
        " end"
    } else {
        ""
    };
    if y < TIP_HEIGHT / 2.0 {
        format!("below{edge}")
    } else if y > CHART_HEIGHT - TIP_HEIGHT / 2.0 {
        format!("above{edge}")
    } else if x_pct <= 50.0 {
        "right-of".into()
    } else {
        "left-of".into()
    }
}

#[component]
pub async fn line_chart(cx: &Cx, labels: &[String], data: &[f64]) -> Result<impl View> {
    let count = labels.len();
    let data_max = data.iter().cloned().fold(0.0_f64, f64::max);
    let tick_values = linear_ticks(data_max);
    let top = tick_values.last().copied().unwrap_or(1.0);
    let x_of = |i: usize| {
        if count <= 1 {
            50.0
        } else {
            i as f64 / (count - 1) as f64 * 100.0
        }
    };
    let y_of = |v: f64| v / top * 100.0;

    let ticks: Vec<Tick> = tick_values
        .iter()
        .map(|v| Tick {
            pct: y_of(*v),
            label: duration_label(*v),
        })
        .collect();
    let widest = ticks
        .iter()
        .map(|t| t.label.chars().count())
        .max()
        .unwrap_or(1) as f64
        * CHAR_WIDTH;
    let left = widest.ceil() + 16.0;

    let label_width =
        labels.iter().map(|l| l.chars().count()).max().unwrap_or(0) as f64 * LABEL_CHAR_WIDTH;
    let skips = TIERS.map(|w| skip_for(count, label_width, w));
    let x_labels: Vec<Label> = labels
        .iter()
        .enumerate()
        .filter_map(|(i, text)| {
            let from_end = count - 1 - i;
            let visible: Vec<&str> = ["m", "d", "w"]
                .into_iter()
                .zip(skips)
                .filter(|(_, skip)| from_end.is_multiple_of(*skip))
                .map(|(tier, _)| tier)
                .collect();
            if visible.is_empty() {
                return None;
            }
            let position = if i == 0 {
                " first"
            } else if i + 1 == count {
                " last"
            } else {
                ""
            };
            Some(Label {
                pct: x_of(i),
                text: text.clone(),
                class: format!(
                    "{}{position}",
                    visible
                        .iter()
                        .map(|t| format!("s-{t}"))
                        .collect::<Vec<_>>()
                        .join(" ")
                ),
            })
        })
        .collect();

    let points: Vec<(f64, f64)> = data
        .iter()
        .enumerate()
        .map(|(i, v)| (x_of(i), 100.0 - y_of(*v)))
        .collect();
    let line: String = points
        .iter()
        .enumerate()
        .map(|(i, (x, y))| format!("{}{x:.3},{y:.3}", if i == 0 { "M" } else { "L" }))
        .collect::<Vec<_>>()
        .join(" ");
    let area = match (points.first(), points.last()) {
        (Some((first, _)), Some((last, _))) => format!("{line} L{last:.3},100 L{first:.3},100 Z"),
        _ => String::new(),
    };

    let column_width = if count > 1 {
        100.0 / (count - 1) as f64
    } else {
        100.0
    };
    let columns: Vec<Column> = data
        .iter()
        .enumerate()
        .map(|(i, v)| {
            let x = x_of(i);
            Column {
                left: x - column_width / 2.0,
                width: column_width,
                x,
                y: y_of(*v),
                title: labels[i].clone(),
                value: tooltip_label(*v),
                align: tooltip_align(x, y_of(*v)),
            }
        })
        .collect();

    Ok(view! {
        <div class="line-chart" style=(format!("--left:{left}px")) role="img" aria-label="Coding time chart">
            <div class="y-axis">
                for tick in &ticks {
                    <span style=(format!("bottom:{:.3}%", tick.pct))>(&tick.label)</span>
                }
            </div>
            <div class="plot">
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                    <path class="area" d=(area)></path>
                    <path class="line" d=(line)></path>
                </svg>
                for tick in &ticks {
                    <span class="grid" style=(format!("bottom:{:.3}%", tick.pct))></span>
                }
                for column in columns {
                    <div class="col" style=(format!("left:{:.3}%;width:{:.3}%", column.left, column.width))>
                        <span class="dot" style=(format!("left:{:.3}%;bottom:{:.3}%", (column.x - column.left) / column.width * 100.0, column.y))></span>
                        <div class=(format!("tip {}", column.align)) style=(format!("top:{:.3}%", 100.0 - column.y))>
                            <b>(column.title)</b>
                            <span>(column.value)</span>
                        </div>
                    </div>
                }
            </div>
            <div class="x-axis">
                for label in x_labels {
                    <span class=(label.class) style=(format!("left:{:.3}%", label.pct))>(label.text)</span>
                }
            </div>
        </div>
    })
}
