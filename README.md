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
    Edit the environment variables in the `docker-compose.yml` file to set your configuration values:

    | Environment Variable | Description | Example |
    |---------------------|-------------|---------|
    | NUXT_DATABASE_URL | Database connection string | postgresql://postgres:root@postgres:5432/ziit |
    | NUXT_JWT_SECRET | Random string for JWT authentication | (Generate with `openssl rand --hex 64`) |
    | NUXT_GITHUB_CLIENT_ID | GitHub OAuth client ID | your_github_client_id |
    | NUXT_GITHUB_CLIENT_SECRET | GitHub OAuth client secret | your_github_client_secret |
    | NUXT_GITHUB_REDIRECT_URI | GitHub OAuth redirect URL | <https://your-domain.com/api/auth/github/callback> |

2. **Build and Start Containers:**

    ```bash
    docker compose up --build -d
    ```

    The application will be available at `http://localhost:3000` (or your configured host/port).

3. **Stop Containers:**

    ```bash
    docker compose down
    ```
