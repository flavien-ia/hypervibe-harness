# /add-automation

Adds an automation: a process that runs in the background for your app, or a recurring mission for yourself. Scheduled task, long-running process, isolated webhook, heavy computation, or a personal AI brief: Hypervibe analyzes your need and picks the right home for it.

## When to use it

- You have a **process that must run continuously** (24/7), for example: monitoring a mailbox, reading an RSS feed, listening to a message queue
- You have a **heavy job** that takes more than 60 seconds (video transcoding, complex PDF generation, intensive computation)
- You want to **isolate a webhook** from a third-party service (e.g. Slack) from the rest of your site
- You have **persistent state** to keep between runs (internal queue, memory cache)
- You want a **recurring mission for yourself**: a morning brief, a weekly analysis, a watch that alerts you

If your need is a simple short periodic task (< 60s, stateless), Hypervibe redirects you to `/add-cron`. If it is an **AI agent that is part of your product**, it switches you to `/add-agent`.

## How it works

1. **Discovery (1 open question)**: Hypervibe asks you to describe your need in a few sentences: what this automation will do, how often it should run, and anything else that seems important to you.

2. **First inference: who is it for?** Before any technical choice, Hypervibe determines who benefits from the result:
  - **Your app or its users** (cleaning the database, emailing customers, syncing data the app displays) → the job goes on the **app's infrastructure**, so it keeps running no matter what happens to your personal tools.
  - **You** (a brief, an analysis, a watch, a report for your own eyes) → if the work needs AI (reading, judging, writing), it becomes a **Claude routine**: a recurring mission that your own Claude runs for you. Zero infrastructure, zero code in the project.
   
   Hypervibe infers this from your phrasing and only asks when genuinely ambiguous (*"a weekly report"*, for whom?).

3. **Targeted clarifications** (max 3 questions, only if needed): Hypervibe analyzes your answer against these dimensions:
  - **Pattern**: event-driven, scheduled, or continuous?
  - **Load**: light or heavy (CPU, RAM, large files, generative AI)?
  - **Frequency** (if scheduled): daily, hourly, sub-minute, irregular?
  - **Persistent state**: stateless or stateful?
   
   If everything is clear after your first description, Hypervibe asks no question and goes straight to the recommendation.

4. **Automatic decision**:
  - **Personal recurring AI mission** → **Claude routine** (your own Claude runs it on schedule; no infrastructure at all)
  - **Simple periodic task for the app** → delegates to `/add-cron` (which registers it on your shared clock by default)
  - **Light worker / event-driven / sub-minute precision** → **Cloudflare Worker** (fast to deploy, auto-scaling, free up to 100k requests/day)
  - **Heavy process / continuous 24/7 / persistent state** → **Render Background Worker** (can run indefinitely, real server resources, ~7$/month on the starter plan)
  - **AI serving your app's end users** → hands off to `/add-agent` (a production agent with budget caps and full traceability)

5. **Conversion to a monorepo if needed** (workers only): to host the worker alongside your Next.js, Hypervibe converts your project to Turborepo (idempotent, no risk if already a monorepo). Your Next.js code ends up in `apps/web/`, the worker in `apps/worker/`.

6. **Setting it up**: depending on the choice, Hypervibe:
  - **Claude routine**: drafts the mission with you (goal, steps, deliverable), you validate it, and the routine is created on your Claude account. Depending on your setup it runs in the cloud (works even with your computer off) or on this computer while the Claude app is open.
  - **Cloudflare Worker**: creates `apps/worker/` with wrangler.toml, auto-deploys via wrangler
  - **Render Worker**: creates `apps/worker/` with a long-running TypeScript template, generates the `render.yaml` at the root, commits and pushes. You then validate on the Render dashboard (Blueprint creation, 1 step).

7. **Business logic** (workers only): the shell is in place. Hypervibe then offers to write the business logic in the worker based on your description. (A routine has no shell: the mission you validated IS the logic.)

## What it creates for you

- **If routine**: a recurring mission on your own Claude account, plus a note in `CLAUDE.md`. No code, no infrastructure, no monorepo.
- If a conversion was needed: your project has become a **Turborepo monorepo** (with `apps/web/` for Next.js, `apps/worker/` for the worker)
- A **scaffolded worker** ready to receive your business logic
- Depending on the case: deployed automatically (Cloudflare) or ready to be added manually to Render (1 last step on the dashboard)
- An update to `CLAUDE.md` with the description of what was set up

## Prerequisites

- The project must be in Next.js (typically initialized by `/bootstrap`)
- For a Cloudflare Worker: Cloudflare connected (`/start` takes care of it)
- For a Render Worker: a Render account (free to start with, but the starter plan for a worker = ~7$/month)
- For a Claude routine: nothing but your Claude subscription (the routine runs on your own account)

## Tips

{{callout:info|Your app or you? The one split that matters}}
A job that serves **your app** goes on the app's infrastructure: it must keep running even if you change tools or cancel subscriptions. A job that serves **you** can become a **routine**: your own Claude runs it, with zero infrastructure. Two honest things about routines: each run consumes a bit of your Claude subscription, and if your subscription stops, the routine stops with it. That is exactly why anything your app depends on NEVER goes on a routine. Also good to know: minimum cadence 1 hour; cloud routines run even with your computer off, local ones run while the Claude app is open.
{{/callout}}

{{callout:info|4 paths, 1 command}}
`/add-automation` is an **orchestrator**: depending on your need, it redirects you to the right specialized command (`/add-cron`, `/add-agent`), scaffolds a worker (Cloudflare or Render), or sets up a Claude routine. You don't have to choose yourself: you describe, Hypervibe decides and explains why.
{{/callout}}

{{callout:warning|Render = paid for the worker}}
Render offers a free plan for simple web services, but for **Background Workers** (processes that run 24/7), you need the starter plan (~7$/month). If your need does not really require 24/7, Hypervibe will prefer a Cloudflare Worker (free), `/add-cron` (free too), or a routine (no infrastructure at all).
{{/callout}}

{{callout:tip|AI for your product = dedicated command}}
If the AI serves **your app's end users** (classify THEIR tickets, personalize THEIR emails, process THEIR documents), Hypervibe switches you to `/add-agent`, which is built for this: Claude model, memory between runs, budget cap (by default 5 USD/day, 50 USD/month), persistence of each decision for audit. If the AI works **for you** (brief, watch, analysis), a routine does the job without any of that machinery. Same entry point either way: `/add-automation` routes automatically.
{{/callout}}
