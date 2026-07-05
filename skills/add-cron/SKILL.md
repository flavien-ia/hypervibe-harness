---
name: add-cron
description: Add a scheduled task (CRON) to an existing Next.js project. Creates a protected /api/cron/<task-name> route and registers the schedule on the right clock - by default the unified shared Hypervibe worker (hypervibe-jobs, precise to the minute, zero extra Cloudflare slot), a dedicated Cloudflare Worker only when the task needs isolated resources, or a GitHub Action as the no-Cloudflare fallback. Can be called by /bootstrap, by /add-automation, or standalone.
argument-hint: "[description of what the cron should do]"
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---


## ⚠️ Before any call to `wrangler` (do this BEFORE any other wrangler command in this skill)

```bash
eval "$(node "${CLAUDE_SKILL_DIR}/../../scripts/wrangler-env-init.mjs")"
```

This line loads `CLOUDFLARE_API_TOKEN` from User scope (Windows registry / shell rc on Mac/Linux) if it is not already in `process.env`, and adds the pnpm bin to PATH (for bash sessions where `pnpm setup` has not yet propagated). Without it, `wrangler` fails with "command not found" on Mac (Spotlight), or may use a different Cloudflare account than the one the user expects.


# Add Cron - Scheduled tasks (auto-routing between 3 clocks)

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You add a scheduled task to the current Next.js project. You **decide yourself** which clock is best, based on the nature of the task. You ask the user NOTHING about this choice - you act, then you explain in 1 sentence what you did in the final summary.

## Non-tech audience: language rules

The users of this plugin may be non-technical. In EVERYTHING you show to the user:

- **Zero gratuitous jargon**. No "Worker", "Action", "workflow", "endpoint", "slot", "trigger", "cron expression", "bearer token", "repo", "yaml" without explanation. When a technical term is unavoidable, put it in parentheses or explain it in a short clause.
- **Speak in business terms, not infrastructure**. Say *"a scheduled task"* rather than *"a cron"*, *"your shared clock"* / *"a dedicated clock"* / *"the GitHub clock"* rather than *"the hypervibe-jobs worker"* / *"CF Worker"* / *"GitHub Action"*, *"your site"* rather than *"your Next.js endpoint"*, *"your keys"* rather than *"your env vars"*.
- **NEVER suggest commands to type**. The user does not open a terminal. When an action is possible (delete, test, view the logs, change the schedule), offer it in natural language - *"tell me 'delete task X' and I'll take care of it"*, *"do you want me to run it right now to test it?"*. Claude executes, the user does not type.
- **Avoid tech anglicisms** (*"skipped"*, *"overkill"*, *"fallback"*, *"deploy"*) in user-facing blocks. Internal use only.

---

## Architecture (identical for all 3 clocks)

```
Clock → fetch() → Vercel /api/cron/<task-name> (protected by CRON_SECRET)
```

The business logic always lives in Next.js (`/api/cron/<task-name>/route.ts`), protected by a `CRON_SECRET` bearer. The clock only pings the endpoint at the desired time. What changes between the options is solely **who presses the button**.

## The 3 options

### 1. Unified shared worker - the DEFAULT (precise, zero extra slot)
The account-wide `hypervibe-jobs` worker, shared across ALL the user's projects and roles (scheduled pings, database backups, quota watch). Lives in a **git-versioned local repo** (`~/.hypervibe-jobs/`), ticks every minute, and consumes ONE Cloudflare cron slot in total no matter how many tasks and projects use it. Precision: to the minute. This is where virtually every scheduled task belongs.

### 2. Dedicated Cloudflare Worker (only for isolated resources)
A Cloudflare Worker created specifically for this task. Only justified when the task itself needs an isolated Cloudflare binding (its own R2 / KV / D1 / Durable Object) or a secret that must NOT coexist with other projects' secrets. Consumes 1 of the 5 free cron slots on the account.

### 3. GitHub Action (fallback without Cloudflare)
A YAML workflow in the project's GitHub repo. Used ONLY when Cloudflare is not configured on the machine and the user does not want to configure it. Free and unlimited, but **delays of 30-60 min are possible** during peak load.

---

## Preflight - vault unlocked

This skill reads the Cloudflare token from the vault → first, make sure it is unlocked (follow **`_ensure-vault`**): `node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" status` → if `locked`/`expired`, run `launch.mjs unlock`; if the vault does not exist, delegate to `_add-keyring`. (Not needed if you already know Cloudflare is unavailable and the cron will go to a GitHub Action.)

---

## Step 0 - Preflight: the shared worker

Make sure the unified shared worker is provisioned (idempotent, fast when already there):

```bash
eval "$(node "${CLAUDE_SKILL_DIR}/../../scripts/wrangler-env-init.mjs")"
result=$(node "${CLAUDE_SKILL_DIR}/../../scripts/shared-worker/ensure.mjs")
```

