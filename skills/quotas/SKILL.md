---
name: quotas
description: "Gives an account-wide view of usage across every service in the stack (Neon, Cloudflare R2, Cloudflare Workers, Brevo, Resend, Vercel). For each metric it shows current usage vs the free-tier cap (or the detected plan), with a verdict emoji (green check / warning / red) and, when the pace allows it, a projection of the date the cap will be reached. Use when the user wants to know where they stand on their plans and anticipate an upgrade."
allowed-tools: Bash
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Quotas - Account-wide view of your plans

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You give the user a clear picture of **where they stand on each service of the Hypervibe stack**.

The deterministic code (parallel API calls to the 6 services) lives in `scripts/quotas-fetch.mjs`. This SKILL only:
1. Runs the script
2. Parses the returned JSON
3. Renders a readable table with emoji verdicts and trajectories
4. Mentions the service-specific notes (e.g. API limitations, per-project breakdown)

---

## Preflight - vault unlocked

`/quotas` reads several keys from the vault (Neon, Cloudflare, Brevo/Resend...) so first make sure it is unlocked (follow **`_ensure-vault`**): `node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" status` then if `locked`/`expired`, run `launch.mjs unlock`; if the vault does not exist, delegate to `_add-keyring`.

---

## Step 1 - Run the script

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/quotas-fetch.mjs"
```

The script returns JSON on stdout, typical duration 2-5 seconds (the 6 fetchers run in parallel).

**Typical output** (excerpt):

```json
{
  "fetchedAt": "2026-05-06T20:38:12.000Z",
  "billingCycle": {
    "monthStart": "2026-05-01T00:00:00.000Z",
    "monthEnd": "2026-06-01T00:00:00.000Z",
    "daysElapsedInMonth": 6,
    "daysRemainingInMonth": 25
  },
  "services": [
    {
      "service": "neon",
      "label": "Neon (Postgres)",
      "available": true,
      "metrics": [
        {"name": "Storage", "used": 0.247, "limit": 0.5, "unit": "GB", "pctUsed": 49.5, "scope": "account-month"},
        ...
      ],
      "note": null,
      "breakdown": [{"label": "hypervibe", "storageGB": 0.054, ...}, ...]
    },
    ...
  ],
  "selfHealing": { "resendKeyJustCreated": true }
}
```

If the script fails with a global `_error`, show the error clearly to the user and stop.

---

## Step 2 - Self-heal Resend (transparency)

If the JSON contains `selfHealing.resendKeyJustCreated === true`, it means a Resend full-access key was just created so we could read the quotas (done once, persisted at the User scope for future runs).

Briefly mention this to the user, **before the table**, and only the first time:

> 💡 *Note: I created a "read quotas" Resend key on your Resend account so I could see your usage. This key is stored locally, will not be regenerated, and has no effect on your ongoing sends.*

Otherwise (`false`), say nothing.

---

## Step 2 bis - Self-heal quota watch (silent)

Before rendering the table, check that the **quota watch job** is registered in the unified shared worker **`hypervibe-jobs`** (ONE Cloudflare Worker for all the account-wide scheduled jobs: cron pings, database backups, quota alerts). The job runs daily and sends an email (via Brevo) if a quota crosses its threshold - currently R2 storage at 9 GB out of the 10 GB free tier. It is a safety net in case the user has not re-run `/start` since the version that sets up this job.

⚠️ **Why a custom job and not the native Cloudflare alert**: the previous version used `billing_usage_alert` from Cloudflare's Notifications API, but (1) this feature is officially reserved for Pro+ plans and (2) the format of the `limit` field is ambiguous on free accounts - the first version triggered a false instant alert. The custom job works around both problems cleanly.

**(a) Ensure the shared worker is provisioned** (idempotent, fast when already deployed):

```bash
eval "$(node "${CLAUDE_SKILL_DIR}/../../scripts/wrangler-env-init.mjs")"
node "${CLAUDE_SKILL_DIR}/../../scripts/shared-worker/ensure.mjs"
```

JSON output on stdout: `{ ok, status: "created" | "already_present", dir, workerName, workerUrl, jobs, ... }`. If `ok: false` → skip step (b) and show the failure message below.

**(b) Ensure the quota job is registered**:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/shared-worker/register.mjs" --list
```

