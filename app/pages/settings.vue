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
            <p>Epilogue Linked</p>
            <p>Show up on Leaderboard</p>
          </div>
          <div class="values">
            <p>{{ user?.id }}</p>
            <p>{{ user?.email }}</p>
            <p>{{ hasGithubAccount ? "yes" : "no" }}</p>
            <p>{{ hasEpilogueAccount ? "yes" : "no" }}</p>
            <p>{{ user?.leaderboardEnabled ? "yes" : "no" }}</p>
          </div>
        </div>
        <div class="buttons">
          <UiButton
            v-if="!hasGithubAccount"
            text="Link Github"
            keyName="L"
            @click="linkGithub" />
          <UiButton
            v-if="!hasEpilogueAccount"
            text="Link Epilogue"
            keyName="M"
            @click="linkEpilogue" />
          <UiButton
            :text="
              user?.leaderboardEnabled
                ? `Opt-out of Leaderboard`
                : `Opt-in to Leaderboard`
            "
            keyName="O"
            @click="toggleLeaderboard" />
          <UiButton
            text="Change Email"
            keyName="E"
            @click="showEmailModal = true" />
          <UiButton
            text="Change Password"
            keyName="P"
            @click="showPasswordModal = true" />
          <UiButton text="Logout" keyName="Alt+L" @click="logout" />
        </div>
      </section>

      <UiModal
        :open="showEmailModal"
        title="Change Email"
        :isLoading="isLoading"
        @cancel="showEmailModal = false"
        @save="changeEmail"
        @close="showEmailModal = false">
        <template #form-content>
          <UiInput
            type="email"
            v-model="newEmail"
            placeholder="New Email Address"
            required />
        </template>
      </UiModal>

      <UiModal
        :open="showPasswordModal"
        title="Change Password"
        description="Password must be at least 12 characters and include uppercase,
            lowercase, numbers, and special characters"
        :isLoading="isLoading"
        @cancel="showPasswordModal = false"
        @save="changePassword"
        @close="showPasswordModal = false">
        <template #form-content>
          <UiInput
            type="password"
            v-model="newPassword"
            placeholder="New Password"
            required />
          <UiInput
            type="password"
            v-model="confirmPassword"
            placeholder="Confirm Password"
            required />
        </template>
      </UiModal>

      <section class="api-key">
        <h2 class="title">API Key</h2>
        <UiInput
          :locked="true"
          :type="showApiKey ? 'text' : 'password'"
          :modelValue="user?.apiKey" />
        <div class="buttons">
          <UiButton
            v-if="showApiKey"
            text="Hide API Key"
            keyName="S"
            @click="toggleApiKey" />
          <UiButton
            v-else
            text="Show API Key"
            keyName="S"
            @click="toggleApiKey" />
          <UiButton text="Copy API Key" keyName="c" @click="copyApiKey" />
          <UiButton
            text="Regenerate API Key"
            keyName="r"
            @click="regenerateApiKey" />
        </div>
      </section>

      <section class="tracking-settings">
        <h2 class="title">Tracking Settings</h2>
        <div class="setting-group">
          <p class="setting-description">Keystroke Timeout (minutes):</p>
          <UiNumberInput
            id="keystrokeTimeout"
            v-model="keystrokeTimeout"
            :min="1"
            :max="60"
            @update:modelValue="updateKeystrokeTimeout" />

          <p>
            In order to work correctly, summaries need to be regenerated after
            changing the keystroke timeout.
          </p>
          <UiButton
            text="Regenerate Summaries"
            keyName="Alt+R"
            @click="regenerateSummaries" />
        </div>
      </section>

      <section class="wakatime-import">
        <h2 class="title">Data Import</h2>
        <div class="setting-group">
          <div class="radio-group">
            <UiRadioButton
              :text="'WakaTime (API Key)'"
              :selected="importType === 'wakatime-api'"
              :value="'wakatime-api'"
              @update="(val: ImportType) => (importType = val)" />
            <UiRadioButton
              :text="'WakaTime (File)'"
              :selected="importType === 'wakatime-file'"
              :value="'wakatime-file'"
              @update="(val: ImportType) => (importType = val)" />
            <UiRadioButton
              :text="'WakAPI'"
              :selected="importType === 'wakapi'"
              :value="'wakapi'"
              @update="(val: ImportType) => (importType = val)" />
          </div>

          <UiInput
            :id="importType + 'ApiKey'"
            type="password"
            v-model="importApiKey"
            :placeholder="apiKeyPlaceholder"
            v-if="importType === 'wakapi' || importType === 'wakatime-api'" />

          <UiInput
            id="wakapiInstanceUrl"
            type="text"
            v-model="wakapiInstanceUrl"
            placeholder="Enter your WakAPI instance URL (e.g. https://wakapi.dev)"
            v-if="importType === 'wakapi'" />

          <div v-if="importType === 'wakatime-api'" class="steps">
            <p>
              1. Go to
              <a href="https://wakatime.com/settings/api-key" target="_blank"
                >WakaTime API Key Settings</a
              >
            </p>
            <p>
              2. Copy your API key (format:
              waka_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
            </p>
            <p>3. Paste it above and click Import Data</p>
          </div>

          <div v-if="importType === 'wakatime-file'" class="steps">
            <p>
              1. Go to
              <a href="https://wakatime.com/settings/account" target="_blank"
                >WakaTime Settings</a
              >
            </p>
            <p>
              2. Click on <kbd>Export my code stats...</kbd> and select
              Heartbeats
            </p>
            <p>3. Wait and then download your data</p>
            <p>4. Upload the downloaded JSON file below</p>
          </div>

          <input
            type="file"
            id="wakaTimeFileUpload"
            ref="wakaTimeFileInput"
            accept=".json"
            @change="handleFileChange"
            v-if="importType === 'wakatime-file'" />
        </div>

        <p class="setting-description">
          For a detailed guide refer to
          <a href="https://docs.ziit.app/data-import">Wakatime/Wakapi Import</a>
        </p>

        <UiButton
          text="Import Data"
          keyName="I"
          @click="importTrackingData"
          :disabled="isUploading" />

        <div v-if="importJob" class="import-status">
          <p>
            <span class="spinner" v-if="showSpinner">{{ spinnerText }}</span>
            {{ importStatusText }}
          </p>
          <div class="bar-container">
            <div
              class="bar"
              :style="{
                width: importJob.progress + '%',
              }"></div>
          </div>
        </div>
      </section>

      <section class="dange-zone">
        <h2 class="title">Danger Zone</h2>
        <div class="setting-group">
          <UiButton
            v-if="purgeTimer == 0"
            text="Purge all data"
            keyName="Alt+C"
            @click="countDown('purge')"
            :red="true" />
          <UiButton
            v-if="purgeTimer != 0"
            :text="`Click to confirm purge... ` + purgeTimer"
            keyName="Alt+C"
            @click="purgeData"
            :red="true" />
          <UiButton
            v-if="deleteTimer == 0"
            text="Delete account"
            keyName="Alt+D"
            @click="countDown('delete')"
            :red="true" />
          <UiButton
            v-if="deleteTimer != 0"
            :text="`Click to confirm delete... ` + deleteTimer"
            keyName="Alt+D"
            @click="deleteAccount"
            :red="true" />
        </div>
      </section>
    </div>
  </NuxtLayout>
