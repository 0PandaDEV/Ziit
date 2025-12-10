FROM oven/bun:alpine AS build
WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY --link . .
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" bunx prisma generate
RUN bun run build

FROM node:22-alpine
WORKDIR /app

EXPOSE 3000

COPY --from=build /app /app

CMD ["sh", "-c", "npx prisma migrate deploy && node ./.output/server/index.mjs"]