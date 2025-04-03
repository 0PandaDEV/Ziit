<template>
  <button @click="$emit('click')">
    <Key :keyName="keyName" />
    <p class="text">{{ text }}</p>
  </button>
</template>

<script setup lang="ts">
defineProps({
  text: {
    type: String,
  },
  keyName: {
    type: String,
  },
});

defineEmits(['click']);
</script>

<style scoped lang="scss">
button {
  display: flex;
  gap: 8px;
  align-items: center;
  background-color: transparent;
  outline: none;
  border: none;
  color: var(--text-secondary);

  &:hover {
    color: var(--text);
  }
}
</style>
