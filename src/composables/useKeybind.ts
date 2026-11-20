const editable = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

function normalize(combo: string): { key: string; alt: boolean } {
  const parts = combo.toLowerCase().split("+");
  return { key: parts[parts.length - 1] ?? "", alt: parts.includes("alt") };
}

document.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey) return;
  const inEditable = editable(event.target);
  const pressed = event.key.toLowerCase();
  for (const el of document.querySelectorAll<HTMLElement>("[data-key]")) {
    const { key, alt } = normalize(el.dataset.key!);
    if (key !== pressed || alt !== event.altKey) continue;
    if (inEditable && el.dataset.keyEditable === undefined) continue;
    if ((el as HTMLButtonElement).disabled || el.hidden || el.closest("[hidden]")) continue;
    event.preventDefault();
    el.click();
    return;
  }
  if (pressed === "f" && !inEditable && !event.altKey) {
    window.toast("You payed respect to the easter egg", "success");
  }
});

export {};
