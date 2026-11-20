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

declare global {
  interface Window {
    toast: typeof toast;
  }
}

window.toast = toast;

function scan() {
  for (const el of document.querySelectorAll<HTMLElement>("[data-toast]:not([data-shown])")) {
    el.dataset.shown = "";
    toast(el.dataset.toast ?? "", (el.dataset.toastType as ToastType) || "error");
  }
}

scan();
new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
