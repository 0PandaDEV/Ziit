<template>
  <NuxtLayout name="default">
    <div class="stats-dashboard">
      <div class="chart-container">
        <div class="chart" ref="chartContainer"></div>
      </div>

      <div class="metrics-tables">
        <div class="section">
          <h2>TOP PROJECTS</h2>
          <div class="list">
            <div
              v-for="project in sortedProjects.slice(0, 10)"
              :key="project.name"
              class="item"
              :style="{
                '--percentage': `${(
                  (project.seconds / stats.totalSeconds) *
                  100
                ).toFixed(1)}%`,
              }"
            >
              <div class="name">{{ project.name }}</div>
              <div class="time">{{ formatTime(project.seconds) }}</div>
              <div class="percentage">
                {{ ((project.seconds / stats.totalSeconds) * 100).toFixed(1) }}%
              </div>
            </div>
          </div>
        </div>

        <div class="section">
          <h2>TOP LANGUAGES</h2>
          <div class="list">
            <div
              v-for="language in languageBreakdown.slice(0, 10)"
              :key="language.name"
              class="item"
              :style="{
                '--percentage': `${(
                  (language.seconds / stats.totalSeconds) *
                  100
                ).toFixed(1)}%`,
              }"
            >
              <div class="name">{{ language.name || "Unknown" }}</div>
              <div class="time">
                {{ formatTime(language.seconds) }}
              </div>
              <div class="percentage">
                {{
                  ((language.seconds / stats.totalSeconds) * 100).toFixed(1)
                }}%
              </div>
            </div>
          </div>
        </div>

        <div class="section">
          <h2>EDITORS</h2>
          <div class="list">
            <div
              v-for="editor in editorBreakdown.slice(0, 10)"
              :key="editor.name"
              class="item"
              :style="{
                '--percentage': `${(
                  (editor.seconds / stats.totalSeconds) *
                  100
                ).toFixed(1)}%`,
              }"
            >
              <div class="name">{{ editor.name || "Unknown" }}</div>
              <div class="time">
                {{ formatTime(editor.seconds) }}
              </div>
              <div class="percentage">
                {{ ((editor.seconds / stats.totalSeconds) * 100).toFixed(1) }}%
              </div>
            </div>
          </div>
        </div>

        <div class="section">
          <h2>OPERATING SYSTEMS</h2>
          <div class="list">
            <div
              v-for="os in osBreakdown.slice(0, 10)"
              :key="os.name"
              class="item"
              :style="{
                '--percentage': `${(
                  (os.seconds / stats.totalSeconds) *
                  100
                ).toFixed(1)}%`,
              }"
            >
              <div class="name">{{ os.name || "Unknown" }}</div>
              <div class="time">
                {{ formatTime(os.seconds) }}
              </div>
              <div class="percentage">
                {{ ((os.seconds / stats.totalSeconds) * 100).toFixed(1) }}%
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </NuxtLayout>
</template>

<script setup lang="ts">
import type { User } from "@prisma/client";
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { Key, keyboard } from "wrdu-keyboard";
import * as statsLib from "~/lib/stats";
import type { Heartbeat } from "~/lib/stats";
import {
  Chart,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  LineController,
  Tooltip,
  Filler,
  type ChartConfiguration,
} from "chart.js";

Chart.register(
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  LineController,
  Tooltip,
  Filler,
);

type ItemWithTime = {
  name: string;
  seconds: number;
};

const userState = useState<User | null>("user");
const chartContainer = ref<HTMLElement | null>(null);
const projectSort = ref<"time" | "name">("time");
const uniqueLanguages = ref(0);
let chart: Chart | null = null;

const stats = ref(statsLib.getStats());
const timeRange = ref(statsLib.getTimeRange());
const { formatTime } = statsLib;

const unsubscribe = statsLib.subscribe(() => {
  stats.value = statsLib.getStats();
  timeRange.value = statsLib.getTimeRange();
  if (chart) {
    updateChart();
  }
});

watch(
  () => stats.value,
  (newStats) => {
    if (newStats) {
      uniqueLanguages.value = Object.keys(newStats.languages || {}).length;
    }
    if (chart) {
      updateChart();
    }
  },
  { immediate: true, deep: true },
);

const sortedProjects = computed(() => {
  if (!stats.value || !stats.value.projects) return [];

  const projects: ItemWithTime[] = Object.entries(stats.value.projects).map(
    ([name, seconds]) => ({
      name,
      seconds: seconds as number,
    }),
  );

  if (projectSort.value === "time") {
    return projects.sort((a, b) => b.seconds - a.seconds);
  } else {
    return projects.sort((a, b) => a.name.localeCompare(b.name));
  }
});

