---
name: add-automation
description: "Add an automation - scheduled task, in-app agentic workflow, background process, long-running worker, webhook handler, heavy computation, or a personal recurring AI mission. Acts as a smart orchestrator over the four shapes: /add-cron (scheduled app task), /add-workflow (finite event-triggered pipeline running inside the app, some steps intelligent), /add-agent (autonomous product agent), /add-routine (personal recurring AI mission on the user's own Claude account) - plus dedicated workers (Cloudflare, Render) for the heavy/continuous cases. Discovery phase to understand the actual need, infers whether the job belongs to the APP or to the OPERATOR, recommends with plain-words reasoning, and delegates after validation. Optionally converts the project to Turborepo when a dedicated worker is needed."
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---


## ⚠️ Before any call to `wrangler` (to be done BEFORE any other wrangler command in this skill)

```bash
eval "$(node "${CLAUDE_SKILL_DIR}/../../scripts/wrangler-env-init.mjs")"
```

This line loads `CLOUDFLARE_API_TOKEN` from the User scope (Windows registry / shell rc on Mac/Linux) if it is not in `process.env`, and adds the pnpm bin to the PATH (for bash sessions where `pnpm setup` has not yet propagated). Without it, `wrangler` fails with "command not found" on Mac (Spotlight), or may use a different Cloudflare account than the one the user expects.


# Add Automation - Discovery & routing

You help the user add an automation: to their project, or to their own toolkit.

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

This skill is **mostly orchestration**. Your job is:
1. Understand what the user actually wants
2. Infer WHO the automation serves: the app, or the operator (see "The app/ops split")
3. Decide on the right architecture and recommend it with reasons
4. Invoke the right helper skill to do the actual work

