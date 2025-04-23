// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-04-09",
  devtools: { enabled: false },
  modules: ["@nuxtjs/sitemap", "nuxt-cron"],
  ssr: true,
  runtimeConfig: {
    pasetoKey: process.env.NUXT_PASETO_KEY,
    githubClientId: process.env.NUXT_GITHUB_CLIENT_ID,
    githubClientSecret: process.env.NUXT_GITHUB_CLIENT_SECRET,
    githubRedirectUri: process.env.NUXT_GITHUB_REDIRECT_URI,
    corsOrigin: process.env.NUXT_HOST || "same-origin",
    disableRegistering: process.env.NUXT_DISABLE_REGISTRATION,
  },
  nitro: {
    preset: "bun",
  },
  app: {
    head: {
      charset: "utf-8",
      viewport:
        "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
      title: "Ziit",
    },
  },
  cron: {
    runOnInit: true,
    timeZone: "UTC+0",
    jobsDir: "cron",
  },
  routeRules: {
    "/api/**": {
      cors: true,
      headers: {
        "Access-Control-Allow-Methods": "GET,POST",
        "Access-Control-Allow-Origin": "{{ runtimeConfig.corsOrigin }}",
      },
    },
    "/api/external/**": {
      cors: true,
      headers: {
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Origin": "vscode-webview://*",
        "Access-Control-Allow-Headers": "authorization,content-type",
      },
    },
  },
});
