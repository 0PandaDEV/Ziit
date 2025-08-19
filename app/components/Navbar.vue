<template>
  <div class="navbar">
    <NuxtLink to="/" class="title">
      <svg
        width="44"
        height="12"
        viewBox="0 0 44 12"
        fill="none"
        xmlns="http://www.w3.org/2000/svg">
        <path
          d="M10.262 -9.53674e-07L0.462 -9.53674e-07L0.462 1.96L6.342 1.96L0.462 9.8L10.262 9.8L10.262 7.84L4.3819 7.84L10.262 -9.53674e-07ZM21.154 1.96L21.154 -9.53674e-07L11.354 -9.53674e-07L11.354 1.96L15.274 1.96L15.274 7.84L11.354 7.84L11.354 9.8L21.154 9.8L21.154 7.84L17.234 7.84L17.234 1.96L21.154 1.96ZM32.214 1.96L32.214 -9.53674e-07L22.414 -9.53674e-07L22.414 1.96L26.334 1.96L26.334 7.84L22.414 7.84L22.414 9.8L32.214 9.8L32.214 7.84L28.294 7.84L28.294 1.96L32.214 1.96ZM33.152 -9.53674e-07L33.152 1.96L37.072 1.96L37.072 9.8L39.032 9.8L39.032 1.96L42.952 1.96L42.952 -9.53674e-07L33.152 -9.53674e-07Z"
          transform=""
          fill="#E6E6E6" />
      </svg>
    </NuxtLink>
    <div class="actions">
      <NuxtLink to="/stats">Stats</NuxtLink>
      <NuxtLink to="/leaderboard">Leaderboard</NuxtLink>
      <NuxtLink to="/settings">Settings</NuxtLink>
    </div>
  </div>
</template>

<style lang="scss">
.navbar {
  display: flex;
  justify-content: space-between;
  align-items: center;

  .title {
    display: flex;
    align-items: center;
  }

  .actions {
    display: flex;
    gap: 24px;

    a {
      color: var(--text-secondary);

      &:hover {
        color: var(--text);
      }
    }

    .router-link-active {
      color: var(--text);
    }
  }
}
</style>
