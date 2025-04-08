<template>
  <div class="error-message">{{ message }}</div>
</template>

<script setup lang="ts">
defineProps<{
  message: string;
}>();
</script>

<style lang="scss">
.error-message {
  background-color: rgba(255, 0, 0, 0.1);
  color: #ff5555;
  padding: 4px 9px;
  margin-top: 8px;
  width: max-content;
  align-self: center;
}
</style>
