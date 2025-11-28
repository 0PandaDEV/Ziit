import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./client/client";
export * from "@prisma/client";

const adapter = new PrismaPg({
  connectionString: process.env.NUXT_DATABASE_URL!,
});

export const prisma = new PrismaClient({ adapter });
