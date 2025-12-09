import { defineConfig, env } from "prisma/config";
import "dotenv/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url:
      env("NUXT_DATABASE_URL") ||
      "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});
