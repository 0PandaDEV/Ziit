<template>
  <dialog :open="open" class="list-modal" @close="$emit('close')">
    <div class="header">
      <h2 class="title">{{ title }}</h2>
      <button class="close-button" @click="$emit('close')">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="lucide lucide-x">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    </div>
    <div class="list-content" ref="listContentRef">
      <div
        v-for="item in sortedItems"
        :key="item.name"
        class="item"
        :style="{
          '--percentage': `${
            sortedItems.length > 0 && sortedItems[0].seconds > 0
              ? ((item.seconds / sortedItems[0].seconds) * 100).toFixed(1)
              : 0
          }%`,
        }">
        <div class="name">{{ item.name || "Unknown" }}</div>
        <div class="percentage">{{ calculatePercentage(item.seconds) }}%</div>
        <div class="time">{{ formatTime(item.seconds) }}</div>
      </div>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { PropType } from "vue";

type Item = {
  name: string;
  seconds: number;
};

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    required: true,
  },
  items: {
    type: Array as () => Item[],
    required: true,
  },
  totalSeconds: {
    type: Number,
    required: true,
  },
  formatTime: {
    type: Function as PropType<(seconds: number) => string>,
    required: true,
  },
});

defineEmits(["close"]);

const listContentRef = ref<HTMLElement | null>(null);

const sortedItems = computed(() => {
  return [...props.items].sort((a, b) => b.seconds - a.seconds);
});

const calculatePercentage = (seconds: number): string => {
  if (props.totalSeconds === 0) return "0.0";
  return ((seconds / props.totalSeconds) * 100).toFixed(1);
};

watch(() => props.open, (newOpen) => {
  if (!newOpen && listContentRef.value) {
    listContentRef.value.scrollTop = 0;
  }
});
</script>

<style scoped lang="scss">
.list-modal {
  position: fixed;
  top: 50%;
  left: 50%;
  z-index: 1000;
  transform: translate(-50%, -50%);
  border: 1px solid var(--border);
  padding: 24px;
  max-width: 600px;
  width: 90%;
  background: var(--background);
  color: var(--text);
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: 0px 4px 16px 0px rgba(0, 0, 0, 0.251);
  max-height: 80vh;

  &:not([open]) {
    display: none;
  }

  &::backdrop {
    background-color: rgba(0, 0, 0, 0.5);
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border);

    .title {
      font-size: 18px;
      font-weight: 500;
      margin: 0;
      text-transform: uppercase;
      color: var(--text-secondary);
    }

    .close-button {
      background: none;
      border: none;
      color: var(--text-secondary);
      cursor: pointer;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;

      &:hover {
        color: var(--text);
      }
    }
  }

  .list-content {
    overflow-y: auto;

    .item {
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 1rem;
      align-items: center;
      padding: 8px 10px;
      position: relative;
      overflow: hidden;
      height: 34px;
      margin-bottom: 4px;

      &:last-child {
        margin-bottom: 0;
      }

      &::before {
        content: "";
        position: absolute;
        top: 0;
        left: 0;
        height: 100%;
        width: var(--percentage);
        background: var(--element);
        z-index: 0;
        transition: width 0.3s ease-in-out;
      }

      .name,
      .time,
      .percentage {
        position: relative;
        z-index: 1;
        white-space: nowrap;
      }

      .name {
        font-weight: 500;
        color: var(--text);
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .time {
        text-align: right;
        color: var(--text);
        font-weight: 500;
        min-width: 64px;
      }

      .percentage {
        text-align: right;
        color: var(--text-secondary);
        font-weight: 600;
      }
    }
  }
}
</style> 