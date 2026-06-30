---
name: add-domain
description: "Guide the user to connect a custom domain to their Vercel-deployed app. Target architecture: <Registrar> -> Cloudflare (DNS + Email Routing) -> Vercel (hosting). Supports Hostinger, Cloudflare, OVH, Namecheap, Gandi, Porkbun, Infomaniak, IONOS, Squarespace (ex-Google Domains), and GoDaddy. Branches to a `_dns-<provider>` sub-skill for the nameserver change. Optionally configures Resend for sending."
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Add Domain - Connect a domain name

You guide the user to connect a domain name to their Vercel app. The target architecture: **<Registrar> -> Cloudflare (DNS + Email Routing) -> Vercel (hosting)**.

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

Cloudflare is needed for **Email Routing** (receiving emails at `contact@mydomain.com` redirected to a real mailbox) AND to benefit from their fast DNS + free DDoS protection.

---

## Step 0 - Vault unlocked

This skill (and the `_dns-*` ones it calls) reads the Cloudflare token + the registrar token from the vault, so first make sure it is unlocked (follow **`_ensure-vault`**): `node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" status` -> if `locked`/`expired`, run `launch.mjs unlock`; if the vault does not exist, delegate to `_add-keyring`.

---

## Step 1 - Check prerequisites

Invoke the internal skill `_detect-project-root` to retrieve `PROJECT_NAME`, `WEB_DIR`, `IS_NEXTJS`. Abort if `IS_NEXTJS=no`.

Check that the project is indeed deployed on Vercel:
```bash
vercel ls 2>/dev/null | head -5
```

If the project is not yet deployed, tell the user to deploy first (say "deploy"; or `/bootstrap` if the app does not exist yet).

---

## Step 2 - Domain: already bought or not?

> Do you already have a domain name, or do you need to buy one?

### If a purchase is needed

