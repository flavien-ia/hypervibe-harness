---
name: _dns-godaddy-manual
description: Internal - guide the user click-by-click to change a GoDaddy-registered domain's nameservers manually. GoDaddy's MCP is search-only (cannot manage DNS), and their Domains API is gated for new users since 2024 - manual mode is the only option. Triggered by /add-domain when the registrar is GoDaddy.
user-invocable: false
allowed-tools: Read Edit Write Bash
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# _dns-godaddy-manual - Point a GoDaddy domain to Cloudflare (manual)

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You receive as input: `<domain>`, `<ns1_cloudflare>`, `<ns2_cloudflare>`. Your job: guide the user to change the nameservers manually in the GoDaddy panel.

## Why no automation for GoDaddy

Unlike other registrars, **GoDaddy has no viable automation option**:
- The **official GoDaddy MCP** (developer.godaddy.com/mcp) is **read-only**: it only does domain search/availability checks, no DNS or nameserver management.
- The **Domains API** has been **gated since early 2024**: only existing accounts with high volumes can obtain API keys.

→ **Manual mode only**. If the user eventually wants automation, suggest migrating to Hostinger / OVH / Namecheap / Cloudflare Registrar (paid transfer ~10 EUR, but recovered the following year).

## Step 1 - Guide the nameserver change

Show the user:

> Your domain is with **GoDaddy**, which does not support DNS automation (a GoDaddy-side limitation, not ours). We'll do it together in a few clicks:
>
> 1. Log in at **https://account.godaddy.com/products**
> 2. Find `<domain>` in the **All Products and Services** list → **Domains**
> 3. Click **DNS** next to your domain
> 4. At the top of the page, **Nameservers** tab
> 5. Click **Edit** (or "Change")
> 6. Choose **"Enter my own nameservers"** (Custom)
> 7. Replace with:
>    - Nameserver 1: `<ns1_cloudflare>`
>    - Nameserver 2: `<ns2_cloudflare>`
> 8. Click **Save** → confirm the warning
>
> Let me know when it's done.

Wait for explicit confirmation before handing back to `add-domain`.

## Step 2 - Migration suggestion (optional)

Once confirmed, offer:

> 💡 **Suggestion**: if you want to be able to manage this domain in an automated way later (and save a few euros on renewal), you can **transfer** it to Hostinger, OVH, or Cloudflare Registrar. The transfer takes 5-7 days, costs ~10 EUR, but the transfer year is added to your renewal (so it's effectively free).
>
> Not urgent - you can do it in 6 months when you have 5 minutes. Should I note it in the project's `CLAUDE.md` so we don't forget?

If yes → note it in the project's CLAUDE.md via `_update-claude-md`:
- `custom`:
  - heading: `## Future action - migrate the domain away from GoDaddy`
  - body: brief description (reason + general procedure)

## Back to add-domain

> ✅ Nameservers for the domain `<domain>` pointed to Cloudflare. Propagation: 5-30 min (sometimes up to 24h with GoDaddy).
