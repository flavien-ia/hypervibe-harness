---
name: _dns-gandi
description: Internal - change a Gandi-registered domain's nameservers to point to Cloudflare. Uses Gandi's REST API v5 directly with a Personal Access Token (no CLI install). Triggered by /add-domain when the registrar is Gandi.
user-invocable: false
allowed-tools: Read Edit Write Bash
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# _dns-gandi - Point a Gandi domain to Cloudflare

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You receive as input: `<domain>`, `<ns1_cloudflare>`, `<ns2_cloudflare>`. Your job: change the domain's nameservers at Gandi so they point to `<ns1_cloudflare>` and `<ns2_cloudflare>`. You then return to `/add-domain`.

Gandi has no official CLI that handles the nameserver change - we call their **REST API v5** directly with `curl`. Auth via a Personal Access Token (PAT) Bearer.

## Step 1 - Verify that the Gandi PAT is available

The PAT lives in the **vault** (item `GANDI`, field `api_token`). First make sure the vault is open (follow `_ensure-vault`), then load it and test:

```bash
VAULT="${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs"
export GANDI_API_TOKEN=$(node "$VAULT" get GANDI api_token 2>/dev/null)
[ -n "$GANDI_API_TOKEN" ] && curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $GANDI_API_TOKEN" \
  https://api.gandi.net/v5/organization/user-info
```

- **If the token exists AND the request returns `200`** -> go to Step 3.
- **Otherwise** -> Step 2.

## Step 2 - Request the creation of a Gandi PAT

Guide the user (the account's old "API Keys" are deprecated by Gandi - only use PATs):

> I need a **Gandi Personal Access Token** to manage your domain via the API. Here is how to create one for me in ~1 min:
>
> 1. Go to **https://admin.gandi.net/organizations/account/pat**
> 2. Click **"Create a token"** (or *"Créer un jeton"* in French)
> 3. **Select the organization** that owns the domain
> 4. **Name**: `Claude Code`
> 5. **Expiration**: 1 year (or more depending on your policy)
> 6. **Scope**: select the **relevant domain** (`<domain>`) rather than "All resources" - principle of least privilege
> 7. **Permissions**: check at least
>    - **Manage domain technical configurations** (required to change the NS)
>    - **See and renew domain names** (read access)
> 8. Click **"Create"** -> copy the token (shown only once)
> 9. Paste it here, I will store it properly.

Once the user has created their PAT, store it **directly in the vault** (masked entry in a window - the value never passes through the chat):

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/vault/launch.mjs" add --name GANDI --service Gandi --fields api_token:secret
```

Then load it into the session and validate it without logging it:

```bash
export GANDI_API_TOKEN=$(node "$VAULT" get GANDI api_token)
HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $GANDI_API_TOKEN" \
  https://api.gandi.net/v5/organization/user-info)
[ "$HTTP" = "200" ] && echo "VALID" || echo "INVALID (HTTP $HTTP)"
```

- If **VALID** -> go to Step 3.
- If **INVALID** -> token copied wrong or missing scopes/permissions: redo the add (`launch.mjs add` rewrites the item) after re-checking the checklist above.

## Step 3 - Change the nameservers

Official endpoint (verified 2026-05-28 via the Go lib `go-gandi`, used by DNSControl and the Gandi Terraform provider):

```
PUT https://api.gandi.net/v5/domain/domains/<domain>/nameservers
Authorization: Bearer <token>
Content-Type: application/json

{ "nameservers": ["<ns1>", "<ns2>"] }
```

Exact command:

```bash
curl -s -X PUT \
  -H "Authorization: Bearer $GANDI_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"nameservers\":[\"<ns1_cloudflare>\",\"<ns2_cloudflare>\"]}" \
  -w "\nHTTP:%{http_code}\n" \
  "https://api.gandi.net/v5/domain/domains/<domain>/nameservers"
```

**Expected return codes**:
- `202` or `204` -> success (Gandi processes asynchronously)
- `401` -> invalid or expired token -> send back to Step 2
- `403` -> insufficient PAT permissions (missing "Manage domain technical configurations") -> send back to Step 2 to regenerate
- `404` -> the domain is not in the PAT's account/organization
- `400` -> incorrect payload format (check that they are indeed FQDNs)

Verify success:

```bash
curl -s -H "Authorization: Bearer $GANDI_API_TOKEN" \
  "https://api.gandi.net/v5/domain/domains/<domain>" \
  | node -e "const d = JSON.parse(require('fs').readFileSync(0, 'utf8')); console.log(d.nameservers || d);"
```

Note: Gandi can take a few minutes before `nameservers` reflects the new list in the GET (internal propagation between their API and their registry). Do not worry if the immediate check still shows the old NS - public DNS propagation (5-30 min) is longer anyway.

## Step 4 - Manual mode (ONLY if the user explicitly asks for it)

If the user refuses to create a PAT:

> Go to **https://admin.gandi.net/** -> **"Domain"** tab in the left-hand menu -> your domain -> **"Nameservers"** tab -> **"Change"** -> choose **"External"** -> enter:
> - `<ns1_cloudflare>`
> - `<ns2_cloudflare>`
>
> Click **"Save"**. Let me know when it's done.

Otherwise, **always prefer the API**: the PAT will be reused for other Gandi domains and for future changes (DNS records, transfer, renewal).

## Return to add-domain

Once the NS are changed (auto or manual), confirm to the caller:
> Done. The `<domain>` domain's nameservers now point to Cloudflare. Propagation: 5-30 min (Gandi can take up to 1-2 h depending on the TLD).
