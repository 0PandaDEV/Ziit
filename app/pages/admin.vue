<template>
  <NuxtLayout name="navbar">
    <form
      v-if="!isAuthenticated"
      @submit.prevent="authenticate"
      class="auth"
      autocomplete="on"
      data-form-type="login">
      <UiInput
        v-model="adminKey"
        placeholder="Enter Admin Key"
        type="password"
        :icon="LucideKeyRound" />
      <UiButton text="Authenticate" keyName="enter" @click="authenticate" />
    </form>

    <table v-else>
      <thead class="header row">
        <tr>
          <td class="id" :class="getHeaderClass('id')" @click="setSort('id')">
            User ID
          </td>
          <td :class="getHeaderClass('email')" @click="setSort('email')">
            Email
          </td>
          <td
            :class="getHeaderClass('githubUsername')"
            @click="setSort('githubUsername')">
            GitHub
          </td>
          <td
            :class="getHeaderClass('totalMinutes')"
            @click="setSort('totalMinutes')">
            Total Hours
          </td>
          <td
            :class="getHeaderClass('heartbeats')"
            @click="setSort('heartbeats')">
            Heartbeats
          </td>
          <td
            :class="getHeaderClass('summaries')"
            @click="setSort('summaries')">
            Summaries
          </td>
          <td
            :class="getHeaderClass('createdAt')"
            @click="setSort('createdAt')">
            Created At
          </td>
          <td
            :class="getHeaderClass('lastlogin')"
            @click="setSort('lastlogin')">
            Last Login
          </td>
        </tr>
      </thead>
      <tbody>
        <tr v-for="user in sortedAdminUsers" :key="user.id" class="row">
          <td class="id" :class="getCellClass('id')">{{ user.id }}</td>
          <td :class="getCellClass('email')">
            <a :class="getCellClass('email')" :href="`mailto:` + user.email">{{
              user.email
            }}</a>
          </td>
          <td :class="getCellClass('githubUsername')">
            <span v-if="!user.githubUsername">N/A</span>
            <a v-else :href="`https://github.com/` + user.githubUsername" target="_blank">{{
              user.githubUsername
            }}</a>
          </td>
          <td :class="getCellClass('totalMinutes')">
            {{ formatMinutes(user.totalMinutes) }}
          </td>
          <td :class="getCellClass('heartbeats')">
            {{ user._count.heartbeats }}
          </td>
          <td :class="getCellClass('summaries')">
            {{ user._count.summaries }}
          </td>
          <td :class="getCellClass('createdAt')">
            {{ formatDate(user.createdAt) }}
          </td>
          <td :class="getCellClass('lastlogin')">
            {{ formatDate(user.lastlogin) }}
          </td>
        </tr>
      </tbody>
    </table>
  </NuxtLayout>
</template>

<script setup lang="ts">

import { LucideKeyRound } from "lucide-vue-next";
import { ref, onMounted, onUnmounted } from "vue";

interface AdminUser {
  id: string;
  email: string;
  githubUsername: string | null;
  totalMinutes: number;
  createdAt: string;
  lastlogin: string;
  _count: {
    heartbeats: number;
    summaries: number;
  };
}

const isAuthenticated = ref(false);
const adminKey = ref("");
const adminUsers = ref<AdminUser[]>([]);

const cookie = useCookie("adminKey", {
  maxAge: 3600,
  secure: true,
  sameSite: true,
});

async function authenticate() {
  try {
    const data  = await $fetch("/api/admin", {
      headers: {
        Authorization: `Bearer ${adminKey.value}`,
      },
    });

    if (data) {
      adminUsers.value = data as AdminUser[];
      isAuthenticated.value = true;
      cookie.value = adminKey.value;
    }
  } catch (error) {
    alert("Invalid admin key");
  }
}

onMounted(async () => {
  if (cookie.value) {
    adminKey.value = cookie.value;
    await authenticate();
  }
});

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

type SortableKeys = keyof AdminUser | "heartbeats" | "summaries";
const sortKey = ref<SortableKeys>("createdAt");
const sortOrder = ref<"asc" | "desc">("desc");

function setSort(key: SortableKeys) {
  if (sortKey.value === key) {
    sortOrder.value = sortOrder.value === "asc" ? "desc" : "asc";
  } else {
    sortKey.value = key;
    sortOrder.value = "desc";
  }
}

function getHeaderClass(key: SortableKeys) {
  return {
    sorted: sortKey.value === key,
    asc: sortKey.value === key && sortOrder.value === "asc",
    desc: sortKey.value === key && sortOrder.value === "desc",
  };
}

function getCellClass(key: SortableKeys) {
  return {
    sorted: sortKey.value === key,
  };
}

const sortedAdminUsers = computed(() => {
  if (!adminUsers.value) return [];
  return [...adminUsers.value].sort((a, b) => {
    let aVal: any = a[sortKey.value as keyof AdminUser];
    let bVal: any = b[sortKey.value as keyof AdminUser];

    if (sortKey.value === "heartbeats") {
      aVal = a._count.heartbeats;
      bVal = b._count.heartbeats;
    } else if (sortKey.value === "summaries") {
      aVal = a._count.summaries;
      bVal = b._count.summaries;
    }

    if (typeof aVal === "number" && typeof bVal === "number") {
      return sortOrder.value === "asc" ? aVal - bVal : bVal - aVal;
    }
    return sortOrder.value === "asc"
      ? String(aVal).localeCompare(String(bVal))
      : String(bVal).localeCompare(String(aVal));
  });
});

function formatDate(date: string): string {
  const userLocale: string = navigator.language || "en-US";
  return new Date(date).toLocaleDateString(userLocale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

useKeybind({
  keys: ["alt_l"],
  run: async () => {
    try {
      window.location.href = "/api/auth/logout";
    } catch (e: any) {
      useToast().error(e.data?.message || "Logout failed");
    }
  },
  config: { prevent: true, ignoreIfEditable: true },
});

useKeybind({
  keys: ["enter"],
  run: async () => {
    authenticate();
  },
  config: { prevent: true, ignoreIfEditable: true },
});

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

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
@use "~~/styles/admin.scss";
</style>
