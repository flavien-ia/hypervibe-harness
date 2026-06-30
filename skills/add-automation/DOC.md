# /add-automation

Adds a process that runs in the background inside your app. Scheduled task, long-running process, isolated webhook, or heavy computation: Hypervibe analyzes your need and picks the right infrastructure itself.

## When to use it

- You have a **process that must run continuously** (24/7), for example: monitoring a mailbox, reading an RSS feed, listening to a message queue
- You have a **heavy job** that takes more than 60 seconds (video transcoding, complex PDF generation, intensive computation)
- You want to **isolate a webhook** from a third-party service (e.g. Slack) from the rest of your site
- You have **persistent state** to keep between runs (internal queue, memory cache)

If your need is more of a simple short periodic task (< 60s, stateless), Hypervibe redirects you to `/add-cron`. If it is an **autonomous AI agent**, it switches you to `/add-agent`.

## How it works

1. **Discovery (1 open question)**: Hypervibe asks you to describe your need in a few sentences: what the worker will be used for, how often it should run, the nature of the work, and anything that seems important to you.

2. **Targeted clarifications** (max 3 questions, only if needed): Hypervibe analyzes your answer against 4 dimensions:
  - **Pattern**: event-driven, scheduled, or continuous?
  - **Load**: light or heavy (CPU, RAM, large files, generative AI)?
  - **Frequency** (if scheduled): daily, hourly, sub-minute, irregular?
  - **Persistent state**: stateless or stateful?
   
   If everything is clear after your first description, Hypervibe asks no question and goes straight to the infrastructure choice.

3. **AI agent detection**: if your description mentions *analyze, understand, summarize, decide, judge, write*, or explicitly *AI agent, LLM, Claude*, Hypervibe offers to switch you to `/add-agent` (which asks the right AI questions and scaffolds cleanly with a circuit breaker, cost tracking, etc.).

4. **Automatic infrastructure decision**:
  - **Simple periodic task** → delegates to `/add-cron`
  - **Light worker / scheduled / event-driven** → **Cloudflare Worker** (fast to deploy, auto-scaling, free up to 100k requests/day)
  - **Heavy process / continuous 24/7 / persistent state** → **Render Background Worker** (can run indefinitely, real server resources, ~7$/month on the starter plan)

5. **Conversion to a monorepo if needed**: to host the worker alongside your Next.js, Hypervibe converts your project to Turborepo (idempotent, no risk if already a monorepo). Your Next.js code ends up in `apps/web/`, the worker in `apps/worker/`.

6. **Worker scaffolding**: depending on the choice, Hypervibe:
  - **Cloudflare Worker**: creates `apps/worker/` with wrangler.toml, auto-deploys via wrangler
  - **Render Worker**: creates `apps/worker/` with a long-running TypeScript template, generates the `render.yaml` at the root, commits and pushes. You then validate on the Render dashboard (Blueprint creation, 1 step).

7. **Business logic**: the shell is in place. Hypervibe then offers to write the business logic in the worker based on your description.

## What it creates for you

- If a conversion was needed: your project has become a **Turborepo monorepo** (with `apps/web/` for Next.js, `apps/worker/` for the worker)
- A **scaffolded worker** ready to receive your business logic
- Depending on the case: deployed automatically (Cloudflare) or ready to be added manually to Render (1 last step on the dashboard)
- An update to `CLAUDE.md` with the worker's description

## Prerequisites

- The project must be in Next.js (typically initialized by `/bootstrap`)
- For a Cloudflare Worker: Cloudflare connected (`/start` takes care of it)
- For a Render Worker: a Render account (free to start with, but the starter plan for a worker = ~7$/month)

## Tips

{{callout:info|3 paths, 1 command}}
`/add-automation` is an **orchestrator**: depending on your need, it redirects you to the right specialized command (`/add-cron`, `/add-agent`) or directly scaffolds a worker (Cloudflare or Render). You don't have to choose yourself, you describe, Hypervibe decides.
{{/callout}}

{{callout:warning|Render = paid after the worker}}
Render offers a free plan for simple web services, but for **Background Workers** (processes that run 24/7), you need the starter plan (~7$/month). If your need does not really require 24/7, Hypervibe will prefer a Cloudflare Worker (free) or `/add-cron` (also free).
{{/callout}}

{{callout:tip|AI agent = dedicated command}}
If your worker has to "understand / decide / summarize / write" (an autonomous AI agent), Hypervibe switches you to `/add-agent`, which is built for this: Claude model, memory between runs, budget cap (by default 5 USD/day, 50 USD/month), persistence of each decision for audit. You keep exactly the same entry point (`/add-automation`), Hypervibe routes automatically.
{{/callout}}