const languageBreakdown = computed(() => {
  if (!stats.value || !stats.value.languages) return [];

  const languages: ItemWithTime[] = Object.entries(stats.value.languages).map(
    ([name, seconds]) => ({
      name: name || "Unknown",
      seconds: seconds as number,
    }),
  );

  return languages.sort((a, b) => b.seconds - a.seconds);
});

const editorBreakdown = computed(() => {
  if (!stats.value || !stats.value.editors) return [];

  const editors: ItemWithTime[] = Object.entries(stats.value.editors).map(
    ([name, seconds]) => ({
      name: name || "Unknown",
      seconds: seconds as number,
    }),
  );

  return editors.sort((a, b) => b.seconds - a.seconds);
});

const osBreakdown = computed(() => {
  if (!stats.value || !stats.value.os) return [];

  const osArray: ItemWithTime[] = Object.entries(stats.value.os).map(
    ([name, seconds]) => ({
      name: name || "Unknown",
      seconds: seconds as number,
    }),
  );

  return osArray.sort((a, b) => b.seconds - a.seconds);
});

const HEARTBEAT_INTERVAL_SECONDS = 30;

async function fetchUserData() {
  if (userState.value) return userState.value;

  try {
    const data = await $fetch("/api/user");
    userState.value = data as User;

    if (data?.keystrokeTimeout) {
      statsLib.setKeystrokeTimeout(data.keystrokeTimeout);
    }

    return data;
  } catch (error) {
    console.error("Error fetching user data:", error);
    return null;
  }
}

onMounted(async () => {
  await fetchUserData();
  keyboard.prevent.down([Key.D], async () => {
    statsLib.setTimeRange("today");
  });

  keyboard.prevent.down([Key.E], async () => {
    statsLib.setTimeRange("yesterday");
  });

  keyboard.prevent.down([Key.W], async () => {
    statsLib.setTimeRange("week");
  });

  keyboard.prevent.down([Key.T], async () => {
    statsLib.setTimeRange("month");
  });

  keyboard.prevent.down([Key.P], async () => {
    statsLib.setTimeRange("last-month");
  });

  keyboard.prevent.down([Key.N], async () => {
    statsLib.setTimeRange("last-90-days");
  });

  keyboard.prevent.down([Key.Y], async () => {
    statsLib.setTimeRange("year-to-date");
  });

  keyboard.prevent.down([Key.L], async () => {
    statsLib.setTimeRange("last-12-months");
  });

  keyboard.prevent.down([Key.A], async () => {
    statsLib.setTimeRange("all-time");
  });

  // keyboard.prevent.down([Key.C], async () => {
  //   statsLib.setTimeRange("custom-range");
  // });

  if (chartContainer.value) {
    renderChart();
  }
});

onUnmounted(() => {
  keyboard.clear();
  unsubscribe();
  if (chart) {
    chart.destroy();
    chart = null;
  }
});

function renderChart() {
  if (!chartContainer.value || !stats.value) return;

  import("chart.js").then((module) => {
    const {
      Chart,
      CategoryScale,
      LinearScale,
      LineElement,
      PointElement,
      LineController,
      Tooltip,
      Filler,
    } = module;

    Chart.register(
      CategoryScale,
      LinearScale,
      LineElement,
      PointElement,
      LineController,
      Tooltip,
      Filler,
    );

    const ctx = document.createElement("canvas");
    chartContainer.value?.appendChild(ctx);

    const labels = getChartLabels();
    const data = getChartData();

    chart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Coding Time (hours)",
            data,
            borderColor: "#ff6200",
            borderWidth: 3,
            pointBackgroundColor: "#ff6200",
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: "start",
            tension: 0,
            stepped: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        elements: {
          line: {
            tension: 0,
            borderJoinStyle: "miter",
          },
          point: {
            hitRadius: 10,
          },
        },
        scales: {
          x: {
            grid: {
              display: false,
            },
            ticks: {
              maxRotation: 0,
              autoSkip: true,
              font: {
                size: 11,
              },
            },
            border: {
              display: false,
            },
          },
          y: {
            beginAtZero: true,
            border: {
              display: false,
            },
            grid: {
              color: "rgba(255, 255, 255, 0.05)",
              drawTicks: false,
            },
            ticks: {
              font: {
                size: 11,
              },
              padding: 8,
              callback: function (value) {
                const numValue = Number(value);
                if (numValue === 0) return "0h";
                const hours = Math.floor(numValue);
                const minutes = Math.round((numValue - hours) * 60);
                return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
              },
            },
          },
        },
        interaction: {
          mode: "index",
          intersect: false,
        },
        plugins: {
          tooltip: {
            backgroundColor: "#2b2b2b",
            borderColor: "#ffffff1a",
            borderWidth: 1,
            titleColor: "#e6e6e6",
            bodyColor: "#e6e6e6",
            padding: 12,
            cornerRadius: 0,
            displayColors: false,
            callbacks: {
              title: function (tooltipItems) {
                const index = tooltipItems[0].dataIndex;
                const label = tooltipItems[0].label;

                if (
                  timeRange.value === "today" ||
                  timeRange.value === "yesterday"
                ) {
                  return `Time: ${label}`;
                } else if (timeRange.value === "week") {
                  return `Date: ${label}`;
                } else if (
                  timeRange.value === "month" ||
                  timeRange.value === "month-to-date" ||
                  timeRange.value === "last-month"
                ) {
                  return `Date: ${label}`;
                } else if (
                  timeRange.value === "year-to-date" ||
                  timeRange.value === "last-12-months"
                ) {
                  return `Month: ${label}`;
                } else {
                  return `Date: ${label}`;
                }
              },
              label: function (context) {
                const value = context.parsed.y || 0;
                const numValue = Number(value);
                const hours = Math.floor(numValue);
                const minutes = Math.round((numValue - hours) * 60);
                return `${hours}h ${
                  minutes > 0 ? `${minutes}m` : ""
                } of coding`;
              },
            },
          },
          legend: {
            display: false,
          },
        },
        hover: {
          mode: "index",
          intersect: false,
        },
      },
    });
  });
}

