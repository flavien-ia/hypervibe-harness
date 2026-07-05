---
name: delete-project
description: "Cleanly deletes a Hypervibe project and all of its cloud infrastructure - Vercel, Neon, Cloudflare R2 (global + EU), Workers, DNS, db-backup, scheduled crons on the shared worker, Stripe webhook, Render services, OAuth clients, Upstash, etc. First, it displays a BIG warning and asks for a double confirmation (irreversible action). It then performs a COMPLETE inventory, also scanning environment variables to detect third-party services outside the hypervibe stack that might be connected (OpenAI, Mapbox, Sentry, etc.). At the end, it gives the user the paths (not the commands) of the folders to delete via Windows Explorer. Use when the user says \"delete project X\", \"completely clean up X\", \"/delete-project X\", \"clean up project X\", or wants to decommission a project."
allowed-tools: Bash Read Edit Write Glob AskUserQuestion TodoWrite
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Delete Project - Complete decommissioning

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You delete a Hypervibe project and **all** of its associated cloud infrastructure. The user is **non-technical**: no commands for them to type, no bare jargon, file paths to open in Windows Explorer rather than `rm -rf`.

The skill relies on 3 scripts that do the heavy lifting:

- **`scripts/delete-project/discover-resources.mjs`**: Phase 1 (inventory). Scans 17 surfaces in parallel (Vercel, Neon, R2, DNS, crons of the shared worker, env vars, etc.). Returns 1 structured JSON. ~3-5 sec.
- **`scripts/delete-project/execute-deletions.mjs`**: Phase 3 (execution). Takes the inventory + the scope chosen by the user, deletes in parallel where it is safe. Returns a {deleted, failed, skipped} report.
- **`scripts/delete-project/db-backup-remove-target.mjs`**: sub-script for the surgical edit of the shared `db-backup` worker.

Your role = orchestrate the confirmations, validate the scope, present things nicely, never hand-code what the scripts already handle.

---

## Phase 0 - Identify the project + BIG WARNING + double confirmation

### 0.1 Identify the project

If the user did not provide the name (`/delete-project <name>` or *"delete cool-trattoria"*), ask for it **before** displaying the warning - otherwise the warning will be generic.

If the name is ambiguous ("art", "site", "blog"), confirm: *"Do you want to delete the exact project `X`? I will look everywhere for resources named `X` or `X-*`."*

### 0.2 Display the warning (mandatory, never skippable)

```
╔══════════════════════════════════════════════════════════════╗
║  ⚠️  ⚠️  ⚠️    WARNING - IRREVERSIBLE ACTION    ⚠️  ⚠️  ⚠️    ║
╚══════════════════════════════════════════════════════════════╝

I am about to PERMANENTLY delete the project `<PROJECT_NAME>` and all
of its infrastructure:

 • The database and ALL its data (customers, orders,
   bookings, uploaded photos, user accounts...)
 • The automatic backups (they live in the same database)
 • The deployed site and its custom URL
 • The stored files (photos, documents, avatars)
 • Any paid subscriptions possibly linked to it
   (Stripe, Render, Upstash, etc.)

🔴  This is IRREVERSIBLE.
🔴  Nothing can be recovered after deletion.
🔴  If the project contains real data, take a manual backup first.
```

### 0.3 Offer an upfront backup (safety net)

**Even before the double confirmation**, explicitly offer the user to take a snapshot of the project. Display:

> 💡 **A tip before continuing**: do you have a complete backup of the project? If not, I can make one right now - it will create a zip with: code + Git history, database, env variables, R2 content, Claude memory, configs. You will have a safety net in case you change your mind or need to recover some data later.

Use `AskUserQuestion`:
- Question: "Take a backup of the project right before deleting it?"
- Options:
  - `Yes, do the snapshot now (recommended)`
  - `No, I already have a recent backup`
  - `No, I want to delete without a backup`

→ If **"Yes, do the snapshot now"**: **run inline** the snapshot script (without leaving the `/delete-project` skill). See the block below. Once the snapshot has completed successfully, continue with 0.4.
→ If **"No, already backed up"** or **"No, without a backup"**: continue directly with 0.4.

#### If a snapshot is requested: run it inline

First ask, via `AskUserQuestion`, "Include the Cloudflare R2 content (can be heavy)?" - options `Yes` / `No, skip R2`. No need to ask again for the project (we already have it) or the output folder (the default `~/Dropbox/Download/` is fine for this case).

Then run:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/save-project/build-snapshot.mjs" \
  --project "<PROJECT_NAME>" \
  --project-dir "<detected-project-path>" \
  [--skip-storage if the user said no]
