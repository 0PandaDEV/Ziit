<template>
  <div class="layout">
    <Navbar />
    <div class="fade-top"></div>
    <div class="content">
      <slot />
    </div>
    <div class="fade-bottom"></div>
  </div>
</template>

<style scoped lang="scss">
.layout {
  width: 100dvw;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding: 24px;
  padding-bottom: 0;
}

.content {
  flex: 1;
  overflow-y: auto;
  height: 0;
  margin: 0 -24px;
  padding: 24px;
  padding-bottom: 0;
  position: relative;
  padding-bottom: 24px;
}

.fade-top {
  position: absolute;
  top: 42px;
  height: 24px;
  width: calc(100vw - 48px);
  left: 24px;
  background: linear-gradient(
    to bottom,
    var(--background) 20%,
    transparent 100%
  );
  z-index: 5;
  pointer-events: none;
}

.fade-bottom {
  position: absolute;
  bottom: 0;
  height: 24px;
  left: 24px;
  width: calc(100vw - 48px);
  background: linear-gradient(to top, var(--background) 20%, transparent 100%);
  z-index: 5;
  pointer-events: none;
}
</style>
