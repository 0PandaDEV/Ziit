<template>
  <div class="layout">
    <Navbar />
    <div class="fade-top"></div>
    <div class="content">
      <slot />
    </div>
  </div>
</template>

<style lang="scss">
.layout {
  width: 100dvw;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding: 24px;
}

.content {
  flex: 1;
  overflow-y: auto;
  height: 0;
  margin: 0 -24px;
  padding: 24px;
  position: relative;
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
</style>
