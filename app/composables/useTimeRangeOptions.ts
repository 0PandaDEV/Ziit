import { computed } from "vue";

export function useTimeRangeOptions() {
  const timeRangeOptions = computed(() => [
    { label: "Today", value: "today" as TimeRange, key: "D" },
    { label: "Yesterday", value: "yesterday" as TimeRange, key: "E" },
    { label: "Last 7 Days", value: "week" as TimeRange, key: "W" },
    { label: "Last 30 Days", value: "month" as TimeRange, key: "T" },
    {
      label: "Last 90 Days",
      value: "last-90-days" as TimeRange,
      key: "N",
    },
    {
      label: "Month to Date",
      value: "month-to-date" as TimeRange,
      key: "M",
    },
    { label: "Last Month", value: "last-month" as TimeRange, key: "P" },
    {
      label: "Year to Date",
      value: "year-to-date" as TimeRange,
      key: "Y",
    },
    {
      label: "Last 12 Months",
      value: "last-12-months" as TimeRange,
      key: "L",
    },
    { label: "All Time", value: "all-time" as TimeRange, key: "A" },
    // {
    //   label: "Custom Range",
    //   value: "custom-range" as TimeRange,
    //   key: "C",
    // },
  ]);

  return { timeRangeOptions };
} 