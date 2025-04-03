<template>
  <main>
    <Navbar />
    <slot />
  </main>
</template>

<style scoped lang="scss">
main {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 24px;
}
</style>
