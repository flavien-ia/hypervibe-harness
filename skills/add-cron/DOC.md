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

4. **Automatic clock choice**: Hypervibe decides for itself which infrastructure to use (you have no choice to make) among 3 options:
  - **Dedicated Cloudflare Worker**: precise to the second, ideal for timing-critical tasks. 5 free spots per Cloudflare account.
  - **Shared Cloudflare dispatcher**: a single Worker shared across all your projects. Precise to the minute. Ideal when the 5 Cloudflare spots are saturated (a single spot for N tasks).
  - **GitHub Action**: free, unlimited, but with **a possible 30-60 min delay**. Ideal for reports, digests, cleanups where exact timing has no impact.

5. **Automatic configuration**: depending on the choice, Hypervibe scaffolds everything, the clock, the protected endpoint `/api/cron/<name>` on the Next.js side, the `CRON_SECRET` key (generated if missing), the GitHub secrets if applicable.

6. **Recap**: Hypervibe explains in one sentence **which clock was chosen and why** (for example: *"I put it on the GitHub clock because it's a weekly report, exact timing has no impact"*).

7. **Up to you to code the logic**: the task is in place but does nothing yet. Hypervibe has prepared the file where you (or Claude) will write what it should run.

## What it creates for you

- A **protected route** `/api/cron/<name>` on the Next.js side (with `CRON_SECRET` verification)
- A **clock** on the appropriate infrastructure (Cloudflare Worker, shared dispatcher, or GitHub Action)
- The `CRON_SECRET` key in `.env` + Vercel
- An update to `CLAUDE.md` with the task recap

## Prerequisites

- The project must be Next.js deployed on Vercel (typically via `/bootstrap`)
- For Cloudflare clocks: Cloudflare connected to your computer (`/start` handles it). If Cloudflare is not available, Hypervibe automatically switches to GitHub Action.

## Tips

{{callout:tip|You can drive it in natural language}}
Once the task is in place, simply tell Hypervibe:
- *"run the task right now to test it"*, manual trigger
- *"show me the latest triggers"*, history
- *"change the schedule to 10am"*, cron modification
- *"delete this task"*, full deletion

You have **nothing** to type in a terminal.
{{/callout}}

{{callout:info|Why 3 clocks}}
Cloudflare is precise (to the second) but limited to 5 free spots. GitHub Actions is unlimited but can be 30-60 min late. The shared dispatcher is a smart compromise: precise to the minute, and uses a single Cloudflare spot for N tasks across N projects. Hypervibe picks the right option for you based on the nature of the task and the remaining room.
{{/callout}}

{{callout:warning|Bad candidate for /add-cron}}
If your need requires a **continuous process** (24/7), **persistent in-memory state** between runs, or takes **more than 60 seconds** per run, you should run `/add-automation` instead (not `/add-cron`). Hypervibe detects this case and redirects you automatically.
{{/callout}}
