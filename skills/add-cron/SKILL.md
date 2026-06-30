---
name: add-cron
description: Add a scheduled task (CRON) to an existing Next.js project. Creates a protected /api/cron/<task-name> route and picks the right clock - Cloudflare Worker (precise timing, 5 free slots) or GitHub Action (best-effort timing, unlimited) - based on what the cron does. When CF slots are exhausted, falls back transparently to a shared Cloudflare dispatcher (one slot for unlimited tasks). Can be called by /bootstrap, by /add-automation, or standalone.
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

You add a scheduled task to the current Next.js project. You **decide yourself** which clock is best, based on the nature of the task and the available room. You ask the user NOTHING about this choice - you act, then you explain in 1 sentence what you did in the final summary.

## Non-tech audience: language rules

The users of this plugin may be non-technical. In EVERYTHING you show to the user:

- **Zero gratuitous jargon**. No "Worker", "Action", "workflow", "endpoint", "slot", "trigger", "cron expression", "bearer token", "repo", "yaml", "dispatcher" without explanation. When a technical term is unavoidable, put it in parentheses or explain it in a short clause.
- **Speak in business terms, not infrastructure**. Say *"a scheduled task"* rather than *"a cron"*, *"the Cloudflare clock"* / *"the GitHub clock"* / *"the shared clock"* rather than *"CF Worker"* / *"GitHub Action"* / *"dispatcher"*, *"your site"* rather than *"your Next.js endpoint"*, *"your keys"* rather than *"your env vars"*.
- **NEVER suggest commands to type**. The user does not open a terminal. When an action is possible (delete, test, view the logs, change the schedule), offer it in natural language - *"tell me 'delete task X' and I'll take care of it"*, *"do you want me to run it right now to test it?"*. Claude executes, the user does not type.
- **Avoid tech anglicisms** (*"skipped"*, *"overkill"*, *"fallback"*, *"deploy"*) in user-facing blocks. Internal use only.

---

## Architecture (identical for all 3 clocks)

```
Clock → fetch() → Vercel /api/cron/<task-name> (protected by CRON_SECRET)
```

The business logic always lives in Next.js (`/api/cron/<task-name>/route.ts`), protected by a `CRON_SECRET` bearer. The clock only pings the endpoint at the desired time. What changes between the options is solely **who presses the button**.

## The 3 options

### 1. Dedicated Cloudflare Worker (precise, 1 slot)
A Cloudflare Worker created specifically for this task. Precise to the second, isolated, individually observable. Consumes 1 of the 5 free slots on the Cloudflare account.

### 2. Shared Cloudflare dispatcher (precise, 0 extra slot)
A single Worker shared across all of the user's projects. Runs every minute and triggers the tasks whose schedule matches. **Lives in `~/.cron-dispatcher/`**, outside any repo. Precision: to the minute. Cost: 1 slot total for N tasks across N projects. Ideal when the 5 Cloudflare slots are already saturated.

### 3. GitHub Action (best-effort, unlimited)
A YAML workflow in the project's GitHub repo. Free and unlimited. **Delays of 30-60 min are possible** during peak load. Ideal for reports/digests/cleanups where exact timing has no impact.

---

## Preflight - vault unlocked

If this skill uses a Cloudflare Worker, it reads the Cloudflare token from the vault → first, make sure it is unlocked (follow **`_ensure-vault`**): `node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" status` → if `locked`/`expired`, run `launch.mjs unlock`; if the vault does not exist, delegate to `_add-keyring`. (Not needed if the cron goes to a GitHub Action, which does not use Cloudflare.)

---

## Step 0 - Preflight (Cloudflare inventory + sanity check)

### 0.a - Cloudflare slot inventory (mandatory)

**⚠️ NEVER INFER the state of the Cloudflare slots from memory.** The user's CF account typically hosts workers from several projects - your memory of the current project gives you only a partial view. The ONLY source of truth is the script below.

Run it right away, BEFORE any discovery, BEFORE any verbal estimate of the number of free slots:

```bash
eval "$(node "${CLAUDE_SKILL_DIR}/../../scripts/wrangler-env-init.mjs")"
node "${CLAUDE_SKILL_DIR}/../../scripts/count-cf-cron-slots.mjs"
```

