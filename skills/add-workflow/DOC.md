# /add-workflow

Add an intelligent workflow to your app: when an event occurs, it runs several steps in a row, some of them calling AI (read, classify, extract, draft), then stops. Everything runs **inside your app**: no dedicated server, no agent to deploy, no extra infrastructure.

## When to use it

- **A client uploads a document** → analyze it, extract the key facts, notify the right person
- **A form is submitted** → enrich it through two external services, draft a summary, save it
- **A payment lands** → generate the invoice, send it, update the record
- **An email comes in** → classify it, prepare a draft reply, file it

The common shape: a **finite sequence** (2 to 8 steps known in advance), triggered by an event, done within seconds. This is what many people call "an agent"... when no agent is actually needed.

## How it goes

1. **You describe the chain**: the triggering event, the steps in order, the expected result. Hypervibe spots on its own which steps need intelligence.

2. **The duration gate**: Hypervibe estimates the total time and compares it with what your hosting allows for a single run. Under a minute is always fine; a few minutes takes configuration; beyond that, it honestly offers the split version (the event records the request, a scheduled tick processes the queue) or reroutes you to `/add-automation`.

3. **Setup**: Hypervibe creates the project's workflow engine (once), your workflow with its typed steps, and the chosen trigger: an action in the app, a secured address for an external service (webhook), or a schedule via `/add-cron`.

4. **Every run is traced**: step by step, with timings and errors, in a table of your database. Ask anytime: *"show me the last workflow runs"*.

5. **The real logic, now or later**: as always, you describe and Hypervibe implements, or you keep the example skeleton and come back to it whenever you want.

## What it creates for you

- The project's **workflow engine** (`src/server/workflows/`), shared by all your future workflows
- **Your workflow**, with its steps (automatic retry on failing network calls)
- The **trigger**: in-app action, secured webhook, or scheduled task
- The **trace table** `workflow_run` in your database (every run, every step, every timing)
- The Claude key (`ANTHROPIC_API_KEY`) configured if your intelligent steps need it
- `CLAUDE.md` updated with the workflow recap

## Prerequisites

- A Next.js project deployed on Vercel (typically from `/bootstrap`)
- For intelligent steps: a Claude API key (Hypervibe guides you through creating it, a 2-minute affair; each run then costs a few cents at most, depending on content size)
- A database (`/add-db`) for tracing; without it the workflow still works, traced in the server logs

## Tips

{{callout:tip|"I want an agent"? Often, you want this}}
An agent is an AI that decides its own next actions, in a loop, with tools. Powerful, and rarely necessary. If your need reads as "when X happens, do A then B then C", it is a workflow: simpler, cheaper, infrastructure-free, and every run is traceable step by step. When in doubt, run `/add-automation`: it analyzes your need and chooses for you.
{{/callout}}

{{callout:info|Duplicates are neutralized}}
External services sometimes deliver the same event twice (that is normal on their side). Every run carries an identity key: if the same event comes back, the workflow recognizes it and does nothing again. Your clients will not receive two invoices.
{{/callout}}

{{callout:warning|Bad candidates}}
A **continuous** process (watching a mailbox 24/7), **state to keep in memory** between runs, or **minutes of heavy compute**: that is `/add-automation` territory (dedicated worker). AI **serving your users directly** in an autonomous loop: `/add-agent`. A recurring mission **for yourself**: `/add-routine`.
{{/callout}}
