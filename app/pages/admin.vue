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
            :class="getHeaderClass('github_username')"
            @click="setSort('github_username')">
            GitHub
          </td>
          <td
            :class="getHeaderClass('total_minutes')"
            @click="setSort('total_minutes')">
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
            :class="getHeaderClass('created_at')"
            @click="setSort('created_at')">
            Created At
          </td>
          <td
            :class="getHeaderClass('last_login')"
            @click="setSort('last_login')">
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
          <td :class="getCellClass('github_username')">
            <span v-if="!user.github_username">N/A</span>
            <a
              v-else
              :href="`https://github.com/` + user.github_username"
              target="_blank"
              >{{ user.github_username }}</a
            >
          </td>
          <td :class="getCellClass('total_minutes')">
            {{ formatMinutes(user.total_minutes) }}
          </td>
          <td :class="getCellClass('heartbeats')">
            {{ user.heartbeats_count }}
          </td>
          <td :class="getCellClass('summaries')">
            {{ user.summaries_count }}
          </td>
          <td :class="getCellClass('created_at')">
            {{ formatDate(user.created_at) }}
          </td>
          <td :class="getCellClass('last_login')">
            {{ formatDate(user.last_login) }}
          </td>
        </tr>
      </tbody>
    </table>
  </NuxtLayout>
</template>

<script setup lang="ts">
import { LucideKeyRound } from "lucide-vue-next";
import { ref, onMounted, onUnmounted } from "vue";

const cookie = useCookie("adminKey", {
  maxAge: 3600,
  secure: true,
  sameSite: true,
});

const adminKey = ref("");
const isMobile = ref(false);
const isAuthenticated = ref(!!cookie.value);
const userLocale = ref("en-US");

interface AdminUser {
  id: string;
  email: string;
  github_username: string | null;
  created_at: Date;
  last_login: Date;
  heartbeats_count: number;
  summaries_count: number;
  total_minutes: number;
}

if (cookie.value) {
  adminKey.value = cookie.value;
}

const { data: adminUsers, refresh } = await useFetch<AdminUser[]>(
  "/api/admin",
  {
    key: "admin-users",
    headers: {
      Authorization: `Bearer ${cookie.value || adminKey.value}`,
    },
    getCachedData: (key) => {
      const cachedData = useNuxtData(key);
      return cachedData.data.value;
    },
    server: !!cookie.value,
    immediate: !!cookie.value,
    onResponseError: () => {
      isAuthenticated.value = false;
      cookie.value = null;
    },
  }
);

async function authenticate() {
  try {
    const data = await $fetch<AdminUser[]>("/api/admin", {
      headers: {
        Authorization: `Bearer ${adminKey.value}`,
      },
    });

    if (data) {
      adminUsers.value = data;
      isAuthenticated.value = true;
      cookie.value = adminKey.value;
    }
  } catch (error) {
    alert("Invalid admin key");
    isAuthenticated.value = false;
    cookie.value = null;
  }
}

onMounted(async () => {
  if (isAuthenticated.value && adminUsers.value) {
    await refresh();
  }
});

function checkScreenSize() {
  isMobile.value = window.innerWidth < 768;
}

onMounted(() => {
  userLocale.value = navigator.language;
  checkScreenSize();
  window.addEventListener("resize", checkScreenSize);
});

onUnmounted(() => {
  window.removeEventListener("resize", checkScreenSize);
});

type SortableKeys = keyof AdminUser | "heartbeats" | "summaries";
const sortKey = ref<SortableKeys>("created_at");
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
      aVal = a.heartbeats_count;
      bVal = b.heartbeats_count;
    } else if (sortKey.value === "summaries") {
      aVal = a.summaries_count;
      bVal = b.summaries_count;
    }

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

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString(userLocale.value, {
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

useSeoMeta({
  title: "Ziit - Admin",
  description: "A list of all users on this instance with their information.",
  ogTitle: "Ziit - Admin",
  ogDescription: "A list of all users on this instance with their information.",
  ogImage: "https://ziit.app/logo.webp",
  ogUrl: "https://ziit.app/admin",
  ogSiteName: "Ziit",
  twitterTitle: "Ziit - Admin",
  twitterDescription:
    "A list of all users on this instance with their information.",
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
      href: "https://ziit.app/admin",
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
        name: "Ziit - Admin",
        url: "https://ziit.app/admin",
        description:
          "A list of all users on this instance with their information.",
      }),
    },
  ],
});
</script>

<style scoped lang="scss">
@use "~~/styles/admin.scss";
</style>
