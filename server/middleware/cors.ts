import { useRuntimeConfig } from "#imports";

export default defineEventHandler((event) => {
  const config = useRuntimeConfig();
  const corsOrigin = config.corsOrigin || event.node.req.headers.origin || "";
  const isProduction = process.env.NODE_ENV === "production";

  if (event.path?.startsWith("/api/")) {
    if (event.path?.startsWith("/api/external/")) {
      setResponseHeaders(event, {
        "Access-Control-Allow-Origin": "vscode-webview://*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "authorization,content-type",
        "Access-Control-Allow-Credentials": "true",
      });
    } else {
      const origin = event.node.req.headers.origin || corsOrigin;
      setResponseHeaders(event, {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "authorization,content-type",
        "Access-Control-Allow-Credentials": "true",
      });
    }
  }

  setHeader(event, "X-Frame-Options", "DENY");
  setHeader(event, "X-Content-Type-Options", "nosniff");
  setHeader(event, "X-XSS-Protection", "1; mode=block");
  setHeader(
    event,
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );

  if (isProduction) {
    setHeader(
      event,
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload"
    );
  }
});
