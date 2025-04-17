<template>
  <div class="toast-container">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      :class="['toast', toast.type]"
      @click="hideById(toast.id)"
    >
      {{ toast.message }}
    </div>
  </div>
</template>

<script setup lang="ts">
const { toasts, hideById } = useToast();
</script>

<style lang="scss">
.toast-container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 20000000;
  align-items: flex-end;
}

.toast {
  padding: 4px 9px;
  font-weight: 400;
  cursor: pointer;
  display: inline-block;
  max-width: 100%;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  &.error {
    background-color: rgba(255, 0, 0, 0.1);
    color: #ff5555;
  }

  &.success {
    background-color: rgba(0, 255, 0, 0.1);
    color: #4caf50;
  }
}
</style>
