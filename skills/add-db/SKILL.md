---
name: add-db
description: Add a Neon Postgres database to an existing T3 project. Provisions the database, configures Drizzle ORM, and pushes the schema. In a monorepo, creates a shared packages/db package.
argument-hint: ""
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Add DB - Neon Postgres Database

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

Adds a Neon Postgres database with Drizzle ORM to the current project. Can be called by `/bootstrap` or standalone on an existing project.

The deterministic core (provisioning, driver swap, schema push, env var push) is handled by `scripts/setup-db.mjs`. This SKILL takes care of the entry-side decisions (re-config detection, monorepo case, MCP availability) and the exit-side communication (CLAUDE.md update, summary).

---

## Preflight - vault unlocked

This skill reads the Neon key from the vault, so first make sure the vault is unlocked (follow **`_ensure-vault`**): `node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" status` then, if `locked`/`expired`, run `node "${CLAUDE_SKILL_DIR}/../../scripts/vault/launch.mjs" unlock` (window, once a day); if the vault does not exist yet, delegate to `_add-keyring`.

---

## Step 0 - Preflight: DB already configured?

**First of all**, invoke `_check-deps db` to detect whether a real cloud DB is already wired up:

```bash
result=$(node "${CLAUDE_SKILL_DIR}/../../scripts/check-deps.mjs" db)
db_ok=$(echo "$result" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).db.ok)")
db_host=$(echo "$result" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).db.host || '')")
```

### If `db_ok = true` then re-configuration mode

A real cloud DB is already wired up (host: `$db_host`). Do NOT run `setup-db.mjs` (it would create a new Neon project, polluting the free tier). Do NOT rewrite `drizzle.config.ts` or the schema. Show a menu:

