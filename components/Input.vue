<template>
  <div class="input">
    <component class="icon" v-if="icon" :is="icon" />
    <input 
      :type="type" 
      :placeholder="placeholder" 
      :value="modelValue"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      :readonly="locked"
    />
  </div>
</template>

<script setup lang="ts">
const props = defineProps({
  placeholder: {
    type: String,
  },
  type: {
    type: String,
    default: "text",
  },
  icon: {
    type: Object,
  },
  modelValue: {
    type: String,
    default: "",
  },
  locked: {
    type: Boolean,
    default: false,
  },
});

defineEmits(['update:modelValue']);
</script>

<style lang="scss">
.input {
  padding-inline: 12px;
  display: flex;
  gap: 8px;
  background-color: transparent;
  border: 1px solid var(--border);
  width: 320px;
  height: 40px;
  border-radius: 12px;
  align-items: center;

  .icon {
    color: var(--text);
    width: 16px;
    height: 16px;
  }

  input {
    height: 100%;
    width: 100%;
    outline: none;
    border: none;
    background-color: transparent;
    color: var(--text);
  }
}
</style>
