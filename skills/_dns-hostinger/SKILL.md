---
name: _dns-hostinger
description: Internal - change a Hostinger-registered domain's nameservers to point to Cloudflare, via the Hostinger REST API (curl + API token from the Bitwarden vault). No MCP. Triggered by /add-domain when the registrar is Hostinger.
user-invocable: false
allowed-tools: Read Edit Write Bash
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# _dns-hostinger - Point a Hostinger domain to Cloudflare (REST API)

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

Input: `<domain>`, `<ns1_cloudflare>`, `<ns2_cloudflare>`. Job: change the domain's nameservers at Hostinger to point to Cloudflare, **via the Hostinger REST API**. The API token lives in the vault (item `HOSTINGER`, field `api_token`). Then return to `/add-domain`.

> Scripts: `VAULT="${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs"`, `LAUNCH="${CLAUDE_SKILL_DIR}/../../scripts/vault/launch.mjs"`. Endpoint: base `https://developers.hostinger.com/api`, auth `Authorization: Bearer <token>`.

## Step 1 - Get the Hostinger token from the vault

Follow the `_get-secret` pattern (read into a shell variable, never print it, auto-unlock):

```bash
VAULT="${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs"
TOK=$(node "$VAULT" get HOSTINGER api_token 2>/dev/null); RC=$?
```

Handle `RC`:
- **0** -> we have the token, go to Step 2.
- **2 or 3** (vault locked / session expired) -> warn the user ("your vault is locked, a window is going to open"), run `node "${CLAUDE_SKILL_DIR}/../../scripts/vault/launch.mjs" unlock` (blocking), then run the `get` again.
- **4** (Hostinger key not in the vault yet) -> add it (see Step 1b), then run the `get` again.

### Step 1b - Add the Hostinger token to the vault (if RC=4)

> To manage your domain, I need your Hostinger API key (just once - I'll store it in your vault).
>
> 1. Go to **https://hpanel.hostinger.com/api**
> 2. Click **"Create API Token"**, name it `Claude Code`, and copy it.
> 3. A window is going to open: paste the key into it (masked input, I never see it).

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/vault/launch.mjs" add --name HOSTINGER --service Hostinger --fields "api_token:secret"
```

Then run the `get` from Step 1 again.

## Step 2 - Change the nameservers (PUT)

```bash
curl -s -o /tmp/hns.json -w "%{http_code}" -X PUT \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  "https://developers.hostinger.com/api/domains/v1/portfolio/<domain>/nameservers" \
  -d "{\"ns1\":\"<ns1_cloudflare>\",\"ns2\":\"<ns2_cloudflare>\"}"
```

- **HTTP 200/2xx** -> success, go to Step 3.
- **401/403** -> invalid/expired token: offer to re-enter it (Step 1b with a re-paste), or switch to manual mode (Step 4).
- **404** -> the domain is not in this Hostinger account: check the spelling / the correct account, otherwise manual mode.
- **422/other** -> show the error message from `/tmp/hns.json` and switch to manual mode.

## Step 3 - Verify

```bash
curl -s -H "Authorization: Bearer $TOK" -H "Accept: application/json" \
  "https://developers.hostinger.com/api/domains/v1/portfolio/<domain>" \
  | python -c "import json,sys; print(json.load(sys.stdin).get('name_servers',{}))"
```

Confirm that `ns1`/`ns2` indeed match the expected Cloudflare NS.

## Step 4 - Manual mode (fallback if the API fails or if the user asks for it)

> Go to **hPanel** (Hostinger) -> **Domains** -> your domain -> **DNS / Nameservers** -> **Change nameservers**, and replace them with:
> - `<ns1_cloudflare>`
> - `<ns2_cloudflare>`
>
> Let me know when it's done.

## Back to add-domain

> Nameservers for the domain `<domain>` now point to Cloudflare. Propagation: 5-30 min.
