import { useRuntimeConfig } from "#imports";

export default defineEventHandler((event) => {
  const config = useRuntimeConfig();
  const corsOrigin = config.corsOrigin || "same-origin";

  if (event.path?.startsWith("/api/")) {
    if (event.path?.startsWith("/api/external/")) {
      setResponseHeaders(event, {
        "Access-Control-Allow-Origin": "vscode-webview://*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "authorization,content-type",
      });
    } else {
      setResponseHeaders(event, {
        "Access-Control-Allow-Origin": corsOrigin,
        "Access-Control-Allow-Methods": "GET,POST",
        "Access-Control-Allow-Headers": "authorization,content-type",
      });
    }
  }
});
