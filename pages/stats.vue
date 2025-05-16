<template>
  <main>
    <div class="container">
      <div class="numbers">
        <div class="item">
          <p>total hours</p>
          <h2>{{ stats?.totalHours }}</h2>
        </div>
        <div class="item">
          <p>total heartbeats</p>
          <h2>{{ stats?.totalHeartbeats }}</h2>
        </div>
        <div class="item">
          <p>total users</p>
          <h2>{{ stats?.totalUsers }}</h2>
        </div>
      </div>
      <div class="top">
        <div class="item">
          <p>top editor</p>
          <h2>{{ stats?.topEditor }}</h2>
        </div>
        <div class="item">
          <p>top language</p>
          <h2>{{ stats?.topLanguage }}</h2>
        </div>
        <div class="item">
          <p>top os</p>
          <h2>{{ stats?.topOS }}</h2>
        </div>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
const { data: stats } = await useFetch("/api/public/stats");
</script>

<style lang="scss">
@use "/styles/stats.scss";
</style>
