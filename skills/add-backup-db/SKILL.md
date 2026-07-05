---
name: add-backup-db
description: Add automated Neon database backups to the current project. Registers the project as a snapshot target of the unified shared Cloudflare Worker "hypervibe-jobs" (one Worker per account for ALL background jobs, reused across projects) that creates point-in-time Neon branch snapshots every 2 weeks. Retention - rolling (2 latest) + aging checkpoints every 3 months (kept up to 9 months). Uses only 1 Cloudflare cron slot regardless of how many databases are backed up. Auto-invoked silently at the end of /add-db when --quiet flag is passed; can also be called standalone.
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---


## Invocation modes

- **Interactive mode (default)**: the user called `/add-backup-db` directly. You show the detailed checklist and each `↳ … ✅`. You finish with the full summary (Step 8).
- **`quiet` mode**: called silently by `/add-db` (or another caller) at the end of its flow. You **display nothing** other than **a single final status line** intended for the caller, which must be one of these exact values:
  - `STATUS:ok:created` - the shared worker got the snapshot job for the first time (this project is registered as its first target)
  - `STATUS:ok:added` - the snapshot job already existed, this project was appended as a new target
  - `STATUS:ok:already-registered` - the project was already registered, no-op
  - `STATUS:skipped:no-neon-key` - `NEON_API_KEY` not found (neither env nor rc nor vault) → we could not prompt in quiet mode
  - `STATUS:skipped:cloudflare-missing` - Cloudflare token missing or not authenticated
  - `STATUS:skipped:no-db` - the Neon DB is not wired into this project (db_ok=false)
  - `STATUS:error:<short-reason>` - any other error, with a short reason

  No checklist, no `↳ …`, no prompts. No user-facing output. The caller uses the status to decide what to show in its global summary.

Detect the mode: if `$ARGUMENTS` contains `--quiet` (or if the invocation passes `quiet=true`), switch to quiet mode and apply the rules above at every step.


## ⚠️ Before any shared-worker script or `wrangler` command (do this FIRST)

```bash
eval "$(node "${CLAUDE_SKILL_DIR}/../../scripts/wrangler-env-init.mjs")"
```

This line loads `CLOUDFLARE_API_TOKEN` from the User scope (Windows registry / shell rc on Mac/Linux) if it is not already in `process.env`, and adds the pnpm bin to the PATH (for bash sessions where `pnpm setup` has not propagated yet). Without it, the deploy step fails with "command not found" on Mac (Spotlight), or may use a different Cloudflare account than the one the user expects.


# Add Backup DB - Automated Neon database backups

You add automatic backups for the current project's Neon database.

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

---

## Architecture

```
Cloudflare Worker "hypervibe-jobs" (ONE worker, ONE cron slot, ALL account-wide jobs)
  ├─ job "neon-backups" (kind: snapshot, default cadence: 1st and 15th of the month, 3am UTC)
  │    └─ For each registered target:
  │         └─ Neon API → create a branch snapshot + clean up the old ones
  ├─ job "quota-monitor" (kind: quota, if configured by /quotas)
  └─ ping jobs (kind: ping, if configured by /add-cron or /add-automation)
```

**A single unified shared Worker** for the whole account: it is the shared clock of all Hypervibe background jobs, not just backups. Each call to `add-backup-db` registers the current project as one more **target** of the `neon-backups` snapshot job. A single Cloudflare cron slot consumed, regardless of the number of projects and jobs.

The job list lives in a **git-versioned registry**: `~/.hypervibe-jobs/jobs.js`. Every change is committed there and the worker is redeployed, all handled by the plugin scripts. You never scaffold or edit the worker files by hand.

### Retention policy (per project)

| Type | When a new one is created | Deleted when | Max branches |
|---|---|---|---|
| Rolling | On each run (every ~2 weeks) | Only the 2 most recent are kept | 2 |
| Aging | When the most recent aging is > 3 months (90 days) old | When it exceeds 9 months (270 days) | 3 (in steady state) |

**Total: 5 Neon branches max per project** (out of 20 on the free tier).

