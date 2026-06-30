---
name: _dns-ionos-manual
description: Internal - guide the user click-by-click to change an IONOS-registered domain's nameservers manually. IONOS has a clean DNS API but no publicly documented endpoint for changing nameservers at the registry level - manual mode is the only reliable option as of 2026-05. Triggered by /add-domain when the registrar is IONOS.
user-invocable: false
allowed-tools: Read Edit Write Bash
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# _dns-ionos-manual - Point an IONOS domain to Cloudflare (manual)

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You receive as input: `<domain>`, `<ns1_cloudflare>`, `<ns2_cloudflare>`. Your job: guide the user to change the nameservers manually in the IONOS panel.

## Why no automation for IONOS

The IONOS API is very clean **for managing DNS records** (zones + records): `https://api.hosting.ionos.com/dns/v1`, auth via `X-API-Key: publicprefix.secret`, clean JSON. Verified 2026-05 in libraries such as [pyonos](https://github.com/aaronlyy/pyonos), [cert-manager-webhook-ionos](https://github.com/fabmade/cert-manager-webhook-ionos), [external-dns-ionos-webhook](https://github.com/ionos-cloud/external-dns-ionos-webhook).

**BUT**: the **Domains** API (which manages NS delegation at the registrar level) is not publicly documented - the developer portal (https://developer.hosting.ionos.com/docs/domains) mentions its existence but the content is JS-rendered and inaccessible to scripts. No public library changes nameservers via the IONOS API.

→ **Manual mode only** for the NS change. The web panel does it without any trouble.

## Step 1 - Guide the nameserver change

Show to the user:

> Your domain is with **IONOS** (formerly 1&1). The IONOS API handles DNS records well, but not (publicly) the nameserver change at the registrar level. We'll do it together in a few clicks:
>
> 1. Log in at **https://www.ionos.fr/** (or .com / .de depending on your account)
> 2. In the navigation bar: **Domains & SSL** → **Domains**
> 3. Click on `<domain>` in the list
> 4. In the **DNS** tab (or directly the **Edit DNS servers** / "Adjust nameservers" button)
> 5. Choose **Use other nameservers** (*Use other nameservers* / *Eigene Nameserver*)
> 6. Replace with:
>    - Nameserver 1: `<ns1_cloudflare>`
>    - Nameserver 2: `<ns2_cloudflare>`
> 7. Leave NS3/NS4 empty if prompted
> 8. Click **Save** (*Save*) → confirm the propagation warning
>
> Let me know when it's done.

Wait for explicit confirmation before handing control back to `add-domain`.

## Step 2 - Note on IONOS propagation

IONOS announces *"up to 24h"* but in practice it's more like **15 min to 2h** for standard TLDs (`.fr`, `.com`, `.eu`, `.org`). For more exotic country-code TLDs (`.de`, `.at`, `.es`), it can take up to 4h.

## Step 3 (optional) - Set up the IONOS API for later

If the user wants to **later** automate DNS records or Let's Encrypt certificates on their IONOS account, offer to configure the API key now - it will save them from redoing everything in 3 months:

> 💡 **Bonus** (optional): if you want to be able to automate other things on your IONOS account later (DNS records, Let's Encrypt certificates via DNS challenge, zone management…), I can guide you to create an API key now. It takes 2 min and you won't have to think about it again.
>
> Want to?

If **yes**:

> 1. Go to **https://developer.hosting.ionos.com/keys**
> 2. Click **Create New Key**
> 3. **Name**: `Claude Code`
> 4. Click **Next** → confirm
> 5. The page displays **2 values**:
>    - **Public Prefix** (short, ~8 characters)
>    - **Secret** (long, ~64 characters)
> 6. Copy **both immediately** (the secret won't be shown again afterward)
> 7. Give them to me.

When the user has their 2 values (Public Prefix + Secret), store them in the **vault** (item `IONOS`, masked-input window - they don't pass through the chat):

```bash
VAULT="${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs"
node "${CLAUDE_SKILL_DIR}/../../scripts/vault/launch.mjs" add --name IONOS --service IONOS --fields "prefix:text,secret:secret"
```

Then rebuild the key (IONOS format = `prefix.secret`) and validate:

```bash
API_KEY="$(node "$VAULT" get IONOS prefix).$(node "$VAULT" get IONOS secret)"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "X-API-Key: $API_KEY" \
  "https://api.hosting.ionos.com/dns/v1/zones")
[ "$HTTP" = "200" ] && echo "VALID" || echo "INVALID (HTTP $HTTP)"
```

If **INVALID** → don't block, just tell the user they can redo it later. The NS change from step 1 is already done, that's what matters.

## Back to add-domain

> ✅ Nameservers for the domain `<domain>` pointed to Cloudflare. Propagation: 15 min to 2h in most cases (IONOS announces up to 24h but that's pessimistic for standard TLDs).
