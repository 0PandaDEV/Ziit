use super::use_stats::TimeRange;

pub struct TimeRangeOption {
    pub label: &'static str,
    pub value: TimeRange,
    pub key: &'static str,
}

pub const TIME_RANGE_OPTIONS: [TimeRangeOption; 10] = [
    TimeRangeOption {
        label: "Today",
        value: TimeRange::Today,
        key: "D",
    },
    TimeRangeOption {
        label: "Yesterday",
        value: TimeRange::Yesterday,
        key: "E",
    },
    TimeRangeOption {
        label: "Last 7 Days",
        value: TimeRange::Week,
        key: "W",
    },
    TimeRangeOption {
        label: "Last 30 Days",
        value: TimeRange::Month,
        key: "T",
    },
    TimeRangeOption {
        label: "Last 90 Days",
        value: TimeRange::Last90Days,
        key: "N",
    },
    TimeRangeOption {
        label: "Month to Date",
        value: TimeRange::MonthToDate,
        key: "M",
    },
    TimeRangeOption {
        label: "Last Month",
        value: TimeRange::LastMonth,
        key: "P",
    },
    TimeRangeOption {
        label: "Year to Date",
        value: TimeRange::YearToDate,
        key: "Y",
    },
    TimeRangeOption {
        label: "Last 12 Months",
        value: TimeRange::Last12Months,
        key: "L",
    },
    TimeRangeOption {
        label: "All Time",
        value: TimeRange::AllTime,
        key: "A",
    },
];
