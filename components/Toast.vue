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
  flex-direction: column-reverse;
  gap: 8px;
  z-index: 2000;
}

.toast {
  padding: 4px 9px;
  font-weight: 400;
  cursor: pointer;

  &.error {
    background-color: #dcc2bc;
    color: #ff5555;
  }

  &.success {
    background-color: #e6f4e6;
    color: #4CAF50;
  }
}
</style>
