---
name: add-agent
description: "Scaffold an autonomous AI agent into the user's project. The agent runs on Render Background Worker, uses Anthropic Claude (Sonnet 4.6 by default) with prompt caching, has tools (http-fetch, send-email, db-query by default; more added based on the agent's job), optional Postgres KV memory, a daily/monthly cost circuit breaker (default 5 USD/day, 50 USD/month - kills runs over budget and emails the admin), and persists every invocation + every loop turn to Postgres for full traceability. Use this when the user wants an LLM-driven process that is part of the PRODUCT (serves the app or its end users), decides actions, uses tools, and optionally has memory - distinct from /add-automation which handles non-AI background processing. When the mission is actually a personal recurring task for the OPERATOR (a brief, a watch, a weekly analysis for themselves) at a cadence of 1 hour or more, the discovery short-circuits to the much lighter _create-routine (a Claude routine on the user's own account, zero infrastructure). Discovery phase asks ~5 questions about the agent's job (goal, trigger, memory needs, model, budget) then runs setup-agent.mjs to scaffold and deploy. NOT for chatbots (real-time per-user UI agents) - those need a dedicated /add-chatbot skill (not yet built). Suitable for: continuous background agents (email surveillance, monitoring), cron-driven product agents, and on-demand agents (triggered manually from a dashboard)."
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---


## ⚠️ Before any call to the script (to do BEFORE any other command in this skill)

```bash
# Detect the project's root organization
node "${CLAUDE_SKILL_DIR}/../../scripts/wrangler-env-init.mjs" 2>/dev/null
```

(Not strictly required for add-agent, but handy if you hit a case where Wrangler is needed - typically not.)


# Add Agent - Scaffold an autonomous AI agent

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You help the user set up an AI agent in their project. You ask few questions (max 5 needed), and you do the scaffolding + deployment work for them.

The deterministic code (scaffold templates, install deps, push schema, etc.) lives in `scripts/setup-agent.mjs`. This SKILL:
1. Asks the discovery questions (and short-circuits to `_create-routine` when the mission is operator-side and low-frequency - see Q1.bis)
2. Self-heals the Anthropic key if missing
3. Delegates to `_convert-to-turborepo` if the project is not a monorepo
4. Runs `setup-agent.mjs` with the right args
5. Communicates the result + the remaining manual actions (Render Blueprint setup)

---

## Preflight - vault unlocked

This skill reads the Anthropic key (and often Render/Cloudflare) from the vault → first, make sure it is unlocked (follow **`_ensure-vault`**): `node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" status` → if `locked`/`expired`, run `launch.mjs unlock`; if the vault does not exist, delegate to `_add-keyring`.

---

## Step 0 - Quick detection

Check up front that the ground is OK before asking questions.

### 0.a - Detect the Next.js project

Invoke `_detect-project-root` to get `PROJECT_NAME`, `WEB_DIR`, `IS_NEXTJS`, `IS_MONOREPO`. If `IS_NEXTJS=no` → explain to the user that a Next.js project is required (run `/bootstrap` first).

### 0.b - Detect whether email is configured

The agent sends emails (failures, daily digests, etc.) - email MUST be configured, otherwise error notifications won't go out.

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/check-deps.mjs" email
```

If `email_ok = false` → stop and tell the user:

> For an agent to be able to send you emails (error alerts, budget cap exceeded, its own emails if it sends any) - I need you to have email sending configured on your project. Run `/add-email` first, then come back here. It takes ~3 min.

### 0.c - Detect a Neon DB

The agent persists its invocations + turns + memory to the DB.

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/check-deps.mjs" db
```

If `db_ok = false` → ask the user:

> An agent stores its execution history and its memory in a database. You don't have a database configured yet. Do you want me to run `/add-db` now to set one up before continuing? *(takes 1 min)*

If yes → invoke `/add-db`, wait, come back here. If no → explain that we can't continue without a DB and stop.

---

## Step 1 - Discovery (5 questions max, in plain language)

You ask the questions one by one, in simple language. The answers fill the args for `setup-agent.mjs`.

If the user already gave a description as a command argument (`/add-agent <description>`), skip Q1 and infer the goal from their description.

### Q1 - What is the agent's goal?

