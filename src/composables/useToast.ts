type ToastType = "error" | "success";

function container(): HTMLElement {
  let el = document.getElementById("toasts");
  if (!el) {
    el = document.createElement("div");
    el.id = "toasts";
    el.className = "toast-container";
    document.body.appendChild(el);
  }
  return el;
}

export function toast(message: string, type: ToastType = "error", duration = 3000) {
  if (!message || !message.trim()) return;
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  el.addEventListener("click", () => el.remove());
  container().appendChild(el);
  setTimeout(() => el.remove(), duration);
}

const PENDING = "ziit_pending_toast";

export function toastNextPage(message: string, type: ToastType = "success") {
  try {
    sessionStorage.setItem(PENDING, JSON.stringify({ message, type }));
  } catch {
    toast(message, type);
  }
}

function showPending() {
  try {
    const raw = sessionStorage.getItem(PENDING);
    if (!raw) return;
    sessionStorage.removeItem(PENDING);
    const { message, type } = JSON.parse(raw);
    toast(message, type);
  } catch {}
}

declare global {
  interface Window {
    toast: typeof toast;
    toastNextPage: typeof toastNextPage;
  }
}

window.toast = toast;
window.toastNextPage = toastNextPage;

function scan() {
  for (const el of document.querySelectorAll<HTMLElement>("[data-toast]:not([data-shown])")) {
    el.dataset.shown = "";
    toast(el.dataset.toast ?? "", (el.dataset.toastType as ToastType) || "error");
  }
}

showPending();
scan();
new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
