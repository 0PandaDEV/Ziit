<p align="center">
   <img src="https://github.com/user-attachments/assets/bc6a1efd-2a7a-473a-8f09-ae75cafeba84"/>
</p>

<h3 align="center">
   The Swiss army knife of code time tracking.
</h3>

<div align="center">
    <a href="https://ziit.app">Website</a>
    <span> • </span>
    <a href="https://docs.ziit.app">Docs</a>
    <span> • </span>
    <a href="#features">Features</a>
    <span> • </span>
    <a href="https://github.com/0pandadev/ziit/issues">Issues</a>
    <span> • </span>
    <a href="https://discord.gg/Y7SbYphVw9">Discord</a>
</div>

> [!CAUTION]
> Ziit is nearing the relase of v1.0.0 you can track the progress [here](https://github.com/0PandaDEV/Ziit/milestone/1).

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

## Preview

![Screenshot 2025-04-17 at 16-53-09 Ziit - Coding Statistics](https://github.com/user-attachments/assets/ea0c7fff-35ce-4322-a689-5309a5633f59)

## Features

- Time tracking directly from VSCode to your ziit instance of choise.
- Advanced time filtering using differnt time ranges.
- Clean & Minimal dashboard showing only the information needed.
- Login with Github or Email and Password.
- Import Data from Wakatime or a Wakapi Instance.
- Saves data about your current project, os, editor and git branch.
- More to come...

## How to use Ziit

First [setup an instance](https://github.com/0PandaDEV/Ziit/wiki/Deploy) or sign up on the public one <https://ziit.app> then install the extension by searching for "Ziit".

The extension is available on:

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=pandadev.ziit)
- [OpenVSX Registry](https://open-vsx.org/extension/pandadev/ziit)

For an extension setup guide follow the one in your profile on your instance or <https://ziit.app/profile> at the bottom of the page.

## Development

### Prerequisites

- [Bun](https://bun.sh/)
- [TimescaleDB](https://docs.timescale.com/self-hosted/latest/install/installation-docker/)

### Setup

1. **Install dependencies:**

   ```bash
   bun i
   ```

1. **Database Migrations:**
   Apply database schema changes.

   ```bash
   bunx prisma migrate dev
   ```

2. **Run the development server:**
   The server will start on `http://localhost:3000`.

   ```bash
   bun dev
   ```
