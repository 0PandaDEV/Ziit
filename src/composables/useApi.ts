type Json = Record<string, unknown>;

async function call(url: string, method: string, body?: Json): Promise<any> {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
    redirect: "follow",
  });
  const text = await response.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {}
  if (!response.ok) throw new Error(data?.message || "Request failed");
  return data;
}

function finish(el: HTMLElement, data: any) {
  const leaving = el.dataset.redirect || el.dataset.reload !== undefined;
  if (el.dataset.success) {
    if (leaving) window.toastNextPage(el.dataset.success, "success");
    else window.toast(el.dataset.success, "success");
  }
  if (el.dataset.redirect) location.href = el.dataset.redirect;
  else if (el.dataset.reload !== undefined) location.reload();
  const target = el.dataset.apply;
  if (target && data) {
    const [selector, field] = target.split("@");
    const node = selector ? document.querySelector<HTMLInputElement>(selector) : null;
    if (node && field && data[field] !== undefined) node.value = data[field];
  }
}

function formBody(form: HTMLFormElement): Json | string {
  const body: Json = {};
  const data = new FormData(form);
  for (const [key, value] of data.entries()) body[key] = value as string;
  const confirm = body["confirm"];
  delete body["confirm"];
  if (confirm !== undefined && confirm !== body["password"]) return "Passwords do not match";
  for (const key of Object.keys(body)) if (body[key] === "") delete body[key];
  return body;
}

document.addEventListener("submit", async (event) => {
  const form = event.target as HTMLFormElement;
  if (!form.dataset.api) return;
  event.preventDefault();
  const body = formBody(form);
  if (typeof body === "string") return window.toast(body);
  const button = form.querySelector<HTMLButtonElement>("button[type=submit]");
  if (button) button.disabled = true;
  try {
    const data = await call(form.dataset.api, form.dataset.method || "POST", body);
    finish(form, data);
  } catch (error) {
    window.toast((error as Error).message);
  } finally {
    if (button) button.disabled = false;
  }
});

document.addEventListener("click", async (event) => {
  const el = (event.target as HTMLElement).closest<HTMLElement>("[data-api]");
  if (!el || el.tagName === "FORM") return;
  if (el.dataset.confirm && !window.confirm(el.dataset.confirm)) return;

  if (el.dataset.countdown !== undefined && !el.dataset.armed) {
    const label = el.querySelector(".text")!;
    const original = label.textContent!;
    el.dataset.armed = "1";
    let left = 5;
    label.textContent = `Click to confirm ${el.dataset.countdown}... ${left}`;
    const timer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(timer);
        delete el.dataset.armed;
        label.textContent = original;
      } else label.textContent = `Click to confirm ${el.dataset.countdown}... ${left}`;
    }, 1000);
    return;
  }

  try {
    const body = el.dataset.body ? (JSON.parse(el.dataset.body) as Json) : undefined;
    const data = await call(el.dataset.api!, el.dataset.method || "POST", body);
    if (el.dataset.openUrl !== undefined && data?.url) location.href = data.url;
    else finish(el, data);
  } catch (error) {
    window.toast((error as Error).message);
  }
});

export {};