Parse the JSON:
- `ok=true` → store `CF_OK=true`, plus `WORKER_DIR`, `WORKER_URL`, and the current `jobs` count. `status` is `created` (first time - one sentence to the user: *"I set up your shared clock, a single mechanism that will serve all your projects"*) or `already_present` (silent).
- `ok=false` → Cloudflare is not usable on this machine (wrangler missing, token missing/locked). Store `CF_OK=false`. Do NOT abort: the GitHub clock can still take the task (Step 4 will force it). Mention `/start` as the way to enable Cloudflare later.

### Step 0.b - Sanity check (is the need really a cron?)

Briefly verify that the user's need is really a cron:

**Good candidate:**
- Periodic tasks that run inside a Vercel function (max 60s, stateless)
- Daily, hourly, or every-N-minutes schedules
- No need for persistent in-memory state between runs

**Bad candidate (→ suggest `/add-automation` instead):**
- Long-running process (> 60s)
- Continuous listeners (WebSocket, queue consumers)
- Need for persistent in-memory state

If no red flag, continue silently.

---

## Step 1 - Get the cron description

If the user passed a description as an argument (`$ARGUMENTS` not empty), use it directly. **Do not ask.**

Otherwise, ask:

> What will this scheduled task be used for?
>
> Describe in one sentence what it should do, e.g.:
> - *"send a weekly SEO report by email"*
> - *"reset user quotas at midnight"*
> - *"sync Brevo contacts every hour"*
> - *"clean up temporary files every night"*

Capture the answer in `TASK_DESCRIPTION`.

---

## Step 2 - Project prerequisites

Invoke `_detect-project-root` to retrieve `PROJECT_NAME`, `WEB_DIR`, `IS_NEXTJS`, `IS_MONOREPO`. Abort if `IS_NEXTJS=no`.

---

## Step 3 - Ask for the schedule

> When do you want this task to run?
>
> Say it in your own words, for example: *"every day at 9am"*, *"every Monday morning"*, *"every hour"*, *"on the 1st of the month at midnight"*.

Convert it into a 5-field **UTC** cron expression (the user thinks in local time, it is up to you to convert). Store it in `CRON_EXPR` and keep the human-readable version in `CRON_HUMAN`.

```
Bash: date -u +%H
# If you need to convert a local time to UTC
```

Also ask:

> Give a short name for this task, so we can recognize it easily later. For example: `rapport-hebdo`, `sync-clients`, `nettoyage`.

Store it in `TASK_NAME` (kebab-case ASCII).

---

## Step 4 - Infer the clock (silently)

**You ask the user nothing.** The logic is now simple:

### 4.a - Detect "isolated resources"

If the description explicitly mentions a need for an isolated Cloudflare R2 / KV / D1 / Durable Object, or a secret that must NOT be shared with other projects on the same account, store `NEEDS_DEDICATED_CF=true`. Otherwise `false`. (This is rare: a plain "ping my site on a schedule" task NEVER needs this.)

### 4.b - Decision

| Case | `CF_OK` | `NEEDS_DEDICATED_CF` | → `CHOICE` |
|---|---|---|---|
| 1 | true | false | `shared` (the default for virtually everything) |
| 2 | true | true | `cf-dedicated` - but first check a free slot exists: run `node "${CLAUDE_SKILL_DIR}/../../scripts/count-cf-cron-slots.mjs"`; if `cfFree` = 0, fall back to `shared` and note in the summary that the isolated spot was not possible |
| 3 | false | * | `gh` (no Cloudflare on this machine) |

Also build `REASON` (1 non-tech sentence) for the final summary:
- `shared`: *"I put it on your shared clock: precise to the minute, it serves all your projects at zero extra cost"*
- `cf-dedicated`: *"I gave it its own dedicated clock because this task needs its own isolated storage"*
- `gh`: *"Cloudflare is not set up on this machine, so I used the GitHub clock - free and unlimited, but it can run 30-60 minutes late. If that ever matters, run /start to enable Cloudflare and tell me to move the task."*

If `CHOICE=gh` AND the task smells timing-critical (frequency > 1x/hour, "exactly at midnight", "reset", user-visible consequence when late), be honest in the final summary about the concrete impact of a possible delay.

---

## Step 5 - Generate CRON_SECRET (if absent)

Check whether `CRON_SECRET` already exists in `.env`:
```bash
grep -q "^CRON_SECRET=" .env 2>/dev/null && echo "exists" || echo "missing"
```

### If missing
Invoke `_generate-secret` with `format=hex`, `length=32`. Capture the value.

Invoke `_push-env-vars` with:
- `CRON_SECRET=<value>`

### If present
Read the value from `.env` for the following steps.

---

