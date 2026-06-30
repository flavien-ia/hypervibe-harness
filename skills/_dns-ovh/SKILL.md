---
name: _dns-ovh
description: Internal - change an OVH-registered domain's nameservers to point to Cloudflare. Uses OVH's REST API v1 directly with signed headers (no CLI install). Triggered by /add-domain when the registrar is OVH.
user-invocable: false
allowed-tools: Read Edit Write Bash
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# _dns-ovh - Point an OVH domain to Cloudflare

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You receive as input: `<domain>`, `<ns1_cloudflare>`, `<ns2_cloudflare>`. Your job: change the domain's nameservers at OVH so they point to `<ns1_cloudflare>` and `<ns2_cloudflare>`. You then return to `/add-domain`.

No CLI install needed - we call the OVH REST API v1 directly with signed headers (sha1).

## Step 1 - Check whether the OVH credentials are already in place

OVH requires 3 values (its long-standing auth model, still in effect), stored in the **vault** (item `OVH`, fields `app_key` / `app_secret` / `consumer_key`).

Make sure the vault is open (follow `_ensure-vault`), then load them and test:

```bash
VAULT="${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs"
export OVH_APP_KEY=$(node "$VAULT" get OVH app_key 2>/dev/null)
export OVH_APP_SECRET=$(node "$VAULT" get OVH app_secret 2>/dev/null)
export OVH_CONSUMER_KEY=$(node "$VAULT" get OVH consumer_key 2>/dev/null)
if [ -n "$OVH_APP_KEY" ] && [ -n "$OVH_APP_SECRET" ] && [ -n "$OVH_CONSUMER_KEY" ]; then
  TS=$(curl -s https://eu.api.ovh.com/1.0/auth/time)
  METHOD="GET"
  URL="https://eu.api.ovh.com/1.0/me"
  SIG_INPUT="${OVH_APP_SECRET}+${OVH_CONSUMER_KEY}+${METHOD}+${URL}++${TS}"
  SIG="\$1\$$(printf '%s' "$SIG_INPUT" | sha1sum | cut -d' ' -f1)"
  curl -s -o /dev/null -w "%{http_code}" \
    -H "X-Ovh-Application: $OVH_APP_KEY" \
    -H "X-Ovh-Consumer: $OVH_CONSUMER_KEY" \
    -H "X-Ovh-Timestamp: $TS" \
    -H "X-Ovh-Signature: $SIG" \
    "$URL"
fi
```

- **If it returns `200`** -> go to Step 3.
- **Otherwise** -> Step 2.

## Step 2 - Generate the 3 credentials in one go

OVH's `createToken` form returns all 3 values (AK, AS, CK) in a single shot - no need to create a separate "Application". This is the flow OVH recommends for scripts/automations.

Guide the user:

> I need OVH API credentials to change your domain's nameservers. OVH generates 3 keys at once through a single web page:
>
> 1. Go to **https://api.ovh.com/createToken/?GET=/me&GET=/domain&GET=/domain/*&PUT=/domain/*&POST=/domain/***
>    (the `GET/PUT/POST` parameters pre-fill the required permissions: read the account + read/modify domains)
> 2. Log in with your OVH account (Account ID + password)
> 3. **Account ID**: your OVH customer ID (e.g. `aa12345-ovh`)
> 4. **Password**: your usual OVH password
> 5. **Validity**: choose **"Unlimited"** (so you don't have to renew it in 24h)
> 6. Click **"Create keys"**
> 7. The next page shows 3 values **only once**:
>    - **Application Key**
>    - **Application Secret**
>    - **Consumer Key**
> 8. Copy them and give them to me (all 3 together).

Once the user has generated their 3 keys, store them in the **vault** (masked-input window - the values never pass through the chat):

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/vault/launch.mjs" add --name OVH --service OVH --fields "app_key:text,app_secret:secret,consumer_key:secret"
```

Then load them into the current session to continue right away:
```bash
export OVH_APP_KEY=$(node "$VAULT" get OVH app_key)
export OVH_APP_SECRET=$(node "$VAULT" get OVH app_secret)
export OVH_CONSUMER_KEY=$(node "$VAULT" get OVH consumer_key)
```

Validate by re-running the Step 1 test. If it still fails, check that the user ticked **all** the permissions on the form (the provided link ticks them by default, but OVH may show an additional confirmation screen).

## Step 3 - Change the nameservers (2 API calls)

The OVH API requires **2 steps** to change the NS (verified in the DNSControl source, 2026-05):

1. **Switch the domain to "external" mode** (by default OVH is in "hosted" mode and blocks NS changes)
2. **Push the new NS list**

### OVH signature helper (paste into the bash session)

```bash
ovh_signed_call() {
  # Usage: ovh_signed_call METHOD PATH [BODY]
  local method="$1" path="$2" body="${3:-}"
  local url="https://eu.api.ovh.com/1.0${path}"
  local ts
  ts=$(curl -s https://eu.api.ovh.com/1.0/auth/time)
  local sig_input="${OVH_APP_SECRET}+${OVH_CONSUMER_KEY}+${method}+${url}+${body}+${ts}"
  local sig="\$1\$$(printf '%s' "$sig_input" | sha1sum | cut -d' ' -f1)"
  curl -s -X "$method" \
    -H "X-Ovh-Application: $OVH_APP_KEY" \
    -H "X-Ovh-Consumer: $OVH_CONSUMER_KEY" \
    -H "X-Ovh-Timestamp: $ts" \
    -H "X-Ovh-Signature: $sig" \
    -H "Content-Type: application/json" \
    ${body:+-d "$body"} \
    -w "\nHTTP:%{http_code}\n" \
    "$url"
}
```

### 3.a - Switch the domain to "external" mode

```bash
ovh_signed_call PUT "/domain/<domain>" '{"nameServerType":"external"}'
```

Expected response: `HTTP:200` (empty body).

### 3.b - Push the new NS list

```bash
ovh_signed_call POST "/domain/<domain>/nameServers/update" \
  '{"nameServers":[{"host":"<ns1_cloudflare>"},{"host":"<ns2_cloudflare>"}]}'
```

Expected response: `HTTP:200` with a `Task` JSON object. The `status` may be `todo` (queued) - that's normal, OVH processes the change asynchronously (a few minutes).

### 3.c - Verification (optional, may show the old NS for 5-30 min)

```bash
ovh_signed_call GET "/domain/<domain>/nameServer"
# Then for each ID:
ovh_signed_call GET "/domain/<domain>/nameServer/<id>"
```

Don't block on this check - OVH's internal propagation takes time. Public DNS propagation (5-30 min) is longer anyway.

## Step 4 - Manual mode (ONLY if the user explicitly asks for it)

If the user refuses to generate API credentials:

> Go to **https://www.ovh.com/manager/** -> **Web Cloud** -> **Domain names** -> your domain -> **DNS servers** tab -> **Modify DNS servers** -> choose **"Custom"**
>
> Replace them with:
> - `<ns1_cloudflare>`
> - `<ns2_cloudflare>`
>
> Confirm. Tell me when it's done.

## Return to add-domain

> Nameservers for domain `<domain>` now point to Cloudflare. Propagation: 5-30 min (sometimes up to 24h at OVH depending on the TLD).
