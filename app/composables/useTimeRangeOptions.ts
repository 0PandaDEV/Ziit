import { computed } from "vue";
import * as statsLib from "~/utils/stats";

export function useTimeRangeOptions() {
  const timeRangeOptions = computed(() => [
    { label: "Today", value: "today" as statsLib.TimeRange, key: "D" },
    { label: "Yesterday", value: "yesterday" as statsLib.TimeRange, key: "E" },
    { label: "Last 7 Days", value: "week" as statsLib.TimeRange, key: "W" },
    { label: "Last 30 Days", value: "month" as statsLib.TimeRange, key: "T" },
    {
      label: "Last 90 Days",
      value: "last-90-days" as statsLib.TimeRange,
      key: "N",
    },
    {
      label: "Month to Date",
      value: "month-to-date" as statsLib.TimeRange,
      key: "M",
    },
    { label: "Last Month", value: "last-month" as statsLib.TimeRange, key: "P" },
    {
      label: "Year to Date",
      value: "year-to-date" as statsLib.TimeRange,
      key: "Y",
    },
    {
      label: "Last 12 Months",
      value: "last-12-months" as statsLib.TimeRange,
      key: "L",
    },
    { label: "All Time", value: "all-time" as statsLib.TimeRange, key: "A" },
    // {
    //   label: "Custom Range",
    //   value: "custom-range" as statsLib.TimeRange,
    //   key: "C",
    // },
  ]);

  return { timeRangeOptions };
} 