## Step 6 - Implement according to `CHOICE`

### If `CHOICE=shared` → unified shared worker (one command does everything)

```bash
WEB_DIR_FLAG=""
[ "$IS_MONOREPO" = "yes" ] && WEB_DIR_FLAG="--web-dir apps/web"
[ "$IS_MONOREPO" = "no" ] && WEB_DIR_FLAG="--web-dir ."

result=$(CRON_SECRET_VALUE="<CRON_SECRET>" node "${CLAUDE_SKILL_DIR}/../../scripts/shared-worker/register.mjs" \
  --kind ping \
  --task-name "<TASK_NAME>" \
  --cron "<CRON_EXPR>" \
  --app-url "<NEXT_PUBLIC_APP_URL>" \
  --project-name "<PROJECT_NAME>" \
  $WEB_DIR_FLAG \
  --put-secrets)
```

This single call: creates the protected Next.js route (if absent), registers the task in the versioned registry, commits the change, uploads the project's secret to the shared worker (first time only), and redeploys. Parse the JSON: `ok`, `action` (added/replaced), `job` (the name of the entry in the shared registry, normally `<PROJECT_NAME>-<TASK_NAME>` - store it as `JOB_NAME`, the management commands below use it), `routeCreated`, `missingSecrets` (should be empty; if not, follow its `nextSteps`).

### If `CHOICE=cf-dedicated` → dedicated Cloudflare Worker

Invoke `_setup-wrangler`. Then:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/setup-cron-worker.mjs" \
  --task-name "<TASK_NAME>" \
  --cron-expr "<CRON_EXPR>" \
  --app-url "<NEXT_PUBLIC_APP_URL>" \
  --project-name "<PROJECT_NAME>"
```

Add `--web-dir apps/web` if monorepo.

Upload the secret + deploy:
```bash
cd cron-workers/<TASK_NAME>
echo "<CRON_SECRET>" | wrangler secret put CRON_SECRET
wrangler deploy
cd ../..
```

### If `CHOICE=gh` → GitHub Action

#### 6a. Create the Next.js route
Create `<WEB_DIR>/src/app/api/cron/<TASK_NAME>/route.ts` (route protected by `CRON_SECRET`):

```ts
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // YOUR CRON LOGIC HERE - described as: <TASK_DESCRIPTION>

  return NextResponse.json({ success: true, timestamp: new Date().toISOString() });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
```

#### 6b. Check the GitHub repo
```bash
gh repo view --json nameWithOwner -q .nameWithOwner
```
If absent → abort, ask the user to push the project to GitHub first.

#### 6c. Push the GitHub secrets
```bash
gh secret set CRON_SECRET --body "<CRON_SECRET>"
gh secret set CRON_APP_URL --body "<NEXT_PUBLIC_APP_URL>"
```

#### 6d. Create the cron workflow
Write `.github/workflows/cron-<TASK_NAME>.yml`:

```yaml
name: Cron - <TASK_NAME>

on:
  schedule:
    - cron: "<CRON_EXPR>"
  workflow_dispatch:

jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - name: Ping /api/cron/<TASK_NAME>
        env:
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
          CRON_APP_URL: ${{ secrets.CRON_APP_URL }}
        run: |
          curl -fsSL -X POST \
            -H "Authorization: Bearer $CRON_SECRET" \
            "$CRON_APP_URL/api/cron/<TASK_NAME>"
```

#### 6e. Create the keepalive workflow (if absent)
Check `.github/workflows/keepalive.yml`. If it does not exist, create it:

```yaml
name: Keepalive

on:
  schedule:
    - cron: "0 8 1 * *"
  workflow_dispatch:

jobs:
  keepalive:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git commit --allow-empty -m "chore: keepalive"
          git push
```

#### 6f. Commit + push
```bash
git add .github/workflows/ <WEB_DIR>/src/app/api/cron/<TASK_NAME>/
git commit -m "feat: add scheduled task <TASK_NAME> via GitHub Action"
git push
```

---

## Step 7 - Update CLAUDE.md

Invoke `_update-claude-md` with:
- `custom` heading: `## Cron`
- Body (adapt to the type):

For a **shared worker** cron:
```
- **<TASK_NAME>** (shared hypervibe-jobs worker) - `<CRON_EXPR>` (<CRON_HUMAN>) → registered as `<JOB_NAME>` in `~/.hypervibe-jobs/jobs.js` (git-versioned) → calls `/api/cron/<TASK_NAME>`
```

For a **dedicated CF Worker** cron:
```
- **<TASK_NAME>** (dedicated Cloudflare Worker) - `<CRON_EXPR>` (<CRON_HUMAN>) → `cron-workers/<TASK_NAME>/` → calls `/api/cron/<TASK_NAME>`
```

