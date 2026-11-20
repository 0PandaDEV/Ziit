const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const current = document.cookie.split("; ").find((c) => c.startsWith("ziit_tz="));
if (!current || current.slice("ziit_tz=".length) !== zone) {
  document.cookie = `ziit_tz=${zone}; path=/; max-age=31536000; samesite=lax`;
  if (document.querySelector("[data-needs-tz]") !== null && !sessionStorage.getItem("tz-reload")) {
    sessionStorage.setItem("tz-reload", "1");
    location.reload();
  }
}

export {};