</template>

<script setup lang="ts">
import type { User } from "@prisma/client";
import { ref, onMounted, computed } from "vue";
import * as statsLib from "~~/lib/stats";
import { ImportStatus, type ImportJob } from "~~/types/import";

const { data: fetchedUser } = await useFetch("/api/user");
const user = useState<User | null>("user", () => fetchedUser.value as User);

const showApiKey = ref(false);
const toast = useToast();
const route = useRoute();
const keystrokeTimeout = ref(user.value?.keystrokeTimeout || 15);
const originalKeystrokeTimeout = ref(user.value?.keystrokeTimeout || 15);
const timeoutChanged = ref(false);
const hasGithubAccount = computed(() => !!user.value?.githubId);
const hasEpilogueAccount = computed(() => !!user.value?.epilogueId);
const WAKATIME_API = "wakatime-api" as const;
const WAKATIME_FILE = "wakatime-file" as const;
const WAKAPI = "wakapi" as const;
type ImportType = typeof WAKATIME_API | typeof WAKATIME_FILE | typeof WAKAPI;
const importType = ref<ImportType>(WAKATIME_API);
const importApiKey = ref("");
const wakapiInstanceUrl = ref("");

const wakaTimeFileInput = ref<HTMLInputElement | null>(null);
const selectedFile = ref<File | null>(null);
const selectedFileName = ref<string | null>(null);
const isUploading = ref(false);
const importJob = ref<ImportJob | null>(null);
let eventSource: EventSource | null = null;
let reconnectAttempts = 0;
let maxReconnectAttempts = 5;
let reconnectTimeout: NodeJS.Timeout | null = null;
let isPageVisible = ref(true);
let connectionDelay: NodeJS.Timeout | null = null;
const CHUNK_SIZE = 95 * 1024 * 1024;

