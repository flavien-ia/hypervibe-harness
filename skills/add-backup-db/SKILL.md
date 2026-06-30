---
name: add-backup-db
description: Add automated Neon database backups to the current project. Deploys a shared Cloudflare Worker (one per account, reused across projects) that creates point-in-time Neon branch snapshots every 2 weeks. Retention - rolling (2 latest) + aging checkpoints every 3 months (kept up to 9 months). Uses only 1 Cloudflare cron slot regardless of how many databases are backed up. Auto-invoked silently at the end of /add-db when --quiet flag is passed; can also be called standalone.
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---


## Invocation modes

- **Interactive mode (default)**: the user called `/add-backup-db` directly. You show the detailed checklist and each `↳ … ✅`. You finish with the full summary (Step 9).
- **`quiet` mode**: called silently by `/add-db` (or another caller) at the end of its flow. You **display nothing** other than **a single final status line** intended for the caller, which must be one of these exact values:
  - `STATUS:ok:created` - the `db-backup` worker was created for the first time on the CF account, and this project is registered as the first target
  - `STATUS:ok:added` - the worker already existed, this project was added to `BACKUP_TARGETS`
  - `STATUS:ok:already-registered` - the project was already registered, no-op
  - `STATUS:skipped:no-neon-key` - `NEON_API_KEY` not found (neither env nor rc) → we could not prompt in quiet mode
  - `STATUS:skipped:cloudflare-missing` - Cloudflare token missing or not authenticated
  - `STATUS:skipped:no-db` - the Neon DB is not wired into this project (db_ok=false)
  - `STATUS:error:<short-reason>` - any other error, with a short reason

  No checklist, no `↳ …`, no prompts. No user-facing output. The caller uses the status to decide what to show in its global summary.

Detect the mode: if `$ARGUMENTS` contains `--quiet` (or if the invocation passes `quiet=true`), switch to quiet mode and apply the rules above at every step.


## ⚠️ Before any call to `wrangler` (do this BEFORE any other wrangler command in this skill)

```bash
eval "$(node "${CLAUDE_SKILL_DIR}/../../scripts/wrangler-env-init.mjs")"
```

This line loads `CLOUDFLARE_API_TOKEN` from the User scope (Windows registry / shell rc on Mac/Linux) if it is not already in `process.env`, and adds the pnpm bin to the PATH (for bash sessions where `pnpm setup` has not propagated yet). Without it, `wrangler` fails with "command not found" on Mac (Spotlight), or may use a different Cloudflare account than the one the user expects.


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
Cloudflare Worker "db-backup" (cron: 1st and 15th of the month, 3am UTC)
  └─ For each registered project:
       └─ Neon API → create a branch snapshot + clean up the old ones
```

**A single shared Worker** for all projects. Each call to `add-backup-db` registers the current project in the list of targets. A single Cloudflare cron slot consumed, regardless of the number of projects.

### Retention policy (per project)

| Type | When a new one is created | Deleted when | Max branches |
|---|---|---|---|
| Rolling | On each run (every ~2 weeks) | Only the 2 most recent are kept | 2 |
| Aging | When the most recent aging is > 3 months old | When it exceeds 9 months | 3 (in steady state) |

**Total: 5 Neon branches max per project** (out of 20 on the free tier).

In steady state, the 3 aging branches cover the 0-3 months, 3-6 months and 6-9 months ranges. The oldest one (9 months) is deleted when a new one is created.

### Worker location

The Worker lives in `$HOME/.db-backup-worker/` (outside any repo, because it is shared across projects). Contains: `wrangler.toml` + `index.js`.

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

Store: `NEON_PROJECT_ID` and `PROJECT_NAME` (the project's short name, e.g. `hypervibe`).

---

## Step 3 - Check whether the db-backup Worker already exists

```bash
test -f "$HOME/.db-backup-worker/wrangler.toml" && echo "exists" || echo "new"
```

### If "exists" → Branch A (add a target)

1. Read `$HOME/.db-backup-worker/wrangler.toml`
2. Extract the value of `BACKUP_TARGETS` (JSON array in `[vars]`)
3. Check that the current project is not already registered (by `projectId`)
4. If already registered:
   - **Quiet mode**: emit `STATUS:ok:already-registered` and exit.
   - **Interactive mode**: enter the **frequency modification flow** below (Step 3.bis).
5. Add `{"name":"<PROJECT_NAME>","projectId":"<NEON_PROJECT_ID>"}` to the array
6. Write the updated `wrangler.toml` (only the `BACKUP_TARGETS` line changes)
7. Redeploy:
   ```bash
   cd "$HOME/.db-backup-worker" && wrangler deploy
   ```
8. **Quiet mode**: emit `STATUS:ok:added` and exit (skip Steps 8 and 9). **Interactive mode**: skip to Step 8.

### If "new" → Branch B (first installation)

Continue to Step 4.

---

## Step 3.bis - Change the frequency (interactive mode only, project already backed up)

The project is already registered for backups. Offer to **change the frequency** rather than just skipping.

### 3.bis.a - Read the current cadence

In the `wrangler.toml`, extract the value of `crons = [...]`. Convert the cron expression into a human-readable label:

| Cron expression | Label shown to the user |
|---|---|
| `0 3 * * *` | Every day (at 3am UTC) |
| `0 3 * * 1` | Every week (Monday 3am UTC) |
| `0 3 1,15 * *` | Every 2 weeks (1st and 15th of the month) |
| `0 3 1 * *` | Every month (1st of the month) |
| Other | Custom: show the raw expression |

### 3.bis.b - Ask the user

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
> ⚠️ **Important**: the cadence is **shared across all your** backed-up projects (a single shared Worker to save Cloudflare slots). Changing it here will affect ALL your backup projects.

### 3.bis.c - Process the choice

- **Choice 5** (change nothing): show *"OK, I am not touching anything. Your backups continue at the current pace ✅"*. Skip to Step 8.
- **Choices 1-4**: if the value already matches the current cadence, say *"That is already the cadence in place, nothing to change ✅"* and skip to Step 8. Otherwise:
  1. Map the choice to the corresponding cron expression (table 3.bis.a)
  2. Update the `crons = [...]` line in the `wrangler.toml` (only this line changes)
  3. Redeploy:
     ```bash
     cd "$HOME/.db-backup-worker" && wrangler deploy
     ```
  4. Check that the new trigger is correctly declared:
     ```bash
     cd "$HOME/.db-backup-worker" && wrangler triggers list
     ```
  5. Show: *"✅ Cadence updated: backups are now **<NEW_LABEL>**. Effective across all your backup projects."*
- Skip to Step 8 (final summary).

---

## Step 4 - Get the Neon API key (first time only)

### 4.a - Read from the env first

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/_read-user-env.mjs" NEON_API_KEY
```

