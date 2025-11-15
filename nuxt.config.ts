// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-04-09",
  devtools: { enabled: false },
  modules: [
    "@nuxtjs/sitemap",
    "nuxt-cron",
    "@vite-pwa/nuxt",
    "@waradu/keyboard/nuxt",
  ],
  ssr: true,
  runtimeConfig: {
    pasetoKey: process.env.NUXT_PASETO_KEY,
    adminKey: process.env.NUXT_ADMIN_KEY,
    baseUrl: process.env.NUXT_BASE_URL,
    disableRegistering: process.env.NUXT_DISABLE_REGISTRATION,
    githubClientId: process.env.NUXT_GITHUB_CLIENT_ID,
    githubClientSecret: process.env.NUXT_GITHUB_CLIENT_SECRET,
    epilogueAppId: process.env.NUXT_EPILOGUE_APP_ID,
    epilogueAppSecret: process.env.NUXT_EPILOGUE_APP_SECRET,
  },
  nitro: {
    preset: "node-server",
    experimental: {
      openAPI: process.env.NODE_ENV === "development",
      wasm: false,
    },
    minify: true,
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
    },
    "/leaderboard": { cache: { maxAge: 5 * 60 } },
    "/stats": { cache: { maxAge: 5 * 60 } },
  },
  sitemap: {
    defaults: {
      lastmod: new Date().toISOString(),
      priority: 0.9,
      changefreq: "weekly",
    },
    urls: [
      {
        loc: "/stats",
        lastmod: new Date().toISOString(),
        priority: 1,
        changefreq: "daily",
      },
    ],
  },
  pwa: {
    manifest: {
      name: "Ziit",
      short_name: "Ziit",
      theme_color: "#191919",
      background_color: "#191919",
      display: "standalone",
      orientation: "portrait",
      icons: [
        {
          src: "/pwa-192x192.png",
          sizes: "192x192",
          type: "image/png",
        },
        {
          src: "/pwa-512x512.png",
          sizes: "512x512",
          type: "image/png",
        },
      ],
    },
    devOptions: {
      enabled: true,
      suppressWarnings: true,
      navigateFallback: "/",
      navigateFallbackAllowlist: [/^\/$/],
      type: "module",
    },
  },
});
