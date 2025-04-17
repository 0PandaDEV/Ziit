<template>
  <div class="layout">
    <Navbar />
    <div class="fade-top"></div>
    <div class="content">
      <slot />
    </div>
    <div
      class="fade-bottom"
      :class="{ 'home-page': $route.path === '/' }"
    ></div>
    <div class="bottombar" v-if="$route.path === '/'">
      <p class="coding-time">{{ formattedTime }}</p>
      <UiSelect v-model="selectedTimeRange" :items="timeRangeOptions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import * as statsLib from "~/lib/stats";

const stats = ref(statsLib.getStats());
const timeRange = ref(statsLib.getTimeRange());

const selectedTimeRange = computed({
  get: () => timeRange.value,
  set: (value: statsLib.TimeRange) => {
    statsLib.setTimeRange(value);
    timeRange.value = value;
  },
});

const formattedTime = computed(() => {
  return statsLib.formatTime(stats.value.totalSeconds || 0);
});

const unsubscribe = statsLib.subscribe(() => {
  stats.value = statsLib.getStats();
  timeRange.value = statsLib.getTimeRange();
});

onUnmounted(() => {
  unsubscribe();
});

const timeRangeOptions = computed(() => [
  { label: "Today", value: "today" as statsLib.TimeRange, key: "D" },
  { label: "Yesterday", value: "yesterday" as statsLib.TimeRange, key: "E" },
  { label: "Last 7 Days", value: "week" as statsLib.TimeRange, key: "W" },
  { label: "Last 30 Days", value: "month" as statsLib.TimeRange, key: "T" },
  {
    label: "Last 90 Days",
    value: "last-90-days" as statsLib.TimeRange,
    key: "N",
  },
  {
    label: "Month to Date",
    value: "month-to-date" as statsLib.TimeRange,
    key: "M",
  },
  { label: "Last Month", value: "last-month" as statsLib.TimeRange, key: "P" },
  {
    label: "Year to Date",
    value: "year-to-date" as statsLib.TimeRange,
    key: "Y",
  },
  {
    label: "Last 12 Months",
    value: "last-12-months" as statsLib.TimeRange,
    key: "L",
  },
  { label: "All Time", value: "all-time" as statsLib.TimeRange, key: "A" },
  // {
  //   label: "Custom Range",
  //   value: "custom-range" as statsLib.TimeRange,
  //   key: "C",
  // },
]);
</script>

<style scoped lang="scss">
.layout {
  width: 100dvw;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding: 24px;
}

.content {
  flex: 1;
  overflow-y: auto;
  height: 0;
  margin: 0 -24px;
  padding: 24px;
  position: relative;
}

.fade-top {
  position: absolute;
  top: 42px;
  height: 24px;
  width: calc(100vw - 48px);
  left: 24px;
  background: linear-gradient(
    to bottom,
    var(--background) 20%,
    transparent 100%
  );
  z-index: 5;
  pointer-events: none;
}

.fade-bottom {
  position: absolute;
  bottom: 18px;
  height: 24px;
  left: 24px;
  width: calc(100vw - 48px);
  background: linear-gradient(to top, var(--background) 20%, transparent 100%);
  z-index: 5;
  pointer-events: none;

  &.home-page {
    bottom: 42px;
  }
}

.bottombar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  z-index: 10;
  height: 18px;
  overflow: visible;
  color: var(--text-secondary);
}
</style>
