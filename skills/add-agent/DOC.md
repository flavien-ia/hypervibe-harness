# /add-agent

Creates an autonomous AI agent that runs in your project and decides on its own which actions to take. Ideal for reading emails, summarizing articles, watching a feed, or any workflow that calls for understanding rather than predefined steps.

## When to use it

- You want an assistant that reads your support emails and proposes replies as drafts
- You want an agent that aggregates the news from several RSS feeds every morning and emails you a brief
- You want to watch a queue of events (orders, alerts, signals) and trigger smart actions
- You want to automate a workflow that requires **understanding**: read a text, summarize it, classify it, write a personalized reply

**Not suitable for**: a real-time chatbot on your site (user-facing conversational UI), a simple cron without AI, a non-AI process. Hypervibe automatically redirects you to the right command if it detects a mismatch.

## How it works

1. **Checks**: Hypervibe verifies that you have a database (to store the agent's history) and email sending configured (for notifications). Otherwise, it offers to run `/add-db` and/or `/add-email` first.

2. **Discovery (5 questions max, in plain language)**:
  - **Q1**: What is the agent's goal? (in one sentence, with concrete examples)
  - **Q2**: When should the agent run? (at a fixed time / continuously / on demand). If at a fixed time, the cadence is specified.
  - **Q3**: Should it **remember** between its runs? (simple key-value memory, or semantic memory via vectorization, or no memory)
  - **Q4**: Which Claude model? (Sonnet by default, a good price/quality tradeoff; Opus for complex tasks; Haiku for very repetitive ones)
  - **Q5**: What cost cap? (default: 5 USD/day, 50 USD/month, the agent pauses if it exceeds it and warns you by email)

3. **Anthropic key check**: Hypervibe looks at whether you have a valid `ANTHROPIC_API_KEY`. If not, it guides you through generating it on console.anthropic.com.

4. **Monorepo conversion if needed**: to host the agent alongside your Next.js, Hypervibe converts your project into a Turborepo (idempotent).

5. **Scaffolding**:
  - The agent lives in its own folder under `apps/` (named after your agent), deployable on a **Render** Background Worker
  - A clean agentic loop (Anthropic SDK with `cache_control` on the system prompt and the tools)
  - Default tools: `http-fetch` (read URLs), `send-email` (write to you), `db-query` (read the DB, SELECT only)
  - Plus other tools depending on the goal: `analyze-rss`, `summarize-thread`, etc.
  - If memory is enabled: tables `agent_memory_kv` (key-value) or `agent_memory_vector` (semantic search via Cloudflare Workers AI)
  - Automatic **circuit breaker**: tracks cost in real time, pauses the agent if the cap is exceeded, warns you by email
  - **Full persistence**: each run + each decision turn is saved in Postgres tables for audit

6. **Deployment on Render**: Hypervibe generates `render.yaml`, commits, pushes. You confirm on the Render dashboard side (Blueprint creation, 1 step that can't be automated).

7. **Optional dashboard**: Hypervibe then offers to add `/admin/agents`, a dashboard to monitor your agents (`/add-agent-dashboard`).

## What it creates for you

- A Turborepo project if not already one (with `apps/web/` + your agent's own folder under `apps/`)
- A complete AI agent: agentic loop, tools, optional memory, circuit breaker, persistence
- Postgres tables: `agent_invocations`, `agent_turns`, `agent_memory_kv`, `agent_trigger_queue` (+ `agent_memory_vector` if semantic memory)
- Environment variables: `ANTHROPIC_API_KEY`, and depending on the case `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` for the embeddings
- `render.yaml` for deployment
- The **stack diagram** updated in `CLAUDE.md`

## Prerequisites

- The project must be in Next.js (typically initialized by `/bootstrap`)
- Database configured (`/add-db`)
- Email sending configured (`/add-email`), otherwise the agent can't alert you when it breaks
- An Anthropic account (free to create, paid for usage)
- A Render account (starter plan ~7 USD/month for the worker)

## Tips

{{callout:warning|The circuit breaker is your best friend}}
By default, the agent stops automatically if it exceeds **5 USD/day or 50 USD/month**. This is crucial: an agent that loops can consume quickly. You receive an alert email, and you can decide to raise the cap or dig into the bug. **Never disable the circuit breaker.**
{{/callout}}

{{callout:tip|Memory = optional but powerful}}
- **KV (key-value)**: for simple data (user preferences, last processed ID, counters). Fast, direct lookup.
- **Semantic (vector)**: for free-text knowledge that the agent can search by meaning (notes, articles, conversations). More costly but much more powerful. Uses Cloudflare Workers AI for the embeddings (1024 dimensions, free up to 10k req/day).
- **No memory**: the agent starts from scratch on each run. Enough for many cases (daily digests, etc.).
{{/callout}}

{{callout:info|Full audit by default}}
Each run of the agent is traced in the database: initial prompt, each reasoning turn (generated text, tools used, results), cost in USD, duration. You can replay / review everything from the `/admin/agents` dashboard (skill `/add-agent-dashboard`). Essential for understanding what your agent does and debugging it.
{{/callout}}