If the command returns a non-empty value, use it directly as `NEON_API_KEY` and move on to Step 5. (On this machine, the key is usually already saved by `/start`.)

### 4.b - Otherwise, prompt the user (rare)

#### In `quiet` mode
Emit `STATUS:skipped:no-neon-key` and exit. **Do not prompt** - that would be disruptive in the middle of `/add-db`. The caller will read this status and show the warning in its summary.

#### In interactive mode
Tell the user:

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

Store: item `NEON`, field `api_key`. (`_read-user-env.mjs NEON_API_KEY` will then read it back automatically.) If the vault is not set up yet, run `_add-keyring` first.

---

## Step 5 - Get the Cloudflare account ID

```bash
wrangler whoami 2>&1
```

Extract the account ID from the output. Store: `CF_ACCOUNT_ID`.

---

## Step 6 - Scaffold and deploy the Worker

1. Create the folder:

```bash
mkdir -p "$HOME/.db-backup-worker"
```

2. Copy the Worker code from the plugin:

```bash
cp "${CLAUDE_SKILL_DIR}/../../scripts/db-backup-worker.js" "$HOME/.db-backup-worker/index.js"
```

3. Create `$HOME/.db-backup-worker/wrangler.toml` with this content:

```toml
name = "db-backup"
main = "index.js"
compatibility_date = "2024-01-01"
account_id = "<CF_ACCOUNT_ID>"

[triggers]
crons = ["0 3 1,15 * *"]

[vars]
BACKUP_TARGETS = '[{"name":"<PROJECT_NAME>","projectId":"<NEON_PROJECT_ID>"}]'
```

Replace the placeholders with the real values.

4. Deploy:

```bash
cd "$HOME/.db-backup-worker" && wrangler deploy
```

5. Upload the Neon API key secret:

```bash
cd "$HOME/.db-backup-worker" && printf '%s' "<NEON_API_KEY>" | wrangler secret put NEON_API_KEY
```

⚠️ Use `printf '%s'` and not `echo` (echo adds a `\n` that corrupts the key).

---

## Step 7 - Verify the deployment

```bash
cd "$HOME/.db-backup-worker" && wrangler deployments list
```

Also check the cron trigger:

```bash
cd "$HOME/.db-backup-worker" && wrangler triggers list
```

**Quiet mode**: emit `STATUS:ok:created` (worker created for the first time) and exit (skip Steps 8 and 9, the caller handles the rest).

---

## Step 8 - Update CLAUDE.md

Invoke `_update-claude-md` with:
- `custom`:
  - heading: `## Backups`
  - body:
    ```
    Automatic backups of the Neon database via a Cloudflare Worker (`db-backup`).
    - **Schedule**: 1st and 15th of the month at 3am UTC (~every 2 weeks)
    - **Retention**: 2 rolling (last 2 weeks) + 3 aging (checkpoints ~3 months, kept 9 months max)
    - **Neon branches**: 5 max per project (out of 20 on the free tier)
    - **Worker config**: `~/.db-backup-worker/wrangler.toml`
    - **Logs**: `cd ~/.db-backup-worker && wrangler tail`
    - **Add another project**: re-run `/add-backup-db` from that project
    ```

---

## Step 9 - Summary

> ## ✅ Backups enabled
>
> Your database **<PROJECT_NAME>** (`<NEON_PROJECT_ID>`) is now backed up automatically.
>
> | | |
> |---|---|
> | **Schedule** | 1st and 15th of the month at 3am UTC |
> | **Rolling** | 2 recent backups (0 and ~2 weeks) |
> | **Checkpoints** | A new one every ~3 months, kept for 9 months |
> | **Neon branches** | 5 max out of the 20 on the free tier |
>
> **Useful commands:**
> - View the logs live: `cd ~/.db-backup-worker && wrangler tail`
> - Trigger manually: `cd ~/.db-backup-worker && wrangler dev --test-scheduled`
> - View the Neon branches: Neon dashboard or `/backup-db status` (coming soon)
> - Add another project: re-run `/add-backup-db` in another project
> - Disable the backups: `cd ~/.db-backup-worker && wrangler delete`