Parse the JSON and remember it - these variables will be reused in Step 4 (clock inference):
- `CF_USED` - number of active cron triggers on the account (sum of schedules per worker)
- `CF_FREE` - free slots in the free tier (5 − `CF_USED`)
- `PER_WORKER` - breakdown per worker (useful if the user asks who occupies what)
- `ACCOUNT_ID` - for the following wrangler commands

**If the script returns `{"error":"..."}`**: Cloudflare is not configured. Suggest `/start` to configure Cloudflare, then abort. If the user still wants a cron without Cloudflare, the Step 4 decision will automatically force `CHOICE=gh`.

**As soon as you communicate about slots to the user (in the final summary or a warning message), ALWAYS reference the real numbers from the script.** Examples:
- ✅ *"You have 4 cron triggers used out of 5 (Cloudflare free tier). You have 1 slot left."*
- 🔴 *"You have a few free slots I think"* ← FORBIDDEN.

⚠️ **Note on Email Workers**: a worker that has no cron trigger (for example an Email Worker triggered by Cloudflare Email Routing) appears in `PER_WORKER` with `schedules: 0` and consumes **NO** cron slot. This is normal. Do not count it as an occupied slot.

### 0.b - Sanity check (is the need really a cron?)

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

## Step 4 - Infer the optimal clock (silently)

**You ask the user nothing.** You decide according to these rules:

### 4.a - Detect "special bindings"

If the description explicitly mentions a need for an isolated Cloudflare R2 / KV / D1 / Durable Object, or if the task must access a secret that must NOT be shared between projects, then it **cannot** go into the shared dispatcher. Store `NEEDS_DEDICATED_CF=true`. Otherwise `false`.

### 4.b - Infer the nature of the task

Analyze `TASK_DESCRIPTION` + `CRON_EXPR`:

**"Timing critical" signals → prefer Cloudflare**:
- Frequency > 1×/h (`*/N * * * *`, `0 * * * *`)
- Keywords: "exactly midnight", "at the exact time", "reset", "real-time", "user notification", "refresh cache", "limit reset", "start/end of day", "sync in real time"
- Direct user impact if it drifts

**"Best-effort" signals → prefer GitHub**:
- Frequency ≤ 1/day (weekly, monthly, non-critical daily)
- Keywords: "report", "digest", "newsletter", "backup", "cleanup", "summary", "archive"
- No visible consequence if delayed by 30 min

If signals are mixed: **frequency wins**. If genuinely in doubt: default to GitHub.

Store `PREFER=cf` or `PREFER=gh`.

### 4.c - Available Cloudflare slots

Reuse the variables already computed in **Step 0.a**: `ACCOUNT_ID`, `CF_USED`, `CF_FREE`, `PER_WORKER`. No need to re-run the script - we already have this info from the very start of the flow.

If Step 0.a returned an error (Cloudflare not configured), we already aborted at that point - so we never reach here in that case.

### 4.d - Check whether the shared dispatcher already exists

```bash
test -f "$HOME/.cron-dispatcher/wrangler.toml" && echo "exists" || echo "new"
```

Store `DISPATCHER_EXISTS=true|false`.

### 4.e - Final decision

Apply this decision table (silently, without asking the user):

| Case | `PREFER` | `NEEDS_DEDICATED_CF` | `CF_FREE` | `DISPATCHER_EXISTS` | → Decision (`CHOICE`) |
|---|---|---|---|---|---|
| 1 | `gh` | * | * | * | `gh` |
| 2 | `cf` | true | ≥1 | * | `cf-dedicated` |
| 3 | `cf` | true | 0 | * | `gh` (with an explicit warning in the summary) |
| 4 | `cf` | false | ≥1 | false | `cf-dedicated` (prefer a dedicated slot when there is room) |
| 5 | `cf` | false | ≥2 | true | `cf-dispatcher` (the dispatcher already exists, may as well use it: zero extra slot + consistency with the other tasks) |
| 6 | `cf` | false | 1 | * | `cf-dispatcher` (keep the last slot for a truly dedicated case) |
| 7 | `cf` | false | 0 | * | `cf-dispatcher` |

**Note on Case 5**: if the dispatcher exists AND the user has many free slots, we still favor the dispatcher to share resources. This reduces fragmentation.

Store `CHOICE` ∈ {`cf-dedicated`, `cf-dispatcher`, `gh`}.

