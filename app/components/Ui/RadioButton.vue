<template>
  <div class="radio-button" @click="handleClick">
    <div class="circle">
      <div class="inner"></div>
      <div class="selected" v-if="selected"></div>
    </div>
    <p class="text">{{ text }}</p>
  </div>
</template>

<script setup>
const props = defineProps({
  text: String,
  selected: Boolean,
  value: {
    type: [String, Number, Boolean],
    default: null,
  },
});

const emit = defineEmits(["update"]);

const handleClick = () => {
  emit("update", props.value);
};
</script>

<style scoped lang="scss">
.radio-button {
  display: flex;
  align-items: center;
  cursor: pointer;
  display: flex;
  gap: 8px;
}

.circle {
  width: 20px;
  height: 20px;
  position: relative;

  .inner {
    width: 100%;
    height: 100%;
    position: absolute;
    background-color: var(--element);
    border-radius: 50%;
  }

  .selected {
    position: absolute;
    left: 3px;
    top: 3px;
    background-color: var(--text-secondary);
    width: calc(100% - 6px);
    height: calc(100% - 6px);
    border-radius: 50%;
  }
}

.text {
  color: var(--text-secondary);
}
</style>
