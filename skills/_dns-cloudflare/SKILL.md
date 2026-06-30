---
name: _dns-cloudflare
description: Internal - handle the case where the user's domain registrar IS Cloudflare (Cloudflare Registrar). No nameserver change needed; just verify the zone exists via CF REST API. Triggered by /add-domain when the registrar is Cloudflare.
user-invocable: false
allowed-tools: Read Edit Write Bash
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# _dns-cloudflare - Special case: domain already at Cloudflare Registrar

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You receive as input: `<domain>`. If the domain's registrar is **Cloudflare itself**, there is no nameserver to change - Cloudflare already manages the domain's DNS. You just verify that the zone exists and hand control back.

**Cloudflare architecture in hypervibe**: all DNS operations go through the Cloudflare REST API via `curl` + the token from the vault (`CLOUDFLARE.api_token`). No `flarectl` CLI, no Cloudflare MCP - just `curl` and the token. `wrangler` is used separately for Workers / R2 / D1 / KV.

## Preamble - token from the vault

```bash
CFTOK=$(node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" get CLOUDFLARE api_token); RC=$?
```
Apply the `_get-secret` pattern: `RC` 2/3 -> unlock then retry; `RC` 4 -> the key is not in the vault, suggest `launch.mjs add --name CLOUDFLARE --service Cloudflare --fields "api_token:secret"`. **Never display `$CFTOK`.**

## Step 1 - Preflight: is the Cloudflare token valid?

Invoke `_check-deps cloudflare`:

```bash
result=$(node "${CLAUDE_SKILL_DIR}/../../scripts/check-deps.mjs" cloudflare)
cf_ok=$(echo "$result" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).cloudflare.ok)")
```

**If `cf_ok = false`** -> abort and route to `/start`:

> To manage your domain through Cloudflare, I need your Cloudflare account to be connected to your computer. That is not done yet. Run `/start` - I will help you create a Cloudflare token in 2 minutes, then you rerun `/add-domain` and we pick up here.

**If `cf_ok = true`** -> the token works, we continue.

## Step 2 - Verify that the zone exists

```bash
curl -s -H "Authorization: Bearer $CFTOK" \
  "https://api.cloudflare.com/client/v4/zones?name=<domain>" \
  | node -e "const d = JSON.parse(require('fs').readFileSync(0, 'utf8')); const z = d.result?.[0]; if (z) console.log('FOUND', z.id, z.status); else console.log('NOT_FOUND');"
```

- **If `FOUND <zone_id> active`** -> zone active. Store `<zone_id>` for `add-domain`. Go to "Back to add-domain".
- **If `FOUND <zone_id> pending`** -> the zone exists but is not active yet (odd if the registrar is CF, unless the DNS is delegated elsewhere). Warn the user and ask for confirmation before continuing.
- **If `NOT_FOUND`** -> the zone does not exist. Ask for confirmation (maybe the user bought the domain through CF Registrar but the DNS is delegated elsewhere); in that case, create the zone (see Step 3).

## Step 3 - Create the zone (if missing)

First get the user's `account_id`:

```bash
ACCOUNT_ID=$(curl -s -H "Authorization: Bearer $CFTOK" \
  "https://api.cloudflare.com/client/v4/accounts" \
  | node -e "const d = JSON.parse(require('fs').readFileSync(0, 'utf8')); console.log(d.result?.[0]?.id || '');")
```

Then create the zone:

```bash
curl -s -X POST -H "Authorization: Bearer $CFTOK" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"<domain>\",\"account\":{\"id\":\"$ACCOUNT_ID\"},\"type\":\"full\"}" \
  "https://api.cloudflare.com/client/v4/zones" \
  | node -e "const d = JSON.parse(require('fs').readFileSync(0, 'utf8')); if (d.success) console.log('CREATED', d.result.id); else console.error('FAIL', JSON.stringify(d.errors));"
```

Store the new `<zone_id>` returned.

## Back to add-domain

> Domain `<domain>` managed by Cloudflare Registrar. No nameserver change needed - the zone is already active. We move on to the DNS config for Vercel.

**Important**: signal to `add-domain` that the NS change is skipped (the main flow must not wait for propagation, we can configure the DNS records directly). Also pass the `<zone_id>` to `add-domain` for its subsequent curl calls.