In steady state, the 3 aging branches cover the 0-3 months, 3-6 months and 6-9 months ranges. The oldest one (9 months) is deleted when a new one is created.

### Worker location

The worker lives in `$HOME/.hypervibe-jobs/` (outside any repo, because it is shared across projects; itself a small git repo so the registry history is versioned). Contains: `worker.js` + `jobs.js` (the registry) + `wrangler.toml`. Managed exclusively through the plugin scripts below.

---

## Step 1 - Prerequisites

Invoke `_setup-wrangler` to make sure Wrangler is installed and authenticated.

Invoke `_check-deps db` to verify that a **real** Neon cloud database is wired up:

```bash
result=$(node "${CLAUDE_SKILL_DIR}/../../scripts/check-deps.mjs" db)
db_ok=$(echo "$result" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).db.ok)")
```

The helper handles the heuristics (rejecting T3 localhost defaults, `placeholder`, missing `drizzle.config`...). Do NOT re-implement these checks inline.

If `db_ok = false`:
- **Quiet mode**: emit `STATUS:skipped:no-db` and exit. No message to the user.
- **Interactive mode**: abort with this message:

> This project does not have a real database wired up yet (just a default setting that is not connected to anything). Tell me **"add a database"** and I will take care of it, then we will set up the automatic backups.

**Also check the Cloudflare token**:
```bash
result=$(node "${CLAUDE_SKILL_DIR}/../../scripts/check-deps.mjs" cloudflare)
cf_ok=$(echo "$result" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).cloudflare.ok)")
```

If `cf_ok = false`:
- **Quiet mode**: emit `STATUS:skipped:cloudflare-missing` and exit.
- **Interactive mode**: abort with a message asking the user to re-run `/start` to configure Cloudflare.

---

## Step 2 - Identify the Neon project

List the projects via the **Neon REST API** (key `NEON.api_key` from the vault) and match against the current project (by comparing the name or the host in `DATABASE_URL`):

```bash
NTOK=$(node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" get NEON api_key)
curl -s -H "Authorization: Bearer $NTOK" "https://console.neon.tech/api/v2/projects?limit=400"
```
(`_get-secret` pattern for `NTOK`: RC 2/3 → unlock; RC 4 → add `NEON` to the vault.)