> Describe in one sentence what you want your agent to do. A few examples to inspire you:
>
> - *"Every morning at 7am, read my RSS feeds and email me a brief of the important articles"*
> - *"Watch my support emails, and for each email with a simple question, propose a reply as a draft"*
> - *"Once a week, aggregate Stripe + Vercel + Brevo stats and send me a dashboard"*
>
> What's yours?

→ Capture as `<USER_DESCRIPTION>`. Used for Q2 (inferring the trigger), for the system prompt, and for the additional tools.

### Q1.bis - The routine shortcut (check BEFORE going further)

Look at WHO the mission serves and HOW OFTEN it runs:

- **Operator-side + scheduled (cadence >= 1 hour)** - the output is for the user themselves (a brief, a digest, an analysis, a watch report) and it runs at fixed moments (daily, weekly...). Two of the three Q1 examples are in this case (the morning RSS brief, the weekly stats digest). → This does NOT need the full agent machinery (Render worker, database tables, dashboard, budget caps). Offer the light path:

> Good news: for this kind of personal recurring mission, you don't need any infrastructure at all. I can set it up as a **routine**: your own Claude runs the mission on schedule (it consumes a bit of your Claude subscription, and it serves you personally - not your app). Zero code, zero hosting, ready in 2 minutes.
>
> The full agent (with its own server, database traces and dashboard) stays the right choice if you want this to run for your app's users, or if you want detailed execution logs you can audit. Which do you prefer, the **routine** (recommended here) or the **full agent**?

If the user picks the routine → invoke **`_create-routine`** with the goal + cadence, and STOP here (no Step 2-7; `_create-routine` handles everything including the final summary).
If the user picks the full agent (or the mission is genuinely product-side / continuous / on-demand for a team) → continue with Q2.

- **Product-side, continuous, or on-demand dashboard** - the agent serves the app's end users, must watch something 24/7 (routines cannot: 1 hour minimum between runs), or must be triggered from an admin dashboard with full traceability. → Continue with Q2, this skill is the right tool.

### Q2 - When should the agent run? (trigger)

Infer a default from the description, but ask for confirmation:

> Based on what you describe, your agent would be triggered: **[INFER: "at a fixed time (cron)" / "continuously (watches all the time)" / "on demand (you click to launch it)"]**.
>
> 1. ⏰ **At a fixed time** - a cron (every morning 7am, every Monday…)
> 2. 🔄 **Continuously** - the agent runs 24/7 and reacts to events (incoming emails, webhooks)
> 3. 👤 **On demand** - you click a "Run" button from the dashboard to trigger it
>
> Which one? *(the scaffold will differ slightly: for cron I'll ask you the schedule, for continuous you need an event source, for manual you'll just get the dashboard button.)*

→ Capture `--trigger`: `cron` | `continuous` | `manual`.

If `cron` → ask a Q2.bis:

