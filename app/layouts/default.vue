<template>
  <div class="layout">
    <Navbar />
    <div class="fade-top"></div>
    <div class="content">
      <slot />
    </div>
    <div
      class="fade-bottom"
      :class="{ 'home-page': $route.path === '/' }"></div>
    <div class="bottombar" v-if="$route.path === '/'">
      <p class="coding-time">{{ formattedTime }}</p>
      <UiSelect v-model="selectedTimeRange" :items="timeRangeOptions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import * as statsLib from "~~/lib/stats";
import { watch } from "vue";
import { useTimeRangeOptions } from "~/composables/useTimeRangeOptions";

const stats = ref(statsLib.getStats());
const timeRange = ref(statsLib.getTimeRange());
const { timeRangeOptions } = useTimeRangeOptions();

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

watch([() => statsLib.getStats(), () => statsLib.getTimeRange()], () => {
  stats.value = statsLib.getStats();
  timeRange.value = statsLib.getTimeRange();
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