Also build `REASON` (1 non-tech sentence), to use in the final summary:
- `cf-dedicated`: *"I put it on the precise Cloudflare clock (triggers to the second) because <frequency/criticality>"*
- `cf-dispatcher`: *"I put it on your shared Cloudflare clock (precise to the minute, shared across all your projects) because <reason>"*
- `gh` (Case 1): *"I put it on the GitHub clock because it is <best-effort type>, exact timing has no impact here"*
- `gh` (forced Case 3): *"I would have preferred the precise Cloudflare clock because <reason>, but your 5 Cloudflare spots are taken AND this task needs an isolated spot. I put it on the GitHub clock. Downside: a possible delay of 30-60 min - concretely <consequence>"*

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

### If `CHOICE=cf-dedicated` → dedicated Cloudflare Worker

#### Preflight: valid Cloudflare token?

```bash
result=$(node "${CLAUDE_SKILL_DIR}/../../scripts/check-deps.mjs" cloudflare)
cf_ok=$(echo "$result" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).cloudflare.ok)")
```

If `cf_ok = false` → silently switch to `CHOICE=gh` and adapt `REASON` ("Cloudflare is not configured on your machine, I'm switching to the GitHub clock instead - re-run `/start` if you want to enable Cloudflare later"). Continue further down in the `gh` branch.

#### Install Wrangler + scaffold

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

### If `CHOICE=cf-dispatcher` → shared Cloudflare dispatcher

#### Cloudflare preflight

Identical to the dedicated case. If Cloudflare is not available → silently switch to `gh`.

#### Init the dispatcher if absent

Invoke `_setup-wrangler` then:

```bash
# Get the account ID if it is not already in ACCOUNT_ID
[ -z "$ACCOUNT_ID" ] && ACCOUNT_ID=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts" \
  | node -e "const d = JSON.parse(require('fs').readFileSync(0, 'utf8')); console.log(d.result?.[0]?.id || '');")

# Init if not already there
node "${CLAUDE_SKILL_DIR}/../../scripts/setup-cron-dispatcher.mjs" \
  --init --cf-account-id "$ACCOUNT_ID"
```

If the init returns `action=created`, deploy the dispatcher for the first time:
```bash
cd "$HOME/.cron-dispatcher" && wrangler deploy && cd -
```

#### Add the task

```bash
WEB_DIR_FLAG=""
[ "$IS_MONOREPO" = "yes" ] && WEB_DIR_FLAG="--web-dir apps/web"

result=$(node "${CLAUDE_SKILL_DIR}/../../scripts/setup-cron-dispatcher.mjs" \
  --add-task \
  --task-name "<TASK_NAME>" \
  --cron-expr "<CRON_EXPR>" \
  --app-url "<NEXT_PUBLIC_APP_URL>" \
  --project-name "<PROJECT_NAME>" \
  $WEB_DIR_FLAG)

SECRET_NAME=$(echo "$result" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).secretName)")
```

#### Push the project secret (if not already there)

```bash
# List the dispatcher's current secrets
EXISTING=$(cd "$HOME/.cron-dispatcher" && wrangler secret list 2>/dev/null \
  | node -e "const d = JSON.parse(require('fs').readFileSync(0,'utf8') || '[]'); console.log(d.map(s => s.name).join(' '))" \
  || echo "")

# If this project's secret does not exist yet, upload it
if ! echo " $EXISTING " | grep -q " $SECRET_NAME "; then
  cd "$HOME/.cron-dispatcher" && printf '%s' "<CRON_SECRET>" | wrangler secret put "$SECRET_NAME"
  cd -
fi
```

#### Redeploy the dispatcher

```bash
cd "$HOME/.cron-dispatcher" && wrangler deploy && cd -
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

For a **dedicated CF Worker** cron:
```
- **<TASK_NAME>** (dedicated Cloudflare Worker) - `<CRON_EXPR>` (<CRON_HUMAN>) → `cron-workers/<TASK_NAME>/` → calls `/api/cron/<TASK_NAME>`
```

For a **shared CF dispatcher** cron:
```
- **<TASK_NAME>** (shared Cloudflare dispatcher) - `<CRON_EXPR>` (<CRON_HUMAN>) → `~/.cron-dispatcher/` (worker shared across projects) → calls `/api/cron/<TASK_NAME>` with secret `<SECRET_NAME>`
```

For a **GitHub Action** cron:
```
- **<TASK_NAME>** (GitHub Action) - `<CRON_EXPR>` (<CRON_HUMAN>) → `.github/workflows/cron-<TASK_NAME>.yml` → calls `/api/cron/<TASK_NAME>`
```

Add as the section intro (created only once):
```
Scheduled tasks. A clock pings the `/api/cron/<name>` endpoint on the Next.js side, protected by `CRON_SECRET`. The business logic lives in Next.js. 3 possible clocks:
- **Dedicated Cloudflare Worker**: timing to the second, 1 CF slot per task (5 free max)
- **Shared Cloudflare dispatcher** (`~/.cron-dispatcher/`): timing to the minute, 1 CF slot total for N tasks across N projects
- **GitHub Action**: best-effort (±30 min), unlimited, automatic monthly keepalive to avoid deactivation after 60 days
```

And `env-vars`:
- `- \`CRON_SECRET\` - Bearer token used to authenticate cron clock against \`/api/cron/<name>\``

