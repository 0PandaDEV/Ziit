<template>
  <main>
    <div class="branding">
      <h1 class="title">
        <svg
          width="124"
          height="28"
          viewBox="0 0 124 28"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <clipPath id="clip_path_1">
              <rect width="124" height="28" />
            </clipPath>
          </defs>
          <path
            d="M29.32 -1.90735e-06L1.32 -1.90735e-06L1.32 5.6L18.12 5.6L1.32 28L29.32 28L29.32 22.4L12.5197 22.4L29.32 -1.90735e-06ZM60.44 5.6L60.44 -1.90735e-06L32.44 -1.90735e-06L32.44 5.6L43.64 5.6L43.64 22.4L32.44 22.4L32.44 28L60.44 28L60.44 22.4L49.24 22.4L49.24 5.6L60.44 5.6ZM92.04 5.6L92.04 -1.90735e-06L64.04 -1.90735e-06L64.04 5.6L75.24 5.6L75.24 22.4L64.04 22.4L64.04 28L92.04 28L92.04 22.4L80.84 22.4L80.84 5.6L92.04 5.6ZM94.72 -1.90735e-06L94.72 5.6L105.92 5.6L105.92 28L111.52 28L111.52 5.6L122.72 5.6L122.72 -1.90735e-06L94.72 -1.90735e-06Z"
            fill="#E6E6E6"
            clip-path="url(#clip_path_1)"
          />
        </svg>
      </h1>
      <p class="description">
        Please create your account or
        <NuxtLink to="/login"><u>Sign In</u></NuxtLink>
      </p>
    </div>
    <form
      class="form"
      @submit.prevent="register"
      autocomplete="on"
      data-form-type="register"
    >
      <Input
        v-model="email"
        placeholder="Email"
        type="text"
        :icon="IconsMail"
      />
      <Input
        v-model="password"
        placeholder="Password"
        type="password"
        :icon="IconsKey"
      />
      <Message v-if="error" :message="error" />
    </form>
    <div class="buttons">
      <Button text="Register" keyName="enter" @click="register" />
      <Button text="Register with Github" keyName="g" @click="githubAuth" />
    </div>
  </main>
</template>

<script setup lang="ts">
import { IconsKey, IconsMail } from "#components";
import { Key, keyboard } from "wrdu-keyboard";

const error = ref("");
const email = ref("");
const password = ref("");
const toast = useToast();

async function register() {
  error.value = "";
  try {
    await $fetch("/api/auth/register", {
      method: "POST",
      body: {
        email: email.value,
        password: password.value,
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
  keyboard.prevent.down([Key.G], async () => {
    await githubAuth();
  });

  keyboard.prevent.down([Key.Enter], async () => {
    await register();
  });
});

onUnmounted(() => {
  keyboard.clear();
});
</script>

<style lang="scss">
@use "/styles/login.scss";
</style>
