<template>
  <NuxtLayout name="navbar">
    <table>
      <thead class="header row">
        <tr>
          <td class="userid">User ID</td>

          <td
            :class="getHeaderClass('totalMinutes')"
            @click="setSort('totalMinutes')">
            Total Time
          </td>

          <td
            v-if="!isMobile"
            :class="getHeaderClass('topLanguage')"
            @click="setSort('topLanguage')">
            Top Language
          </td>

          <td
            v-if="!isMobile"
            :class="getHeaderClass('topEditor')"
            @click="setSort('topEditor')">
            Top Editor
          </td>

          <td
            v-if="!isMobile"
            :class="getHeaderClass('topOS')"
            @click="setSort('topOS')">
            Top OS
          </td>
        </tr>
      </thead>
      <tbody>
        <tr v-for="user in sortedLeaderboard" :key="user.userId" class="row">
          <td class="userid">{{ user.userId }}</td>
          <td :class="getCellClass('totalMinutes')">
            {{ formatMinutes(user.totalMinutes) }}
          </td>
          <td v-if="!isMobile" :class="getCellClass('topLanguage')">
            {{ user.topLanguage || "Unknown" }}
          </td>
          <td v-if="!isMobile" :class="getCellClass('topEditor')">
            {{ user.topEditor || "Unknown" }}
          </td>
          <td v-if="!isMobile" :class="getCellClass('topOS')">
            {{ user.topOS || "Unknown" }}
          </td>
        </tr>
      </tbody>
    </table>
  </NuxtLayout>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";

interface LeaderboardUser {
  userId: string;
  totalMinutes: number;
  topLanguage?: string;
  topEditor?: string;
  topOS?: string;
}

const { data: leaderboard } = await useFetch<LeaderboardUser[]>(
  "/api/public/leaderboard"
);

const isMobile = ref(false);

function checkScreenSize() {
  isMobile.value = window.innerWidth < 768;
}

onMounted(() => {
  checkScreenSize();
  window.addEventListener("resize", checkScreenSize);
});

onUnmounted(() => {
  window.removeEventListener("resize", checkScreenSize);
});

const sortKey = ref<keyof LeaderboardUser>("totalMinutes");
const sortOrder = ref<"asc" | "desc">("desc");

function setSort(key: keyof LeaderboardUser) {
  if (sortKey.value === key) {
    sortOrder.value = sortOrder.value === "asc" ? "desc" : "asc";
  } else {
    sortKey.value = key;
    sortOrder.value = "desc";
  }
}

function getHeaderClass(key: keyof LeaderboardUser) {
  return {
    sorted: sortKey.value === key,
    asc: sortKey.value === key && sortOrder.value === "asc",
    desc: sortKey.value === key && sortOrder.value === "desc",
  };
}

function getCellClass(key: keyof LeaderboardUser) {
  return {
    sorted: sortKey.value === key,
  };
}

const sortedLeaderboard = computed(() => {
  if (!leaderboard.value) return [];
  return [...leaderboard.value].sort((a, b) => {
    const aVal = a[sortKey.value] ?? "";
    const bVal = b[sortKey.value] ?? "";

    if (typeof aVal === "number" && typeof bVal === "number") {
      return sortOrder.value === "asc" ? aVal - bVal : bVal - aVal;
    }
    return sortOrder.value === "asc"
      ? String(aVal).localeCompare(String(bVal))
      : String(bVal).localeCompare(String(aVal));
  });
});

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

useKeybind({
  keys: ["alt_l"],
  run() {
    try {
      window.location.href = "/api/auth/logout";
    } catch (e: any) {
      useToast().error(e.data?.message || "Logout failed");
    }
  },
  config: { prevent: true, ignoreIfEditable: true },
});

useSeoMeta({
  title: "Ziit - Leaderboard",
  description: "See who has the most coding hours.",
  ogTitle: "Ziit - Leaderboard",
  ogDescription: "See who has the most coding hours.",
  ogImage: "https://ziit.app/logo.webp",
  ogUrl: "https://ziit.app/leaderboard",
  ogSiteName: "Ziit",
  twitterTitle: "Ziit - Leaderboard",
  twitterDescription: "See who has the most coding hours.",
  twitterImage: "https://ziit.app/logo.webp",
  twitterCard: "summary",
  twitterCreator: "@pandadev_",
  twitterSite: "@pandadev_",
  author: "PandaDEV",
});

useHead({
  htmlAttrs: { lang: "en" },
  link: [
    {
      rel: "canonical",
      href: "https://ziit.app/leaderboard",
    },
    {
      rel: "icon",
      type: "image/ico",
      href: "/favicon.ico",
    },
  ],
  script: [
    {
      type: "application/ld+json",
      innerHTML: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: "Ziit - Leaderboard",
        url: "https://ziit.app/leaderboard",
        description: "See who has the most coding hours.",
      }),
    },
  ],
});
</script>

<style scoped lang="scss">
@use "~~/styles/leaderboard.scss";
</style>
