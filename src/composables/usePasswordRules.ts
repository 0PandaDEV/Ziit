function rules(input: HTMLInputElement): HTMLElement | null {
  const selector = input.dataset.rules;
  return selector ? document.querySelector<HTMLElement>(selector) : null;
}

function update(input: HTMLInputElement) {
  const list = rules(input);
  if (!list) return;
  for (const li of list.querySelectorAll<HTMLElement>("li[data-pattern]")) {
    li.classList.toggle("met", new RegExp(li.dataset.pattern ?? "").test(input.value));
  }
}

function target(event: Event): HTMLInputElement | null {
  const el = event.target;
  return el instanceof HTMLInputElement && el.dataset.rules ? el : null;
}

document.addEventListener("input", (event) => {
  const input = target(event);
  if (input) update(input);
});

document.addEventListener("focusin", (event) => {
  const input = target(event);
  if (!input) return;
  update(input);
  rules(input)?.removeAttribute("hidden");
});

document.addEventListener("focusout", (event) => {
  const input = target(event);
  if (input) rules(input)?.setAttribute("hidden", "");
});

export {};