> I recommend **Hostinger** (French UI/support/billing, .fr supported, and it's the registrar we automate best in this plugin).
>
> 1. Go to **https://www.hostinger.fr/achat-nom-de-domaine**
> 2. Search for the domain you want (e.g. `myproject.fr`)
> 3. Add it to the cart and complete the purchase
>
> `.fr`: ~6-10 EUR/year - `.com`: ~10-15 EUR/year
>
> Let me know when it's done + the exact domain name.

-> When the purchase is confirmed, the registrar is **Hostinger**. Move to Step 4 with `registrar=hostinger`.

### If the domain already exists

Ask:
> What is the exact domain name?

Then Step 3.

---

## Step 3 - Identify the registrar

> Which registrar is this domain registered with?
>
> - **Hostinger** (FR-friendly, official MCP)
> - **Cloudflare** (registrar + DNS in the same place)
> - **OVH** (FR, direct API - 3 keys to generate on a single page)
> - **Namecheap** (direct API - reserved for accounts with 20+ domains OR 50 USD of balance/spend)
> - **Gandi** (FR, simple API with a Personal Access Token)
> - **Porkbun** (US, free and clean API - a favorite among indie hackers)
> - **Infomaniak** (Switzerland - manual for the NS, but a clean API to automate other things afterward)
> - **IONOS** (ex-1&1, EU - manual for the NS, IONOS API available for DNS records)
> - **Squarespace** (ex-Google Domains - manual only, the Google API was killed in 2024)
> - **GoDaddy** (manual only - their API does not allow automation for this)
> - **Other** (OnlyDomains, NameSilo, Name.com, etc. - guided manual)

Store the answer in `<registrar>`. Move to Step 4.

---

## Step 4 - Cloudflare preflight

Cloudflare is our **DNS provider** in every case (except when registrar=Cloudflare, where it is already covered by default).

**Cloudflare architecture in hypervibe**: all DNS operations go through the Cloudflare REST API via `curl` + the `CLOUDFLARE_API_TOKEN` token. No `flarectl`, no MCP.

### 4.a - Preflight via `_check-deps cloudflare`

```bash
result=$(node "${CLAUDE_SKILL_DIR}/../../scripts/check-deps.mjs" cloudflare)
cf_ok=$(echo "$result" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).cloudflare.ok)")
```

**If `cf_ok = true`** (CF token present AND valid against the API) -> move to Step 5. Nothing to configure.

**If `cf_ok = false`** -> route to `/start` so the user creates their Cloudflare token:

> DNS will be managed by Cloudflare (free, fast, and essential for Email Routing). I need your Cloudflare account connected to your computer. That's not set up yet.
>
> Run **`/start`** - it creates a Cloudflare API token in 2 guided minutes, which will be used for all the plugin's Cloudflare operations (DNS, Workers, R2). Then you re-run `/add-domain` and I pick up here.

### 4.b - After configuration, re-check

Once the user has run `/start`, re-invoke `_check-deps cloudflare` to confirm. Only continue to Step 5 if `cf_ok = true`.

---

## Step 5 - Add the domain in Cloudflare + retrieve the nameservers

### 5.a - Check whether the zone already exists

```bash
ZONE_RESPONSE=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones?name=<domain>")
ZONE_ID=$(echo "$ZONE_RESPONSE" | node -e "const d = JSON.parse(require('fs').readFileSync(0, 'utf8')); console.log(d.result?.[0]?.id || '');")
```

### 5.b - If the zone does not exist, create it

Retrieve the `account_id` then POST the zone:

```bash
ACCOUNT_ID=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts" \
  | node -e "const d = JSON.parse(require('fs').readFileSync(0, 'utf8')); console.log(d.result?.[0]?.id || '');")

CREATE_RESPONSE=$(curl -s -X POST -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"<domain>\",\"account\":{\"id\":\"$ACCOUNT_ID\"},\"type\":\"full\"}" \
  "https://api.cloudflare.com/client/v4/zones")

ZONE_ID=$(echo "$CREATE_RESPONSE" | node -e "const d = JSON.parse(require('fs').readFileSync(0, 'utf8')); console.log(d.result?.id || '');")
```

### 5.c - Retrieve the assigned nameservers

```bash
NS_INFO=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID")
NS1=$(echo "$NS_INFO" | node -e "const d = JSON.parse(require('fs').readFileSync(0, 'utf8')); console.log(d.result?.name_servers?.[0] || '');")
NS2=$(echo "$NS_INFO" | node -e "const d = JSON.parse(require('fs').readFileSync(0, 'utf8')); console.log(d.result?.name_servers?.[1] || '');")
```

Store `ZONE_ID`, `NS1`, `NS2` for later.

**Special case**: if `<registrar> == cloudflare` AND the zone is managed by Cloudflare natively (Cloudflare Registrar) -> no need to change the NS, **skip Step 6** and move to Step 7.

---

## Step 6 - Change the nameservers at the registrar (sub-skill)

Branch to the sub-skill matching the registrar:

| `<registrar>` | Sub-skill |
|---|---|
| `hostinger` | `_dns-hostinger` |
| `cloudflare` | `_dns-cloudflare` (skipped in practice, see Step 5) |
| `ovh` | `_dns-ovh` |
| `namecheap` | `_dns-namecheap` |
| `gandi` | `_dns-gandi` |
| `porkbun` | `_dns-porkbun` |
| `infomaniak` | `_dns-infomaniak-manual` |
| `ionos` | `_dns-ionos-manual` |
| `squarespace` | `_dns-squarespace-manual` |
| `godaddy` | `_dns-godaddy-manual` |
| `other` | guide manually (see bottom of this section) |

Read and run the sub-skill's SKILL.md, passing it: `<domain>`, `$NS1`, `$NS2`. The sub-skill detects whether the registrar's MCP/CLI is connected -> if yes, pushes the NS directly; if not, guides the install + the auth + pushes. **Always favor the auto-install** of an MCP/CLI over the manual mode: it will be reused for other projects and for future changes.

### Manual mode (registrar `other` or explicit refusal of the auto-install)

> Go to your registrar's panel -> find the **"Nameservers"** or **"DNS"** section of your domain -> choose **"Custom nameservers"** -> replace with:
> - `$NS1`
> - `$NS2`
>
> Save. Let me know when it's done.

Wait for confirmation.

---

## Step 7 - Configure the DNS records in Cloudflare (curl)

Use the Cloudflare REST API via curl - `ZONE_ID` was stored in Step 5.

### 7.a - Delete the old A and CNAME records for `@` and `www` (if they exist)

```bash
# List all the records in the zone
RECORDS=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?per_page=100")

# Extract the IDs of the records to delete (A on @ and CNAME on www.<domain>)
echo "$RECORDS" | node -e "
const d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const domain = '<domain>';
const toDelete = d.result.filter(r =>
  (r.type === 'A' && (r.name === domain)) ||
  (r.type === 'CNAME' && (r.name === 'www.' + domain))
);
for (const r of toDelete) console.log(r.id);
" | while read RID; do
  curl -s -X DELETE -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$RID"
done
```

### 7.b - Add the Vercel records

```bash
# A record: @ -> 76.76.21.21 (apex, proxy off)
curl -s -X POST -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"A\",\"name\":\"<domain>\",\"content\":\"76.76.21.21\",\"ttl\":3600,\"proxied\":false}" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records"

# CNAME record: www -> cname.vercel-dns.com (proxy off)
curl -s -X POST -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"CNAME\",\"name\":\"www\",\"content\":\"cname.vercel-dns.com\",\"ttl\":3600,\"proxied\":false}" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records"
```

**Warning: `\"proxied\":false` is mandatory** - Vercel manages its own HTTPS certificate and routing. The Cloudflare proxy interferes.

### 7.c - Check that the records are in place

```bash
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?type=A&name=<domain>"
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?type=CNAME&name=www.<domain>"
```

> ✅ DNS configured! The records point to Vercel.

---

## Step 8 - Configure Vercel and update the project

### 1. Add the domain in Vercel

```bash
vercel domains add <domain>
```

If it does not work via the CLI:
> Go to https://vercel.com -> your project -> Settings -> Domains -> Add Domain

### 2. Update the environment variables

Invoke `_push-env-vars` with:
- `NEXT_PUBLIC_APP_URL=https://<domain>`

The helper updates the local `.env` AND Vercel (production/preview/development) in a single operation, idempotently.

### 3. Eliminate the vercel.app URLs from the code

**This step is critical for SEO.** If `*.vercel.app` URLs remain in the code (sitemaps, metadata, JSON-LD, Open Graph), Google indexes the wrong URLs and the ranking is diluted.

1. **Search** for all occurrences of `*.vercel.app` in the source code:
   ```bash
   grep -r "vercel\.app" <WEB_DIR>/src/ --include="*.ts" --include="*.tsx" -l
   ```

2. **Replace** each occurrence with either:
   - `process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"` (for runtime code)
   - `https://<domain>` (for static content such as legal pages)

3. **Files to check as a priority**:
   - `<WEB_DIR>/src/app/sitemap.ts` - the `baseUrl` must use `process.env.NEXT_PUBLIC_APP_URL`
   - `<WEB_DIR>/src/app/layout.tsx` or `<WEB_DIR>/src/app/[locale]/layout.tsx` - `metadataBase`, JSON-LD, Open Graph URLs
   - `<WEB_DIR>/src/app/robots.ts` - the sitemap URL
   - Legal pages (legal notice, privacy)

4. **Check that no occurrence remains**:
   ```bash
   grep -r "vercel\.app" <WEB_DIR>/src/ --include="*.ts" --include="*.tsx"
   ```
   If the grep returns results, fix until it is empty.

### 4. Update CLAUDE.md

Invoke `_update-claude-md` with:
- `custom`:
  - heading: `## Custom domain`
  - body:
    ```
    The production domain is `<domain>`.
    Architecture: <Registrar> (registrar) -> Cloudflare (DNS) -> Vercel (hosting).
    HTTPS certificate managed automatically by Vercel.
    ```

### 5. Verify

```bash
vercel domains inspect <domain>
```

If it does not work yet:
> DNS propagation can take 5 to 30 minutes (rarely more, sometimes up to 24h). Try again in a few minutes.

⚠️ The audit of the integrations that depended on the old domain (OAuth, Stripe webhook, Analytics, etc.) is done in **Step 11**, after the Email Routing / Resend options - do not do it here, otherwise we ask the user to update Resend twice.

---

## Step 9 - Cloudflare Email Routing (optional)

Offer:

> Do you want to set up receiving emails on your domain (for example `contact@<domain>` redirected to your real mailbox: Gmail, Outlook, etc.)?
>
> **Shall I set that up?**

If **no** -> move to Step 10.

If **yes** -> ask for the destination address:

> Which email address do you want to redirect the messages to?

Then **delegate to the `/new-email-address` skill**: read and run `new-email-address/SKILL.md`, passing it the destination address as an argument. The skill handles enabling Email Routing on the zone (idempotent), asking the user for the desired prefix (`contact`, `hello`, `support`...), adding the destination address to Cloudflare, handling the email verification, and creating the redirection rule.

**Case where delegation fails**: if `ZONE_ID` or `ACCOUNT_ID` is not available in context at the moment of delegation, the sub-skill re-retrieves them via its Step 3 from `<domain>`. No variable to propagate explicitly other than the destination address.

---

## Step 10 - Resend proposal (optional)

Silently check whether Resend is configured: look for `RESEND_API_KEY` in the `.env` or `resend` in the dependencies.

**If Resend is configured**, offer:

> Now that you have your own domain, I can configure Resend so that your **outgoing** emails are sent from `contact@<domain>` instead of `onboarding@resend.dev`. It's more professional and improves deliverability.
>
> **Shall I set that up?**

If yes -> read and run the `_dns-resend/SKILL.md` skill
If no -> skip

**If Resend is not configured**, offer nothing.

---

## Step 11 - Audit of the integrations that depend on the old domain

The domain change has probably desynchronized several integrations that still pointed to the previous Vercel URL:

- **Stripe webhooks** - payments silently broken (`POST` to a dead URL)
- **OAuth providers (Google, GitHub)** - login crashes with `redirect_uri_mismatch`
- **Google Analytics 4** - stream with the old URL, some hostname-based reports are inconsistent
- **Google Search Console** - the property points to the old hostname

This step **detects what is installed**, **automatically fixes** what is CLI-able (Stripe, Resend already done in Step 10), and lists the remaining **manual actions** with auto-open of the dashboard. It is **non-negotiable**: a silently broken Stripe webhook is exactly the kind of bug that misses payments for days without anyone noticing.

### 11.1 - Detect the installed integrations

Run this block once to detect what is in the project:

```bash
WEB="<WEB_DIR>"
ENV="$WEB/.env"
PKG="$WEB/package.json"

has_env() { grep -q "^$1=" "$ENV" 2>/dev/null && echo yes || echo no; }
has_real_env() {
  # Skip placeholder / empty values (bootstrap injects placeholders)
  local v
  v=$(grep "^$1=" "$ENV" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')
  [ -n "$v" ] && ! echo "$v" | grep -qiE "placeholder|todo|xxx|change.?me|your-" && echo yes || echo no
}

echo "STRIPE=$(has_real_env STRIPE_SECRET_KEY)"
echo "GOOGLE_OAUTH=$(has_real_env AUTH_GOOGLE_ID)"
echo "GITHUB_OAUTH=$(has_real_env AUTH_GITHUB_ID)"
echo "GA4=$(has_real_env NEXT_PUBLIC_GA_ID)"
echo "RESEND=$(has_real_env RESEND_API_KEY)"
echo "BREVO=$(has_real_env BREVO_API_KEY)"
```

Capture each `KEY=yes/no` line in memory. Skip the blocks below for the integrations that return `no`.

### 11.2 - Auto-fix: Stripe webhook (if Stripe installed)

If `STRIPE=yes`, run the block below. It lists the webhook endpoints, identifies those whose URL contains `vercel.app`, and updates them to `https://<domain>/api/webhooks/stripe` (or whatever path is already configured on the webhook - we only replace the host).

```bash
NEW_DOMAIN="<domain>"
PAYLOAD=$(stripe webhook_endpoints list --limit 30 2>/dev/null) || { echo "STRIPE_FIX=cli_error"; exit 0; }
echo "$PAYLOAD" | node -e "
const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const obsolete = (data.data || []).filter(w => /\.vercel\.app/.test(w.url));
if (obsolete.length === 0) { console.log('STRIPE_FIX=none'); process.exit(0); }
const NEW = process.env.NEW_DOMAIN;
for (const w of obsolete) {
  const newUrl = w.url.replace(/https:\/\/[^/]*\.vercel\.app/, 'https://' + NEW);
  console.log('PATCH=' + w.id + '|' + w.url + '|' + newUrl);
}
" | while IFS='|' read -r tag ID OLD NEW_URL; do
  [ "$tag" = "PATCH" ] || continue
  stripe webhook_endpoints update "$ID" --url "$NEW_URL" >/dev/null 2>&1 \
    && echo "STRIPE_FIX_OK=$ID|$OLD → $NEW_URL" \
    || echo "STRIPE_FIX_FAIL=$ID|$OLD"
done
```

Depending on the output:
- `STRIPE_FIX=none` -> nothing to fix, no vercel.app webhook found. Silent skip.
- `STRIPE_FIX_OK=...` -> announce to the user: `✅ Stripe webhook updated: <old> → <new>`. Test by re-listing: `stripe webhook_endpoints retrieve <id> --output json | grep url`.
- `STRIPE_FIX_FAIL=...` -> put it in the manual-actions stack (see 11.5) and log the cause (probably a restricted API key permission).
- `STRIPE_FIX=cli_error` -> the Stripe CLI is not authenticated. Re-trigger `_setup-stripe-cli` then retry.

### 11.3 - Auto-fix: Cloudflare Workers env vars

`/add-cron` and the CF variant of `/add-automation` write the Vercel URL directly into the Worker's `wrangler.toml` (`[vars]` section). When the domain changes, the Worker keeps pinging the old URL -> cron silently broken.

Run the block below once. It scans all the repo's `wrangler.toml` files, patches the URLs that contain `.vercel.app`, and redeploys each affected Worker.

```bash
NEW_DOMAIN="<domain>"
# Search the whole project (not just WEB_DIR) - workers can live in apps/worker/
# in a monorepo or at the repo root in a single-project layout.
REPO_ROOT=$(cd "<WEB_DIR>" && git rev-parse --show-toplevel 2>/dev/null || echo "<WEB_DIR>")

WT_LIST=$(find "$REPO_ROOT" -name "wrangler.toml" -not -path "*/node_modules/*" -not -path "*/.next/*" 2>/dev/null)

if [ -z "$WT_LIST" ]; then
  echo "CF_WORKERS_FIX=no_workers"
else
  echo "$WT_LIST" | while read -r WT; do
    if grep -qE "https?://[^\"']*\.vercel\.app" "$WT"; then
      # Use a node script to do a safe replace (sed is fragile with TOML quoting).
      OLD_CONTENT=$(cat "$WT")
      NEW_CONTENT=$(node -e "
        const s = require('fs').readFileSync('$WT','utf8');
        const out = s.replace(/https?:\/\/[^\"'\\s]*\.vercel\.app/g, 'https://' + process.env.NEW_DOMAIN);
        process.stdout.write(out);
      ")
      if [ "$OLD_CONTENT" != "$NEW_CONTENT" ]; then
        printf '%s' "$NEW_CONTENT" > "$WT"
        echo "CF_WORKER_PATCHED=$WT"
        # Redeploy from the worker's directory
        WORKER_DIR=$(dirname "$WT")
        (cd "$WORKER_DIR" && npx wrangler deploy 2>&1 | tail -3) \
          && echo "CF_WORKER_REDEPLOYED=$WT" \
          || echo "CF_WORKER_REDEPLOY_FAILED=$WT"
      fi
    fi
  done
fi
```

Depending on the output:
- `CF_WORKERS_FIX=no_workers` -> no Worker in the project, silent skip.
- `CF_WORKER_PATCHED=<path>` without `CF_WORKER_REDEPLOYED` -> the file is patched but the redeployment failed. Read the `wrangler deploy` output above to understand (auth? missing account_id?).
- `CF_WORKER_REDEPLOYED=<path>` -> ✅ announce to the user `✅ Cloudflare Worker <name> redeployed with the new URL`.

⚠️ Special case **`scripts/wrangler.toml` of the shared db-backup**: this Worker is outside the repo (`~/.db-backup-worker/wrangler.toml`) and does not contain a Vercel URL - it is not affected. The `find` above does not touch it (it only scans the project's repo).

### 11.4 - Auto-fix: Render Services env vars

`/add-agent` and the Render variant of `/add-automation` read the app's URL via an env var on Render (typically `APP_URL` or `NEXT_PUBLIC_APP_URL`). Render has no automatic link with Vercel: if `NEXT_PUBLIC_APP_URL` changes on the Vercel side, Render keeps the old value.

Run the block below if `RENDER_API_KEY` is available in the user's environment (otherwise skip silently - the user probably has no Render service).

```bash
NEW_DOMAIN="<domain>"
if [ -z "$RENDER_API_KEY" ]; then
  echo "RENDER_FIX=no_api_key"
else
  # 1. List all services on the user's Render account
  SERVICES_JSON=$(curl -sS -H "Authorization: Bearer $RENDER_API_KEY" \
    "https://api.render.com/v1/services?limit=50" 2>/dev/null)
  if [ -z "$SERVICES_JSON" ] || echo "$SERVICES_JSON" | grep -q '"message"'; then
    echo "RENDER_FIX=api_error"
  else
    SERVICE_IDS=$(echo "$SERVICES_JSON" | node -e "
      const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
      (d || []).forEach(s => console.log((s.service||s).id));
    ")

    if [ -z "$SERVICE_IDS" ]; then
      echo "RENDER_FIX=no_services"
    else
      echo "$SERVICE_IDS" | while read -r SID; do
        [ -z "$SID" ] && continue
        # 2. Get env vars for this service
        EV=$(curl -sS -H "Authorization: Bearer $RENDER_API_KEY" \
          "https://api.render.com/v1/services/$SID/env-vars?limit=50" 2>/dev/null)
        STALE=$(echo "$EV" | node -e "
          const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
          (d || []).forEach(e => {
            const ev = e.envVar || e;
            if (ev.value && /https?:\/\/[^\s\"']*\.vercel\.app/.test(ev.value)) {
              const nv = ev.value.replace(/https?:\/\/[^\s\"']*\.vercel\.app/g, 'https://' + process.env.NEW_DOMAIN);
              console.log(ev.key + '|' + ev.value + '|' + nv);
            }
          });
        ")
        [ -z "$STALE" ] && continue

        # 3. Patch each stale env var via PUT
        echo "$STALE" | while IFS='|' read -r KEY OLD_VAL NEW_VAL; do
          curl -sS -X PUT -H "Authorization: Bearer $RENDER_API_KEY" \
            -H "Content-Type: application/json" \
            -d "{\"value\":\"$NEW_VAL\"}" \
            "https://api.render.com/v1/services/$SID/env-vars/$KEY" >/dev/null \
            && echo "RENDER_PATCHED=$SID:$KEY ($OLD_VAL → $NEW_VAL)" \
            || echo "RENDER_PATCH_FAILED=$SID:$KEY"
        done

        # 4. Trigger a redeploy so the new env vars actually take effect
        curl -sS -X POST -H "Authorization: Bearer $RENDER_API_KEY" \
          -H "Content-Type: application/json" \
          -d '{"clearCache":"do_not_clear"}' \
          "https://api.render.com/v1/services/$SID/deploys" >/dev/null \
          && echo "RENDER_REDEPLOYED=$SID" \
          || echo "RENDER_REDEPLOY_FAILED=$SID"
      done
    fi
  fi
fi
```

Depending on the output:
- `RENDER_FIX=no_api_key` or `RENDER_FIX=no_services` -> silent, the user has no Render service to fix.
- `RENDER_FIX=api_error` -> auth/network error, surface the message and switch to manual (Render dashboard link in 11.5).
- `RENDER_PATCHED=<id>:<key>` + `RENDER_REDEPLOYED=<id>` -> ✅ announce `✅ Render Service <id> updated (X env vars patched) + redeployment started`.

⚠️ The Render redeployment takes 2-5 min - no need to wait in this flow. Mention to the user that they can monitor it via `https://dashboard.render.com`.

### 11.5 - Required manual actions

For each detected integration that CANNOT be auto-fixed, run an identical structured mini-block. The pattern:
1. Auto-open the dashboard with `open-url.mjs`
2. Display the exact values to paste (never "add your URL" - always `https://<domain>/...` formatted)
3. Wait for `"it's done"` from the user
4. Minimal probe after confirmation (when possible)

#### If `GOOGLE_OAUTH=yes`

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/open-url.mjs" "https://console.cloud.google.com/apis/credentials"
```

Display:

> ⚠️ **Google OAuth - manual action (no API)**
>
> I opened your Google Cloud console. Select your **OAuth 2.0 Client ID** (the one created by `/add-google-auth`), then:
>
> 1. **Authorized JavaScript origins** section -> **+ ADD URI** button:
>    `https://<domain>`
> 2. **Authorized redirect URIs** section -> **+ ADD URI** button:
>    `https://<domain>/api/auth/callback/google`
> 3. **Do not delete** the old `*.vercel.app` URLs (they serve as a test fallback).
> 4. Click **Save**.
>
> Tell me **"it's done"** when you're finished.

After confirmation: no probe possible (Google only fails at the moment of the user's click). Display:
> ℹ️ If after saving you still see `redirect_uri_mismatch`, that's Google's propagation (up to 5 min). Retry.

#### If `GITHUB_OAUTH=yes`

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/open-url.mjs" "https://github.com/settings/developers"
```

Display:

> ⚠️ **GitHub OAuth - manual action (no API)**
>
> I opened your GitHub OAuth Apps. Select the one created by `/add-github-auth`, then:
>
> 1. **Homepage URL** -> replace with `https://<domain>`
> 2. **Authorization callback URL** -> replace with `https://<domain>/api/auth/callback/github`
> 3. Click **Update application**.
>
> Note: unlike Google, GitHub allows only **one** callback URL per app - no Vercel fallback possible. If you want to keep the Vercel URL for testing, create a second OAuth App.
>
> Tell me **"it's done"**.

#### If `GA4=yes`

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/open-url.mjs" "https://analytics.google.com/"
```

Display:

> ⚠️ **Google Analytics 4 - manual action**
>
> I opened GA. Go to:
>
> 1. **Admin (⚙️ bottom left)** -> your property -> **Data Streams**
> 2. Select the existing web stream
> 3. **Edit URL** button -> set `https://<domain>` (no trailing slash)
> 4. Save
>
> Note: this does not break your existing data - GA4 does not filter by stream URL, it's just a label. But some hostname-based reports will be cleaner.
>
> Tell me **"it's done"**.

#### Note on Google Search Console

If the user uses `/gsc`, remind them separately:

> ℹ️ **Google Search Console** - Search Console works by **property**, not by stream. The old `*.vercel.app` property stays valid for its past data. For the new domain, run `/gsc` (or manually add `https://<domain>` on https://search.google.com/search-console). Not urgent, can be done later.

### 11.6 - Audit recap

After all the auto-fixes and user confirmations, display a structured recap:

> ✅ **Integrations audit complete**
>
> **Automatically fixed:**
> - [✓ Stripe webhook `wh_xxx` → https://... - if applicable]
> - [✓ Cloudflare Worker `<name>` redeployed with the new URL - if applicable]
> - [✓ Render Service `<id>`: X env vars patched + redeployment started - if applicable]
> - [✓ Resend domain (see Step 10) if applicable]
>
> **Manual action confirmed by you:**
> - [✓ Google OAuth - redirect URI added]
> - [✓ GA4 - stream URL updated]
> - [etc.]
>
> **Not installed, so nothing to do:**
> - [GitHub OAuth, Stripe, etc. - based on what returns `no` in 11.1]

If an auto-fix failed (STRIPE_FIX_FAIL) or if the user skipped a manual action, list it explicitly in a 4th section **To do later** with the dashboard URL and the values to paste.

---

## Step 12 - Commit & Deploy

If files were modified (replacement of vercel.app URLs, CLAUDE.md update, etc.):

1. Commit the changes:
   ```bash
   git add -A && git commit -m "fix(seo): replace vercel.app URLs with custom domain <domain>"
   ```
2. Push to trigger the deployment:
   ```bash
   git push
   ```

---

## Step 13 - Confirm

Summarize everything that was done:

> ✅ **Domain connected!** Your app is now accessible at **https://<domain>**
>
> **Architecture set up:**
> - <Registrar> (registrar) -> Cloudflare (DNS) -> Vercel (hosting)

If Email Routing was configured, add:
> - Emails received at `contact@<domain>` -> redirected to `<address>`

If Resend was configured, add:
> - Emails sent from `contact@<domain>` via Resend

The OAuth / Stripe / Analytics reminders are already covered by Step 11 - do not repeat them here.

Finish with:
> The HTTPS certificate is managed automatically by Vercel.