const spinnerChars = ["-", "/", "|", "\\"];
const spinnerIndex = ref(0);
const spinnerText = computed(() => spinnerChars[spinnerIndex.value]);
let spinnerInterval: NodeJS.Timeout | null = null;

const showEmailModal = ref(false);
const showPasswordModal = ref(false);
const newEmail = ref("");
const newPassword = ref("");
const confirmPassword = ref("");
const isLoading = ref(false);

function useClampedRef(initialValue: number, min: number, max: number) {
  const _value = ref(initialValue);

  return computed({
    get: () => _value.value,
    set: (value) => {
      _value.value = Math.max(min, Math.min(max, value));
    },
  });
}

const purgeTimer = useClampedRef(0, 0, 5);
const deleteTimer = useClampedRef(0, 0, 5);

const apiKeyPlaceholder = computed(() => {
  if (importType.value === "wakatime-api") {
    return "Enter your WakaTime API Key (waka_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)";
  }
  return "Enter your WakAPI API Key";
});

const importStatusText = computed(() => {
  if (!importJob.value) return "";
  return importJob.value.message;
});

const showSpinner = computed(() => {
  const status = importJob.value?.status || "";
  return !(status === ImportStatus.Completed || status === ImportStatus.Failed);
});

function startSpinner() {
  if (spinnerInterval) return;
  spinnerInterval = setInterval(() => {
    spinnerIndex.value = (spinnerIndex.value + 1) % spinnerChars.length;
  }, 200);
}

function stopSpinner() {
  if (spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
  }
}

watch(importJob, (newJob) => {
  if (
    newJob &&
    (newJob.status === ImportStatus.Completed ||
      newJob.status === ImportStatus.Failed)
  ) {
    stopSpinner();
    if (newJob.status === ImportStatus.Failed) {
      toast.error(`Import failed: ${newJob.error || "Unknown error"}`);
      setTimeout(() => {
        if (importJob.value && importJob.value.status === ImportStatus.Failed) {
          importJob.value = null;
        }
      }, 8000);
    }
  } else if (newJob) {
    startSpinner();
  } else {
    stopSpinner();
  }
});

