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
    <a href="#features">Features</a>
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

Ziit (pronounced "tseet") is an open source, self-hostable alternative to WakaTime that provides a clean, minimal dashboard for viewing coding statistics while ensuring privacy by keeping your data on your own server. It tracks coding activity through editor integrations, collecting data about projects, languages, os, editor and time spent coding, with an intuitive dashboard similar to Plausible Analytics.

## Features

- Time tracking directly from VSCode to your ziit instance of choise.
- Advanced time filtering using differnt time ranges.
- Clean & Minimal dashboard showing only the information needed.
- Login with Github or Email and Password.
- Import Data from Wakatime or a Wakapi Instance.
- Saves data about your current project, os, editor and git branch.
- More to come...

## Preview

![Screenshot 2025-04-15 at 20-40-18 Ziit - Coding Statistics](https://github.com/user-attachments/assets/1c8c713e-ee61-4653-aaba-04e67dc6f8fa)

## Development

1. **Database Migrations (Development):**
   Apply database schema changes during development.

   ```bash
   bunx prisma migrate dev
   ```

2. **Run the development server:**
   The server will start on `http://localhost:3000`.

   ```bash
   bun run dev
   ```
