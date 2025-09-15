<template>
  <NuxtLayout name="navbar">
    <main>
      <div class="branding">
        <h1 class="title">
          <svg
            width="124"
            height="28"
            viewBox="0 0 124 28"
            fill="none"
            xmlns="http://www.w3.org/2000/svg">
            <defs>
              <clipPath id="clip_path_1">
                <rect width="124" height="28" />
              </clipPath>
            </defs>
            <path
              d="M29.32 -1.90735e-06L1.32 -1.90735e-06L1.32 5.6L18.12 5.6L1.32 28L29.32 28L29.32 22.4L12.5197 22.4L29.32 -1.90735e-06ZM60.44 5.6L60.44 -1.90735e-06L32.44 -1.90735e-06L32.44 5.6L43.64 5.6L43.64 22.4L32.44 22.4L32.44 28L60.44 28L60.44 22.4L49.24 22.4L49.24 5.6L60.44 5.6ZM92.04 5.6L92.04 -1.90735e-06L64.04 -1.90735e-06L64.04 5.6L75.24 5.6L75.24 22.4L64.04 22.4L64.04 28L92.04 28L92.04 22.4L80.84 22.4L80.84 5.6L92.04 5.6ZM94.72 -1.90735e-06L94.72 5.6L105.92 5.6L105.92 28L111.52 28L111.52 5.6L122.72 5.6L122.72 -1.90735e-06L94.72 -1.90735e-06Z"
              fill="#E6E6E6"
              clip-path="url(#clip_path_1)" />
          </svg>
        </h1>
        <p class="description">
          Please sign in to your account or
          <NuxtLink to="/register"><u>Register</u></NuxtLink>
        </p>
      </div>
      <form
        class="form"
        @submit.prevent="login"
        autocomplete="on"
        data-form-type="login">
        <UiInput
          v-model="email"
          placeholder="Email"
          type="text"
          :icon="LucideMail" />
        <UiInput
          v-model="password"
          placeholder="Password"
          type="password"
          :icon="LucideKeyRound" />
      </form>
      <div class="buttons">
        <UiButton text="Login" keyName="enter" @click="login" />
        <UiButton text="Github" keyName="g" @click="githubAuth" />
        <UiButton text="Epilogue" keyName="e" @click="epilogueAuth" />
      </div>
    </main>
  </NuxtLayout>
</template>

<script setup lang="ts">
import { LucideKeyRound, LucideMail } from "lucide-vue-next";

const error = ref("");
const email = ref("");
const password = ref("");
const toast = useToast();
const route = useRoute();

onMounted(() => {
  if (route.query.error) {
    const errorMessages: Record<string, string> = {
      invalid_state: "Invalid authentication state, please try again",
      no_code: "No authorization code received",
      no_email: "No email address found in your GitHub account",
      github_auth_failed: "GitHub authentication failed",
      epilogue_auth_failed: "Epilogue authentication failed",
      link_failed: "Account linking failed, please try again",
      cancelled: "Authentication was cancelled",
      link_cancelled: "Account linking was cancelled",
    };

    const message =
      errorMessages[route.query.error as string] || "Authentication error";
    toast.error(message);
  }

  if (route.query.success) {
    const successMessages: Record<string, string> = {
      logout: "Logged out successfully",
    };

    const message = successMessages[route.query.success as string] || "Success";
    toast.success(message);
  }
});

useKeybind({
  keys: ["g"],
  async run() {
    await githubAuth();
  },
  config: { ignoreIfEditable: true },
});

useKeybind({
  keys: ["e"],
  async run() {
    await epilogueAuth();
  },
  config: { ignoreIfEditable: true }
});

useKeybind({
  keys: ["enter"],
  async run() {
    await login();
  },
  config: { prevent: true },
});

async function login() {
  error.value = "";
  try {
    await $fetch("/api/auth/login", {
      method: "POST",
      body: {
        email: email.value,
        password: password.value,
      },
    });
    await navigateTo("/");
  } catch (e: any) {
    error.value = e.data?.message || "Login failed";
    toast.error(error.value);
  }
}

async function githubAuth() {
  window.location.href = "/api/auth/github";
}

async function epilogueAuth() {
  window.location.href = "/api/auth/epilogue";
}

useSeoMeta({
  title: "Ziit - Coding Statistics",
  description: "Track your coding time and productivity with Ziit",
  ogTitle: "Ziit - Coding Statistics",
  ogDescription: "Track your coding time and productivity with Ziit",
  ogImage: "https://ziit.app/logo.webp",
  ogUrl: "https://ziit.app/login",
  ogSiteName: "Ziit",
  twitterTitle: "Ziit - Coding Statistics",
  twitterDescription: "Track your coding time and productivity with Ziit",
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
      href: "https://ziit.app/login",
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
        name: "Login - Ziit",
        url: "https://ziit.app/login",
      }),
    },
  ],
});
</script>

<style scoped lang="scss">
@use "~~/styles/login.scss";
</style>