function connectEventSource() {
  if (
    !isPageVisible.value ||
    (eventSource && eventSource.readyState !== EventSource.CLOSED)
  )
    return;

  try {
    eventSource = new EventSource("/api/import/status");

    eventSource.onopen = () => {
      console.log("EventSource connected");
      reconnectAttempts = 0;
    };

    eventSource.onmessage = (event) => {
      try {
        const response = JSON.parse(event.data);

        if (response.activeJob) {
          const serverJob = response.activeJob as ImportJob;
          importJob.value = serverJob;
        } else if (!response.hasActiveJobs && !isUploading.value) {
          if (
            importJob.value &&
            !importJob.value.status.includes("Completed") &&
            !importJob.value.status.includes("Failed")
          ) {
            importJob.value = null;
          }
        }
      } catch (error) {
        console.error("Error parsing EventSource message:", error);
      }
    };

    eventSource.onerror = (error) => {
      console.error("EventSource error:", error);

      if (eventSource && eventSource.readyState !== EventSource.CLOSED) {
        eventSource.close();
      }
      eventSource = null;

      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        const delay = Math.min(1000 + (reconnectAttempts - 1) * 2000, 10000);

        console.log(
          `Attempting to reconnect in ${delay}ms (attempt ${reconnectAttempts}/${maxReconnectAttempts})`
        );

        reconnectTimeout = setTimeout(() => {
          connectEventSource();
        }, delay);
      } else {
        console.error("Max reconnection attempts reached");
        toast.error("Connection lost. Please refresh the page.");
      }
    };
  } catch (error) {
    console.error("Failed to create EventSource:", error);
    toast.error("Failed to establish connection. Please refresh the page.");
  }
}

function disconnectEventSource() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  if (connectionDelay) {
    clearTimeout(connectionDelay);
    connectionDelay = null;
  }

  if (eventSource && eventSource.readyState !== EventSource.CLOSED) {
    eventSource.close();
  }
  eventSource = null;

  reconnectAttempts = 0;
}

function handleVisibilityChange() {
  if (document.hidden) {
    isPageVisible.value = false;
    disconnectEventSource();
  } else {
    isPageVisible.value = true;
    connectionDelay = setTimeout(() => {
      connectEventSource();
    }, 500);
  }
}

function handleBeforeUnload() {
  disconnectEventSource();
}

onMounted(() => {
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("beforeunload", handleBeforeUnload);
});

onUnmounted(() => {
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  window.removeEventListener("beforeunload", handleBeforeUnload);

  disconnectEventSource();
  stopSpinner();
});

if (user.value?.keystrokeTimeout) {
  statsLib.setKeystrokeTimeout(user.value.keystrokeTimeout);
}

onMounted(() => {
  if (document.readyState === "complete") {
    connectionDelay = setTimeout(() => {
      connectEventSource();
    }, 500);
  } else {
    window.addEventListener(
      "load",
      () => {
        connectionDelay = setTimeout(() => {
          connectEventSource();
        }, 200);
      },
      { once: true }
    );
  }

  if (route.query.error) {
    const errorMessages: Record<string, string> = {
      link_failed: "Failed to link account",
      invalid_state: "Invalid state parameter",
      no_code: "No code provided",
      no_email: "No email found",
      github_auth_failed: "GitHub authentication failed",
      epilogue_auth_failed: "Epilogue authentication failed",
      link_cancelled: "Account linking was cancelled",
    };

    const message = errorMessages[route.query.error as string] || "Error";
    toast.error(message);
  }

  if (route.query.success) {
    const successMessages: Record<string, string> = {
      github_linked: "GitHub account successfully linked",
      github_updated: "GitHub credentials updated",
      epilogue_linked: "Epilogue account successfully linked",
      epilogue_updated: "Epilogue credentials updated",
      accounts_merged: "Accounts successfully merged",
    };

    const message = successMessages[route.query.success as string] || "Success";
    toast.success(message);
  }
});

useKeybind({
  keys: ["l"],
  run: async () => {
    if (!hasGithubAccount.value && !hasEpilogueAccount.value) {
      await linkGithub();
    }
  },
  config: { prevent: true, ignoreIfEditable: true },
});

