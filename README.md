# Ziit

> [!IMPORTANT]
> /tsiːt/<br>
> the point or period when something occurs. swiss german word for "time"

Ziit or also pronounecd "tseet" is an open source and self-hostable alternative to wakatime with the goal of having better UI and UX design as well as privacy of your data as its on your own server instead of the nasty cloud.

## Development

1. **Run the development server:**
    The server will start on `http://localhost:3000`.

    ```bash
    bun run dev
    ```

2. **Database Migrations (Development):**
    Apply database schema changes during development.

    ```bash
    bunx prisma migrate dev
    ```

## Docker Deployment

The easiest way to run Ziit is using Docker Compose.

1. **Configure Docker Compose:**
    Edit the `args` section in the `docker-compose.yml` file to set your configuration values:

    ```yaml:docker-compose.yml
    services:
      app:
        build:
          context: .
          args:
            - DATABASE_URL=${DATABASE_URL}
            - NUXT_AUTH_SECRET=${NUXT_AUTH_SECRET}
            - NUXT_GITHUB_CLIENT_ID=${NUXT_GITHUB_CLIENT_ID}
            - NUXT_GITHUB_CLIENT_SECRET=${NUXT_GITHUB_CLIENT_SECRET}
    ```

2. **Build and Start Containers:**

    ```bash
    docker compose up --build -d
    ```

    The application will be available at `http://localhost:3000` (or your configured host/port).

3. **Stop Containers:**

    ```bash
    docker compose down
    ```