Match the `DATABASE_URL` host (`ep-xxx...`) with a project from the list (via `GET /projects/{id}/connection_uri` or by comparing the endpoints). As a last resort, ask the user for the Neon project ID (visible on https://console.neon.tech → project → Settings).

Store: `NEON_PROJECT_ID` and `PROJECT_NAME` (the project's short name, e.g. `hypervibe`). `PROJECT_NAME` must be **kebab-case** (lowercase, digits, hyphens): normalize it if needed, the registry rejects anything else.

---

## Step 3 - Provision the shared worker (idempotent preflight)

One call replaces all the scaffolding: it creates `~/.hypervibe-jobs/` (git repo, worker code, registry, wrangler config), deploys the worker on the user's Cloudflare account, and sets up the admin token used for manual triggers. If everything already exists, it returns fast without touching anything (it may self-heal: sync the worker code with the plugin version, re-init git, regenerate the admin token).

```bash
eval "$(node "${CLAUDE_SKILL_DIR}/../../scripts/wrangler-env-init.mjs")"
result=$(node "${CLAUDE_SKILL_DIR}/../../scripts/shared-worker/ensure.mjs")
```

Parse the JSON `result`:
- `{ ok: true, status: "created" | "already_present", dir, workerName: "hypervibe-jobs", workerUrl, deployed, jobs, adminTokenVar: "HYPERVIBE_JOBS_ADMIN_TOKEN", healed: [] }`
- `{ ok: false, error, howTo }` on failure.

If `ok = false`:
- **Quiet mode**: if the error concerns wrangler or the Cloudflare token, emit `STATUS:skipped:cloudflare-missing`; otherwise emit `STATUS:error:<short-reason>`. Exit.
- **Interactive mode**: explain the problem in plain words and relay the `howTo` instruction (usually: run `/start`). Abort.

Keep `workerUrl` and `dir` for later steps. If `healed` is non-empty in interactive mode, you may mention in one short line that the backup system was refreshed; no details needed.

### Migration from the old db-backup worker (legacy, interactive mode only)

Before 2026-07 backups ran on a standalone worker scaffolded in `~/.db-backup-worker/`. Right after the preflight, check for it:

```bash
test -f "$HOME/.db-backup-worker/wrangler.toml" && echo "legacy" || echo "clean"
```

If `legacy` (and you are in interactive mode):
1. Tell the user in plain words: you found their previous backup system, you will move its configuration into the new unified one, no backup is lost, nothing is deleted yet.
2. Run the one-shot migration (it imports ALL legacy backup targets, plus the old quota watch if present, uploads the needed secrets, commits and redeploys):
   ```bash
   result=$(node "${CLAUDE_SKILL_DIR}/../../scripts/shared-worker/migrate-live.mjs" --put-secrets)
   ```
3. Verify it works: run a manual backup right now (the trigger command in Step 6) and watch the result. The migration output also contains a ready-made `verification` list.
4. Only after that verification succeeds: decommission the legacy workers. The migration output lists the exact commands under `decommission_after_verification` (a `wrangler delete` in each legacy folder, which frees their cron slots, then removing the folders). Explain to the user in plain words what you are about to do (deleting the OLD standalone workers, now redundant) and do it.

In quiet mode: never migrate (that flow needs the user in the loop). Just continue; the legacy worker keeps running untouched and the migration will be offered next time this skill runs interactively.

---

## Step 4 - Check the current registration and the Neon API key

### 4.a - Is this project already a target?

```bash
result=$(node "${CLAUDE_SKILL_DIR}/../../scripts/shared-worker/register.mjs" --list)
```

In the returned `jobs` array, look for the job named `neon-backups` (kind `snapshot`) and, inside its `targets`, an entry whose `name` equals `PROJECT_NAME`.

If the target is already there:
- **Quiet mode**: emit `STATUS:ok:already-registered` and exit.
- **Interactive mode**: enter the **frequency modification flow** below (Step 4.bis).

Otherwise continue to 4.b. Also note whether the `neon-backups` job exists at all (needed in 4.b).

### 4.b - Neon API key availability

The worker authenticates to Neon with a `NEON_API_KEY` secret. Check that the key is readable locally:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/_read-user-env.mjs" NEON_API_KEY
```

If the command returns a non-empty value, move on to Step 5. (On this machine, the key is usually already saved by `/start`.)

If it is empty:
- **Quiet mode**: if the `neon-backups` job already exists (seen in 4.a), the worker already holds the secret from a previous registration: continue to Step 5 anyway. If the job does not exist yet, emit `STATUS:skipped:no-neon-key` and exit. **Do not prompt** - that would be disruptive in the middle of `/add-db`. The caller will read this status and show the warning in its summary.
- **Interactive mode**: tell the user:

> For the backups to work automatically, I need a Neon API key.
>
> 1. Go to **https://console.neon.tech/app/settings/api-keys**
> 2. Click **Create new API key**
> 3. Name: `claude-code` (or whatever you want)
> 4. Copy the key and paste it here
>
> (The key gives access to all your Neon projects by default, which is perfect for backing up multiple projects with the same key.)

Wait for the key. Store it in the **vault** (reusable for all projects) - a masked-input window, the value does not pass through Claude:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/vault/launch.mjs" add --name NEON --service Neon --fields api_key:secret
```

Store: item `NEON`, field `api_key`. (`_read-user-env.mjs NEON_API_KEY` will then read it back automatically, and so will the registration script.) If the vault is not set up yet, run `_add-keyring` first.

---

## Step 4.bis - Change the frequency (interactive mode only, project already backed up)

The project is already registered for backups. Offer to **change the frequency** rather than just skipping.

### 4.bis.a - Read the current cadence

In the `--list` output from 4.a, read the `cron` field of the `neon-backups` job. Convert the cron expression into a human-readable label:

| Cron expression | Label shown to the user |
|---|---|
| `0 3 * * *` | Every day (at 3am UTC) |
| `0 3 * * 1` | Every week (Monday 3am UTC) |
| `0 3 1,15 * *` | Every 2 weeks (1st and 15th of the month) |
| `0 3 1 * *` | Every month (1st of the month) |
| Other | Custom: show the raw expression |

### 4.bis.b - Ask the user

Show exactly (replacing `<CURRENT>` with the label):

> ## 📦 This project is already backed up
>
> Current backup cadence: **<CURRENT>**.
>
> Do you want to **change** it?
>
> 1. ⏰ **Every day** - maximum protection, fast rotation
> 2. 🗓️ **Every week** - a good compromise for an active project
> 3. 🔄 **Every 2 weeks** *(Hypervibe default)* - economical for most projects
> 4. 📅 **Every month** - low-activity projects
> 5. ❌ **Change nothing** - keep the current cadence
>
> ⚠️ **Important**: the cadence is **shared across all your** backed-up projects (a single shared backup job to save Cloudflare slots). Changing it here will affect ALL your backup projects.

### 4.bis.c - Process the choice

- **Choice 5** (change nothing): show *"OK, I am not touching anything. Your backups continue at the current pace ✅"*. Skip to Step 7.
- **Choices 1-4**: if the value already matches the current cadence, say *"That is already the cadence in place, nothing to change ✅"* and skip to Step 7. Otherwise:
  1. Map the choice to the corresponding cron expression (table 4.bis.a)
  2. Apply it through the registry (re-registering the same target with `--cron` updates the shared cadence, commits and redeploys in one call):
     ```bash
     result=$(node "${CLAUDE_SKILL_DIR}/../../scripts/shared-worker/register.mjs" \
       --kind snapshot --target-name "<PROJECT_NAME>" --neon-project-id "<NEON_PROJECT_ID>" \
       --cron "<CRON_EXPR>")
     ```
  3. Check `ok: true` (the `action` will be `target-updated`), then confirm with `--list` that the `neon-backups` job now carries the new `cron`.
  4. Show: *"✅ Cadence updated: backups are now **<NEW_LABEL>**. Effective across all your backup projects."*
- Skip to Step 7 (CLAUDE.md), then Step 8 (final summary).

---

## Step 5 - Register the project as a snapshot target

One call does everything: creates the `neon-backups` job on first use, appends (or updates) this project's target, uploads the `NEON_API_KEY` secret read from the vault, commits the registry change to git, and redeploys the worker.

```bash
result=$(node "${CLAUDE_SKILL_DIR}/../../scripts/shared-worker/register.mjs" \
  --kind snapshot --target-name "<PROJECT_NAME>" --neon-project-id "<NEON_PROJECT_ID>" --put-secrets)
```

Do NOT pass `--cron` here: new registrations join the shared cadence as it is (default `0 3 1,15 * *`). Changing the cadence is Step 4.bis territory and affects all projects.

Parse the JSON `result`:
- `{ ok: true, action: "target-added" | "target-updated", job: "neon-backups", target, targetCount, dir, deployed, workerUrl, uploadedSecrets, missingSecrets, nextSteps }`

Handle it:

| Outcome | Quiet mode | Interactive mode |
|---|---|---|
| `ok:true`, `action:"target-added"`, `targetCount` = 1 | emit `STATUS:ok:created` and exit | continue to Step 6 |
| `ok:true`, `action:"target-added"`, `targetCount` > 1 | emit `STATUS:ok:added` and exit | continue to Step 6 |
| `ok:true`, `action:"target-updated"` | emit `STATUS:ok:already-registered` and exit | continue to Step 6 |
| `ok:true` but `missingSecrets` contains `NEON_API_KEY` | emit `STATUS:skipped:no-neon-key` and exit (the target is saved; re-running the skill later will finish the job) | prompt for the key as in Step 4.b, store it in the vault, then re-run the exact same registration command (idempotent) so the secret gets uploaded |
| `ok:false` | emit `STATUS:error:<short-reason>` and exit | explain in plain words, relay `nextSteps` if present, abort |

**Quiet mode ends here in every case** (skip Steps 6 to 8, the caller handles the rest).

---

## Step 6 - Verify the deployment (interactive mode)

The registration output already confirms `deployed: true` and gives `workerUrl`. For a stronger check, or whenever the user wants a backup **right now**, trigger the job manually:

```bash
ADMIN=$(node "${CLAUDE_SKILL_DIR}/../../scripts/_read-user-env.mjs" HYPERVIBE_JOBS_ADMIN_TOKEN)
curl -s -X POST -H "Authorization: Bearer $ADMIN" "<workerUrl>/trigger?name=neon-backups"
```

To watch it run live:

```bash
cd ~/.hypervibe-jobs && npx wrangler tail
```

After a manual run you can confirm the new `bk-<PROJECT_NAME>-r-...` branch in the Neon console. Keep this quick: one trigger + one confirmation line is enough.

---

## Step 7 - Update CLAUDE.md

Invoke `_update-claude-md` with:
- `custom`:
  - heading: `## Backups`
  - body (adapt the Schedule line if a custom cadence is in place):
    ```
    Automatic backups of the Neon database via the unified shared Cloudflare Worker (`hypervibe-jobs`).
    - **Schedule**: 1st and 15th of the month at 3am UTC (~every 2 weeks), cadence shared by all backed-up projects
    - **Retention**: 2 rolling (last 2 weeks) + up to 3 aging (checkpoints ~3 months, kept 9 months max)
    - **Neon branches**: 5 max per project (out of 20 on the free tier)
    - **Job registry**: `~/.hypervibe-jobs/jobs.js` (git-versioned; job name: `neon-backups`)
    - **Logs**: `cd ~/.hypervibe-jobs && npx wrangler tail`
    - **Run a backup now**: ask me to run a backup right now (I trigger the `neon-backups` job manually)
    - **Add another project**: re-run `/add-backup-db` from that project
    ```

---

## Step 8 - Summary

> ## ✅ Backups enabled
>
> Your database **<PROJECT_NAME>** (`<NEON_PROJECT_ID>`) is now backed up automatically by your shared backup system (`hypervibe-jobs`).
>
> | | |
> |---|---|
> | **Schedule** | 1st and 15th of the month at 3am UTC (cadence shared by all your backed-up projects) |
> | **Rolling** | 2 recent backups (0 and ~2 weeks) |
> | **Checkpoints** | A new one every ~3 months, kept for 9 months |
> | **Neon branches** | 5 max out of the 20 on the free tier |
>
> **Good to know:**
> - Want a backup right now? Just ask me to **run a backup right now** and I will trigger it.
> - View the logs live: `cd ~/.hypervibe-jobs && npx wrangler tail`
> - Add another project: re-run `/add-backup-db` in that project
> - Stop backing up THIS project: ask me to disable its backups (I only remove this project from the list; the other projects keep their backups)

---

## Other operations (reference for the model)

- **List everything the shared worker runs** (all jobs, all targets, cadences):
  ```bash
  node "${CLAUDE_SKILL_DIR}/../../scripts/shared-worker/register.mjs" --list
  ```
- **Disable backups for THIS project only** (what "disable the backups" means by default):
  ```bash
  node "${CLAUDE_SKILL_DIR}/../../scripts/shared-worker/register.mjs" --kind snapshot --remove-target "<PROJECT_NAME>"
  ```
  Never run `wrangler delete` for this: the worker is shared, other projects may still depend on it for their backups and for the other jobs (quota watch, cron pings). Deleting the whole `hypervibe-jobs` worker is an **account-wide decision** that kills every job for every project; only consider it if the user explicitly wants to dismantle the entire shared system, and say so clearly first.
- **Manual test run**: the `ADMIN` + `curl .../trigger?name=neon-backups` pair from Step 6.
- **Live logs**: `cd ~/.hypervibe-jobs && npx wrangler tail`