useKeybind({
  keys: ["m"],
  async run() {
    if (!hasEpilogueAccount.value && !hasGithubAccount.value) {
      await linkEpilogue();
    }
  },
  config: { prevent: true, ignoreIfEditable: true },
});

useKeybind({
  keys: ["o"],
  run: async () => {
    await toggleLeaderboard();
  },
  config: { prevent: true, ignoreIfEditable: true },
});

useKeybind({
  keys: ["e"],
  run: async () => {
    showEmailModal.value = true;
    newEmail.value = user.value?.email || "";
  },
  config: { prevent: true, ignoreIfEditable: true },
});

useKeybind({
  keys: ["p"],
  run: async () => {
    showPasswordModal.value = true;
    newPassword.value = "";
    confirmPassword.value = "";
  },
  config: { prevent: true, ignoreIfEditable: true },
});

useKeybind({
  keys: ["alt_l"],
  run: async () => {
    try {
      window.location.href = "/api/auth/logout";
    } catch (e: any) {
      toast.error(e.data?.message || "Logout failed");
    }
  },
  config: { prevent: true, ignoreIfEditable: true },
});

useKeybind({
  keys: ["s"],
  run: async () => {
    toggleApiKey();
  },
  config: { prevent: true, ignoreIfEditable: true },
});

useKeybind({
  keys: ["c"],
  run: async () => {
    await copyApiKey();
  },
  config: { prevent: true, ignoreIfEditable: true },
});

useKeybind({
  keys: ["r"],
  run: async () => {
    await regenerateApiKey();
  },
  config: { prevent: true, ignoreIfEditable: true },
});

useKeybind({
  keys: ["i"],
  run: async () => {
    await importTrackingData();
  },
  config: { prevent: true, ignoreIfEditable: true },
});

useKeybind({
  keys: ["alt_r"],
  run: async () => {
    if (
      !confirm(
        "Confirm that you want to regenerate all your summaires which can take a while."
      )
    ) {
      return;
    }

    await regenerateSummaries();
  },
  config: { prevent: true, ignoreIfEditable: true },
});

useKeybind({
  keys: ["alt_c"],
  run() {
    countDown("purge");
  },
  config: { prevent: true, ignoreIfEditable: true },
});

useKeybind({
  keys: ["alt_d"],
  run() {
    countDown("delete");
  },
  config: { prevent: true, ignoreIfEditable: true },
});

async function updateKeystrokeTimeout() {
  if (!user.value) return;

  try {
    await $fetch("/api/user", {
      method: "POST",
      body: {
        keystrokeTimeout: keystrokeTimeout.value,
      },
    });

    if (user.value) {
      user.value.keystrokeTimeout = keystrokeTimeout.value;
    }

    statsLib.setKeystrokeTimeout(keystrokeTimeout.value);

    toast.success("Keystroke timeout updated");

    if (originalKeystrokeTimeout.value !== keystrokeTimeout.value) {
      timeoutChanged.value = true;
    }

    await statsLib.refreshStats();
  } catch (error) {
    console.error("Error updating keystroke timeout:", error);
    toast.error("Failed to update keystroke timeout");
  }
}

async function changeEmail() {
  if (!newEmail.value || newEmail.value === user.value?.email) {
    showEmailModal.value = false;
    return;
  }

  isLoading.value = true;

  try {
    await $fetch("/api/user", {
      method: "POST",
      body: {
        email: newEmail.value,
      },
    });

    if (user.value) {
      user.value.email = newEmail.value;
    }

    toast.success("Email updated successfully");
    showEmailModal.value = false;
    newEmail.value = "";
  } catch (error: any) {
    console.error("Error updating email:", error);
    toast.error(error?.data?.message || "Failed to update email");
  } finally {
    isLoading.value = false;
  }
}

