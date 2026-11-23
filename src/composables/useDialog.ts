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

function highlight(el: HTMLElement, query: string) {
  const name = el.dataset.name ?? "";
  const at = query ? name.toLowerCase().indexOf(query) : -1;
  if (at < 0) {
    el.textContent = name;
    return;
  }
  const mark = document.createElement("mark");
  mark.textContent = name.slice(at, at + query.length);
  el.replaceChildren(name.slice(0, at), mark, name.slice(at + query.length));
}

document.addEventListener("input", (event) => {
  const input = event.target as HTMLInputElement;
  if (input.dataset.filter === undefined) return;
  const dialog = input.closest("dialog");
  if (!dialog) return;
  const query = input.value.trim().toLowerCase();
  let shown = 0;
  for (const item of dialog.querySelectorAll<HTMLElement>(".item")) {
    const name = item.querySelector<HTMLElement>("[data-name]");
    const match = !query || !!name?.dataset.name?.toLowerCase().includes(query);
    item.hidden = !match;
    if (match) shown++;
    if (name) highlight(name, match ? query : "");
  }
  const count = dialog.querySelector<HTMLElement>("[data-count]");
  if (count) count.textContent = query ? `${shown} / ${count.dataset.count}` : count.dataset.count!;
  const empty = dialog.querySelector<HTMLElement>("[data-empty]");
  if (empty) empty.hidden = shown > 0;
  dialog.querySelector(".list-content")?.scrollTo(0, 0);
});

document.addEventListener("click", (event) => {
  const dialog = event.target;
  if (!(dialog instanceof HTMLDialogElement) || !dialog.matches(".list-modal, .modal")) return;
  const r = dialog.getBoundingClientRect();
  const inside = event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
  if (!inside) dialog.close();
});

document.addEventListener(
  "close",
  (event) => {
    const input = (event.target as HTMLElement).querySelector<HTMLInputElement>("[data-filter]");
    if (!input || !input.value) return;
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  },
  true,
);

export {};
