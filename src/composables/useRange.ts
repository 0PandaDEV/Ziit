function remember() {
  const range = document.querySelector<HTMLElement>("[data-range]")?.dataset.range;
  if (range) document.cookie = `ziit_range=${range}; path=/; max-age=31536000; samesite=lax`;
}

remember();
new MutationObserver(remember).observe(document.body, { childList: true, subtree: true });

export {};
