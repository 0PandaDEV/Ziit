FROM oven/bun:alpine AS builder
WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" bunx prisma generate
RUN bun run build

FROM alpine:3.19
WORKDIR /app

RUN apk add --no-cache nodejs=~20 npm && \
  npm install -g prisma@latest --omit=dev && \
  rm -rf /var/cache/apk/* /tmp/* /var/tmp/* ~/.npm

COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/.output ./.output

USER nobody
EXPOSE 3000
CMD ["sh", "-c", "prisma migrate deploy && node ./.output/server/index.mjs"]
