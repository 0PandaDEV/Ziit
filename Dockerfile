FROM oven/bun:alpine AS build
WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" bunx prisma generate
RUN bun run build

FROM gcr.io/distroless/nodejs22-debian12 AS runtime
WORKDIR /app

EXPOSE 3000

COPY --from=build /app /app

CMD [ ".output/server/index.mjs" ]