---
name: add-automation
description: "Add an automation to a Next.js project - scheduled task, background process, long-running worker, webhook handler isolated from the frontend, or heavy computation that exceeds Vercel function limits. Acts as a smart orchestrator: discovery phase to understand the user's actual need, then routes to the right architecture (simple cron via /add-cron, Cloudflare Worker for light/scheduled work, or Render Background Worker for heavy/24-7 processing). Optionally converts the project to Turborepo when needed."
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---


## ⚠️ Before any call to `wrangler` (to be done BEFORE any other wrangler command in this skill)

```bash
eval "$(node "${CLAUDE_SKILL_DIR}/../../scripts/wrangler-env-init.mjs")"
```

This line loads `CLOUDFLARE_API_TOKEN` from the User scope (Windows registry / shell rc on Mac/Linux) if it is not in `process.env`, and adds the pnpm bin to the PATH (for bash sessions where `pnpm setup` has not yet propagated). Without it, `wrangler` fails with "command not found" on Mac (Spotlight), or may use a different Cloudflare account than the one the user expects.


# Add Automation - Discovery & routing

You help the user add background processing capacity to their Next.js project.

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

This skill is **mostly orchestration**. Your job is:
1. Understand what the user actually wants
2. Decide on the right architecture (cron / Cloudflare Worker / Render Worker)
3. Invoke the right helper skills to do the actual work

You will rarely write code yourself in this skill - you delegate to:
- **`add-cron`** - for scheduled tasks that fit in a Vercel function (< 60s, no state, < 1×/min frequency)
- **`add-agent`** - for AI-driven processes (LLM that decides actions, uses tools, has memory). See routing rule below.
- **`_setup-wrangler`** - installs Wrangler CLI if missing
- **`_setup-render`** - ensures the Render API key is in the vault (Render via REST API, no CLI)
- **`_convert-to-turborepo`** - converts the project to a monorepo (idempotent)
- **`_create-cloudflare-worker`** - scaffolds and deploys a Cloudflare Worker in `apps/worker/`
- **`_create-render-worker`** - scaffolds a Render Background Worker in `apps/worker/`

### Routing rule: AI agents → `/add-agent`

If, during discovery, the user describes a process that:
- **Must understand / interpret / decide** something (not just run predefined code)
- Explicitly mentions **AI agent, LLM, Claude, GPT, AI, intelligent, autonomous**
- Wants to **write personalized text**, summarize content, classify emails, make decisions
- Uses verbs like: *analyze, understand, summarize, decide, judge, write, converse, reason*

→ **Stop** the `/add-automation` discovery, and explicitly offer the user to switch to `/add-agent`, which is designed for this case and asks more precise questions (Claude model, memory, budget cap, tools). Sample phrasing:

> What you are describing is an **AI agent** rather than a simple automation. I have a dedicated command, `/add-agent`, that is built for this: it asks the right questions (Claude model, memory between runs, budget cap, tools the agent needs) and scaffolds a clean agent with a circuit breaker, cost tracking, and detailed logs. Shall I hand off to `/add-agent`?

If the user says yes → invoke `/add-agent` with their description as an argument (`/add-agent "<description>"`). If the user says no → continue in `/add-automation` as a classic Worker (but this is probably a mistake on their part).

**Edge cases**: a script that calls Claude a single time (no tool use, no loop) within a simple cron - this is more like `/add-cron` or a lightweight `/add-automation`, not `/add-agent`. The decisive criterion for `/add-agent` is: **agentic loop** (multi-turn tool use) or **autonomy** (the agent decides what comes next).

---

## Step 0 - Cloudflare slot inventory (mandatory preflight)

**⚠️ NEVER INFER the state of the Cloudflare slots from memory.** The user's CF account typically hosts workers from several projects - your memory of the current project only gives you a partial view. The ONLY source of truth is the script below.

Run it BEFORE any discovery, BEFORE any recommendation, BEFORE any estimate:

```bash
eval "$(node "${CLAUDE_SKILL_DIR}/../../scripts/wrangler-env-init.mjs")"
node "${CLAUDE_SKILL_DIR}/../../scripts/count-cf-cron-slots.mjs"
```