async function changePassword() {
  if (!newPassword.value || newPassword.value !== confirmPassword.value) {
    toast.error("Passwords do not match");
    return;
  }

  isLoading.value = true;

  try {
    await $fetch("/api/user", {
      method: "POST",
      body: {
        password: newPassword.value,
      },
    });

    toast.success("Password updated successfully");
    showPasswordModal.value = false;
    newPassword.value = "";
    confirmPassword.value = "";
  } catch (error: any) {
    console.error("Error updating password:", error);
    toast.error(error?.data?.message || "Failed to update password");
  } finally {
    isLoading.value = false;
  }
}

async function regenerateSummaries() {
  try {
    const response = await $fetch("/api/user/regenerateSummaries");
    toast.success(
      (response as any).message || "Summaries regenerated successfully"
    );
    timeoutChanged.value = false;
    originalKeystrokeTimeout.value = keystrokeTimeout.value;
    await statsLib.refreshStats();
  } catch (error) {
    console.error("Error regenerating summaries:", error);
    toast.error("Failed to regenerate summaries");
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
      "Are you sure you want to regenerate your API key? Your existing VS Code extension setup will stop working until you update it."
    )
  ) {
    return;
  }

  try {
    const data = await $fetch("/api/user/apikey");

    if (user.value) {
      user.value = {
        ...user.value,
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
  const response = await $fetch("/api/auth/github/link");
  await navigateTo(response.url, { external: true });
}

async function linkEpilogue() {
  const response = await $fetch("/api/auth/epilogue/link");
  await navigateTo(response.url, { external: true });
}

async function toggleLeaderboard() {
  try {
    const newState = !user.value?.leaderboardEnabled;
    await $fetch("/api/user", {
      method: "POST",
      body: {
        leaderboardEnabled: newState,
      },
    });

    if (user.value) {
      user.value.leaderboardEnabled = newState;
    }

    toast.success(
      `${newState ? "Opted in to" : "Opted out of"} leaderboard successfully`
    );
  } catch (error: any) {
    console.error("Error updating Leaderboard opt:", error);
    toast.error(error?.data?.message || "Failed to update Leaderboard opt");
  }
}

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files && input.files.length > 0) {
    selectedFile.value = input.files[0]!;
    selectedFileName.value = input.files[0]!.name;

    const fileSize = input.files[0]!.size;
    const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);

    if (fileSize > CHUNK_SIZE) {
      const chunks = Math.ceil(fileSize / CHUNK_SIZE);
      toast.success(
        `Large file detected (${fileSizeMB} MB). Will upload in ${chunks} chunks.`
      );
    } else {
      toast.success(
        `Selected file: ${input.files[0]!.name} (${fileSizeMB} MB)`
      );
    }
    importJob.value = null;
  } else {
    selectedFile.value = null;
    selectedFileName.value = null;
  }
}

onBeforeUnmount(() => {
  disconnectEventSource();
});

