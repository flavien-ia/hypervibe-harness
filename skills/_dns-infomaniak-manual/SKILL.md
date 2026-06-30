---
name: _dns-infomaniak-manual
description: Internal - guide the user click-by-click to change an Infomaniak-registered domain's nameservers manually. Infomaniak has a clean REST API for DNS records but the registry-level nameserver change endpoint is not publicly documented - manual mode is the only reliable option as of 2026-05. Triggered by /add-domain when the registrar is Infomaniak.
user-invocable: false
allowed-tools: Read Edit Write Bash
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# _dns-infomaniak-manual - Point an Infomaniak domain to Cloudflare (manual)

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You receive as input: `<domain>`, `<ns1_cloudflare>`, `<ns2_cloudflare>`. Your job: guide the user to change the nameservers manually in the Infomaniak Manager.

## Why there is no automation for Infomaniak

The Infomaniak API is very clean (Bearer token, REST/JSON, OAuth 2) **but it does not document the endpoint to change the nameservers at the registrar level**. Verified 2026-05:

- The developer portal (https://developer.infomaniak.com/) only exposes `PUT /2/zones/{zone}/records/{record}` - that is, **managing DNS records within the zone**, not the NS delegation.
- The public libraries (`libdns/infomaniak`, `certbot-dns-infomaniak`, `lego/dns/infomaniak`, the Ideative PHP client) only do record management - none of them change the nameservers.
- The web Manager clearly does it (see Step 1 below), but the underlying XHR endpoint is not public.

→ **Manual mode only**, until Infomaniak publishes the endpoint. When that happens, we'll turn this skill into an automated `_dns-infomaniak` (keeping the same contract).

## Step 1 - Guide the nameserver change

Show the user:

> Your domain is with **Infomaniak**, which has a clean API but does not (yet) document the endpoint to change the nameservers at the registrar level. We'll do it together in a few clicks - it's quick:
>
> 1. Log in at **https://manager.infomaniak.com/v3/ng/products/web/domains**
> 2. Click `<domain>` in the list of your domains
> 3. In the left sidebar, click **Serveurs DNS** (or *DNS Servers* in English)
> 4. Click the blue **Modifier les serveurs DNS** button (*Modify DNS Servers*)
> 5. Choose **Serveurs DNS personnalisés** (*Custom Name Servers*)
> 6. Replace the values with:
>    - Nameserver 1: `<ns1_cloudflare>`
>    - Nameserver 2: `<ns2_cloudflare>`
> 7. (If Infomaniak shows fields for NS3/NS4, leave them empty)
> 8. Click **Enregistrer** (*Save*) → confirm the propagation warning
>
> Let me know when it's done.

Wait for explicit confirmation before handing control back to `add-domain`.

## Step 2 - Note on Infomaniak propagation

Infomaniak officially states *"up to 48h of propagation"* in its interface. In practice, it's more like **15 min to 2h** for most TLDs, but don't worry if the DNS check (Step 8 of `add-domain`) takes a while - it can go up to 24h with them depending on the TLD (notably `.ch`, `.swiss`, and certain national TLDs).

## Step 3 (optional) - Setting up the Infomaniak Personal Access Token

If the user wants to **later** automate other Infomaniak operations (manage DNS records, create mailboxes, etc.), offer to set up a PAT now - it'll save them from redoing everything in 3 months:

> 💡 **Bonus** (optional): if you want to be able to automate other things on your Infomaniak account later (DNS records, mailboxes, Let's Encrypt certificates via DNS challenge…), I can guide you to create an API token now. It takes 2 min and you won't have to think about it again.
>
> Want to?

If **yes**:

> 1. Go to **https://manager.infomaniak.com/v3/ng/profile/user/token/list**
> 2. Click **Créer un token** (*Create a token*)
> 3. **Name**: `Claude Code`
> 4. **Application**: choose *"API Infomaniak"* (generic - covers all services)
> 5. **Scope**: select `domain:read`, `dns:read`, `dns:write` (at minimum)
> 6. **Validity**: choose **Illimitée** (Unlimited) (or 1 year if you prefer)
> 7. Confirm with your Infomaniak password
> 8. **Copy the token immediately** (it won't be shown again afterward)
> 9. Give it to me, I'll store it properly.

When the user has created their token, store it in the **vault** (item `INFOMANIAK`, masked-input window - the value does not pass through the chat):

```bash
VAULT="${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs"
node "${CLAUDE_SKILL_DIR}/../../scripts/vault/launch.mjs" add --name INFOMANIAK --service Infomaniak --fields api_token:secret
```

Then load it and validate it:

```bash
export INFOMANIAK_API_TOKEN=$(node "$VAULT" get INFOMANIAK api_token)
HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $INFOMANIAK_API_TOKEN" \
  "https://api.infomaniak.com/1/profile")
[ "$HTTP" = "200" ] && echo "VALID" || echo "INVALID (HTTP $HTTP)"
```

If **INVALID** → don't block, just let the user know they can redo the PAT later (the NS change from step 1 has already been done, so that's the essential part).

## Back to add-domain

> ✅ Nameservers for domain `<domain>` pointed to Cloudflare. Propagation: 15 min to 2h in the majority of cases (Infomaniak may indicate up to 48h in its UI but that's very pessimistic for standard TLDs).