> ## 🗄️ A database is already in place (host: `$db_host`)
>
> What do you want to do?
>
> 1. **Just push the schema to the DB** (if you changed the Drizzle schema but haven't pushed it yet) - equivalent to `pnpm db:push`
> 2. **Migrate to a new Neon DB** (e.g. change region, start from a clean project) - ⚠️ **destructive**: all current data is lost. I'll guide you through creating the new project + switching the `DATABASE_URL`
> 3. **Reset the current schema** (drop + recreate all tables) - ⚠️ destructive, the data in the current DB is lost
> 4. **Redo everything from scratch** (useful only if your Drizzle config is broken - first remove `DATABASE_URL` from the local `.env`)
> 5. **Something else** - tell me what you want

Wait for the answer.

**Depending on the answer**:

| Choice | Action |
|---|---|
| 1 (push schema only) | `cd <WEB_DIR> && pnpm db:push` (or `pnpm drizzle-kit push`). Show the result. Skip to the final summary. |
| 2 (migrate to a new DB) | Confirm with the user "do you confirm losing the current data?" then re-run `setup-db.mjs --name <project-name>` (it provisions a new Neon project and pushes the DATABASE_URL - it will overwrite the old one in `.env` and on Vercel). Mention that the old Neon project stays on the account (the user can delete it manually in dashboard.neon.tech if they want to free up a slot). |
| 3 (reset schema) | Confirm with the user then try `cd <WEB_DIR> && npx drizzle-kit drop` (depending on the Drizzle version). If not available, list the existing tables via `psql` or the Neon console, then DROP each one via SQL, then `pnpm db:push`. |
| 4 (redo everything) | Abort: ask the user to remove `DATABASE_URL` from the `.env`, then re-run `/add-db`. |
| 5 (something else) | Ask for details. Don't run the full flow by default. |

**At the end**, jump straight to the **final summary** (Step 8 below).

### If `db_ok = false` (not configured yet)

Continue normally to Step 1.

---

## Step 1 - Project context detection

Invoke the `_detect-project-root` internal skill to get `PROJECT_NAME`, `WEB_DIR`, `IS_MONOREPO`, and `IS_NEXTJS`.

- If `IS_NEXTJS=no` then abort. This skill requires a Next.js project.
- If `IS_MONOREPO=yes` then **do not run the script** (it refuses `--monorepo` in v1). Go straight to Step 2 (manual monorepo mode).
- If `IS_MONOREPO=no` then continue to Step 3 or Step 4 depending on the Neon access mode.

### Neon access - API key from the vault

Everything goes through the Neon REST API (`console.neon.tech/api/v2`) with the `NEON.api_key` from the vault. `setup-db.mjs` enforces `region_id: "aws-eu-central-1"` (Frankfurt, next to Vercel `fra1`).

**Check that the Neon key is in the vault** (`_get-secret` pattern):
```bash
VAULT="${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs"
node "$VAULT" get NEON api_key >/dev/null 2>&1; RC=$?
```
- **`RC=0`** then the key is present, go to **Step 4** (REST provisioning via `setup-db.mjs`, which reads the key from the vault itself).
- **`RC=2/3`** (vault locked/expired) then warn the user, `node "${CLAUDE_SKILL_DIR}/../../scripts/vault/launch.mjs" unlock` (blocking), retry.
- **`RC=4`** (key missing) then have it created + stored in the vault:
  > To create your database, I need a Neon key (just once - I'll store it in your vault).
  > 1. Go to https://console.neon.tech/app/settings/api-keys then **Create new API key** then copy it.
  > 2. A window will open: paste it in (masked input).
  ```bash
  node "${CLAUDE_SKILL_DIR}/../../scripts/vault/launch.mjs" add --name NEON --service Neon --fields "api_key:secret"
  ```
  Then retry the `get` then **Step 4**.

(Legacy: `setup-db.mjs` still accepts a `NEON_API_KEY` env var as a fallback during the migration, but the vault is the source of truth.)

---

## Step 2 - Monorepo mode (manual, outside the script)

The `setup-db.mjs` script does not yet handle the monorepo case (which requires creating a shared `packages/db/` package, moving the schema/client/config). Proceed manually:

1. Create the shared `packages/db` package:
   ```bash
   mkdir -p packages/db/src
   ```

2. Create `packages/db/package.json`:
   ```json
   {
     "name": "@<project-name>/db",
     "private": true,
     "main": "./src/index.ts",
     "types": "./src/index.ts"
   }
   ```

3. Install the driver in the package:
   ```bash
   cd packages/db
   pnpm add @neondatabase/serverless drizzle-orm
   pnpm add -D drizzle-kit
   ```

4. Move the schema, the client, and the Drizzle config into `packages/db/src/`. All apps (`apps/web`, `apps/worker`) must import from `@<project-name>/db`.

5. Update `apps/web` (and other apps) to import the DB from the shared package instead of the local files.

6. Provision the Neon project manually via the REST API (the Neon key comes from the vault):
   ```bash
   NEON_KEY=$(node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" get NEON api_key)
   curl -X POST "https://console.neon.tech/api/v2/projects" \
     -H "Authorization: Bearer $NEON_KEY" \
     -H "Content-Type: application/json" \
     -d '{"project":{"name":"<project-name>"}}'
   ```
   Get the pooled `connection_uri` from the response.

7. Push `DATABASE_URL=<connection-uri>` to the monorepo root via `_push-env-vars`.

8. `cd packages/db && npx drizzle-kit push`.

9. Jump straight to Step 5 (Update CLAUDE.md), passing `IS_MONOREPO=yes` to `_update-claude-md`.

---

## Step 3 - (removed: no more MCP provisioning)

We **always** provision via the REST API (`setup-db.mjs`, Step 4), which guarantees the Frankfurt region and reads the Neon key from the vault. The monorepo case (Step 2) stays manual but also uses the REST API.

---

## Step 4 - Run setup-db.mjs (REST provisioning, Frankfurt region)

Run the script from the `WEB_DIR`:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/setup-db.mjs" \
  --name "<PROJECT_NAME>" \
  --web-dir "<WEB_DIR>"
```

The script chains 7 sub-steps: preflight, list projects (with a warning if quota), create Neon project, install driver, swap the Drizzle client to neon-http, push schema, push env vars.

### During execution

The script displays in real time:
- `▸ <step>` when it starts each sub-step
- `✅ <result>` at the end of each one
- `⚠️ <warning>` for non-blocking warnings (Neon quota near limit, name conflict)
- At the end (success OR failure), a structured **handoff banner**
- As the last line on success, a parseable JSON object: `{"success":true,"projectId":"...","host":"...","projectName":"..."}`

Let the output stream through live (no `> /tmp/...`, no capture). The user wants to see the progress.

### If success

Mark the step ✅, capture `projectId` and `host` from the final JSON, and go to Step 5.

If the banner contains warnings (e.g. `NEON_QUOTA_NEAR_LIMIT`, `NEON_PROJECT_NAME_CONFLICT`), mention them in the final summary but don't block - the project is provisioned.

### If failure

1. **Read the detailed error**: just above the handoff banner.
2. **Identify the failed step** in the banner (`❌ Failed at: <step>`). The name maps 1:1 onto a function in the script - open `setup-db.mjs` and read the function to understand.
3. **Diagnose**:
   - `preflight` failed then usually a missing `NEON_API_KEY` or no Next.js / no Drizzle in the project then go back to Step 1.
   - `listProjects` or `createProject` failed then a Neon API error. Often a quota exceeded (show the error message as-is to the user) or an expired API key.
   - `installDriver` failed then a pnpm error (network, registry). Retry by hand: `cd <WEB_DIR> && pnpm add @neondatabase/serverless`.
   - `swapDriver` failed then T3 may have moved `src/server/db/index.ts`. Patch the file manually, taking inspiration from the template in `setup-db.mjs` step `swapDriver`.
   - `pushSchema` failed then the schema probably has a problem (table already exists with another prefix, migration conflict). Read the drizzle-kit error, fix the schema, and retry: `cd <WEB_DIR> && DATABASE_URL='<connection-uri>' npx drizzle-kit push`.
   - `pushEnvVars` failed then the Neon project is provisioned + schema pushed, but the env var is not in `.env`/Vercel. Get the connection URI from the script state (visible in the logs) and invoke `_push-env-vars DATABASE_URL=<uri>` manually.
4. **Continue** the remaining steps manually, taking inspiration from the script's functions.

---

## Step 5 - Update CLAUDE.md

Invoke `_update-claude-md` with:
- `stack`: `- **Database**: Neon PostgreSQL`
- `commands`:
  - `- \`pnpm db:push\` - Push schema to Neon`
  - `- \`pnpm db:studio\` - Open Drizzle Studio`
- `env-vars`: `- \`DATABASE_URL\` - Neon PostgreSQL connection string`
- `conventions`:
  - `- Data: Optimistic UI - the interface updates reactively right away, the database syncs in the background. Never block the UI waiting for the server response.`
  - If `IS_MONOREPO=yes`, also add: `- DB: import from \`@<PROJECT_NAME>/db\`, never a relative cross-app path.`

The helper is idempotent - re-running `/add-db` won't duplicate existing lines.

---

## Step 6 - Enable automatic backups [MANDATORY - NEVER SKIP]

🚨 **This step is mandatory.** You absolutely must invoke `add-backup-db` here, even when `/add-db` is called from `/bootstrap` or another skill. **Skipping this step = serious bug**: the user loses their data if the DB crashes, without knowing it. An internal audit on 2026-05-16 showed that ~36% of bootstraps forgot this step before we made it explicit - it's the main source of potential data loss in Hypervibe.

The `add-backup-db` skill is idempotent (no-op if the project is already registered) - so there's no reason to skip "just to be safe".

```
Invoke skill: add-backup-db
With args: --quiet
```

**Capture the status returned by add-backup-db** (the caller, i.e. you, must decide what to put in the final summary based on this status):

| Returned status | What to do in the summary |
|---|---|
| `ok:created` (worker created for the first time + project registered) | Add the line "✅ Automatic backups enabled" + details (see Step 8) |
| `ok:added` (worker already existed, project added to the list) | Add the line "✅ Automatic backups enabled" + details |
| `ok:already-registered` (project already in the list, no-op) | Add the line "✅ Automatic backups already active for this project" |
| `skipped:no-neon-key` (Neon API key missing, quiet mode then couldn't prompt) | Add the line "⚠️ Automatic backups not enabled: your Neon API key is missing. Run `/start` to configure it, then `/add-backup-db` to enable backups on this project." |
| `skipped:cloudflare-missing` (no CF token) | Add the line "⚠️ Automatic backups not enabled: Cloudflare is not configured on your machine. Run `/start` then `/add-backup-db` when you're ready." |
| `error:*` | Add the line "⚠️ Automatic backups not enabled (technical error). You can retry with `/add-backup-db`." + do not block the overall summary |

**NEVER block the `/add-db` flow** on a backup-activation failure. The DB is in place, that's the main topic - the step must have run, but its result (success or failure) must not crash the skill.

### Step 7 - Mandatory self-check

🛑 **Before moving to Step 8**, programmatically verify that step 6 actually took effect. This is the safety net that catches cases where the `add-backup-db` invocation was forgotten, executed wrong, or silently failed.

```bash
# Get the Neon project ID of the current project (look it up via the Neon API by matching the project's DATABASE_URL)
PROJECT_ID="<neon-project-id-of-the-project>"

# Check that this project ID appears in the shared worker's config
if [ -f ~/.db-backup-worker/wrangler.toml ]; then
  if grep -q "\"$PROJECT_ID\"" ~/.db-backup-worker/wrangler.toml; then
    echo "OK:backup-registered"
  else
    echo "FAIL:backup-not-registered"
  fi
else
  echo "FAIL:worker-config-missing"
fi
```

**Interpretation**:

- `OK:backup-registered` then all good, go to Step 8.
- `FAIL:backup-not-registered` then step 6 failed to register the project. **Re-invoke** `add-backup-db --quiet` one more time. If it fails again, capture the returned status (Step 6 table above) and add the matching warning to the final summary.
- `FAIL:worker-config-missing` then either the project is the very first one on this machine (in which case `add-backup-db` should have created the worker), or the step 6 status was `skipped:cloudflare-missing` or `error:*`. The warning in the summary is enough, don't retry in a loop.

The goal: we accept that there are cases where the backup can't be enabled (no Neon key, no Cloudflare token), but we don't accept **forgetting to enable it** when all the ingredients are there.

---

## RGPD - Privacy policy

Add Neon to the project's RGPD subprocessor registry:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/update-privacy-policy.mjs" --add neon
```

The helper is idempotent. If the `politique-de-confidentialite/page.tsx` page exists (created by `/bootstrap`), it updates automatically from the registry. If the page doesn't exist (pre-bootstrap project), only the registry is created - `/rgpd-audit` can generate the page retroactively.

---

## Step 8 - Summary

Tell the user:
- Neon database `<project-name>` is provisioned and connected (host: `<host>`)
- Drizzle ORM is wired onto the Neon serverless driver (edge-compatible)
- The schema is pushed and the connection verified
- `DATABASE_URL` is in the local `.env` and on Vercel (production / preview / development)
- Commands: `pnpm db:push` to push schema changes, `pnpm db:studio` to browse the data
- Neon free tier: 0.5 GB storage/project, 100 CU-hours/month, automatic scale-to-zero
- **Backup line** (based on the status captured in Step 6):
  - If active: *"✅ Automatic backups enabled - a new one every 2 weeks, we keep the 2 latest + 3 historical ones spread over the last 9 months."*
  - If not enableable: see the Step 6 table

If any warnings were raised by the script (`NEON_QUOTA_NEAR_LIMIT`, `NEON_PROJECT_NAME_CONFLICT`, etc.), mention them here.
