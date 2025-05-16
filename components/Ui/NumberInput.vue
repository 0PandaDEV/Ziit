<template>
  <div class="number-input">
    <button
      class="minus"
      @mousedown="startDecrement"
      @mouseup="stopRepeat"
      @mouseleave="stopRepeat"
      :disabled="disabled || modelValue <= min">
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg">
        <g>
          <path
            d="M0 0L9.33333 0"
            fill="none"
            stroke-width="2"
            stroke="#191919"
            stroke-linecap="round"
            stroke-linejoin="round"
            transform="translate(3.333 8)" />
        </g>
      </svg>
    </button>
    <input
      type="text"
      class="number-field"
      :value="modelValue"
      @input="handleInput"
      @blur="validateInput"
      @keydown.enter.prevent="validateInput"
      :tabindex="disabled ? -1 : 0"
      :style="{ width: inputWidth + 'px' }" />
    <button
      class="plus"
      @mousedown="startIncrement"
      @mouseup="stopRepeat"
      @mouseleave="stopRepeat"
      :disabled="disabled || modelValue >= max">
      <svg
        width="15.333"
        height="15.333"
        viewBox="0 0 15.333 15.333"
        fill="none"
        xmlns="http://www.w3.org/2000/svg">
        <g transform="translate(-0 0)">
          <path
            d="M0 4.66667L9.33333 4.66667M4.66667 0L4.66667 9.33333"
            fill="none"
            stroke-width="2"
            stroke="#191919"
            stroke-linecap="round"
            stroke-linejoin="round"
            transform="translate(3 3)" />
        </g>
      </svg>
    </button>
  </div>
</template>

<script setup>
import { computed, ref } from "vue";

const props = defineProps({
  modelValue: Number,
  disabled: Boolean,
  min: Number,
  max: Number,
});

const emit = defineEmits(["update:modelValue"]);
const repeatInterval = ref(null);
const repeatDelay = 100;
const repeatTimeout = 300;

const inputWidth = computed(() => {
  const charWidth = 7.2;
  const padding = 4;
  const minWidth = 0;
  const width = String(props.modelValue).length * charWidth + padding;
  return Math.max(width, minWidth);
});

const updateValue = (value) => {
  const boundedValue = Math.max(props.min, Math.min(props.max, value));
  emit("update:modelValue", boundedValue);
};

const startIncrement = () => {
  updateValue(Number(model.value) + 1);
  repeatInterval.value = setTimeout(() => {
    repeatInterval.value = setInterval(() => {
      updateValue(Number(model.value) + 1);
    }, repeatDelay);
  }, repeatTimeout);
};

const startDecrement = () => {
  updateValue(Number(model.value) - 1);
  repeatInterval.value = setTimeout(() => {
    repeatInterval.value = setInterval(() => {
      updateValue(Number(model.value) - 1);
    }, repeatDelay);
  }, repeatTimeout);
};

const stopRepeat = () => {
  if (repeatInterval.value) {
    clearInterval(repeatInterval.value);
    repeatInterval.value = null;
  }
};

const handleInput = (e) => {
  const value = e.target.value.trim();
  if (value === "") {
    e.target.value = String(props.min);
    updateValue(props.min);
    return;
  }
  if (/^\d*$/.test(value)) {
    updateValue(Number(value));
  } else {
    e.target.value = props.modelValue;
  }
};

const validateInput = (e) => {
  e.target.value = props.modelValue;
};
</script>

<style scoped lang="scss">
.number-input {
  display: flex;
  align-items: center;
  height: 36px;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  gap: 12px;
  width: min-content;

  .number-field {
    border: none;
    background: none;
    text-align: center;
    color: var(--text);
    font-family: inherit;
    font-size: 14px;
    padding: 0;
    flex-grow: 0;
    outline: none;
    cursor: text;
  }

  button {
    border-radius: 9px;
    aspect-ratio: 1;
    width: 34px;
    height: 34px;
    border: none;
    background: none;
    cursor: pointer;
    font-family: inherit;
    display: flex;
    align-items: center;
    justify-content: center;

    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  }

  .minus {
    background-color: var(--text-secondary);
  }

  .plus {
    background-color: var(--text);
  }
}
</style>