You will rarely write code yourself in this skill - you delegate to:
- **`add-cron`** - scheduled tasks that fit in a Vercel function (< 60s, stateless). Uses the unified shared hypervibe-jobs worker by default (1 Cloudflare slot for everything).
- **`add-workflow`** - finite event-triggered pipelines running INSIDE the app (2-8 known steps, some intelligent via the Claude API, bounded duration). The most common shape behind "I want an agent".
- **`_create-routine`** - operator-side recurring AI missions (a Claude routine on the user's own account). Direct user entry: **`add-routine`** (thin front over the same engine - when routing from here, call the engine directly).
- **`add-agent`** - AI-driven processes that are part of the PRODUCT (serve the app's end users) with a true agentic loop or autonomy
- **`_setup-wrangler`** - installs Wrangler CLI if missing
- **`_setup-render`** - ensures the Render API key is in the vault (Render via REST API, no CLI)
- **`_convert-to-turborepo`** - converts the project to a monorepo (idempotent)
- **`_create-cloudflare-worker`** - scaffolds and deploys a Cloudflare Worker in `apps/worker/`
- **`_create-render-worker`** - scaffolds a Render Background Worker in `apps/worker/`

---

## The app/ops split (the FIRST inference, before any architecture choice)

Every automation belongs to one of two worlds, and mixing them up is the one unforgivable routing mistake:

**A job of the APP** - its output feeds the app or its end users: cleaning the database, sending emails to customers, syncing data the app displays, processing user uploads, webhooks. It must keep running no matter what happens to the operator's tools or subscriptions → it runs on the **app's infrastructure** (cron, Cloudflare Worker, Render).

**A job of the OPERATOR** - its output is for the user themselves (or their team): a morning brief, a weekly analysis, a watch that alerts them, a report, a triage with proposals. It is personal tooling → it runs as a **Claude routine on the user's own account** (their personal AI doing recurring work for them).

### How to infer it (do NOT ask by default)

Read the beneficiary of the output in the user's phrasing:
- "send OUR USERS their weekly digest", "clean up expired sessions", "sync the catalog" → **app**
- "send ME a brief", "alert ME when...", "analyze MY week", "watch my competitors and tell me" → **ops**

Ask ONLY when genuinely ambiguous (e.g. *"a weekly report"* - for whom?). One short question:
> This report, is it for **you** (your own tracking), or is it something **your app sends to its users**?

### The safety rule, in both directions

- An APP job must NEVER run as a routine: it would depend on the operator's personal Claude subscription (if they cancel, the app silently breaks), it costs AI usage for deterministic work, and routines have a minimum cadence of 1 hour with no strict timing guarantee.
- An OPS job should not get app infrastructure by default: a Render worker + database + dashboard to send yourself a weekly brief is heavy machinery for a personal mission your Claude can just... do.

---

## Routing rule: AI-driven processes

When the user describes a process that must **understand / interpret / decide / write** (mentions AI, Claude, GPT, agent, or uses verbs like *analyze, summarize, classify, judge, draft, reason*), combine it with the app/ops split:

- **Ops + AI** ("brief me", "analyze and propose to me", "watch and alert me") → **`_create-routine`**. This is the sweet spot of routines: no infrastructure at all, the user's own Claude runs the mission on a schedule.
- **App + AI, finite pipeline** (an event triggers a KNOWN sequence of 2-8 steps, some intelligent: "when a document lands, analyze it, extract, notify"; "on form submit, enrich, summarize, save") → **`add-workflow`**. This is the MOST COMMON case behind the words "I want an agent": no agent is needed, the app itself runs the chain within a serverless function, every run traced step by step. Check it BEFORE reaching for `/add-agent`.
- **App + AI, true agent** (the AI decides its own next actions in a loop with tools, or runs with autonomy: an open-ended assistant for THEIR tickets, a process that plans and acts) → offer to hand off to **`/add-agent`**, which scaffolds a production agent (Render worker, tools, memory, budget caps, full traceability). Sample phrasing:

> What you are describing is an **AI agent that is part of your product**. I have a dedicated command, `/add-agent`, that is built for this: it asks the right questions (Claude model, memory between runs, budget cap, tools) and scaffolds a clean agent with a circuit breaker, cost tracking, and detailed logs. Shall I hand off to `/add-agent`?

**Edge cases**: a script that calls Claude once (no tool loop) inside a simple SCHEDULED job → `/add-cron` territory. The same single call triggered by an EVENT, or chained with other steps → `/add-workflow`. The decisive criterion for `/add-agent` is: agentic loop (multi-turn tool use) or autonomy, IN THE PRODUCT - a finite chain, however smart, is a workflow.

---

## Step 0 - Preflight: shared worker + Cloudflare availability

First make sure the vault is unlocked (follow **`_ensure-vault`**): `node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" status` → if `locked`/`expired`, run `launch.mjs unlock`; if the vault does not exist, delegate to `_add-keyring`.

Then ensure the unified shared worker is provisioned (idempotent, fast when already there):

```bash
eval "$(node "${CLAUDE_SKILL_DIR}/../../scripts/wrangler-env-init.mjs")"
result=$(node "${CLAUDE_SKILL_DIR}/../../scripts/shared-worker/ensure.mjs")
```

- `ok=true` → `CF_OK=true` (+ keep `WORKER_URL`, `dir`, `jobs`). If `status=created`, one sentence to the user: *"I set up your shared clock, a single mechanism that will serve all your projects (scheduled tasks, database backups, quota watch)."*
- `ok=false` → `CF_OK=false`. Cloudflare is not usable on this machine: the cron option degrades to the GitHub clock, and the Cloudflare Worker option disappears from the recommendations. Suggest `/start` to enable Cloudflare when relevant. Do not abort - Render, GitHub and routines remain available.

**Never estimate Cloudflare state from memory. If you need per-worker details (rare), run `count-cf-cron-slots.mjs`.**

---

## Step 1 - Discovery (one open question)

Tell the user:
> Before configuring anything, I need to understand what you want to do.
>
> **Describe your need in a few sentences**: what this automation will do, how often it should run, and anything else that seems important to you.

Wait for the user's response. Read it carefully. Apply the app/ops inference and the AI routing rule from the sections above BEFORE anything else: if it is clearly an ops mission or a product AI agent, short-circuit to the corresponding branch of Step 3.

## Step 2 - Clarify (max 3 questions, only if needed)

Analyze the user's description against these dimensions:

| Dimension | Possible values | Why it matters |
|---|---|---|
| **Beneficiary** | the app / its users, or the operator | The FIRST split: infrastructure vs routine |
| **Execution pattern** | event-driven (webhook, API), scheduled (cron), continuous (24/7 polling/streaming) | Determines cron vs worker |
| **Load** | light (< 60s, < 100MB RAM), heavy (CPU/RAM intensive, large files, generative AI, transcoding) | Determines whether a Vercel function is enough or a dedicated worker is needed |
| **Frequency** (if scheduled) | Daily, hourly, sub-minute, irregular | Determines the required precision |
| **Persistent state** | Stateless, stateful (internal queue, memory between runs, persistent websocket) | Stateful = necessarily a worker, never a cron |

If the user's description **already covers all these dimensions clearly**, skip to Step 3.

If something is ambiguous, ask **at most 3 short, targeted questions**. Examples:
- *"You told me 'send a newsletter' - roughly how many emails per send?"*
- *"You want to 'process videos' - what volume and what average length?"*
- *"When you say 'continuously', do you really mean 24/7 or just during business hours?"*
- *"This weekly summary, is it for you or for your app's users?"*

**Rule**: no more than 3 questions. If after that it is still unclear, recap what you have understood and ask the user to confirm/correct in one sentence.

## Step 3 - Decide and recommend

Based on what you've learned, choose ONE architecture using these heuristics:

### → Recommend a **Claude routine** (`_create-routine`) if:
- Beneficiary = the operator (the output is for THEM, not for the app)
- The work needs reading / analyzing / writing / judgment (an AI mission, not a fixed script)
- Frequency ≥ 1 hour (typically daily or weekly)
- **Examples**: morning market brief, weekly analysis of the project's errors with proposals, competitor watch with alerts, weekly cross-service stats digest for the founder

### → Recommend `add-cron` if:
- Beneficiary = the app; Pattern = scheduled; Load = light (< 30s per run); Frequency ≥ 1 minute; State = stateless
- **Examples**: daily newsletter to subscribers, nightly DB cleanup, hourly API sync, weekly report emailed to customers
- Note: `add-cron` registers the schedule on the unified shared hypervibe-jobs worker by default (one Cloudflare slot for all projects), with a GitHub fallback when Cloudflare is absent.

### → Recommend `add-workflow` if:
- Beneficiary = the app; Pattern = event-driven (a user action, an upload, an incoming webhook) or on-demand
- The work is a **finite chain of known steps** (2-8), possibly with intelligent steps (Claude API), each run bounded (seconds to a couple of minutes) and stateless between runs (state in the DB)
- **Examples**: analyze an uploaded document then notify, enrich a form submission through 2 APIs then summarize, generate and send an invoice on payment, classify an incoming request and draft a reply
- This is the default answer to most "I want an agent" requests, and to most webhooks: the chain lives INSIDE the app, no new infrastructure at all.

### → Recommend **Cloudflare Worker** if:
- Beneficiary = the app; Pattern = scheduled with **sub-minute precision**, or event-driven at a scale/latency the app should not absorb (very high volume, zero-cold-start requirement, edge geolocation), or needing **its own isolated Cloudflare resources** (dedicated R2/KV/D1, a secret that must not be shared)
- Load = light (< 10ms CPU per request, < 128MB RAM)
- **Examples**: sub-minute cron, very-high-volume public endpoint, edge function with geolocation
- Only when `CF_OK=true`. For an ordinary webhook (Stripe, Telegram at normal volume), prefer `add-workflow`: the app can absorb it, one less deployment.

### → Recommend **Render Background Worker** if:
- Beneficiary = the app; Pattern = continuous (24/7 polling, queue consumer, persistent websocket)
- Load = heavy (CPU/RAM intensive, exceeds Cloudflare Worker limits); Duration = long (minutes/hours); State = stateful
- **Examples**: video transcoding, massive scraping, Redis queue processor, persistent Discord bot
- ⚠️ Free tier sleeps after 15min of inactivity → not suited to a service that truly needs to be awake at all times

### Present the recommendation

Tell the user, with explicit reasoning:

> ## 📋 Recommendation: **<choice>**
>
> Given your need (<1-sentence summary>), I recommend **<a Claude routine | add-cron | an in-app workflow | Cloudflare Worker | Render Background Worker>** because:
>
> - <reason 1>
> - <reason 2>
> - <reason 3>
>
> <If relevant: why the other options do not fit here>
>
> ## ⚙️ What I am going to do concretely
>
> <if routine>
> I am going to set up a **routine**: a mission that your own Claude runs for you on a schedule. No infrastructure, no code in your project: we write the mission together, we choose the schedule, and your Claude takes care of the rest. Two honest things to know before you say yes:
> 1. It runs on **your Claude account** (it consumes a bit of your subscription usage, and stops if your subscription stops - which is fine, because this mission serves you, not your app).
> 2. Depending on your setup it runs either in the cloud (works even with your computer off) or on this computer while the Claude app is open - I will tell you which.
> </if>
>
> <if add-cron>
> I am going to run the `add-cron` skill, which will:
> 1. Create a protected `/api/cron` route in your Next.js app
> 2. Register the schedule on your shared clock (a single mechanism serving all your projects), which will call this route at the right time
> 3. You will only need to edit the route to put your business logic in it
>
> No monorepo needed. Setup in ~5 minutes.
> </if>
>
> <if workflow>
> I am going to run the `add-workflow` skill, which will set up **an intelligent chain inside your app**:
> 1. The trigger you described (<user action | secured webhook | schedule>)
> 2. The steps, executed in order, with automatic retry on network hiccups<if AI steps> - the intelligent ones call Claude with your own API key</if>
> 3. A trace of every run, step by step, in your database
>
> No new infrastructure, no deployment beyond your app itself. Setup in ~5-10 minutes.
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

If the user disagrees with the recommendation, listen to their reasoning. They may have constraints you didn't know about (cost, existing infrastructure, personal preference). Adjust the recommendation accordingly. If the user is convinced of an option that's clearly wrong for their use case, push back politely once, but ultimately respect their choice. The ONE exception where you insist harder: an app-critical job on a routine (explain that their app would silently break if their Claude subscription stopped, and that the shared clock costs them nothing anyway).

## Step 4 - Execute

### Branch A - User accepted `add-cron`

Invoke the **`add-cron`** skill. When it returns, skip to Step 5.

### Branch W - User accepted the in-app workflow

Invoke the **`add-workflow`** skill with the discovery material (trigger, steps, which steps are intelligent). It handles its own scaffolding, duration gate, CLAUDE.md section and summary - when it returns, go straight to Step 7 (skip Steps 5 and 6, already covered).

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
   > The Render free tier does not support native CRON. For scheduled runs, I am going to use your shared clock (via `add-cron`) which will call an HTTP endpoint. This endpoint lives in your Next.js app (`apps/web/src/app/api/cron/route.ts`) - it is the one that then has to trigger work in the worker, either by publishing a message to a shared queue, or by directly calling an HTTP route of the worker if it exposes one.

### Branch D - User accepted a Claude routine

Invoke **`_create-routine`** with the goal and cadence gathered during discovery. It handles: mechanism detection (cloud/local), the honest warnings, the self-contained mission prompt (validated by the user), creation and verification. When it returns, skip to Step 5 (routine variant).

## Step 5 - Update CLAUDE.md

**Branches A/B/C** - invoke `_update-claude-md` with:
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

**Branch D (routine)** - invoke `_update-claude-md` with:
- `custom`:
  - heading: `## Routines (opérateur)`
  - body:
    ```
    - **<routine-id>** - <schedule in plain words> - <1-sentence mission>. Tourne sur le compte Claude de l'opérateur (<cloud | local>), PAS sur l'infra du projet. Gestion : demander à Claude ("mets ma routine en pause", "change l'heure").
    ```

## Step 6 - Offer to implement the business logic now (branches A/B/C only)

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

(Branch D has no placeholder: the mission prompt IS the logic, and it was validated inside `_create-routine`.)

## RGPD - Privacy policy (only if Render route)

If the branch chosen in Step 4 is **Render Background Worker**, add Render to the project's RGPD subprocessor registry:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/update-privacy-policy.mjs" --add render
```

Why conditional: Cloudflare Workers and GitHub Actions do not store user data persistently (ephemeral stateless execution). Render hosts a long-running process, which in fact *can* manipulate/cache user data - declaring it as a subprocessor is more cautious. A Claude routine processes the OPERATOR's data on their own account, not the app users' data - nothing to declare either.

The helper is idempotent. If the `politique-de-confidentialite/page.tsx` page exists (created by `/bootstrap`), it updates automatically.

## Step 7 - Final summary

Tell the user a concise recap. Adapt based on the branch taken AND based on whether the logic was implemented in Step 6:

> ## ✅ <Worker in place | Routine in place>
>
> **Chosen architecture**: <choice>
> **Setup completed**: <list of main actions: monorepo created, worker deployed, routine created with next run time, etc.>

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

**If Branch D (routine)**:
> Your routine **<id>** is active: <mission in 1 sentence>, <schedule in plain words>, next run <date/time>. To manage it, just tell me: *"pause my routine"*, *"change the schedule"*, *"show me its last run"*, *"delete it"*.

> If you change your mind about the architecture later, just run `/add-automation` again.
