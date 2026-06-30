---
name: rotate-secret
description: Replace a secret (API key, OAuth credential, generated token) safely in an existing project. Lists the rotatable secrets, points the user to the right provider dashboard with click-by-click instructions, captures the new value (or auto-generates it for self-managed secrets), and updates everywhere it lives - local .env and Vercel (production and preview). Use when a secret has leaked, when an employee leaves, after suspected compromise, or for periodic rotation.
argument-hint: "[secret name (optional)]"
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---


## ⚠️ Before any call to `vercel` (to be done BEFORE any other command in this skill that touches Vercel)

```bash
eval "$(node "${CLAUDE_SKILL_DIR}/../../scripts/_read-user-env.mjs" 2>/dev/null || true)"
```

This line loads `VERCEL_TOKEN` from User scope if it is missing from `process.env`. Without it, some commands may fail silently.


# Rotate Secret - Renew a key/secret safely

You replace ONE sensitive key (third-party API key, OAuth secret, internal token) with a new value, everywhere it lives.

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).


---

## Step 0 - Sanity check

Check that you are inside a hypervibe project (`.env` exists or is expected). If there is no `.env` and no `.vercel/project.json` → abort with a clear message (*"This command is used inside an existing project, not at the root."*).


## Step 1 - Identify the secret to renew

### 1.a - If the user passed an argument

If `$ARGUMENTS` is not empty, treat it as the secret name. Match it case-insensitively against the keys present in `.env` (and accept partial names - *"stripe"* matches `STRIPE_SECRET_KEY`). If there is a single match → `SECRET_NAME` captured. If ambiguous (several matches) → offer a menu. If zero matches → handle it as if no argument was passed.

### 1.b - If no argument (or ambiguous)

List the **rotatable** secrets present in `.env`, grouped by provider:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/list-rotatable-secrets.mjs"
```

This script reads `.env`, filters for the known patterns, and shows an organized menu. If the script does not exist or returns nothing useful, fall back to grepping `.env` yourself for the following patterns and show a menu.

**Known rotatable patterns:**

| Pattern | Provider / Category |
|---|---|
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_*` | Stripe |
| `BREVO_API_KEY` | Brevo |
| `RESEND_API_KEY` | Resend |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Google OAuth |
| `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` | GitHub OAuth |
| `AUTH_SECRET`, `CRON_SECRET`, `*_WEBHOOK_SECRET`, `INTERNAL_*_SECRET` | Auto-generatable (internal to the project) |
| `DATABASE_URL`, `*_DATABASE_URL` | Neon (special case - see the dedicated Step 4) |
| `CLOUDFLARE_API_TOKEN`, `R2_*_KEY` | Cloudflare |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | LLM providers |
| Other `*_SECRET` or `*_KEY` or `*_TOKEN` | Unknown - ask the user where to go |

**User-facing menu (example):**

> Which key do you want to renew?
>
> **Payments**
>   1. Stripe - server secret key (`STRIPE_SECRET_KEY`)
>   2. Stripe - webhook secret (`STRIPE_WEBHOOK_SECRET`)
>
> **Email**
>   3. Brevo - API key (`BREVO_API_KEY`)
>
> **Login**
>   4. Google - OAuth ID and secret (`AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET`)
>
> **Internal to the project**
>   5. NextAuth secure password (`AUTH_SECRET`)
>   6. Scheduled-tasks token (`CRON_SECRET`)
>
> **Others**
>   7. A key that is not in the list - tell me its name

Capture the choice in `SECRET_NAME` (or several if the item covers an `ID+SECRET` pair, like OAuth).


## Step 2 - Detect the provider and prepare the instructions

Based on the `SECRET_NAME` pattern, identify the provider and select the strategy:

### Category A: Auto-generatable (`AUTH_SECRET`, `CRON_SECRET`, non-Stripe `*_WEBHOOK_SECRET`, `INTERNAL_*_SECRET`)

→ Strategy = `auto-generate`. No user action needed, we regenerate a random value with `_generate-secret`.

### Category B: Known third-party provider

→ Strategy = `external-rotate`. We will guide the user to regenerate it at the provider, then capture the new value.

Table of known providers:

