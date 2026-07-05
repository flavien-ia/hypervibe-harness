# Hypervibe - Migration to the unified shared worker (v2.5)

> **FR** : Vous venez de mettre à jour le plugin Hypervibe ? Donnez simplement ce fichier à Claude Code (« lis MIGRATION.md et fais la migration ») : il s’occupe de tout, vous explique chaque étape, et ne supprime rien sans votre accord.
>
> **EN**: Just updated the Hypervibe plugin? Hand this file to Claude Code ("read MIGRATION.md and run the migration"): it takes care of everything, explains each step, and deletes nothing without your consent.

---

## Instructions for Claude Code

You are performing a one-time infrastructure migration for a Hypervibe plugin user. Read this entire file before acting.

### Communication
- Detect the user's language and ALWAYS reply in that language. Plain, non-technical words: say "your shared clock" (the mechanism that runs your scheduled tasks, database backups and quota alerts), not "worker" or "cron slot", unless you explain the term in passing.
- Announce the plan in 3 short lines before starting, then show progress as a small checklist.
- NEVER ask the user to type commands. You run everything; they only answer questions.

### What changed (context you may share, simply)
Older Hypervibe versions could create up to three separate background mechanisms on the user's Cloudflare account: `db-backup` (database backups), `quota-monitor` (quota alerts), and `cron-dispatcher` (scheduled pings for their projects). The new version unifies all three into ONE mechanism, `hypervibe-jobs`, which lives in a small git-versioned folder (`~/.hypervibe-jobs/`) and uses a single Cloudflare cron slot in total (it frees up to 2-3 slots). Same schedules, same behavior, safer bookkeeping.

### Safety rails (absolute)
1. NOTHING legacy is modified or deleted until the new mechanism is deployed AND verified.
2. Decommission (Step 6) happens ONLY after explicit user consent, never silently.
3. Every script below is idempotent: if anything fails midway, just fix the cause and re-run it. The legacy mechanisms keep working the whole time.

---

### Step 0 - Locate the new plugin scripts

```bash
find ~/.claude/plugins -type f -path "*hypervibe*" -path "*shared-worker*" -name "ensure.mjs" 2>/dev/null | head -3
```

Keep the folder containing `ensure.mjs` as `$SW` (e.g. `.../hypervibe/scripts/shared-worker`). If nothing is found, the user has not updated the plugin yet: explain how to update (reinstall the plugin from the marketplace, or re-import the new zip in Claude Desktop), then stop here.

### Step 1 - Detect what needs migrating

```bash
for d in ~/.db-backup-worker ~/.quota-monitor-worker ~/.cron-dispatcher; do
  [ -f "$d/wrangler.toml" ] && echo "LEGACY: $d"
done
[ -f ~/.hypervibe-jobs/jobs.js ] && echo "UNIFIED: already provisioned"
```

- **No LEGACY lines** -> nothing to migrate. Tell the user they are already clean (fresh install or already migrated), and stop here. If UNIFIED is also absent, no action needed either: the shared clock will be created automatically the first time a skill needs it.
- **One or more LEGACY lines** -> continue. List them to the user in plain words (which of the three mechanisms they have).

### Step 2 - Prerequisites

The scripts read the Cloudflare token (and the Neon/Brevo keys if backups/quota are migrated) from the user's key vault. Check the vault status the same way the plugin skills do (`vault.mjs status` in the plugin's `scripts/vault/`; if locked or expired, open the unlock window with `launch.mjs unlock` and tell the user a window is opening for their master password). Also run, from any directory:

```bash
eval "$(node "$SW/../wrangler-env-init.mjs")"
```

### Step 3 - Provision the unified shared clock

```bash
node "$SW/ensure.mjs"
```

Parse the JSON. Expect `ok: true` with `status: "created"` (or `"already_present"`). Keep `workerUrl`. On `ok: false`, stop and explain the `howTo` to the user.

### Step 4 - Migrate the legacy configurations

```bash
node "$SW/migrate-live.mjs" --put-secrets
```

Parse the JSON:
- `migrated` lists what was carried over (backup targets, quota config, scheduled pings). Recap it to the user in plain words.
- `skipped` entries about mechanisms the user does not have are NORMAL (not errors).
- `uploadedSecrets` / `missingSecrets`: with `--put-secrets` the Neon/Cloudflare/Brevo keys are uploaded from the vault automatically. If something remains in `missingSecrets`, follow the guidance in the output.
- `pingSecretsToReupload` (only when a legacy cron-dispatcher existed): these secret VALUES cannot be read back from Cloudflare. For each name (e.g. `CRON_SECRET_MYAPP`), the value lives in the matching project's `.env` file under `CRON_SECRET`. Ask the user where that project's folder is if you don't know, read the value, and upload it:
  ```bash
  cd ~/.hypervibe-jobs && printf '%s' "<value>" | npx wrangler secret put <NAME>
  ```
  Until a secret is uploaded, that specific ping is skipped with a harmless log line; nothing crashes.

### Step 5 - Verify before touching anything legacy

```bash
ADMIN=$(node "$SW/../_read-user-env.mjs" HYPERVIBE_JOBS_ADMIN_TOKEN)
curl -s -H "Authorization: Bearer $ADMIN" "<workerUrl>/status"
```

Check every migrated job is listed with the right schedule (`nextDue` populated). Then force a real run of ONE migrated job and verify its effect:
- If backups were migrated: `curl -s -X POST -H "Authorization: Bearer $ADMIN" "<workerUrl>/trigger?name=neon-backups"`, wait ~30 seconds, then verify via the Neon API that a fresh branch named `bk-<project>-r-<today>` exists on at least one target project (Neon key from the vault). This is the strong proof.
- If only pings were migrated: trigger one ping job the same way and check the target endpoint answered (or `cd ~/.hypervibe-jobs && npx wrangler tail` while triggering).

Do not continue until a verification passed. If it fails, say so honestly, keep the legacy mechanisms as they are (they still work), and troubleshoot.

### Step 6 - Decommission the legacy mechanisms (with consent)

Show the user what will be removed and why it is now safe (the unified clock is deployed and verified; this frees their Cloudflare slots). Ask for explicit confirmation. Then run the exact commands from the migration output's `decommission_after_verification` (a `wrangler delete` in each legacy folder), and archive the folders rather than deleting them:

```bash
mv ~/.db-backup-worker ~/.db-backup-worker-decommissioned-<date>        # if it existed
mv ~/.quota-monitor-worker ~/.quota-monitor-worker-decommissioned-<date> # if it existed
mv ~/.cron-dispatcher ~/.cron-dispatcher-decommissioned-<date>           # if it existed
```

Tell the user the archived folders can be deleted after a few healthy cycles (for example after the next 1st-or-15th backup run).

### Step 7 - Final recap (plain words)

Summarize: what was migrated, what was verified (with the concrete proof, e.g. "a fresh backup branch was created a minute ago"), how many Cloudflare slots were freed, where the shared clock lives (`~/.hypervibe-jobs/`, versioned), and how to interact with it from now on: just ask Claude ("show my scheduled tasks", "run a backup right now", "change the quota alert threshold").
