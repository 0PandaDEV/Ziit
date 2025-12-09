import { ref } from "vue";
import type { User } from "~~/prisma/client/client";

export const TimeRangeEnum = {
  TODAY: "today",
  YESTERDAY: "yesterday",
  WEEK: "week",
  MONTH: "month",
  MONTH_TO_DATE: "month-to-date",
  LAST_MONTH: "last-month",
  LAST_90_DAYS: "last-90-days",
  YEAR_TO_DATE: "year-to-date",
  LAST_12_MONTHS: "last-12-months",
  ALL_TIME: "all-time",
  CUSTOM_RANGE: "custom-range",
} as const;

export type TimeRange = (typeof TimeRangeEnum)[keyof typeof TimeRangeEnum];

let keystrokeTimeout = 0;

export function setKeystrokeTimeout(minutes: number): void {
  keystrokeTimeout = minutes;
}

export async function getKeystrokeTimeout(): Promise<number> {
  try {
    const user = await $fetch<User>("/api/user");
    if (user && typeof user.keystrokeTimeout === "number") {
      return user.keystrokeTimeout;
    }
  } catch {
    return keystrokeTimeout;
  }

  return keystrokeTimeout;
}

type StatRecord = Record<string, number>;

export type HourlyData = {
  seconds: number;
};

export type Summary = {
  date: string;
  totalSeconds: number;
  projects: StatRecord;
  languages: StatRecord;
  editors: StatRecord;
  os: StatRecord;
  files: StatRecord;
  branches: StatRecord;
  hourlyData: HourlyData[];
};

export interface Heartbeat {
  id: string;
  timestamp: number | string | Date;
  project?: string | null;
  language?: string | null;
  editor?: string | null;
  os?: string | null;
}

type StatsResult = {
  totalSeconds: number;
  projects: StatRecord;
  languages: StatRecord;
  editors: StatRecord;
  os: StatRecord;
  files: StatRecord;
  branches: StatRecord;
  summaries: Summary[];
  offsetSeconds: number;
};

type State = {
  data: StatsResult;
  timeRange: TimeRange;
  cache: Record<string, StatsResult>;
  status: "idle" | "pending" | "success" | "error";
  error: Error | null;
  isAuthenticated: boolean;
};

const initialStats: StatsResult = {
  totalSeconds: 0,
  projects: {},
  languages: {},
  editors: {},
  os: {},
  files: {},
  branches: {},
  summaries: [],
  offsetSeconds: 0,
};

const state: State = {
  data: { ...initialStats },
  timeRange: TimeRangeEnum.TODAY,
  cache: {},
  status: "idle",
  error: null,
  isAuthenticated: true,
};

const statsRef = ref<StatsResult>(initialStats);
const timeRangeRef = ref<TimeRange>(TimeRangeEnum.TODAY);

export async function fetchStats(): Promise<void> {
  const cacheKey = state.timeRange;
  const cachedData = state.cache[cacheKey];

  if (cachedData && state.timeRange !== TimeRangeEnum.TODAY) {
    state.data = cachedData;
    state.status = "success";
    statsRef.value = state.data;
    return;
  }

  state.status = "pending";
  state.error = null;

  try {
    const timezoneOffsetMinutes = new Date().getTimezoneOffset();
    const timezoneOffsetSeconds = timezoneOffsetMinutes * 60;

    const baseUrl = window.location.origin;
    const url = new URL("/api/stats", baseUrl);
    url.searchParams.append("timeRange", state.timeRange);
    url.searchParams.append("midnightOffsetSeconds", timezoneOffsetSeconds.toString());

    if (state.timeRange === TimeRangeEnum.TODAY) {
      url.searchParams.append("t", Date.now().toString());
    }

    const apiResponse = await $fetch<any>(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      credentials: "include",
    });

    state.isAuthenticated = true;

    const processedData = processStatsResponse(apiResponse);

    state.cache[cacheKey] = processedData;
    state.data = processedData;
    state.status = "success";
    statsRef.value = state.data;
  } catch (err: unknown) {
    state.error = err instanceof Error ? err : new Error(String(err));
    state.data = { ...initialStats };
    state.status = "error";

    if (err instanceof Error && err.message.includes("401")) {
      state.isAuthenticated = false;
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
    }
    statsRef.value = state.data;
  }
}

function processStatsResponse(apiResponse: any): StatsResult {
  let calculatedTotalSeconds = 0;
  const calculatedProjects: StatRecord = {};
  const calculatedLanguages: StatRecord = {};
  const calculatedEditors: StatRecord = {};
  const calculatedOs: StatRecord = {};
  const calculatedFiles: StatRecord = {};
  const calculatedBranches: StatRecord = {};

  const summaries = apiResponse.summaries || [];

  summaries.forEach((day: Summary) => {
    calculatedTotalSeconds += day.totalSeconds;

    Object.entries(day.projects || {}).forEach(([project, seconds]) => {
      calculatedProjects[project] =
        (calculatedProjects[project] || 0) + seconds;
    });

    Object.entries(day.languages || {}).forEach(([language, seconds]) => {
      calculatedLanguages[language] =
        (calculatedLanguages[language] || 0) + seconds;
    });

    Object.entries(day.editors || {}).forEach(([editor, seconds]) => {
      calculatedEditors[editor] = (calculatedEditors[editor] || 0) + seconds;
    });

    Object.entries(day.os || {}).forEach(([os, seconds]) => {
      calculatedOs[os] = (calculatedOs[os] || 0) + seconds;
    });

    Object.entries(day.files || {}).forEach(([file, seconds]) => {
      calculatedFiles[file] = (calculatedFiles[file] || 0) + seconds;
    });

    Object.entries(day.branches || {}).forEach(([branch, seconds]) => {
      calculatedBranches[branch] = (calculatedBranches[branch] || 0) + seconds;
    });
  });

  return {
    totalSeconds: calculatedTotalSeconds,
    projects: calculatedProjects,
    languages: calculatedLanguages,
    editors: calculatedEditors,
    os: calculatedOs,
    files: calculatedFiles,
    branches: calculatedBranches,
    summaries,
    offsetSeconds: apiResponse.offsetSeconds || 0,
  };
}

export function setTimeRange(range: TimeRange): void {
  state.timeRange = range;
  timeRangeRef.value = range;
  fetchStats();
}

export function refreshStats(): Promise<void> {
  const cacheKey = state.timeRange;
  if (state.cache[cacheKey]) {
    delete state.cache[cacheKey];
  }
  return fetchStats();
}

export function formatTime(seconds: number): string {
  if (!seconds) return "0h 0m";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  return `${hours}h ${minutes}m`;
}

export function getStats(): StatsResult {
  return statsRef.value || state.data;
}

export function getTimeRange(): TimeRange {
  return timeRangeRef.value || state.timeRange;
}
