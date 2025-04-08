export const TimeRangeEnum = {
  TODAY: "today",
  YESTERDAY: "yesterday",
  WEEK: "week",
  MONTH: "month",
  MONTH_TO_DATE: "month-to-date",
  LAST_MONTH: "last-month",
  YEAR_TO_DATE: "year-to-date",
  LAST_12_MONTHS: "last-12-months",
  ALL_TIME: "all-time",
  CUSTOM_RANGE: "custom-range",
} as const;

export type TimeRange = (typeof TimeRangeEnum)[keyof typeof TimeRangeEnum];

type StatRecord = Record<string, number>;

type HourlyData = {
  timestamp: string;
  totalSeconds: number;
};

type DailyData = {
  date: string;
  totalSeconds: number;
  projects: StatRecord;
  languages: StatRecord;
  editors: StatRecord;
  os: StatRecord;
  files: string[];
  hourlyData?: HourlyData[];
};

type StatsResult = {
  totalSeconds: number;
  projects: StatRecord;
  languages: StatRecord;
  editors: StatRecord;
  os: StatRecord;
  dailyData: DailyData[];
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
  dailyData: [],
};

const state: State = {
  data: { ...initialStats },
  timeRange: TimeRangeEnum.TODAY,
  cache: {},
  status: "idle",
  error: null,
  isAuthenticated: true,
};

const listeners: (() => void)[] = [];

export function subscribe(callback: () => void): () => void {
  listeners.push(callback);
  return () => {
    const index = listeners.indexOf(callback);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  };
}

function notify(): void {
  listeners.forEach((callback) => callback());
}

export async function fetchStats(): Promise<void> {
  if (typeof window === "undefined") {
    state.status = "idle";
    return;
  }

  const cacheKey = state.timeRange;

  if (state.cache[cacheKey]) {
    state.data = state.cache[cacheKey];
    state.status = "success";
    notify();
    return;
  }

  state.status = "pending";
  state.error = null;
  notify();

  try {
    const baseUrl = window.location.origin;
    const url = new URL("/api/stats", baseUrl);
    url.searchParams.append("timeRange", state.timeRange);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      credentials: "include",
    });

    if (!response.ok) {
      if (response.status === 401) {
        state.isAuthenticated = false;
        throw new Error("Authentication required");
      }

      throw new Error(`API error: ${response.status}`);
    }

    const dailyData = (await response.json()) as DailyData[];
    state.isAuthenticated = true;

    if (Array.isArray(dailyData) && dailyData.length > 0) {
      let totalSeconds = 0;
      const projects: StatRecord = {};
      const languages: StatRecord = {};
      const editors: StatRecord = {};
      const os: StatRecord = {};

      dailyData.forEach((day) => {
        totalSeconds += day.totalSeconds || 0;

        Object.entries(day.projects || {}).forEach(([project, seconds]) => {
          projects[project] = (projects[project] || 0) + (seconds as number);
        });

        Object.entries(day.languages || {}).forEach(([language, seconds]) => {
          languages[language] =
            (languages[language] || 0) + (seconds as number);
        });

        Object.entries(day.editors || {}).forEach(([editor, seconds]) => {
          editors[editor] = (editors[editor] || 0) + (seconds as number);
        });

        Object.entries(day.os || {}).forEach(([osName, seconds]) => {
          os[osName] = (os[osName] || 0) + (seconds as number);
        });
      });

      const result: StatsResult = {
        totalSeconds,
        projects,
        languages,
        editors,
        os,
        dailyData,
      };

      state.cache[cacheKey] = result;
      state.data = result;
      state.status = "success";
    } else {
      console.warn(`No data found for range: ${state.timeRange}`);
      state.data = { ...initialStats };
      state.status = "success";
    }
  } catch (err: unknown) {
    console.error("Error fetching stats:", err);
    state.error = err instanceof Error ? err : new Error(String(err));
    state.data = { ...initialStats };
    state.status = "error";

    if (state.error.message === "Authentication required") {
      state.isAuthenticated = false;
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
    }
  }

  notify();
}

export function setTimeRange(range: TimeRange): void {
  state.timeRange = range;
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
  return state.data;
}

export function getTimeRange(): TimeRange {
  return state.timeRange;
}

export function getStatus(): "idle" | "pending" | "success" | "error" {
  return state.status;
}

export function isAuthenticated(): boolean {
  return state.isAuthenticated;
}

if (typeof window !== "undefined") {
  fetchStats();
}
