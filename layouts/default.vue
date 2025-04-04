<template>
  <div class="layout">
    <Navbar />
    <div class="content">
      <slot />
    </div>
  </div>
</template>

<style scoped lang="scss">
.layout {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding: 24px;
  gap: 24px;
}
</style>
