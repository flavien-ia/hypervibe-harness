---
name: migrate-workers
description: "One-time migration for users coming from a Hypervibe version older than 2.5. Consolidates the old separate background mechanisms (db-backup, quota-monitor, cron-dispatcher, each a loose Cloudflare worker) into the new unified shared worker hypervibe-jobs (one worker, one cron slot, git-versioned registry). Self-detecting and safe: if there is nothing legacy on the machine it reports 'already up to date' and does nothing. Nothing is deleted without explicit consent, and the old mechanisms keep working until the new one is deployed and verified. This is a transitional skill and will be removed in a future version once everyone has migrated."
argument-hint: ""
user-invocable: true
allowed-tools: Bash, Read
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; uses wrangler + the vault."
---

# Migrate Workers - Consolidate the old background mechanisms into the shared clock

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- Show progress as a short natural-language checklist (in-progress and done states).
- NEVER ask the user to type shell commands. You run everything; they only answer questions.

## What this does (say it simply if asked)

Older Hypervibe versions could set up to three separate background mechanisms on the user's Cloudflare account: database backups, quota alerts, and scheduled task triggers. Version 2.5 unifies all three into ONE mechanism ("your shared clock", technically `hypervibe-jobs`), living in a small git-versioned folder, using a single Cloudflare cron slot in total. Same schedules, same behavior, safer bookkeeping, and it frees up to 2-3 slots.

## Safety rails (absolute)
1. NOTHING legacy is modified or deleted until the new mechanism is deployed AND verified with a real run.
2. Decommission (Step 6) happens ONLY after explicit user consent, never silently.
3. Every script here is idempotent: on any failure, fix the cause and re-run. The legacy mechanisms keep working the whole time.

---

## Step 1 - Detect what needs migrating (do this FIRST, before anything)

```bash
for d in ~/.db-backup-worker ~/.quota-monitor-worker ~/.cron-dispatcher; do
  [ -f "$d/wrangler.toml" ] && echo "LEGACY: $d"
done
[ -f ~/.hypervibe-jobs/jobs.js ] && echo "UNIFIED: present"
```

- **No `LEGACY:` line** then there is nothing to migrate. Tell the user, in one friendly sentence, that everything is already up to date (fresh install, or already migrated) and STOP here. Do not run any of the following steps. (This is the expected result for anyone who never used a pre-2.5 version.)
- **One or more `LEGACY:` lines** then continue. List them to the user in plain words (which of the three old mechanisms they have) and tell them you will consolidate them, safely, step by step.

## Step 2 - Prerequisites

The migration reads the Cloudflare token (and the Neon/Brevo keys, for backups/quota) from the vault. Ensure it is unlocked (follow **`_ensure-vault`**): `node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" status` then if `locked`/`expired`, run `launch.mjs unlock` (tell the user a window is opening for their master password); if the vault does not exist, delegate to `_add-keyring`. Then load the Cloudflare env + PATH:

```bash
eval "$(node "${CLAUDE_SKILL_DIR}/../../scripts/wrangler-env-init.mjs")"
```

## Step 3 - Provision the unified shared clock (idempotent)

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/shared-worker/ensure.mjs"
```

Parse the JSON. Expect `ok: true` (`status: "created"` or `"already_present"`). Keep `workerUrl`. On `ok: false`, stop and explain the `howTo` in plain words (usually: run `/start` to enable Cloudflare).

## Step 4 - Carry over the legacy configurations

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/shared-worker/migrate-live.mjs" --put-secrets
```

Parse the JSON:
- `migrated` - what was carried over (backup targets, quota config, scheduled pings). Recap it in plain words.
- `skipped` entries about mechanisms the user does not have are NORMAL, not errors.
- `uploadedSecrets` / `missingSecrets` - with `--put-secrets` the Neon/Cloudflare/Brevo keys are uploaded from the vault automatically. If anything remains in `missingSecrets`, follow the guidance in the output.
- `pingSecretsToReupload` (only when an old cron-dispatcher existed) - these secret VALUES cannot be read back from Cloudflare. For each name (e.g. `CRON_SECRET_MYAPP`), the value lives in the matching project's `.env` file under `CRON_SECRET`. If you know where that project is, read the value and upload it:
  ```bash
  cd ~/.hypervibe-jobs && printf '%s' "<value>" | npx wrangler secret put <NAME>
  ```
  Otherwise ask the user where that project's folder is. Until a secret is uploaded, that specific scheduled task is skipped with a harmless log line, nothing crashes. Tell the user which ones still need their key.

## Step 5 - Verify before touching anything legacy

```bash
ADMIN=$(node "${CLAUDE_SKILL_DIR}/../../scripts/_read-user-env.mjs" HYPERVIBE_JOBS_ADMIN_TOKEN)
curl -s -H "Authorization: Bearer $ADMIN" "<workerUrl>/status"
```

Check every migrated job is listed with the right schedule (`nextDue` populated). Then force a real run of ONE migrated job and verify its effect:

- **If backups were migrated**: `curl -s -X POST -H "Authorization: Bearer $ADMIN" "<workerUrl>/trigger?name=neon-backups"`, wait ~30 seconds, then verify via the Neon API that a fresh branch named `bk-<project>-r-<today>` exists on at least one target (Neon key from the vault). This is the strong proof.
- **If only scheduled tasks were migrated**: trigger one ping job the same way and confirm the target endpoint answered (or watch `cd ~/.hypervibe-jobs && npx wrangler tail` while triggering).

Do not continue until a verification passes. If it fails, say so honestly, LEAVE the legacy mechanisms in place (they still work), and troubleshoot.

## Step 6 - Decommission the old mechanisms (with explicit consent)

Show the user what will be removed and why it is now safe (the shared clock is deployed and verified; this frees their Cloudflare slots). Ask for an explicit yes. Then run the exact commands from the migration output's `decommission_after_verification` (a worker deletion in each legacy folder), and ARCHIVE the folders rather than deleting them:

```bash
# for each legacy folder that existed (uses today's date):
D=$(date +%Y-%m-%d)
[ -d ~/.db-backup-worker ] && mv ~/.db-backup-worker ~/.db-backup-worker-decommissioned-$D
[ -d ~/.quota-monitor-worker ] && mv ~/.quota-monitor-worker ~/.quota-monitor-worker-decommissioned-$D
[ -d ~/.cron-dispatcher ] && mv ~/.cron-dispatcher ~/.cron-dispatcher-decommissioned-$D
```

Tell the user the archived folders can be deleted after a few healthy cycles (for example after the next 1st-or-15th backup run).

If the user prefers NOT to decommission yet: fine, stop here. Warn them that until they do, the old and new mechanisms both run (duplicate backups each cycle, and the freed Cloudflare slots stay occupied), and they can come back and run `/migrate-workers` again to finish.

## Step 7 - Final recap (plain words)

Summarize: what was migrated, what was verified (with the concrete proof, e.g. "a fresh backup was created a minute ago"), how many Cloudflare slots were freed, where the shared clock lives now (`~/.hypervibe-jobs/`, versioned and safe), and how to interact with it from now on: just ask Claude ("show my scheduled tasks", "run a backup right now", "change the quota alert threshold"). No further action is needed unless some `pingSecretsToReupload` remain.
