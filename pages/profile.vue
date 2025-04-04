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
            v-if="user?.hasGithubAccount"
            text="Unlink Github"
            keyName="U" />
          <Button v-else text="Link Github" keyName="L" />
          <Button text="Change Email" keyName="E" />
          <Button text="Change Password" keyName="P" />
        </div>
      </section>

      <section class="api-key">
        <h2 class="title">API Key</h2>
        <Input
          :locked="true"
          :type="showApiKey ? 'text' : 'password'"
          :modelValue="user?.apiKey" />
        <div class="buttons">
          <Button
            v-if="showApiKey"
            text="Hide API Key"
            keyName="S"
            @click="toggleApiKey" />
          <Button
            v-else
            text="Show API Key"
            keyName="S"
            @click="toggleApiKey" />
          <Button text="Copy API Key" keyName="c" @click="copyApiKey" />
          <Button
            text="Regenerate API Key"
            keyName="r"
            @click="regenerateApiKey" />
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

interface ExtendedUser extends User {
  hasGithubAccount?: boolean;
  name?: string;
}

const user = ref<ExtendedUser | null>(null);
const showApiKey = ref(false);
const url = useRequestURL();
const origin = url.origin;

onMounted(async () => {
  await fetchUserData();
});

async function fetchUserData() {
  try {
    const data = await $fetch("/api/auth/user");

    const userData = {
      ...data,
      hasGithubAccount: !!data.githubId,
      name: data.githubUsername || data.email?.split("@")[0] || "User",
    };
    user.value = userData;
  } catch (error) {
    console.error("Error fetching user data:", error);
  }
}

function toggleApiKey() {
  showApiKey.value = !showApiKey.value;
}

async function copyApiKey() {
  if (!user.value?.apiKey) return;

  try {
    await navigator.clipboard.writeText(user.value.apiKey);
    alert("API Key copied to clipboard");
  } catch (error) {
    console.error("Failed to copy API key:", error);
  }
}

async function regenerateApiKey() {
  if (
    !confirm(
      "Are you sure you want to regenerate your API key? Your existing VS Code extension setup will stop working until you update it."
    )
  ) {
    return;
  }

  try {
    const data = await $fetch("/api/auth/apikey", {
      method: "POST",
    });

    if (user.value) {
      user.value.apiKey = data.apiKey;
      showApiKey.value = true;
      alert(
        "Your API key has been regenerated. Update it in your VS Code extension settings."
      );
    }
  } catch (error) {
    console.error("Error regenerating API key:", error);
    alert("Failed to regenerate API key. Please try again.");
  }
}
</script>

<style lang="scss">
@use "/styles/profile.scss";
</style>