function updateChart() {
  if (!chart || !stats.value) {
    return;
  }

  const labels = getChartLabels();
  const data = getChartData();

  chart.data.labels = labels;
  chart.data.datasets[0].data = data;
  chart.update();
}

function getChartLabels(): string[] {
  const labels = [];
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  if (timeRange.value === "today" || timeRange.value === "yesterday") {
    for (let i = 0; i < 24; i++) {
      const hour = i.toString().padStart(2, "0");
      labels.push(`${hour}:00`);
    }
  } else if (timeRange.value === "week") {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    for (let i = 6; i >= 0; i--) {
      const date = new Date(yesterday);
      date.setDate(date.getDate() - i);
      labels.push(`${date.getDate()} ${months[date.getMonth()]}`);
    }
  } else if (
    timeRange.value === "month" ||
    timeRange.value === "month-to-date" ||
    timeRange.value === "last-month" ||
    timeRange.value === "last-90-days"
  ) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    let startDate = new Date(yesterday);

    if (timeRange.value === "month") {
      startDate.setDate(startDate.getDate() - 29);
    } else if (timeRange.value === "month-to-date") {
      startDate.setDate(1);
    } else if (timeRange.value === "last-month") {
      startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      today.setDate(0);
    } else if (timeRange.value === "last-90-days") {
      startDate.setDate(startDate.getDate() - 89);
    }

    const days = [];
    let currentDate = new Date(startDate);

    while (currentDate <= yesterday) {
      days.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return days.map((date) => `${date.getDate()} ${months[date.getMonth()]}`);
  } else if (
    timeRange.value === "year-to-date" ||
    timeRange.value === "last-12-months"
  ) {
    const today = new Date();
    let numMonths =
      timeRange.value === "year-to-date" ? today.getMonth() + 1 : 12;

    for (let i = numMonths - 1; i >= 0; i--) {
      let monthIndex = (today.getMonth() - i + 12) % 12;
      labels.push(months[monthIndex]);
    }
  } else if (timeRange.value === "all-time") {
    if (
      stats.value &&
      stats.value.dailySummaries &&
      stats.value.dailySummaries.length > 0
    ) {
      const dates = stats.value.dailySummaries.map(
        (summary) => new Date(summary.date),
      );
      const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
      const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));

      if (maxDate.getFullYear() - minDate.getFullYear() > 0) {
        const monthsWithYears = [];
        let currentDate = new Date(
          minDate.getFullYear(),
          minDate.getMonth(),
          1,
        );

        while (currentDate <= maxDate) {
          monthsWithYears.push(new Date(currentDate));
          currentDate.setMonth(currentDate.getMonth() + 1);
        }

        return monthsWithYears.map(
          (date) => `${months[date.getMonth()]} ${date.getFullYear()}`,
        );
      }
    }

    const today = new Date();
    for (let i = 11; i >= 0; i--) {
      const date = new Date(today);
      date.setMonth(date.getMonth() - i);
      labels.push(`${months[date.getMonth()]}`);
    }
  } else {
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      labels.push(`${date.getDate()} ${months[date.getMonth()]}`);
    }
  }

  return labels;
}

