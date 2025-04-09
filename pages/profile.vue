<template>
  <NuxtLayout name="default">
    <div class="container">
      <section class="account-information">
        <h2 class="title">Account Information</h2>
        <div class="items">
          <div class="keys">
            <p>User ID</p>
            <p>Email</p>
            <p>Github Linked</p>
          </div>
          <div class="values">
            <p>{{ user?.id }}</p>
            <p>{{ user?.email }}</p>
            <p>{{ user?.hasGithubAccount ? "yes" : "no" }}</p>
          </div>
        </div>
        <div class="buttons">
          <Button
            v-if="!user?.hasGithubAccount"
            text="Link Github"
            keyName="L"
            @click="linkGithub"
          />
          <Button text="Change Email" keyName="E" />
          <Button text="Change Password" keyName="P" />
          <Button text="Logout" keyName="Alt+L" @click="logout" />
        </div>
      </section>

      <section class="api-key">
        <h2 class="title">API Key</h2>
        <Input
          :locked="true"
          :type="showApiKey ? 'text' : 'password'"
          :modelValue="user?.apiKey"
        />
        <div class="buttons">
          <Button
            v-if="showApiKey"
            text="Hide API Key"
            keyName="S"
            @click="toggleApiKey"
          />
          <Button
            v-else
            text="Show API Key"
            keyName="S"
            @click="toggleApiKey"
          />
          <Button text="Copy API Key" keyName="c" @click="copyApiKey" />
          <Button
            text="Regenerate API Key"
            keyName="r"
            @click="regenerateApiKey"
          />
        </div>
      </section>

      <section class="vscode-setup">
        <h2 class="title">VS Code Extension Setup</h2>
        <div class="steps">
          <p>1. Install the Ziit extension from the VS Code marketplace</p>
          <p>
            2. Open VS Code and press <kbd>Cmd</kbd> + <kbd>Shift</kbd> +
            <kbd>P</kbd> (or <kbd>Ctrl</kbd> + <kbd>Shift</kbd> +
            <kbd>P</kbd> on Windows)
          </p>
          <p>3. Type "Ziit: Set Instance" and press Enter</p>
          <p>
            4. Paste <kbd>{{ origin }}</kbd>
          </p>
          <p>5. Type "Ziit: Set API Key" and press Enter</p>
          <p>6. Paste your API key and press Enter</p>
          <p>7. Begin coding, and your time will be tracked automatically!</p>
        </div>
      </section>
    </div>
  </NuxtLayout>
</template>

<script setup lang="ts">
import type { User } from "@prisma/client";
import { ref, onMounted, computed } from "vue";
import { Key, keyboard } from "wrdu-keyboard";

interface ExtendedUser
  extends Omit<
    User,
    "passwordHash" | "githubAccessToken" | "githubRefreshToken" | "createdAt"
  > {
  hasGithubAccount?: boolean;
  name?: string;
}

const userState = useState<ExtendedUser | null>("user", () => null);
const user = computed(() => userState.value);
const showApiKey = ref(false);
const url = useRequestURL();
const origin = url.origin;
const toast = useToast();
const route = useRoute();

useSeoMeta({
  title: "Profile - Ziit",
  description: "Manage your Ziit account settings and API keys",
  ogTitle: "Profile - Ziit",
  ogDescription: "Manage your Ziit account settings and API keys",
  ogImage: "https://ziit.app/logo.webp",
  ogUrl: "https://ziit.app/profile",
  ogSiteName: "Ziit",
  twitterTitle: "Profile - Ziit",
  twitterDescription: "Manage your Ziit account settings and API keys",
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
      href: "https://ziit.app/profile",
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
        name: "Profile - Ziit",
        url: "https://ziit.app/profile",
      }),
    },
  ],
});

onMounted(async () => {
  await fetchUserData();

  if (route.query.error) {
    const errorMessages: Record<string, string> = {
      link_failed: "Failed to link GitHub account",
      invalid_state: "Invalid state parameter",
      no_code: "No code provided",
      no_email: "No email found",
      github_auth_failed: "GitHub authentication failed"
    };

    const message = errorMessages[route.query.error as string] || "Error";
    toast.error(message);
  }

  if (route.query.success) {
    const successMessages: Record<string, string> = {
      github_linked: "GitHub account successfully linked",
      github_updated: "GitHub credentials updated",
      accounts_merged: "Accounts successfully merged"
    };

    const message = successMessages[route.query.success as string] || "Success";
    toast.success(message);
  }

  keyboard.prevent.down([Key.L], async () => {
    if (!user.value?.hasGithubAccount) {
      await linkGithub();
    }
  });

  keyboard.prevent.down([Key.E], async () => {
    // change email
  });

  keyboard.prevent.down([Key.P], async () => {
    // change password
  });

  keyboard.prevent.down([Key.AltLeft, Key.L], async () => {
    await logout();
  });

  keyboard.prevent.down([Key.S], async () => {
    toggleApiKey();
  });

  keyboard.prevent.down([Key.C], async () => {
    await copyApiKey();
  });

  keyboard.prevent.down([Key.R], async () => {
    await regenerateApiKey();
  });
});

onUnmounted(() => {
  keyboard.clear();
});

async function fetchUserData() {
  if (userState.value) return;

  try {
    const data = await $fetch("/api/auth/user");

    const userData = {
      ...data,
      hasGithubAccount: !!data.githubId,
      name: data.githubUsername || data.email?.split("@")[0] || "User",
    };
    userState.value = userData;
  } catch (error) {
    console.error("Error fetching user data:", error);
    toast.error("Failed to load user data");
  }
}

function toggleApiKey() {
  showApiKey.value = !showApiKey.value;
}

async function copyApiKey() {
  if (!user.value?.apiKey) return;

  try {
    await navigator.clipboard.writeText(user.value.apiKey);
    toast.success("API Key copied to clipboard");
  } catch (error) {
    console.error("Failed to copy API key:", error);
    toast.error("Failed to copy API key");
  }
}

async function regenerateApiKey() {
  if (
    !confirm(
      "Are you sure you want to regenerate your API key? Your existing VS Code extension setup will stop working until you update it.",
    )
  ) {
    return;
  }

  try {
    const data = await $fetch("/api/auth/apikey", {
      method: "POST",
    });

    if (userState.value) {
      userState.value = {
        ...userState.value,
        apiKey: data.apiKey,
      };
      showApiKey.value = true;
      toast.success("API key regenerated successfully");
    }
  } catch (error) {
    console.error("Error regenerating API key:", error);
    toast.error("Failed to regenerate API key");
  }
}

async function logout() {
  try {
    window.location.href = "/api/auth/logout";
  } catch (e: any) {
    toast.error(e.data?.message || "Logout failed");
  }
}

async function linkGithub() {
  window.location.href = "/api/auth/github/link";
}
</script>

<style scoped lang="scss">
@use "/styles/profile.scss";
</style>
