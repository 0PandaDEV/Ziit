<template>
  <dialog :open="open" class="modal" @close="$emit('close')">
    <div class="text">
      <h2 class="title">{{ title }}</h2>
      <p v-if="description" class="description">{{ description }}</p>
    </div>
    <form @submit.prevent="$emit('save')">
      <slot name="form-content"></slot>
    </form>
    <div class="modal-buttons">
      <UiButton type="button" text="Cancel" @click="$emit('cancel')" />
      <UiButton
        type="submit"
        text="Save"
        :disabled="isLoading"
        @click="$emit('save')" />
    </div>
  </dialog>
</template>

<script setup lang="ts">
defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    required: true,
  },
  isLoading: {
    type: Boolean,
    default: false,
  },
  description: {
    type: String,
  },
});

defineEmits(["cancel", "save", "close"]);
</script>

<style scoped lang="scss">
.modal {
  position: fixed;
  top: 50%;
  left: 50%;
  z-index: 1000;
  transform: translate(-50%, -50%);
  border: 1px solid var(--border);
  padding: 24px;
  max-width: 500px;
  width: 90%;
  background: var(--background);
  color: var(--text);
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: 0px 4px 16px 0px rgba(0, 0, 0, 0.251);

  &:not([open]) {
    display: none;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 4px;

    .title {
      font-size: 18px;
      font-weight: 500;
      margin: 0;
      width: 100%;
    }

    .description {
      color: var(--text-secondary);
      font-size: 14px;
    }
  }

  .modal-buttons {
    display: flex;
    gap: 24px;
    width: 100%;
  }
}
</style>
