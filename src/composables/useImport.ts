const CHUNK_SIZE = 95 * 1024 * 1024;
const SPINNER = ["-", "/", "|", "\\"];

function bind() {
  const root = document.getElementById("import");
  if (root && !root.dataset.bound) {
    root.dataset.bound = "";
    init(root);
  }
}

bind();
new MutationObserver(bind).observe(document.body, { childList: true, subtree: true });

function field<T extends HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

async function post(url: string, body: BodyInit, json = false): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: json ? { "Content-Type": "application/json" } : undefined,
    body: json ? JSON.stringify(body) : body,
    credentials: "include",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || "Request failed");
  return data;
}

async function uploadFile(file: File) {
  if (file.size <= CHUNK_SIZE) {
    const form = new FormData();
    form.append("file", file);
    await post("/api/import/file", form);
    return;
  }
  const fileId = crypto.randomUUID();
  const total = Math.ceil(file.size / CHUNK_SIZE);
  for (let index = 0; index < total; index++) {
    const form = new FormData();
    form.append("fileId", fileId);
    form.append("chunkIndex", String(index));
    form.append("totalChunks", String(total));
    form.append("fileName", file.name);
    form.append("fileSize", String(file.size));
    form.append("chunk", file.slice(index * CHUNK_SIZE, Math.min((index + 1) * CHUNK_SIZE, file.size)));
    await post("/api/import/chunk", form);
  }
  await post("/api/import", { fileId, processChunks: true } as any, true);
}

function init(root: HTMLElement) {
  const status = field<HTMLElement>("#import-status")!;
  const message = status.querySelector<HTMLElement>(".message")!;
  const spinner = status.querySelector<HTMLElement>(".spinner")!;
  const bar = status.querySelector<HTMLElement>(".bar")!;
  let source: EventSource | null = null;
  let tick = 0;
  let spin: number | undefined;

  const render = (job: any) => {
    status.hidden = !job;
    if (!job) return;
    message.textContent = job.message || "";
    bar.style.width = `${job.progress || 0}%`;
    const done = job.status === "Completed" || job.status === "Failed";
    spinner.hidden = done;
    if (done && spin) {
      clearInterval(spin);
      spin = undefined;
    }
    if (!done && !spin) {
      spin = window.setInterval(() => (spinner.textContent = SPINNER[++tick % SPINNER.length] ?? "-"), 200);
    }
    if (job.status === "Failed") window.toast(`Import failed: ${job.error || "Unknown error"}`);
  };

  const connect = () => {
    if (source && source.readyState !== EventSource.CLOSED) return;
    source = new EventSource("/api/import/status");
    source.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.activeJob) render(data.activeJob);
      if (!data.hasActiveJobs) {
        source?.close();
        source = null;
      }
    };
    source.onerror = () => {
      source?.close();
      source = null;
    };
  };

  fetch("/api/import/status", { credentials: "include" })
    .then((r) => r.json())
    .then((data) => {
      if (data.activeJob) render(data.activeJob);
      if (data.hasActiveJobs) connect();
    })
    .catch(() => {});

  const type = () => root.querySelector<HTMLInputElement>("input[name=type]:checked")!.value;
  const input = (name: string) => root.querySelector<HTMLInputElement>(`[name=${name}]`)!;

  const fileInput = input("file");
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const mb = (file.size / 1048576).toFixed(2);
    window.toast(
      file.size > CHUNK_SIZE
        ? `Large file detected (${mb} MB). Will upload in ${Math.ceil(file.size / CHUNK_SIZE)} chunks.`
        : `Selected file: ${file.name} (${mb} MB)`,
      "success",
    );
  });

  root.querySelector<HTMLElement>("#import-submit")!.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const kind = type();
    try {
      button.disabled = true;
      if (kind === "wakatime-file") {
        const file = fileInput.files?.[0];
        if (!file) return window.toast("Please select a WakaTime export file");
        await uploadFile(file);
        fileInput.value = "";
      } else {
        const apiKey = input("apiKey").value;
        if (!apiKey) return window.toast(kind === "wakapi" ? "Please enter your WakAPI API Key" : "Please enter your WakaTime API Key");
        const payload: Record<string, string> = { instanceType: kind === "wakapi" ? "wakapi" : "wakatime", apiKey };
        if (kind === "wakapi") {
          const url = input("instanceUrl").value;
          if (!url) return window.toast("Please enter your WakAPI instance URL");
          payload.instanceUrl = url;
        }
        await post("/api/import", payload as any, true);
      }
      window.toast("Import started", "success");
      connect();
    } catch (error) {
      window.toast((error as Error).message || "Failed to import data");
    } finally {
      button.disabled = false;
    }
  });
}

export {};
