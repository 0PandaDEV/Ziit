<template>
  <div
    class="select-container"
    @click="toggleDropdown"
    @blur="closeDropdown"
    tabindex="0">
    <div class="dropdown-menu" v-show="isOpen">
      <div
        v-for="(item, index) in items"
        :key="index"
        class="dropdown-item"
        :class="{ selected: selectedItem && selectedItem.value === item.value }"
        @click.stop="selectItem(item)">
        {{ item.label }}
        <div class="key-container" v-if="item.key">
          <template v-if="item.key.includes('+')">
            <span v-for="(part, index) in item.key.split('+')" :key="index">
              <Key :keyName="part" />
            </span>
          </template>
          <template v-else>
            <Key :keyName="item.key" />
          </template>
        </div>
      </div>
    </div>
    <div class="selected-item">
      {{ selectedItem ? selectedItem.label : placeholder }}
      <IconsDownUp v-if="isOpen" />
      <IconsUpDown v-else />
    </div>
  </div>
</template>

<script setup lang="ts" generic="T">
import { ref, computed } from "vue";
import Key from "./Key.vue";

interface SelectItem<V> {
  label: string;
  value: V;
  key?: string;
}

const props = defineProps<{
  items: SelectItem<T>[];
  modelValue?: T;
  placeholder?: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: T];
}>();

const isOpen = ref(false);

const selectedItem = computed<SelectItem<T> | null>(() => {
  if (props.modelValue !== undefined) {
    return props.items.find(item => item.value === props.modelValue) ?? null;
  }
  return null; 
});

const toggleDropdown = () => {
  isOpen.value = !isOpen.value;
};

const closeDropdown = () => {
  isOpen.value = false;
};

const selectItem = (item: SelectItem<T>) => {
  emit("update:modelValue", item.value);
  isOpen.value = false;
};
</script>

<style scoped>
.select-container {
  position: relative;
  cursor: pointer;
  user-select: none;
  outline: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.selected-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dropdown-menu {
  position: absolute;
  bottom: 100%;
  right: 0;
  background-color: var(--background);
  z-index: 10;
  display: flex;
  flex-direction: column;
  margin-bottom: 8px;
  margin-right: -8px;
}

.dropdown-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 146px;
  padding: 8px;
}

.dropdown-item:hover {
  background-color: var(--element);
}

.key-container {
  display: flex;
  align-items: center;
  gap: 2px;
}
</style>
