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
      viewport: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
      title: "Ziit",
    }
  }
});
