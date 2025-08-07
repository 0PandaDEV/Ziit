<template>
  <button @click="$emit('click')" :type="type" :disabled="disabled">
    <div class="key-container" v-if="keyName">
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
  text: String,
  keyName: String,
  type: {
    type: String as () => "button" | "submit" | "reset",
    default: "button",
  },
  disabled: {
    type: Boolean,
    default: false,
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
