<template>
  <div class="key">{{ keyName }}</div>
</template>

<script setup lang="ts">
defineProps({
  keyName: {
    type: String,
  },
});
</script>

<style lang="scss">
.key {
  background-color: var(--element);
  padding: 2px 6px;
  font-size: 13px;
  font-family: DepartureMono;
  text-transform: capitalize;
  color: inherit;
}
</style>
