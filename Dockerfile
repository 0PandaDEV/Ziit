FROM rust:1-bookworm AS build
WORKDIR /app

RUN cargo install topcoat-cli --locked

COPY Cargo.toml Cargo.lock build.rs ./
COPY src ./src
COPY server ./server
COPY migrations ./migrations
RUN mkdir -p public && cargo build --release && topcoat asset bundle --release

FROM debian:bookworm-slim
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/target/release/ziit /app/ziit
COPY --from=build /app/target/release/assets /app/assets
COPY --from=build /app/public /app/public
COPY styles ./styles
COPY public ./public

ENV HOST=0.0.0.0 \
    PORT=3000 \
    ZIIT_ENV=production

EXPOSE 3000

CMD ["/app/ziit"]