```

While it runs, relay the script's `[step] status` logs on stderr to the user (one `↳ ...` per step that finishes).

At the end, the script writes `{status, zipPath, zipSize, ...}` to stdout. Capture it, display the recap:

> ✅ **Snapshot created**: `<zipPath>` (`<zipSize>`)
>
> The zip contains **secrets in plain text**: treat it as a confidential document. We can now continue with the deletion.

**If the snapshot fails** (script exit 1 or `status: "error"`): **stop the `/delete-project` skill** and warn the user. We never delete without a successful backup when the user has explicitly requested one. Display the error and offer: (a) re-run `/save-project` manually to diagnose, (b) re-run `/delete-project` afterwards saying that they already have the backup, (c) abort.

### 0.4 Double confirmation via `AskUserQuestion`

**Question 1**: "Do you confirm that you want to **permanently delete** the project `<PROJECT_NAME>` and that you accept the irreversible loss of all of its data?"
- Options: `Yes, I confirm` / `No, just pause it` / `No, cancel`

→ If **"pause it"**: explain briefly (suspend the Vercel project, put the Neon DB to sleep) then **stop the skill**.
→ If **"cancel"**: stop the skill.
→ If **"Yes"**: continue with Q2.

**Question 2**: "Final confirmation: type `<PROJECT_NAME>` exactly to confirm."
- Single option "I will type the name" + Other. The Other answer must match exactly (case-sensitive). Otherwise, refuse and stop.

**Under NO pretext should you proceed to the scan or the execution before these two explicit confirmations.** Even if the user wrote "delete everything without asking me again", the double-check is intentional.

---

## Phase 1 - Inventory (1 script call)

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/delete-project/discover-resources.mjs" \
  --project "<PROJECT_NAME>" \
  --project-dir "<detected-project-path>" > /tmp/delete-project-inventory.json
```

The script scans the 17 surfaces in parallel: Vercel, Neon (REST API), Cloudflare Workers / R2 (global+EU) / DNS / Email Routing, db-backup worker (BACKUP_TARGETS), cron ping jobs of the shared `hypervibe-jobs` worker (matched by their `project` field in the registry), Render, Stripe (webhooks + products), Upstash, env vars (Vercel pull + diff whitelist) → detection of third-party services (Sentry, PostHog, Mapbox, OpenAI, etc.), local folder + package.json, Claude memory, GitHub repo, Google/GitHub OAuth via present vars.

The resulting JSON has the form:

```json
{
  "project": "cool-trattoria",
  "scannedAt": "...",
  "vercel":       { "found": true, "raw": "..." },
  "neon":         { "found": true, "projects": [{ "id": "...", "name": "..." }] },
  "workers":      { "found": true, "workers": [...] },
  "r2":           { "found": true, "buckets": [{ "name": "...", "jurisdiction": "eu" }] },
  "dns":          { "found": true, "records": [...] },
  "dbBackup":     { "isTarget": true, "entry": {...} },
  "cronJobs":     { "found": true, "jobs": [{ "name": "cool-trattoria-rapport-hebdo", "cron": "0 8 * * 1", "url": "https://..." }], "secretName": "CRON_SECRET_COOL_TRATTORIA" },
  "render":       { "found": false },
  "stripe":       { "webhooksFound": true, "webhooks": [...] },
  "upstash":      { "found": false },
  "emailRouting": { "found": true, "rules": [...] },
  "envVars":      {
    "sources": ["vercel-production", "local-.env"],
    "thirdPartyDetected": [
      { "envVar": "SENTRY_DSN", "service": "Sentry", "label": "...", "actionUrl": "...", "instructions": "..." }
    ],
    "unknownUnclassified": [],
    "hasGoogleOAuth": true,
    "hasGitHubOAuth": false
  },
  "localDir":     { "exists": true, "path": "/path/to/cool-trattoria", "dependencies": [...] },
  "memory":       { "files": [...] },
  "github":       { "exists": true, "url": "..." }
}
```

Any section may also carry an **`excluded`** array: resources whose name matched but that were re-attributed to a **more specific sibling project** (`street-cool` when deleting `street`), or recognized as **shared Hypervibe infrastructure** (the `hypervibe-jobs` worker). They are NEVER deleted; surface them in section 2.4 with their `excludedReason`.

Read this JSON and move on to Phase 2.

---

## Phase 2 - Present the inventory + validate the scope

Display a clear recap in 3 distinct sections, with a non-tech communication tone:

### 2.1 Section "🔵 Hypervibe infrastructure (I can delete it automatically)"

Markdown table listing each category where `found === true` (or `isTarget === true` for dbBackup, `webhooksFound === true` for stripe). For each row: resource (in plain language, e.g. "Vercel (the site's host)"), identifier, planned action.

### 2.2 Section "🟠 Third-party services detected (to delete by hand)"

