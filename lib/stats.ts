import { ref } from "vue";

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

export function getKeystrokeTimeout(): number {
  if (typeof window !== "undefined") {
    try {
      const userState = useState<any>("user");
      if (
        userState.value &&
        typeof userState.value.keystrokeTimeout === "number"
      ) {
        return userState.value.keystrokeTimeout;
      }
    } catch {
      return keystrokeTimeout;
    }
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
  hourlyData: HourlyData[];
};

export interface Heartbeat {
  id: string;
  timestamp: Date | string;
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
  summaries: Summary[];
  heartbeats: Heartbeat[];
  timezone?: string;
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
  summaries: [],
  heartbeats: [],
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
  if (typeof window === "undefined") {
    state.status = "idle";
    return;
  }

  const cacheKey = state.timeRange;

  if (state.cache[cacheKey] && state.timeRange !== TimeRangeEnum.TODAY) {
    state.data = state.cache[cacheKey];
    state.status = "success";
    statsRef.value = state.data;
    return;
  }

  state.status = "pending";
  state.error = null;

  try {
    const baseUrl = window.location.origin;
    const url = new URL("/api/stats", baseUrl);
    url.searchParams.append("timeRange", state.timeRange);
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

    if (apiResponse.heartbeats) {
      apiResponse.heartbeats = apiResponse.heartbeats.map((hb: any) => ({
        ...hb,
        timestamp: new Date(hb.timestamp),
      }));
    }

    const localData = convertUtcToLocal(apiResponse);

    state.cache[cacheKey] = localData;
    state.data = localData;
    state.status = "success";
    statsRef.value = state.data;
  } catch (err: unknown) {
    console.error("Error fetching stats:", err);
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

function convertUtcToLocal(apiResponse: any): StatsResult {
  const timezone = apiResponse.timezone || "UTC";
  
  const allParsedHeartbeats = (apiResponse.heartbeats || []).map((hb: any) => {
    const utcTimestamp = hb.timestamp instanceof Date ? hb.timestamp : new Date(hb.timestamp);
    
    const localTimestamp = new Date(utcTimestamp.toLocaleString("en-US", {
      timeZone: timezone
    }));
    
    return {
      ...hb,
      timestamp: localTimestamp,
    };
  }) as Heartbeat[];

  let calculatedTotalSeconds = 0;
  const calculatedProjects: StatRecord = {};
  const calculatedLanguages: StatRecord = {};
  const calculatedEditors: StatRecord = {};
  const calculatedOs: StatRecord = {};

  const dailyData = apiResponse.summaries || [];
  const summaries = apiResponse.summaries || [];

  dailyData.forEach((day: Summary) => {
    calculatedTotalSeconds += day.totalSeconds;

    Object.entries(day.projects).forEach(([project, seconds]) => {
      calculatedProjects[project] =
        (calculatedProjects[project] || 0) + seconds;
    });

    Object.entries(day.languages).forEach(([language, seconds]) => {
      calculatedLanguages[language] =
        (calculatedLanguages[language] || 0) + seconds;
    });

    Object.entries(day.editors).forEach(([editor, seconds]) => {
      calculatedEditors[editor] = (calculatedEditors[editor] || 0) + seconds;
    });

    Object.entries(day.os).forEach(([os, seconds]) => {
      calculatedOs[os] = (calculatedOs[os] || 0) + seconds;
    });
  });

  return {
    totalSeconds: calculatedTotalSeconds,
    projects: calculatedProjects,
    languages: calculatedLanguages,
    editors: calculatedEditors,
    os: calculatedOs,
    summaries,
    heartbeats: allParsedHeartbeats,
    timezone,
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

if (typeof window !== "undefined") {
  statsRef.value = state.data;
  timeRangeRef.value = state.timeRange;
  fetchStats();
}
