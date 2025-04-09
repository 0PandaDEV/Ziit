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
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import Key from "~/components/Key.vue";
import { keyboard } from "wrdu-keyboard";
import * as statsLib from "~/lib/stats";
import type { Heartbeat } from "~/lib/stats";

type ItemWithTime = {
  name: string;
  seconds: number;
};

const chartContainer = ref<HTMLElement | null>(null);
const projectSort = ref<"time" | "name">("time");
const uniqueLanguages = ref(0);
let chart: any = null;

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
const MAX_HEARTBEAT_DIFF_SECONDS = 300;

onMounted(() => {
  keyboard.prevent.down([Key.D], () => statsLib.setTimeRange("today"));
  keyboard.prevent.down([Key.E], () => statsLib.setTimeRange("yesterday"));
  keyboard.prevent.down([Key.W], () => statsLib.setTimeRange("week"));
  keyboard.prevent.down([Key.T], () => statsLib.setTimeRange("month"));
  keyboard.prevent.down([Key.N], () => statsLib.setTimeRange("last-month"));
  keyboard.prevent.down([Key.Y], () => statsLib.setTimeRange("year-to-date"));
  keyboard.prevent.down([Key.L], () => statsLib.setTimeRange("last-12-months"));
  keyboard.prevent.down([Key.A], () => statsLib.setTimeRange("all-time"));
  keyboard.prevent.down([Key.C], () => statsLib.setTimeRange("custom-range"));

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
                  return `Day: ${label}`;
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

  if (timeRange.value === "today" || timeRange.value === "yesterday") {
    for (let i = 0; i < 24; i++) {
      labels.push(`${i}:00`);
    }
  } else if (timeRange.value === "week") {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const today = new Date().getDay();

    for (let i = 6; i >= 0; i--) {
      const day = (today - i + 7) % 7;
      labels.push(days[day]);
    }
  } else if (
    timeRange.value === "month" ||
    timeRange.value === "month-to-date" ||
    timeRange.value === "last-month"
  ) {
    const today = new Date();
    let startDate = new Date();

    if (timeRange.value === "month") {
      startDate.setDate(today.getDate() - 30);
    } else if (timeRange.value === "month-to-date") {
      startDate.setDate(1);
    } else if (timeRange.value === "last-month") {
      startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      today.setDate(0);
    }

    const days = [];
    let currentDate = new Date(startDate);

    while (currentDate <= today) {
      days.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return days.map((date) => `${date.getDate()}/${date.getMonth() + 1}`);
  } else if (
    timeRange.value === "year-to-date" ||
    timeRange.value === "last-12-months"
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
    const today = new Date();
    let numMonths =
      timeRange.value === "year-to-date" ? today.getMonth() + 1 : 12;

    for (let i = numMonths - 1; i >= 0; i--) {
      let monthIndex = (today.getMonth() - i + 12) % 12;
      labels.push(months[monthIndex]);
    }
  } else {
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      labels.push(`${date.getDate()}/${date.getMonth() + 1}`);
    }
  }

  return labels;
}

function getChartData(): number[] {
  if (!stats.value || !stats.value.heartbeats) return [];

  const relevantHeartbeats = stats.value.heartbeats;
  const labels = getChartLabels();
  const result = Array(labels.length).fill(0);

  const localNow = new Date();
  let localStartDate = new Date(localNow);
  let localEndDate = new Date(localNow);

  switch (timeRange.value) {
    case statsLib.TimeRangeEnum.TODAY:
      localStartDate.setHours(0, 0, 0, 0);
      localEndDate.setHours(23, 59, 59, 999);
      break;
    case statsLib.TimeRangeEnum.YESTERDAY:
      localStartDate.setDate(localStartDate.getDate() - 1);
      localStartDate.setHours(0, 0, 0, 0);
      localEndDate.setDate(localEndDate.getDate() - 1);
      localEndDate.setHours(23, 59, 59, 999);
      break;
    case statsLib.TimeRangeEnum.WEEK:
      localStartDate.setDate(
        localStartDate.getDate() - localStartDate.getDay(),
      );
      localStartDate.setHours(0, 0, 0, 0);
      localEndDate = new Date(localStartDate);
      localEndDate.setDate(localEndDate.getDate() + 6);
      localEndDate.setHours(23, 59, 59, 999);
      break;
    case statsLib.TimeRangeEnum.MONTH_TO_DATE:
      localStartDate.setDate(1);
      localStartDate.setHours(0, 0, 0, 0);
      localEndDate.setHours(23, 59, 59, 999);
      break;
    case statsLib.TimeRangeEnum.MONTH:
      localStartDate.setDate(localStartDate.getDate() - 30);
      localStartDate.setHours(0, 0, 0, 0);
      localEndDate.setHours(23, 59, 59, 999);
      break;
    case statsLib.TimeRangeEnum.LAST_MONTH:
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
    case statsLib.TimeRangeEnum.YEAR_TO_DATE:
      localStartDate = new Date(localNow.getFullYear(), 0, 1, 0, 0, 0, 0);
      localEndDate.setHours(23, 59, 59, 999);
      break;
    case statsLib.TimeRangeEnum.LAST_12_MONTHS:
      localStartDate = new Date(localNow);
      localStartDate.setFullYear(localStartDate.getFullYear() - 1);
      localStartDate.setHours(0, 0, 0, 0);
      localEndDate.setHours(23, 59, 59, 999);
      break;
    case statsLib.TimeRangeEnum.ALL_TIME:
      if (relevantHeartbeats.length > 0) {
        localStartDate = new Date(relevantHeartbeats[0].timestamp as Date);
        localStartDate.setHours(0, 0, 0, 0);
      } else {
        localStartDate.setHours(0, 0, 0, 0);
      }
      localEndDate.setHours(23, 59, 59, 999);

      break;
    default:
      localStartDate.setDate(localStartDate.getDate() - 30);
      localStartDate.setHours(0, 0, 0, 0);
      localEndDate.setHours(23, 59, 59, 999);
      break;
  }

  const heartbeatsByProject: Record<string, Heartbeat[]> = {};
  relevantHeartbeats.forEach((hb) => {
    const projectKey = hb.project || "unknown";
    if (!heartbeatsByProject[projectKey]) {
      heartbeatsByProject[projectKey] = [];
    }

    const ts = hb.timestamp as Date;
    if (ts >= localStartDate && ts <= localEndDate) {
      heartbeatsByProject[projectKey].push(hb);
    }
  });

  if (
    timeRange.value === statsLib.TimeRangeEnum.TODAY ||
    timeRange.value === statsLib.TimeRangeEnum.YESTERDAY
  ) {
    for (const projectKey in heartbeatsByProject) {
      const projectBeats = heartbeatsByProject[projectKey];
      for (let i = 0; i < projectBeats.length; i++) {
        const currentBeat = projectBeats[i];
        const previousBeat = i > 0 ? projectBeats[i - 1] : undefined;
        const durationSeconds = calculateInlinedDuration(
          currentBeat,
          previousBeat,
        );
        const localHour = (currentBeat.timestamp as Date).getHours();
        if (localHour >= 0 && localHour < 24) {
          result[localHour] = (result[localHour] || 0) + durationSeconds / 3600;
        }
      }
    }
  } else if (timeRange.value === statsLib.TimeRangeEnum.WEEK) {
    for (const projectKey in heartbeatsByProject) {
      const projectBeats = heartbeatsByProject[projectKey];
      for (let i = 0; i < projectBeats.length; i++) {
        const currentBeat = projectBeats[i];
        const previousBeat = i > 0 ? projectBeats[i - 1] : undefined;
        const durationSeconds = calculateInlinedDuration(
          currentBeat,
          previousBeat,
        );
        const localDayOfWeek = (currentBeat.timestamp as Date).getDay();

        const labelIndex = localDayOfWeek;
        if (labelIndex >= 0 && labelIndex < 7) {
          result[labelIndex] =
            (result[labelIndex] || 0) + durationSeconds / 3600;
        }
      }
    }
  } else if (
    timeRange.value === statsLib.TimeRangeEnum.MONTH ||
    timeRange.value === statsLib.TimeRangeEnum.MONTH_TO_DATE ||
    timeRange.value === statsLib.TimeRangeEnum.LAST_MONTH ||
    timeRange.value === statsLib.TimeRangeEnum.ALL_TIME
  ) {
    const dateStrToChartIndex = new Map<string, number>();
    let currentDate = new Date(localStartDate);
    let idx = 0;
    while (currentDate <= localEndDate && idx < labels.length) {
      const dateStr = `${currentDate.getFullYear()}-${String(
        currentDate.getMonth() + 1,
      ).padStart(2, "0")}-${String(currentDate.getDate()).padStart(2, "0")}`;
      dateStrToChartIndex.set(dateStr, idx);
      currentDate.setDate(currentDate.getDate() + 1);
      idx++;
    }

    for (const projectKey in heartbeatsByProject) {
      const projectBeats = heartbeatsByProject[projectKey];
      for (let i = 0; i < projectBeats.length; i++) {
        const currentBeat = projectBeats[i];
        const previousBeat = i > 0 ? projectBeats[i - 1] : undefined;
        const durationSeconds = calculateInlinedDuration(
          currentBeat,
          previousBeat,
        );
        const ts = currentBeat.timestamp as Date;
        const localDateStr = `${ts.getFullYear()}-${String(
          ts.getMonth() + 1,
        ).padStart(2, "0")}-${String(ts.getDate()).padStart(2, "0")}`;
        const index = dateStrToChartIndex.get(localDateStr);
        if (index !== undefined) {
          result[index] = (result[index] || 0) + durationSeconds / 3600;
        }
      }
    }
  } else if (
    timeRange.value === statsLib.TimeRangeEnum.YEAR_TO_DATE ||
    timeRange.value === statsLib.TimeRangeEnum.LAST_12_MONTHS
  ) {
    const yearMonthToChartIndex = new Map<string, number>();
    let currentMonthDate = new Date(localStartDate);
    currentMonthDate.setDate(1);
    let monthIdx = 0;
    while (currentMonthDate <= localEndDate && monthIdx < labels.length) {
      const yearMonthKey = `${currentMonthDate.getFullYear()}-${currentMonthDate.getMonth()}`;
      yearMonthToChartIndex.set(yearMonthKey, monthIdx);
      currentMonthDate.setMonth(currentMonthDate.getMonth() + 1);
      monthIdx++;
    }

    for (const projectKey in heartbeatsByProject) {
      const projectBeats = heartbeatsByProject[projectKey];
      for (let i = 0; i < projectBeats.length; i++) {
        const currentBeat = projectBeats[i];
        const previousBeat = i > 0 ? projectBeats[i - 1] : undefined;
        const durationSeconds = calculateInlinedDuration(
          currentBeat,
          previousBeat,
        );
        const ts = currentBeat.timestamp as Date;
        const localYearMonthKey = `${ts.getFullYear()}-${ts.getMonth()}`;
        const index = yearMonthToChartIndex.get(localYearMonthKey);
        if (index !== undefined) {
          result[index] = (result[index] || 0) + durationSeconds / 3600;
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
  let durationSeconds = HEARTBEAT_INTERVAL_SECONDS;
  if (previous) {
    const currentTs = (current.timestamp as Date).getTime();
    const previousTs = (previous.timestamp as Date).getTime();
    const diffSeconds = Math.round((currentTs - previousTs) / 1000);
    if (diffSeconds < MAX_HEARTBEAT_DIFF_SECONDS) {
      durationSeconds = diffSeconds;
    }
  }
  return durationSeconds;
}
</script>

<style lang="scss">
@use "/styles/index.scss";
</style>