For each entry in `envVars.thirdPartyDetected`: name of the service with its label (plain language), how it was detected (env var), URL to open, short instructions. If the list is empty, say so clearly: *"No third-party service detected outside the Hypervibe stack."*

### 2.3 Section "🟡 Manual accounts (never automatable)"

Include conditionally:
- If `envVars.hasGoogleOAuth === true` → Google Cloud Console OAuth action + entire GCP project
- If `envVars.hasGitHubOAuth === true` → GitHub OAuth App action
- Always: deletion of the GitHub repo if `github.exists`
- Deletion of the local folder if `localDir.exists` (to be done via Windows Explorer)

### 2.4 Section "⚪ Deliberately left untouched"

- Brevo / Resend (shared)
- Parent Cloudflare zones (the subdomains/DNS are deleted, not the parent zone)
- Stripe products (if found but rarely scoped to the project)
- Every `excluded` entry from the inventory sections (resource attributed to a sibling project, or shared Hypervibe infrastructure like the `hypervibe-jobs` worker) - list each with its reason in plain language

### 2.5 Mandatory scope question

Ask via `AskUserQuestion`:

> "Do I delete **everything** listed under 🔵 (auto infrastructure), or do you want to **keep** some resources?"

Options (multi-select via `multiSelect: true`):
- `Delete everything` (selects all categories)
- `Keep DB` (excludes `neon` + `db-backup` from the scope)
- `Keep DNS` (excludes `dns` from the scope)
- `Keep local folder` (already included by default since the sandbox blocks it)

**Do not proceed until the scope is explicitly validated.** The Phase 0 confirmations are about the **principle**. Phase 2 confirms the **exact inventory**.

---

## Phase 3 - Execution (1 script call)

Build the `scope` JSON array from the Phase 2.5 choices. Possible categories:

```
["vercel","neon","r2","workers","dns","db-backup","cron-jobs","render","stripe-webhooks","upstash","email-routing","memory"]
```

If the user chose "Delete everything", pass `["all"]`. Otherwise remove the categories they want to keep.

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/delete-project/execute-deletions.mjs" \
  --inventory /tmp/delete-project-inventory.json \
  --scope '["all"]' > /tmp/delete-project-report.json
```

Create a todo list with one entry per scope category. Mark "in_progress" before the run and "completed" after (a single script run ⇒ you mark them within 2 seconds max).

The script runs:
- **In parallel**: Vercel, R2 (both jurisdictions), Workers, DNS, Render, Stripe webhooks, Upstash, Email Routing
- **Sequentially afterwards**: Neon → db-backup (needs the Neon projectId to remove the target) → cron-jobs (same shared-worker registry as db-backup, never concurrent) → Memory (last)

The resulting JSON:

```json
{
  "project": "cool-trattoria",
  "deleted": {
    "vercel":  { "status": "deleted", "name": "..." },
    "neon":    { "status": "deleted", "results": [...] },
    ...
  },
  "failed":  { "<category>": { "status": "failed", "error": "..." } },
  "skipped": { "<category>": { "status": "skipped", "reason": "..." } }
}
```

---

## Phase 4 - Final report

Display a recap to the user, plain language, with the following structure:

### 4.1 "✅ Deleted automatically"
Table of the `report.deleted` entries translated into accessible language.

### 4.2 "🟡 To do yourself via Windows Explorer / the browser"

Ordered list with click-by-click instructions:

1. **Delete the local folder** (if `localDir.exists`)
   - Path: `C:\DEV\<PROJECT_NAME>`
   - Action: Open Windows Explorer → right-click → Delete (or Shift+Delete)
   - Note: *"I would have liked to do it automatically, but my sandbox blocks deleting folders under C:\DEV\ for your safety."*

2. **Delete the GitHub repo** (if `github.exists`)
   - URL: `https://github.com/<your-github-account>/<PROJECT_NAME>/settings`
   - Action: scroll all the way down → Danger Zone → "Delete this repository" → retype the repo name

3. **Delete the Google OAuth client** (if `envVars.hasGoogleOAuth === true`)
   - URL: `https://console.cloud.google.com` → select the project → APIs and services → Credentials
   - Action: find the OAuth client `<PROJECT_NAME>-nextauth` (or similar) → trash

4. **Delete the entire GCP project** (optional, if Google OAuth is present)
   - URL: `https://console.cloud.google.com` → IAM → Manage resources
   - Action: check `<PROJECT_NAME>` → Delete (30-day grace period)

5. **Detected third-party services** (for each entry in `envVars.thirdPartyDetected`):
   - Name of the service with label
   - Exact URL (from `actionUrl`)
   - Precise instructions (from `instructions`)

### 4.3 "ℹ️ Deliberately left untouched"
- Brevo / Resend: shared
- Parent Cloudflare zones: shared
- Stripe products (if found): risk of being used by other projects

