<template>
  <div class="navbar">
    <NuxtLink to="/" class="title">ZIIT</NuxtLink>
    <div class="actions">
      <NuxtLink to="/profile">Profile</NuxtLink>
    </div>
  </div>
</template>

<style lang="scss">
.navbar {
  display: flex;
  justify-content: space-between;

  .title {
    font-family: Overt;
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
  }
}
</style>
