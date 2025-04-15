<template>
  <div class="key">{{ keyName }}</div>
</template>

<script setup lang="ts">
defineProps({
  keyName: String
});
</script>

<style lang="scss">
.key {
  background-color: var(--element);
  padding: 2px 6px;
  font-size: 13px;
  font-family: ChivoMono;
  text-transform: capitalize;
  color: inherit;
}
</style>
