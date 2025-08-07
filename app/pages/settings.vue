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
            <p>{{ hasGithubAccount ? "yes" : "no" }}</p>
          </div>
        </div>
        <div class="buttons">
          <UiButton
            v-if="!hasGithubAccount"
            text="Link Github"
            keyName="L"
            @click="linkGithub" />
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
              :text="'WakaTime'"
              :selected="importType === 'wakatime'"
              :value="'wakatime'"
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
            v-if="importType === 'wakapi'" />

          <UiInput
            id="wakapiInstanceUrl"
            type="text"
            v-model="wakapiInstanceUrl"
            placeholder="Enter your WakAPI instance URL (e.g. https://wakapi.dev)"
            v-if="importType === 'wakapi'" />

          <div v-if="importType === 'wakatime'" class="steps">
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
          </div>

          <input
            type="file"
            id="wakaTimeFileUpload"
            ref="wakaTimeFileInput"
            accept=".json"
            @change="handleFileChange"
            v-if="importType === 'wakatime'" />
        </div>

        <UiButton
          text="Import Data"
          keyName="I"
          @click="importTrackingData"
          :disabled="isUploading" />

        <div v-if="importJob" class="import-status">
          <p>
            <span class="spinner">{{ spinnerText }}</span>
            {{ importStatusText }}
          </p>
          <div class="bar-container">
            <div class="bar" :style="{ width: importJob.progress + '%' }"></div>
          </div>
        </div>
      </section>
    </div>
  </NuxtLayout>
</template>

<script setup lang="ts">
import type { User } from "@prisma/client";
import { ref, onMounted, computed } from "vue";
import { Key } from "@waradu/keyboard";
import * as statsLib from "~~/lib/stats";
import type { ImportJob } from "~~/server/utils/import-jobs";

const userState = useState<User | null>("user");
const user = computed(() => userState.value);
const showApiKey = ref(false);
const toast = useToast();
const route = useRoute();
const keystrokeTimeout = ref(0);
const originalKeystrokeTimeout = ref(0);
const timeoutChanged = ref(false);
const hasGithubAccount = computed(() => !!user.value?.githubId);
const WAKATIME = "wakatime" as const;
const WAKAPI = "wakapi" as const;
type ImportType = typeof WAKATIME | typeof WAKAPI;
const importType = ref<ImportType>(WAKATIME);
const importApiKey = ref("");
const wakapiInstanceUrl = ref("");
const wakaTimeFileInput = ref<HTMLInputElement | null>(null);
const selectedFile = ref<File | null>(null);
const selectedFileName = ref<string | null>(null);
const uploadProgress = ref(0);
const isUploading = ref(false);
const importJob = ref<ImportJob | null>(null);
let eventSource: EventSource | null = null;
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

const apiKeyPlaceholder = computed(() => {
  return `Enter your ${importType.value === "wakatime" ? "WakaTime" : "WakAPI"} API Key`;
});

const importStatusText = computed(() => {
  if (!importJob.value) return "";
  const job = importJob.value;
  let status = job.status;

  if (job.status === "Uploading" && job.totalSize) {
    const uploadedMB = ((job.uploadedSize || 0) / (1024 * 1024)).toFixed(2);
    const totalMB = (job.totalSize / (1024 * 1024)).toFixed(2);
    return `Uploading: ${uploadedMB}MB / ${totalMB}MB (${job.progress}%)`;
  }

  if (job.status === "Processing") {
    const processed = job.processedCount || 0;
    return `Processing: ${processed} days processed (${job.progress}%)`;
  }

  return status;
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
  if (newJob && (newJob.status === "Completed" || newJob.status === "Failed")) {
    stopSpinner();
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    if (newJob.status === "Completed") {
      toast.success(
        `Successfully imported ${newJob.importedCount} heartbeats.`
      );
    } else if (newJob.status === "Failed") {
      toast.error(`Import failed: ${newJob.error}`);
    }
    setTimeout(() => {
      importJob.value = null;
    }, 5000);
  } else if (newJob) {
    startSpinner();
  } else {
    stopSpinner();
  }
});

function connectEventSource() {
  if (eventSource) return;

  eventSource = new EventSource("/api/import/status");

  eventSource.onopen = () => {
    console.log("EventSource connected");
  };

  eventSource.onmessage = (event) => {
    const jobStatus = JSON.parse(event.data);
    if (
      !jobStatus ||
      jobStatus.status === "no_job" ||
      jobStatus.status === "Completed" ||
      jobStatus.status === "Failed"
    ) {
      importJob.value = null;
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    } else {
      importJob.value = jobStatus as ImportJob;
    }
  };

  eventSource.onerror = (error) => {
    console.error("EventSource error:", error);
    toast.error("An error occurred with the status connection.");
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  };
}

onUnmounted(() => {
  if (eventSource) {
    eventSource.close();
  }
  stopSpinner();
});

async function fetchUserData() {
  if (userState.value) return userState.value;

  try {
    const data = await $fetch("/api/user");
    userState.value = data as User;

    if (data?.keystrokeTimeout) {
      statsLib.setKeystrokeTimeout(data.keystrokeTimeout);
    }

    return data;
  } catch (error) {
    console.error("Error fetching user data:", error);
    return null;
  }
}

