<template>
  <Transition name="rules">
    <ul v-if="visible" class="password-rules">
      <li v-for="rule in rules" :key="rule.key" :class="{ met: rule.met }">
        <LucideCheck v-if="rule.met" />
        <LucideCircle v-else />
        <span>{{ rule.short }}</span>
      </li>
    </ul>
  </Transition>
</template>

<script setup lang="ts">
import { LucideCheck, LucideCircle } from "@lucide/vue";

defineProps<{
  rules: Array<{ key: string; short: string; met: boolean }>;
  visible: boolean;
}>();
</script>

<style scoped lang="scss">
.password-rules {
  position: absolute;
  left: calc(100% + 12px);
  top: 0;
  width: 220px;
  margin: 0;
  padding: 12px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background-color: var(--background);
  border: 1px solid var(--border);
  border-radius: 12px;
  font-size: 13px;
  color: var(--text-muted);
  pointer-events: none;
  z-index: 10;

  li {
    display: flex;
    align-items: center;
    gap: 8px;
    transition: color 0.15s;

    svg {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
    }

    &.met {
      color: var(--accent);
    }
  }

  @media (max-width: 760px) {
    left: 0;
    top: auto;
    bottom: calc(100% + 12px);
    width: 100%;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 12px;
    padding: 12px;
  }
}

.rules-enter-active,
.rules-leave-active {
  transition: opacity 0.15s;
}

.rules-enter-from,
.rules-leave-to {
  opacity: 0;
}
</style>