> At what cadence? *(in plain words, I'll translate it into a cron expression)*
>
> 1. Every day at a fixed time (e.g. 7am)
> 2. Every Monday morning
> 3. Every X hours
> 4. Other - specify

→ Capture `AGENT_CRON_SCHEDULE` (e.g. `0 7 * * *` for 7am every day).
→ Also capture `AGENT_CRON_PROMPT`: a default prompt sent to the agent on each tick (e.g. `"Read the RSS feeds and send today's brief."`). Infer it from the description.

### Q3 - Memory between runs?

> Should your agent **remember** things between its runs?
>
> 1. **No, stateless agent** - it does its job, forgets everything, starts from scratch each time *(the simplest, for cases like "summarize my RSS every morning")*
> 2. **Yes, structured memory** - it retains specific things identified by a key: *"who I've already replied to", "the last article I summarized", counters…* *(a simple table in the database, free)*
> 3. **Yes, semantic memory** *(advanced)* - it can recall memories **by meaning**, not by key: *"find the memories related to a theme", "search my knowledge base", RAG.* Uses Cloudflare Workers AI to compute the embeddings - **no new key to create**, we reuse your existing Cloudflare token.

→ Capture `--memory`: `none` | `kv` | `pgvector`.

**Recommendation**: `kv` covers 80% of cases. `pgvector` is useful if the agent needs to do semantic search over hundreds/thousands of memories. If the user hesitates, suggest `kv` - they can always add vector memory later via a second `/add-agent` command on the same name.

### Q3.bis - If pgvector: check the Workers AI scope on the Cloudflare token

(This sub-question only comes up if the user chose `pgvector` at Q3.)

The Cloudflare token created by `/start` today includes the `Workers AI:Read` scope (checked in the `/start` checklist). BUT for older users who created their token before this addition, the scope is missing.

The `setup-agent.mjs` script runs an automatic **smoke test** at the start of the `patchMemory` step: a POST call to the embedding endpoint to verify the scope. If it fails, the script fails with a clear message:

> Cloudflare Workers AI smoke test failed. Your token probably lacks the 'Workers AI:Read' scope. Regenerate at https://dash.cloudflare.com/profile/api-tokens and ADD that scope.

If you (Claude) get this error from the script, tell the user:

> Your current Cloudflare token doesn't allow using Workers AI (which is needed for semantic memory). No problem, it takes 30 seconds to update it:
>
> 1. Go to **https://dash.cloudflare.com/profile/api-tokens**
> 2. Find your "Claude Code" token (created by `/start`) → click **"Edit"**
> 3. In **Permissions**, click **"+ Add more"** and add: **Account · Workers AI · Read**
> 4. Click **"Continue to summary"** → **"Save Token"**
> 5. Come back here and tell me "done" - I'll re-run the scaffold

No need to regenerate the entire token (so no re-paste to do). Cloudflare lets you edit an existing token to add a scope.

### Q4 - Claude model

Sonnet 4.6 by default. Ask only if the user has a use case that justifies another:

> I use Claude Sonnet 4.6 by default (optimal cost/quality balance). Do you want to switch to:
>
> - **Opus 4.7** - max quality, 5x more expensive (justified for complex analysis tasks)
> - **Haiku 4.5** - 3x faster and 3x cheaper (for simple agents that call few tools)
> - **Keep Sonnet 4.6** *(default, recommended)*

→ Capture `--model`. Map:
- "Sonnet 4.6" → `claude-sonnet-4-6`
- "Opus 4.7" → `claude-opus-4-7`
- "Haiku 4.5" → `claude-haiku-4-5-20251001`

### Q5 - Budget cap

Clear display:

> ⚠️ **Budget guardrail**
>
> To avoid an agent that loops costing you 200 EUR overnight, there's an automatic cap: if consumption exceeds the cap, the agent auto-pauses and you receive an email.
>
> Default caps:
> - **5 USD / day**
> - **50 USD / month**
>
> Do you want to adjust them?
>
> 1. **Keep the defaults** *(recommended to start)*
> 2. Customize

→ Capture `AGENT_DAILY_BUDGET_USD` and `AGENT_MONTHLY_BUDGET_USD` (defaults `5` and `50`).

### Inferring the agent name

No question - infer a kebab-case slug from the description. E.g.:
- *"Summarize my RSS every morning"* → `rss-digest`
- *"Watch my support emails"* → `support-email-watcher`
- *"Weekly Stripe + Vercel stats"* → `weekly-stats-report`

Check that no `apps/<slug>/` already exists - if it does, suffix it (`-2`, `-3`).

### Inferring the system prompt

Generate a clear system prompt from the description. Format:

```
You are <NAME>, an autonomous agent. Your goal: <GOAL>.
Triggers: <HOW_TRIGGERED>.
Tools at your disposal:
- <list>
Memory: <stateless|kv table>.
When done with a task, respond with a brief summary of what you did. If you can't accomplish the task, explain why in plain text.
```

---

## Step 2 - Self-heal Anthropic key

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/_read-user-env.mjs" ANTHROPIC_API_KEY
```

If the command returns a value that starts with `sk-ant-`, OK, move to Step 3.

Otherwise, ask the user:

> To run the agent I need an **Anthropic API key**. It's free up to a certain volume, paid beyond that (but the budget guardrail prevents surprises).
>
> 1. Go to **https://console.anthropic.com/settings/keys**
> 2. Click **"Create Key"**, give it a name (e.g. `Hypervibe`)
> 3. Copy the key that appears (starts with `sk-ant-...`)
> 4. Paste it to me here (I store it locally, never in the repo)

When the user pastes the key:
- Check the format: `^sk-ant-` + 50+ chars
- Persist it at the User scope:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/_write-user-env.mjs" ANTHROPIC_API_KEY "<the_pasted_key>"
```

→ The key is now available for this session AND future ones.

---

## Step 3 - Check the monorepo (and convert if needed)

The agent lives in `apps/<slug>/` - so the project must be a Turborepo monorepo.

If `IS_MONOREPO=no` (Step 0.a), invoke `_convert-to-turborepo`:

> To have your agent live alongside your Next.js site, I need to turn your project into a **monorepo** (just a new `apps/web/` folder that contains your site, and you'll be able to have other apps next to it). It's safe and we can roll it back if needed.

Invoke skill: `_convert-to-turborepo` then re-check `IS_MONOREPO=yes` before continuing.

---

## Step 4 - Make sure the Render key is in the vault

Render is driven via its **REST API** (`api.render.com/v1`), no CLI to install. Invoke `_setup-render` (checks/adds the `RENDER.api_key` key in the vault, idempotent).

---

## Step 5 - Run the setup-agent script

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/setup-agent.mjs" \
  --name "<SLUG>" \
  --description "<USER_DESCRIPTION>" \
  --web-dir "<WEB_DIR>" \
  --trigger "<TRIGGER>" \
  --memory "<MEMORY_MODE>" \
  --model "<MODEL_ID>" \
  --system-prompt "<GENERATED_SYSTEM_PROMPT>"
```

The script chains 12 sub-steps (preflight, anthropicKey, ensureMonorepo, scaffoldAgent, patchSystemPrompt, patchAgentName, patchTools, patchMemory, mergeSchema, installDeps, drizzlePush, handoff). Show progress to the user via `↳ <action>` then `✅`.

### On success → JSON on stdout:

```json
{
  "success": true,
  "agentName": "<slug>",
  "agentDir": "apps/<slug>",
  "trigger": "cron",
  "memory": "kv",
  "model": "claude-sonnet-4-6",
  "schemaPatched": true,
  "warnings": [],
  "nextSteps": { ... }
}
```

Capture this JSON, use it for the final summary (Step 7).

### On failure:

Read the error just above the handoff banner. Diagnose by step:
- `preflight` → bad args (invalid slug, folder already existing) - fix then re-run
- `anthropicKey` → the key was not persisted correctly, back to Step 2
- `ensureMonorepo` → `_convert-to-turborepo` did not run, back to Step 3
- `scaffoldAgent` / `patchXxx` → rare (filesystem issue), inspect
- `mergeSchema` → conflict in `src/server/db/schema.ts` (resolve manually at the end)
- `installDeps` → pnpm/network error (retry)
- `drizzlePush` → invalid schema or DB issue (often recoverable)

---

## Step 6 - Offer the dashboard

> ## 🎛️ Do you want the dashboard to monitor your agent?
>
> Without a dashboard, your agent runs in the background and you see its logs on Render - functional but blind. **With a dashboard**, you get in your admin area (`/admin/agents`):
>
> - A list of each run with date, duration, cost
> - Turn-by-turn detail (each decision, each tool called) - useful for debugging
> - Aggregated cost stats (per day, over 30 days)
> - A **"Run now"** button with a custom prompt - handy for testing
>
> ⚠️ Prerequisite: your site must have admin authentication configured (`/add-auth` in admin mode). Without that, I can't install the dashboard because the pages would be public.
>
> Do you want me to add it? *(I'll invoke `/add-agent-dashboard` which handles everything)*

If the user says yes:

1. Check that `/add-auth` admin is in place (look at `apps/web/src/server/auth.ts` for `isAdmin` or `adminProcedure`).
2. If missing → ask the user to run `/add-auth` (admin mode) first.
3. If present → invoke `/add-agent-dashboard`. This skill is idempotent: if already installed, it no-ops.

If the user says no:

> OK, your agent runs without a dashboard. You can follow the logs on https://dashboard.render.com → your service → Logs. If you change your mind later, run `/add-agent-dashboard` to add it - it works with all your existing agents.

---

## RGPD - Privacy policy

Add Anthropic and Render to the project's RGPD subprocessor registry:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/update-privacy-policy.mjs" --add anthropic --add render
```

Anthropic receives the prompts sent by the agent (potentially user data - varies by agent). Render hosts the background worker. The helper is idempotent.

If the `politique-de-confidentialite/page.tsx` page exists (created by `/bootstrap`), it updates automatically. Otherwise, only the registry is created - `/rgpd-audit` can generate the page later.

---

## Step 7 - Final summary + manual Render actions

From the JSON captured in Step 5, display exactly:

> ## ✅ Your agent **<NAME>** is scaffolded
>
> 📁 Code: `apps/<NAME>/` *(15+ files: loop, tools, memory, render config, …)*
> 🗃️ DB tables created in Neon: `agent_invocations`, `agent_turns`, `agent_memory_kv`, `agent_trigger_queue`
> 🤖 Model: <MODEL_ID>
> ⏰ Trigger: <TRIGGER> *(+ cron expression if applicable)*
> 🧠 Memory: <kv | stateless>
> 💰 Caps: <DAILY> USD/day, <MONTHLY> USD/month
>
> ### To put it live
>
> 1. **Commit + push** what I just scaffolded:
>    ```
>    git add . && git commit -m "feat(agent): scaffold <NAME> agent" && git push
>    ```
>
> 2. **Create the Render service** *(manual action, ~2 min)*:
>    - Go to **https://dashboard.render.com/blueprints**
>    - Click **"New Blueprint Instance"**
>    - Select your GitHub repo
>    - Render automatically detects `apps/<NAME>/render.yaml`
>    - Fill in the **environment variables** (list below)
>    - Click **"Apply"**
>
> 3. **Environment variables to fill in on Render**:
>    - `ANTHROPIC_API_KEY` - the one we configured earlier
>    - `DATABASE_URL` - copy from your web project's `.env`
>    - `BREVO_API_KEY` + `BREVO_SENDER_EMAIL` + `BREVO_SENDER_NAME` *(or Resend equivalents)*
>    - `ADMIN_EMAIL` - where the agent's error emails arrive
>    - `AGENT_DAILY_BUDGET_USD=5` *(or what you chose)*
>    - `AGENT_MONTHLY_BUDGET_USD=50`
>    - {{IF cron}}`AGENT_CRON_SCHEDULE` - *(e.g. `0 7 * * *`)*
>    - {{IF cron}}`AGENT_CRON_PROMPT` - the prompt sent to the agent on each run
>
> ### Once live
>
> - The agent's logs appear in the Render dashboard → "Logs"
> - You receive an automatic email on error or when a cap is reached
> - To trigger manually (without a custom dashboard): insert a row into the `agent_trigger_queue` table with your prompt → the agent reads it within 5 s
>
> When you have a larger project, tell me *"add my agent's dashboard"* (or run `/add-agent-dashboard`) and I'll scaffold the monitoring pages.

---

## Important conventions

- **Anthropic key at User scope**: never in the repo, never in the project's `.env`. Persisted by `_write-user-env.mjs`. Render receives it via the dashboard.
- **Render = manual for Blueprint creation**: no reliable API/CLI for it. The skill scaffolds the code and explains the 2 min of remaining clicks.
- **Shared schema**: the `agent_*` tables live in the main Neon DB, not in a separate DB. The worker has its own copy of `schema.ts` that points to the same physical tables.
- **No chatbot**: if the user describes a real-time UI thing ("a chatbot on my site that answers visitors"), explain that it's a distinct case requiring streaming + dedicated UI - not the scope of `/add-agent` v1, propose `/add-automation` or waiting for the future `/add-chatbot` skill.
- **Zero cost by default while it's not running**: Render Background Worker is on the starter plan (~7 USD/month). If the user wants to test without paying Render, the agent can run locally with `pnpm dev` in `apps/<name>/` - but they'll need to keep their terminal open.

---

## Common errors

- **"The agent doesn't trigger despite the cron"** → check `AGENT_CRON_SCHEDULE` is set on the Render dashboard (not in the yaml - sync:false). Also check the cron format (5 fields: `m h dom mon dow`).
- **"The error email doesn't arrive"** → check `ADMIN_EMAIL` is set on Render + email provider (BREVO/RESEND) operational. Test with an invocation that fails on purpose.
- **"The worker crashes at boot with ANTHROPIC_API_KEY missing"** → the var isn't surfaced to Render. Re-check in the Render dashboard → service → Environment.
- **"db:push fails with a schema error"** → conflict with the existing schema (table `agent_invocations` already present with other columns?). Inspect the diff.
