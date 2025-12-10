import { computed } from "vue";
import type { User } from "~~/prisma/generated/client";

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

const statsState = () =>
  useState<StatsResult>("stats-data", () => ({ ...initialStats }));
const timeRangeState = () =>
  useState<TimeRange>("stats-timerange", () => TimeRangeEnum.TODAY);
const keystrokeTimeoutState = () =>
  useState<number>("keystroke-timeout", () => 0);
const cacheState = () =>
  useState<Record<string, StatsResult>>("stats-cache", () => ({}));

export const useStats = () => {
  const stats = statsState();
  const timeRange = timeRangeState();
  const keystrokeTimeout = keystrokeTimeoutState();
  const cache = cacheState();

  const setKeystrokeTimeout = (minutes: number): void => {
    keystrokeTimeout.value = minutes;
  };

  const getKeystrokeTimeout = async (): Promise<number> => {
    if (keystrokeTimeout.value > 0) {
      return keystrokeTimeout.value;
    }

    try {
      const user = await $fetch<User>("/api/user");
      if (user && typeof user.keystrokeTimeout === "number") {
        keystrokeTimeout.value = user.keystrokeTimeout;
        return user.keystrokeTimeout;
      }
    } catch {
      return keystrokeTimeout.value;
    }

    return keystrokeTimeout.value;
  };

  const fetchStats = async (): Promise<void> => {
    const cacheKey = timeRange.value;
    const cachedData = cache.value[cacheKey];

    if (cachedData && timeRange.value !== TimeRangeEnum.TODAY) {
      stats.value = cachedData;
      return;
    }

    try {
      const timezoneOffsetMinutes = import.meta.client
        ? new Date().getTimezoneOffset()
        : 0;
      const timezoneOffsetSeconds = timezoneOffsetMinutes * 60 * -1;

      let baseUrl: string;
      if (import.meta.server) {
        const requestURL = useRequestURL();
        baseUrl = requestURL.origin;
      } else {
        baseUrl = window.location.origin;
      }

      const url = new URL("/api/stats", baseUrl);
      url.searchParams.append("timeRange", timeRange.value);
      url.searchParams.append(
        "midnightOffsetSeconds",
        timezoneOffsetSeconds.toString()
      );

      if (timeRange.value === TimeRangeEnum.TODAY) {
        url.searchParams.append("t", Date.now().toString());
      }

      const apiResponse = await $fetch<any>(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        credentials: "include",
      });

      const processedData = processStatsResponse(apiResponse);

      cache.value[cacheKey] = processedData;
      stats.value = processedData;
    } catch (err: unknown) {
      stats.value = { ...initialStats };

      if (
        process.client &&
        err instanceof Error &&
        err.message.includes("401")
      ) {
        window.location.href = "/login";
      }
    }
  };

  const processStatsResponse = (apiResponse: any): StatsResult => {
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
        calculatedBranches[branch] =
          (calculatedBranches[branch] || 0) + seconds;
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
  };

  const setTimeRange = (range: TimeRange): void => {
    timeRange.value = range;
    fetchStats();
  };

  const refreshStats = (): Promise<void> => {
    const cacheKey = timeRange.value;
    if (cache.value[cacheKey]) {
      delete cache.value[cacheKey];
    }
    return fetchStats();
  };

  const formatTime = (seconds: number): string => {
    if (!seconds) return "0h 0m";

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    return `${hours}h ${minutes}m`;
  };

  return {
    stats: computed(() => stats.value),
    timeRange: computed(() => timeRange.value),
    keystrokeTimeout: computed(() => keystrokeTimeout.value),
    fetchStats,
    setTimeRange,
    refreshStats,
    formatTime,
    setKeystrokeTimeout,
    getKeystrokeTimeout,
  };
};

export const getStats = () => statsState().value;
export const getTimeRange = () => timeRangeState().value;
export const formatTime = (seconds: number): string => {
  if (!seconds) return "0h 0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
};
