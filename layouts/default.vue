<template>
  <div class="layout">
    <Navbar />
    <div class="fade-top"></div>
    <div class="content">
      <slot />
    </div>
    <div class="fade-bottom"></div>
    <div class="bottombar" v-if="$route.path === '/'">
      <p class="coding-time">{{ formatTime(stats?.totalSeconds || 0) }}</p>
      <Select v-model="selectedTimeRange" :items="timeRangeOptions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, computed } from "vue";
import { useStats } from "~/composables/useStats";
import type { TimeRange } from "~/composables/useStats";

const { stats, fetchStats, formatTime, timeRange, setTimeRange } = useStats();

const selectedTimeRange = ref<TimeRange>(timeRange.value);

const timeRangeOptions = computed(() => [
  { label: "Today", value: "today" as TimeRange, key: "D" },
  { label: "Yesterday", value: "yesterday" as TimeRange, key: "E" },
  { label: "Last 7 Days", value: "week" as TimeRange, key: "W" },
  { label: "Last 30 Days", value: "month" as TimeRange, key: "T" },
  { label: "Month to Date", value: "month-to-date" as TimeRange, key: "M" },
  { label: "Last Month", value: "last-month" as TimeRange, key: "N" },
  { label: "Year to Date", value: "year-to-date" as TimeRange, key: "Y" },
  { label: "Last 12 Months", value: "last-12-months" as TimeRange, key: "L" },
  { label: "All Time", value: "all-time" as TimeRange, key: "A" },
  { label: "Custom Range", value: "custom-range" as TimeRange, key: "C" },
]);

watch(selectedTimeRange, (newValue, oldValue) => {
  if (newValue !== oldValue) {
    setTimeRange(newValue);
  }
});

watch(timeRange, (newValue, oldValue) => {
  if (newValue !== oldValue) {
    selectedTimeRange.value = newValue;
  }
});

onMounted(async () => {
  await fetchStats();
});
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
  bottom: 42px;
  height: 24px;
  left: 24px;
  width: calc(100vw - 48px);
  background: linear-gradient(to top, var(--background) 20%, transparent 100%);
  z-index: 5;
  pointer-events: none;
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
