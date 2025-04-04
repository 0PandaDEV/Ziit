<template>
  <div>
    <NuxtPage />
  </div>
</template>

<style lang="scss">
:root {
  --background: #191919;
  --element: #2b2b2b;
  --border: #ffffff1a;

  --text: #e6e6e6;
  --text-secondary: #a6a6a6;
}

@font-face {
  font-family: ChivoMono;
  src: url("/fonts/ChivoMono.woff2") format("woff2");
  font-display: swap;
  font-weight: normal;
  font-style: normal;
  font-weight: 400;
}

@font-face {
  font-family: Outfit;
  src: url("/fonts/Outfit.woff2") format("woff2");
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
}

button,
input {
  font-family: Outfit;
  font-size: 14px;
}

a{
  text-decoration: none;
  color: var(--text);
}
</style>
