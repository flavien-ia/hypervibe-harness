---
name: _dns-resend
description: "Internal skill called by /add-domain. Configures a custom domain in Resend for professional email sending via the Resend REST API (curl + key from the vault). Adds the DNS records (SPF, DKIM, MX bounce) via the Cloudflare REST API (curl + Cloudflare token from the vault). No Resend CLI. Not meant to be called directly by users."
user-invocable: false
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# DNS Resend - Configure an email sending domain (REST API)

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

Internal skill called by `/add-domain`. Configures a custom domain in Resend so that emails are sent from `contact@mydomain.com` instead of `onboarding@resend.dev`. **No more Resend CLI**: everything goes through the REST API `https://api.resend.com` with the key from the vault.

**Prerequisites:** the domain is already connected to Vercel, DNS is managed by Cloudflare, and the vault contains the keys `RESEND.api_key` and `CLOUDFLARE.api_token`.

## Preamble - keys from the vault

```bash
VAULT="${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs"
RTOK=$(node "$VAULT" get RESEND api_key); RC=$?       # Resend key (read+write)
CFTOK=$(node "$VAULT" get CLOUDFLARE api_token)        # Cloudflare token
```
For each `get`, apply the `_get-secret` pattern: `RC` 2/3 → unlock then retry; `RC` 4 → the key is not in the vault, suggest `launch.mjs add` (Resend: `--name RESEND --service Resend --fields "api_key:secret"`; Cloudflare: `--name CLOUDFLARE --service Cloudflare --fields "api_token:secret"`). **Never display `$RTOK`/`$CFTOK`.**

---

## Step 1 - Check the prerequisites

`_check-deps email` to confirm the provider:
```bash
result=$(node "${CLAUDE_SKILL_DIR}/../../scripts/check-deps.mjs" email)
email_provider=$(echo "$result" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).email.provider || 'none')")
```
Specific to **Resend**: if `email_provider !== "resend"` → abort (the calling skill has normally already done the check). The presence of the Resend key is guaranteed by the preamble (otherwise `get` returns RC 4 → we have it added).

---

## Step 2 - Create the domain in Resend (API)

```bash
curl -s -X POST "https://api.resend.com/domains" \
  -H "Authorization: Bearer $RTOK" -H "Content-Type: application/json" \
  -d '{"name":"<domain>","region":"eu-west-1"}'
```
(Default region `eu-west-1` for FR/EU; otherwise `us-east-1`, `sa-east-1`, `ap-northeast-1`.)

The JSON response contains:
- `id`: the Resend ID of the domain (keep it for Step 4)
- `records[]`: each record has a `type` (TXT/MX), `name`, `value`, and `priority` (MX). Typically: 1 TXT SPF (root, `v=spf1 include:amazonses.com ~all`), 1 TXT DKIM (`resend._domainkey.<domain>`, `p=...`), 1 MX bounce (priority 10, `feedback-smtp.<region>.amazonses.com`).

Extract and store these records.

---

## Step 3 - Add the DNS records via the Cloudflare API (curl)

### 3.a - Zone ID
```bash
ZONE_ID=$(curl -s -H "Authorization: Bearer $CFTOK" \
  "https://api.cloudflare.com/client/v4/zones?name=<domain>" \
  | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.result?.[0]?.id || '');")
```
Empty → error (the zone must exist, `/add-domain` created it). Abort.

### 3.b - Add each record returned by Resend

**TXT** (SPF, DKIM):
```bash
curl -s -X POST -H "Authorization: Bearer $CFTOK" -H "Content-Type: application/json" \
  -d "{\"type\":\"TXT\",\"name\":\"<name>\",\"content\":\"<value>\",\"ttl\":3600,\"proxied\":false}" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records"
```
**MX** (bounce):
```bash
curl -s -X POST -H "Authorization: Bearer $CFTOK" -H "Content-Type: application/json" \
  -d "{\"type\":\"MX\",\"name\":\"<name>\",\"content\":\"<value>\",\"priority\":<priority>,\"ttl\":3600,\"proxied\":false}" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records"
```
**⚠️ Always `\"proxied\":false`** for email authentication records. **Duplicates** (error 81057): if identical → skip; otherwise PUT on the existing record (retrieve its ID via GET `?name=<name>`).

---

## Step 4 - Trigger verification in Resend (API)

Wait ~15 s (DNS propagation), then:
```bash
curl -s -X POST "https://api.resend.com/domains/<id>/verify" -H "Authorization: Bearer $RTOK"
```
Poll the status:
```bash
curl -s "https://api.resend.com/domains/<id>" -H "Authorization: Bearer $RTOK" \
  | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).status)"
```
`status` must change to `verified`. If `pending` → wait 30 s, retry up to 3 times. Still pending:

> Verification is in progress but DNS has not propagated yet (up to a few minutes). You can check at https://resend.com/domains.

---

## Step 5 - Update the project

1. `_push-env-vars` with `RESEND_FROM_EMAIL=contact@<domain>` (updates the local `.env` AND Vercel, idempotent).
2. Update CLAUDE.md if the sending email is mentioned there.
3. Inform:

> ✅ **Domain connected to Resend!** Your emails will be sent from `contact@<domain>` instead of `onboarding@resend.dev`.
>
> If DNS verification is still in progress, emails will not be sent until it is complete.

Hand control back to `/add-domain`.