function getChartData(): number[] {
  if (!stats.value) return [];

  const labels = getChartLabels();
  const result = Array(labels.length).fill(0);

  if (
    timeRange.value === statsLib.TimeRangeEnum.TODAY ||
    timeRange.value === statsLib.TimeRangeEnum.YESTERDAY
  ) {
    const relevantHeartbeats = stats.value.heartbeats;

    if (!relevantHeartbeats || relevantHeartbeats.length === 0) return result;
    const userTimezone = stats.value.timezone || "UTC";

    const now = new Date();

    let startDate, endDate;

    if (timeRange.value === statsLib.TimeRangeEnum.TODAY) {
      startDate = new Date(
        now.toLocaleString("en-US", { timeZone: userTimezone }),
      );
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(
        now.toLocaleString("en-US", { timeZone: userTimezone }),
      );
      endDate.setHours(23, 59, 59, 999);
    } else {
      startDate = new Date(
        now.toLocaleString("en-US", { timeZone: userTimezone }),
      );
      startDate.setDate(startDate.getDate() - 1);
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(
        startDate.toLocaleString("en-US", { timeZone: userTimezone }),
      );
      endDate.setHours(23, 59, 59, 999);
    }

    const utcStartDate = new Date(
      Date.UTC(
        startDate.getFullYear(),
        startDate.getMonth(),
        startDate.getDate(),
        startDate.getHours(),
        startDate.getMinutes(),
        startDate.getSeconds(),
      ),
    );

    const utcEndDate = new Date(
      Date.UTC(
        endDate.getFullYear(),
        endDate.getMonth(),
        endDate.getDate(),
        endDate.getHours(),
        endDate.getMinutes(),
        endDate.getSeconds(),
      ),
    );

    const filteredHeartbeats = relevantHeartbeats.filter((hb) => {
      const hbDate = new Date(hb.timestamp);
      return hbDate >= utcStartDate && hbDate <= utcEndDate;
    });

    console.log(
      `Filtered ${filteredHeartbeats.length} heartbeats for ${timeRange.value}`,
    );
    console.log(
      `Date range: ${utcStartDate.toISOString()} - ${utcEndDate.toISOString()}`,
    );

    const heartbeatsByProject: Record<string, Heartbeat[]> = {};

    filteredHeartbeats.forEach((hb) => {
      const projectKey = hb.project || "unknown";
      if (!heartbeatsByProject[projectKey]) {
        heartbeatsByProject[projectKey] = [];
      }
      heartbeatsByProject[projectKey].push(hb);
    });

    for (const projectKey in heartbeatsByProject) {
      const projectBeats = heartbeatsByProject[projectKey].sort((a, b) => {
        const aTime = new Date(a.timestamp).getTime();
        const bTime = new Date(b.timestamp).getTime();
        return aTime - bTime;
      });

      for (let i = 0; i < projectBeats.length; i++) {
        const currentBeat = projectBeats[i];
        const previousBeat = i > 0 ? projectBeats[i - 1] : undefined;
        const durationSeconds = calculateInlinedDuration(
          currentBeat,
          previousBeat,
        );

        const ts = new Date(currentBeat.timestamp);
        const localTs = new Date(
          ts.toLocaleString("en-US", { timeZone: userTimezone }),
        );
        const localHour = localTs.getHours();

        if (localHour >= 0 && localHour < 24) {
          result[localHour] = (result[localHour] || 0) + durationSeconds / 3600;
        }
      }
    }

    return result;
  }

  if (!stats.value.dailySummaries || stats.value.dailySummaries.length === 0) {
    return result;
  }

  const dailySummaries = stats.value.dailySummaries;

  if (timeRange.value === statsLib.TimeRangeEnum.WEEK) {
    const dateStringToIndex = new Map<string, number>();
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];

    for (let i = 0; i < labels.length; i++) {
      dateStringToIndex.set(labels[i], i);
    }

    for (const summary of dailySummaries) {
      const date = new Date(summary.date);
      const dateString = `${date.getDate()} ${months[date.getMonth()]}`;
      const labelIndex = dateStringToIndex.get(dateString);

      if (labelIndex !== undefined) {
        result[labelIndex] =
          (result[labelIndex] || 0) + summary.totalSeconds / 3600;
      }
    }

    return result;
  } else if (
    timeRange.value === statsLib.TimeRangeEnum.MONTH ||
    timeRange.value === statsLib.TimeRangeEnum.MONTH_TO_DATE ||
    timeRange.value === statsLib.TimeRangeEnum.LAST_MONTH ||
    timeRange.value === statsLib.TimeRangeEnum.LAST_90_DAYS
  ) {
    const dateStringToIndex = new Map<string, number>();
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];

    for (let i = 0; i < labels.length; i++) {
      dateStringToIndex.set(labels[i], i);
    }

    for (const summary of dailySummaries) {
      const date = new Date(summary.date);
      const dateString = `${date.getDate()} ${months[date.getMonth()]}`;
      const labelIndex = dateStringToIndex.get(dateString);

      if (labelIndex !== undefined) {
        result[labelIndex] =
          (result[labelIndex] || 0) + summary.totalSeconds / 3600;
      }
    }

    return result;
  } else if (
    timeRange.value === statsLib.TimeRangeEnum.YEAR_TO_DATE ||
    timeRange.value === statsLib.TimeRangeEnum.LAST_12_MONTHS
  ) {
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const monthNameToIndex = new Map<string, number>();

    for (let i = 0; i < labels.length; i++) {
      const monthName = labels[i];
      monthNameToIndex.set(monthName, i);
    }

    const monthlyTotals = new Map<string, number>();

    for (const summary of dailySummaries) {
      const date = new Date(summary.date);
      const monthName = months[date.getMonth()];

      monthlyTotals.set(
        monthName,
        (monthlyTotals.get(monthName) || 0) + summary.totalSeconds / 3600,
      );
    }

    for (const [monthName, totalHours] of monthlyTotals.entries()) {
      const labelIndex = monthNameToIndex.get(monthName);
      if (labelIndex !== undefined) {
        result[labelIndex] = totalHours;
      }
    }

    return result;
  }

  if (timeRange.value === statsLib.TimeRangeEnum.ALL_TIME) {
    const labelMap = new Map<string, number>();
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];

    for (let i = 0; i < labels.length; i++) {
      labelMap.set(labels[i], i);
    }

    for (const summary of dailySummaries) {
      const date = new Date(summary.date);

      if (labels[0].includes(" 20")) {
        const labelKey = `${months[date.getMonth()]} ${date.getFullYear()}`;
        const labelIndex = labelMap.get(labelKey);

        if (labelIndex !== undefined) {
          result[labelIndex] =
            (result[labelIndex] || 0) + summary.totalSeconds / 3600;
        }
      } else {
        const labelKey = months[date.getMonth()];
        const labelIndex = labelMap.get(labelKey);

        if (labelIndex !== undefined) {
          result[labelIndex] =
            (result[labelIndex] || 0) + summary.totalSeconds / 3600;
        }
      }
    }
  }

  return result;
}

