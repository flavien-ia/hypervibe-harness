# /add-automation

Adds an automation: a process that runs in the background for your app, or a recurring mission for yourself. Scheduled task, long-running process, isolated webhook, heavy computation, or a personal AI brief: Hypervibe analyzes your need and picks the right home for it.

## When to use it

- You have a **process that must run continuously** (24/7), for example: monitoring a mailbox, reading an RSS feed, listening to a message queue
- You have a **heavy job** that takes more than 60 seconds (video transcoding, complex PDF generation, intensive computation)
- You want to **isolate a webhook** from a third-party service (e.g. Slack) from the rest of your site
- You have **persistent state** to keep between runs (internal queue, memory cache)
- You want a **recurring mission for yourself**: a morning brief, a weekly analysis, a watch that alerts you

You never have to pick the shape: you describe, Hypervibe decides and explains why. A simple short periodic task (< 60s, stateless) goes to `/add-cron`. A **finite intelligent chain triggered by an event** ("when X happens, do A then B then C") is built inside your app: the most common case behind "I want an agent", and it needs no extra infrastructure. A **true autonomous agent** (one that picks its own next actions, in a loop, with tools) gets its own server and its own budget. And a recurring mission for yourself goes through `/add-routine`.

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
  - **Finite event-triggered chain, possibly intelligent** → **a chain inside your app** (it runs in your site, every run traced step by step; no new infrastructure)
  - **Light worker / event-driven / sub-minute precision** → **Cloudflare Worker** (fast to deploy, auto-scaling, free up to 100k requests/day)
  - **Heavy, long, or stateful processing** → **Render**, in one of two shapes depending on a single question: "can it sleep between runs?". If it can, it is a free service woken by your shared clock. If it cannot (a permanent connection, a message queue that must not drop anything), it is a real background process at around 7 USD/month: Render offers no free instance for that service type, and Hypervibe tells you before creating it, never after.
  - **Autonomous AI serving your app's end users** → **a production agent**: its own server, its own capped access key, and every decision kept for audit

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

{{callout:info|4 shapes, 1 command}}
`/add-automation` is the front door for everything your app does on its own. Behind it, four shapes: a **scheduled task**, an **intelligent chain inside the app**, an **autonomous agent** with its own server, or a **dedicated worker** for heavy processing. Two of them stay directly available when you already know what you want: `/add-cron` and `/add-routine`. The other two are chosen for you, because getting "chain" and "agent" the wrong way round is expensive: the first costs nothing to host, the second needs a server of its own.
{{/callout}}

{{callout:info|Chain or agent: the difference in one sentence}}
A **chain** follows steps you know in advance ("when a document arrives: read it, summarise it, notify the right person"). It runs inside your site, finishes in seconds, and every run is traced step by step. An **agent** picks its own actions, in a loop, with tools, and can remember between runs: it needs a server of its own (~7 USD/month), its own capped access key and a budget circuit breaker. Most people who ask for "an agent" actually want a chain, and Hypervibe says so plainly rather than selling you the heavier infrastructure.
{{/callout}}

{{callout:warning|Render = paid for the worker}}
Render offers a free plan for simple web services, but for **Background Workers** (processes that run 24/7), you need the starter plan (~7$/month). If your need does not really require 24/7, Hypervibe will prefer a Cloudflare Worker (free), `/add-cron` (free too), or a routine (no infrastructure at all).
{{/callout}}

{{callout:tip|AI for your product = dedicated command}}
Whichever shape wins, as soon as a step needs to understand, classify, extract or draft, Hypervibe installs (or reuses) **your project's AI brick**: a single file every model call goes through. Three things follow, and they are worth telling your accountant as much as your IT lead. The cost is estimated and **approved by you before the first line of code**. The access key carries a **spending cap held by the provider**: a runaway loop hits a wall, not your credit card. And every call explicitly refuses to let your data train a model. It runs through OpenRouter, so **changing model is one line to edit**, not a migration. If you would rather call OpenAI or Anthropic directly on your own account, say so: Hypervibe does it, records the choice, and stops asking.
{{/callout}}
