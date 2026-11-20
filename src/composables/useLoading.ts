const SHOW_AFTER_MS = 150;
const root = document.documentElement;
let active = false;
let shown = false;
let timer: number | undefined;
let delayTimer: number | undefined;
let startHref = "";

function finish() {
  if (!active) return;
  active = false;
  window.clearTimeout(timer);
  window.clearTimeout(delayTimer);
  if (!shown) return;
  root.dataset.loading = "done";
  timer = window.setTimeout(() => delete root.dataset.loading, 500);
}

function start() {
  window.clearTimeout(timer);
  window.clearTimeout(delayTimer);
  active = true;
  shown = false;
  startHref = location.href;
  delayTimer = window.setTimeout(() => {
    if (!active) return;
    shown = true;
    root.dataset.loading = "start";
  }, SHOW_AFTER_MS);
  timer = window.setTimeout(finish, 15000);
}

document.addEventListener(
  "click",
  (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target : null;
    const link = target?.closest<HTMLAnchorElement>("a[data-loading-bar]");
    if (link && new URL(link.href, location.href).href !== location.href) start();
  },
  true,
);

new MutationObserver(() => {
  if (active && location.href !== startHref) finish();
}).observe(document.documentElement, { childList: true, subtree: true });

window.addEventListener("pageshow", () => {
  active = false;
  delete root.dataset.loading;
});

export {};