Parse the JSON and remember it for ALL the following steps:
- `CF_USED` - number of active cron triggers on the account (sum of schedules per worker)
- `CF_FREE` - free slots in the free tier (5 − `CF_USED`)
- `PER_WORKER` - per-worker breakdown (useful if the user asks who occupies what)

**If the script returns `{"error":"..."}`** : Cloudflare is not configured on the user's machine. Do not infer - either remove Cloudflare from the options offered in Step 3 (stay on GitHub Action or Render), or suggest `/start` to configure Cloudflare and resume.

**When you present the options in Step 3, ALWAYS reference the real numbers from the script.** Examples:
- ✅ *"You currently have 4 cron triggers used out of 5 (Cloudflare free tier). You have 1 slot left."*
- 🔴 *"You have a few free slots I think"* ← FORBIDDEN.

⚠️ **Note on Email Workers**: a worker that has no cron trigger (for example an Email Worker triggered by Cloudflare Email Routing) appears in `PER_WORKER` with `schedules: 0` and consumes **NO** cron slot. This is normal. Do not count it as an occupied slot.

---

## Step 1 - Discovery (one open question)

Tell the user:
> Before configuring anything, I need to understand what you want to do.
>
> **Describe your need in a few sentences**: what this worker will be used for, how often it should run, the nature of the work to be done, and anything else that seems important to you.

Wait for the user's response. Read it carefully.

## Step 2 - Clarify (max 3 questions, only if needed)

Analyze the user's description against these dimensions:

| Dimension | Possible values | Why it matters |
|---|---|---|
| **Execution pattern** | event-driven (webhook, API), scheduled (cron), continuous (24/7 polling/streaming) | Determines cron vs worker |
| **Load** | light (< 60s, < 100MB RAM), heavy (CPU/RAM intensive, large files, generative AI, transcoding) | Determines whether a Vercel function is enough or a dedicated worker is needed |
| **Frequency** (if scheduled) | Daily, hourly, sub-minute, irregular | Determines the required precision |
| **Persistent state** | Stateless, stateful (internal queue, memory between runs, persistent websocket) | Stateful = necessarily a worker, never a cron |

If the user's description **already covers all these dimensions clearly**, skip to Step 3.

If something is ambiguous, ask **at most 3 short, targeted questions**. Examples:
- *"You told me 'send a newsletter' - roughly how many emails per send?"*
- *"You want to 'process videos' - what volume and what average length?"*
- *"When you say 'continuously', do you really mean 24/7 or just during business hours?"*
- *"Does the job need to keep state in memory between runs, or is each run completely independent?"*

**Rule**: no more than 3 questions. If after that it is still unclear, recap what you have understood and ask the user to confirm/correct in one sentence.

## Step 3 - Decide and recommend

Based on what you've learned, choose ONE architecture using these heuristics:

### → Recommend `add-cron` if:
- Pattern = scheduled
- Load = light (estimated < 30s per run, no heavy generative AI)
- Frequency ≥ 1 minute
- State = stateless
- **Examples**: daily newsletter, nightly DB cleanup, hourly API sync, weekly report generation
- Note: `add-cron` uses a Cloudflare Worker as a trigger + an `/api/cron` endpoint on Vercel. No GitHub Actions.

### → Recommend **Cloudflare Worker** if:
- Pattern = event-driven (webhook, public API) **OR** scheduled with a need for sub-minute precision
- Load = light (< 10ms CPU per request, < 128MB RAM)
- Volume = high (up to 100k free requests/day)
- Latency = critical (zero cold start)
- **Examples**: Telegram/Discord/Stripe webhook, public API, lightweight reactive AI agent, edge function with geolocation, sub-minute cron

### → Recommend **Render Background Worker** if:
- Pattern = continuous (24/7 polling, queue consumer, persistent websocket)
- Load = heavy (CPU/RAM intensive, exceeds Cloudflare Worker limits)
- Duration = long (a job may run for several minutes or hours)
- State = stateful (memory between runs, persistent DB connection)
- **Examples**: video transcoding, massive scraping, AI agent that maintains a long context, Redis queue processor, persistent Discord bot
- ⚠️ Free tier sleeps after 15min of inactivity → not suited to a service that truly needs to be awake at all times

### Present the recommendation

Tell the user, with explicit reasoning:

> ## 📋 Recommendation: **<choice>**
>
> Given your need (<1-sentence summary>), I recommend **<add-cron | Cloudflare Worker | Render Background Worker>** because:
>
> - <reason 1>
> - <reason 2>
> - <reason 3>
>
> <If relevant: why the other options do not fit here>
>
> ## ⚙️ What I am going to do concretely
>
> <if add-cron>
> I am going to run the `add-cron` skill, which will:
> 1. Create a protected `/api/cron` route in your Next.js app
> 2. Deploy a lightweight Cloudflare Worker with a cron trigger that calls this route on the defined schedule
> 3. You will only need to edit the route to put your business logic in it
>
> No monorepo needed. The Cloudflare Worker just acts as a trigger. Setup in ~5 minutes.
> </if>
>
> <if cloudflare>
> I am going to:
> 1. Install Wrangler CLI (the Cloudflare CLI) if not already done
> 2. Convert your project to a Turborepo monorepo (the worker will live in `apps/worker/`)
> 3. Create the worker with `wrangler init` and configure the base code
> <if needs cron>4. Enable the native CRON triggers in `wrangler.toml` on the `<expression>` schedule</if>
> 5. Deploy the worker
>
> Setup in ~5-10 minutes depending on the installs.
> </if>
>
> <if render>
> I am going to:
> 1. Make sure your Render API key is in the vault (to be generated on dashboard.render.com if needed) - Render is driven via its API, no CLI to install
> 2. Convert your project to a Turborepo monorepo (the worker will live in `apps/worker/`)
> 3. Create the worker code with a "long-running process" template
> 4. Generate `render.yaml` and guide you to create the service via the Render dashboard
> <if needs cron>5. Configure the scheduled runs via `add-cron` (Render free does not have native CRON)</if>
>
> Setup in ~10-15 minutes depending on the installs and the Render deployment.
> </if>
>
> Do you validate this approach? If you prefer another option, tell me which one and why.

**Wait for explicit user validation** before continuing.

If the user disagrees with the recommendation, listen to their reasoning. They may have constraints you didn't know about (cost, existing infrastructure, personal preference). Adjust the recommendation accordingly. If the user is convinced of an option that's clearly wrong for their use case, push back politely once, but ultimately respect their choice.

## Step 4 - Execute

### Branch A - User accepted `add-cron`

Invoke the **`add-cron`** skill. When it returns, skip to Step 5.

### Branch B - User accepted Cloudflare Worker

1. Invoke **`_setup-wrangler`** (idempotent - returns immediately if Wrangler is already installed and authenticated)
2. Invoke **`_convert-to-turborepo`** (idempotent - returns immediately if already a monorepo)
3. Invoke **`_create-cloudflare-worker`** with parameters:
   - `NEEDS_CRON=yes` if the user needs scheduled execution, otherwise `no`
   - `CRON_EXPRESSION=<5-field cron>` if `NEEDS_CRON=yes`
4. **No need to invoke `add-cron`** - Cloudflare handles CRON natively via `wrangler.toml` triggers, which `_create-cloudflare-worker` already configures.

### Branch C - User accepted Render Background Worker

1. Invoke **`_setup-render`** (idempotent - ensures `RENDER.api_key` is in the vault)
2. Invoke **`_convert-to-turborepo`** (idempotent)
3. Invoke **`_create-render-worker`**
4. **If the user needs scheduled execution** → invoke **`add-cron`** *after* the worker is up. Tell the user explicitly:
   > The Render free tier does not support native CRON. For scheduled runs, I am going to use a Cloudflare Worker with a cron trigger (via `add-cron`) that will call an HTTP endpoint. This endpoint lives in your Next.js app (`apps/web/src/app/api/cron/route.ts`) - it is the one that then has to trigger work in the worker, either by publishing a message to a shared queue, or by directly calling an HTTP route of the worker if it exposes one.

## Step 5 - Update CLAUDE.md

