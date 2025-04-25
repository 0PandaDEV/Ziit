<template>
  <NuxtLayout name="default">
    <div class="stats-dashboard">
      <div class="chart-container">
        <div class="chart" ref="chartContainer"></div>
      </div>

      <div class="metrics-tables">
        <div class="section">
          <div class="text">
            <h2>PROJECTS</h2>
            <p class="extend" @click="openListModal('Projects', sortedProjects)">
              <Maximize :size="16" />
              DETAILS
            </p>
          </div>
          <div class="list">
            <div
              v-for="project in sortedProjects.slice(0, 8)"
              :key="project.name"
              class="item"
              :style="{
                '--percentage': `${
                  sortedProjects.length > 0 && sortedProjects[0].seconds > 0
                    ? ((project.seconds / sortedProjects[0].seconds) * 100).toFixed(1)
                    : 0
                }%`,
              }">
              <div class="name">{{ project.name }}</div>
              <div class="percentage">
                {{ ((project.seconds / stats.totalSeconds) * 100).toFixed(1) }}%
              </div>
              <div class="time">{{ formatTime(project.seconds) }}</div>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="text">
            <h2>LANGUAGES</h2>
            <p class="extend" @click="openListModal('Languages', languageBreakdown)">
              <Maximize :size="16" />
              DETAILS
            </p>
          </div>
          <div class="list">
            <div
              v-for="language in languageBreakdown.slice(0, 8)"
              :key="language.name"
              class="item"
              :style="{
                '--percentage': `${
                  languageBreakdown.length > 0 && languageBreakdown[0].seconds > 0
                    ? ((language.seconds / languageBreakdown[0].seconds) * 100).toFixed(1)
                    : 0
                }%`,
              }">
              <div class="name">{{ language.name || "Unknown" }}</div>
              <div class="percentage">
                {{ ((language.seconds / stats.totalSeconds) * 100).toFixed(1) }}%
              </div>
              <div class="time">
                {{ formatTime(language.seconds) }}
              </div>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="text">
            <h2>EDITORS</h2>
            <p class="extend" @click="openListModal('Editors', editorBreakdown)">
              <Maximize :size="16" />
              DETAILS
            </p>
          </div>
          <div class="list">
            <div
              v-for="editor in editorBreakdown.slice(0, 8)"
              :key="editor.name"
              class="item"
              :style="{
                '--percentage': `${
                  editorBreakdown.length > 0 && editorBreakdown[0].seconds > 0
                    ? ((editor.seconds / editorBreakdown[0].seconds) * 100).toFixed(1)
                    : 0
                }%`,
              }">
              <div class="name">{{ editor.name || "Unknown" }}</div>
              <div class="percentage">
                {{ ((editor.seconds / stats.totalSeconds) * 100).toFixed(1) }}%
              </div>
              <div class="time">
                {{ formatTime(editor.seconds) }}
              </div>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="text">
            <h2>OPERATING SYSTEMS</h2>
            <p class="extend" @click="openListModal('Operating Systems', osBreakdown)">
              <Maximize :size="16" />
              DETAILS
            </p>
          </div>
          <div class="list">
            <div
              v-for="os in osBreakdown.slice(0, 8)"
              :key="os.name"
              class="item"
              :style="{
                '--percentage': `${
                  osBreakdown.length > 0 && osBreakdown[0].seconds > 0
                    ? ((os.seconds / osBreakdown[0].seconds) * 100).toFixed(1)
                    : 0
                }%`,
              }">
              <div class="name">{{ os.name || "Unknown" }}</div>
              <div class="percentage">
                {{ ((os.seconds / stats.totalSeconds) * 100).toFixed(1) }}%
              </div>
              <div class="time">
                {{ formatTime(os.seconds) }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <UiListModal
      :open="showListModal"
      :title="modalTitle"
      :items="modalItems"
      :totalSeconds="stats.totalSeconds"
      :formatTime="formatTime"
      @close="showListModal = false" />
  </NuxtLayout>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { Maximize } from "lucide-vue-next";
import type { User } from "@prisma/client";
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
} from "chart.js";
import { useTimeRangeOptions } from "~/composables/useTimeRangeOptions";
import UiListModal from "~/components/Ui/ListModal.vue";