async function importTrackingData() {
  if (importType.value === "wakatime-file") {
    if (!selectedFile.value) {
      toast.error("Please select a WakaTime export file");
      return;
    }

    try {
      isUploading.value = true;

      const file = selectedFile.value;
      const fileSize = file.size;
      const fileId = String(file.lastModified || Date.now());

      if (fileSize <= CHUNK_SIZE) {
        const formData = new FormData();
        formData.append("file", file);

        await $fetch("/api/import", {
          method: "POST",
          body: formData,
        });
      } else {
        const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);

        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
          const start = chunkIndex * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, fileSize);
          const chunk = file.slice(start, end);

          const formData = new FormData();
          formData.append("fileId", fileId);
          formData.append("chunkIndex", chunkIndex.toString());
          formData.append("totalChunks", totalChunks.toString());
          formData.append("fileName", file.name);
          formData.append("fileSize", fileSize.toString());
          formData.append("chunk", chunk);

          await $fetch("/api/import", {
            method: "POST",
            body: formData,
          });
        }

        await $fetch("/api/import", {
          method: "POST",
          body: { fileId, processChunks: true },
        });
      }

      toast.success("WakaTime data import started");

      selectedFile.value = null;
      selectedFileName.value = null;
      if (wakaTimeFileInput.value) {
        wakaTimeFileInput.value.value = "";
      }
    } catch (error: any) {
      console.error("Error importing WakaTime data:", error);
      toast.error(error?.data?.message || "Failed to import WakaTime data");
    } finally {
      isUploading.value = false;
    }
  } else {
    if (importType.value === "wakapi" && !importApiKey.value) {
      toast.error("Please enter your WakAPI API Key");
      return;
    }

    if (importType.value === "wakatime-api" && !importApiKey.value) {
      toast.error("Please enter your WakaTime API Key");
      return;
    }

    const payload: any = {
      instanceType:
        importType.value === "wakatime-api" ? "wakatime" : importType.value,
    };

    if (importApiKey.value) {
      payload.apiKey = importApiKey.value;
    }

    if (importType.value === "wakapi") {
      if (!wakapiInstanceUrl.value) {
        toast.error("Please enter your WakAPI instance URL");
        return;
      }
      payload.instanceUrl = wakapiInstanceUrl.value;
    }

    try {
      const displayName =
        importType.value === "wakatime-api"
          ? "WakaTime"
          : importType.value === "wakapi"
            ? "WakAPI"
            : importType.value;

      await $fetch("/api/import", {
        method: "POST",
        body: payload,
      });

      toast.success(`${displayName} data import started`);

      importApiKey.value = "";
      wakapiInstanceUrl.value = "";
    } catch (error: any) {
      const displayName =
        importType.value === "wakatime-api"
          ? "WakaTime"
          : importType.value === "wakapi"
            ? "WakAPI"
            : importType.value;
      console.error(`Error importing ${displayName} data:`, error);
      toast.error(
        error?.data?.message || `Failed to import ${displayName} data`
      );
    }
  }
}

function countDown(type: string) {
  if (type == "purge") purgeTimer.value = 5;
  if (type == "delete") deleteTimer.value = 5;

  const countdown = setInterval(() => {
    if (type == "purge") purgeTimer.value--;
    if (type == "delete") deleteTimer.value--;

    const currentValue = type == "purge" ? purgeTimer.value : deleteTimer.value;

    if (currentValue <= 0) {
      clearInterval(countdown);
    }
  }, 1000);
}

async function purgeData() {
  try {
    const response = await $fetch("/api/user/purge");
    toast.success(response.message);
    purgeTimer.value = 0;
  } catch (e: any) {
    const errorMessage =
      e.data?.message ||
      e.message ||
      "Failed to purge user data. Please try again.";
    purgeTimer.value = 0;
    toast.error(errorMessage);
  }
}

async function deleteAccount() {
  try {
    await $fetch("/api/user/delete");
    deleteTimer.value = 0;
    toast.success("Successfully deleted account");
    await navigateTo("/login");
  } catch (e: any) {
    const errorMessage =
      e.data?.message ||
      e.message ||
      "Failed to delete account. Please try again.";
    deleteTimer.value = 0;
    toast.error(errorMessage);
  }
}

useSeoMeta({
  title: "Settings - Ziit",
  description: "Manage your Ziit account settings and API keys",
  ogTitle: "Settings - Ziit",
  ogDescription: "Manage your Ziit account settings and API keys",
  ogImage: "https://ziit.app/logo.webp",
  ogUrl: "https://ziit.app/settings",
  ogSiteName: "Ziit",
  twitterTitle: "Settings - Ziit",
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
      href: "https://ziit.app/settings",
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
        name: "Settings - Ziit",
        url: "https://ziit.app/settings",
      }),
    },
  ],
});
</script>

<style scoped lang="scss">
@use "~~/styles/settings.scss";
</style>
