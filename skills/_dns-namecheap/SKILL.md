---
name: _dns-namecheap
description: Internal - change a Namecheap-registered domain's nameservers to point to Cloudflare. Uses Namecheap's REST API directly via curl (no CLI install). Triggered by /add-domain when the registrar is Namecheap.
user-invocable: false
allowed-tools: Read Edit Write Bash
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# _dns-namecheap - Point a Namecheap domain to Cloudflare

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You receive as input: `<domain>`, `<ns1_cloudflare>`, `<ns2_cloudflare>`. Your job: change the domain's nameservers at Namecheap. You then return to `/add-domain`.

No CLI installation needed - the Namecheap API is a simple REST endpoint (XML response) that you call with a direct `curl`.

## ⚠️ Namecheap eligibility gate (flag to the user BEFORE any operation)

Namecheap restricts API access to accounts that meet **at least one** of the following conditions:
- **20 domains** or more on the account
- **50 USD balance** on the account
- **50 USD spent** over the last 2 years

If none of these conditions is met, the "API Access" toggle does not appear in the dashboard and there is **no way** to unlock it other than contacting Namecheap support.

Warn the user right from the start:

> ⚠️ Namecheap reserves the API for accounts that have at least **20 domains**, OR a **50 USD balance**, OR **50 USD spent over 2 years**. Do you meet at least one of these conditions?

- If **no** → go straight to **Step 4 (manual mode)**. No point wasting the user's time.
- If **yes** → continue to Step 1.

## Step 1 - Check whether the Namecheap credentials are already in place