Invoke `_update-claude-md` with:
- `custom`:
  - heading: `## Worker`
  - body:
    ```
    - **Rôle métier** : <résumé en 1-2 phrases de la description fournie en Step 1>
    - **Type** : <add-cron | Cloudflare Worker | Render Background Worker>
    - **Emplacement** : <`apps/web/src/app/api/cron/route.ts` | `apps/worker/`>
    - **Schedule** : <cron expression if applicable, sinon "event-driven" ou "continuous">
    - **Logique implantée** : <oui (implantée pendant /add-automation) | non (placeholder // TODO à compléter)>
    - **Dev local** : <`pnpm dev` | `pnpm --filter=worker dev`>
    - **Logs** : <`wrangler tail` (cron) | `pnpm --filter=worker tail` | dashboard Render>
    ```

If the project was just converted to a monorepo (Branch B or C), also invoke `_update-claude-md` with:
- `conventions`:
  - `- Monorepo: import shared code from \`@<PROJECT_NAME>/db\` (ou autres packages). Jamais de chemin relatif cross-app.`
  - `- Worker dev: \`pnpm dev --filter=worker\``

## Step 6 - Offer to implement the business logic now

The worker infrastructure is in place but the code only contains an empty `// TODO`. Offer the user to implement it right away or later:

> The worker infrastructure is running ✅ with an empty placeholder (`// TODO` comment). For the business logic, two options:
>
> - **(a) You describe it to me in detail now and I implement it** (15-30 min depending on complexity). You end up with a worker that really does what you want, ready to use.
> - **(b) You replace the `// TODO` yourself as you go**. The infrastructure stays in place, you can come back to it whenever you want.

**If the user chooses (a)**:
- Reuse the Step 1 description (what they said the worker should do).
- Ask for technical details if needed: data sources, required external API keys, message/payload format, error handling, polling frequency, idempotency, etc. One question at a time if possible (avoid intimidating lists).
- Once you have enough context, **edit the worker file** (`apps/worker/src/index.ts` for CF/Render, or `apps/web/src/app/api/cron/route.ts` for cron) and replace the `// TODO` with the real logic. Include: clean error handling, informative logs, and if relevant, DB persistence (reuse `@<project>/db` if available).
- If the implementation requires additional env vars (e.g., a third-party service API key), ask the user and save them.
- Test locally (run the worker in dev, trigger the logic manually).
- If the implementation passes, update the "## Worker" section of CLAUDE.md: `Logique implantée : oui`.

**If the user chooses (b)**:
- Leave the `// TODO` as is.
- Update the "## Worker" section of CLAUDE.md: `Logique implantée : non (placeholder // TODO à compléter)`.
- Remind them in the summary that they can come back later and say *"implement the worker logic"* - Claude will read the business role in CLAUDE.md and resume the conversation.

## RGPD - Privacy policy (only if Render route)

If the branch chosen in Step 4 is **Render Background Worker**, add Render to the project's RGPD subprocessor registry:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/update-privacy-policy.mjs" --add render
```

Why conditional: Cloudflare Workers and GitHub Actions do not store user data persistently (ephemeral stateless execution). Render hosts a long-running process, which in fact *can* manipulate/cache user data - declaring it as a subprocessor is more cautious.

The helper is idempotent. If the `politique-de-confidentialite/page.tsx` page exists (created by `/bootstrap`), it updates automatically.

## Step 7 - Final summary

Tell the user a concise recap. Adapt based on the branch taken AND based on whether the logic was implemented in Step 6:

> ## ✅ Worker in place
>
> **Chosen architecture**: <choice>
> **Setup completed**: <list of main actions: monorepo created, worker deployed, etc.>

**If the logic was implemented in Step 6**:
> 🎯 **Business logic implemented** - your worker now does `<1-sentence summary>`. You can test it locally with `<dev command>` or check the logs with `<logs command>`.

**If the logic was deferred**:
> ### Next steps
>
> <if add-cron> Edit `apps/web/src/app/api/cron/route.ts` (or `src/app/api/cron/route.ts` if no monorepo) and replace the `// TODO` with your business logic. </if>
>
> <if cloudflare> Edit `apps/worker/src/index.ts` and implement your logic in the `<scheduled | fetch>` handler. Redeploy with `pnpm --filter=worker deploy`. </if>
>
> <if render> Edit `apps/worker/src/index.ts` and replace the `// TODO` loop with your real logic. On every push to `main`, Render will automatically redeploy the worker. </if>
>
> You can also ask me to implement it later - I already know the intended business role (noted in `CLAUDE.md` → "Worker").

> If you change your mind about the architecture later, just run `/add-automation` again.
