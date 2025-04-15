<template>
  <button @click="$emit('click')">
    <div class="key-container">
      <template v-if="keyName && keyName.includes('+')">
        <template v-for="(part, index) in keyName.split('+')" :key="index">
          <UiKey :keyName="part" />
        </template>
      </template>
      <template v-else>
        <UiKey :keyName="keyName" />
      </template>
    </div>
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

defineEmits(["click"]);
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

.key-container {
  display: flex;
  align-items: center;
  gap: 2px;
}

.key-separator {
  font-family: ChivoMono;
  font-size: 13px;
}
</style>
