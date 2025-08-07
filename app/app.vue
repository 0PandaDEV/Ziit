<template>
  <div>
    <NuxtPwaManifest />
    <UiToast />
    <NuxtPage />
  </div>
</template>

<script setup lang="ts">
import { Key } from "@waradu/keyboard";

useKeybind(
  [Key.F],
  async () => {
    useToast().success("You payed respect to the easter egg");
  },
  { ignoreIfEditable: true }
);
</script>

<style lang="scss">
:root {
  --background: #191919;
  --element: #2b2b2b;
  --border: #ffffff1a;

  --accent: #ff6200;

  --text: #e6e6e6;
  --text-secondary: #a6a6a6;
  --text-muted: #666666;
}

@font-face {
  font-family: ChivoMono;
  src: url("~~/fonts/ChivoMono.woff2") format("woff2");
  font-display: swap;
  font-weight: normal;
  font-style: normal;
  font-weight: 400;
}

@font-face {
  font-family: Outfit;
  src: url("~~/fonts/Outfit.woff2") format("woff2");
  font-display: swap;
  font-weight: normal;
  font-style: normal;
  font-weight: 100 900;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  background-color: var(--background);
  color: var(--text);
  font-size: 14px;
  font-family: Outfit;
  overflow-x: hidden;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  scrollbar-color: var(--text-secondary) transparent;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-track {
    background: var(--background);
  }

  &::-webkit-scrollbar-thumb {
    background: var(--text-secondary);
  }
}

button,
input {
  font-family: Outfit;
  font-size: 14px;
}

a {
  text-decoration: none;
  color: var(--text);
}
</style>
