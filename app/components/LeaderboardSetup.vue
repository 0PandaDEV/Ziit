<template>
  <div class="leaderboard-setup">
    <div class="text">
      <h2 class="title">Do you want participate in the public Leaderboard?</h2>
      <p class="description">
        No personal information is exposed except the unique user ID.
      </p>
    </div>
    <div class="buttons">
      <UiButton text="Yes" keyName="Alt+Y" @click="setLeaderboard(true)" />
      <UiButton text="No" keyName="Alt+N" @click="setLeaderboard(false)" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { User } from "@prisma/client";
import { Key } from "@waradu/keyboard";

const userState = useState<User | null>("user");

async function setLeaderboard(option: boolean) {
  await $fetch("/api/user", {
    method: "POST",
    body: {
      leaderboardEnabled: option,
      leaderboardFirstSet: true,
    },
  });

  if (userState.value) {
    userState.value.leaderboardFirstSet = true;
  }
}

useKeybind(
  [Key.Alt, Key.Y],
  async () => {
    setLeaderboard(true);
  },
  { prevent: true, ignoreIfEditable: true }
);

useKeybind(
  [Key.Alt, Key.N],
  async () => {
    setLeaderboard(false);
  },
  { prevent: true, ignoreIfEditable: true }
);
</script>

<style scoped lang="scss">
.leaderboard-setup {
  background-color: color-mix(in srgb, var(--accent) 30%, transparent);
  border: 1px solid var(--accent);
  width: 100%;
  padding: 16px;
  display: flex;
  justify-content: space-between;
}

.buttons {
  display: flex;
  gap: 24px;
}

.title {
  font-size: 18px;
  font-weight: 500;
}

.description {
  font-size: 12px;
  color: var(--text-secondary);
}

@media (max-width: 726px) {
  .leaderboard-setup {
    flex-direction: column;
    gap: 16px;
  }
}
</style>
