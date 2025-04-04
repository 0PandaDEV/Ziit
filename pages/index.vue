<template>
  <NuxtLayout name="default">
    <div class="stats-dashboard">
      <div class="chart-container">
        <div class="chart" ref="chartContainer"></div>
      </div>

      <div class="metrics-tables">
        <div class="projects-section" v-if="stats">
          <h2>TOP PROJECTS</h2>
          <div class="projects-list">
            <div
              v-for="project in sortedProjects.slice(0, 10)"
              :key="project.name"
              class="project-item">
              <div class="project-name">{{ project.name }}</div>
              <div class="project-time">{{ formatTime(project.seconds) }}</div>
              <div class="project-percentage">
                {{ ((project.seconds / stats.totalSeconds) * 100).toFixed(1) }}%
              </div>
            </div>
          </div>
        </div>

        <div
          class="languages-section"
          v-if="stats && languageBreakdown.length > 0">
          <h2>TOP LANGUAGES</h2>
          <div class="language-list">
            <div
              v-for="language in languageBreakdown.slice(0, 10)"
              :key="language.name"
              class="language-item">
              <div class="language-name">{{ language.name || "Unknown" }}</div>
              <div class="language-time">
                {{ formatTime(language.seconds) }}
              </div>
              <div class="language-percentage">
                {{
                  ((language.seconds / stats.totalSeconds) * 100).toFixed(1)
                }}%
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
import { useStats } from "~/composables/useStats";
import Key from "~/components/Key.vue";
import { keyboard } from "wrdu-keyboard";

const { stats, timeRange, fetchStats, setTimeRange, formatTime } = useStats();

interface Project {
  name: string;
  seconds: number;
}

interface Language {
  name: string;
  seconds: number;
}

const chartContainer = ref<HTMLElement | null>(null);
const projectSort = ref<"time" | "name">("time");
const uniqueFiles = ref(0);
const uniqueLanguages = ref(0);
let chart: any = null;

watch(
  timeRange,
  async (newTimeRange) => {
    await fetchStats();
    if (stats.value) {
      uniqueFiles.value = stats.value.files?.length || 0;
      uniqueLanguages.value = Object.keys(stats.value.languages || {}).length;
    }
    if (chart) {
      updateChart();
    }
  },
  { immediate: true }
);