If the returned `jobs` array contains a job named `quota-monitor` → **say nothing**, the watch is in place. (To adjust the threshold or the recipient later, re-run the registration command below with the new values: same job name = update in place.)

If it does not, register it:

1. **Recipient** = the Cloudflare account email:
   ```bash
   CFTOK=$(node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" get CLOUDFLARE api_token)
   curl -s -H "Authorization: Bearer $CFTOK" https://api.cloudflare.com/client/v4/user
   ```
   → take `result.email`.
2. **Sender** = the first verified Brevo sender:
   ```bash
   BREVO_API_KEY=$(node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" get BREVO api_key)
   curl -s https://api.brevo.com/v3/senders -H "api-key: $BREVO_API_KEY"
   ```
   → take the first entry with `"active": true`. If there is none → skip the registration and show the "no verified sender" message below.
3. **Register** (also uploads the CLOUDFLARE_API_TOKEN + BREVO_API_KEY secrets, read from the vault):
   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/shared-worker/register.mjs" --kind quota --recipient <recipient> --sender-email <sender> --put-secrets
   ```
   Default threshold: 9 GB out of the 10 GB R2 free tier (override with `--r2-threshold-gb <N>`).

**User-facing messages** (this step stays silent on success, like before):

- Job already registered → say nothing.
- Job just registered (first time only) → mention discreetly **before the table**:
  > 💡 *Note: I set up a daily quota watch in your shared clock - the single Cloudflare Worker that runs all your account-wide scheduled jobs (registry in `~/.hypervibe-jobs/jobs.js`, git-versioned). It will email you via Brevo if you approach the 10 GB of the R2 free tier. Want a different threshold or recipient? Just ask - I re-register the job with the new values.*
- No verified Brevo sender → show **after the table** (right after the summary):
  > ⚠️ *To activate the quota alert, a verified Brevo sender is required. Verify one at https://app.brevo.com/senders (add your email, click the verification link you receive), then re-run `/quotas`. Not blocking - your current storage is at X%.*
- Provisioning or registration returned `ok: false` → show after the table, short, without blocking:
  > ⚠️ *The quota watch could not be set up: `<error>`. Re-run `/start` if needed.*

Never let the table display fail because of this step. It is a bonus, not a critical step.

---

## Step 3 - Render the table

### Emoji verdicts per metric

For each metric with `limit !== null` and `used !== null`:

| `pctUsed` | Emoji | Rationale |
|---|---|---|
| < 70 | ✅ | Comfortable |
| 70-90 | ⚠️ | Worth watching |
| > 90 | 🔴 | Cap close, action recommended |
| 100+ | 🚨 | Cap exceeded (paid account or overuse) |

For metrics without a `limit` (e.g. number of buckets, Vercel deployments) → emoji ℹ️ (informational).

### Table format

One table per service, or a global table with a "Service" column. Prefer **a global table**:

```
| Service | Metric | Used | Cap | % | Verdict |
|---|---|---|---|---|---|
| Neon | Storage | 0,247 GB | 0,5 GB | 49,5 % | ✅ |
| Neon | Compute | 12,1 h | 191,9 h | 6,3 % | ✅ |
| Neon | Active projects | 7 | 1 | - | 🚨 (paid account required) |
| Cloudflare R2 | Storage | 0,079 GB | 10 GB | 0,8 % | ✅ |
| ... |
```

**Number formatting**:
- Decimals: follow the user's locale (e.g. French comma `0,247` instead of `0.247`)
- Large values: with a separator (`1 119` ops, `10 000 000` ops)
- Readable units: `GB`, `h`, `emails`, `requests`, `ops`, `deploys`, `projects`

### Per-project breakdown (if provided)

If a service has a non-null `breakdown` **AND** the cap is more than 70% used: show a small sub-table right after the main table, to show **which project dominates the usage**. E.g.:

> Neon detail per project (by storage usage):
> - hypervibe: 0,054 GB · 5,1 h compute
> - hypernewsletter: 0,038 GB · 2,9 h compute
> - ...

If nothing is in the ⚠️ or 🔴 zone, do not show the breakdown (useless info).

### Trajectory (if relevant)

For each metric with `scope: "account-month"` and `pctUsed > 50`:
- Compute the current pace: `used / billingCycle.daysElapsedInMonth` = per day
- Project: `daysToReachLimit = (limit - used) / rate`
- If the projection exceeds the cap before the end of the cycle (`daysToReachLimit < daysRemainingInMonth`), show at the bottom of the table:

> 📈 At the current pace, **Neon Storage** would reach the cap around May 22 (before the reset on June 1).

Do not project for `account-day` metrics (not very relevant on a one-day scale).

### Notes per service

Each service with a non-null `note` → show the note in italics under its first table row, prefixed with `↳`. Examples:
- Vercel: `↳ On the Hobby plan, bandwidth and function-time are not exposed via API. See [dashboard]...`
- Brevo: `↳ Detected plan: free (300 emails/day)`
- R2 (analytics unavailable): `↳ R2 analytics not available (account too recent)`

### Unavailable services

If `available === false`, show the row with just `↳ ⚠️ <note>` (no metrics). If all services are unavailable, tell the user to re-run `/start`.

---

## Step 4 - Global verdict + recommendations

Under the table, a short **summary line**:

- No ⚠️/🔴 → "Everything is in the green. You can keep going without worry."
- At least one ⚠️ → "X service(s) worth watching: <names>. Not urgent but check the breakdown if available."
- At least one 🔴 → "X cap(s) close to being reached: <metrics>. Recommend [plan upgrade / archiving / migration] depending on the service."
- A 🚨 (overage) → explain what it means (paid account already running, or overuse to fix).

If relevant, **propose a concrete action** tied to a Hypervibe addon:
- R2 storage cap close → *"You can run `/clean` to identify old forgotten files on R2"*
- Neon storage cap close → *"You can move to a paid Neon plan (Pro from $19/month for 10 GB) or archive data via `/clean`"*
- Resend monthly cap close → *"Resend Pro at $20/month (50k emails/month) - or Brevo free up to 9k emails/month"*

Never invent an addon that does not exist. If there is nothing to propose, just give the info.

---

## Step 5 - Response format

Recommended structure:

```markdown
## 📊 Your quotas - status on May 6 2026 (day 6/31 of the cycle)

[Resend self-heal note if applicable]

| Service | Metric | Used | Cap | % | Verdict |
|---|---|---|---|---|---|
| Neon | Storage | 0,247 GB | 0,5 GB | 49,5 % | ✅ |
↳ *(Brevo note if present)*
| ... |

[optional per-project breakdown for services in ⚠️/🔴]

[summary line + actionable recommendations]
```

No needless technical jargon. No "API endpoint", "GraphQL", "rate limit". The target user is not a developer.

---

## Errors and fallback

- **Script timeout** (>30 s): very unlikely (each fetcher has its own 10s timeout) but if it happens → announce "Sorry, I couldn't reach some services in time. Try again in a minute."
- **All services failed**: probably a network issue or missing tokens → advise `/start`.
- **Resend self-heal failed** (Resend key missing from the vault / vault locked): for the Resend service show `↳ ⚠️ Store your Resend key in the vault (or unlock it) then re-run /quotas` and continue for the others.

Never block the display of the other services if a single one fails. The script's `Promise.allSettled` guarantees you always receive usable JSON.