Namecheap requires 3 values (the username appears twice, that's normal - the API accepts reseller→client delegation) + the whitelisted IP:

- `NAMECHEAP_USER` (username) + `NAMECHEAP_API_KEY` (key) → **vault**, item `NAMECHEAP` (fields `user` / `api_key`)
- `NAMECHEAP_CLIENT_IP` = the machine's public IP, recomputed on the fly (`curl ifconfig.me`), must be whitelisted on the Namecheap side

Make sure the vault is open (follow `_ensure-vault`), load the credentials and test:

```bash
VAULT="${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs"
export NAMECHEAP_USER=$(node "$VAULT" get NAMECHEAP user 2>/dev/null)
export NAMECHEAP_API_KEY=$(node "$VAULT" get NAMECHEAP api_key 2>/dev/null)
export NAMECHEAP_CLIENT_IP=$(curl -s ifconfig.me)
if [ -n "$NAMECHEAP_USER" ] && [ -n "$NAMECHEAP_API_KEY" ] && [ -n "$NAMECHEAP_CLIENT_IP" ]; then
  RESP=$(curl -s "https://api.namecheap.com/xml.response?ApiUser=$NAMECHEAP_USER&ApiKey=$NAMECHEAP_API_KEY&UserName=$NAMECHEAP_USER&ClientIp=$NAMECHEAP_CLIENT_IP&Command=namecheap.users.getBalances")
  echo "$RESP" | grep -q 'Status="OK"' && echo "VALID" || echo "INVALID"
fi
```

- **If `VALID`** → go to Step 3.
- **Otherwise** → Step 2.

## Step 2 - Enable the API + whitelist the IP + retrieve the key

Find the machine's public IP upfront (it will be needed in the dashboard):

```bash
PUBLIC_IP=$(curl -s ifconfig.me)
echo "Your public IP: $PUBLIC_IP"
```

Guide the user (3 actions on the same page):

> To enable the Namecheap API, do these 3 actions on **the same page**:
>
> **A. Open the API page**
> Go to **https://ap.www.namecheap.com/settings/tools/apiaccess/**
> (or: Namecheap dashboard → your avatar → **Profile** → **Tools** → look for "Namecheap API Access")
>
> **B. Turn on the toggle**
> Switch **"API Access"** to **ON**. You will see these appear:
> - **ApiUser** (= your Namecheap username)
> - **ApiKey** (a long hex string)
>
> **C. Whitelist your IP**
> On the same page, **"Whitelisted IPs"** section → click **"Edit"** or **"Add IP"** → enter **`$PUBLIC_IP`** → confirm.
>
> Then give me:
> - Your **ApiUser** (= username)
> - Your **ApiKey**

(The `$PUBLIC_IP` above is replaced by the real IP in the message.)

When the user provides the username + ApiKey, store them in the **vault** (masked-input window - the values do not pass through the chat):

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/vault/launch.mjs" add --name NAMECHEAP --service Namecheap --fields "user:text,api_key:secret"
```

Then load them into the session (the public IP is recomputed, not stored - it can change):
```bash
export NAMECHEAP_USER=$(node "$VAULT" get NAMECHEAP user)
export NAMECHEAP_API_KEY=$(node "$VAULT" get NAMECHEAP api_key)
export NAMECHEAP_CLIENT_IP=$(curl -s ifconfig.me)
```

Validate by replaying the test from Step 1.

**If validation fails with `Status="ERROR"`**: read the Namecheap error code (the XML contains `<Error Number="...">...</Error>`):
- Error `1011150` or similar → the IP is not in the whitelist (or not exactly the same - avoid IPv6, use strict IPv4).
- Error `1010102` → invalid API key.
- Format error → username copied incorrectly.

## Step 3 - Change the nameservers

The `namecheap.domains.dns.setCustom` API expects the domain **split into SLD + TLD**:

- `mysite.fr` → SLD=`mysite`, TLD=`fr`
- `mysite.co.uk` → SLD=`mysite`, TLD=`co.uk`

Split it cleanly with a small Node script (handles simple compound TLDs):

```bash
SLD=$(node -e "
const d = '<domain>'.toLowerCase();
const parts = d.split('.');
// Common two-level public-suffix TLDs
const TWO_LEVEL = new Set(['co.uk','co.nz','com.au','co.za','co.in','com.br','com.mx','co.jp']);
const tail2 = parts.slice(-2).join('.');
const tld = TWO_LEVEL.has(tail2) ? tail2 : parts[parts.length - 1];
const tldParts = tld.split('.').length;
console.log(parts.slice(0, -tldParts).join('.'));
")
TLD=$(node -e "
const d = '<domain>'.toLowerCase();
const parts = d.split('.');
const TWO_LEVEL = new Set(['co.uk','co.nz','com.au','co.za','co.in','com.br','com.mx','co.jp']);
const tail2 = parts.slice(-2).join('.');
console.log(TWO_LEVEL.has(tail2) ? tail2 : parts[parts.length - 1]);
")
echo "SLD=$SLD  TLD=$TLD"
```

API call (XML response):

```bash
RESP=$(curl -s \
  --data-urlencode "ApiUser=$NAMECHEAP_USER" \
  --data-urlencode "ApiKey=$NAMECHEAP_API_KEY" \
  --data-urlencode "UserName=$NAMECHEAP_USER" \
  --data-urlencode "ClientIp=$NAMECHEAP_CLIENT_IP" \
  --data-urlencode "Command=namecheap.domains.dns.setCustom" \
  --data-urlencode "SLD=$SLD" \
  --data-urlencode "TLD=$TLD" \
  --data-urlencode "Nameservers=<ns1_cloudflare>,<ns2_cloudflare>" \
  -G "https://api.namecheap.com/xml.response")

# Parse the status
if echo "$RESP" | grep -q 'Status="OK"'; then
  echo "✅ NS updated"
else
  echo "❌ Namecheap error:"
  echo "$RESP" | grep -oE '<Error Number="[0-9]+">[^<]+</Error>' | head -3
fi
```

Verification (may show the old NS for a few minutes):

```bash
curl -s \
  --data-urlencode "ApiUser=$NAMECHEAP_USER" \
  --data-urlencode "ApiKey=$NAMECHEAP_API_KEY" \
  --data-urlencode "UserName=$NAMECHEAP_USER" \
  --data-urlencode "ClientIp=$NAMECHEAP_CLIENT_IP" \
  --data-urlencode "Command=namecheap.domains.dns.getList" \
  --data-urlencode "SLD=$SLD" \
  --data-urlencode "TLD=$TLD" \
  -G "https://api.namecheap.com/xml.response" | grep -oE '<Nameserver>[^<]+</Nameserver>'
```

## Step 4 - Manual mode (ineligibility fallback OR refusal of the API procedure)

> Go to **https://ap.www.namecheap.com/Domains/DomainControlPanel/<domain>** → **"Domain"** tab → **"Nameservers"** section → choose **"Custom DNS"** → enter:
> - `<ns1_cloudflare>`
> - `<ns2_cloudflare>`
>
> Click the green ✓ to confirm. Let me know when it's done.

## Return to add-domain

> ✅ Domain `<domain>` nameservers pointed to Cloudflare. Propagation: 5-30 min.
