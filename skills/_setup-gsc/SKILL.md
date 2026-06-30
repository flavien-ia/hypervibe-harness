---
name: _setup-gsc
description: Internal helper to connect Google Search Console via a service account stored in the Bitwarden vault (no MCP, no Python, no restart). Guides the one-time creation of a Google service account, stores its JSON key in the vault (item GSC_SERVICE_ACCOUNT), and grants it owner access on the GSC property. Triggered by /gsc when GSC is not yet configured. Not meant to be invoked directly by users.
user-invocable: false
allowed-tools: Bash Read
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Setup GSC (via vault) - Internal helper

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You connect Google Search Console to Hypervibe via a **Google service account** whose JSON key is stored in the **vault** (item `GSC_SERVICE_ACCOUNT`, field `credentials`). Then `/gsc` reads the data via the REST API with a token forged on the fly (`gsc-token.mjs`).

This is a **one-time setup per machine**: once done, all future `/gsc` runs (on any project) use the vault directly. Scope `webmasters` (read + write) means Claude is autonomous (adding a property, DNS verification, sitemap).

> Scripts: `VAULT="${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs"`, `STORE="${CLAUDE_SKILL_DIR}/../../scripts/vault/store-file-secret.mjs"`, `GSCTOKEN="${CLAUDE_SKILL_DIR}/../../scripts/gsc/gsc-token.mjs"`, `OPENURL="${CLAUDE_SKILL_DIR}/../../scripts/open-url.mjs"`.

---

## Step 1 - Is the vault ready?

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" status 2>/dev/null
```
- `unlocked` → continue to Step 2.
- `expired` / `locked` → open the unlock: `node "${CLAUDE_SKILL_DIR}/../../scripts/vault/launch.mjs" unlock` (blocking), then re-test.
- Error (no `bw`, no account) → the vault is not installed: delegate to **`_add-keyring`** first, then come back here.

---

## Step 2 - Announce the plan

> To connect Google Search Console, we create a Google *technical account* once (~7 minutes). After that, I handle everything across all your projects. Steps:
>
> 1. You create a technical account (service account) in the Google Cloud Console
> 2. You download its key (a JSON file)
> 3. You give me the path to the file → I store it in your vault
> 4. You authorize this technical account on your Search Console (3 clicks)
>
> No restart, no heavy installation. Shall we go?

If they refuse → suggest an on-page audit via `/seo` (without GSC) and stop cleanly.

---

## Step 3 - Create the service account (manual, browser)

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/open-url.mjs" "https://console.cloud.google.com/"
```

> Sign in with **the Google account that has access to your Search Console**.
>
> 1. At the top, select/create a project (project menu → **NEW PROJECT** → name e.g. "Claude Code Access" → **CREATE**)
> 2. Left menu → **APIs & Services** → **Library** → enable **TWO** APIs (search for each → **ENABLE**): **"Search Console API"** AND **"Site Verification API"** (the 2nd one allows adding + verifying a property automatically)
> 3. **APIs & Services** → **Credentials** → **+ CREATE CREDENTIALS** → **Service account**
> 4. **Service account name**: `claude-code-gsc` → **CREATE AND CONTINUE** → roles empty (skip) → **DONE**
> 5. Click the created service account → **KEYS** tab → **ADD KEY** → **Create new key** → **JSON** → **CREATE**
> 6. A `.json` file downloads (often into `~/Downloads/`)

Ask for the path:

> Give me the **full path** of the downloaded JSON file (e.g. Windows: `C:\Users\<you>\Downloads\claude-...json`; Mac/Linux: `~/Downloads/claude-...json`).

---

## Step 4 - Store the key in the vault (and read the SA email)

First extract the service account email (not secret - used in Step 5):

```bash
SA_EMAIL=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).client_email)" "<path>")
echo "$SA_EMAIL"
```
If this fails (`client_email` missing) → the user probably downloaded an **OAuth client** instead of a **service account** (common mistake): send them back to Step 3 point 3 (be sure to choose **Service account**).

Then store the file in the vault (the content goes file→vault, never passes through Claude):

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/vault/store-file-secret.mjs" \
  --file "<path>" --name GSC_SERVICE_ACCOUNT --field credentials \
  --service "Google Search Console" --json
```
- `Created/Updated 'GSC_SERVICE_ACCOUNT'` → done. Advise the user to **delete the downloaded JSON file** (the key is now in the vault, no need to leave it in clear on the disk).
- exit 2/3 → vault locked: unlock then rerun.
- exit 5 → file is not valid JSON: wrong file, ask again.

---

## Step 5 - Authorize the technical account on Search Console (manual, browser)

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/open-url.mjs" "https://search.google.com/search-console"
```

> Last step (1 min) - I grant the technical account access to your Search Console:
>
> 1. If your property doesn't exist yet: **Add property** → **Domain** format → your root domain (I'll take care of the DNS verification afterwards).
> 2. Select your property → **Settings** (gear, bottom of the left menu) → **Users and permissions**
> 3. **ADD USER** → email: `<SA_EMAIL>` → permission **Owner** → **Add**
>
> Tell me *"it's done"*.

Warning: To track several sites, you need to add `<SA_EMAIL>` as an owner on **each** property (Google does not propagate between properties).

---

## Step 6 - Verify (no restart)

Forge a token + list the visible properties:

```bash
TOK=$(node "${CLAUDE_SKILL_DIR}/../../scripts/gsc/gsc-token.mjs" --readonly 2>/dev/null); RC=$?
[ $RC -eq 0 ] && curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOK" "https://www.googleapis.com/webmasters/v3/sites"
```
- token OK + HTTP 200 → done, GSC configured. Hand control back to `/gsc` (which continues with its audit).
- exit 2/3 → vault locked: unlock, retry.
- exit 4 → the key is not in the vault: go back to Step 4.
- HTTP 403 → the SA does not (yet) have access: Step 5 not finished or on the wrong property.

---

## Artifacts

- Vault: item `GSC_SERVICE_ACCOUNT` (field `credentials` = SA JSON).
- Google: project + service account created; SA added as owner on the GSC property/properties.
- **No** MCP in `.claude.json`, **no** Python package, **no** restart.

All future `/gsc` runs skip this setup and read the vault.