Chart.register(
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  LineController,
  Tooltip,
  Filler
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

const showListModal = ref(false);
const modalTitle = ref("");
const modalItems = ref<ItemWithTime[]>([]);

const stats = ref(statsLib.getStats());
const timeRange = ref(statsLib.getTimeRange());
const { formatTime } = statsLib;
const { timeRangeOptions } = useTimeRangeOptions();

watch(
  [() => statsLib.getStats(), () => statsLib.getTimeRange()],
  ([newStats, newTimeRange]) => {
    stats.value = newStats;
    timeRange.value = newTimeRange;
  }
);

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
  { immediate: true, deep: true }
);

const sortedProjects = computed(() => {
  if (!stats.value || !stats.value.projects) return [];

  const projects: ItemWithTime[] = Object.entries(stats.value.projects).map(
    ([name, seconds]) => ({
      name,
      seconds: seconds as number,
    })
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
    })
  );

  return languages.sort((a, b) => b.seconds - a.seconds);
});

const editorBreakdown = computed(() => {
  if (!stats.value || !stats.value.editors) return [];

  const editors: ItemWithTime[] = Object.entries(stats.value.editors).map(
    ([name, seconds]) => ({
      name: name || "Unknown",
      seconds: seconds as number,
    })
  );

  return editors.sort((a, b) => b.seconds - a.seconds);
});

const osBreakdown = computed(() => {
  if (!stats.value || !stats.value.os) return [];

  const osArray: ItemWithTime[] = Object.entries(stats.value.os).map(
    ([name, seconds]) => ({
      name: name || "Unknown",
      seconds: seconds as number,
    })
  );

  return osArray.sort((a, b) => b.seconds - a.seconds);
});

function openListModal(title: string, items: ItemWithTime[]) {
  modalTitle.value = title;
  modalItems.value = items;
  showListModal.value = true;
}

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
  timeRangeOptions.value.forEach(
    (option: { key: string; value: statsLib.TimeRange }) => {
      if (option.key && option.value) {
        keyboard.prevent.down(
          [Key[option.key as keyof typeof Key]],
          async () => {
            statsLib.setTimeRange(option.value);
          }
        );
      }
    }
  );

  keyboard.down([Key.F], async () => {
    useToast().success("You payed respect to the easter egg");
  });

  if (chartContainer.value) {
    renderChart();
  }
});

