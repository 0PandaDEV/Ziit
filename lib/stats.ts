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
  dailyData: DailyData[];
  heartbeats: Heartbeat[];
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

    const apiResponse = (await response.json()) as {
      summaries: DailyData[];
      heartbeats: any[];
    };
    state.isAuthenticated = true;

    const allParsedHeartbeats = (apiResponse.heartbeats || []).map((hb) => ({
      ...hb,
      timestamp: new Date(hb.timestamp),
    })) as Heartbeat[];

    let calculatedTotalSeconds = 0;
    const calculatedProjects: StatRecord = {};
    const calculatedLanguages: StatRecord = {};
    const calculatedEditors: StatRecord = {};
    const calculatedOs: StatRecord = {};

    const localNow = new Date();
    let localStartDate = new Date(localNow);
    let localEndDate = new Date(localNow);

    switch (state.timeRange) {
      case TimeRangeEnum.TODAY:
        localStartDate.setHours(0, 0, 0, 0);
        localEndDate.setHours(23, 59, 59, 999);
        break;
      case TimeRangeEnum.YESTERDAY:
        localStartDate.setDate(localStartDate.getDate() - 1);
        localStartDate.setHours(0, 0, 0, 0);
        localEndDate.setDate(localEndDate.getDate() - 1);
        localEndDate.setHours(23, 59, 59, 999);
        break;
      case TimeRangeEnum.WEEK:
        localStartDate.setDate(
          localStartDate.getDate() - localStartDate.getDay(),
        );
        localStartDate.setHours(0, 0, 0, 0);
        localEndDate = new Date(localStartDate);
        localEndDate.setDate(localEndDate.getDate() + 6);
        localEndDate.setHours(23, 59, 59, 999);
        break;
      case TimeRangeEnum.MONTH_TO_DATE:
        localStartDate.setDate(1);
        localStartDate.setHours(0, 0, 0, 0);
        localEndDate.setHours(23, 59, 59, 999);
        break;
      case TimeRangeEnum.LAST_MONTH:
        localStartDate = new Date(
          localNow.getFullYear(),
          localNow.getMonth() - 1,
          1,
          0,
          0,
          0,
          0,
        );
        localEndDate = new Date(
          localNow.getFullYear(),
          localNow.getMonth(),
          0,
          23,
          59,
          59,
          999,
        );
        break;
      case TimeRangeEnum.YEAR_TO_DATE:
        localStartDate = new Date(localNow.getFullYear(), 0, 1, 0, 0, 0, 0);
        localEndDate.setHours(23, 59, 59, 999);
        break;
      case TimeRangeEnum.LAST_12_MONTHS:
        localStartDate = new Date(localNow);
        localStartDate.setFullYear(localStartDate.getFullYear() - 1);
        localStartDate.setHours(0, 0, 0, 0);
        localEndDate.setHours(23, 59, 59, 999);
        break;

      default:
        localStartDate.setDate(localStartDate.getDate() - 30);
        localStartDate.setHours(0, 0, 0, 0);
        localEndDate.setHours(23, 59, 59, 999);
        console.warn(
          `Using default 30-day aggregation for time range: ${state.timeRange}`,
        );
        break;
    }

    const relevantHeartbeats = allParsedHeartbeats
      .filter((hb) => {
        const ts = hb.timestamp as Date;
        return ts >= localStartDate && ts <= localEndDate;
      })
      .sort(
        (a, b) =>
          (a.timestamp as Date).getTime() - (b.timestamp as Date).getTime(),
      );

    const heartbeatsByProject: Record<string, Heartbeat[]> = {};
    relevantHeartbeats.forEach((hb) => {
      const projectKey = hb.project || "unknown";
      if (!heartbeatsByProject[projectKey]) {
        heartbeatsByProject[projectKey] = [];
      }
      heartbeatsByProject[projectKey].push(hb);
    });

    for (const projectKey in heartbeatsByProject) {
      const projectBeats = heartbeatsByProject[projectKey];
      let projectTotalSeconds = 0;

      for (let i = 0; i < projectBeats.length; i++) {
        const currentBeat = projectBeats[i];
        const previousBeat = i > 0 ? projectBeats[i - 1] : undefined;
        const durationSeconds = calculateHeartbeatDuration(
          currentBeat,
          previousBeat,
        );

        projectTotalSeconds += durationSeconds;

        if (currentBeat.language) {
          calculatedLanguages[currentBeat.language] =
            (calculatedLanguages[currentBeat.language] || 0) + durationSeconds;
        }
        if (currentBeat.editor) {
          calculatedEditors[currentBeat.editor] =
            (calculatedEditors[currentBeat.editor] || 0) + durationSeconds;
        }
        if (currentBeat.os) {
          calculatedOs[currentBeat.os] =
            (calculatedOs[currentBeat.os] || 0) + durationSeconds;
        }
      }
      calculatedProjects[projectKey] = projectTotalSeconds;
      calculatedTotalSeconds += projectTotalSeconds;
    }

    const result: StatsResult = {
      totalSeconds: calculatedTotalSeconds,
      projects: calculatedProjects,
      languages: calculatedLanguages,
      editors: calculatedEditors,
      os: calculatedOs,
      dailyData: apiResponse.summaries || [],
      heartbeats: allParsedHeartbeats,
    };

    state.cache[cacheKey] = result;
    state.data = result;
    state.status = "success";
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

const HEARTBEAT_INTERVAL_SECONDS = 30;
const MAX_HEARTBEAT_DIFF_SECONDS = 300;

function calculateHeartbeatDuration(
  current: Heartbeat,
  previous?: Heartbeat,
): number {
  if (!previous) {
    return HEARTBEAT_INTERVAL_SECONDS;
  }

  const currentTs = (
    current.timestamp instanceof Date
      ? current.timestamp
      : new Date(current.timestamp)
  ).getTime();
  const previousTs = (
    previous.timestamp instanceof Date
      ? previous.timestamp
      : new Date(previous.timestamp)
  ).getTime();

  const diffSeconds = Math.round((currentTs - previousTs) / 1000);

  return diffSeconds < MAX_HEARTBEAT_DIFF_SECONDS
    ? diffSeconds
    : HEARTBEAT_INTERVAL_SECONDS;
}

if (typeof window !== "undefined") {
  fetchStats();
}