---

## Step 8 - Final summary

Choose the right block according to `CHOICE`, incorporating `REASON` in non-tech language.

### If `cf-dedicated`
> ## ✅ Your task **<TASK_NAME>** is in place
>
> It will trigger **<CRON_HUMAN>**. <REASON>
>
> For now it does nothing concrete - I prepared the file where you will write what it should do (*<TASK_DESCRIPTION>*). Tell me what it should run and I'll code the logic for you.
>
> You can also ask me at any time:
> - *"run the task right now to test it"*
> - *"show me the latest triggers"*
> - *"change the schedule to X"*
> - *"delete this task"*

### If `cf-dispatcher`
> ## ✅ Your task **<TASK_NAME>** is in place
>
> It will trigger **<CRON_HUMAN>**. <REASON>
>
> I used your **shared Cloudflare clock**: a single mechanism shared across all your projects, which uses a single Cloudflare spot no matter how many tasks there are. <If first call: *"I created it for you on this occasion - it lives outside your project, in a dedicated folder on your computer, and will outlive all your future projects."*>
>
> For now it does nothing concrete - I prepared the file where you will write what it should do (*<TASK_DESCRIPTION>*). Tell me what it should run and I'll code the logic for you.
>
> You can also ask me at any time: *"run the task right now to test it"*, *"show me the latest triggers"*, *"change the schedule to X"*, *"delete this task"*.

### If `gh` (standard case, REASON = best-effort)
> ## ✅ Your task **<TASK_NAME>** is in place
>
> It will trigger **<CRON_HUMAN>**. <REASON>
>
> A small reminder: GitHub can be 30 to 60 min late, but that's not a problem for this kind of task. I also added (if not already done) a tiny invisible task that runs once a month to prevent GitHub from disabling the clock if you don't touch the project for 60 days.
>
> For now it does nothing concrete - I prepared the file where you will write what it should do (*<TASK_DESCRIPTION>*). Tell me what it should run and I'll code the logic for you.
>
> You can also ask me: *"run the task right now to test it"*, *"show me the latest triggers"*, *"change the schedule to X"*, *"delete this task"*.

### If `gh` (forced Case 3 or Cloudflare unavailable)
> ## ⚠️ Your task **<TASK_NAME>** is in place - with a caveat
>
> It will trigger **<CRON_HUMAN>** on the GitHub clock. <REASON explaining why not Cloudflare>
>
> **Good to know**: GitHub can be 30-60 min late. <Concrete consequence depending on the nature of the task, e.g.: *"if it arrives 30 min later, some users will see their old quota during that half hour"*>.
>
> **If this delay becomes a problem**, you can tell me:
> - *"free up a Cloudflare spot"* - I'll list your current Cloudflare tasks, you choose which to delete, and we move this one onto it
> - *"switch to the paid Cloudflare plan"* - $5/month for 250 spots instead of 5

---

## Natural-language override

If **after** the final summary the user says *"no, Cloudflare instead"* / *"GitHub instead"* / *"put it in the dispatcher"*, restart from Step 6 with the forced `CHOICE`. Not before - the automatic decision is the default.

If the user asks to **delete an existing task**: list the current tasks (dedicated Workers via the Cloudflare API (`GET https://api.cloudflare.com/client/v4/accounts/<account-id>/workers/scripts`) filtered by the `<projectname>-cron-` prefix, dispatcher tasks by reading `~/.cron-dispatcher/wrangler.toml` TASKS, GitHub Actions via `.github/workflows/cron-*.yml`). Let them choose, delete, and resume the flow if needed.