onUnmounted(() => {
  keyboard.clear();
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
      Filler
    );

    const ctx = document.createElement("canvas");
    chartContainer.value?.appendChild(ctx);

    const chartConfig = getChartConfig();

    chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: chartConfig.labels,
        datasets: [
          {
            label: "Coding Time (hours)",
            data: chartConfig.data,
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
                size: 12,
                family: "ChivoMono",
              },
              color: "#666666",
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
                size: 12,
                family: "ChivoMono",
              },
              color: "#666666",
              padding: 8,
              callback: function (value) {
                const numValue = Number(value);
                if (numValue === 0) return "0m";
                const hours = Math.floor(numValue);
                const minutes = Math.round((numValue - hours) * 60);
                if (hours === 0) return minutes > 0 ? `${minutes}m` : "0h";
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
            titleFont: {
              family: "ChivoMono",
              weight: 500,
              size: 14,
            },
            bodyFont: {
              family: "ChivoMono",
              size: 14,
            },
            callbacks: {
              title: function (tooltipItems) {
                return tooltipItems[0].label;
              },
              label: function (context) {
                const value = context.parsed.y || 0;
                const numValue = Number(value);
                const hours = Math.floor(numValue);
                const minutes = Math.round((numValue - hours) * 60);
                return `${hours}h ${minutes > 0 ? `${minutes}m` : ""}`;
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

  const chartConfig = getChartConfig();
  chart.data.labels = chartConfig.labels;
  chart.data.datasets[0].data = chartConfig.data;
  chart.update();
}

function getChartConfig() {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  let labels: string[] = [];
  let data: number[] = [];

  const getDateLabel = (date: Date) =>
    `${date.getDate()} ${months[date.getMonth()]}`;
  const getMonthLabel = (date: Date) => months[date.getMonth()];
  const getMonthYearLabel = (date: Date) =>
    `${months[date.getMonth()]} ${date.getFullYear()}`;
  const getHourLabel = (hour: number) =>
    `${hour.toString().padStart(2, "0")}:00`;

  switch (timeRange.value) {
    case "today":
    case "yesterday": {
      labels = Array.from({ length: 24 }, (_, i) => getHourLabel(i));
      data = Array(24).fill(0);

      return {
        labels,
        data: getSingleDayChartData(data),
      };
    }

    case "week": {
      labels = Array.from({ length: 7 }, (_, i) => {
        const date = new Date(yesterday);
        date.setDate(date.getDate() - i);
        return getDateLabel(date);
      }).reverse();

      data = processSummaries(labels);
      return { labels, data };
    }

    case "month":
    case "last-90-days": {
      const daysToGoBack = timeRange.value === "month" ? 29 : 89;
      const startDate = new Date(yesterday);
      startDate.setDate(startDate.getDate() - daysToGoBack);

      const days: Date[] = [];
      let currentDate = new Date(startDate);
      while (currentDate <= yesterday) {
        days.push(new Date(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
      }

      labels = days.map(getDateLabel);
      data = processSummaries(labels);
      return { labels, data };
    }

    case "month-to-date": {
      const startDate = new Date(yesterday);
      startDate.setDate(1);

      const days: Date[] = [];
      let currentDate = new Date(startDate);
      while (currentDate <= yesterday) {
        days.push(new Date(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
      }

      labels = days.map(getDateLabel);
      data = processSummaries(labels);
      return { labels, data };
    }

    case "last-month": {
      const lastMonthStart = new Date(
        today.getFullYear(),
        today.getMonth() - 1,
        1
      );
      const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);

      const days: Date[] = [];
      let currentDate = new Date(lastMonthStart);
      while (currentDate <= lastMonthEnd) {
        days.push(new Date(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
      }

      labels = days.map(getDateLabel);
      data = processSummaries(labels);
      return { labels, data };
    }

    case "year-to-date":
    case "last-12-months": {
      const monthCount =
        timeRange.value === "year-to-date" ? today.getMonth() + 1 : 12;

      labels = Array.from({ length: monthCount }, (_, i) => {
        const monthIndex = (today.getMonth() - i + 12) % 12;
        return months[monthIndex];
      }).reverse();

      data = Array(labels.length).fill(0);

      if (!stats.value?.summaries?.length) {
        return { labels, data };
      }

      const monthlyTotals = new Map<string, number>();
      for (const summary of stats.value.summaries) {
        const date = new Date(summary.date);
        const monthName = months[date.getMonth()];
        monthlyTotals.set(
          monthName,
          (monthlyTotals.get(monthName) || 0) + summary.totalSeconds / 3600
        );
      }

      for (let i = 0; i < labels.length; i++) {
        const totalHours = monthlyTotals.get(labels[i]) || 0;
        data[i] = totalHours;
      }

      return { labels, data };
    }

    case "all-time": {
      if (stats.value?.summaries?.length > 0) {
        const dates = stats.value.summaries.map(
          (summary) => new Date(summary.date)
        );
        const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
        const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));

        if (maxDate.getFullYear() - minDate.getFullYear() > 0) {
          const monthsWithYears: Date[] = [];
          let currentDate = new Date(
            minDate.getFullYear(),
            minDate.getMonth(),
            1
          );

          while (currentDate <= maxDate) {
            monthsWithYears.push(new Date(currentDate));
            currentDate.setMonth(currentDate.getMonth() + 1);
          }

          labels = monthsWithYears.map(getMonthYearLabel);
          data = Array(labels.length).fill(0);

          for (const summary of stats.value.summaries) {
            const date = new Date(summary.date);
            const labelKey = getMonthYearLabel(date);
            const labelIndex = labels.indexOf(labelKey);

            if (labelIndex !== -1) {
              data[labelIndex] += summary.totalSeconds / 3600;
            }
          }

          return { labels, data };
        }
      }

      labels = Array.from({ length: 12 }, (_, i) => {
        const date = new Date(today);
        date.setMonth(date.getMonth() - i);
        return getMonthLabel(date);
      }).reverse();

      data = Array(labels.length).fill(0);

      if (stats.value?.summaries?.length) {
        for (const summary of stats.value.summaries) {
          const date = new Date(summary.date);
          const monthName = months[date.getMonth()];
          const labelIndex = labels.indexOf(monthName);

          if (labelIndex !== -1) {
            data[labelIndex] += summary.totalSeconds / 3600;
          }
        }
      }

      return { labels, data };
    }

    default: {
      labels = Array.from({ length: 30 }, (_, i) => {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        return getDateLabel(date);
      }).reverse();

      data = processSummaries(labels);
      return { labels, data };
    }
  }
}

function processSummaries(labels: string[]): number[] {
  const result = Array(labels.length).fill(0);
  if (!stats.value?.summaries?.length) return result;

  const labelMap = new Map<string, number>();
  for (let i = 0; i < labels.length; i++) {
    labelMap.set(labels[i], i);
  }

  for (const summary of stats.value.summaries) {
    const date = new Date(summary.date);
    const dateString = `${date.getDate()} ${months[date.getMonth()]}`;
    const index = labelMap.get(dateString);

    if (index !== undefined) {
      result[index] += summary.totalSeconds / 3600;
    }
  }

  return result;
}

function getSingleDayChartData(result: number[]): number[] {
  if (
    stats.value?.summaries?.length > 0 &&
    stats.value.summaries[0].hourlyData
  ) {
    const summary = stats.value.summaries[0];

    for (let hour = 0; hour < 24; hour++) {
      result[hour] = summary.hourlyData[hour].seconds / 3600;
    }

    return result;
  }

  const relevantHeartbeats = stats.value?.heartbeats;

  if (!relevantHeartbeats?.length) return result;

  const now = new Date();
  let startDate, endDate;

  if (timeRange.value === statsLib.TimeRangeEnum.TODAY) {
    startDate = new Date(now);
    startDate.setHours(0, 0, 0, 0);

    endDate = new Date(now);
    endDate.setHours(23, 59, 59, 999);
  } else {
    const yesterdayDate = new Date(now);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);

    startDate = new Date(yesterdayDate);
    startDate.setHours(0, 0, 0, 0);

    endDate = new Date(yesterdayDate);
    endDate.setHours(23, 59, 59, 999);
  }

  const filteredHeartbeats = relevantHeartbeats.filter((hb) => {
    const timestamp =
      typeof hb.timestamp === "string" ? parseInt(hb.timestamp) : hb.timestamp;
    const hbDate = new Date(timestamp);
    const hbTime = hbDate.getTime();

    return hbTime >= startDate.getTime() && hbTime <= endDate.getTime();
  });

  const heartbeatsByProject = groupHeartbeatsByProject(filteredHeartbeats);

  for (const projectKey in heartbeatsByProject) {
    const projectBeats = heartbeatsByProject[projectKey].sort((a, b) => {
      const aTime =
        typeof a.timestamp === "string"
          ? parseInt(a.timestamp)
          : Number(a.timestamp);
      const bTime =
        typeof b.timestamp === "string"
          ? parseInt(b.timestamp)
          : Number(b.timestamp);
      return aTime - bTime;
    });

    for (let i = 0; i < projectBeats.length; i++) {
      const currentBeat = projectBeats[i];
      const previousBeat = i > 0 ? projectBeats[i - 1] : undefined;
      const durationSeconds = calculateInlinedDuration(
        currentBeat,
        previousBeat
      );

      const timestamp =
        typeof currentBeat.timestamp === "string"
          ? parseInt(currentBeat.timestamp)
          : Number(currentBeat.timestamp);

      const ts = new Date(timestamp);
      const localHour = ts.getHours();

      if (localHour >= 0 && localHour < 24) {
        result[localHour] += durationSeconds / 3600;
      }
    }
  }

  return result;
}

function calculateInlinedDuration(
  current: Heartbeat,
  previous?: Heartbeat
): number {
  const keystrokeTimeoutSecs = statsLib.getKeystrokeTimeout() * 60;

  if (!previous) {
    return HEARTBEAT_INTERVAL_SECONDS;
  }

  const currentTs =
    typeof current.timestamp === "string"
      ? parseInt(current.timestamp)
      : Number(current.timestamp);

  const previousTs =
    typeof previous.timestamp === "string"
      ? parseInt(previous.timestamp)
      : Number(previous.timestamp);

  const diffSeconds = Math.round((currentTs - previousTs) / 1000);

  if (diffSeconds < keystrokeTimeoutSecs) {
    return diffSeconds;
  } else {
    return HEARTBEAT_INTERVAL_SECONDS;
  }
}

function groupHeartbeatsByProject(
  heartbeats: Heartbeat[]
): Record<string, Heartbeat[]> {
  const result: Record<string, Heartbeat[]> = {};

  for (const hb of heartbeats) {
    const projectKey = hb.project || "unknown";
    if (!result[projectKey]) {
      result[projectKey] = [];
    }
    result[projectKey].push(hb);
  }

  return result;
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

definePageMeta({ scrollToTop: true });
</script>

<style lang="scss">
@use "/styles/index.scss";
</style>
