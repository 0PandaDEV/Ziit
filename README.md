<p align="center">
   <img src="https://github.com/user-attachments/assets/bc6a1efd-2a7a-473a-8f09-ae75cafeba84"/>
</p>

<h3 align="center">
   The swiss army knife of coding time tracking.
</h3>

<div align="center">
  <h3>
    <a href="https://ziit.app">Website</a>
    <span> • </span>
    <a href="https://github.com/0PandaDEV/Ziit/wiki/Deploy">Deploy</a>
    <span> • </span>
    <a href="#-features">Features</a>
    <span> • </span>
    <a href="https://github.com/0pandadev/ziit/issues">Issues</a>
    <span> • </span>
    <a href="https://discord.gg/Y7SbYphVw9">Discord</a>
  </h3>
</div>


> [!CAUTION]
> This project is in a early developement state and not production ready at the moment that is also why signups are currently disabeld on [ziit.app](https://ziit.app).

<details>
  <summary><kbd>Star History</kbd></summary>
  <a href="https://starchart.cc/0PandaDEV/Ziit">
    <picture>
      <img width="100%" src="https://starchart.cc/0PandaDEV/ziit.svg?variant=adaptive">
    </picture>
  </a>
</details>

## What is Ziit?

Ziit or also pronounecd "tseet" is an open source and self-hostable alternative to wakatime with the goal of having better UI and UX design as well as privacy of your data as its on your own server instead of the nasty cloud.

## Features

- Time tracking directly from VSCode to your ziit instance of choise.
- Advanced time filtering using differnt time ranges.
- Clean & Minimal dashboard showing only the information needed.
- Login with Github or Email+Password.
- Import Data from Wakatime or a Wakapi Instance.
- More to come...

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