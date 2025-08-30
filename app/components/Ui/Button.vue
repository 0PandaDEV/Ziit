<template>
  <button @click="$emit('click')" :type="type" :disabled="disabled">
    <div class="key-container" v-if="keyName">
      <template v-if="keyName && keyName.includes('+')">
        <template v-for="(part, index) in keyName.split('+')" :key="index">
          <UiKey :red="red" :keyName="part" />
        </template>
      </template>
      <template v-else>
        <UiKey :red="red" :keyName="keyName" />
      </template>
    </div>
    <p :class="`text ${red ? 'red' : ''}`">{{ text }}</p>
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
  red: Boolean,
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

.red {
  color: #ff5555;
}
</style>
