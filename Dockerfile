FROM oven/bun:latest

ARG DATABASE_URL
ENV DATABASE_URL ${DATABASE_URL}

ARG JWT_SECRET
ENV JWT_SECRET ${JWT_SECRET}

ARG GITHUB_CLIENT_ID
ENV GITHUB_CLIENT_ID ${GITHUB_CLIENT_ID}

ARG GITHUB_CLIENT_SECRET
ENV GITHUB_CLIENT_SECRET ${GITHUB_CLIENT_SECRET}

ARG GITHUB_REDIRECT_URI
ENV GITHUB_REDIRECT_URI ${GITHUB_REDIRECT_URI}

WORKDIR /ziit

COPY package.json bun.lock ./
RUN bun install

COPY . .
RUN rm -f .env .env.* && \
  bunx prisma generate && \
  bun run build

EXPOSE 3000

CMD ["sh", "-c", "bunx prisma generate && bunx prisma migrate deploy && bun run .output/server/index.mjs"]
