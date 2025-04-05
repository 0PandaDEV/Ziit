import { ref } from 'vue';

export type TimeRange = 
  | 'today'
  | 'yesterday'
  | 'week'
  | 'month'
  | 'month-to-date'
  | 'last-month'
  | 'year-to-date' 
  | 'last-12-months'
  | 'all-time'
  | 'custom-range';

interface StatsData {
  totalSeconds: number;
  projects: Record<string, number>;
  languages?: Record<string, number>;
  files?: string[];
  dailyData?: DailyData[];
}

interface DailyData {
  date: string;
  totalSeconds: number;
  projects?: Record<string, number>;
  languages?: Record<string, number>;
  files?: string[];
}

export function useStats() {
  const timeRange = ref<TimeRange>("today");
  const stats = ref<StatsData>({ 
    totalSeconds: 0,
    projects: {},
    languages: {}, 
    files: [],
    dailyData: []
  });

  function setTimeRange(range: TimeRange) {
    timeRange.value = range;
  }

  async function fetchStats() {
    try {
      let startDate: string, endDate: string;
      const currentDate = new Date();
      const today = currentDate.toISOString().split("T")[0];
      endDate = today;

      if (timeRange.value === "today") {
        startDate = today;
      } else if (timeRange.value === "yesterday") {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        startDate = yesterday.toISOString().split("T")[0];
        endDate = startDate;
      } else if (timeRange.value === "week") {
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - 7);
        startDate = weekStart.toISOString().split("T")[0];
      } else if (timeRange.value === "month") {
        const monthStart = new Date();
        monthStart.setDate(monthStart.getDate() - 30);
        startDate = monthStart.toISOString().split("T")[0];
      } else if (timeRange.value === "month-to-date") {
        const monthStart = new Date();
        monthStart.setDate(1);
        startDate = monthStart.toISOString().split("T")[0];
      } else if (timeRange.value === "last-month") {
        const lastMonthEnd = new Date();
        lastMonthEnd.setDate(0);
        endDate = lastMonthEnd.toISOString().split("T")[0];
        
        const lastMonthStart = new Date(lastMonthEnd);
        lastMonthStart.setDate(1);
        startDate = lastMonthStart.toISOString().split("T")[0];
      } else if (timeRange.value === "year-to-date") {
        const yearStart = new Date();
        yearStart.setMonth(0, 1);
        startDate = yearStart.toISOString().split("T")[0];
      } else if (timeRange.value === "last-12-months") {
        const yearAgo = new Date();
        yearAgo.setFullYear(yearAgo.getFullYear() - 1);
        startDate = yearAgo.toISOString().split("T")[0];
      } else if (timeRange.value === "all-time") {
        startDate = "2020-01-01";
      } else {
        startDate = today;
      }

      const data = await $fetch<DailyData[]>(
        `/api/stats?startDate=${startDate}&endDate=${endDate}`
      );

      if (data && data.length > 0) {
        let totalSeconds = 0;
        const projects: Record<string, number> = {};
        const languages: Record<string, number> = {};
        const files = new Set<string>();

        data.forEach((day: DailyData) => {
          totalSeconds += day.totalSeconds || 0;

          Object.entries(day.projects || {}).forEach(
            ([project, seconds]) => {
              if (!projects[project]) {
                projects[project] = 0;
              }
              projects[project] += seconds;
            }
          );

          Object.entries(day.languages || {}).forEach(
            ([language, seconds]) => {
              if (!languages[language]) {
                languages[language] = 0;
              }
              languages[language] += seconds;
            }
          );

          if (day.files) {
            day.files.forEach((file: string) => files.add(file));
          }
        });

        stats.value = {
          totalSeconds,
          projects,
          languages,
          files: Array.from(files),
          dailyData: data,
        };
      } else {
        stats.value = {
          totalSeconds: 0,
          projects: {},
          languages: {},
          files: [],
          dailyData: [],
        };
      }
    } catch (error) {
      console.error("Error fetching stats:", error);
      stats.value = {
        totalSeconds: 0,
        projects: {},
        languages: {},
        files: [],
        dailyData: []
      };
    }
  }

  function formatTime(seconds: number): string {
    if (!seconds) return "0h 0m";

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    return `${hours}h ${minutes}m`;
  }

  return {
    stats,
    timeRange,
    fetchStats,
    setTimeRange,
    formatTime
  };
} 