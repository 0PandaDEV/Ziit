FROM oven/bun:latest

WORKDIR /ziit

COPY package.json bun.lock ./
RUN bun install

COPY . .
RUN bunx prisma generate
RUN bun run build

EXPOSE 3000

CMD ["sh", "-c", "bunx prisma generate && bunx prisma migrate deploy && bun run .output/server/index.mjs"]
