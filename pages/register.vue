<template>
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
        Please create your account or
        <NuxtLink to="/login"><u>Login</u></NuxtLink>
      </p>
    </div>
    <form
      class="form"
      @submit.prevent="register"
      autocomplete="on"
      data-form-type="register">
      <UiInput
        v-model="email"
        placeholder="Email"
        type="text"
        :icon="MailIcon"
        @focus="isInputFocused = true"
        @blur="isInputFocused = false" />
      <UiInput
        v-model="password"
        placeholder="Password"
        type="password"
        :icon="KeyRoundIcon"
        @focus="isInputFocused = true"
        @blur="isInputFocused = false" />
    </form>
    <div class="buttons">
      <UiButton text="Register" keyName="enter" @click="register" />
      <UiButton text="Register with Github" keyName="g" @click="githubAuth" />
    </div>
  </main>
</template>

<script setup lang="ts">
import { KeyRoundIcon, MailIcon } from "lucide-vue-next";
import { useKeyboard, Key } from "@waradu/keyboard";

const error = ref("");
const email = ref("");
const password = ref("");
const toast = useToast();
const isInputFocused = ref(false);
const keyboard = useKeyboard();

async function register() {
  error.value = "";
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    await $fetch("/api/auth/register", {
      method: "POST",
      body: {
        email: email.value,
        password: password.value,
        timezone,
      },
    });
    await navigateTo("/");
  } catch (e: any) {
    console.error("Register failed", error);
    error.value = e.data?.message || "Register failed";
    toast.error(error.value);
  }
}

async function githubAuth() {
  window.location.href = "/api/auth/github";
}

onMounted(() => {
  keyboard.listen([Key.G], async () => {
    if (isInputFocused.value) return;
    await githubAuth();
  });

  keyboard.listen(
    [Key.Enter],
    async () => {
      await register();
    },
    { prevent: true }
  );
});

onUnmounted(() => {
  keyboard.clear();
});

useSeoMeta({
  title: "Register - Ziit",
  description: "Create your Ziit account to start tracking your coding time",
  ogTitle: "Register - Ziit",
  ogDescription: "Create your Ziit account to start tracking your coding time",
  ogImage: "https://ziit.app/logo.webp",
  ogUrl: "https://ziit.app/register",
  ogSiteName: "Ziit",
  twitterTitle: "Register - Ziit",
  twitterDescription:
    "Create your Ziit account to start tracking your coding time",
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
      href: "https://ziit.app/register",
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
        name: "Register - Ziit",
        url: "https://ziit.app/register",
      }),
    },
  ],
});
</script>

<style lang="scss">
@use "/styles/login.scss";
</style>
