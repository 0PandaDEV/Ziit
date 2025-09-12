<template>
  <div :class="`key ${red ? 'red' : ''}`">{{ keyName }}</div>
</template>

<script setup lang="ts">
defineProps({
  keyName: String,
  red: Boolean
});
</script>

<style scoped lang="scss">
.key {
  background-color: var(--element);
  padding: 2px 6px;
  font-size: 13px;
  font-family: ChivoMono;
  text-transform: capitalize;
  color: inherit;
}

.red {
  color: #ff5555;
  background-color: #301616;
}
</style>