onMounted(async () => {
  await fetchUserData();

  try {
    const job = await $fetch<any>("/api/import/status");
    if (
      job &&
      job.status !== "no_job" &&
      job.status !== "Completed" &&
      job.status !== "Failed"
    ) {
      importJob.value = job as ImportJob;
      connectEventSource();
    }
  } catch (error) {
    console.error("Error fetching initial import job status:", error);
  }

  if (user.value) {
    keystrokeTimeout.value = user.value.keystrokeTimeout;
    originalKeystrokeTimeout.value = user.value.keystrokeTimeout;
  }

  if (route.query.error) {
    const errorMessages: Record<string, string> = {
      link_failed: "Failed to link GitHub account",
      invalid_state: "Invalid state parameter",
      no_code: "No code provided",
      no_email: "No email found",
      github_auth_failed: "GitHub authentication failed",
    };

    const message = errorMessages[route.query.error as string] || "Error";
    toast.error(message);
  }

  if (route.query.success) {
    const successMessages: Record<string, string> = {
      github_linked: "GitHub account successfully linked",
      github_updated: "GitHub credentials updated",
      accounts_merged: "Accounts successfully merged",
    };

    const message = successMessages[route.query.success as string] || "Success";
    toast.success(message);
  }
});

useKeybind(
  [Key.L],
  async () => {
    if (hasGithubAccount) {
      await linkGithub();
    }
  },
  { prevent: true, ignoreIfEditable: true }
);

useKeybind(
  [Key.E],
  async () => {
    showEmailModal.value = true;
    newEmail.value = user.value?.email || "";
  },
  { prevent: true, ignoreIfEditable: true }
);

useKeybind(
  [Key.P],
  async () => {
    showPasswordModal.value = true;
    newPassword.value = "";
    confirmPassword.value = "";
  },
  { prevent: true, ignoreIfEditable: true }
);

useKeybind(
  [Key.Alt, Key.L],
  async () => {
    await logout();
  },
  { prevent: true, ignoreIfEditable: true }
);

useKeybind(
  [Key.S],
  async () => {
    toggleApiKey();
  },
  { prevent: true, ignoreIfEditable: true }
);

useKeybind(
  [Key.C],
  async () => {
    await copyApiKey();
  },
  { prevent: true, ignoreIfEditable: true }
);

useKeybind(
  [Key.R],
  async () => {
    await regenerateApiKey();
  },
  { prevent: true, ignoreIfEditable: true }
);

useKeybind(
  [Key.I],
  async () => {
    await importTrackingData();
  },
  { prevent: true, ignoreIfEditable: true }
);

useKeybind(
  [Key.Alt, Key.R],
  async () => {
    if (
      !confirm(
        "Confirm that you want to regenerate all your summaires which can take a while."
      )
    ) {
      return;
    }

    await regenerateSummaries();
  },
  { prevent: true, ignoreIfEditable: true }
);

async function updateKeystrokeTimeout() {
  if (!user.value) return;

  try {
    await $fetch("/api/user", {
      method: "POST",
      body: {
        keystrokeTimeout: keystrokeTimeout.value,
      },
    });

    if (userState.value) {
      userState.value.keystrokeTimeout = keystrokeTimeout.value;
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

    if (userState.value) {
      userState.value.email = newEmail.value;
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
      toast.success(`Selected file: ${input.files[0]!.name} (${fileSizeMB} MB)`);
    }
    importJob.value = null;
  } else {
    selectedFile.value = null;
    selectedFileName.value = null;
  }
}

async function importTrackingData() {
  if (importType.value === "wakatime") {
    if (!selectedFile.value) {
      toast.error("Please select a WakaTime export file");
      return;
    }

    try {
      isUploading.value = true;
      uploadProgress.value = 0;
      const file = selectedFile.value;
      const fileSize = file.size;

      console.log(
        `Starting upload of ${file.name}, size: ${(
          fileSize /
          (1024 * 1024)
        ).toFixed(2)}MB`
      );

      connectEventSource();

      if (fileSize <= CHUNK_SIZE) {
        const formData = new FormData();
        formData.append("file", selectedFile.value);
        toast.success("WakaTime data import started");

        await $fetch("/api/import", {
          method: "POST",
          body: formData,
        });
      } else {
        const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
        const fileId = Date.now().toString();
        toast.success(
          `Processing large file (${(fileSize / (1024 * 1024)).toFixed(2)}MB) in ${totalChunks} chunks`
        );

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
            onUploadProgress: (progressEvent: ProgressEvent) => {
              if (progressEvent.lengthComputable) {
                const chunkProgress =
                  progressEvent.loaded / progressEvent.total;
                const totalProgress =
                  (chunkIndex + chunkProgress) / totalChunks;
                if (importJob.value && importJob.value.status === "Uploading") {
                  importJob.value.progress = Math.round(totalProgress * 100);
                }
              }
            },
          });
        }

        await $fetch("/api/import", {
          method: "POST",
          body: { fileId, processChunks: true },
        });
      }

      toast.success("WakaTime data import completed");
      selectedFile.value = null;
      selectedFileName.value = null;
      uploadProgress.value = 0;
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
    if (!importApiKey.value) {
      toast.error("Please enter your WakAPI API Key");
      return;
    }

    if (!wakapiInstanceUrl.value) {
      toast.error("Please enter your WakAPI instance URL");
      return;
    }

    try {
      const payload = {
        apiKey: importApiKey.value,
        instanceType: importType.value,
        instanceUrl: wakapiInstanceUrl.value,
      };
      toast.success("WakAPI data import started");

      await $fetch("/api/import", {
        method: "POST",
        body: payload,
      });

      toast.success("WakAPI data import completed");
      importApiKey.value = "";
      wakapiInstanceUrl.value = "";
    } catch (error: any) {
      console.error("Error importing WakAPI data:", error);
      toast.error(error?.data?.message || "Failed to import WakAPI data");
    }
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