| Pattern | Dashboard URL | Click-by-click instructions |
|---|---|---|
| `STRIPE_SECRET_KEY` | https://dashboard.stripe.com/apikeys | "Go to **Developers → API keys**, find the **Secret key** row, click the **Roll key** button (circle-with-arrow icon), confirm in the pop-up. Copy the new value (starts with `sk_live_…` or `sk_test_…`)." |
| `STRIPE_WEBHOOK_SECRET` | https://dashboard.stripe.com/webhooks | "Go to **Developers → Webhooks**, open the endpoint that matches your site, click **Reveal** next to **Signing secret**, then the regeneration icon on the right. Copy the new value (starts with `whsec_…`)." |
| `BREVO_API_KEY` | https://app.brevo.com/security/api-keys | "Go to **SMTP & API → API keys**. Find the old key, click the **3 dots** on the right → **Revoke**. Then **Create a new API key**, copy the new value." |
| `RESEND_API_KEY` | https://resend.com/api-keys | "Find the old key, click **⋯ → Delete**. Then **Create API Key** in the top right, give it a name (e.g. 'production'), copy the new value (starts with `re_…`)." |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | https://console.cloud.google.com/apis/credentials | "Go to **APIs & Services → Credentials**. Open your project's OAuth client ID. On the right, click **Reset Secret** and confirm. Copy the new **Client secret** (the ID itself does not change, only the secret is renewed)." |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | https://github.com/settings/developers | "Open **OAuth Apps** in the sidebar. Click your project's app. Click **Generate a new client secret**. Copy the new value right away (it will not be shown again afterwards)." |
| `OPENAI_API_KEY` | https://platform.openai.com/api-keys | "Find the old key, click the **🗑️** icon. Then **+ Create new secret key**, copy the new value (starts with `sk-…`)." |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys | "Find the old key, click **⋯ → Delete**. Then **Create Key**, copy the new value." |

If the pattern matches no known entry → ask the user:

> *This key (`<NAME>`) does not match any provider I know. Give me the URL where you can go to regenerate it, and I will guide you through it.*

Store `PROVIDER_URL` and `PROVIDER_INSTRUCTIONS`.

### Category C: Special cases

- `DATABASE_URL` Neon → Strategy = `neon-special`. Renew the Postgres role password via the Neon REST API (key from the vault) or the dashboard. Much rarer and more delicate - see the dedicated Step 4.
- `CLOUDFLARE_API_TOKEN` → Strategy = `external-rotate` with URL https://dash.cloudflare.com/profile/api-tokens, instructions: "Find the token, click **Roll**, confirm."


## Step 3 - Get the new value

### If Strategy = `auto-generate`

Invoke `_generate-secret` (format `hex`, length `32` by default, or `base64url`/`64` for the NextAuth `AUTH_SECRET` which prefers something longer). Capture `NEW_VALUE`.

Show the user:

> *You do not need to do anything for this key - it is internal to your project, I have regenerated it for you.*

### If Strategy = `external-rotate`

Show the instructions:

> ## Step for you
>
> 1. Open this page: <PROVIDER_URL>
> 2. <PROVIDER_INSTRUCTIONS>
> 3. Come back here and paste the new value into your reply.
>
> ⚠️ **Important**: do not close the tab and do not navigate elsewhere before you have copied the value. Some providers (GitHub, Resend) show it **only once**.

Wait for the user's reply. Capture `NEW_VALUE`. **Never display** the value in your own replies (neither in full nor partially) - not even to confirm it.

### If Strategy = `neon-special`

See the dedicated Step 4.


## Step 4 - Push the new value everywhere

### Standard case (all categories except `neon-special`)

Invoke `_push-env-vars` with:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/push-env-vars.mjs" "<SECRET_NAME>=<NEW_VALUE>"
```

(default target = production + preview, the script handles the right placement based on the pattern)

If the user also wants to overwrite dev (rare, but useful if the dev secret is compromised):

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/push-env-vars.mjs" --target=all "<SECRET_NAME>=<NEW_VALUE>"
```

→ For the user: *"I am replacing your new key everywhere: on your local computer and on your live site."*

### Neon special case (`DATABASE_URL` rotation)

This is more complex: you need to renew the Postgres role password on the Neon side, capture the new full URL, then push it.

