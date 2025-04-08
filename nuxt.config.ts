// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2024-11-01",
  devtools: { enabled: false },
  ssr: true,
  runtimeConfig: {
    jwtSecret: process.env.NUXT_JWT_SECRET,
    githubClientId: process.env.NUXT_GITHUB_CLIENT_ID,
    githubClientSecret: process.env.NUXT_GITHUB_CLIENT_SECRET,
    githubRedirectUri: process.env.NUXT_GITHUB_REDIRECT_URI,
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
      meta: [
        {
          "http-equiv": "Permissions-Policy",
          content: "camera=(), microphone=(), geolocation=()",
        },
        { "http-equiv": "X-Frame-Options", content: "DENY" },
        {
          "http-equiv": "Clear-Site-Data",
          content: '"cache","cookies","storage"',
        },
        {
          "http-equiv": "Cross-Origin-Embedder-Policy",
          content: "require-corp",
        },
        {
          "http-equiv": "Strict-Transport-Security",
          content: "max-age=31536000; includeSubDomains",
        },
        { "http-equiv": "X-Content-Type-Options", content: "nosniff" },
        { "http-equiv": "X-Permitted-Cross-Domain-Policies", content: "none" },
        {
          "http-equiv": "Referrer-Policy",
          content: "strict-origin-when-cross-origin",
        },
        { "http-equiv": "Cross-Origin-Opener-Policy", content: "same-origin" },
        {
          "http-equiv": "Cross-Origin-Resource-Policy",
          content: "same-origin",
        },
        {
          "http-equiv": "Content-Security-Policy",
          content:
            "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'",
        },
      ],
    },
  },
});
