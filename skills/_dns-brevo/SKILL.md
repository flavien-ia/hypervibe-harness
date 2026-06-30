---
name: _dns-brevo
description: "Internal skill called by /add-domain. Configures a custom domain in Brevo for professional email sending via the Brevo REST API (curl + key from the vault). Adds the DNS records via the Cloudflare REST API. No MCP, no CLI. Not meant to be called directly by users."
user-invocable: false
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# DNS Brevo - Configure an email sending domain

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

Internal skill called by `/add-domain`. Configures a custom domain in Brevo so that emails are sent from `contact@mydomain.com` instead of a generic address. **Everything goes through the Brevo REST API (`https://api.brevo.com/v3`) and the Cloudflare REST API** via `curl`. No MCP, no CLI.

**Prerequisites:** the domain is already connected to Vercel, DNS is managed by Cloudflare, and the vault contains the keys `BREVO.api_key` and `CLOUDFLARE.api_token`.

## Preamble - keys from the vault

```bash
VAULT="${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs"
BTOK=$(node "$VAULT" get BREVO api_key); RC=$?      # Brevo API key
CFTOK=$(node "$VAULT" get CLOUDFLARE api_token)     # Cloudflare token
```
For each `get`, apply the `_get-secret` pattern: `RC` 2/3 -> unlock then retry; `RC` 4 -> the key is not in the vault, suggest `launch.mjs add` (Brevo: `--name BREVO --service Brevo --fields "api_key:secret"`; Cloudflare: `--name CLOUDFLARE --service Cloudflare --fields "api_token:secret"`). **Never display `$BTOK`/`$CFTOK`.**

---

## Step 1 - Check the prerequisites

Invoke `_check-deps email` to verify that an email provider is configured:

```bash
result=$(node "${CLAUDE_SKILL_DIR}/../../scripts/check-deps.mjs" email)
email_ok=$(echo "$result" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).email.ok)")
email_provider=$(echo "$result" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).email.provider || 'none')")
```

This skill is specific to **Brevo**. If `email_ok = false` OR `email_provider !== "brevo"` -> abort (we do not continue).

---

## Step 2 - Create the domain in Brevo (REST API)

```bash
curl -s -X POST "https://api.brevo.com/v3/senders/domains" \
  -H "api-key: $BTOK" -H "Content-Type: application/json" \
  -d '{"name":"<domain>"}'
```

The JSON response contains a `dns_records` object with three TXT records to add. Each has a `host_name`, a `type` (`TXT`), and a `value`:
- `brevo_code` (host `@`, i.e. the domain root): Brevo ownership/verification code.
- `dkim_record` (host `mail._domainkey`): DKIM signing key.
- `dmarc_record` (host `_dmarc`): DMARC policy.

Extract and store these three records. If the domain already exists, Brevo returns an error - in that case fetch it via `GET https://api.brevo.com/v3/senders/domains` (same `api-key: $BTOK` header) and reuse its records.

---

## Step 3 - Add the DNS records via the Cloudflare API (curl)

The Cloudflare token (`$CFTOK`) comes from the vault (Preamble above).

### 3.a - Get the zone ID

```bash
ZONE_ID=$(curl -s -H "Authorization: Bearer $CFTOK" \
  "https://api.cloudflare.com/client/v4/zones?name=<domain>" \
  | node -e "const d = JSON.parse(require('fs').readFileSync(0, 'utf8')); console.log(d.result?.[0]?.id || '');")
```

If `ZONE_ID` is empty -> abort (the zone must exist, `/add-domain` created it just before).

### 3.b - Add the 3 TXT records returned by Brevo

For each of the three records (`brevo_code`, `dkim_record`, `dmarc_record`), set `name` to its `host_name` (use the domain root `<domain>` when `host_name` is `@`, otherwise `<host_name>.<domain>`) and `content` to its `value`:

```bash
curl -s -X POST -H "Authorization: Bearer $CFTOK" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"TXT\",\"name\":\"<name>\",\"content\":\"<value>\",\"ttl\":3600,\"proxied\":false}" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records"
```

**⚠️ Always set `\"proxied\":false`** for these TXT records (email authentication) - otherwise the Cloudflare proxy interferes. **Duplicates** (Cloudflare error 81057): if an identical record already exists, skip it.

---

## Step 4 - Authenticate the domain in Brevo (REST API)

Wait ~15 seconds to give the DNS time to propagate, then ask Brevo to verify:

```bash
curl -s -X PUT "https://api.brevo.com/v3/senders/domains/<domain>/authenticate" \
  -H "api-key: $BTOK"
```

If the verification fails (DNS not yet propagated):

> The DNS records have not propagated yet. I'll wait 30 seconds and try again...

Retry up to 3 times at 30-second intervals. If it still fails:

> The verification is in progress but the DNS records have not propagated yet. This can take a few minutes. You can check the status on app.brevo.com -> Senders, Domains & Dedicated IPs -> Domains.

---

## Step 5 - Update the project

1. Update `CONTACT_EMAIL` (or the project's sender email variable) in `.env`:
```
CONTACT_EMAIL=contact@<domain>
```

2. Invoke `_push-env-vars` with:
   - `CONTACT_EMAIL=contact@<domain>`

The helper updates the local `.env` AND Vercel (production/preview/development) idempotently.

3. Update CLAUDE.md if the sender email is mentioned there.

4. Inform the user:

> ✅ **Domain connected to Brevo!** Your emails will now be sent from `contact@<domain>`.
>
> If the DNS verification is still in progress, emails will not be sent until it completes. Check the status on app.brevo.com -> Domains.

Hand control back to `/add-domain`.
