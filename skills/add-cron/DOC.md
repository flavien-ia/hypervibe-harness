# /add-cron

Adds a task that runs automatically at a fixed time in your project. Ideal for sending a newsletter every night, a weekly cleanup, or a monthly report.

## When to use it

- Send a **daily newsletter** at a fixed time
- **Clean up** the database at night (delete temporary files, expired sessions, etc.)
- **Sync** your data with an external API every hour
- Generate an automatic **weekly report**

## How it works

1. **Task description**: you describe in one sentence what the task should do (e.g.: *"send a weekly SEO report by email"*, *"reset user quotas at midnight"*).

2. **When to run it**: you specify the schedule in natural language (*"every day at 9am"*, *"every Monday morning"*, *"every hour"*). Hypervibe converts it into a UTC cron expression.

3. **Short name**: you give a kebab-case name for the task (`rapport-hebdo`, `sync-clients`, `nettoyage`).

4. **Automatic clock choice**: Hypervibe decides for itself which clock to use (you have no choice to make):
  - **Your shared clock** (the default, for virtually everything): a single mechanism that serves **all** your projects. Precise to the minute, and zero extra cost no matter how many tasks you add. It is the same clock that already handles your database backups and your quota watch.
  - **Dedicated Cloudflare Worker** (rare): only when the task needs its own isolated resources on Cloudflare (its own R2, KV or D1 space, or a secret that must not be shared with your other projects).
  - **GitHub Action** (fallback): used only when Cloudflare is not set up on your computer. Free and unlimited, but with **a possible 30-60 min delay**.

5. **Automatic configuration**: Hypervibe scaffolds everything, the protected endpoint `/api/cron/<name>` on the Next.js side, the `CRON_SECRET` key (generated if missing), the registration of the schedule on the chosen clock (and the GitHub secrets if the GitHub clock is used).

6. **Recap**: Hypervibe explains in one sentence **which clock was chosen and why** (for example: *"I put it on your shared clock: precise to the minute, it serves all your projects at zero extra cost"*).

7. **Up to you to code the logic**: the task is in place but does nothing yet. Hypervibe has prepared the file where you (or Claude) will write what it should run.

## What it creates for you

- A **protected route** `/api/cron/<name>` on the Next.js side (with `CRON_SECRET` verification)
- The task **registered on the right clock** (your shared clock by default; dedicated Worker or GitHub Action when justified)
- On the shared clock: the schedule saved in a small **versioned registry** on your computer (every change is recorded, you can always see what changed and when)
- The `CRON_SECRET` key in `.env` + Vercel
- An update to `CLAUDE.md` with the task recap

## Prerequisites

- The project must be Next.js deployed on Vercel (typically via `/bootstrap`)
- For the shared clock (and dedicated Workers): Cloudflare connected to your computer (`/start` handles it). If Cloudflare is not available, Hypervibe automatically switches to GitHub Action.

## Tips

{{callout:tip|You can drive it in natural language}}
Once the task is in place, simply tell Hypervibe:
- *"run the task right now to test it"*, manual trigger
- *"show me the latest triggers"*, history
- *"change the schedule to 10am"*, cron modification
- *"delete this task"*, full deletion

You have **nothing** to type in a terminal.
{{/callout}}

{{callout:info|One clock for everything}}
Behind the scenes, all your projects share **a single clock** (a mutualized Cloudflare mechanism called `hypervibe-jobs`). It handles your scheduled tasks, your database backups and your quota watch, ticks every minute, and consumes a single Cloudflare cron slot in total, whether you have 1 task or 50 spread across 10 projects. Its schedule list is versioned (git) on your computer, so every change leaves a trace. A dedicated clock is created only when a task really needs its own isolated resources.
{{/callout}}

{{callout:warning|Bad candidate for /add-cron}}
If your need requires a **continuous process** (24/7), **persistent in-memory state** between runs, or takes **more than 60 seconds** per run, you should run `/add-automation` instead (not `/add-cron`). Hypervibe detects this case and redirects you automatically.
{{/callout}}
