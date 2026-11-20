let running = false;

async function revalidate() {
  const stale = document.querySelector<HTMLElement>(".stats-dashboard[data-stale]");
  if (!stale || running) return;
  running = true;
  stale.removeAttribute("data-stale");
  const href = location.href;
  try {
    const response = await fetch(href, {
      headers: { "x-ziit-refresh": "1" },
      credentials: "same-origin",
    });
    if (!response.ok || location.href !== href) return;
    const next = new DOMParser().parseFromString(await response.text(), "text/html");
    const fresh = next.querySelector(".stats-dashboard");
    const current = document.querySelector(".stats-dashboard");
    if (!fresh || !current || document.querySelector("dialog[open]")) return;
    current.replaceWith(document.importNode(fresh, true));
    const time = next.querySelector(".coding-time");
    const label = document.querySelector(".coding-time");
    if (time && label) label.textContent = time.textContent;
  } catch {
    return;
  } finally {
    running = false;
  }
}

revalidate();
new MutationObserver(revalidate).observe(document.body, { childList: true, subtree: true });

export {};