function calculateInlinedDuration(
  current: Heartbeat,
  previous?: Heartbeat,
): number {
  const keystrokeTimeoutSecs = statsLib.getKeystrokeTimeout() * 60;

  if (!previous) {
    return HEARTBEAT_INTERVAL_SECONDS;
  }

  const currentTs = (current.timestamp as Date).getTime();
  const previousTs = (previous.timestamp as Date).getTime();
  const diffSeconds = Math.round((currentTs - previousTs) / 1000);

  if (diffSeconds < keystrokeTimeoutSecs) {
    return diffSeconds;
  } else {
    return HEARTBEAT_INTERVAL_SECONDS;
  }
}

function getDayOfWeek(day: number): string {
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  return days[day % 7];
}

useSeoMeta({
  title: "Ziit - Coding Statistics",
  description: "Track your coding time and productivity with Ziit",
  ogTitle: "Ziit - Coding Statistics",
  ogDescription: "Track your coding time and productivity with Ziit",
  ogImage: "https://ziit.app/logo.webp",
  ogUrl: "https://ziit.app",
  ogSiteName: "Ziit",
  twitterTitle: "Ziit - Coding Statistics",
  twitterDescription: "Track your coding time and productivity with Ziit",
  twitterImage: "https://ziit.app/logo.webp",
  twitterCard: "summary",
  twitterCreator: "@pandadev_",
  twitterSite: "@pandadev_",
  author: "PandaDEV",
});

useHead({
  htmlAttrs: { lang: "en" },
  link: [
    {
      rel: "canonical",
      href: "https://ziit.app",
    },
    {
      rel: "icon",
      type: "image/ico",
      href: "/favicon.ico",
    },
  ],
  script: [
    {
      type: "application/ld+json",
      innerHTML: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "Ziit",
        url: "https://ziit.app",
      }),
    },
  ],
});
</script>

<style lang="scss">
@use "/styles/index.scss";
</style>
