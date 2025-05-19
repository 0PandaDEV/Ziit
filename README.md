<p align="center">
   <img src="https://github.com/user-attachments/assets/bc6a1efd-2a7a-473a-8f09-ae75cafeba84"/>
</p>

<h3 align="center">
   The Swiss army knife of code time tracking.
</h3>

<div align="center">
    <a href="https://docs.ziit.app">Docs</a>
    <span> • </span>
    <a href="#features">Features</a>
    <span> • </span>
    <a href="https://ziit.app">Public Instance</a>
    <span> • </span>
    <a href="https://discord.gg/Y7SbYphVw9">Discord</a>
</div>

<br>

> [!IMPORTANT]
> Vote for Ziit on [AlternativeTo](https://alternativeto.net/software/ziit/about/), [ProductHunt](https://www.producthunt.com/posts/ziit) to help me promote it.

<details>
  <summary><kbd>Star History</kbd></summary>
  <a href="https://starchart.cc/0PandaDEV/Ziit">
    <picture>
      <img width="100%" src="https://starchart.cc/0PandaDEV/ziit.svg?variant=adaptive">
    </picture>
  </a>
</details>

## What is Ziit?

Ziit (pronounced "tseet") is an open source, self-hostable alternative to WakaTime that provides a clean, minimal and fast dashboard for viewing coding statistics while ensuring privacy by keeping your data on your own server. It tracks coding activity through an IDE extension, collecting data about projects, languages, editors, files, branches, OS, and time spent coding, with an intuitive dashboard similar to Plausible Analytics.

## Preview

![Ziit](https://github.com/user-attachments/assets/bf8e8d72-3181-47e7-924f-537c74f68819)

## Features

- Time tracking directly from VSCode to your ziit instance of choise.
- Advanced time filtering using differnt time ranges.
- Clean & Minimal dashboard showing only the information needed.
- Login with Github or Email and Password.
- Import Data from Wakatime or a Wakapi Instance.
- Saves data about your current project, os, editor and git branch.
- More to come...

## How to use Ziit

First [setup an instance](https://docs.ziit.app/deploy) or sign up on the public one <https://ziit.app> then install the extension by searching for "Ziit" in your favorite IDE.

Supported IDE's:

- [VS Code (Including all forks)](https://docs.ziit.app/extensions/vscode)
- [JetBrains (Waiting for approval)](https://plugins.jetbrains.com/plugin/27391-ziit)

For more details on how to setup the IDE extensions checkout the [docs](https://docs.ziit.app/extensions).

## Development

### Prerequisites

- [Bun](https://bun.sh/)
- [TimescaleDB](https://docs.timescale.com/self-hosted/latest/install/installation-docker/)

### Setup

1. **Install dependencies:**

   ```bash
   bun i
   ```

2. **Database Migrations:**
   Apply database schema changes.

   ```bash
   bunx prisma migrate dev
   ```

3. **Set the environment variables:**
   It is imporatnt that you make a `.env` using the [.env.example](https://github.com/0PandaDEV/Ziit/blob/main/.env.example) as a template and set the correct values. All the instructions needed are in the example file.

4. **Run the development server:**
   The server will start on `http://localhost:3000`.

   ```bash
   bun dev
   ```