**Automatic path - Neon REST API** (key `NEON.api_key` from the vault):
```bash
NTOK=$(node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" get NEON api_key)
# 1. identify project_id + branch_id + role from the host of DATABASE_URL:
curl -s -H "Authorization: Bearer $NTOK" "https://console.neon.tech/api/v2/projects?limit=400"
# 2. reset the role password (returns the new connection_uri):
curl -s -X POST -H "Authorization: Bearer $NTOK" \
  "https://console.neon.tech/api/v2/projects/{project_id}/branches/{branch_id}/roles/{role_name}/reset_password"
```
The response contains the new password / the new URI. Rebuild the full `DATABASE_URL`. (`_get-secret` pattern for `NTOK`: RC 2/3 → unlock; RC 4 → add `NEON` to the vault.)

**Manual path (dashboard fallback):**
Show the user:
> 1. Go to https://console.neon.tech/
> 2. Open the matching project
> 3. In the **Roles & Databases** tab, find the role (often `neondb_owner`)
> 4. Click **⋯ → Reset password**
> 5. Copy the full new connection URL from the **Connection details** tab and paste it here

Capture the new `DATABASE_URL`. Push it via `_push-env-vars`.

⚠️ **Neon important**: rotating the password immediately cuts active connections. The next Vercel redeploy will use the new URL - but production has a 30-60s outage while the new deploy takes over. Warn the user:

> *⚠️ Your site will be briefly unavailable (30-60 seconds) while the new database is picked up. I am going to trigger the redeploy now.*


## Step 4bis - Update the vault if the key also lives there

Some keys are **global** and have the **vault as the source of truth**: Brevo/Resend (copied into each project by `/add-email`), Cloudflare/Hostinger/Neon-api (read by the tooling). If you renew one of them, update the vault **too** - otherwise it keeps the old value and a future project would copy the stale key.

Key → vault item mapping: `BREVO_API_KEY`→`BREVO.api_key` · `RESEND_API_KEY`→`RESEND.api_key` · `CLOUDFLARE_API_TOKEN`/`CF_API_TOKEN`→`CLOUDFLARE.api_token` · `HOSTINGER_API_TOKEN`→`HOSTINGER.api_token` · `NEON_API_KEY`→`NEON.api_key`. (`DATABASE_URL` is **not** concerned - per-project secret, not a global key.)

If `SECRET_NAME` is in this mapping, write the new value into the vault (the value goes through an env var, never via argv nor displayed):

```bash
VAULT_PATH="${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" VITEM="<vault ITEM>" VFIELD="<field>" NEW_VALUE="<NEW_VALUE>" \
node --input-type=module -e '
import { pathToFileURL } from "node:url";
const { putItem } = await import(pathToFileURL(process.env.VAULT_PATH).href);
console.log("vault:" + putItem(process.env.VITEM, [{ name: process.env.VFIELD, value: process.env.NEW_VALUE, type: "secret" }]));
'
```

`vault:updated` expected. If the vault is locked (error), run `node "${CLAUDE_SKILL_DIR}/../../scripts/vault/launch.mjs" unlock` then try again.

## Step 5 - Propagate to other runtimes (Cloudflare Workers, Render)

`_push-env-vars` ONLY covers Vercel + local `.env`. **Some secrets are also used in other runtimes** - Cloudflare Workers (cron, dispatcher) and Render Services (agents, automations) - where you need to push them separately, otherwise the runtime keeps using the old value and breaks on the next run.

### Propagation table

