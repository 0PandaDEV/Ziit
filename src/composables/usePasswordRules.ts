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

function match(form: HTMLFormElement) {
  const confirm = form.querySelector<HTMLInputElement>("input[data-match]");
  const status = form.querySelector<HTMLElement>(".password-match");
  if (!confirm || !status) return;
  const original = form.querySelector<HTMLInputElement>(`input[name="${confirm.dataset.match}"]`);
  status.dataset.state = !confirm.value ? "empty" : confirm.value === original?.value ? "match" : "mismatch";
}

document.addEventListener("input", (event) => {
  const input = target(event);
  if (input) update(input);
  const form = (event.target as HTMLElement).closest?.("form");
  if (form) match(form);
});

document.addEventListener("reset", (event) => {
  const form = event.target as HTMLFormElement;
  setTimeout(() => match(form));
});

document.addEventListener("focusin", (event) => {
  const input = target(event);
  if (!input) return;
  update(input);
  rules(input)?.removeAttribute("hidden");
});

document.addEventListener("focusout", (event) => {
  const input = target(event);
  const list = input && rules(input);
  if (list && !list.classList.contains("inline")) list.setAttribute("hidden", "");
});

export {};