### 4.4 Closing note
> "There you go, the automatable cloud infrastructure is cleaned up. You still have the X manual actions above to finish the cleanup. No rush - you can do it at your own pace. If you want, I can stay here and guide you step by step when you click."

---

## Non-tech communication rule

- Technical terms always paired with plain language:
  - "Vercel (the site's host)"
  - "Neon (the database)"
  - "R2 (the file storage)"
  - "Worker `db-backup` (the robot that does the automatic backups)"
- For manual actions, always give: **where to click / what to open + why**. Never a shell command for the user.
- For reports, markdown tables with 3 distinct sections (✅ / 🟡 / ⚪).

---

## Known pitfalls (edge cases)

### Vercel CLI
`vercel project rm` has no `--yes` flag. The script uses `echo y | vercel project rm <name>`. If it fails, check that you are properly `vercel login`.

### R2 jurisdictions
An EU bucket is not visible via `wrangler r2 bucket list` without `-J eu`. The script scans both automatically. Names can collide across jurisdictions - the script distinguishes them via `jurisdiction: "global"|"eu"`.

### Sandbox `rm -rf` on C:\DEV\
The Claude Code classifier often blocks `rm -rf` under `C:\DEV\` (deny rule), even with the user's explicit authorization. Trying via PowerShell or Node.js is also detected. **Do not try to work around it** - give the path to the user in the final report so they delete it via Windows Explorer.

### Shared db-backup worker
`~/.db-backup-worker/wrangler.toml` is shared across **all** Neon projects. The `db-backup-remove-target.mjs` script does a surgical edit (removes ONLY the project's entry + redeploys). If the redeploy fails, it rolls back the toml automatically.

### Shared hypervibe-jobs worker (cron pings)
Scheduled tasks created by `/add-cron` live in the same registry as the unified backups (`~/.hypervibe-jobs/jobs.js`) as jobs of kind `ping`. Without cleanup, the worker keeps hitting a dead URL at every schedule after the project is gone. Two subtleties:
- **Matching**: since 2026-07-05 the registry name is composite (`<project>-<task>`), so the scan matches jobs by their `project` field (with the per-project secret name as fallback for older entries), never by name. Each job is then removed by its registry name via the shared-worker registry script: the jobs of the other projects are untouched.
- **Worker secret**: once no registry job of the project remains, the execution also deletes the `CRON_SECRET_<PROJECT>` secret from the shared worker (Cloudflare API). If a removal failed, the secret is kept (reported as `kept` in the result) - safe to retry with scope `["cron-jobs"]`. The app-side `CRON_SECRET` env var disappears with the Vercel project.

### Neon backups
The backups (`backup-*` branches) live **in the Neon project itself**. When you delete the project (Phase 3, category `neon`), the backups go with it. No separate action.

### Google OAuth
No MCP / CLI lets you delete a Google Cloud Console OAuth client. Always manual (URL provided in Phase 4.2).

### Detected third-party services
The env vars scan (Phase 1, env vars sub-step) is **conservative**: any non-whitelisted var is flagged. Better a false positive (the user says "oh no, that one is fine") than a false negative (a third-party service keeps billing). The whitelist lives in `templates/delete-project/known-env-vars.json`. To add a new var to the standard stack, edit this file.

### Stripe products
The **webhooks** are safe to delete (1 per project, URL clearly linked). The **products** are rarely scoped per project → the script does NOT delete them automatically, they are merely mentioned in the report for a manual decision.

### Ambiguous names
Matching is word-boundary based, not substring based: deleting `art` does not match `smart-app`, and the shared background workers (`hypervibe-jobs`, legacy `db-backup`) are excluded by name whatever the project is called. When several projects share a prefix (`street` and `street-cool`), every resource that also matches a **more specific known project** (known = shared-worker registry, sibling folders of the project dir, Neon/Vercel project lists) is automatically moved to the section's `excluded` array and left untouched. Limit: a sibling project with zero local footprint (no folder, no registry job, not visible in the Neon/Vercel lists) cannot be recognized, so its derived resources would still show up in the inventory. **The Phase 2 review stays the final safety net**: read the resource names carefully before validating the scope, and when in doubt ask the user.

### `.env.delete-check` temp file
The Phase 1 script temporarily creates a `.env.delete-check` file to parse the var names (NOT the values). It deletes it systematically at the end, even on error. Check in the report that it does not exist in the local project after the run.

### Brevo / Resend
Shared by default (a single `BREVO_API_KEY` shared across all projects). The script does not touch anything on them. If the sender configured in the project's vars (`BREVO_SENDER_EMAIL` / `RESEND_SENDER_EMAIL`) is **different** from the standard address, flag it in Phase 4.2 - a dedicated sender may have been validated on Brevo/Resend.
