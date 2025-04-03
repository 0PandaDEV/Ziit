<template>
  <main>
    <div class="branding">
      <h1 class="title">ZIIT</h1>
      <p class="description">Please sign in to your account or <NuxtLink to="/register"><u>Sign Up</u></NuxtLink></p>
    </div>
    <form class="form" @submit.prevent="login">
      <Input
        v-model="email"
        placeholder="Email"
        type="text"
        :icon="IconsMail" />
      <Input
        v-model="password"
        placeholder="Password"
        type="password"
        :icon="IconsKey" />
      <Message v-if="error" :message="error" />
    </form>
    <div class="buttons">
      <Button text="Login" keyName="enter" @click="login" />
      <Button text="Login with Github" keyName="g" @click="githubAuth" />
    </div>
  </main>
</template>

<script setup lang="ts">
import { IconsKey, IconsMail } from "#components";
import { Key, keyboard } from "wrdu-keyboard";

const error = ref("");
const email = ref("");
const password = ref("");

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
    console.error("Login failed", error);
    error.value = e.data?.message || "Login failed";
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
    await login();
  });
});

onUnmounted(() => {
  keyboard.clear();
});
</script>

<style lang="scss">
@use "/styles/login.scss";
</style>
