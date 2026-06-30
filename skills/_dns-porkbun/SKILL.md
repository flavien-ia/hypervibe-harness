---
name: _dns-porkbun
description: Internal - change a Porkbun-registered domain's nameservers to point to Cloudflare. Uses Porkbun's REST API v3 directly via curl with API key + secret (no CLI install). Triggered by /add-domain when the registrar is Porkbun.
user-invocable: false
allowed-tools: Read Edit Write Bash
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# _dns-porkbun - Point a Porkbun domain to Cloudflare

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You receive as input: `<domain>`, `<ns1_cloudflare>`, `<ns2_cloudflare>`. Your job: change the domain's nameservers at Porkbun so they point to `<ns1_cloudflare>` and `<ns2_cloudflare>`. You then return to `/add-domain`.

No CLI install needed - the Porkbun API v3 is a simple REST/JSON API that we call with `curl`. Auth is done via two keys (API key + Secret) passed in the body of each request (not in the headers).

## Step 1 - Check whether the Porkbun credentials are already in place

Porkbun requires **2 values**, stored in the **vault** (item `PORKBUN`, fields `api_key` / `secret_key`):
- `PORKBUN_API_KEY` (the public key, format `pk1_...`)
- `PORKBUN_SECRET_KEY` (the secret key, format `sk1_...`)

Make sure the vault is unlocked (follow `_ensure-vault`), load the keys and test with their `/ping` endpoint:

```bash
VAULT="${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs"
export PORKBUN_API_KEY=$(node "$VAULT" get PORKBUN api_key 2>/dev/null)
export PORKBUN_SECRET_KEY=$(node "$VAULT" get PORKBUN secret_key 2>/dev/null)
if [ -n "$PORKBUN_API_KEY" ] && [ -n "$PORKBUN_SECRET_KEY" ]; then
  RESP=$(curl -s -X POST "https://api.porkbun.com/api/json/v3/ping" \
    -H "Content-Type: application/json" \
    -d "{\"apikey\":\"$PORKBUN_API_KEY\",\"secretapikey\":\"$PORKBUN_SECRET_KEY\"}")
  echo "$RESP" | grep -q '"status":"SUCCESS"' && echo "VALID" || echo "INVALID"
fi
```

- **If `VALID`** -> go to Step 3.
- **Otherwise** -> Step 2.

## Step 2 - Create a Porkbun API key pair

Guide the user:

> I need a Porkbun API key pair (key + secret) to change your domain's nameservers. It takes about 1 min to create:
>
> 1. Log in at **https://porkbun.com**
> 2. Top right, **Account** -> **API Access** (or directly: **https://porkbun.com/account/api**)
> 3. Enter a name (e.g. `Claude Code`)
> 4. Click **Create API Key**
> 5. A box shows the **API Key** + **Secret API Key** - copy **both immediately**, the secret will not be shown again afterwards
>
> Give me the 2 values (API Key + Secret).

Store them in the **vault** once received (masked-input window - the values do not pass through the chat):

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/vault/launch.mjs" add --name PORKBUN --service Porkbun --fields "api_key:secret,secret_key:secret"
```

Then load them into the current session:
```bash
export PORKBUN_API_KEY=$(node "$VAULT" get PORKBUN api_key)
export PORKBUN_SECRET_KEY=$(node "$VAULT" get PORKBUN secret_key)
```

Validate by replaying the test from Step 1.

## Step 3 - ⚠️ Enable API Access on the domain specifically

**Porkbun-specific gotcha**: having the API keys is not enough. Each domain you want to manage via the API must have an **"API Access" toggle enabled separately**. Without it, all API calls on that domain will return an error.

Ask the user to do it before calling the NS endpoint:

> A small Porkbun quirk: each domain has an "API Access" toggle that must be **enabled manually** so we can manage it via the API. You only need to do this once:
>
> 1. Go to **https://porkbun.com/account/domainsSpeedy** (your domain list)
> 2. Find `<domain>` -> click **Details** on the right
> 3. Find the **API Access** option -> switch it to **ON**
> 4. Save
>
> Let me know when it's done.

Wait for explicit confirmation before continuing.

## Step 4 - Change the nameservers

Official endpoint (verified 2026-05-28 via the Porkbun OpenAPI spec):

```
POST https://api.porkbun.com/api/json/v3/domain/updateNs/<domain>
Content-Type: application/json

{
  "apikey": "<api_key>",
  "secretapikey": "<secret_key>",
  "ns": ["<ns1_cloudflare>", "<ns2_cloudflare>"]
}
```

Command:

```bash
RESP=$(curl -s -X POST "https://api.porkbun.com/api/json/v3/domain/updateNs/<domain>" \
  -H "Content-Type: application/json" \
  -d "{
    \"apikey\":\"$PORKBUN_API_KEY\",
    \"secretapikey\":\"$PORKBUN_SECRET_KEY\",
    \"ns\":[\"<ns1_cloudflare>\",\"<ns2_cloudflare>\"]
  }")
echo "$RESP"
```

**Possible responses**:
- `{"status":"SUCCESS"}` -> ✅ NS changed
- `{"status":"ERROR","message":"API access not enabled..."}` -> the user forgot Step 3 (per-domain toggle), go back to Step 3
- `{"status":"ERROR","message":"Invalid API key..."}` -> broken credentials, go back to Step 2

Verification:

```bash
curl -s -X POST "https://api.porkbun.com/api/json/v3/domain/getNs/<domain>" \
  -H "Content-Type: application/json" \
  -d "{\"apikey\":\"$PORKBUN_API_KEY\",\"secretapikey\":\"$PORKBUN_SECRET_KEY\"}"
```

Must return `{"status":"SUCCESS","ns":["<ns1>","<ns2>"]}`.

## Step 5 - Manual mode (ONLY if the user refuses the API)

> Go to **https://porkbun.com/account/domainsSpeedy** -> click **Details** next to `<domain>` -> find the **Authoritative Nameservers** section -> enter:
> - `<ns1_cloudflare>`
> - `<ns2_cloudflare>`
>
> Save. Let me know when it's done.

## Return to add-domain

> ✅ Nameservers for the domain `<domain>` are now pointed to Cloudflare. Propagation: 5-30 min.