const sortedProjects = computed(() => {
  if (!stats.value || !stats.value.projects) return [];

  const projects: Project[] = Object.entries(stats.value.projects).map(
    ([name, seconds]) => ({
      name,
      seconds,
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

  const languages: Language[] = Object.entries(stats.value.languages).map(
    ([name, seconds]) => ({
      name: name || "Unknown",
      seconds,
    })
  );

  return languages.sort((a, b) => b.seconds - a.seconds);
});

onMounted(() => {
  setupKeyboardShortcuts();

  if (chartContainer.value) {
    renderChart();
  }

  setInterval(async () => {
    await fetchStats();
    if (stats.value) {
      uniqueFiles.value = stats.value.files?.length || 0;
      uniqueLanguages.value = Object.keys(stats.value.languages || {}).length;
    }
    if (chart) updateChart();
  }, 60000);
});

onUnmounted(() => {
  keyboard.clear();
});

function setupKeyboardShortcuts() {
  keyboard.prevent.down([Key.D], () => setTimeRange("today"));
  keyboard.prevent.down([Key.E], () => setTimeRange("yesterday"));
  keyboard.prevent.down([Key.W], () => setTimeRange("week"));
  keyboard.prevent.down([Key.T], () => setTimeRange("month"));
  keyboard.prevent.down([Key.N], () => setTimeRange("last-month"));
  keyboard.prevent.down([Key.Y], () => setTimeRange("year-to-date"));
  keyboard.prevent.down([Key.L], () => setTimeRange("last-12-months"));
  keyboard.prevent.down([Key.A], () => setTimeRange("all-time"));
  keyboard.prevent.down([Key.C], () => setTimeRange("custom-range"));
}

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

            borderColor: "rgb(97, 116, 204)",
            borderWidth: 1.5,
            pointBackgroundColor: "rgb(97, 116, 204)",
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
  if (!stats.value || !stats.value.dailyData) return [];

  let count;

  if (timeRange.value === "today" || timeRange.value === "yesterday") {
    count = 24;
  } else if (timeRange.value === "week") {
    count = 7;
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

    const diffTime = Math.abs(today.getTime() - startDate.getTime());
    count = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  } else if (
    timeRange.value === "year-to-date" ||
    timeRange.value === "last-12-months"
  ) {
    count = timeRange.value === "year-to-date" ? new Date().getMonth() + 1 : 12;
  } else {
    count = 30;
  }

  const result = Array(count).fill(0);

  if (timeRange.value === "today" || timeRange.value === "yesterday") {
    const targetDate =
      timeRange.value === "today"
        ? new Date().toISOString().split("T")[0]
        : new Date(new Date().setDate(new Date().getDate() - 1))
            .toISOString()
            .split("T")[0];

    const dayData = stats.value.dailyData.find(
      (day) => day.date === targetDate
    );

    if (dayData) {
      const totalSeconds = dayData.totalSeconds || 0;

      const workingHours = [9, 10, 11, 12, 13, 14, 15, 16, 17];
      const distribution = [0.12, 0.14, 0.16, 0.1, 0.06, 0.12, 0.14, 0.1, 0.06];

      workingHours.forEach((hour, index) => {
        result[hour] = (totalSeconds * distribution[index]) / 3600;
      });
    }
  } else if (timeRange.value === "week") {
    const today = new Date();

    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split("T")[0];

      const dayData = stats.value.dailyData.find((day) => day.date === dateStr);
      if (dayData) {
        result[6 - i] = dayData.totalSeconds / 3600;
      }
    }
  } else if (
    timeRange.value === "month" ||
    timeRange.value === "month-to-date" ||
    timeRange.value === "last-month"
  ) {
    const today = new Date();
    let startDate = new Date();
    let endDate = new Date(today);

    if (timeRange.value === "month") {
      startDate.setDate(today.getDate() - 30);
    } else if (timeRange.value === "month-to-date") {
      startDate.setDate(1);
    } else if (timeRange.value === "last-month") {
      startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      endDate = new Date(today.getFullYear(), today.getMonth(), 0);
    }

    let currentDate = new Date(startDate);
    let index = 0;

    while (currentDate <= endDate && index < count) {
      const dateStr = currentDate.toISOString().split("T")[0];
      const dayData = stats.value.dailyData.find((day) => day.date === dateStr);

      if (dayData) {
        result[index] = dayData.totalSeconds / 3600;
      }

      currentDate.setDate(currentDate.getDate() + 1);
      index++;
    }
  } else if (
    timeRange.value === "year-to-date" ||
    timeRange.value === "last-12-months"
  ) {
    const today = new Date();
    const monthlyData = new Map<string, number>();

    let startMonth, startYear;

    if (timeRange.value === "year-to-date") {
      startMonth = 0;
      startYear = today.getFullYear();
    } else {
      startMonth = today.getMonth() + 1;
      startYear = today.getFullYear() - 1;
    }

    stats.value.dailyData.forEach((day) => {
      const date = new Date(day.date);
      const yearMonth = `${date.getFullYear()}-${date.getMonth()}`;

      if (!monthlyData.has(yearMonth)) {
        monthlyData.set(yearMonth, 0);
      }

      monthlyData.set(
        yearMonth,
        monthlyData.get(yearMonth)! + day.totalSeconds / 3600
      );
    });

    for (let i = 0; i < count; i++) {
      const month = (startMonth + i) % 12;
      const year = startYear + Math.floor((startMonth + i) / 12);
      const key = `${year}-${month}`;

      if (monthlyData.has(key)) {
        result[i] = monthlyData.get(key)!;
      }
    }
  } else {
    const today = new Date();

    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split("T")[0];

      const dayData = stats.value.dailyData.find((day) => day.date === dateStr);
      if (dayData) {
        result[29 - i] = dayData.totalSeconds / 3600;
      }
    }
  }

  return result;
}
</script>

<style lang="scss">
@use "/styles/index.scss";
</style>
