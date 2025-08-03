import { ref } from "vue";

interface Toast {
  id: string;
  message: string;
  type: string;
}

const toasts = ref<Toast[]>([]);
let nextId = 0;

export const useToast = (
  msg?: string,
  toastType = "error",
  duration = 5000,
) => {
  const show = (text: string, msgType = "error", msgDuration = 3000) => {
    if (!text || text.trim() === "") {
      return;
    }

    const id = `toast-${nextId++}`;
    const toast = { id, message: text, type: msgType };
    toasts.value.push(toast);

    setTimeout(() => {
      hideById(id);
    }, msgDuration);
  };

  const error = (text: string, msgDuration = 3000) =>
    show(text, "error", msgDuration);

  const success = (text: string, msgDuration = 3000) =>
    show(text, "success", msgDuration);

  const hideById = (id: string) => {
    const index = toasts.value.findIndex((toast) => toast.id === id);
    if (index !== -1) {
      toasts.value.splice(index, 1);
    }
  };

  const hide = () => {
    toasts.value = [];
  };

  if (msg) {
    show(msg, toastType, duration);
  }

  return {
    toasts,
    show,
    error,
    success,
    hide,
    hideById,
  };
};
