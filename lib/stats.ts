export type TimeRange =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "month-to-date"
  | "last-month"
  | "year-to-date"
  | "last-12-months"
  | "all-time"
  | "custom-range";

type StatRecord = Record<string, number>;

type StatsResult = {
  totalSeconds: number;
  projects: StatRecord;
  languages: StatRecord;
  editors: StatRecord;
  os: StatRecord;
  files: string[];
  dailyData: any[];
};

const initialStats: StatsResult = {
  totalSeconds: 0,
  projects: {},
  languages: {},
  editors: {},
  os: {},
  files: [],
  dailyData: [],
};

const state = {
  data: { ...initialStats },
  timeRange: "today" as TimeRange,
  cache: {} as Record<string, StatsResult>,
  status: "idle" as "idle" | "pending" | "success" | "error",
  error: null as Error | null,
  isAuthenticated: true,
};

const listeners: Function[] = [];

export function subscribe(callback: () => void): () => void {
  listeners.push(callback);
  return () => {
    const index = listeners.indexOf(callback);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  };
}

function notify() {
  listeners.forEach((callback) => callback());
}

function getDateRange(timeRange: TimeRange): {
  startDate: string;
  endDate: string;
} {
  const currentDate = new Date();
  const today = new Date(currentDate);
  today.setHours(23, 59, 59, 999);

  let startDate = new Date(currentDate);
  startDate.setHours(0, 0, 0, 0);
  let endDate = today;

  if (timeRange === "yesterday") {
    startDate = new Date(currentDate);
    startDate.setDate(startDate.getDate() - 1);
    startDate.setHours(0, 0, 0, 0);

    endDate = new Date(startDate);
    endDate.setHours(23, 59, 59, 999);
  } else if (timeRange === "week") {
    startDate = new Date(currentDate);
    startDate.setDate(startDate.getDate() - 7);
    startDate.setHours(0, 0, 0, 0);
  } else if (timeRange === "month") {
    startDate = new Date(currentDate);
    startDate.setDate(startDate.getDate() - 30);
    startDate.setHours(0, 0, 0, 0);
  } else if (timeRange === "month-to-date") {
    startDate = new Date(currentDate);
    startDate.setDate(1);
    startDate.setHours(0, 0, 0, 0);
  } else if (timeRange === "last-month") {
    endDate = new Date(currentDate);
    endDate.setDate(0);
    endDate.setHours(23, 59, 59, 999);

    startDate = new Date(endDate);
    startDate.setDate(1);
    startDate.setHours(0, 0, 0, 0);
  } else if (timeRange === "year-to-date") {
    startDate = new Date(currentDate);
    startDate.setMonth(0, 1);
    startDate.setHours(0, 0, 0, 0);
  } else if (timeRange === "last-12-months") {
    startDate = new Date(currentDate);
    startDate.setFullYear(startDate.getFullYear() - 1);
    startDate.setHours(0, 0, 0, 0);
  } else if (timeRange === "all-time") {
    startDate = new Date("2020-01-01");
    startDate.setHours(0, 0, 0, 0);
  }

  return {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
  };
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
    const { startDate, endDate } = getDateRange(state.timeRange);
    const baseUrl = window.location.origin;

    const url = new URL("/api/stats", baseUrl);
    url.searchParams.append("startDate", startDate);
    url.searchParams.append("endDate", endDate);

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

    const dailyData = await response.json();
    state.isAuthenticated = true;

    if (Array.isArray(dailyData) && dailyData.length > 0) {
      let totalSeconds = 0;
      const projects: StatRecord = {};
      const languages: StatRecord = {};
      const editors: StatRecord = {};
      const os: StatRecord = {};
      const files = new Set<string>();

      dailyData.forEach((day) => {
        totalSeconds += day.totalSeconds || 0;

        // Aggregate projects
        Object.entries(day.projects || {}).forEach(([project, seconds]) => {
          projects[project] = (projects[project] || 0) + (seconds as number);
        });

        // Aggregate languages
        Object.entries(day.languages || {}).forEach(([language, seconds]) => {
          languages[language] =
            (languages[language] || 0) + (seconds as number);
        });

        // Aggregate editors
        Object.entries(day.editors || {}).forEach(([editor, seconds]) => {
          editors[editor] = (editors[editor] || 0) + (seconds as number);
        });

        // Aggregate OS
        Object.entries(day.os || {}).forEach(([osName, seconds]) => {
          os[osName] = (os[osName] || 0) + (seconds as number);
        });

        // Collect unique files
        if (day.files) {
          day.files.forEach((file: string) => files.add(file));
        }
      });

      const result: StatsResult = {
        totalSeconds,
        projects,
        languages,
        editors,
        os,
        files: Array.from(files),
        dailyData,
      };

      state.cache[cacheKey] = result;
      state.data = result;
      state.status = "success";
    } else {
      console.warn(
        `No data found for range: ${state.timeRange} (${startDate} to ${endDate})`
      );
      state.data = { ...initialStats };
      state.status = "success";
    }
  } catch (err: any) {
    console.error("Error fetching stats:", err);
    state.error = err;
    state.data = { ...initialStats };
    state.status = "error";

    if (err.message === "Authentication required") {
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