For a **GitHub Action** cron:
```
- **<TASK_NAME>** (GitHub Action) - `<CRON_EXPR>` (<CRON_HUMAN>) → `.github/workflows/cron-<TASK_NAME>.yml` → calls `/api/cron/<TASK_NAME>`
```

Add as the section intro (created only once):
```
Scheduled tasks. A clock pings the `/api/cron/<name>` endpoint on the Next.js side, protected by `CRON_SECRET`. The business logic lives in Next.js. 3 possible clocks:
- **Shared hypervibe-jobs worker** (default): one account-wide Cloudflare worker for all projects (pings, backups, quota watch), registry git-versioned in `~/.hypervibe-jobs/`, timing to the minute, 1 CF slot total
- **Dedicated Cloudflare Worker**: only when the task needs isolated resources (own R2/KV/D1), 1 CF slot per task
- **GitHub Action**: fallback without Cloudflare, best-effort (±30-60 min), automatic monthly keepalive
```

And `env-vars`:
- `- \`CRON_SECRET\` - Bearer token used to authenticate cron clock against \`/api/cron/<name>\``

---

## Step 8 - Final summary

Choose the right block according to `CHOICE`, incorporating `REASON` in non-tech language.

### If `shared`
> ## ✅ Your task **<TASK_NAME>** is in place
>
> It will trigger **<CRON_HUMAN>**. <REASON>
>
> <If the shared clock was created on this occasion: *"I set up your shared clock for the first time: a single mechanism, versioned and kept safe on your computer, that will serve all your current and future projects at no extra cost."*>
>
> For now it does nothing concrete - I prepared the file where you will write what it should do (*<TASK_DESCRIPTION>*). Tell me what it should run and I'll code the logic for you.
>
> You can also ask me at any time:
> - *"run the task right now to test it"*
> - *"show me the latest triggers"*
> - *"change the schedule to X"*
> - *"delete this task"*

### If `cf-dedicated`
> ## ✅ Your task **<TASK_NAME>** is in place
>
> It will trigger **<CRON_HUMAN>**. <REASON>
>
> For now it does nothing concrete - I prepared the file where you will write what it should do (*<TASK_DESCRIPTION>*). Tell me what it should run and I'll code the logic for you.
>
> You can also ask me at any time: *"run the task right now to test it"*, *"show me the latest triggers"*, *"change the schedule to X"*, *"delete this task"*.

### If `gh`
> ## ✅ Your task **<TASK_NAME>** is in place
>
> It will trigger **<CRON_HUMAN>**. <REASON>
>
> A small reminder: GitHub can be 30 to 60 min late<, concrete consequence for this task if relevant>. I also added (if not already done) a tiny invisible task that runs once a month to prevent GitHub from disabling the clock if you don't touch the project for 60 days.
>
> **If the delay ever becomes a problem**, run `/start` to enable Cloudflare on this machine, then tell me *"move this task to my shared clock"* and I'll migrate it.
>
> For now it does nothing concrete - I prepared the file where you will write what it should do (*<TASK_DESCRIPTION>*). Tell me what it should run and I'll code the logic for you.

---

## Natural-language management (after setup)

On the shared clock, the registry job name is `JOB_NAME` = `<PROJECT_NAME>-<TASK_NAME>` (tasks registered by older plugin versions may be listed under `<TASK_NAME>` alone - when in doubt, `--list` shows the exact names).

- **"run the task right now"** (shared clock): trigger it manually through the worker's control endpoint:
  ```bash
  ADMIN=$(node "${CLAUDE_SKILL_DIR}/../../scripts/_read-user-env.mjs" HYPERVIBE_JOBS_ADMIN_TOKEN)
  curl -s -X POST -H "Authorization: Bearer $ADMIN" "<WORKER_URL>/trigger?name=<JOB_NAME>"
  ```
  (For a GitHub clock: `gh workflow run cron-<TASK_NAME>.yml`. For a dedicated clock: `curl` the `/api/cron/<TASK_NAME>` route directly with the project's `CRON_SECRET`.)
- **"show me my scheduled tasks"**: `node "${CLAUDE_SKILL_DIR}/../../scripts/shared-worker/register.mjs" --list` (+ `.github/workflows/cron-*.yml` + `cron-workers/*/` for the other clocks). Present them in plain language.
- **"change the schedule"** (shared): re-run the register command from Step 6 with the new `--cron` (same project + same task name = update in place).
- **"delete this task"** (shared): `node "${CLAUDE_SKILL_DIR}/../../scripts/shared-worker/register.mjs" --remove --name <JOB_NAME>`. Also offer to delete the now-unused `/api/cron/<TASK_NAME>` route.
- If **after** the final summary the user says *"no, GitHub instead"* / *"give it a dedicated clock"*, restart from Step 6 with the forced `CHOICE`. Not before - the automatic decision is the default.