| Secret | Vercel | Cloudflare Worker | Render Service |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ (already done in Step 4) | - | ✅ (agent) |
| `RESEND_API_KEY` | ✅ | - | ✅ (agent if emails) |
| `BREVO_API_KEY` | ✅ | - | ✅ (agent if emails) |
| `CRON_SECRET` | ✅ | ✅ (worker call-back to Next.js) | - |
| `DATABASE_URL` | ✅ | - | ✅ (agent reads the DB) |
| `CLOUDFLARE_API_TOKEN` | ✅ (if NEXT_PUBLIC) | - | ✅ (agent pgvector / Workers AI) |
| `AUTH_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, OAuth secrets | ✅ only | - | - |
| Any other application secret | ✅ only | - | - |

If the rotated secret is NOT in the table → skip this step.

If the secret IS in the table with a Cloudflare or Render checkmark → run the matching block.

### Push to Cloudflare Workers (if applicable)

```bash
SECRET_NAME="<SECRET_NAME>"
NEW_VALUE="<NEW_VALUE>"
# wrangler authenticates via CLOUDFLARE_API_TOKEN (which lives in the vault, no longer in env) - inject it inline.
export CLOUDFLARE_API_TOKEN=$(node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" get CLOUDFLARE api_token 2>/dev/null)
REPO_ROOT=$(git -C "<WEB_DIR>" rev-parse --show-toplevel 2>/dev/null || echo "<WEB_DIR>")
WT_LIST=$(find "$REPO_ROOT" -name "wrangler.toml" -not -path "*/node_modules/*" -not -path "*/.next/*" 2>/dev/null)

if [ -z "$WT_LIST" ]; then
  echo "CF_PUSH=no_workers"
else
  echo "$WT_LIST" | while read -r WT; do
    # Check whether this Worker uses the secret in question (by convention it
    # declares it in wrangler.toml [vars] or in its source code). We push
    # only if the Worker seems to use it, to avoid polluting Workers that
    # are not concerned.
    WORKER_DIR=$(dirname "$WT")
    if grep -rq "env\.${SECRET_NAME}\b" "$WORKER_DIR/src" 2>/dev/null || \
       grep -q "\b${SECRET_NAME}\b" "$WT" 2>/dev/null; then
      # Push as a Worker secret (encrypted at rest). `wrangler secret put` reads
      # from stdin to avoid leaking the value into shell history.
      printf '%s' "$NEW_VALUE" | (cd "$WORKER_DIR" && npx wrangler secret put "$SECRET_NAME" 2>&1) \
        && echo "CF_PUSH_OK=$WT:$SECRET_NAME" \
        || echo "CF_PUSH_FAILED=$WT:$SECRET_NAME"
    fi
  done
fi
```

Depending on the output:
- `CF_PUSH=no_workers` → the user has no CF Worker, silent skip.
- `CF_PUSH_OK=...` → announce `✅ Cloudflare Worker <name>: ${SECRET_NAME} updated`.
- `CF_PUSH_FAILED=...` → surface the error, offer the user to push manually with `npx wrangler secret put <SECRET_NAME>` in the Worker's folder.

### Push to Render Services (if applicable)

```bash
SECRET_NAME="<SECRET_NAME>"
NEW_VALUE="<NEW_VALUE>"
# Render = full REST API, key in the vault (no more RENDER_API_KEY env var).
RENDER_API_KEY=$(node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" get RENDER api_key 2>/dev/null)
if [ -z "$RENDER_API_KEY" ]; then
  echo "RENDER_PUSH=no_api_key"
else
  SERVICES_JSON=$(curl -sS -H "Authorization: Bearer $RENDER_API_KEY" \
    "https://api.render.com/v1/services?limit=50" 2>/dev/null)
  if [ -z "$SERVICES_JSON" ]; then
    echo "RENDER_PUSH=api_error"
  else
    echo "$SERVICES_JSON" | node -e "
      const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
      (d || []).forEach(s => console.log((s.service||s).id));
    " | while read -r SID; do
      [ -z "$SID" ] && continue
      # Check if this service has the env var declared (we don't push to
      # services that don't already use it - that would clutter their config)
      HAS=$(curl -sS -H "Authorization: Bearer $RENDER_API_KEY" \
        "https://api.render.com/v1/services/$SID/env-vars?limit=100" 2>/dev/null | \
        node -e "
          const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
          const found = (d || []).some(e => (e.envVar||e).key === process.env.SECRET_NAME);
          console.log(found ? 'yes' : 'no');
        ")
      if [ "$HAS" = "yes" ]; then
        # Update via PUT - Render's API treats this as an upsert.
        curl -sS -X PUT -H "Authorization: Bearer $RENDER_API_KEY" \
          -H "Content-Type: application/json" \
          -d "{\"value\":\"$NEW_VALUE\"}" \
          "https://api.render.com/v1/services/$SID/env-vars/$SECRET_NAME" >/dev/null \
          && echo "RENDER_PUSH_OK=$SID:$SECRET_NAME" \
          || echo "RENDER_PUSH_FAILED=$SID:$SECRET_NAME"
        # Trigger redeploy - Render only picks up new env values on next deploy
        curl -sS -X POST -H "Authorization: Bearer $RENDER_API_KEY" \
          -H "Content-Type: application/json" -d '{}' \
          "https://api.render.com/v1/services/$SID/deploys" >/dev/null \
          && echo "RENDER_REDEPLOY=$SID"
      fi
    done
  fi
fi
```

Depending on the output:
- `RENDER_PUSH=no_api_key` → silent, the user has no Render configured.
- `RENDER_PUSH_OK=...` + `RENDER_REDEPLOY=...` → announce `✅ Render Service <id>: ${SECRET_NAME} updated + redeploy triggered (~2-5 min)`.
- `RENDER_PUSH_FAILED=...` → surface the error, offer the link `https://dashboard.render.com` for a manual fix.

⚠️ **If the auto-push partially fails** (e.g. Vercel OK but Render KO): **do not conclude until all targets are in sync**. A partial rotation means some runtimes use the old key (which will soon be revoked) → they will break. Insist on the manual fix before moving to Step 6.


## Step 6 - Verify (best-effort)

If possible, validate that the new value works before concluding:

| Pattern | Verification test |
|---|---|
| `STRIPE_SECRET_KEY` | `curl -fsSL https://api.stripe.com/v1/balance -u "<NEW_VALUE>:"` (should return 200) |
| `BREVO_API_KEY` | `curl -fsSL https://api.brevo.com/v3/account -H "api-key: <NEW_VALUE>"` |
| `RESEND_API_KEY` | `curl -fsSL https://api.resend.com/domains -H "Authorization: Bearer <NEW_VALUE>"` |
| `OPENAI_API_KEY` | `curl -fsSL https://api.openai.com/v1/models -H "Authorization: Bearer <NEW_VALUE>"` |
| `ANTHROPIC_API_KEY` | `curl -fsSL https://api.anthropic.com/v1/models -H "x-api-key: <NEW_VALUE>" -H "anthropic-version: 2023-06-01"` |
| Auto-generated | No test possible (secret internal to the project) - skip |

If the test returns 200 → ✅ confirmed. If error → warn the user that the value does not seem valid, offer to try again.

**Never store the value in temporary files in plaintext.** Pass it through a shell variable only.


## Step 7 - Offer the redeploy

> ## ✅ Your **<SECRET_NAME>** key is renewed
>
> It is in place on your computer (`.env`) and on your live site (production + test versions).
>
> **For it to be active on your site**, you need to redeploy once. Do you want me to do it now? *(it is just a `git commit --allow-empty` + push, which triggers a new automatic deployment on Vercel - about 1 minute)*

If the user says yes:
```bash
git commit --allow-empty -m "chore: rotate <SECRET_NAME>"
git push
```

(If the repo is not connected to Vercel via Git auto-deploy but via GHA deploy, the `git push` triggers the GHA workflow that redeploys anyway. Same on the user's side.)

If no, tell them: *"OK, it will be active on the next deployment. When you are ready, tell me 'deploy' and I will take care of it."*


## Step 8 - If the old value leaked publicly, extra advice

If the user triggered this command because the key leaked (public GitHub commit, screenshot, email sent by mistake), add:

> 💡 A few extra things to do on your side:
>
> 1. **Check the Git history** if the leak comes from a commit: the value stays in the history even after the file is deleted. If your repo is public, consider it compromised forever and that you need to purge the history (`git filter-repo`) - tell me *"clean the git history for this key"* and I will guide you.
> 2. **Watch the provider logs** (Stripe, Brevo, etc.) over the **next 24-48 hours** to spot any suspicious usage.
> 3. If the key was used outside of your own setup, contact the provider's support - they can force a disconnect and give you usage details.


## Step 9 - CLAUDE.md (optional)

If the project has a `CLAUDE.md` and the rotation follows a leak or an employee offboarding, add a line in a "Rotations" section (created if absent):

```
- **YYYY-MM-DD**: <SECRET_NAME> rotated (reason: leak / offboarding / periodic)
```

This traceability is useful for internal audit and to understand the history of the secrets.

---

## Natural-language override

- *"renew my Stripe key too"* (during another command): resume at Step 1 for that key.
- *"I changed my mind, cancel"* before the push: do nothing, do not push, say OK.
- *"renew ALL my third-party keys"*: iterate over the `external-rotate` strategies one by one (not advised in practice because the user will have to click in 5 different dashboards - suggest doing it in several passes).
