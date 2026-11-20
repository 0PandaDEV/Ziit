document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const opener = target.closest<HTMLElement>("[data-open]");
  if (opener) {
    const dialog = document.querySelector<HTMLDialogElement>(opener.dataset.open!);
    dialog?.showModal();
    dialog?.querySelector<HTMLInputElement>("input")?.focus();
    return;
  }
  const closer = target.closest<HTMLElement>("[data-close]");
  if (closer) closer.closest("dialog")?.close();
});

document.addEventListener("click", (event) => {
  const el = (event.target as HTMLElement).closest<HTMLElement>("[data-toggle-secret]");
  if (el) {
    const input = document.querySelector<HTMLInputElement>(el.dataset.toggleSecret!);
    if (!input) return;
    const hidden = input.type === "password";
    input.type = hidden ? "text" : "password";
    const label = el.querySelector(".text");
    if (label) label.textContent = hidden ? "Hide API Key" : "Show API Key";
    return;
  }
  const copy = (event.target as HTMLElement).closest<HTMLElement>("[data-copy]");
  if (copy) {
    const input = document.querySelector<HTMLInputElement>(copy.dataset.copy!);
    if (!input) return;
    navigator.clipboard.writeText(input.value).then(
      () => window.toast("API Key copied to clipboard", "success"),
      () => window.toast("Failed to copy API key"),
    );
  }
});

export {};
